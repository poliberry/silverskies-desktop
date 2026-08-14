import { app, BrowserWindow, ipcMain, Notification, nativeImage, nativeTheme, session, shell } from "electron";
import path from "node:path";
import { randomUUID } from "node:crypto";
import serve from "electron-serve";
import { autoUpdater } from "electron-updater";
import { configStore, locationsStore, sessionStore } from "./store";
import type {
  AppInfo,
  SavedLocation,
  SessionWindowEntry,
  UpdaterStatus,
  WindowBoundsRect,
  WindowLocation,
  WindowRole,
} from "./types";

const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;
const DEV_URL = "http://localhost:3000";

// Shipped via the `assets/**/*` files pattern in package.json's build
// config — distinct from `build/` (electron-builder's own reserved
// installer-icon convention, which isn't bundled into the packaged app and
// so isn't loadable at runtime).
const ASSETS_DIR = path.join(__dirname, "../assets");
const ICON_LIGHT_PATH = path.join(ASSETS_DIR, "icon-light.png");
const ICON_DARK_PATH = path.join(ASSETS_DIR, "icon-dark.png");

// Serves renderer/out (the Next.js static export) over a custom app://
// protocol in production — avoids the asset-path/routing quirks of loading
// a Next export straight off file:// and avoids bundling a Node server.
const loadProdApp = serve({ directory: path.join(__dirname, "../renderer/out") });

/**
 * Every open window (main, plus however many radar/conditions/alert
 * pop-outs) is tracked here, keyed by Electron's own numeric window id.
 * This replaced a single module-level `mainWindow` variable now that the
 * app supports opening multiple independent radar instances — see
 * getMainWindow()/getRadarWindow()/getConditionsWindowsFor() below for the
 * lookups that used to just be `mainWindow` directly.
 */
interface TrackedWindow {
  win: BrowserWindow;
  role: WindowRole;
  /** Unique per radar/conditions instance; absent for "main" and "alert". */
  instanceId?: string;
  /** For a "conditions" window, the radar instanceId it tracks. */
  pairedInstanceId?: string;
  /** Last-known active location for this instance — persisted to
   * session.json so a restored radar/conditions window reopens where it
   * left off, and (for radar windows) relayed to any paired conditions
   * window whenever it changes. */
  location?: WindowLocation | null;
}

const windows = new Map<number, TrackedWindow>();
// The single radar pop-out (if any) that undocked the *main* window's own
// radar — as opposed to an independent "New Radar Window" instance. When
// this one closes, Shell redocks. Only ever one at a time.
let primaryPopoutWindowId: number | null = null;
// Same idea, independently tracked, for the single auditLog pop-out (if
// any) that undocked the *main* window's own audit log — paired to the
// "main" sentinel instanceId rather than a real radar instance.
let primaryAuditLogPopoutWindowId: number | null = null;
// Short-lived handoff for "open this alert in its own window" — keyed by a
// one-time token so the alert's full text never has to round-trip through a
// URL query string. Entries are deleted as soon as they're read, with a
// timeout as a backstop in case the window is closed before it asks.
const pendingAlertPayloads = new Map<string, unknown>();

function getMainWindow(): BrowserWindow | null {
  for (const tracked of windows.values()) {
    if (tracked.role === "main") return tracked.win;
  }
  return null;
}

function broadcastToAll(channel: string, ...args: unknown[]) {
  for (const tracked of windows.values()) {
    tracked.win.webContents.send(channel, ...args);
  }
}

/** Swaps the window/taskbar icon for the light/dark variant matching the OS
 * theme. This only affects the *running* window's icon (what Explorer shows
 * for a shortcut/the packaged .exe itself is a separate, static icon baked
 * in at build time via `build.win.icon` in package.json — Windows has no
 * concept of a "theme-aware" icon resource on the exe itself). */
function applyWindowIcon(win: BrowserWindow) {
  const iconPath = nativeTheme.shouldUseDarkColors ? ICON_DARK_PATH : ICON_LIGHT_PATH;
  const icon = nativeImage.createFromPath(iconPath);
  if (!icon.isEmpty()) win.setIcon(icon);
}

nativeTheme.on("updated", () => {
  for (const tracked of windows.values()) applyWindowIcon(tracked.win);
});

/** Shared window.open()/navigation lock-down, wired identically for every
 * window regardless of role — previously only ever applied to the single
 * main window. */
function wireCommonWindowBehavior(win: BrowserWindow) {
  applyWindowIcon(win);

  // Any window.open()/target=_blank (NWS/ECCC alert links, GitHub release
  // notes, etc.) opens in the OS browser instead of a second Electron window.
  // Radar/conditions/alert pop-outs are created directly via createAppWindow
  // below (from IPC handlers), never via window.open(), so this doesn't
  // conflict with the multi-window feature.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  // Block in-app navigation away from the app itself (defense in depth —
  // nothing in the UI should trigger this, but a stray link shouldn't be
  // able to repurpose a window either).
  win.webContents.on("will-navigate", (event, url) => {
    const isDevUrl = isDev && url.startsWith(DEV_URL);
    const isAppUrl = url.startsWith("app://");
    if (!isDevUrl && !isAppUrl) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
}

const WINDOW_DEFAULTS: Record<WindowRole, { width: number; height: number; minWidth?: number; minHeight?: number }> = {
  main: { width: 1440, height: 900, minWidth: 1080, minHeight: 720 },
  radar: { width: 1200, height: 800, minWidth: 700, minHeight: 500 },
  conditions: { width: 380, height: 820, minWidth: 320, minHeight: 480 },
  alert: { width: 440, height: 600, minWidth: 360, minHeight: 400 },
  auditLog: { width: 420, height: 700, minWidth: 340, minHeight: 420 },
};

interface CreateAppWindowOptions {
  role: WindowRole;
  instanceId?: string;
  pairedInstanceId?: string;
  location?: WindowLocation | null;
  bounds?: WindowBoundsRect;
  /** Only for role "alert" — the one-time token the alert window reads back
   * out of its own launch URL to fetch its payload. */
  alertToken?: string;
}

/** Generalized replacement for the old single-purpose createWindow() — every
 * window (main included) is created through here so role/instance wiring,
 * icon/navigation behavior, and session tracking all stay in one place. */
function createAppWindow(opts: CreateAppWindowOptions): BrowserWindow {
  const defaults = WINDOW_DEFAULTS[opts.role];
  const win = new BrowserWindow({
    x: opts.bounds?.x,
    y: opts.bounds?.y,
    width: opts.bounds?.width ?? defaults.width,
    height: opts.bounds?.height ?? defaults.height,
    minWidth: defaults.minWidth,
    minHeight: defaults.minHeight,
    backgroundColor: "#0d0d0f", // matches --bg, avoids a white flash on load
    autoHideMenuBar: true,
    // Every window draws its own titlebar (drag region + minimize/maximize/
    // close, via the windowControls:* IPC below) instead of the OS chrome —
    // `thickFrame` (Windows-only, defaults true) keeps the native resizable
    // border/shadow/Aero-Snap behavior even though the title bar itself is
    // custom-drawn.
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  wireCommonWindowBehavior(win);

  const tracked: TrackedWindow = {
    win,
    role: opts.role,
    instanceId: opts.instanceId,
    pairedInstanceId: opts.pairedInstanceId,
    location: opts.location ?? null,
  };
  windows.set(win.id, tracked);

  const query = new URLSearchParams({ window: opts.role });
  if (opts.instanceId) query.set("instanceId", opts.instanceId);
  if (opts.pairedInstanceId) query.set("pairedInstanceId", opts.pairedInstanceId);
  if (opts.location) {
    query.set("lat", String(opts.location.lat));
    query.set("lon", String(opts.location.lon));
    query.set("label", opts.location.label);
  }
  if (opts.alertToken) query.set("token", opts.alertToken);

  if (isDev) {
    const qs = query.toString();
    win.loadURL(qs ? `${DEV_URL}/?${qs}` : DEV_URL);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    loadProdApp(win, query);
  }

  // Debounced so dragging/resizing doesn't spam disk writes — see
  // scheduleSessionSave() below.
  win.on("moved", scheduleSessionSave);
  win.on("resized", scheduleSessionSave);

  // Keeps each window's own custom maximize/restore icon in sync — not just
  // with its own titlebar button, but with OS-level maximize gestures the
  // custom drag region still honors (double-click, Aero Snap to the top).
  const sendMaximizeState = () => win.webContents.send("windowControls:maximizeChanged", win.isMaximized());
  win.on("maximize", sendMaximizeState);
  win.on("unmaximize", sendMaximizeState);

  win.on("closed", () => {
    windows.delete(win.id);
    if (win.id === primaryPopoutWindowId) {
      primaryPopoutWindowId = null;
      broadcastToAll("windows:primaryRadarClosed");
    }
    if (win.id === primaryAuditLogPopoutWindowId) {
      primaryAuditLogPopoutWindowId = null;
      broadcastToAll("windows:primaryAuditLogClosed");
    }
    scheduleSessionSave();
  });

  scheduleSessionSave();
  return win;
}

// --- Session persistence (window.json snapshot of open pop-outs) ---------

let saveSessionTimer: ReturnType<typeof setTimeout> | null = null;

/** Debounced so a burst of window events (opening several pop-outs at once,
 * dragging one around) collapses into a single write. */
function scheduleSessionSave() {
  if (saveSessionTimer) clearTimeout(saveSessionTimer);
  saveSessionTimer = setTimeout(() => {
    saveSessionTimer = null;
    // A bare `void` here would leave a rejected write (disk full,
    // permissions, a transient I/O error) as an unhandled rejection, which
    // can crash the whole main process under Node's default handling.
    void saveSessionSnapshot().catch((err) => {
      console.error("[session] failed to save session snapshot:", err);
    });
  }, 500);
}

async function saveSessionSnapshot() {
  const entries: SessionWindowEntry[] = [];
  for (const tracked of windows.values()) {
    // Alert windows are transient token-handoff popups — restoring them
    // on relaunch would mean restoring a payload that's already gone.
    if (tracked.role === "alert") continue;
    if (tracked.win.isDestroyed()) continue;
    const b = tracked.win.getBounds();
    entries.push({
      role: tracked.role,
      instanceId: tracked.instanceId,
      pairedInstanceId: tracked.pairedInstanceId,
      isPrimaryPopout:
        tracked.win.id === primaryPopoutWindowId || tracked.win.id === primaryAuditLogPopoutWindowId,
      location: tracked.location ?? null,
      bounds: { x: b.x, y: b.y, width: b.width, height: b.height },
    });
  }

  const config = await configStore.read();
  if (config.uiMode !== "advanced") {
    // Classic mode never opens pop-outs itself (the UI hides those
    // affordances), so `entries` here reflects only "main" — saving that
    // as-is would clobber whatever pop-out layout was last persisted while
    // in "advanced" mode, and flipping back to "advanced" would then
    // restore nothing (see the comment where this snapshot is restored, in
    // app.whenReady()). Preserve the on-disk pop-out entries untouched and
    // only update "main"'s own bounds.
    const existing = await sessionStore.read();
    const preservedPopouts = existing.windows.filter((w) => w.role !== "main");
    const mainEntry = entries.find((w) => w.role === "main");
    await sessionStore.write({ windows: mainEntry ? [mainEntry, ...preservedPopouts] : preservedPopouts });
    return;
  }

  await sessionStore.write({ windows: entries });
}

/** Nominatim's and NWS's usage policies ask for a descriptive User-Agent
 * identifying the app + a contact method — browsers/`fetch()` forbid the
 * renderer from setting that header itself, so it's injected here instead. */
function registerUserAgentHeader() {
  const targetHosts = ["nominatim.openstreetmap.org", "api.weather.gov"];
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: targetHosts.map((h) => `https://${h}/*`) },
    (details, callback) => {
      details.requestHeaders["User-Agent"] =
        "SilverSkies/1.0 (desktop app; https://github.com/REPLACE_WITH_GITHUB_OWNER/silverskies-desktop)";
      callback({ requestHeaders: details.requestHeaders });
    },
  );
}

/** WillyWeather's API has no `Access-Control-Allow-Origin` header, so a
 * direct `fetch()` from the renderer (an `app://`/`http://localhost` origin,
 * same as any browser tab) is blocked by CORS even though the request
 * itself succeeds. Electron's renderer is still Chromium, so it enforces
 * CORS the same way a browser tab would — this patches the *response*
 * headers for just that host so the browser-side fetch is allowed to read
 * the result, the same trick used for LibreWXR/NWS/etc. isn't needed
 * (those already send permissive CORS headers). */
function registerCorsWorkarounds() {
  const corsHosts = ["api.willyweather.com.au"];
  session.defaultSession.webRequest.onHeadersReceived(
    { urls: corsHosts.map((h) => `https://${h}/*`) },
    (details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Access-Control-Allow-Origin": ["*"],
        },
      });
    },
  );
}

function registerIpcHandlers() {
  ipcMain.handle("locations:get", () => locationsStore.read());

  ipcMain.handle("locations:add", (_event, location: Omit<SavedLocation, "id">) =>
    locationsStore.update((current) => {
      const saved: SavedLocation = { id: randomUUID(), ...location };
      return { ...current, savedLocations: [...current.savedLocations, saved] };
    }),
  );

  ipcMain.handle("locations:remove", (_event, id: string) =>
    locationsStore.update((current) => ({
      ...current,
      savedLocations: current.savedLocations.filter((loc) => loc.id !== id),
      activeLocationId: current.activeLocationId === id ? null : current.activeLocationId,
    })),
  );

  ipcMain.handle(
    "locations:update",
    (_event, id: string, patch: Partial<Omit<SavedLocation, "id">>) =>
      locationsStore.update((current) => ({
        ...current,
        savedLocations: current.savedLocations.map((loc) =>
          loc.id === id ? { ...loc, ...patch } : loc,
        ),
      })),
  );

  ipcMain.handle("locations:setActive", (_event, id: string | null) =>
    locationsStore.update((current) => ({ ...current, activeLocationId: id })),
  );

  ipcMain.handle("config:get", () => configStore.read());

  ipcMain.handle("config:set", (_event, patch) =>
    configStore.update((current) => ({ ...current, ...patch })),
  );

  ipcMain.handle("app:getVersion", () => app.getVersion());

  ipcMain.handle(
    "app:getInfo",
    (): AppInfo => ({
      version: app.getVersion(),
      electron: process.versions.electron ?? "?",
      chrome: process.versions.chrome ?? "?",
      node: process.versions.node ?? "?",
      platform: process.platform,
      arch: process.arch,
    }),
  );

  ipcMain.handle("app:openExternal", (_event, url: string) => shell.openExternal(url));

  // Taskbar "weather badge" — a small current-conditions glyph overlaid on
  // the app's taskbar icon. Rasterizing the remote Pixel Weather SVG is done
  // in the renderer (via <canvas>, which can load SVGs natively) and handed
  // over as a data URL; this just turns that into a nativeImage. Windows-
  // only API — a no-op everywhere else. Deliberately scoped to the main
  // window only: the taskbar icon is one shared OS resource, and the main
  // window is the one that owns "current conditions for the active location".
  ipcMain.handle("app:setOverlayIcon", (_event, dataUrl: string | null, description: string) => {
    const mainWindow = getMainWindow();
    if (process.platform !== "win32" || !mainWindow) return;
    const icon = dataUrl ? nativeImage.createFromDataURL(dataUrl) : null;
    mainWindow.setOverlayIcon(icon && !icon.isEmpty() ? icon : null, description);
  });

  // Desktop toast notifications for the background saved-locations watcher
  // (new alerts, notable forecasts, heads-up severe weather) — see
  // renderer/hooks/useLocationWatcher.ts for what triggers these.
  ipcMain.handle("app:notify", (_event, title: string, body: string) => {
    if (!Notification.isSupported()) return;
    const notification = new Notification({
      title,
      body,
      icon: nativeImage.createFromPath(ICON_DARK_PATH),
    });
    notification.on("click", () => {
      const mainWindow = getMainWindow();
      if (!mainWindow) return;
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    });
    notification.show();
  });
}

/** Every window is frameless (see createAppWindow) and draws its own
 * titlebar — these are the generic minimize/maximize/close primitives
 * behind it, scoped to whichever window actually sent the request rather
 * than a specific one, so the exact same renderer component
 * (WindowControlButtons) works identically in the main window's TopBar and
 * every radar/conditions/alert pop-out's own toolbar. */
function registerWindowControlHandlers() {
  ipcMain.handle("windowControls:minimize", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });

  ipcMain.handle("windowControls:toggleMaximize", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });

  ipcMain.handle("windowControls:close", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  ipcMain.handle("windowControls:isMaximized", (event) => BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false);
}

function registerWindowIpcHandlers() {
  ipcMain.handle(
    "windows:openRadar",
    (
      _event,
      opts: { instanceId?: string; location?: WindowLocation | null; isPrimaryPopout?: boolean } = {},
    ) => {
      if (opts.instanceId) {
        const existing = [...windows.values()].find(
          (t) => t.role === "radar" && t.instanceId === opts.instanceId,
        );
        if (existing) {
          if (existing.win.isMinimized()) existing.win.restore();
          existing.win.show();
          existing.win.focus();
          return;
        }
      }
      const instanceId = opts.instanceId ?? randomUUID();
      const win = createAppWindow({ role: "radar", instanceId, location: opts.location ?? null });
      if (opts.isPrimaryPopout) primaryPopoutWindowId = win.id;
    },
  );

  ipcMain.handle(
    "windows:openConditions",
    (_event, opts: { instanceId: string; location?: WindowLocation | null }) => {
      const existing = [...windows.values()].find(
        (t) => t.role === "conditions" && t.pairedInstanceId === opts.instanceId,
      );
      if (existing) {
        if (existing.win.isMinimized()) existing.win.restore();
        existing.win.show();
        existing.win.focus();
        return;
      }
      createAppWindow({
        role: "conditions",
        instanceId: randomUUID(),
        pairedInstanceId: opts.instanceId,
        location: opts.location ?? null,
      });
    },
  );

  ipcMain.handle(
    "windows:openAuditLog",
    (
      _event,
      opts: { instanceId: string; location?: WindowLocation | null; isPrimaryPopout?: boolean },
    ) => {
      const existing = [...windows.values()].find(
        (t) => t.role === "auditLog" && t.pairedInstanceId === opts.instanceId,
      );
      if (existing) {
        if (existing.win.isMinimized()) existing.win.restore();
        existing.win.show();
        existing.win.focus();
        return;
      }
      const win = createAppWindow({
        role: "auditLog",
        instanceId: randomUUID(),
        pairedInstanceId: opts.instanceId,
        location: opts.location ?? null,
      });
      if (opts.isPrimaryPopout) primaryAuditLogPopoutWindowId = win.id;
    },
  );

  ipcMain.handle("windows:openAlert", (_event, alert: unknown) => {
    const token = randomUUID();
    pendingAlertPayloads.set(token, alert);
    // Backstop: if nothing ever reads it (window closed before mounting,
    // etc.) don't hold onto arbitrary alert text indefinitely.
    setTimeout(() => pendingAlertPayloads.delete(token), 5 * 60_000).unref();
    createAppWindow({ role: "alert", alertToken: token });
  });

  ipcMain.handle("windows:getAlertPayload", (_event, token: string) => {
    // Deliberately *not* deleted on read: React's dev-mode double-invoked
    // effects (and a user simply reloading the alert window) mean this can
    // legitimately be called more than once for the same token. The 5-minute
    // timeout above is the only cleanup — a delete-on-read here previously
    // made the second read (or a reload) report a perfectly valid alert as
    // "no longer available".
    return pendingAlertPayloads.get(token) ?? null;
  });

  // Fire-and-forget: a radar window (or the main window, under the "main"
  // sentinel instanceId — see Shell.tsx) announces its own active location
  // whenever it changes (search, saved-location pick). Relayed only to that
  // instance's paired Conditions/auditLog windows, if any are open, and
  // recorded on the sender's own tracked entry so session.json restores it
  // to the right place too.
  ipcMain.on("windows:instanceLocationChanged", (event, instanceId: string, location: WindowLocation) => {
    const sender = BrowserWindow.fromWebContents(event.sender);
    const senderTracked = sender ? windows.get(sender.id) : undefined;
    if (senderTracked) senderTracked.location = location;

    for (const tracked of windows.values()) {
      if ((tracked.role === "conditions" || tracked.role === "auditLog") && tracked.pairedInstanceId === instanceId) {
        tracked.location = location;
        tracked.win.webContents.send("windows:instanceLocation", location);
      }
    }
    scheduleSessionSave();
  });

  // Lets Shell initialize its "is my radar undocked?" state correctly on
  // mount instead of assuming false — the main window's own React state
  // resets on a reload/relaunch, but the actual pop-out window (tracked
  // here in the registry) doesn't, so this is the source of truth.
  ipcMain.handle("windows:isPrimaryRadarOpen", () => primaryPopoutWindowId !== null);

  // Same purpose as windows:isPrimaryRadarOpen above, for the main window's
  // own poppable audit log.
  ipcMain.handle("windows:isPrimaryAuditLogOpen", () => primaryAuditLogPopoutWindowId !== null);
}

// The renderer only hears about *future* status changes once it subscribes
// (see updater:getStatus below) — an update can finish downloading, for
// instance, entirely while the About tab isn't mounted (or before it's ever
// been opened at all), and without this cache reopening it would show
// "idle" forever instead of "Restart & Install".
let lastUpdaterStatus: UpdaterStatus = { state: "idle" };

function sendUpdaterStatus(status: UpdaterStatus) {
  lastUpdaterStatus = status;
  // Broadcast rather than main-only: harmless for pop-out windows (nothing
  // in them listens), and keeps this correct if the About/updater UI is
  // ever surfaced somewhere other than the main window's Settings dialog.
  broadcastToAll("updater:status", status);
}

/** Wires electron-updater's events to the renderer (About tab) and exposes
 * a manual check/install pair on top of the silent `checkForUpdatesAndNotify`
 * call at startup below — that one only ever surfaces a native OS
 * notification, nothing the UI itself can react to. */
function registerUpdaterHandlers() {
  // The user chooses when to download and when to install/restart — never
  // automatic. autoInstallOnAppQuit defaults to true (installs a pending
  // download the moment the app quits, with no further confirmation), which
  // is exactly the kind of behind-your-back install this is meant to avoid.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  ipcMain.handle("updater:getStatus", () => lastUpdaterStatus);

  autoUpdater.on("checking-for-update", () => sendUpdaterStatus({ state: "checking" }));
  autoUpdater.on("update-available", (info) => sendUpdaterStatus({ state: "available", version: info.version }));
  autoUpdater.on("update-not-available", () => sendUpdaterStatus({ state: "not-available" }));
  autoUpdater.on("download-progress", (progress) =>
    sendUpdaterStatus({ state: "downloading", percent: Math.round(progress.percent) }),
  );
  autoUpdater.on("update-downloaded", (info) => sendUpdaterStatus({ state: "downloaded", version: info.version }));
  autoUpdater.on("error", (err) => sendUpdaterStatus({ state: "error", message: err.message }));

  ipcMain.handle("updater:check", () => {
    // Unpackaged/dev builds have no app-update.yml (electron-builder only
    // writes one into a real installer) — checkForUpdates() would just
    // throw, so short-circuit with a status the UI can explain plainly
    // instead of surfacing it as a generic error.
    if (!app.isPackaged) {
      sendUpdaterStatus({ state: "unsupported" });
      return;
    }
    autoUpdater.checkForUpdates().catch((err) => sendUpdaterStatus({ state: "error", message: String(err) }));
  });

  ipcMain.handle("updater:download", () => {
    autoUpdater.downloadUpdate().catch((err) => sendUpdaterStatus({ state: "error", message: String(err) }));
  });

  ipcMain.handle("updater:install", () => autoUpdater.quitAndInstall());
}

// Windows groups/attributes toast notifications by AppUserModelID — without
// this, notifications from an unpackaged/dev build can silently fail to
// show the app's icon or, on some Windows builds, not show at all.
if (process.platform === "win32") {
  app.setAppUserModelId("com.silverskies.desktop");
}

app.whenReady().then(async () => {
  registerUserAgentHeader();
  registerCorsWorkarounds();
  registerIpcHandlers();
  registerUpdaterHandlers();
  registerWindowIpcHandlers();
  registerWindowControlHandlers();

  const [config, savedSession] = await Promise.all([configStore.read(), sessionStore.read()]);

  const mainEntry = savedSession.windows.find((w) => w.role === "main");
  createAppWindow({ role: "main", bounds: mainEntry?.bounds });

  // Pop-out windows are only ever created by the user through the
  // "advanced" UI's affordances, so only restore them when that's still the
  // user's preference — flipping back to "classic" simply stops reopening
  // them (the snapshot itself is left alone, in case they flip back).
  if (config.uiMode === "advanced") {
    for (const entry of savedSession.windows) {
      if (entry.role === "main" || entry.role === "alert") continue;
      const win = createAppWindow({
        role: entry.role,
        instanceId: entry.instanceId,
        pairedInstanceId: entry.pairedInstanceId,
        location: entry.location ?? null,
        bounds: entry.bounds,
      });
      // Restores the "undocked" relationship too, not just the window
      // itself — otherwise a relaunch (or the main window merely reloading,
      // which re-mounts Shell with fresh React state) would show the main
      // window's radar/audit-log as docked again even though its pop-out is
      // still/already open. See windows:isPrimaryRadarOpen/
      // windows:isPrimaryAuditLogOpen below.
      if (entry.isPrimaryPopout) {
        if (entry.role === "radar") primaryPopoutWindowId = win.id;
        else if (entry.role === "auditLog") primaryAuditLogPopoutWindowId = win.id;
      }
    }
  }

  // Silently checks (never downloads/installs on its own — see
  // registerUpdaterHandlers) so the About tab already has a fresh status the
  // first time it's opened, instead of showing "idle" until the user clicks
  // Check for Updates themselves. No-op until `publish.owner` in
  // package.json is pointed at a real repo with published releases;
  // failures here must never block the app.
  if (app.isPackaged) {
    autoUpdater.checkForUpdates().catch(() => {
      /* not fatal — no update feed configured yet, or offline */
    });
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createAppWindow({ role: "main" });
  });
});

app.on("window-all-closed", () => {
  if (process.platform === "darwin") return;
  // scheduleSessionSave() debounces by 500ms — if the app quit before that
  // timer fired, the on-disk snapshot would still list whatever window(s)
  // just closed, and relaunch would incorrectly try to restore them. Cancel
  // the pending debounce and write the final state (the `windows` map is
  // already up to date here — each window's own 'closed' handler removes it
  // synchronously, before 'window-all-closed' fires) before actually quitting.
  if (saveSessionTimer) {
    clearTimeout(saveSessionTimer);
    saveSessionTimer = null;
  }
  void saveSessionSnapshot()
    .catch((err) => console.error("[session] failed to flush session snapshot before quit:", err))
    .finally(() => app.quit());
});

import { app, BrowserWindow, WebContentsView, ipcMain, Notification, nativeImage, nativeTheme, session, shell } from "electron";
import path from "node:path";
import { randomUUID } from "node:crypto";
import serve from "electron-serve";
import { autoUpdater } from "electron-updater";
import { configStore, locationsStore, sessionStore } from "./store";
import type {
  AppInfo,
  MapViewBounds,
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
  /** Only for role "browser" — the embedded page, layered as a child View
   * over the chrome renderer's own toolbar (see attachBrowserContentView). */
  browserView?: WebContentsView;
  /** Only for role "browser" — repositions browserView once the chrome
   * renderer reports its own real, measured height (see the
   * browser:chromeHeight IPC handler) instead of trusting the
   * BROWSER_CHROME_HEIGHT fallback to stay in sync with two files forever. */
  browserRelayout?: (chromeHeight: number) => void;
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
// The last bounds reported for each radar instance (or the "main" sentinel)
// — see windows:instanceBoundsChanged. A radar reports its bbox as soon as
// its map mounts, which is normally *before* its paired audit-log window
// (if any) is opened, so the live relay below alone would never reach a
// window that didn't exist yet; windows:getInstanceBounds lets a newly
// (re)mounted audit-log window ask for what it missed instead of sitting at
// `bounds === null` until the next pan/zoom. Not part of TrackedWindow/
// session.json — same reasoning as bounds not being persisted there.
const latestBoundsByInstance = new Map<string, MapViewBounds>();

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
  browser: { width: 1100, height: 800, minWidth: 500, minHeight: 400 },
  weatherRadio: { width: 360, height: 460, minWidth: 320, minHeight: 380 },
};

// Fallback height (in CSS px) used for the "browser" role's embedded
// WebContentsView only until the chrome renderer reports its own real,
// measured height (see browserRelayout on TrackedWindow and the
// browser:chromeHeight IPC handler below) — kept as a same-ballpark
// starting point so content isn't briefly full-screen-under-the-toolbar
// before that first measurement arrives, not as a value that has to stay
// in exact sync with BrowserWindowChrome.tsx's actual layout.
const BROWSER_CHROME_HEIGHT_FALLBACK = 64;

interface CreateAppWindowOptions {
  role: WindowRole;
  instanceId?: string;
  pairedInstanceId?: string;
  location?: WindowLocation | null;
  bounds?: WindowBoundsRect;
  /** Only for role "alert" — the one-time token the alert window reads back
   * out of its own launch URL to fetch its payload. */
  alertToken?: string;
  /** Only for role "radar" — true for the single pop-out that undocks the
   * main window's own radar. Threaded into the launch URL so RadarWindow can
   * relay its map bounds under the "main" sentinel (the same one the main
   * window's own audit-log pairing already uses) instead of this window's
   * own real instanceId — bounds-only, deliberately not touching how its
   * location is relayed (see registerWindowIpcHandlers' bounds relay). */
  isPrimaryPopout?: boolean;
  /** Only for role "browser" — the page to load into the embedded
   * WebContentsView, and a title for the chrome renderer's toolbar. */
  browserUrl?: string;
  browserTitle?: string;
}

/** Loads external content (a radar-station page, an IEM VTEC event, an SPC
 * outlook page — see renderer/lib/browser/external-links.ts) into a
 * sandboxed WebContentsView layered under the "browser" role's own chrome
 * renderer, which draws just a toolbar and leaves the rest of its window
 * transparent for this view to show through. Kept in the main process
 * (rather than an in-renderer `<webview>`) since webviewTag is deliberately
 * left disabled on every window here. */
function attachBrowserContentView(win: BrowserWindow, tracked: TrackedWindow, url: string) {
  const view = new WebContentsView({
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  tracked.browserView = view;
  win.contentView.addChildView(view);

  let chromeHeight = BROWSER_CHROME_HEIGHT_FALLBACK;
  const layout = () => {
    const [width, height] = win.getContentSize();
    view.setBounds({ x: 0, y: chromeHeight, width, height: Math.max(0, height - chromeHeight) });
  };
  layout();
  win.on("resize", layout);
  tracked.browserRelayout = (measuredHeight: number) => {
    chromeHeight = measuredHeight;
    layout();
  };

  // Basic hardening — arbitrary external content shouldn't be able to spawn
  // further Electron windows of its own.
  view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  const sendState = () => {
    if (win.isDestroyed()) return;
    win.webContents.send("browser:state", {
      url: view.webContents.getURL(),
      title: view.webContents.getTitle(),
      canGoBack: view.webContents.navigationHistory.canGoBack(),
      canGoForward: view.webContents.navigationHistory.canGoForward(),
      isLoading: view.webContents.isLoading(),
    });
  };
  view.webContents.on("did-navigate", sendState);
  view.webContents.on("did-navigate-in-page", sendState);
  view.webContents.on("page-title-updated", sendState);
  view.webContents.on("did-start-loading", sendState);
  view.webContents.on("did-stop-loading", sendState);

  view.webContents.loadURL(url).catch((err) => console.error("[browser] failed to load", url, err));
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
  if (opts.isPrimaryPopout) query.set("isPrimaryPopout", "1");
  if (opts.browserUrl) query.set("url", opts.browserUrl);
  if (opts.browserTitle) query.set("title", opts.browserTitle);

  if (isDev) {
    const qs = query.toString();
    win.loadURL(qs ? `${DEV_URL}/?${qs}` : DEV_URL);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    loadProdApp(win, query);
  }

  if (opts.role === "browser" && opts.browserUrl) {
    attachBrowserContentView(win, tracked, opts.browserUrl);
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
    const closedTracked = windows.get(win.id);
    windows.delete(win.id);
    if (win.id === primaryPopoutWindowId) {
      primaryPopoutWindowId = null;
      broadcastToAll("windows:primaryRadarClosed");
      // Undocking the radar from the main app also opened a paired
      // conditions + audit-log window and hid main (see windows:openRadar
      // below) — reverse all three now that the radar itself is closing.
      // Looked up fresh by pairedInstanceId rather than snapshotting what
      // was auto-opened: openConditions/openAuditLog already dedupe to at
      // most one window per instanceId, so "whatever's currently paired" and
      // "whatever this cascade opened" are always the same window.
      const closingInstanceId = closedTracked?.instanceId;
      if (closingInstanceId) {
        for (const tracked of [...windows.values()]) {
          if (
            (tracked.role === "conditions" || tracked.role === "auditLog") &&
            tracked.pairedInstanceId === closingInstanceId &&
            !tracked.win.isDestroyed()
          ) {
            tracked.win.close();
          }
        }
      }
      const mainWindow = getMainWindow();
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      }
    }
    if (win.id === primaryAuditLogPopoutWindowId) {
      primaryAuditLogPopoutWindowId = null;
      broadcastToAll("windows:primaryAuditLogClosed");
    }
    // The window is already destroyed by the time "closed" fires (its
    // contentView tree, including any embedded browserView, is torn down
    // along with it) — just drop our own reference so nothing here keeps
    // pointing at it.
    if (closedTracked) closedTracked.browserView = undefined;
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
    // Browser windows are equally transient (just a page someone opened to
    // look something up) and aren't worth restoring either. The weather
    // radio window is a singleton utility panel with no per-instance state
    // worth restoring — reopened from the toolbar each launch instead.
    if (tracked.role === "alert" || tracked.role === "browser" || tracked.role === "weatherRadio") continue;
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
 * (those already send permissive CORS headers). noaaweatherradio.org's
 * public NWR transmitter directory (see lib/weather-radio/nwr-directory.ts)
 * has the exact same gap — confirmed via a direct header check, no
 * Access-Control-Allow-Origin at all — while the wxradio.org stream hosts
 * that directory actually points at already send `Access-Control-Allow-
 * Origin: *` themselves, so only the directory host needs this. */
function registerCorsWorkarounds() {
  const corsHosts = ["api.willyweather.com.au", "noaaweatherradio.org"];
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

/** Shared by the windows:openConditions IPC handler and the radar-undock
 * cascade (windows:openRadar below) — both need "find the conditions window
 * already paired to this instanceId, or create one" and openConditions only
 * ever creates at most one per instanceId, so there's nothing distinct
 * between "auto-opened by the cascade" and "opened via this handler" to
 * track separately. */
function openOrShowConditionsWindow(opts: { instanceId: string; location?: WindowLocation | null }): BrowserWindow {
  const existing = [...windows.values()].find(
    (t) => t.role === "conditions" && t.pairedInstanceId === opts.instanceId,
  );
  if (existing) {
    if (existing.win.isMinimized()) existing.win.restore();
    existing.win.show();
    existing.win.focus();
    return existing.win;
  }
  return createAppWindow({
    role: "conditions",
    instanceId: randomUUID(),
    pairedInstanceId: opts.instanceId,
    location: opts.location ?? null,
  });
}

/** Same idea as openOrShowConditionsWindow above, for the audit-log role. */
function openOrShowAuditLogWindow(opts: {
  instanceId: string;
  location?: WindowLocation | null;
  isPrimaryPopout?: boolean;
}): BrowserWindow {
  const existing = [...windows.values()].find(
    (t) => t.role === "auditLog" && t.pairedInstanceId === opts.instanceId,
  );
  if (existing) {
    if (existing.win.isMinimized()) existing.win.restore();
    existing.win.show();
    existing.win.focus();
    return existing.win;
  }
  const win = createAppWindow({
    role: "auditLog",
    instanceId: randomUUID(),
    pairedInstanceId: opts.instanceId,
    location: opts.location ?? null,
  });
  if (opts.isPrimaryPopout) primaryAuditLogPopoutWindowId = win.id;
  return win;
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
      const win = createAppWindow({
        role: "radar",
        instanceId,
        location: opts.location ?? null,
        isPrimaryPopout: opts.isPrimaryPopout,
      });
      if (opts.isPrimaryPopout) {
        primaryPopoutWindowId = win.id;
        // Undocking the radar from the main app also undocks the audit log
        // and opens a conditions window for it, then hides the main window
        // — reversed in this same window's "closed" handler above. Scoped
        // only to this primary-popout path, not the independent "New Radar
        // Window" action (windows:openRadar without isPrimaryPopout).
        openOrShowConditionsWindow({ instanceId, location: opts.location ?? null });
        openOrShowAuditLogWindow({ instanceId, location: opts.location ?? null });
        getMainWindow()?.hide();
      }
    },
  );

  ipcMain.handle(
    "windows:openConditions",
    (_event, opts: { instanceId: string; location?: WindowLocation | null }) => {
      openOrShowConditionsWindow(opts);
    },
  );

  ipcMain.handle(
    "windows:openAuditLog",
    (
      _event,
      opts: { instanceId: string; location?: WindowLocation | null; isPrimaryPopout?: boolean },
    ) => {
      openOrShowAuditLogWindow(opts);
    },
  );

  ipcMain.handle("windows:openBrowser", (_event, opts: { url: string; title?: string }) => {
    createAppWindow({ role: "browser", browserUrl: opts.url, browserTitle: opts.title });
  });

  // A singleton utility window — only ever one at a time, always paired to
  // the "main" sentinel instanceId so it picks up Shell's own active
  // location the same way the primary conditions/audit-log windows do (see
  // Shell.tsx's `ipc.windows.sendInstanceLocation("main", ...)`), rather
  // than needing its own instanceId/pairing scheme.
  ipcMain.handle("windows:openWeatherRadio", (_event, opts: { location?: WindowLocation | null } = {}) => {
    const existing = [...windows.values()].find((t) => t.role === "weatherRadio");
    if (existing) {
      if (existing.win.isMinimized()) existing.win.restore();
      existing.win.show();
      existing.win.focus();
      return;
    }
    createAppWindow({ role: "weatherRadio", pairedInstanceId: "main", location: opts.location ?? null });
  });

  function getBrowserView(event: Electron.IpcMainInvokeEvent): WebContentsView | undefined {
    const win = BrowserWindow.fromWebContents(event.sender);
    return win ? windows.get(win.id)?.browserView : undefined;
  }

  ipcMain.handle("browser:navigate", (event, url: string) => {
    void getBrowserView(event)?.webContents.loadURL(url);
  });
  ipcMain.handle("browser:goBack", (event) => getBrowserView(event)?.webContents.navigationHistory.goBack());
  ipcMain.handle("browser:goForward", (event) => getBrowserView(event)?.webContents.navigationHistory.goForward());
  ipcMain.handle("browser:reload", (event) => getBrowserView(event)?.webContents.reload());
  // The chrome renderer measures its own title-bar + nav-bar height (it can
  // vary slightly with OS font/DPI settings) and reports it here once
  // mounted, rather than this main-process file and BrowserWindowChrome.tsx
  // each hardcoding the same pixel number and silently drifting apart.
  ipcMain.on("browser:chromeHeight", (event, height: number) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const tracked = win && windows.get(win.id);
    tracked?.browserRelayout?.(height);
  });

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

  // Same fire-and-forget relay as instanceLocationChanged above, for a radar
  // instance's current map viewport (or an active shift-drag selection) —
  // powers the paired audit-log window's "alerts for what's on screen" view.
  // Deliberately not tracked on TrackedWindow or persisted to session.json —
  // a viewport isn't part of a window's identity the way its location is,
  // it's just a live feed. The "main" sentinel also reaches the main window
  // itself (not just auditLog windows paired to it) — see the isPrimaryPopout
  // comment on CreateAppWindowOptions for why the primary radar pop-out uses
  // this sentinel here despite using its own real instanceId for location.
  ipcMain.on("windows:instanceBoundsChanged", (_event, instanceId: string, bounds: MapViewBounds) => {
    latestBoundsByInstance.set(instanceId, bounds);
    for (const tracked of windows.values()) {
      if (tracked.role === "auditLog" && tracked.pairedInstanceId === instanceId) {
        tracked.win.webContents.send("windows:instanceBounds", bounds);
      }
    }
    if (instanceId === "main") {
      getMainWindow()?.webContents.send("windows:instanceBounds", bounds);
    }
  });

  // Lets a freshly (re)mounted audit-log window (or the main window itself,
  // for the primary radar/audit-log pairing) catch up on whatever bbox its
  // paired radar already reported before it existed — see
  // latestBoundsByInstance above.
  ipcMain.handle("windows:getInstanceBounds", (_event, instanceId: string) => latestBoundsByInstance.get(instanceId) ?? null);

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
      if (
        entry.role === "main" ||
        entry.role === "alert" ||
        entry.role === "browser" ||
        entry.role === "weatherRadio"
      )
        continue;
      const win = createAppWindow({
        role: entry.role,
        instanceId: entry.instanceId,
        pairedInstanceId: entry.pairedInstanceId,
        location: entry.location ?? null,
        bounds: entry.bounds,
        isPrimaryPopout: entry.role === "radar" ? entry.isPrimaryPopout : undefined,
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
    // A relaunch that restores an already-undocked primary radar should
    // restore main's hidden state too, not just reopen the pop-out windows
    // (which, being individually restored above rather than routed back
    // through windows:openRadar, don't re-trigger the undock cascade itself).
    if (primaryPopoutWindowId !== null) getMainWindow()?.hide();
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

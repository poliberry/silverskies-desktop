import { app, BrowserWindow, ipcMain, Notification, nativeImage, nativeTheme, session, shell } from "electron";
import path from "node:path";
import { randomUUID } from "node:crypto";
import serve from "electron-serve";
import { autoUpdater } from "electron-updater";
import { configStore, locationsStore } from "./store";
import type { AppInfo, SavedLocation, UpdaterStatus } from "./types";

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

let mainWindow: BrowserWindow | null = null;

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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: "#0d0d0f", // matches --bg, avoids a white flash on load
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  applyWindowIcon(mainWindow);
  nativeTheme.on("updated", () => {
    if (mainWindow) applyWindowIcon(mainWindow);
  });

  // Any window.open()/target=_blank (NWS/ECCC alert links, GitHub release
  // notes, etc.) opens in the OS browser instead of a second Electron window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  // Block in-app navigation away from the app itself (defense in depth —
  // nothing in the UI should trigger this, but a stray link shouldn't be
  // able to repurpose the main window either).
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const isDevUrl = isDev && url.startsWith(DEV_URL);
    const isAppUrl = url.startsWith("app://");
    if (!isDevUrl && !isAppUrl) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  if (isDev) {
    mainWindow.loadURL(DEV_URL);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    loadProdApp(mainWindow);
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
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
  // only API — a no-op everywhere else.
  ipcMain.handle("app:setOverlayIcon", (_event, dataUrl: string | null, description: string) => {
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
      if (!mainWindow) return;
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    });
    notification.show();
  });
}

// The renderer only hears about *future* status changes once it subscribes
// (see updater:getStatus below) — an update can finish downloading, for
// instance, entirely while the About tab isn't mounted (or before it's ever
// been opened at all), and without this cache reopening it would show
// "idle" forever instead of "Restart & Install".
let lastUpdaterStatus: UpdaterStatus = { state: "idle" };

function sendUpdaterStatus(status: UpdaterStatus) {
  lastUpdaterStatus = status;
  mainWindow?.webContents.send("updater:status", status);
}

/** Wires electron-updater's events to the renderer (About tab) and exposes
 * a manual check/install pair on top of the silent `checkForUpdatesAndNotify`
 * call at startup below — that one only ever surfaces a native OS
 * notification, nothing the UI itself can react to. */
function registerUpdaterHandlers() {
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

  ipcMain.handle("updater:install", () => autoUpdater.quitAndInstall());
}

// Windows groups/attributes toast notifications by AppUserModelID — without
// this, notifications from an unpackaged/dev build can silently fail to
// show the app's icon or, on some Windows builds, not show at all.
if (process.platform === "win32") {
  app.setAppUserModelId("com.silverskies.desktop");
}

app.whenReady().then(() => {
  registerUserAgentHeader();
  registerIpcHandlers();
  registerUpdaterHandlers();
  createWindow();

  // No-op until `publish.owner` in package.json is pointed at a real repo
  // with published releases; failures here must never block the app.
  if (app.isPackaged) {
    autoUpdater.checkForUpdatesAndNotify().catch(() => {
      /* not fatal — no update feed configured yet, or offline */
    });
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

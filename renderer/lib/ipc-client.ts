import type { ConfigFile, LocationsFile, SavedLocation } from "@/types/settings";
import type { AppInfo, UpdaterStatus } from "@/types/updater";
import type { BrowserWindowState, MapViewBounds, WindowLocation } from "@/types/windows";
import type { NormalizedAlert } from "@/types/alerts";
import "@/types/ipc";

const DEFAULT_APP_INFO: AppInfo = { version: "dev", electron: "-", chrome: "-", node: "-", platform: "-", arch: "-" };

const DEFAULT_LOCATIONS: LocationsFile = { savedLocations: [], activeLocationId: null };

const DEFAULT_CONFIG: ConfigFile = {
  provider: "open-meteo",
  accuWeatherApiKey: null,
  willyWeatherApiKey: null,
  openWeatherMapApiKey: null,
  libreWxrHost: "https://api.librewxr.net",
  units: "F",
  timeFormat: "12",
  theme: "system",
  autoRefreshMinutes: 30,
  devToolsEnabled: false,
  notificationsEnabled: true,
  spcOutlookEnabled: true,
  topGlowEnabled: true,
  uiMode: "classic",
  alertTypeOverrides: {},
  themeId: "default",
  customTheme: null,
  weatherRadioEnabled: false,
  weatherRadioMode: "simulated",
  weatherRadioLiveFeedMode: "auto",
  weatherRadioLiveStreamUrl: null,
};

let warned = false;
function warnNoBridge() {
  if (warned) return;
  warned = true;
  // Expected when previewing the Next dev server directly in a browser tab
  // instead of through Electron — persistence just falls back to in-memory
  // defaults for that session.
  console.warn(
    "[silverSkies] window.silverSkies is unavailable — not running inside Electron. Settings/locations won't persist.",
  );
}

/** Thin, always-present wrapper over `window.silverSkies` (exposed by
 * electron/preload.ts) that degrades gracefully outside Electron. */
export const ipc = {
  locations: {
    async get(): Promise<LocationsFile> {
      if (!window.silverSkies) { warnNoBridge(); return DEFAULT_LOCATIONS; }
      return window.silverSkies.locations.get();
    },
    async add(location: Omit<SavedLocation, "id">) {
      if (!window.silverSkies) { warnNoBridge(); return DEFAULT_LOCATIONS; }
      return window.silverSkies.locations.add(location);
    },
    async remove(id: string) {
      if (!window.silverSkies) { warnNoBridge(); return DEFAULT_LOCATIONS; }
      return window.silverSkies.locations.remove(id);
    },
    async update(id: string, patch: Partial<Omit<SavedLocation, "id">>) {
      if (!window.silverSkies) { warnNoBridge(); return DEFAULT_LOCATIONS; }
      return window.silverSkies.locations.update(id, patch);
    },
    async setActive(id: string | null) {
      if (!window.silverSkies) { warnNoBridge(); return DEFAULT_LOCATIONS; }
      return window.silverSkies.locations.setActive(id);
    },
  },
  config: {
    async get(): Promise<ConfigFile> {
      if (!window.silverSkies) { warnNoBridge(); return DEFAULT_CONFIG; }
      return window.silverSkies.config.get();
    },
    async set(patch: Partial<ConfigFile>) {
      if (!window.silverSkies) { warnNoBridge(); return { ...DEFAULT_CONFIG, ...patch }; }
      return window.silverSkies.config.set(patch);
    },
  },
  app: {
    async getVersion(): Promise<string> {
      if (!window.silverSkies) return "dev";
      return window.silverSkies.app.getVersion();
    },
    async getInfo(): Promise<AppInfo> {
      if (!window.silverSkies) return DEFAULT_APP_INFO;
      return window.silverSkies.app.getInfo();
    },
    async openExternal(url: string): Promise<void> {
      if (!window.silverSkies) { window.open(url, "_blank"); return; }
      return window.silverSkies.app.openExternal(url);
    },
    async setOverlayIcon(dataUrl: string | null, description: string): Promise<void> {
      if (!window.silverSkies) return;
      return window.silverSkies.app.setOverlayIcon(dataUrl, description);
    },
    async notify(title: string, body: string): Promise<void> {
      if (!window.silverSkies) {
        // Browser-preview fallback (outside Electron) — the Notification
        // Web API mirrors Electron's closely enough to reuse the same call
        // sites without an Electron-specific branch here.
        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          new Notification(title, { body });
        }
        return;
      }
      return window.silverSkies.app.notify(title, body);
    },
  },
  updater: {
    async check(): Promise<void> {
      if (!window.silverSkies) { warnNoBridge(); return; }
      return window.silverSkies.updater.check();
    },
    async download(): Promise<void> {
      if (!window.silverSkies) { warnNoBridge(); return; }
      return window.silverSkies.updater.download();
    },
    async install(): Promise<void> {
      if (!window.silverSkies) { warnNoBridge(); return; }
      return window.silverSkies.updater.install();
    },
    async getStatus(): Promise<UpdaterStatus> {
      if (!window.silverSkies) return { state: "unsupported" };
      return window.silverSkies.updater.getStatus();
    },
    onStatus(callback: (status: UpdaterStatus) => void): () => void {
      if (!window.silverSkies) {
        // Browser-preview fallback — updates only ever exist in a packaged
        // Electron build, so there's nothing to subscribe to here.
        callback({ state: "unsupported" });
        return () => {};
      }
      return window.silverSkies.updater.onStatus(callback);
    },
  },
  windows: {
    async openRadar(opts?: {
      instanceId?: string;
      location?: WindowLocation | null;
      isPrimaryPopout?: boolean;
    }): Promise<void> {
      if (!window.silverSkies) { warnNoBridge(); return; }
      return window.silverSkies.windows.openRadar(opts);
    },
    async openConditions(opts: { instanceId: string; location?: WindowLocation | null }): Promise<void> {
      if (!window.silverSkies) { warnNoBridge(); return; }
      return window.silverSkies.windows.openConditions(opts);
    },
    async openAuditLog(opts: {
      instanceId: string;
      location?: WindowLocation | null;
      isPrimaryPopout?: boolean;
    }): Promise<void> {
      if (!window.silverSkies) { warnNoBridge(); return; }
      return window.silverSkies.windows.openAuditLog(opts);
    },
    async openAlert(alert: NormalizedAlert): Promise<void> {
      if (!window.silverSkies) { warnNoBridge(); return; }
      return window.silverSkies.windows.openAlert(alert);
    },
    async getAlertPayload(token: string): Promise<NormalizedAlert | null> {
      if (!window.silverSkies) return null;
      return window.silverSkies.windows.getAlertPayload(token);
    },
    sendInstanceLocation(instanceId: string, location: WindowLocation): void {
      if (!window.silverSkies) return;
      window.silverSkies.windows.sendInstanceLocation(instanceId, location);
    },
    onInstanceLocation(callback: (location: WindowLocation) => void): () => void {
      if (!window.silverSkies) return () => {};
      return window.silverSkies.windows.onInstanceLocation(callback);
    },
    sendInstanceBounds(instanceId: string, bounds: MapViewBounds): void {
      if (!window.silverSkies) return;
      window.silverSkies.windows.sendInstanceBounds(instanceId, bounds);
    },
    onInstanceBounds(callback: (bounds: MapViewBounds) => void): () => void {
      if (!window.silverSkies) return () => {};
      return window.silverSkies.windows.onInstanceBounds(callback);
    },
    async getInstanceBounds(instanceId: string): Promise<MapViewBounds | null> {
      if (!window.silverSkies) return null;
      return window.silverSkies.windows.getInstanceBounds(instanceId);
    },
    onPrimaryRadarClosed(callback: () => void): () => void {
      if (!window.silverSkies) return () => {};
      return window.silverSkies.windows.onPrimaryRadarClosed(callback);
    },
    async isPrimaryRadarOpen(): Promise<boolean> {
      if (!window.silverSkies) return false;
      return window.silverSkies.windows.isPrimaryRadarOpen();
    },
    onPrimaryAuditLogClosed(callback: () => void): () => void {
      if (!window.silverSkies) return () => {};
      return window.silverSkies.windows.onPrimaryAuditLogClosed(callback);
    },
    async isPrimaryAuditLogOpen(): Promise<boolean> {
      if (!window.silverSkies) return false;
      return window.silverSkies.windows.isPrimaryAuditLogOpen();
    },
    async openBrowser(opts: { url: string; title?: string }): Promise<void> {
      if (!window.silverSkies) { warnNoBridge(); return; }
      return window.silverSkies.windows.openBrowser(opts);
    },
  },
  browser: {
    async navigate(url: string): Promise<void> {
      if (!window.silverSkies) return;
      return window.silverSkies.browser.navigate(url);
    },
    async goBack(): Promise<void> {
      if (!window.silverSkies) return;
      return window.silverSkies.browser.goBack();
    },
    async goForward(): Promise<void> {
      if (!window.silverSkies) return;
      return window.silverSkies.browser.goForward();
    },
    async reload(): Promise<void> {
      if (!window.silverSkies) return;
      return window.silverSkies.browser.reload();
    },
    reportChromeHeight(height: number): void {
      if (!window.silverSkies) return;
      window.silverSkies.browser.reportChromeHeight(height);
    },
    onState(callback: (state: BrowserWindowState) => void): () => void {
      if (!window.silverSkies) return () => {};
      return window.silverSkies.browser.onState(callback);
    },
  },
  windowControls: {
    async minimize(): Promise<void> {
      if (!window.silverSkies) return;
      return window.silverSkies.windowControls.minimize();
    },
    async toggleMaximize(): Promise<void> {
      if (!window.silverSkies) return;
      return window.silverSkies.windowControls.toggleMaximize();
    },
    async close(): Promise<void> {
      if (!window.silverSkies) return;
      return window.silverSkies.windowControls.close();
    },
    async isMaximized(): Promise<boolean> {
      if (!window.silverSkies) return false;
      return window.silverSkies.windowControls.isMaximized();
    },
    onMaximizeChanged(callback: (isMaximized: boolean) => void): () => void {
      if (!window.silverSkies) return () => {};
      return window.silverSkies.windowControls.onMaximizeChanged(callback);
    },
  },
};

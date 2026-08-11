import type { ConfigFile, LocationsFile, SavedLocation } from "@/types/settings";
import "@/types/ipc";

const DEFAULT_LOCATIONS: LocationsFile = { savedLocations: [], activeLocationId: null };

const DEFAULT_CONFIG: ConfigFile = {
  provider: "open-meteo",
  accuWeatherApiKey: null,
  libreWxrHost: "https://api.librewxr.net",
  units: "F",
  timeFormat: "12",
  theme: "system",
  autoRefreshMinutes: 30,
  devToolsEnabled: false,
  notificationsEnabled: true,
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
};

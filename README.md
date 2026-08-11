# Silver Skies (Desktop)

Electron + Next.js + Tailwind + shadcn/ui rebuild of the original single-file Silver Skies
weather dashboard: a 3-column layout with saved locations, a live LibreWXR/Leaflet radar map
with alert polygons, a severe-weather "audit log" (NWS + Environment Canada + global WMO/CAP
via LibreWXR), and the original app's forecast/current-conditions sidebar — styled with the same
dark-glass, condition-tinted design system as the source HTML.

## Project layout

- `electron/` — the Electron main process (TypeScript, compiled to `dist-electron/`): window
  creation, IPC handlers, and the local JSON persistence layer (`store.ts`).
- `renderer/` — the Next.js app (App Router, static export via `output: 'export'`), everything
  you see on screen.

Two separate `package.json`/`node_modules` on purpose — `renderer/` is a self-contained Next.js
project; the root `package.json` is the Electron shell that hosts it.

## Local data

Two JSON files live in the OS user-data directory (Windows:
`%APPDATA%\silver-skies-desktop\`):

- `locations.json` — your saved locations + which one is active.
- `config.json` — weather provider choice, your AccuWeather API key (if you use one), units,
  time format, theme, auto-refresh interval, and the LibreWXR radar host.

Both are written atomically (temp file + rename) so a crash mid-write can't corrupt them.

## Weather providers

- **Open-Meteo** (default) — no key required.
- **AccuWeather** — add your own key in Settings. Free-tier keys are capped at 50 calls/day;
  the app caches the resolved AccuWeather location key per saved location to avoid burning
  quota on repeat geoposition lookups.

Severe-weather alerts (NWS, Environment Canada, and LibreWXR's global WMO/CAP feed) are always
fetched independently of whichever weather provider is selected.

## Radar (LibreWXR)

Defaults to the public instance at `https://api.librewxr.net` — no setup required. If you
later self-host LibreWXR (see [librewxr.net](https://librewxr.net)), point Settings →
"LibreWXR Radar Host" at your own server URL instead.

## Development

```bash
npm install                # root (Electron) deps
npm run install:renderer   # renderer (Next.js) deps — deliberately a separate step, not a
                            # postinstall hook, since nesting the two npm processes is what
                            # caused Windows CI to hit file-lock EPERM errors during cleanup
npm run dev                # runs `next dev` and Electron together, with hot reload
```

## Building / packaging

```bash
npm run build               # next build (static export) + compile the Electron main process
npm run pack                 # ...then electron-builder --dir (unpacked, for quick local testing)
npm run dist                  # ...then electron-builder (this platform only, doesn't publish)
npm run dist:publish          # ...then electron-builder --publish always (uploads to a GH Release)
```

Artifacts land in `release/`. electron-builder only ever builds for the OS it's actually running
on (it can't cross-compile a signed/native macOS build from Windows, etc.) — see below for
building all three from CI.

### Code signing

Not configured with a certificate by default. electron-builder picks up code-signing automatically
from environment variables if you set them before running `npm run dist`/`dist:publish` — no
config changes needed either way:
- **Windows**: `CSC_LINK` (path/URL to a .pfx) + `CSC_KEY_PASSWORD`.
- **macOS**: `CSC_LINK` (path/URL to a .p12) + `CSC_KEY_PASSWORD`; add `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD`
  / `APPLE_TEAM_ID` for notarization on top of that.

Unsigned macOS/Linux builds work fine for personal use — macOS will show an "unidentified
developer" Gatekeeper prompt (right-click → Open past it) since it isn't notarized.

### Multi-platform release builds (GitHub Actions)

`.github/workflows/release.yml` builds Windows, macOS, and Linux on their own native runners
(a matrix job — electron-builder can't cross-compile another OS's installer) and publishes every
artifact to a GitHub Release, using electron-builder's own GitHub publish support (no separate
release-creation step needed). To cut a release:

```bash
# bump "version" in package.json first, then:
git tag v1.1.0
git push origin v1.1.0
```

The tag push triggers the workflow (`workflow_dispatch` is also enabled, for re-running a build
without pushing a new tag). It needs no extra secrets — the default `GITHUB_TOKEN` GitHub Actions
provides already has permission to create the release and upload assets (`permissions: contents:
write` in the workflow). Add the code-signing environment variables above as repo/org secrets if
you want signed builds out of that pipeline too.

### Auto-update

`electron-updater` is wired up (`main.ts` calls `checkForUpdatesAndNotify()` on launch, packaged
builds only) and `publish.owner`/`publish.repo` in `package.json` point at this repo — installed
builds will check this repo's GitHub Releases on launch and update themselves once you publish a
release with a higher version than what's installed.

### App icon

`assets/icon-light.png` / `assets/icon-dark.png` — the window/taskbar icon swaps between them
live as the OS theme changes (`electron/main.ts`, via `nativeTheme`), and `icon-dark.png` doubles
as the static icon baked into the installer/exe (`build.win.icon`). The taskbar icon also gets a
small live overlay badge (Windows) showing the current condition's Pixel Weather glyph.

## Notifications

Desktop toast notifications (Settings → Notifications) for:

- **New alerts** — any Severe/Extreme-or-higher alert appearing for a saved location.
- **Notable forecasts** — ≥60% precipitation chance or a hazardous condition in tomorrow's
  forecast.
- **Heads-up severe weather** — a hazardous condition (thunderstorm, heavy rain/snow, ice) showing
  up in the next 12 hours of the hourly forecast, even before an official alert exists.

A background watcher (`hooks/useLocationWatcher.ts`) checks every *saved* location every 10
minutes — not just whichever one is on screen — and de-dupes what it's already notified about in
`localStorage` so the same thing doesn't fire twice. It always queries Open-Meteo for this,
regardless of the provider selected in Settings, so it doesn't eat into an AccuWeather key's
50-calls/day quota.

This watcher deliberately does *not* also drive the full-window severe-alert color pulse — that
stays scoped to whichever location is actually on screen (same as the original app), so switching
to a clean saved location always immediately clears it. An earlier version fed the watcher into
the pulse too, which meant leaving an alerting location for a clean one could still show that
*previous* location's pulse — technically correct (another saved location still had it), but with
nothing on screen indicating why, so it just read as broken.

## Kept from the original app

The alert-demo panel and the "Asteroid Impact Warning" easter egg both made the trip — they live
under Settings → Dev Tools.

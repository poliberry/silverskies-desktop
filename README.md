# Silver Skies

A blazing-fast, terminal-styled radar and weather desktop app, written entirely in Rust.

Silver Skies renders a native GPU window (egui/eframe) with a monospace, boxed, terminal
aesthetic and an embedded `:` command line that drives everything — locations, layout, radar
layers, alerts, theming, and the weather radio. Every panel can be moved between columns, hidden,
or popped out into its own OS window, and you can open as many independent radar windows as you
like.

## Features

- **Global radar** — LibreWXR (RainViewer-compatible) composite radar with past frames + nowcast,
  playback timeline, nine color schemes, storm cells/arrows, satellite infrared, and a dBZ legend.
- **NEXRAD single-site products** (US) — super-res reflectivity, velocity, hydrometeor
  classification, storm-total and 1-hour accumulation via NCEP WMS, with range rings, VCP status
  and live/stale indicators.
- **Alerts everywhere** — NWS (US), Environment Canada, BOM via WillyWeather (AU), SPC mesoscale
  discussions and convective outlooks, and WMO/CAP feeds worldwide via LibreWXR, merged and
  de-duplicated into one audit log.
- **Alert polygons** — zone-based advisories drawn as outlined fills; **storm-based warnings**
  (tornado, severe thunderstorm, flash flood; PDS, emergency and confirmed tiers) drawn as an
  emphasized, pulsing "storm" layer above them.
- **Weather alerts over TTS** — newly arrived alerts for your active (and optionally all saved)
  locations are read aloud with native text-to-speech, preceded by the SAME attention tone, with
  a severity filter and adjustable speech rate. Any alert can be spoken on demand (`:speak`).
- **Weather radio** — simulated NOAA Weather Radio (TTS + tones) or a live NWR stream chosen by
  distance, with real-time SAME header decoding from the audio.
- **Current conditions & 7-day / hourly forecast** (Open-Meteo, no key needed; AccuWeather
  optional), today's outlook, UV, wind barbs from METARs, OpenWeatherMap overlays and AQI.
- **Terminal UI** — movable/hideable/pop-out panels, slot-based layout persisted between runs,
  built-in and custom JSON themes (plus condition-tinted default accent), 12/24h and °F/°C,
  desktop notifications, and command-line completion/history.

## Commands

Press `:` (or `Ctrl+K`) to open the command bar. A few examples:

```
:goto Tucson, AZ          :add                     :units c
:move radar right 0       :hide forecast           :popout audit-log
:radar new                :product velocity        :site kfsx
:layer satellite on       :radar scheme 4          :play
:alerts                   :speak 2                 :radio live
:theme nord-blue          :set tts.enabled true    :help
```

`:help` lists everything; `Tab` completes commands and arguments.

## Building

Requires a stable Rust toolchain (1.80+).

```
cargo run --release -p silverskies
```

On Linux you need the usual egui/cpal/speech-dispatcher system libraries:
`libxkbcommon-dev libwayland-dev libgtk-3-dev libasound2-dev libspeechd-dev`.

## Project layout

```
crates/
  ss-core/      pure domain logic: alert taxonomy & colors, units, WMO codes, themes,
                SAME encoder/decoder, geometry, command grammar  (fully unit tested)
  ss-net/       API clients: NWS, ECCC, LibreWXR, SPC, Open-Meteo, Nominatim, OWM, NCEP, NWR
  ss-store/     config.json / locations.json / session.json, atomic writes, dedupe store
  ss-audio/     tone synthesis, native TTS, live stream player
  ss-map/       slippy-map engine for egui: tile cache, Mercator viewport, raster/WMS/polygon/
                marker/wind-barb layers
  silverskies/  the eframe application: windows, panels, command bar, theming, background runtime
```

## Local data

JSON files live in the OS config directory (Windows: `%APPDATA%\silverskies\Silver Skies\config\`):
`config.json`, `locations.json`, `session.json`, `dedupe.json`. All writes are atomic. Existing
settings from the Electron version (`%APPDATA%\silver-skies-desktop\`) are migrated on first run.

## Data sources

Open-Meteo, api.weather.gov (NWS/SPC/NEXRAD metadata), Environment and Climate Change Canada,
LibreWXR, NOAA NCEP GeoServer, OpenStreetMap/Nominatim, CARTO basemaps, OpenWeatherMap (optional
key), WillyWeather (optional key), noaaweatherradio.org.

<p align="center">
  <img src="logo_icone.png" alt="NavXpressVFR" width="120">
</p>

<h1 align="center">NavXpressVFR</h1>

<p align="center">
  <b>Real-time VFR flight planning and tracking for Microsoft Flight Simulator 2024.</b><br>
  Desktop application (Electron, Windows) · Bilingual FR / EN · GPL-3.0
</p>

---

## Overview

**NavXpressVFR** assists the virtual pilot through every stage of a VFR flight: building the flight
plan on an interactive map, navigation computations (magnetic heading, drift, ground speed, time,
fuel planning), terrain vertical profile, and then **real-time tracking during the flight** via the
**SimConnect** connection to MSFS 2024 — with automatic wind injection, proximity and deviation
audio alerts, and a **Direct To** function.

The app relies on real aeronautical data — airports, runways, frequencies, navaids, airspaces —
extracted **directly from MSFS 2024** via SimConnect, plus **OpenAIP** airspaces and the worldwide
**GLOBE** (NOAA) terrain dataset for the vertical profile.

## Key features

- **Interactive map** (Leaflet) — multiple base layers (satellite / topo / OSM / CARTO), airspace,
  airport and navaid layers, day/night mode, flight plan drawn and colored by leg state, drag-and-drop editing.
- **Points of interest along the route** — load **OpenStreetMap landmarks** (castles, dams, power
  plants, wind farms, viaducts, motorway interchanges, water towers, antennas…) within a **7.5 NM corridor**
  of the flight plan, grouped into toggleable themes, with anti-saturation filtering and clustering; cached with the plan.
- **Flight plan & navigation log** — assisted creation, reporting points, legs with distance,
  track, **magnetic heading**, **ground speed**, time and altitude per leg.
- **Vertical profile** — real terrain elevation + planned altitude along the route.
- **Real-time MSFS tracking** — connection state, automatic wind injection, auto leg switching,
  **audio alerts** (waypoint proximity, deviation, arrival, traffic pattern), pause-state handling.
- **Direct To** — heading, distance and estimated time to any waypoint.
- **Fuel planning** (taxi, trip, reserves, alternate, night VFR) and **tank-switch timer**.
- **MSFS 2024 data extraction** — build the worldwide **airports** and **navaids** databases
  live from your own simulator (see below).
- **Tools** — unit conversions, stopwatch & timer, wind rose, magnetic declination.
- **Import / export** — Little Navmap (`.lnmpln`) flight plans and native `.navxpv` format.

> Exhaustive feature list and mapping to code modules: **[FEATURES.md](FEATURES.md)** (French).

## Data sources

| Data | Source | How |
|---|---|---|
| Airports (runways, frequencies, helipads) | **MSFS 2024** (live SimConnect extraction) | "Import MSFS 2024 Airports" button |
| Navaids — VOR / VOR-DME / DME / TACAN / VORTAC / NDB (worldwide) | **MSFS 2024** (SimConnect airway traversal + bundled seed) | "Import MSFS 2024 Navaids" button |
| Airspaces | **OpenAIP** | API key entered in the app |
| Points of interest (landmarks along the route) | **OpenStreetMap** (Overpass API) | "Load POI" button in the Layers menu |
| Terrain (vertical profile) | **GLOBE** 30″ (NOAA) | "Import elevation data" button (~307 MB) |
| Magnetic declination | **WMM** (`geomagnetism`) | Built-in |

### About navaid extraction
SimConnect cannot *enumerate* navaids worldwide, so — like **Little Navmap** — NavXpressVFR rebuilds
the database by **traversing the airway network** (airports → procedures → airways), then completes
it for *disconnected* navaids using a bundled reference list of identifiers
(`bundled-data/navaids-seed.csv.gz`). Every value (position, frequency, range, magvar…) comes from
**your own MSFS 2024**; the seed is only used as a list of identifiers to query. This yields a
near-worldwide navaid base (~7,500 navaids) with **range** and **elevation**, straight from FS2024.

## Getting started (development)

Requirements: **Node.js**, **Windows**, and **MSFS 2024** (for the real-time and extraction features).

```bash
npm install
npm start
```

## Build (Windows installer)

```bash
npm run dist          # build the NSIS installer locally
npm run publish       # build + publish a GitHub release (enables auto-update)
```
The **NSIS installer** (`NavXpressVFR-<version>-Setup.exe`) is generated in `dist/`. It installs
**per-user** (no admin rights), creates desktop / Start-menu shortcuts, lets the user pick the
install directory, and supports **automatic updates** via **electron-updater** (GitHub releases).

## Configuration

- **OpenAIP key** (airspaces): "Add OpenAIP API" button in the app (test + save).
- **Data imports**: run the MSFS airports / MSFS navaids / elevation imports from the UI
  (MSFS 2024 must be running with a flight loaded for the SimConnect extractions).
  Data is stored under `Documents/NavXpressVFR/`.

## Tech stack

- **Electron** (main process `main.js` + renderer `src/`)
- **Leaflet** (map), **node-simconnect** (MSFS), **geomagnetism** (declination),
  **extract-zip** / **fs-extra** (imports)
- Frontend built as **global-scope `<script>` modules**, organized by feature
  (`src/js/` + `src/js/features/`), orchestrated by `src/ui.js`.

## Credits

The MSFS 2024 navaid extraction method (airway traversal + disconnected-navaid reference list) is
based on the work of **Alexander Barthel (albar965)** —
[atools](https://github.com/albar965/atools) / [Little Navmap](https://github.com/albar965/littlenavmap)
(GPL-3.0). The bundled seed file originates from atools. See **[CREDITS.md](CREDITS.md)** for full
attributions.

## Documentation

- [FEATURES.md](FEATURES.md) — detailed features, architecture and load order (French).
- [CREDITS.md](CREDITS.md) — third-party attributions.

## License

**GPL-3.0-or-later** — see [LICENSE](LICENSE).

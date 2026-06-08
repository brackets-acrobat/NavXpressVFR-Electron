# NavXpressVFR — Features

VFR navigation and real-time tracking software for **Microsoft Flight Simulator 2024**
(Electron app, Windows). Exhaustive feature list, with the corresponding source module(s).
The frontend is split into `src/js/` modules (state/helpers) and `src/js/features/`
(one feature = one file), orchestrated by `src/ui.js`. See
`memory/refactor_ui_modularization.md` for the architecture.

---

## 1. Simulator connection (SimConnect)
- **Clickable** status badge: connect / disconnect from MSFS.
- States: disconnected · disconnected (engine ready) · connecting · connected · failed (not found).
- **Real-time** reception of **aircraft position** and **wind data**.
- Automatic injection of MSFS wind into the fields + wind rose (source "MSFS").
- *Modules:* `src/js/features/sim.js` · `main.js` (`simconnect-*` handlers, `node-simconnect`).

## 2. Interactive map (Leaflet)
- **Multiple switchable base layers**: Satellite (Esri), Topo (OpenTopoMap), OSM, CARTO (Positron / Dark Matter), plus a day/night mode.
- **Layers** (dropdown): Airspaces (**OpenAIP** overlay, key required), Airports, Navaids.
- Airports/navaids shown within the visible area (icons by type, tooltips, click → details modal).
- Flight plan drawing: one segment per leg, **colored by state** (done / active / to do).
- Waypoint markers + **labels** (perpendicular placement, zoom-aware).
- **Drag to split a leg** (insert a turning point by dragging on the map).
- Extensible **context menu** (right-click): Direct To, add visual marker, measure tool, etc.
- **Measure tool**: first point on right-click → "Distance from this point", live blue line to the cursor, finalized on the 2nd left-click. Shows **true / magnetic track / distance NM** at the midpoint. Esc to cancel; "Clear measurement" in the context menu.
- **Visual markers**: right-click → "Add a visual marker" → **name + description** modal. Placed as a **yellow circle (Ø ~10px) with a 2px red outline** (name + description in a hover tooltip). Click a marker → **editable** info modal (edit name/description → "Validate") with **confirmed deletion**. Unlimited count; **saved in the `.navxpv` plan**.
- **Uncertainty circle**: floating button to the left of the Layers menu. On click, displays for **5 seconds** an **anthracite-grey disc (opacity 0.75) of 3 NM** placed randomly, with the **aircraft position guaranteed inside** (center drawn uniformly within a 3 NM disc around the aircraft). Button **disabled** until MSFS is connected with an aircraft position. **5 min cooldown** between draws: an early click shows a 5 s modal with the remaining time (mm:ss). No persistence.
- *Modules:* `src/js/features/map.js` · `src/js/features/map-context-menu.js` · `src/js/features/map-measure.js` · `src/js/features/map-markers.js` · `src/js/features/uncertainty-circle.js` · `src/js/carte-segments.js` · `src/js/waypoint-labels.js`.

## 3. Flight plan creation & editing
- **Create a plan** (Departure/Arrival modal with airport search).
- **Add a reporting point** by identifier/name or by lat/lon coordinates.
- **Insert a turning point** (modal or map drag).
- **Edit a leg** (departure/arrival modal + search) · **Delete a leg** (confirmation).
- Mark a leg **"Done"** · concept of **active leg** · **New** (reset with confirmation).
- **Traffic pattern / touch-and-go** markable on an airport.
- *Modules:* `src/js/features/flightplan-io.js` (create) · `waypoint-modals.js` (insertion/altitude/confirmation)
  · `leg-modals-init.js` + `src/js/modales-legs.js` (edit/delete) · `reset.js` · `src/js/recherche.js` (pattern).

## 4. Plan import / export
- **Import** Little Navmap (`.lnmpln`).
- **Load** / **Save** a native **`.navxpv`** plan.
- *Modules:* `src/js/features/flightplan-io.js` · `main.js` (`ouvrir-dialogue-lnm`, `ouvrir-navxpv`, `sauvegarder-navxpv`).

## 5. Navigation log (legs table)
- Columns: # · From · To · Alt (ft) · Dist (nm) · Track (°) · Heading (°) · GS (kt) · Duration · Done.
- Computations: great-circle distance, true track, **magnetic heading** (declination), **drift + GS** (wind triangle), duration.
- Adjustable **per-leg altitude** (Altitude modal).
- *Modules:* `src/js/nav-log.js` · `src/js/nav-core.js` (`calcLegInfo`) · `waypoint-modals.js` (altitude).

## 6. Vertical profile
- **Terrain (GLOBE elevation)** band + **planned altitude** along the plan; show/hide button; re-rendered on resize.
- *Modules:* `src/js/profil-vertical.js` · `main.js` (`profil-vertical`, GLOBE 30" sampling).

## 7. Magnetic declination
- Computed **at the plan centroid** (`geomagnetism`/WMM module); shown in the header + config field.
- *Modules:* `src/js/declinaison.js` · `main.js` (`calculer-declinaison`).

## 8. Wind & wind rose
- Manual dir/speed entry with **validation** (0–360°, 0–40 kt); wind rose (arrow + panel); manual or MSFS source.
- *Modules:* `src/js/features/validation.js` · `src/js/windrose.js` · `sim.js` (MSFS injection).

## 9. Direct To
- Go directly to a **waypoint of the plan** (MSFS connected + plan required); heading/distance/time modal (auto-close ~10 s); auto-disabled on arrival.
- Go directly to an **off-plan airport** by **ICAO** search: **VFR ≤ 80 NM** limit from the aircraft position (refused beyond); confirmation modal then traffic-pattern/touch-and-go question; same 10 s info window.
- Go directly to a **point designated on the map** (right-click → "Direct To" context menu): same **≤ 80 NM** limit, confirmation modal, **red marker** placed on the target point, 10 s info window.
- In external Direct To mode (airport or point): **XTK** tracking with deviation alert + approach sound on arrival (1.5 NM radius). After arrival, the active leg becomes the **leg following the one left**, and deviation alerts are suspended near the arrival point (hysteresis).
- *Modules:* `src/js/features/direct-to.js` (search/UI/marker) + `src/js/features/map-context-menu.js` (extensible map menu) + `src/js/features/sim.js` (tracking).

## 10. Audio alerts & real-time leg tracking (MSFS)
- Waypoint approach sound (1.5 NM) + **auto switch to the next leg**; final arrival sound.
- **Lateral deviation alert** (> 1.2 NM), reminder every 2 min; **traffic pattern zone** (alerts suspended near a "pattern" airport); touchdown sound. **Bilingual FR/EN** sounds.
- **"< 500 ft AGL" warning**: continuous ground-altitude monitoring via the **`PLANE ALT ABOVE GROUND`** simvar (MSFS), checked on each SimConnect update (~5 s). When the aircraft descends below **500 ft AGL**, plays a bilingual warning sound (`500agl_fr.wav` / `500agl_en.wav`). While below 500 ft, **reminder every 2 min**. **Silenced** within **2 NM of any airport** (`large/medium/small_airport`, heliports excluded). The cooldown **resets as soon as the aircraft climbs back above 500 ft** (each new entry into the low zone triggers an immediate warning).
- *Modules:* `src/js/features/sim.js` · `src/js/features/agl-warning.js` · `src/js/sounds.js` · `main.js` (`PLANE ALT ABOVE GROUND` in `donnees-position`).

## 11. Fuel planning (Fuel Planner)
- Total = taxi (10 min) + trip + regulatory reserve (30 min day / **45 min night VFR**) + alternate + route reserve (10 %) + discretionary reserve. Continuous recompute tied to the plan.
- *Modules:* `src/js/features/fuel.js` · `src/js/nav-core.js`.

## 12. Tank switching (Tank selector)
- Configurable **countdown** (slider + field, minutes); start/stop/reset; **sound** on switch.
- *Modules:* `src/js/features/tank.js` · `src/js/sounds.js`.

## 13. Unit conversions
- Distance · Speed · Temperature · Pressure · Weight · Volume.
- *Module:* `src/js/features/conversions.js`.

## 14. Stopwatch & Timer
- Stopwatch (MM:SS) and Timer (HH:MM:SS) — start/stop/reset.
- *Modules:* `src/js/features/timers.js` · `src/js/stopwatch.js`.

## 15. Aeronautical data & configuration
- **Import MSFS 2024 Airports**: *live* SimConnect extraction (runways, frequencies, helipads), progress + ETA, retry of failures, MSFS-running check.
- **Import MSFS 2024 Navaids**: *live* SimConnect extraction of VOR / VOR-DME / DME / TACAN / VORTAC / NDB by **traversing the airway network** (airports → procedures → airways), completed for *disconnected* navaids via a bundled reference list (`bundled-data/navaids-seed.csv.gz`). Includes **range** and **elevation**. Method inspired by Little Navmap / atools (see `CREDITS.md`).
- **Import GLOBE elevation**: `all10g.zip` (~307 MB, NOAA) → extraction (~1.8 GB); download/extract/flatten phases.
- **OpenAIP API key**: add, **test**, save, replace (airspaces).
- Airport **search** and **multi-search** (airports + navaids) with a results list.
- *Modules:* `src/js/features/imports.js` · `openaip.js` · `src/js/recherche.js` · `main.js` · `extract-airports-msfs.js` · `extract-navaids-msfs.js`.

## 16. Information modals
- **Airport**: general info, runways, helipads, frequencies, comments. **Navaid**: details (type, frequency, range, region, elevation).
- *Module:* `src/js/info-modals.js`.

## 17. UI & cross-cutting
- **Bilingual FR/EN** (toggle button, `localStorage` persistence) · non-blocking toasts · confirmation modals.
- **Electron** desktop app (Windows), **portable** build.
- *Modules:* `src/i18n.js` · `src/js/features/i18n-toggle.js` · `src/js/utils.js` (toasts) · `src/js/globals.js` · `src/ui.js` (orchestrator).

---

## Architecture & load order

**Electron** app: `main.js` (main process — Node, IPC, SimConnect, files) ↔
`src/index.html` (renderer). The renderer loads **classic** `<script>` tags sharing the
**global scope** — **order matters** (see `src/index.html`):

```
Leaflet (CDN)
i18n.js ......................... FR/EN translations

── Foundation: state & helpers (src/js/) ──
globals.js ...................... global state + constants         ⟵ FIRST
nav-core.js ..................... calcLegInfo (nav computations)
utils, info-modals, stopwatch, windrose, recherche, carte-segments,
waypoint-labels, modales-legs, declinaison, nav-log,
profil-vertical ................. (nav-log BEFORE profil-vertical: decorator at parse time)
sounds.js ....................... shared audio player

── Features (src/js/features/): each exposes initXxx() ──
i18n-toggle, openaip, imports, map, sim, flightplan-io, fuel,
validation, direct-to, map-measure, map-context-menu, timers,
reset, leg-modals-init, tank, conversions, waypoint-modals

── Orchestrator ──
ui.js ........................... DOMContentLoaded → calls the init*() in order  ⟵ LAST
```

**Inter-module communication**: global variables (`globals.js`) + **`window.*` bridges**:
`window.appliquerEtatSim` (sim) · `window.demanderDirectToPoint` / `window._supprimerMarqueurPointDt` (direct-to) ·
`window.demarrerMesure` / `effacerMesure` / `aUneMesure` (map-measure) ·
`window._refreshAirports` / `_refreshNavaids` / `_refreshLayersDropdown` (map) ·
`window.ouvrirModaleAltitude` (waypoint-modals) · `window._editLegIndex` / `_deleteLegCallback`.

**Critical constraint**: in `ui.js`, **`initFuel()` BEFORE `initDirectTo()`** — decorator chain
on `mettreAJourLogDeNav` (the vertical-profile decorator installing at parse time).

**Backend (`main.js`)**: SimConnect (`node-simconnect`), declination (`geomagnetism`), GLOBE
terrain (sampling), imports (MSFS airports via `extract-airports-msfs.js`, MSFS navaids via
`extract-navaids-msfs.js`, NOAA elevation), file I/O (`.lnmpln` / `.navxpv`), OpenAIP key handling.

```
NavXpressVFR/
├─ main.js                  Electron main process (IPC, SimConnect, files)
├─ preload.js               secure renderer ↔ main bridge (window.api)
├─ extract-airports-msfs.js live MSFS 2024 airport extraction
├─ extract-navaids-msfs.js  live MSFS 2024 navaid extraction (airway traversal + seed)
├─ bundled-data/            navaids-seed.csv.gz (disconnected-navaid reference list)
├─ src/
│  ├─ index.html            UI + <script> order
│  ├─ styles.css
│  ├─ i18n.js               FR/EN translations
│  ├─ ui.js                 orchestrator (DOMContentLoaded)
│  └─ js/
│     ├─ globals.js, nav-core.js, sounds.js, …   (state & helpers)
│     └─ features/          one feature = one file (initXxx)
└─ package.json             scripts (start / dist) + electron-builder config
```

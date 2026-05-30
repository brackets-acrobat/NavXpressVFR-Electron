# NavXpressVFR — Fonctionnalités

Logiciel de navigation VFR et de suivi temps réel pour **Microsoft Flight Simulator 2024**
(application Electron, Windows). Liste exhaustive des fonctionnalités, avec le(s) module(s)
source correspondant(s). Le frontend est découpé en modules `src/js/` (état/helpers) et
`src/js/features/` (une fonctionnalité = un fichier), orchestrés par `src/ui.js`. Voir
`memory/refactor_ui_modularization.md` pour l'architecture.

---

## 1. Connexion au simulateur MSFS (SimConnect)
- Badge d'état **cliquable** : connexion / déconnexion de MSFS.
- États : déconnecté · déconnecté (moteur prêt) · connexion · connecté · échec (introuvable).
- Réception **temps réel** de la **position avion** et des **données de vent**.
- Injection automatique du vent MSFS dans les champs + rose des vents (source « MSFS »).
- *Modules :* `src/js/features/sim.js` · `main.js` (handlers `simconnect-*`, `node-simconnect`).

## 2. Carte interactive (Leaflet)
- **3 fonds de carte** commutables : Satellite (Esri), Topo (OpenTopoMap), OSM.
- **Calques** (menu déroulant) : Espaces aériens (overlay **OpenAIP**, clé requise), Aéroports, Navaids.
- Aéroports/navaids affichés dans la zone visible (icônes par type, tooltips, clic → modale détails).
- Tracé du plan de vol : un segment par leg, **coloré selon l'état** (fait / actif / à faire).
- Marqueurs de waypoints + **étiquettes** (placement perpendiculaire, gestion du zoom).
- **Drag pour scinder un leg** (insérer un point tournant en glissant sur la carte).
- **Menu contextuel** (clic droit) extensible : Direct To, outil de mesure, etc.
- **Outil de mesure** : 1er point sur clic droit → « Distance à partir de ce point », tracé bleu en temps réel jusqu'au curseur, finalisé au 2e clic gauche. Affiche **route vraie / magnétique / distance NM** au milieu du tracé. Échap pour annuler ; « Effacer la mesure » dans le menu contextuel.
- *Modules :* `src/js/features/map.js` · `src/js/features/map-context-menu.js` · `src/js/features/map-measure.js` · `src/js/carte-segments.js` · `src/js/waypoint-labels.js`.

## 3. Création & édition du plan de vol
- **Créer un plan** (modale Départ/Arrivée avec recherche d'aéroport).
- **Ajouter un point de report** par identifiant/nom ou par coordonnées lat/lon.
- **Insérer un point tournant** (modale ou drag carte).
- **Éditer un leg** (modale départ/arrivée + recherche) · **Supprimer un leg** (confirmation).
- Cocher un leg **« Fait »** · notion de **leg actif** · **Nouveau** (reset avec confirmation).
- **Tour de piste / toucher** (« pattern ») marquable sur un aéroport.
- *Modules :* `src/js/features/flightplan-io.js` (créer) · `waypoint-modals.js` (insertion/altitude/confirmation)
  · `leg-modals-init.js` + `src/js/modales-legs.js` (édition/suppression) · `reset.js` · `src/js/recherche.js` (pattern).

## 4. Import / Export de plans
- **Importer** Little Navmap (`.lnmpln`).
- **Charger** / **Sauvegarder** un plan natif **`.navxpv`**.
- *Modules :* `src/js/features/flightplan-io.js` · `main.js` (`ouvrir-dialogue-lnm`, `ouvrir-navxpv`, `sauvegarder-navxpv`).

## 5. Log de navigation (tableau des legs)
- Colonnes : N° · Depuis · Vers · Alt (ft) · Dist (nm) · Route (°) · Cap (°) · GS (kt) · Durée · Fait.
- Calculs : distance grand-cercle, route vraie, **cap magnétique** (déclinaison), **dérive + GS** (triangle des vitesses), durée.
- **Altitude par leg** réglable (modale Altitude).
- *Modules :* `src/js/nav-log.js` · `src/js/nav-core.js` (`calcLegInfo`) · `waypoint-modals.js` (altitude).

## 6. Profil vertical
- Bandeau **relief (terrain GLOBE)** + **altitude prévue** le long du plan ; bouton afficher/masquer ; re-rendu au resize.
- *Modules :* `src/js/profil-vertical.js` · `main.js` (`profil-vertical`, échantillonnage GLOBE 30").

## 7. Déclinaison magnétique
- Calcul **au centroïde** du plan (module `geomagnetism`/WMM) ; affichage titre + champ config.
- *Modules :* `src/js/declinaison.js` · `main.js` (`calculer-declinaison`).

## 8. Vent & rose des vents
- Saisie manuelle dir/vitesse avec **validation** (0–360°, 0–40 kt) ; rose des vents (flèche + panneau) ; source manuelle ou MSFS.
- *Modules :* `src/js/features/validation.js` · `src/js/windrose.js` · `sim.js` (injection MSFS).

## 9. Direct To
- Aller directement vers un **waypoint du plan** (MSFS connecté + plan requis) ; modale cap/distance/temps (auto-close ~10 s) ; désactivation auto à l'arrivée.
- Aller directement vers un **aéroport hors plan** par recherche **ICAO** : limite **VFR ≤ 80 NM** depuis la position avion (refus au-delà) ; modale de confirmation puis question tour de piste/toucher ; même fenêtre info 10 s.
- Aller directement vers un **point désigné sur la carte** (clic droit → menu contextuel « Direct To ») : même limite **≤ 80 NM**, modale de confirmation, **marqueur rouge** posé sur le point cible, fenêtre info 10 s.
- En mode Direct To externe (aéroport ou point) : tracking **XTK** avec alerte de déviation + son d'approche à l'arrivée (rayon 1,5 NM). Après arrivée, le leg actif redevient le **leg qui suit celui quitté**, et les alertes de déviation sont suspendues à proximité du point d'arrivée (hystérésis).
- *Modules :* `src/js/features/direct-to.js` (recherche/UI/marqueur) + `src/js/features/map-context-menu.js` (menu carte extensible) + `src/js/features/sim.js` (tracking).

## 10. Alertes sonores & suivi de leg temps réel (MSFS)
- Son d'approche waypoint (1,5 NM) + **passage auto au leg suivant** ; son d'arrivée finale.
- **Alerte de déviation latérale** (> 1,2 NM), rappel toutes les 2 min ; **zone tour de piste** (alertes suspendues près d'un aéroport « pattern ») ; son de toucher. Sons **bilingues FR/EN**.
- *Modules :* `src/js/features/sim.js` · `src/js/sounds.js`.

## 11. Emport carburant (Fuel Planner)
- Total = roulage (taxi 10 min) + trip + réserve réglementaire (30 min jour / **45 min VFR nuit**) + dégagement + réserve de route (10 %) + réserve discrétionnaire. Recalcul continu lié au plan.
- *Modules :* `src/js/features/fuel.js` · `src/js/nav-core.js`.

## 12. Changement de réservoir (Tank selector)
- **Compte à rebours** configurable (slider + champ, minutes) ; démarrer/arrêter/reset ; **son** au changement.
- *Modules :* `src/js/features/tank.js` · `src/js/sounds.js`.

## 13. Conversions d'unités
- Distance · Vitesse · Température · Pression · Poids · Volume.
- *Module :* `src/js/features/conversions.js`.

## 14. Chronomètre & Timer
- Chronomètre (MM:SS) et Timer (HH:MM:SS) — démarrer/arrêter/reset.
- *Modules :* `src/js/features/timers.js` · `src/js/stopwatch.js`.

## 15. Données aéronautiques & configuration
- **Import aéroports MSFS 2024** : extraction *live* via SimConnect (pistes, fréquences, hélipads), progression + ETA, reprise des échecs, vérification MSFS lancé.
- **Import OurAirports** : téléchargement + base locale (aéroports & navaids), progression.
- **Import élévation GLOBE** : `all10g.zip` (~307 Mo, NOAA) → extraction (~1,8 Go) ; phases download/extract/flatten.
- **Clé API OpenAIP** : ajout, **test**, sauvegarde, remplacement (espaces aériens).
- **Recherche** aéroport et **recherche multi** (aéroports + navaids) avec liste de résultats.
- *Modules :* `src/js/features/imports.js` · `openaip.js` · `src/js/recherche.js` · `main.js` · `extract-airports-msfs.js`.

## 16. Modales d'information
- **Aéroport** : infos générales, pistes, hélipads, fréquences, commentaires. **Navaid** : détails.
- *Module :* `src/js/info-modals.js`.

## 17. Interface & transverses
- **Bilingue FR/EN** (bouton bascule, persistance `localStorage`) · toasts non-bloquants · modales de confirmation.
- Application **Electron** desktop (Windows), build **portable**.
- *Modules :* `src/i18n.js` · `src/js/features/i18n-toggle.js` · `src/js/utils.js` (toasts) · `src/js/globals.js` · `src/ui.js` (orchestrateur).

---

## Architecture & ordre de chargement

Application **Electron** : `main.js` (processus principal — Node, IPC, SimConnect, fichiers) ↔
`src/index.html` (renderer). Le renderer charge des `<script>` **classiques** partageant le
**scope global** — **l'ordre compte** (voir `src/index.html`) :

```
Leaflet (CDN)
i18n.js ......................... traductions FR/EN

── Socle : état & helpers (src/js/) ──
globals.js ...................... état global + constantes        ⟵ EN PREMIER
nav-core.js ..................... calcLegInfo (calculs de nav)
utils, info-modals, stopwatch, windrose, recherche, carte-segments,
waypoint-labels, modales-legs, declinaison, nav-log,
profil-vertical ................. (nav-log AVANT profil-vertical : décorateur au parsing)
sounds.js ....................... lecteur audio partagé

── Fonctionnalités (src/js/features/) : chacune expose initXxx() ──
i18n-toggle, openaip, imports, map, sim, flightplan-io, fuel,
validation, direct-to, map-measure, map-context-menu, timers,
reset, leg-modals-init, tank, conversions, waypoint-modals

── Orchestrateur ──
ui.js ........................... DOMContentLoaded → appelle les init*() dans l'ordre  ⟵ EN DERNIER
```

**Communication inter-modules** : variables globales (`globals.js`) + **ponts `window.*`** :
`window.appliquerEtatSim` (sim) · `window.demanderDirectToPoint` / `window._supprimerMarqueurPointDt` (direct-to) ·
`window.demarrerMesure` / `effacerMesure` / `aUneMesure` (map-measure) ·
`window._refreshAirports` / `_refreshNavaids` / `_refreshLayersDropdown` (map) ·
`window.ouvrirModaleAltitude` (waypoint-modals) · `window._editLegIndex` / `_deleteLegCallback`.

**Contrainte critique** : dans `ui.js`, **`initFuel()` AVANT `initDirectTo()`** — chaîne de
décorateurs sur `mettreAJourLogDeNav` (le décorateur du profil vertical s'installant au parsing).

**Backend (`main.js`)** : SimConnect (`node-simconnect`), déclinaison (`geomagnetism`), relief
GLOBE (échantillonnage), imports (OurAirports, MSFS via `extract-airports-msfs.js`, élévation
NOAA), I/O fichiers (`.lnmpln` / `.navxpv`), gestion de la clé OpenAIP.

```
NavXpressVFR/
├─ main.js                  processus principal Electron (IPC, SimConnect, fichiers)
├─ preload.js               pont sécurisé renderer ↔ main (window.api)
├─ extract-airports-msfs.js extraction live des aéroports MSFS 2024
├─ src/
│  ├─ index.html            UI + ordre des <script>
│  ├─ styles.css
│  ├─ i18n.js               traductions FR/EN
│  ├─ ui.js                 orchestrateur (DOMContentLoaded)
│  └─ js/
│     ├─ globals.js, nav-core.js, sounds.js, …   (état & helpers)
│     └─ features/          une fonctionnalité = un fichier (initXxx)
└─ package.json             scripts (start / dist) + config electron-builder
```

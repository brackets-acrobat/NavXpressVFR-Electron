<p align="center">
  <img src="logo_icone.png" alt="NavXpressVFR" width="120">
</p>

<h1 align="center">NavXpressVFR</h1>

<p align="center">
  <b>Préparation et suivi de navigation VFR en temps réel pour Microsoft Flight Simulator 2024.</b><br>
  Application de bureau (Electron, Windows) · Bilingue 🇫🇷 / 🇬🇧
</p>

---

## ✈️ Présentation

**NavXpressVFR** assiste le pilote virtuel à chaque étape d'un vol VFR : construction du plan de
vol sur une carte interactive, calculs de navigation (cap magnétique, dérive, vitesse sol, temps,
emport carburant), profil vertical du relief, puis **suivi en temps réel pendant le vol** grâce à
la connexion **SimConnect** à MSFS 2024 — avec injection automatique du vent, alertes sonores de
proximité et de déviation, et fonction **Direct To**.

L'application s'appuie sur de vraies données aéronautiques (aéroports, pistes, fréquences, navaids,
espaces aériens) issues de **MSFS 2024**, **OurAirports** et **OpenAIP**, et sur le relief mondial
**GLOBE** (NOAA) pour le profil vertical.

## ✨ Fonctionnalités clés

- 🗺️ **Carte interactive** (Leaflet) — 3 fonds (satellite / topo / OSM), calques espaces aériens,
  aéroports et navaids, tracé du plan coloré par état de leg, édition par glisser-déposer.
- 🧭 **Plan de vol & log de navigation** — création assistée, points de report, legs avec
  distance, route, **cap magnétique**, **GS**, durée et altitude par leg.
- ⛰️ **Profil vertical** — relief réel + altitude prévue le long de la route.
- 📡 **Suivi temps réel MSFS** — état de connexion, vent injecté automatiquement, passage de leg
  auto, **alertes sonores** (proximité waypoint, déviation, arrivée, tour de piste).
- 🎯 **Direct To** — cap, distance et temps estimé vers n'importe quel waypoint.
- ⛽ **Emport carburant** (roulage, trip, réserves, dégagement, VFR de nuit) et 🛢️ **minuteur de
  changement de réservoir**.
- 🔧 **Outils** — conversions d'unités, chronomètre & timer, rose des vents, déclinaison magnétique.
- 📥 **Import / export** — plans Little Navmap (`.lnmpln`) et format natif `.navxpv`.

> 📋 **Liste exhaustive + correspondance avec les modules du code : [FEATURES.md](FEATURES.md).**

## 🛰️ Sources de données

| Donnée | Source | Mise en place |
|---|---|---|
| Aéroports (pistes, fréquences, hélipads) | **MSFS 2024** (extraction live SimConnect) | Bouton « Importer Aéroports MSFS 2024 » |
| Aéroports & navaids (base mondiale) | **OurAirports** | Bouton « Importer données OurAirports » |
| Espaces aériens | **OpenAIP** | Clé API à renseigner dans l'app |
| Relief (profil vertical) | **GLOBE** 30″ (NOAA) | Bouton « Importer données d'élévation » (~307 Mo) |
| Déclinaison magnétique | **WMM** (`geomagnetism`) | Intégré |

## 🚀 Démarrage (développement)

Prérequis : **Node.js**, **Windows**, et **MSFS 2024** (pour les fonctions temps réel).

```bash
npm install
npm start
```

## 📦 Build (exécutable portable Windows)

```bash
npm run dist          # ou : npm run dist:portable
```
Le binaire portable est généré dans `dist/`.

## ⚙️ Configuration

- **Clé OpenAIP** (espaces aériens) : bouton « 🔑 Ajouter API OpenAIP » dans l'app (test + sauvegarde).
- **Imports de données** : lancer les imports MSFS / OurAirports / élévation depuis l'interface.
  Les données sont stockées sous `Documents/NavXpressVFR/`.

## 🧱 Pile technique

- **Electron** (processus principal `main.js` + renderer `src/`)
- **Leaflet** (carte), **node-simconnect** (MSFS), **geomagnetism** (déclinaison),
  **extract-zip** / **fs-extra** (imports)
- Frontend en **modules `<script>` à scope global**, organisés par fonctionnalité
  (`src/js/` + `src/js/features/`), orchestrés par `src/ui.js`.

## 📚 Documentation

- [FEATURES.md](FEATURES.md) — fonctionnalités détaillées, architecture et ordre de chargement.

## 📄 Licence

ISC.

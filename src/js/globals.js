/*
 * NavXpressVFR — Logiciel de navigation VFR pour Microsoft Flight Simulator
 * Copyright (C) 2026 NavXpressVFR
 *
 * This program is free software: you can redistribute it and/or modify it under
 * the terms of the GNU General Public License as published by the Free Software
 * Foundation, either version 3 of the License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT ANY
 * WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A
 * PARTICULAR PURPOSE. See the GNU General Public License for more details.
 * You should have received a copy of the GNU General Public License along with
 * this program. If not, see <https://www.gnu.org/licenses/>.
 */

// ============================================================
// NavXpressVFR — globals.js
// État global partagé + constantes  (extrait de ui.js — Phase 1)
// DOIT être chargé en PREMIER (toutes les autres dépendent de cet état).
// ============================================================

// Clé API OpenAIP — chargée depuis le fichier de configuration au démarrage
let OPENAIP_API_KEY = '';

let flightPlan = [];
let legAltitudes = []; // Altitude par leg (index 1-based : legAltitudes[i] = altitude du leg i)
let map;
let segmentsCarte = []; // Un L.polyline par leg (remplace flightPathLine unique)
let marqueursCarte = []; // Marqueurs waypoints (cercles orange)
let declinaisonMoyenneGlobale = 0.0;
let activeLegIndex = 1; // Le leg actif (1-based, correspond au numéro affiché)
let insertLegIndex = 0; // Index d'insertion du point tournant (position dans flightPlan)

// --- État Direct To ---
let _directToActive = false;
let _directToOrigin = null;       // {lat, lon} = position avion au moment de l'activation
let _directToTargetIndex = null;  // index dans flightPlan du waypoint cible
let _lastAircraftPos = null;      // {lat, lon} : dernière position avion reçue de MSFS

// --- État Direct To vers aéroport HORS plan (recherche ICAO) ---
// Mutuellement exclusif avec _directToActive (un seul Direct To à la fois).
let _directToExternalActive = false;
let _directToExternalTarget = null;   // { lat, lon, code, name, pattern }
let _directToReturnLegIndex = null;   // activeLegIndex au moment de l'activation
                                      // → après arrivée : activeLegIndex = _directToReturnLegIndex + 1

// Mémoire du DERNIER aéroport d'arrivée Direct To externe (après bascule sur le plan).
// Sert à suspendre les alertes de déviation tant que l'avion reste à proximité,
// sinon le nouveau leg du plan calculerait un gros XTD et déclencherait l'alerte
// alors qu'on vient juste de se poser/tourner autour de l'aéroport visité.
// Libéré automatiquement par hystérésis (cf. sim.js) quand l'avion s'éloigne.
let _extDtLastArrival = null;         // { lat, lon, pattern }

// Marqueur Leaflet rouge pour le Direct To vers un POINT carte (clic droit).
// Réinitialisé par direct-to.js (à l'activation d'un nouveau DT, ou à l'arrivée).
let _directToPointMarker = null;

// --- Repères visuels (clic droit → "Ajouter un repère visuel") ---
// Cercles jaunes à contour rouge posés librement sur la carte, sauvegardés
// dans le plan .navxpv. Chaque entrée : { name, description, lat, lon, marker }
// où marker est le L.circleMarker Leaflet (non sérialisé).
// Géré par map-markers.js ; lu par flightplan-io.js (save) ; vidé par reset.js.
let reperesVisuels = [];

// --- Flanquements VOR (clic droit sur un VOR → "Flanquement VOR") ---
// Radiaux tracés depuis un VOR vers un point du plan (point tournant) ou un
// repère visuel, avec étiquette « R-090° / 12.3 NM ». Sauvegardés dans le plan
// .navxpv. Chaque entrée : { vorIdent, vorLat, vorLon, targetName, targetKind,
// lat, lon, radialMag, distNM, line, label } où line/label sont les objets
// Leaflet (non sérialisés ; radialMag/distNM recalculés au chargement).
// Géré par flanquement.js ; lu par flightplan-io.js (save) ; vidé par reset.js.
let flanquements = [];

// --- Points remarquables OSM (chargés via Overpass le long de la route) ---
// Cercles jaunes à point noir central, posés automatiquement à ≤ 5 NM de la
// route. Chaque entrée : { lat, lon, name, theme, typeKey, _outer, _dot } où
// _outer/_dot sont les L.circleMarker Leaflet (non sérialisés). Cache « par
// plan » : sérialisés dans le .navxpv (flightplan-io.js, save/load), donc
// reconsultables hors-ligne. Géré par poi-overpass.js ; vidé par reset.js.
let poisRemarquables = [];

// État connexion simulateur (hissé en Phase 2 — Lot C ; lu par sim, Direct To, toggle i18n)
let _simState = 'disconnected';   // disconnected | connecting | connected

// --- Coordonnées copiées depuis la carte (clic droit → "Coordonnées du point") ---
// { lat, lon } en décimal signé, ou null si rien n'est copié.
// Posé par la modale "Coordonnées du point" (icône Copier), consommé UNE SEULE
// FOIS par "Insérer un point tournant" ou "Éditer le leg" (bouton Coller) puis
// remis à null. Tant que c'est null, les boutons Coller restent cachés.
// Géré par map-coords.js.
let coordsCopiees = null;

const ALT_MIN = 500;
const ALT_MAX = 15000;
const ALT_DEFAULT = 3000;
const ALT_STEP = 500;


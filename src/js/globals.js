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
let _directToLayer = null;        // L.polyline magenta dashed sur la carte
let _lastAircraftPos = null;      // {lat, lon} : dernière position avion reçue de MSFS

// État connexion simulateur (hissé en Phase 2 — Lot C ; lu par sim, Direct To, toggle i18n)
let _simState = 'disconnected';   // disconnected | connecting | connected

const ALT_MIN = 500;
const ALT_MAX = 15000;
const ALT_DEFAULT = 3000;
const ALT_STEP = 500;


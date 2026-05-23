// ============================================================
// NavXpressVFR — Système de traductions bilingue FR / EN
// ============================================================

const TRANSLATIONS = {
  fr: {
    // Header
    simDisconnected:        "MSFS Déconnecté",
    simDisconnectedEngine:  "MSFS Déconnecté (Moteur Prêt)",

    // Config section
    flightConfig:           "Configuration du Vol",
    icaoDep:                "ICAO Départ",
    icaoArr:                "ICAO Arrivée",
    icaoPlaceholderDep:     "LFQM",
    icaoPlaceholderArr:     "LFBD",
    trueAirspeed:           "Vp Appareil (kt)",
    declMag:                "Décl. Mag. (°)",
    windDir:                "Direction Vent (°)",
    windSpeed:              "Vitesse Vent (kt)",

    // Validations
    alertWindTooStrong:     "⚠️ Le vent est trop fort pour un vol VFR ! (max 40 kt)",
    alertWindDirInvalid:    "La direction du vent doit être comprise entre 1° et 359°.",
    alertVpInvalid:         "La vitesse propre doit être comprise entre 40 et 250 kt.",
    alertIcaoInvalid:       "Le code ICAO ne peut contenir que des lettres et des chiffres (8 caractères max).",

    // Waypoint section
    addWaypoint:            "Ajouter un Point de Report",
    waypointId:             "Identifiant / Nom",
    waypointIdPlaceholder:  "Ex: LFQM, Dijon...",
    latitude:               "Latitude",
    longitude:              "Longitude",
    btnInsert:              "Insérer au Flight Plan",

    // Action bar
    btnNew:                 "✨ Nouveau",
    btnImport:              "📂 Importer LNMPLN",
    btnSave:                "💾 Sauvegarder",

    // Nav log table
    navLog:                 "Log de Navigation (Legs)",
    colLeg:                 "N° leg",
    colFrom:                "Depuis",
    colTo:                  "Vers",
    colAlt:                 "Alt (ft)",
    colDist:                "Dist (nm)",
    colRoute:               "Route",
    colHeading:             "Cap (°)",
    colGs:                  "GS (kt)",
    colDuration:            "Durée",
    colDone:                "Fait",
    emptyPlan:              "Aucun point dans le plan de vol",
    departure:              "DÉPART",

    // Alerts & confirms
    confirmReset:           "Voulez-vous vraiment réinitialiser le plan de vol actuel ?",
    noWaypointsInFile:      "Aucun waypoint trouvé dans ce fichier .lnmpln",
    parseError:             "Erreur lors de l'analyse du fichier Little Navmap : ",
    fillFields:             "Veuillez remplir correctement les champs.",
    nothingToSave:          "Rien à sauvegarder, le plan de vol est vide.",
    saveSuccess:            "Plan de vol sauvegardé avec succès !",
    importCancelled:        "Importation annulée ou fichier vide.",

    // Map popups
    mapPopupCoords:         "Coords",

    // Déclinaison
    declEast:               "E",
    declWest:               "O",
  },

  en: {
    // Header
    simDisconnected:        "MSFS Disconnected",
    simDisconnectedEngine:  "MSFS Disconnected (Engine Ready)",

    // Config section
    flightConfig:           "Flight Configuration",
    icaoDep:                "Departure ICAO",
    icaoArr:                "Arrival ICAO",
    icaoPlaceholderDep:     "KLAX",
    icaoPlaceholderArr:     "KJFK",
    trueAirspeed:           "TAS (kt)",
    declMag:                "Mag. Decl. (°)",
    windDir:                "Wind Direction (°)",
    windSpeed:              "Wind Speed (kt)",

    // Validations
    alertWindTooStrong:     "⚠️ Wind is too strong for VFR flight! (max 40 kt)",
    alertWindDirInvalid:    "Wind direction must be between 1° and 359°.",
    alertVpInvalid:         "True airspeed must be between 40 and 250 kt.",
    alertIcaoInvalid:       "ICAO code can only contain letters and digits (8 chars max).",

    // Waypoint section
    addWaypoint:            "Add Reporting Point",
    waypointId:             "Identifier / Name",
    waypointIdPlaceholder:  "E.g: LFQM, Dijon...",
    latitude:               "Latitude",
    longitude:              "Longitude",
    btnInsert:              "Insert into Flight Plan",

    // Action bar
    btnNew:                 "✨ New",
    btnImport:              "📂 Import LNMPLN",
    btnSave:                "💾 Save",

    // Nav log table
    navLog:                 "Navigation Log (Legs)",
    colLeg:                 "Leg #",
    colFrom:                "From",
    colTo:                  "To",
    colAlt:                 "Alt (ft)",
    colDist:                "Dist (nm)",
    colRoute:               "Track",
    colHeading:             "Hdg (°)",
    colGs:                  "GS (kt)",
    colDuration:            "Duration",
    colDone:                "Done",
    emptyPlan:              "No waypoints in flight plan",
    departure:              "DEPARTURE",

    // Alerts & confirms
    confirmReset:           "Are you sure you want to reset the current flight plan?",
    noWaypointsInFile:      "No waypoints found in this .lnmpln file.",
    parseError:             "Error parsing the Little Navmap file: ",
    fillFields:             "Please fill in all fields correctly.",
    nothingToSave:          "Nothing to save, the flight plan is empty.",
    saveSuccess:            "Flight plan saved successfully!",
    importCancelled:        "Import cancelled or empty file.",

    // Map popups
    mapPopupCoords:         "Coords",

    // Déclinaison
    declEast:               "E",
    declWest:               "W",
  }
};

// Langue active (initialisée depuis le localStorage si dispo, sinon FR par défaut)
let currentLang = (typeof localStorage !== 'undefined' && localStorage.getItem('navxpress-lang')) || 'fr';

/**
 * Retourne la traduction d'une clé pour la langue active
 * @param {string} key - Clé de traduction
 * @returns {string}
 */
function t(key) {
  return TRANSLATIONS[currentLang][key] ?? TRANSLATIONS['fr'][key] ?? key;
}

/**
 * Change la langue active et met à jour tout le DOM
 * @param {'fr'|'en'} lang
 */
function setLanguage(lang) {
  if (!TRANSLATIONS[lang]) return;
  currentLang = lang;
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('navxpress-lang', lang);
  }
  applyTranslations();
  updateToggleButton();
}

/**
 * Applique toutes les traductions sur les éléments du DOM via data-i18n
 * Supporte : textContent (data-i18n), placeholder (data-i18n-placeholder)
 */
function applyTranslations() {
  // Textes simples
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    el.textContent = t(key);
  });

  // Placeholders
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    el.placeholder = t(key);
  });

  // Titres / tooltips (title attribute)
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.getAttribute('data-i18n-title');
    el.title = t(key);
  });
}

/**
 * Met à jour l'apparence du bouton toggle FR/EN
 */
function updateToggleButton() {
  const btn = document.getElementById('btn-lang-toggle');
  if (!btn) return;
  btn.setAttribute('data-active-lang', currentLang);
  const frSpan = btn.querySelector('.lang-fr');
  const enSpan = btn.querySelector('.lang-en');
  if (frSpan) frSpan.classList.toggle('lang-active', currentLang === 'fr');
  if (enSpan) enSpan.classList.toggle('lang-active', currentLang === 'en');
}

/**
 * Initialise le système i18n : applique la langue courante au chargement
 */
function initI18n() {
  applyTranslations();
  updateToggleButton();
}

// ============================================================
// NavXpressVFR — Système de traductions bilingue FR / EN
// ============================================================

const TRANSLATIONS = {
  fr: {
    // Header
    simDisconnected: "MSFS Déconnecté",
    simDisconnectedEngine: "MSFS Déconnecté (Moteur Prêt)",

    // Config section
    flightConfig: "Configuration du Vol",
    icaoDep: "ICAO Dép.",
    icaoArr: "ICAO Arr.",
    icaoPlaceholderDep: "LFQM",
    icaoPlaceholderArr: "LFBD",
    trueAirspeed: "Vp (kt)",
    declMag: "Décl. Mag. (°)",
    windDir: "Dir. Vent (°)",
    windSpeed: "Vit. Vent (kt)",

    // Validations
    alertWindTooStrong: "⚠️ Le vent est trop fort pour un vol VFR ! La vitesse doit être comprise entre 0 et 40 kt.",
    alertWindNegative: "La vitesse du vent ne peut pas être négative. Elle doit être comprise entre 0 et 40 kt.",
    alertWindDirInvalid: "La direction du vent doit être comprise entre 0° et 360°.",
    alertVpInvalid: "La vitesse propre doit être comprise entre 40 et 250 kt.",
    alertIcaoInvalid: "Le code ICAO ne peut contenir que des lettres et des chiffres (8 caractères max).",

    // Waypoint section
    addWaypoint: "Ajouter un Point de Report",
    waypointId: "Identifiant / Nom",
    waypointIdPlaceholder: "Ex: LFQM, Dijon...",
    latitude: "Latitude",
    longitude: "Longitude",
    btnInsert: "Insérer au Flight Plan",

    // Action bar
    btnNew: "✨ Nouveau",
    btnImport: "📂 Importer LNMPLN",
    btnSave: "💾 Sauvegarder",

    // Nav log table
    navLog: "Log de Navigation (Legs)",
    colLeg: "N° leg",
    colFrom: "Depuis",
    colTo: "Vers",
    colAlt: "Alt (ft)",
    colDist: "Dist (nm)",
    colRoute: "Route",
    colHeading: "Cap (°)",
    colGs: "GS (kt)",
    colDuration: "Durée",
    colDone: "Fait",
    emptyPlan: "Aucun point dans le plan de vol",
    departure: "DÉPART",

    // Alerts & confirms
    confirmReset: "Voulez-vous vraiment réinitialiser le plan de vol actuel ?",
    noWaypointsInFile: "Aucun waypoint trouvé dans ce fichier .lnmpln",
    parseError: "Erreur lors de l'analyse du fichier Little Navmap : ",
    fillFields: "Veuillez remplir correctement les champs.",
    nothingToSave: "Rien à sauvegarder, le plan de vol est vide.",
    saveSuccess: "Plan de vol sauvegardé avec succès !",
    importCancelled: "Importation annulée ou fichier vide.",

    // Map popups
    mapPopupCoords: "Coords",

    // Déclinaison
    declEast: "E",
    declWest: "O",

    // Modale Insérer point tournant
    insertWpTitle: "Insérer un point tournant",

    // Modale Créer plan de vol
    btnCreate: "🗺️ Créer plan de vol",
    createFlightTitle: "Créer un plan de vol",
    createFlightDep: "🛫 Départ",
    createFlightArr: "🛬 Arrivée",
    btnSearch: "Rechercher",
    btnCancel: "Annuler",
    btnValidate: "Valider",
  },

  en: {
    // Header
    simDisconnected: "MSFS Disconnected",
    simDisconnectedEngine: "MSFS Disconnected (Engine Ready)",

    // Config section
    flightConfig: "Flight Configuration",
    icaoDep: "Dep. ICAO",
    icaoArr: "Arr. ICAO",
    icaoPlaceholderDep: "KLAX",
    icaoPlaceholderArr: "KJFK",
    trueAirspeed: "TAS (kt)",
    declMag: "Mag. Decl. (°)",
    windDir: "Wind Dir. (°)",
    windSpeed: "Wind Spd (kt)",

    // Validations
    alertWindTooStrong: "⚠️ Wind is too strong for VFR flight! Speed must be between 0 and 40 kt.",
    alertWindNegative: "Wind speed cannot be negative. It must be between 0 and 40 kt.",
    alertWindDirInvalid: "Wind direction must be between 0° and 360°.",
    alertVpInvalid: "True airspeed must be between 40 and 250 kt.",
    alertIcaoInvalid: "ICAO code can only contain letters and digits (8 chars max).",

    // Waypoint section
    addWaypoint: "Add waypoint",
    waypointId: "Identifier / Name",
    waypointIdPlaceholder: "E.g: LFQM, Dijon...",
    latitude: "Latitude",
    longitude: "Longitude",
    btnInsert: "Insert into Flight Plan",

    // Action bar
    btnNew: "✨ New",
    btnImport: "📂 Import LNMPLN",
    btnSave: "💾 Save",

    // Nav log table
    navLog: "Navigation Log (Legs)",
    colLeg: "Leg #",
    colFrom: "From",
    colTo: "To",
    colAlt: "Alt (ft)",
    colDist: "Dist (nm)",
    colRoute: "Track",
    colHeading: "Hdg (°)",
    colGs: "GS (kt)",
    colDuration: "Duration",
    colDone: "Done",
    emptyPlan: "No waypoints in flight plan",
    departure: "DEPARTURE",

    // Alerts & confirms
    confirmReset: "Are you sure you want to reset the current flight plan?",
    noWaypointsInFile: "No waypoints found in this .lnmpln file.",
    parseError: "Error parsing the Little Navmap file: ",
    fillFields: "Please fill in all fields correctly.",
    nothingToSave: "Nothing to save, the flight plan is empty.",
    saveSuccess: "Flight plan saved successfully!",
    importCancelled: "Import cancelled or empty file.",

    // Map popups
    mapPopupCoords: "Coords",

    // Déclinaison
    declEast: "E",
    declWest: "W",

    // Insert turning point modal
    insertWpTitle: "Insert a waypoint",

    // Create flight plan modal
    btnCreate: "🗺️ Create flight plan",
    createFlightTitle: "Create a flight plan",
    createFlightDep: "🛫 Departure",
    createFlightArr: "🛬 Arrival",
    btnSearch: "Search",
    btnCancel: "Cancel",
    btnValidate: "Validate",
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

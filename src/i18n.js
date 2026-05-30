// ============================================================
// NavXpressVFR — Système de traductions bilingue FR / EN
// ============================================================

const TRANSLATIONS = {
  fr: {
    // Header
    simDisconnected: "MSFS Déconnecté",
    simDisconnectedEngine: "MSFS Déconnecté (Moteur Prêt)",
    simDisconnectedClick: "🔌 MSFS Déconnecté",
    simConnecting: "⏳ Connexion à MSFS…",
    simConnected: "🟢 MSFS Connecté",
    simConnectFailed: "❌ Échec — MSFS introuvable",
    simClickToConnect: "Cliquer pour se connecter à MSFS",
    simClickToDisconnect: "Cliquer pour se déconnecter",

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
    btnLoadFlight: "📥 Charger plan de vol",
    btnImport: "📂 Importer LNMPLN",
    btnSave: "💾 Sauvegarder",
    navxpvParseError: "Erreur lors de la lecture du fichier .navxpv : ",
    navxpvBadFormat: "Format de fichier invalide : ce n'est pas un fichier NavXpressVFR.",

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
    vertProfileTitle: "Profil vertical",
    vertProfileEmpty: "Créez un plan de vol pour afficher le profil vertical.",
    vertProfileNoData: "Relief indisponible (données GLOBE introuvables dans Documents/NavXpressVFR/elevation).",
    vertProfileTerrain: "Relief",
    vertProfilePlanned: "Alt. prévue",
    profileToggleTooltip: "Afficher / Masquer le profil vertical",
    departure: "DÉPART",

    // Alerts & confirms
    confirmResetTitle: "Nouveau plan de vol",
    confirmReset: "Voulez-vous vraiment réinitialiser le plan de vol actuel ?",
    editLegTitle: "Éditer le leg",
    editLegDep: "🛫 Point de départ",
    editLegArr: "🛬 Point d'arrivée",
    editLegSubtitle: (n) => `Leg n°${n}`,
    deleteLegTitle: "Supprimer le leg",
    deleteLegConfirm: "Supprimer",
    deleteLegMsg: (from, to) => `Supprimer le leg ${from} → ${to} ?`,
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
    btnSelectChoice: "Sélectionner",
    btnCancel: "Annuler",
    btnValidate: "Valider",

    // Modale API OpenAIP
    btnApiOpenAIP: "🔑 Ajouter API OpenAIP",
    apiModalTitle: "Clé API OpenAIP",
    apiModalLabel: "Clé API",
    apiModalPlaceholder: "Collez votre clé API ici",
    apiModalMaskedHint: "Une clé est déjà enregistrée. Saisissez une nouvelle clé pour la remplacer.",
    btnTestKey: "Tester la clé",
    apiTestOk: "✅ Clé valide !",
    apiTestFail: "❌ Clé invalide ou erreur réseau.",
    apiTestLoading: "⏳ Test en cours...",
    apiSaveSuccess: "✅ Clé sauvegardée avec succès.",
    apiSaveError: "❌ Erreur lors de la sauvegarde.",
    apiEmptyKey: "Veuillez saisir une clé API.",
    apiConfirmOverwriteTitle: "Remplacer la clé API ?",
    apiConfirmOverwriteMsg: "Une clé OpenAIP est déjà enregistrée. Voulez-vous la remplacer par la nouvelle clé ?",
    apiConfirmOverwriteBtn: "Remplacer",
    apiKeyMissing: "⚠️ Clé API OpenAIP non configurée",
    searchSearching: "Recherche...",
    searchNotFound: "Aéroport non trouvé",
    searchCoordsNotFound: "Coordonnées introuvables",
    searchNetworkError: "Erreur réseau",

    // Import Aéroports MSFS 2024
    btnImportMsfs: "🛫 Importer Aéroports MSFS 2024",
    btnImportElevation: "⛰️ Importer données d'élévation",
    elevConfirmTitle: "Re-télécharger les données ?",
    elevConfirmMsg: "Les données d'élévation semblent déjà installées (~1,8 Go). Re-télécharger l'archive (~307 Mo) et remplacer les fichiers existants ?",
    elevConfirmBtn: "Re-télécharger",
    elevProgressTitle: "Import données d'élévation",
    elevPhaseStarting: "Préparation…",
    elevPhaseDownloading: "Téléchargement de all10g.zip…",
    elevPhaseExtracting: "Extraction des tuiles (~1,8 Go)…",
    elevPhaseFlattening: "Organisation des fichiers…",
    elevProgressDone: "✅ Données d'élévation installées.",
    elevProgressDoneDir: (dir) => `Dossier : ${dir}`,
    elevProgressError: "❌ Échec de l'import",
    msfsConfirmTitle: "Avez-vous lancé MSFS 2024 ?",
    msfsConfirmMsg: "L'extraction lit la base de données de Microsoft Flight Simulator 2024 en direct. MSFS 2024 doit être lancé, avec un vol en cours, avant de continuer.",
    btnMsfsCheck: "Vérifier MSFS 2024",
    msfsCheckChecking: "⏳ Vérification de MSFS 2024…",
    msfsCheckRunning: (app) => `✅ MSFS 2024 détecté (${app}).`,
    msfsCheckNotRunning: "❌ MSFS 2024 ne répond pas. Lancez le simulateur avec un vol en cours, puis réessayez.",
    msfsProgressTitle: "Extraction aéroports MSFS 2024",
    msfsPhaseConnecting: "Connexion au simulateur…",
    msfsPhaseEnumerate: (n) => `Énumération des aéroports… (${n})`,
    msfsPhaseDetail: "Extraction des détails (pistes, fréquences, hélipads)…",
    msfsPhaseRetry: "Reprise des aéroports en échec…",
    msfsProgressStats: (rate, eta) => `${rate}/s · temps restant estimé ${eta}`,
    msfsProgressOkFailed: (ok, failed) => `${ok} OK · ${failed} échec(s)`,
    msfsExtractDone: (n) => `✅ Extraction terminée : ${n} aéroports enregistrés. La base MSFS 2024 est active.`,
    msfsExtractEmpty: "⚠️ Aucun aéroport extrait. Vérifiez que MSFS 2024 tourne avec un vol en cours.",
    msfsExtractError: (msg) => `❌ Extraction échouée : ${msg}`,

    // Import données OurAirports
    btnImportOurAirports: "🌐 Importer données OurAirports",
    btnClose: "Fermer",
    oaConfirmOverwriteTitle: "Remplacer les données ?",
    oaConfirmOverwriteMsg: "Des données OurAirports sont déjà présentes. Voulez-vous les remplacer par la dernière version disponible ?",
    oaConfirmOverwriteBtn: "Remplacer",
    oaProgressTitle: "Import OurAirports",
    oaProgressSubtitle: "Téléchargement des données aéronautiques…",
    oaProgressDownloading: (name) => `⏳ Téléchargement de ${name}…`,
    oaProgressFileOk: (name, count) => `✅ ${name} — ${count.toLocaleString('fr-FR')} entrées`,
    oaProgressFileError: (name) => `❌ ${name} — échec`,
    oaProgressDone: (ok, total) => `Terminé : ${ok}/${total} fichiers importés.`,
    oaProgressDoneDir: (dir) => `Fichiers JSON enregistrés dans :\n${dir}`,
    oaDataMissing: "⚠️ Cliquez d'abord sur 'Importer données OurAirports'",

    // Rose des vents
    windPanelTitle: "Vent",
    windPanelDir: "Direction",
    windPanelSpeed: "Vitesse",
    windPanelSourceManual: "Saisie manuelle",
    windPanelSourceMSFS: "Depuis MSFS",

    // Modale détails aéroport
    apInfoGeneral: "Informations générales",
    apInfoRunways: "Pistes",
    apInfoHelipads: "Hélipads",
    apInfoFrequencies: "Fréquences",
    apInfoComments: "Commentaires",

    // Modale détails navaid
    navaidInfoTitle: "Informations Navaid",

    // Tour de piste (pattern)
    patternModalTitle: "Tour de piste / Toucher",
    patternModalQuestion: "Effectuer un tour de piste / toucher à",
    patternTooltip: "Tour de piste / Toucher prévu",
    patternCheckLabel: "Tour de piste prévu",
    btnYes: "Oui",
    btnNo: "Non",

    // Emport carburant
    fuelBtnTooltip: "Emport carburant",
    tankBtnTooltip: "Changement de réservoir",
    tankModalTitle: "Changement de réservoir",
    tankSliderLabel: "Durée avant changement (minutes)",
    tankTimerLabel: "Compte à rebours",
    fuelBoxTitle: "Emport Carburant",
    fuelConso: "Consommation croisière (USG/h)",
    fuelNight: "VFR de nuit",
    fuelDistAlt: "Dist. aéroport dég. (NM)",
    fuelReserve: "Réserve discrétionnaire (USG)",
    fuelTotal: "Emport total",

    // Conversions
    convBtnTooltip: "Conversions d'unités",
    convTitle: "Conversions d'unités",
    convDistance: "Distance",
    convSpeed: "Vitesse",
    convTemperature: "Température",
    convPressure: "Pression",
    convWeight: "Poids",
    convVolume: "Volume",

    // Direct To
    dtBtnLabel: "Direct to",
    dtBtnTooltipDisabled: "Direct To — MSFS doit être connecté et un plan chargé",
    dtBtnTooltip: "Direct To — Aller directement vers un waypoint",
    dtModalTitle: "Direct To",
    dtModalHint: "Sélectionnez un waypoint cible :",
    dtNoWaypoint: "Aucun waypoint sélectionné",
    dtInfoHeading: "Cap magnétique",
    dtInfoDistance: "Distance",
    dtInfoTime: "Temps estimé",
    dtInfoTitleFmt: (name) => `Vers ${name}`,
    // Direct To — recherche aéroport hors plan
    dtAirportSectionTitle: "Aéroport hors plan (ICAO)",
    dtAirportPlaceholder: "ex: LFLY",
    dtBtnSearchAirport: "Rechercher",
    dtOrSeparator: "— ou —",
    dtAirportNoIcao: "Saisir un code ICAO",
    dtAirportNoPos: "Position avion inconnue — MSFS non connecté ?",
    dtAirportNotFound: "Aéroport non trouvé",
    dtAirportTooFarFmt: (dist) => `Trop loin pour un vol VFR : ${dist} NM > 80 NM`,
    dtAirportFoundFmt: (code, name, dist) => `${code} — ${name} — ${dist} NM`,
    dtAirportConfirmTitle: "Confirmer Direct To",
    dtAirportConfirmTextFmt: (code, dist) => `Direct To vers ${code} — ${dist} NM. Confirmer ?`,
    // Menu contextuel carte + Direct To vers point carte
    mapCtxDirectTo: "Direct To",
    mapCtxMeasureFrom: "Distance à partir de ce point",
    mapCtxMeasureClear: "Effacer la mesure",
    dtPointName: "Point sur la carte",
    dtPointConfirmTextFmt: (dist) => `Effectuer un Direct To sur ce point (${dist} NM) ?`,
    // Repères visuels (clic droit → ajouter un repère)
    mapCtxAddMarker: "Ajouter un repère visuel",
    repereAddTitle: "Ajouter un repère visuel",
    repereNameLabel: "Nom du repère",
    repereNamePlaceholder: "ex: Château d'eau",
    repereDescLabel: "Description",
    repereDescPlaceholder: "Description du repère visuel",
    repereNameRequired: "Veuillez saisir un nom.",
    btnAdd: "Ajouter",
    repereInfoKicker: "Repère visuel",
    repereDeleteBtn: "Supprimer",
    repereDeleteConfirmTitle: "Supprimer le repère",
    repereDeleteConfirmText: "Supprimer ce repère visuel ?",

    // Chronomètre / Timer
    chronoLabel: "Chronomètre",
    timerLabel: "Timer",
    chronoStart: "Démarrer",
    chronoStop: "Arrêter",
    chronoReset: "Remise à zéro",
  },

  en: {
    // Header
    simDisconnected: "MSFS Disconnected",
    simDisconnectedEngine: "MSFS Disconnected (Engine Ready)",
    simDisconnectedClick: "🔌 MSFS Disconnected",
    simConnecting: "⏳ Connecting to MSFS…",
    simConnected: "🟢 MSFS Connected",
    simConnectFailed: "❌ Failed — MSFS not found",
    simClickToConnect: "Click to connect to MSFS",
    simClickToDisconnect: "Click to disconnect",

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
    btnLoadFlight: "📥 Load flight plan",
    btnImport: "📂 Import LNMPLN",
    btnSave: "💾 Save",
    navxpvParseError: "Error reading .navxpv file: ",
    navxpvBadFormat: "Invalid file format: not a NavXpressVFR file.",

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
    vertProfileTitle: "Vertical profile",
    vertProfileEmpty: "Create a flight plan to display the vertical profile.",
    vertProfileNoData: "Terrain unavailable (GLOBE data not found in Documents/NavXpressVFR/elevation).",
    vertProfileTerrain: "Terrain",
    vertProfilePlanned: "Planned alt.",
    profileToggleTooltip: "Show / Hide the vertical profile",
    departure: "DEPARTURE",

    // Alerts & confirms
    confirmResetTitle: "New flight plan",
    confirmReset: "Are you sure you want to reset the current flight plan?",
    editLegTitle: "Edit leg",
    editLegDep: "🛫 Departure point",
    editLegArr: "🛬 Arrival point",
    editLegSubtitle: (n) => `Leg #${n}`,
    deleteLegTitle: "Delete leg",
    deleteLegConfirm: "Delete",
    deleteLegMsg: (from, to) => `Delete leg ${from} → ${to}?`,
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
    btnSelectChoice: "Select",
    btnCancel: "Cancel",
    btnValidate: "Validate",

    // OpenAIP API modal
    btnApiOpenAIP: "🔑 Add OpenAIP API",
    apiModalTitle: "OpenAIP API Key",
    apiModalLabel: "API Key",
    apiModalPlaceholder: "Paste your API key here",
    apiModalMaskedHint: "A key is already saved. Enter a new key to replace it.",
    btnTestKey: "Test key",
    apiTestOk: "✅ Key is valid!",
    apiTestFail: "❌ Invalid key or network error.",
    apiTestLoading: "⏳ Testing...",
    apiSaveSuccess: "✅ Key saved successfully.",
    apiSaveError: "❌ Error while saving.",
    apiEmptyKey: "Please enter an API key.",
    apiConfirmOverwriteTitle: "Replace API key?",
    apiConfirmOverwriteMsg: "An OpenAIP key is already saved. Do you want to replace it with the new key?",
    apiConfirmOverwriteBtn: "Replace",
    apiKeyMissing: "⚠️ OpenAIP API key not configured",
    searchSearching: "Searching...",
    searchNotFound: "Airport not found",
    searchCoordsNotFound: "Coordinates not found",
    searchNetworkError: "Network error",

    // MSFS 2024 airports import
    btnImportMsfs: "🛫 Import MSFS 2024 Airports",
    btnImportElevation: "⛰️ Import elevation data",
    elevConfirmTitle: "Re-download the data?",
    elevConfirmMsg: "Elevation data appears to be already installed (~1.8 GB). Re-download the archive (~307 MB) and replace the existing files?",
    elevConfirmBtn: "Re-download",
    elevProgressTitle: "Elevation data import",
    elevPhaseStarting: "Preparing…",
    elevPhaseDownloading: "Downloading all10g.zip…",
    elevPhaseExtracting: "Extracting tiles (~1.8 GB)…",
    elevPhaseFlattening: "Organizing files…",
    elevProgressDone: "✅ Elevation data installed.",
    elevProgressDoneDir: (dir) => `Folder: ${dir}`,
    elevProgressError: "❌ Import failed",
    msfsConfirmTitle: "Have you launched MSFS 2024?",
    msfsConfirmMsg: "The extraction reads the Microsoft Flight Simulator 2024 database live. MSFS 2024 must be running, with a flight loaded, before continuing.",
    btnMsfsCheck: "Check MSFS 2024",
    msfsCheckChecking: "⏳ Checking MSFS 2024…",
    msfsCheckRunning: (app) => `✅ MSFS 2024 detected (${app}).`,
    msfsCheckNotRunning: "❌ MSFS 2024 is not responding. Launch the simulator with a flight loaded, then try again.",
    msfsProgressTitle: "MSFS 2024 airports extraction",
    msfsPhaseConnecting: "Connecting to the simulator…",
    msfsPhaseEnumerate: (n) => `Enumerating airports… (${n})`,
    msfsPhaseDetail: "Extracting details (runways, frequencies, helipads)…",
    msfsPhaseRetry: "Retrying failed airports…",
    msfsProgressStats: (rate, eta) => `${rate}/s · est. time remaining ${eta}`,
    msfsProgressOkFailed: (ok, failed) => `${ok} OK · ${failed} failed`,
    msfsExtractDone: (n) => `✅ Extraction complete: ${n} airports saved. The MSFS 2024 database is now active.`,
    msfsExtractEmpty: "⚠️ No airport extracted. Make sure MSFS 2024 is running with a flight loaded.",
    msfsExtractError: (msg) => `❌ Extraction failed: ${msg}`,

    // OurAirports data import
    btnImportOurAirports: "🌐 Import OurAirports data",
    btnClose: "Close",
    oaConfirmOverwriteTitle: "Replace data?",
    oaConfirmOverwriteMsg: "OurAirports data is already present. Do you want to replace it with the latest available version?",
    oaConfirmOverwriteBtn: "Replace",
    oaProgressTitle: "OurAirports import",
    oaProgressSubtitle: "Downloading aeronautical data…",
    oaProgressDownloading: (name) => `⏳ Downloading ${name}…`,
    oaProgressFileOk: (name, count) => `✅ ${name} — ${count.toLocaleString('en-US')} entries`,
    oaProgressFileError: (name) => `❌ ${name} — failed`,
    oaProgressDone: (ok, total) => `Done: ${ok}/${total} files imported.`,
    oaProgressDoneDir: (dir) => `JSON files saved in:\n${dir}`,
    oaDataMissing: "⚠️ Click 'Import OurAirports data' first",

    // Wind rose
    windPanelTitle: "Wind",
    windPanelDir: "Direction",
    windPanelSpeed: "Speed",
    windPanelSourceManual: "Manual input",
    windPanelSourceMSFS: "From MSFS",

    // Airport info modal
    apInfoGeneral: "General information",
    apInfoRunways: "Runways",
    apInfoHelipads: "Helipads",
    apInfoFrequencies: "Frequencies",
    apInfoComments: "Comments",

    // Navaid info modal
    navaidInfoTitle: "Navaid information",

    // Pattern / Touch and go
    patternModalTitle: "Pattern / Touch and Go",
    patternModalQuestion: "Will you perform a pattern / touch and go at",
    patternTooltip: "Pattern / Touch and go planned",
    patternCheckLabel: "Pattern planned",
    btnYes: "Yes",
    btnNo: "No",

    // Fuel quantity
    fuelBtnTooltip: "Fuel Planner",
    tankBtnTooltip: "Tank selector",
    tankModalTitle: "Tank Selector",
    tankSliderLabel: "Time before switch (minutes)",
    tankTimerLabel: "Countdown",
    fuelBoxTitle: "Fuel Planner",
    fuelConso: "Cruise fuel flow (USG/h)",
    fuelNight: "Night VFR",
    fuelDistAlt: "Alternate airport dist. (NM)",
    fuelReserve: "Discretionary reserve (USG)",
    fuelTotal: "Total fuel",

    // Conversions
    convBtnTooltip: "Unit conversions",
    convTitle: "Unit conversions",
    convDistance: "Distance",
    convSpeed: "Speed",
    convTemperature: "Temperature",
    convPressure: "Pressure",
    convWeight: "Weight",
    convVolume: "Volume",

    // Direct To
    dtBtnLabel: "Direct to",
    dtBtnTooltipDisabled: "Direct To — MSFS must be connected and a flight plan loaded",
    dtBtnTooltip: "Direct To — Fly directly to a waypoint",
    dtModalTitle: "Direct To",
    dtModalHint: "Select a target waypoint:",
    dtNoWaypoint: "No waypoint selected",
    dtInfoHeading: "Magnetic heading",
    dtInfoDistance: "Distance",
    dtInfoTime: "Estimated time",
    dtInfoTitleFmt: (name) => `To ${name}`,
    // Direct To — off-plan airport search
    dtAirportSectionTitle: "Off-plan airport (ICAO)",
    dtAirportPlaceholder: "e.g. LFLY",
    dtBtnSearchAirport: "Search",
    dtOrSeparator: "— or —",
    dtAirportNoIcao: "Enter an ICAO code",
    dtAirportNoPos: "Aircraft position unknown — MSFS not connected?",
    dtAirportNotFound: "Airport not found",
    dtAirportTooFarFmt: (dist) => `Too far for VFR: ${dist} NM > 80 NM`,
    dtAirportFoundFmt: (code, name, dist) => `${code} — ${name} — ${dist} NM`,
    dtAirportConfirmTitle: "Confirm Direct To",
    dtAirportConfirmTextFmt: (code, dist) => `Direct To ${code} — ${dist} NM. Confirm?`,
    // Map context menu + Direct To to map point
    mapCtxDirectTo: "Direct To",
    mapCtxMeasureFrom: "Distance from this point",
    mapCtxMeasureClear: "Clear measurement",
    dtPointName: "Map point",
    dtPointConfirmTextFmt: (dist) => `Direct To this point (${dist} NM)?`,
    // Visual markers (right-click → add a marker)
    mapCtxAddMarker: "Add a visual marker",
    repereAddTitle: "Add a visual marker",
    repereNameLabel: "Marker name",
    repereNamePlaceholder: "e.g. Water tower",
    repereDescLabel: "Description",
    repereDescPlaceholder: "Visual marker description",
    repereNameRequired: "Please enter a name.",
    btnAdd: "Add",
    repereInfoKicker: "Visual marker",
    repereDeleteBtn: "Delete",
    repereDeleteConfirmTitle: "Delete marker",
    repereDeleteConfirmText: "Delete this visual marker?",

    // Stopwatch / Timer
    chronoLabel: "Stopwatch",
    timerLabel: "Timer",
    chronoStart: "Start",
    chronoStop: "Stop",
    chronoReset: "Reset",
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

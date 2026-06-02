// ============================================================
// NavXpressVFR — ui.js  (version bilingue FR/EN)
// ORCHESTRATEUR : appelle les init*() des modules dans l'ordre.
// Toute la logique vit dans src/js/ (état/helpers) et src/js/features/
// (une fonctionnalité = un fichier). Voir l'ordre des <script> dans index.html.
// L'ordre des appels ci-dessous est significatif (notamment initFuel avant
// initDirectTo : chaîne de décorateurs sur mettreAJourLogDeNav).
// ============================================================

document.addEventListener('DOMContentLoaded', async () => {
  console.log("UI NavXpressVFR chargée et prête.");

  await chargerCleOpenAIP();

  // Charge window.appOptions depuis disque (defaults appliqués par options.js).
  // DOIT être awaité avant initAglWarning() — celui-ci lit aglWarningEnabled.
  await chargerOptions();

  initOpenAIP();

  initImports();

  initTimers();

  // --- Initialisation du système i18n ---
  initI18n();

  initI18nToggle();

  initMap();

  initReset();

  initLegModals();

  initFlightPlanIO();

  initValidation();
  initSim();

  // Avertissement audio « < 500 ft AGL » : s'abonne à onDonneesPosition.
  // Indépendant des autres features (pas d'UI, pas de carte).
  initAglWarning();

  initFuel();

  initTank();

  initConversions();

  // Bouton ⚙️ Options du header + modale (vide pour l'instant).
  initOptions();

  // Bouton 📖 Carnet de vol (à droite de la boîte chronomètre).
  initLogbook();

  initDirectTo();

  // initMapMeasure expose window.demarrerMesure / effacerMesure / aUneMesure
  // (utilisées par les items du menu contextuel).
  initMapMeasure();

  // initMapMarkers expose window.demanderAjoutRepere / chargerReperesVisuels /
  // effacerTousReperesVisuels (menu contextuel + flightplan-io + reset).
  initMapMarkers();

  // Cercle d'incertitude : bouton flottant carte (3 NM gris anthracite, 5 s).
  // Doit être appelé APRÈS initMap (le bouton est un contrôle Leaflet).
  initUncertaintyCircle();

  // Bouton 🔍 « Rechercher » en bas à gauche de la carte. Doit être appelé
  // APRÈS initMap (contrôle Leaflet) — utilise window.api.rechercheModale.
  initMapSearch();

  // "Coordonnées du point" : expose window.ouvrirModaleCoordsPoint (utilisé par
  // le menu contextuel) et window.rafraichirBoutonsCollage (boutons Coller des
  // modales Insérer / Éditer le leg). Doit être appelé AVANT initMapContextMenu.
  initMapCoords();

  // Doit être appelé APRÈS initMap (carte présente), initDirectTo (expose
  // window.demanderDirectToPoint), initMapMeasure (fonctions de mesure),
  // initMapMarkers (window.demanderAjoutRepere) et initMapCoords
  // (window.ouvrirModaleCoordsPoint) — toutes utilisées par le menu.
  initMapContextMenu();

  initWaypointModals();

  // Pont carnet de vol : décore mettreAJourLogDeNav (doit donc être appelé
  // APRÈS initDirectTo qui pose lui aussi un décorateur — chaîne préservée),
  // écoute les events 'logbook-direct-to', pousse logbookEnabled à main.
  // Lit window.appOptions (chargerOptions() awaité plus haut) au démarrage.
  initLogbookBridge();

  // Évaluation de précision du vol : s'abonne à onDonneesPosition / onLandingResult /
  // onLogbookState et expose window.precision.finalize (appelé par logbook.js à la
  // confirmation de fin de vol). Sous-fonction du carnet de vol (logbook ON requis).
  // Lit window.appOptions.precisionEnabled au décollage.
  initPrecision();

});

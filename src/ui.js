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

  // Doit être appelé APRÈS initMap (carte présente), initDirectTo (expose
  // window.demanderDirectToPoint), initMapMeasure (fonctions de mesure) et
  // initMapMarkers (window.demanderAjoutRepere) — toutes utilisées par le menu.
  initMapContextMenu();

  initWaypointModals();

});

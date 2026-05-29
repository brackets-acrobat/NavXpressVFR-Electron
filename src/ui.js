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

  initFuel();

  initTank();

  initConversions();

  initDirectTo();

  initWaypointModals();

});

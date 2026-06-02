// ============================================================
// NavXpressVFR — i18n-toggle.js
// Bouton bascule FR / EN.
// Extrait de ui.js (Phase 2 — Lot C).
// Utilise window.appliquerEtatSim (sim), window._refreshAirports/_refreshLayersDropdown (map).
// ============================================================

function initI18nToggle() {
  // --- Bouton toggle FR / EN ---
  const btnLang = document.getElementById('btn-lang-toggle');
  if (btnLang) {
    btnLang.addEventListener('click', () => {
      const newLang = currentLang === 'fr' ? 'en' : 'fr';
      setLanguage(newLang);
      // Redessiner le tableau (les en-têtes sont gérés par applyTranslations,
      // mais les lignes dynamiques doivent être regénérées)
      mettreAJourLogDeNav();
      // Mettre à jour le badge de statut simulateur (réapplique le texte dans la nouvelle langue)
      window.appliquerEtatSim(_simState);
      // Mettre à jour la déclinaison dans le titre
      actualiserAffichageDeclinaison();
      // Régénérer le dropdown des calques (libellés des toggles)
      if (typeof window._refreshLayersDropdown === 'function') window._refreshLayersDropdown();
      // Rafraîchir le libellé du bouton « Cercle d'incertitude »
      if (typeof window._refreshUncertaintyBtn === 'function') window._refreshUncertaintyBtn();
      // Rafraîchir le tooltip du bouton loupe « Rechercher »
      if (typeof window._refreshMapSearchBtn === 'function') window._refreshMapSearchBtn();
      // Régénérer les tooltips aéroports (langue dans "Piste / Runway")
      if (typeof window._refreshAirports === 'function') window._refreshAirports();
    });
  }
}

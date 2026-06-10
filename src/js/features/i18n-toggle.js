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
      // Rafraîchir le tooltip du badge de pause (état dans la nouvelle langue)
      if (typeof window._refreshSimPauseBadge === 'function') window._refreshSimPauseBadge();
      // Régénérer les tooltips aéroports (langue dans "Piste / Runway")
      if (typeof window._refreshAirports === 'function') window._refreshAirports();
      // Régénérer les tooltips des points remarquables (type traduit)
      if (typeof window._refreshPoiTooltips === 'function') window._refreshPoiTooltips();
    });
  }
}

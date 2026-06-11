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
// NavXpressVFR — leg-modals-init.js
// Listeners modales suppression / édition de leg
// Extrait de ui.js (Phase 2 — Lot A). Appelé par l'orchestrateur ui.js.
// ============================================================

function initLegModals() {
  // --- Modale : confirmation suppression leg — listeners (scope DOMContentLoaded) ---
  document.getElementById('btn-confirm-delete-ok').addEventListener('click', () => {
    document.getElementById('confirm-delete-overlay').style.display = 'none';
    if (window._deleteLegCallback) { window._deleteLegCallback(); window._deleteLegCallback = null; }
  });

  document.getElementById('btn-confirm-delete-cancel').addEventListener('click', () => {
    document.getElementById('confirm-delete-overlay').style.display = 'none';
    window._deleteLegCallback = null;
  });

  document.getElementById('confirm-delete-overlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('confirm-delete-overlay')) {
      document.getElementById('confirm-delete-overlay').style.display = 'none';
      window._deleteLegCallback = null;
    }
  });

  // --- Modale : édition leg — listeners ---
  window._editLegIndex = null;

  // Helper : ferme la modale Édit leg + nettoie les états de recherche
  function fermerModaleEditLeg() {
    document.getElementById('edit-leg-overlay').style.display = 'none';
    // Invalider toute recherche en cours et vider les résultats
    ['search-results-edit-dep', 'search-results-edit-arr'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el._searchReqId = (el._searchReqId || 0) + 1; // invalide les réponses pendantes
        el.innerHTML = '';
        el.classList.remove('visible');
      }
    });
    ['search-status-edit-dep', 'search-status-edit-arr'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.textContent = ''; el.className = 'search-status'; }
    });
  }

  document.getElementById('btn-edit-leg-cancel').addEventListener('click', fermerModaleEditLeg);

  document.getElementById('edit-leg-overlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('edit-leg-overlay'))
      fermerModaleEditLeg();
  });

  // Helper : afficher/cacher + sync checkbox d'une rangée pattern d'Édit Leg
  function _syncEditLegPatternRow(side) {
    const nameEl = document.getElementById(`edit-leg-${side}-name`);
    const row = document.getElementById(`edit-leg-${side}-pattern-row`);
    const cb = document.getElementById(`edit-leg-${side}-pattern-cb`);
    if (!nameEl || !row || !cb) return;
    const isPattern = nameEl.dataset.pattern === 'true';
    if (isPattern) {
      row.style.display = 'block';
      cb.checked = true;
    } else {
      // On garde la rangée visible si elle l'était déjà (l'utilisateur peut
      // re-cocher après avoir décoché). Sinon, on la laisse cachée.
      cb.checked = false;
    }
  }

  // Recherche multi pour Édit leg — Départ (avec question Tour de piste si aéroport)
  document.getElementById('btn-search-edit-dep').addEventListener('click', () => {
    rechercherMulti({
      code: document.getElementById('edit-leg-dep-name').value,
      statusEl: document.getElementById('search-status-edit-dep'),
      resultsEl: document.getElementById('search-results-edit-dep'),
      latEl: document.getElementById('edit-leg-dep-lat'),
      lonEl: document.getElementById('edit-leg-dep-lon'),
      latRadioName: 'edit-dep-lat-dir',
      lonRadioName: 'edit-dep-lon-dir',
      nameEl: document.getElementById('edit-leg-dep-name'),
      askPatternOnAirport: true,
      onPatternSet: () => _syncEditLegPatternRow('dep'),
    });
  });

  // Recherche multi pour Édit leg — Arrivée (avec question Tour de piste si aéroport)
  document.getElementById('btn-search-edit-arr').addEventListener('click', () => {
    rechercherMulti({
      code: document.getElementById('edit-leg-arr-name').value,
      statusEl: document.getElementById('search-status-edit-arr'),
      resultsEl: document.getElementById('search-results-edit-arr'),
      latEl: document.getElementById('edit-leg-arr-lat'),
      lonEl: document.getElementById('edit-leg-arr-lon'),
      latRadioName: 'edit-arr-lat-dir',
      lonRadioName: 'edit-arr-lon-dir',
      nameEl: document.getElementById('edit-leg-arr-name'),
      askPatternOnAirport: true,
      onPatternSet: () => _syncEditLegPatternRow('arr'),
    });
  });

  // Décochage de la checkbox → met à jour dataset.pattern (la rangée reste visible
  // pour permettre une re-cochage sans avoir à re-rechercher)
  document.getElementById('edit-leg-dep-pattern-cb').addEventListener('change', e => {
    document.getElementById('edit-leg-dep-name').dataset.pattern = e.target.checked ? 'true' : '';
  });
  document.getElementById('edit-leg-arr-pattern-cb').addEventListener('change', e => {
    document.getElementById('edit-leg-arr-name').dataset.pattern = e.target.checked ? 'true' : '';
  });

  document.getElementById('btn-edit-leg-validate').addEventListener('click', () => {
    const legIndex = window._editLegIndex;
    if (legIndex === null) return;
    const errEl = document.getElementById('edit-leg-error');
    errEl.textContent = '';

    // Lire et valider les champs
    function readPoint(nameId, latId, latRadio, lonId, lonRadio) {
      const name = document.getElementById(nameId).value.trim();
      const latRaw = parseFloat(document.getElementById(latId).value);
      const lonRaw = parseFloat(document.getElementById(lonId).value);
      const latDir = document.querySelector(`input[name="${latRadio}"]:checked`)?.value || 'N';
      const lonDir = document.querySelector(`input[name="${lonRadio}"]:checked`)?.value || 'E';
      if (!name || isNaN(latRaw) || isNaN(lonRaw)) return null;
      if (latRaw < 0 || latRaw > 90 || lonRaw < 0 || lonRaw > 180) return null;
      return {
        name, ident: name,
        lat: latDir === 'N' ? latRaw : -latRaw,
        lon: lonDir === 'E' ? lonRaw : -lonRaw
      };
    }

    const newDep = readPoint('edit-leg-dep-name', 'edit-leg-dep-lat', 'edit-dep-lat-dir', 'edit-leg-dep-lon', 'edit-dep-lon-dir');
    const newArr = readPoint('edit-leg-arr-name', 'edit-leg-arr-lat', 'edit-arr-lat-dir', 'edit-leg-arr-lon', 'edit-arr-lon-dir');

    if (!newDep || !newArr) {
      errEl.textContent = t('fillFields');
      return;
    }

    // Récupérer l'état "Tour de piste prévu" depuis dataset.pattern
    newDep.pattern = document.getElementById('edit-leg-dep-name').dataset.pattern === 'true';
    newArr.pattern = document.getElementById('edit-leg-arr-name').dataset.pattern === 'true';

    // Appliquer — les deux points sont partagés avec les legs adjacents
    flightPlan[legIndex - 1] = { ...flightPlan[legIndex - 1], ...newDep };
    flightPlan[legIndex] = { ...flightPlan[legIndex], ...newArr };

    // Répercuter le départ / l'arrivée sur les champs ICAO de la boîte
    // Informations (peuplés depuis flightPlan[0].ident / dernier.ident). On
    // resynchronise les deux à chaque validation, quel que soit le leg édité.
    if (flightPlan.length >= 1) {
      const inputDep = document.getElementById('input-icao-dep');
      const inputArr = document.getElementById('input-icao-arr');
      if (inputDep) inputDep.value = flightPlan[0].ident || '';
      if (inputArr) inputArr.value = flightPlan[flightPlan.length - 1].ident || '';
    }

    fermerModaleEditLeg();

    // Recalculer et redessiner toute la carte
    marqueursCarte.forEach(m => map.removeLayer(m));
    marqueursCarte = [];
    supprimerSegmentsCarte();
    flightPlan.forEach((p, idx) => tracerPointVisuel(p, idx));
    redessinerSegments();
    if (flightPlan.length > 1) {
      const bounds = L.latLngBounds(flightPlanDisplayLatLngs());
      map.fitBounds(bounds, { padding: [50, 50], animate: false });
    }
    mettreAJourLogDeNav();
  });
}

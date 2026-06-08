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
// NavXpressVFR — waypoint-modals.js
// Modales insertion / altitude / confirmation waypoint
// Extrait de ui.js (Phase 2 — Lot A). Appelé par l'orchestrateur ui.js.
// ============================================================

function initWaypointModals() {
  // --- 8. MODALE : INSÉRER UN POINT TOURNANT ---
  const insertOverlay = document.getElementById('insert-wp-overlay');
  const btnInsertCancel = document.getElementById('btn-insert-wp-cancel');
  const btnInsertValidate = document.getElementById('btn-insert-wp-validate');

  if (insertOverlay) {
    // Fermer sur Annuler
    btnInsertCancel.addEventListener('click', () => insertOverlay.classList.remove('visible'));

    // Fermer en cliquant sur le fond
    insertOverlay.addEventListener('click', (e) => {
      if (e.target === insertOverlay) insertOverlay.classList.remove('visible');
    });

    // Validation du nom à la frappe : lettres, chiffres, - et apostrophe uniquement
    const inputNom = document.getElementById('insert-wp-icao');
    inputNom.addEventListener('input', () => {
      inputNom.value = inputNom.value.replace(/[^a-zA-Z0-9\-']/g, '');
    });

    // Validation des coords à la frappe : chiffres et point décimal uniquement
    ['insert-wp-lat', 'insert-wp-lon'].forEach(id => {
      const el = document.getElementById(id);
      el.addEventListener('input', () => {
        // Garder uniquement chiffres et un seul point décimal
        let v = el.value.replace(/[^0-9.]/g, '');
        const parts = v.split('.');
        if (parts.length > 2) v = parts[0] + '.' + parts.slice(1).join('');
        el.value = v;
      });
    });

    // Recherche multi (airports + navaids) pour le point tournant
    // — avec question Tour de piste si le résultat est un aéroport
    document.getElementById('btn-search-wp').addEventListener('click', () => {
      rechercherMulti({
        code: document.getElementById('insert-wp-icao').value,
        statusEl: document.getElementById('search-status-wp'),
        resultsEl: document.getElementById('search-results-wp'),
        latEl: document.getElementById('insert-wp-lat'),
        lonEl: document.getElementById('insert-wp-lon'),
        latRadioName: 'lat-dir',
        lonRadioName: 'lon-dir',
        nameEl: document.getElementById('insert-wp-icao'),
        askPatternOnAirport: true,
      });
    });

    // Valider l'insertion
    btnInsertValidate.addEventListener('click', async () => {
      const name = document.getElementById('insert-wp-icao').value.trim();
      const latDir = document.querySelector('input[name="lat-dir"]:checked').value;
      const lonDir = document.querySelector('input[name="lon-dir"]:checked').value;
      const latRaw = parseFloat(document.getElementById('insert-wp-lat').value);
      const lonRaw = parseFloat(document.getElementById('insert-wp-lon').value);
      const errEl = document.getElementById('insert-wp-error');

      if (!name) {
        errEl.textContent = currentLang === 'fr' ? 'Veuillez renseigner un identifiant.' : 'Please enter an identifier.';
        return;
      }
      if (isNaN(latRaw) || isNaN(lonRaw)) {
        errEl.textContent = currentLang === 'fr' ? 'Veuillez renseigner les coordonnées.' : 'Please fill in the coordinates.';
        return;
      }

      // Appliquer le signe selon N/S et E/W
      const lat = latDir === 'S' ? -Math.abs(latRaw) : Math.abs(latRaw);
      const lon = lonDir === 'W' ? -Math.abs(lonRaw) : Math.abs(lonRaw);

      // Récupérer le flag "Tour de piste prévu" depuis dataset.pattern
      const isPattern = document.getElementById('insert-wp-icao').dataset.pattern === 'true';
      const nouveauPoint = { name, ident: name, lat, lon };
      if (isPattern) nouveauPoint.pattern = true;
      flightPlan.splice(insertLegIndex, 0, nouveauPoint);

      // Insérer une altitude par défaut pour le nouveau leg à insertLegIndex
      // Le nouveau leg prend l'altitude du leg suivant (ou ALT_DEFAULT si absent)
      const altVoisin = legAltitudes[insertLegIndex] ?? ALT_DEFAULT;
      legAltitudes.splice(insertLegIndex, 0, altVoisin);

      // Si le leg actif est >= insertLegIndex, le décaler d'un cran
      if (activeLegIndex >= insertLegIndex) activeLegIndex++;

      // Redessiner la carte complètement
      marqueursCarte.forEach(m => map.removeLayer(m));
      marqueursCarte = [];
      supprimerSegmentsCarte();
      await calculerDeclinaisonCentroide();
      flightPlan.forEach((p, idx) => tracerPointVisuel(p, idx));
      redessinerSegments();
      const bounds = L.latLngBounds(flightPlanDisplayLatLngs());
      map.fitBounds(bounds, { padding: [50, 50] });

      mettreAJourLogDeNav();
      insertOverlay.classList.remove('visible');
    });
  }

  // --- 9. MODALE : ALTITUDE ---
  const altOverlay = document.getElementById('alt-overlay');
  const altInput = document.getElementById('alt-input');
  const altLegNum = document.getElementById('alt-leg-num');
  const altError = document.getElementById('alt-error');
  let altEditingLegIndex = 0; // index 1-based du leg en cours d'édition

  document.getElementById('btn-alt-cancel').addEventListener('click', () => {
    altOverlay.classList.remove('visible');
  });

  altOverlay.addEventListener('click', (e) => {
    if (e.target === altOverlay) altOverlay.classList.remove('visible');
  });

  document.getElementById('btn-alt-minus').addEventListener('click', () => {
    const val = parseInt(altInput.value) || ALT_DEFAULT;
    const newVal = Math.max(ALT_MIN, val - ALT_STEP);
    altInput.value = newVal;
    altError.textContent = '';
  });

  document.getElementById('btn-alt-plus').addEventListener('click', () => {
    const val = parseInt(altInput.value) || ALT_DEFAULT;
    const newVal = Math.min(ALT_MAX, val + ALT_STEP);
    altInput.value = newVal;
    altError.textContent = '';
  });

  // Validation saisie manuelle : chiffres uniquement
  altInput.addEventListener('input', () => {
    altInput.value = altInput.value.replace(/[^0-9]/g, '');
    altError.textContent = '';
  });

  document.getElementById('btn-alt-validate').addEventListener('click', () => {
    const val = parseInt(altInput.value);
    if (isNaN(val) || val < ALT_MIN || val > ALT_MAX) {
      altError.textContent = currentLang === 'fr'
        ? `Altitude entre ${ALT_MIN} et ${ALT_MAX} ft.`
        : `Altitude between ${ALT_MIN} and ${ALT_MAX} ft.`;
      return;
    }
    legAltitudes[altEditingLegIndex] = val;
    altOverlay.classList.remove('visible');
    mettreAJourLogDeNav();
  });


  // --- 10. MODALE : CONFIRMATION WAYPOINT (scission / déplacement) ---
  const wpConfirmOverlay = document.getElementById('wp-confirm-overlay');

  document.getElementById('btn-wp-confirm-cancel').addEventListener('click', () => {
    wpConfirmOverlay.classList.remove('visible');
    // Nettoyer le marqueur temporaire si présent
    if (marqueurTemporaire) {
      map.removeLayer(marqueurTemporaire);
      marqueurTemporaire = null;
    }
    _confirmCallback = null;
  });

  wpConfirmOverlay.addEventListener('click', (e) => {
    if (e.target === wpConfirmOverlay) {
      document.getElementById('btn-wp-confirm-cancel').click();
    }
  });

  document.getElementById('btn-wp-confirm-validate').addEventListener('click', () => {
    if (_confirmCallback) _confirmCallback();
  });

  // Valider avec Entrée sur le champ nom
  document.getElementById('wp-confirm-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('btn-wp-confirm-validate').click();
  });

  // Fonction appelée depuis mettreAJourLogDeNav pour ouvrir la modale
  window.ouvrirModaleAltitude = (legIndex) => {
    altEditingLegIndex = legIndex;
    altLegNum.textContent = legIndex;
    altInput.value = legAltitudes[legIndex] ?? ALT_DEFAULT;
    altError.textContent = '';
    altOverlay.classList.add('visible');
    setTimeout(() => altInput.select(), 50);
  };
}

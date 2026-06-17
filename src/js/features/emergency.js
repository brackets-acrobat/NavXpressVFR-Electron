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
// NavXpressVFR — emergency.js
// Atterrissage d'urgence : bouton rouge + modale de choix parmi les 3
// aéroports (dotés d'une piste) les plus proches de l'avion. Le choix validé
// déclenche un Direct To « urgence » (window.activerDirectToUrgence, défini par
// direct-to.js) → guidage + avertissements de déviation + annonce vocale
// urgence_xx.mp3 à l'arrivée (sim.js).
// Doit être appelé APRÈS initDirectTo (utilise window.activerDirectToUrgence).
// ============================================================

function initEmergency() {
  const btnEmergency = document.getElementById('btn-emergency');
  const overlay = document.getElementById('emergency-overlay');
  const list = document.getElementById('emergency-list');
  const errorEl = document.getElementById('emergency-error');
  const btnCancel = document.getElementById('btn-emergency-cancel');
  const btnValidate = document.getElementById('btn-emergency-validate');
  if (!btnEmergency || !overlay) return;

  // Nombre d'aéroports proposés.
  const EMERGENCY_COUNT = 3;
  // Candidats de la dernière recherche : [{ code, name, lat, lon, length_ft }]
  let _candidats = [];
  // État « en vol » (SimVar SIM ON GROUND, diffusé par main via onFlightAirborne).
  let _airborne = false;

  function _fermer() { overlay.classList.remove('visible'); }

  // Le bouton n'est actif qu'en vol ET connecté à MSFS : au sol comme avant le
  // décollage, un déroutement d'urgence n'a pas de sens.
  function _majBouton() {
    const peut = (_simState === 'connected') && _airborne;
    btnEmergency.disabled = !peut;
    btnEmergency.title = peut
      ? t('emergencyBtnTooltip')
      : t('emergencyBtnTooltipDisabled');
  }

  // « airborne » diffusé au changement uniquement → on mémorise l'état.
  if (window.api && typeof window.api.onFlightAirborne === 'function') {
    window.api.onFlightAirborne((s) => {
      if (!s) return;
      _airborne = !!s.airborne;
      _majBouton();
    });
  }
  // Déconnexion MSFS → plus en vol (et bouton grisé). _simState est mis à jour
  // par le handler de sim.js, enregistré AVANT celui-ci (initSim avant initEmergency).
  window.api.onStatusSimConnect(() => {
    if (_simState !== 'connected') _airborne = false;
    _majBouton();
  });
  _majBouton();

  // --- Ouverture de la modale ---
  btnEmergency.addEventListener('click', async () => {
    if (btnEmergency.disabled) return;
    // Le bouton n'a de sens que connecté à MSFS avec une position avion connue.
    if (_simState !== 'connected' || !_lastAircraftPos) {
      showToast(t('emergencyNotConnected'), 'error', 3000);
      return;
    }

    list.innerHTML = '';
    errorEl.textContent = '';
    btnValidate.disabled = true;
    _candidats = [];

    let res;
    try {
      res = await window.api.aeroportsProches({
        lat: _lastAircraftPos.lat,
        lon: _lastAircraftPos.lon,
        limit: EMERGENCY_COUNT,
      });
    } catch (err) {
      console.error('Atterrissage d\'urgence — recherche aéroports proches :', err);
      showToast(t('emergencyNoAirports'), 'error', 3000);
      return;
    }

    if (!res || !res.ok || !Array.isArray(res.airports) || res.airports.length === 0) {
      showToast(t('emergencyNoAirports'), 'error', 3000);
      return;
    }

    _candidats = res.airports;
    _candidats.forEach((apt, idx) => {
      // Cap magnétique + distance + temps de vol depuis la position avion.
      const info = calcLegInfo(_lastAircraftPos.lat, _lastAircraftPos.lon, apt.lat, apt.lon);
      const cap = String(Math.round(info.capMagDeg)).padStart(3, '0');
      const dist = info.distanceNM.toFixed(1);
      const metrics = t('emergencyMetricsFmt')(dist, cap, info.tempsFormate, apt.length_ft);

      const item = document.createElement('label');
      item.className = 'emergency-item';
      item.innerHTML = `
        <input type="radio" name="emergency-target" value="${idx}">
        <span class="emergency-code">${escapeHtml(apt.code || '?')}</span>
        <span class="emergency-name">${escapeHtml(apt.name || '')}</span>
        <span class="emergency-metrics">${escapeHtml(metrics)}</span>
      `;
      list.appendChild(item);
    });

    list.querySelectorAll('input[type="radio"]').forEach(r => {
      r.addEventListener('change', () => { btnValidate.disabled = false; });
    });

    overlay.classList.add('visible');
  });

  // --- Annulation ---
  if (btnCancel) btnCancel.addEventListener('click', _fermer);
  overlay.addEventListener('click', e => { if (e.target === overlay) _fermer(); });

  // --- Validation → Direct To urgence ---
  if (btnValidate) {
    btnValidate.addEventListener('click', () => {
      const checked = list.querySelector('input[type="radio"]:checked');
      if (!checked) {
        errorEl.textContent = t('emergencyNoSelection');
        return;
      }
      if (!_lastAircraftPos) {
        errorEl.textContent = t('emergencyNotConnected');
        return;
      }
      const apt = _candidats[parseInt(checked.value, 10)];
      if (!apt) return;
      _fermer();
      if (typeof window.activerDirectToUrgence === 'function') {
        window.activerDirectToUrgence({
          lat: apt.lat,
          lon: apt.lon,
          code: apt.code,
          name: apt.name,
        });
      }
    });
  }
}

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
// NavXpressVFR — fuel.js
// Emport carburant : calcul, total, modale.
// Extrait de ui.js (Phase 2 — Lot B).
// Utilise calcLegInfo (nav-core.js). Installe le décorateur #1 ; appelé AVANT Direct To.
// ============================================================

function initFuel() {
  // ============================================================
  // EMPORT CARBURANT — calcul et affichage du total
  // ============================================================
  const fuelConsoEl = document.getElementById('fuel-conso');
  const fuelNightEl = document.getElementById('fuel-night');
  const fuelDistAltEl = document.getElementById('fuel-dist-alt');
  const fuelReserveEl = document.getElementById('fuel-reserve');
  const fuelTotalEl = document.getElementById('fuel-total');

  // Filtre décimal (réutilise la même logique que les conversions, déclarée
  // dans le bloc CONVERSIONS plus bas — on en redéfinit une locale ici par
  // sécurité, indépendante de l'ordre des blocs)
  function _fuelCleanInput(el) {
    const before = el.value;
    let v = before.replace(/,/g, '.').replace(/[^0-9.\-]/g, '');
    const firstDot = v.indexOf('.');
    if (firstDot !== -1) {
      v = v.slice(0, firstDot + 1) + v.slice(firstDot + 1).replace(/\./g, '');
    }
    if (v.lastIndexOf('-') > 0) v = v.replace(/-/g, '');
    if (v !== before) el.value = v;
  }

  // Calcule le temps total du plan de vol (somme des durées des legs) en secondes.
  // Renvoie 0 si aucun plan ou si le calcul n'est pas possible.
  function _calcTempsTripSec() {
    if (!flightPlan || flightPlan.length < 2) return 0;
    let total = 0;
    for (let i = 1; i < flightPlan.length; i++) {
      const a = flightPlan[i - 1];
      const b = flightPlan[i];
      const info = calcLegInfo(a.lat, a.lon, b.lat, b.lon);
      if (info && Number.isFinite(info.tempsSec)) total += info.tempsSec;
    }
    return total;
  }

  function updateFuelTotal() {
    if (!fuelTotalEl) return;
    const conso = parseFloat(fuelConsoEl?.value) || 0;
    const distAlt = parseFloat(fuelDistAltEl?.value) || 0;
    const reserveDisc = parseFloat(fuelReserveEl?.value) || 0;
    const vfrNuit = !!fuelNightEl?.checked;
    const vp = parseFloat(document.getElementById('input-vp')?.value) || 0;

    // Durées (en heures)
    const taxiH = 10 / 60;
    const tripH = _calcTempsTripSec() / 3600;
    const reserveRegMin = vfrNuit ? 45 : 30;
    const reserveRegH = reserveRegMin / 60;
    const altH = (vp > 0 && distAlt > 0) ? (distAlt / vp) : 0;

    // Carburant (USG) = consommation (USG/h) × temps (h)
    const fTaxi = conso * taxiH;
    const fTrip = conso * tripH;
    const fReserve = conso * reserveRegH;
    const fAlt = conso * altH;
    // Réserve de route : 10% de la consommation horaire (aléas météo, etc.)
    const fRouteReserve = conso * 0.10;
    const total = fTaxi + fTrip + fReserve + fAlt + fRouteReserve + reserveDisc;

    fuelTotalEl.textContent = total.toFixed(1);
  }

  // Listeners sur les champs carburant
  [fuelConsoEl, fuelDistAltEl, fuelReserveEl].forEach(el => {
    if (!el) return;
    el.addEventListener('input', () => {
      _fuelCleanInput(el);
      updateFuelTotal();
    });
  });
  if (fuelNightEl) fuelNightEl.addEventListener('change', updateFuelTotal);

  // Quand le plan de vol / Vp / vent changent, le trip time change → recalcul.
  // mettreAJourLogDeNav est déjà wrappé plus bas par le bloc Direct To, donc
  // pour ne pas perdre les autres effets on hook ici aussi.
  const _origMajLogForFuel = mettreAJourLogDeNav;
  mettreAJourLogDeNav = function () {
    const r = _origMajLogForFuel.apply(this, arguments);
    try { updateFuelTotal(); } catch (_) { }
    return r;
  };

  // Calcul initial
  updateFuelTotal();

  // --- Bouton + Modale Emport Carburant ---
  const btnFuel = document.getElementById('btn-fuel');
  const fuelOverlay = document.getElementById('fuel-overlay');
  const btnFuelClose = document.getElementById('btn-fuel-close');

  function _ouvrirFuel() {
    if (!fuelOverlay) return;
    updateFuelTotal(); // s'assure que le total est à jour à l'ouverture
    fuelOverlay.classList.add('visible');
    setTimeout(() => {
      if (fuelConsoEl) { fuelConsoEl.focus(); fuelConsoEl.select(); }
    }, 50);
  }
  function _fermerFuel() {
    if (fuelOverlay) fuelOverlay.classList.remove('visible');
    // Les valeurs des champs sont conservées (pas de reset) → persistance entre ouvertures
  }
  if (btnFuel) btnFuel.addEventListener('click', _ouvrirFuel);
  if (btnFuelClose) btnFuelClose.addEventListener('click', _fermerFuel);
  if (fuelOverlay) {
    fuelOverlay.addEventListener('click', e => {
      if (e.target === fuelOverlay) _fermerFuel();
    });
  }
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && fuelOverlay && fuelOverlay.classList.contains('visible')) {
      _fermerFuel();
    }
  });
}

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
// NavXpressVFR — precision.js (feature renderer)
// Évaluation de la précision du vol (variable `precision`, 0–100 %).
//
// Sous-fonction du carnet de vol : ne tourne que si « Logbook automatique »
// est ON (elle s'appuie sur les transitions de la FSM main, sur les VS de
// toucher émises par 'landing-result', sur la modale de fin de vol, et stocke
// le score final dans la fiche du vol).
//
// Cycle :
//   - Décollage (FSM 'IN_FLIGHT')  → precision=100, démarre l'échantillonnage,
//                                    verrouille le toggle Options.
//   - Toutes les 10 s (tick)       → si leg actif ET hors 2 NM de tout aéroport
//                                    du plan : relève lateralDelta + altitudeDelta.
//   - Toutes les 6 ticks (60 s)    → par catégorie : min(delta)+max(delta),
//                                    appliqué cumulativement à `precision` (clamp 0..100).
//   - Fin de vol confirmée (« Oui »)→ finalize() : applique la somme des deltas
//                                    de touchers, affiche la modale résultat,
//                                    renvoie le score à logbook.js (→ main → JSONL).
//   - Retour au repos (FSM 'OFF_TRACK') → déverrouille le toggle, désarme.
//
// État partagé : window.appOptions.precisionEnabled (toggle Options).
// API exposée  : window.precision = { finalize, getCurrent }.
//
// initPrecision() est appelée par l'orchestrateur ui.js (après initLogbookBridge).
// Réutilise distanceNM / crossTrackNM / getActiveLeg de nav-core.js.
// ============================================================

function initPrecision() {
  if (!window.api) return;

  const TICK_MS = 10_000;          // 1 relevé toutes les 10 s
  const TICKS_PER_MINUTE = 6;      // agrégation toutes les 6 relevés (60 s)
  const NEAR_AIRPORT_NM = 2;       // zone de suspension lat+alt autour des aéroports

  // ---- Fonctions PURES de scoring (testables isolément) --------------------
  // Déviation latérale : |écart| en NM → delta.
  function lateralDelta(nm) {
    const p = Math.abs(nm);
    if (p < 0.2) return 10;
    if (p < 0.5) return 0;
    if (p < 1.2) return -5;
    return -10;
  }
  // Altitude AGL (ft) → delta (jamais de bonus).
  function altitudeDelta(ft) {
    if (ft <= 250) return -10;
    if (ft < 500) return -5;
    return 0;
  }
  // Vitesse verticale d'un toucher → delta. La VS du log est négative en
  // descente (ex. -120) ; on raisonne en magnitude (taux de descente).
  function vsDelta(fpm) {
    const v = Math.abs(fpm);
    if (v < 100) return 10;
    if (v < 150) return 5;
    if (v < 250) return 0;
    if (v < 350) return -5;
    return -10;
  }
  // « delta le plus bas + delta le plus haut » d'une catégorie sur la minute.
  function extremesSum(arr) {
    if (!arr || arr.length === 0) return 0;
    let mn = arr[0], mx = arr[0];
    for (let i = 1; i < arr.length; i++) {
      if (arr[i] < mn) mn = arr[i];
      if (arr[i] > mx) mx = arr[i];
    }
    return mn + mx;
  }
  const clamp = (x) => Math.max(0, Math.min(100, x));

  // ---- État ----------------------------------------------------------------
  let _inFlight = false;   // garde contre les IN_FLIGHT répétés
  let _armed = false;      // évaluation active pour ce vol (toggle ON au décollage)
  let _precision = 100;
  let _tickCount = 0;
  let _latSamples = [];    // deltas latéraux de la minute en cours
  let _altSamples = [];    // deltas altitude de la minute en cours
  let _landingVs = [];     // VS de tous les touchers (T&G + atterrissage final)
  let _lastPos = null;     // { lat, lon, altAgl } : dernière position MSFS
  let _timer = null;

  const _cbToggle = () => document.getElementById('opt-precision-enabled');

  // Vrai si la position est à < 2 NM d'un aéroport DU PLAN (départ, arrivée, ou
  // waypoint tour de piste). Dans ce cas, lat ET alt sont suspendus (relevé sauté).
  function nearPlanAirport(pos) {
    if (!pos || !Number.isFinite(pos.lat) || !Number.isFinite(pos.lon)) return false;
    if (!Array.isArray(flightPlan) || flightPlan.length === 0) return false;
    const airports = [];
    if (flightPlan[0]) airports.push(flightPlan[0]);
    if (flightPlan.length > 1) airports.push(flightPlan[flightPlan.length - 1]);
    for (const wp of flightPlan) { if (wp && wp.pattern) airports.push(wp); }
    for (const a of airports) {
      if (a && Number.isFinite(a.lat) && Number.isFinite(a.lon)
        && distanceNM(pos.lat, pos.lon, a.lat, a.lon) < NEAR_AIRPORT_NM) {
        return true;
      }
    }
    return false;
  }

  function _resetState() {
    _precision = 100;
    _tickCount = 0;
    _latSamples = [];
    _altSamples = [];
    _landingVs = [];
  }

  // Agrège la minute écoulée : contribution = min+max par catégorie présente.
  function _aggregateMinute() {
    if (_latSamples.length === 0 && _altSamples.length === 0) return;
    const contribLat = extremesSum(_latSamples);
    const contribAlt = extremesSum(_altSamples);
    _precision = clamp(_precision + contribLat + contribAlt);
    _latSamples = [];
    _altSamples = [];
  }

  function _tick() {
    _tickCount++;
    const leg = (typeof getActiveLeg === 'function') ? getActiveLeg() : null;
    // Gate unifié : leg actif ET position+AGL valides ET hors 2 NM d'un aéroport.
    if (leg && _lastPos && Number.isFinite(_lastPos.altAgl) && !nearPlanAirport(_lastPos)) {
      const xtd = crossTrackNM(
        _lastPos.lat, _lastPos.lon,
        leg.dep.lat, leg.dep.lon, leg.arr.lat, leg.arr.lon
      );
      _latSamples.push(lateralDelta(xtd));
      _altSamples.push(altitudeDelta(_lastPos.altAgl));
    }
    if (_tickCount % TICKS_PER_MINUTE === 0) _aggregateMinute();
  }

  function _startFlight() {
    if (_timer) { clearInterval(_timer); _timer = null; }
    _armed = !!(window.appOptions && window.appOptions.precisionEnabled);
    _resetState();
    // Verrou du toggle pendant tout le vol (qu'il soit armé ou non).
    const cb = _cbToggle();
    if (cb) cb.disabled = true;
    if (_armed) _timer = setInterval(_tick, TICK_MS);
  }

  function _stopFlight() {
    if (_timer) { clearInterval(_timer); _timer = null; }
    _armed = false;
    const cb = _cbToggle();
    if (cb) cb.disabled = false;
  }

  // ---- Modale résultat -----------------------------------------------------
  // On n'affiche QUE le score final. Pas de détail par catégorie : les sommes
  // brutes par catégorie ne réconcilient pas avec le score (plafond 100 %
  // appliqué chaque minute → les bonus au plafond sont « perdus »), ce qui
  // prêtait à confusion.
  function _showResult(score) {
    const overlay = document.getElementById('precision-result-overlay');
    const body = document.getElementById('precision-result-body');
    if (!overlay || !body) return;
    body.innerHTML = `<div class="prec-score">${score} %</div>`;
    overlay.classList.add('visible');
  }

  function _closeResult() {
    const overlay = document.getElementById('precision-result-overlay');
    if (overlay) overlay.classList.remove('visible');
  }

  // ---- API publique --------------------------------------------------------
  // Appelée par logbook.js quand l'utilisateur confirme la fin de vol (« Oui »).
  // Renvoie le score final (entier 0..100) à stocker, ou null si non armé.
  function finalize() {
    if (!_armed) return null;
    _aggregateMinute();                         // minute partielle en cours
    let landingContrib = 0;
    for (const vs of _landingVs) landingContrib += vsDelta(vs);
    const rounded = Math.round(clamp(_precision + landingContrib));
    _showResult(rounded);
    if (_timer) { clearInterval(_timer); _timer = null; }
    _armed = false;                             // verrou levé au passage OFF_TRACK
    return rounded;
  }

  function getCurrent() { return _armed ? Math.round(_precision) : null; }

  window.precision = { finalize, getCurrent };

  // ---- Câblage des sources -------------------------------------------------
  // Position + AGL (event 'donnees-position', ~5 s).
  window.api.onDonneesPosition((pos) => {
    if (!pos || typeof pos.lat !== 'number' || typeof pos.lon !== 'number') return;
    _lastPos = {
      lat: pos.lat,
      lon: pos.lon,
      altAgl: (typeof pos.altAgl === 'number') ? pos.altAgl : NaN,
    };
  });

  // Touchers (T&G + atterrissage final) — déjà filtrés des rebonds par la FSM.
  if (typeof window.api.onLandingResult === 'function') {
    window.api.onLandingResult((r) => {
      if (_armed && r && Number.isFinite(r.verticalSpeedFpm)) {
        _landingVs.push(r.verticalSpeedFpm);
      }
    });
  }

  // Transitions de la machine à états (décollage / retour au repos).
  if (typeof window.api.onLogbookState === 'function') {
    window.api.onLogbookState((s) => {
      if (!s || !s.state) return;
      if (s.state === 'IN_FLIGHT') {
        if (!_inFlight) { _inFlight = true; _startFlight(); }
      } else if (s.state === 'OFF_TRACK') {
        _inFlight = false;
        _stopFlight();
      }
    });
  }

  // Fermeture de la modale résultat (bouton, clic overlay, Escape).
  const btnClose = document.getElementById('btn-precision-result-close');
  const overlay = document.getElementById('precision-result-overlay');
  if (btnClose) btnClose.addEventListener('click', _closeResult);
  if (overlay) overlay.addEventListener('click', (e) => { if (e.target === overlay) _closeResult(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay && overlay.classList.contains('visible')) _closeResult();
  });
}

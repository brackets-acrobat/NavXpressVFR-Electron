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
// NavXpressVFR — simclock.js (feature renderer)
// Horloges du simulateur dans le header : heure UTC + heure locale,
// au format HH:MM:SS, centrées entre le logo titre et les boutons.
//
// Source : event IPC 'sim-time' (window.api.onSimTime), poussé 1×/seconde
// par main.js depuis les SimVars ZULU TIME / LOCAL TIME (secondes depuis
// minuit). Les horloges restent masquées tant qu'aucune donnée n'est reçue
// et redeviennent masquées à la déconnexion du simulateur.
//
// initSimClock() est appelée par l'orchestrateur ui.js.
// ============================================================

function initSimClock() {
  const wrap = document.getElementById('sim-clocks');
  const utcEl = document.getElementById('sim-clock-utc');
  const locEl = document.getElementById('sim-clock-local');
  const pauseEl = document.getElementById('sim-pause-badge');
  if (!wrap || !utcEl || !locEl) return;

  const PLACEHOLDER = '--:--:--';

  // Bits du bitfield Pause_EX1 (MSFS SDK), cf. main.js.
  const PAUSE_FULL = 1, PAUSE_ACTIVE = 4, PAUSE_SIM = 8;
  let _lastPauseFlags = 0; // mémorisé pour ré-appliquer le tooltip au changement de langue

  // --- Horloge locale lissée -------------------------------------------------
  // L'affichage est découplé de la livraison SimConnect : un ticker local fait
  // avancer l'heure à 1 s/s (temps réel) et se recale en douceur sur chaque
  // échantillon ZULU/LOCAL reçu. Évite les sauts et la « demi-vitesse » visibles
  // à la reprise après une pause (livraison SimConnect irrégulière à ce moment).
  const TICK_MS = 200;   // 5 rafraîchissements/seconde → tic visuel fluide
  const GAIN    = 0.25;  // force de recalage vers l'estimation sim (par tick)
  const SNAP_S  = 5;     // au-delà : recalage direct (changement d'heure sim, etc.)
  let _baseZulu = null;  // dernier échantillon ZULU reçu (secondes)
  let _basePerf = 0;     // performance.now() à la réception de cet échantillon
  let _offset   = 0;     // LOCAL - ZULU (décalage fuseau, ~constant)
  let _dispZulu = null;  // valeur ZULU réellement affichée (lissée, float s)
  let _lastTick = 0;     // performance.now() du dernier tick
  let _ticker   = null;  // handle setInterval

  // flags → libellé d'état (le plus spécifique d'abord).
  function _pauseLabel(flags) {
    if (flags & PAUSE_ACTIVE) return t('pauseStateActive');
    if (flags & PAUSE_SIM)    return t('pauseStateSim');
    if (flags & PAUSE_FULL)   return t('pauseStateFull');
    return t('pauseStateGeneric');
  }

  // Applique l'état de pause au badge (affichage + tooltip).
  function _applyPause(flags) {
    const wasPaused = _lastPauseFlags !== 0;
    _lastPauseFlags = flags | 0;
    const nowPaused = _lastPauseFlags !== 0;
    // Reprise (pause → marche) : ré-ancre la base temporelle pour ne pas
    // « rattraper » d'un coup le temps écoulé pendant la pause. L'affichage
    // repart en douceur depuis sa valeur figée vers l'heure sim réelle.
    if (wasPaused && !nowPaused) {
      _basePerf = performance.now();
      _lastTick = _basePerf;
    }
    if (!pauseEl) return;
    if (_lastPauseFlags === 0) {
      pauseEl.style.display = 'none';
      pauseEl.removeAttribute('title');
    } else {
      pauseEl.title = _pauseLabel(_lastPauseFlags);
      pauseEl.style.display = '';
    }
  }

  // Rafraîchit le tooltip si le badge est visible (bascule de langue).
  window._refreshSimPauseBadge = function () {
    if (pauseEl && _lastPauseFlags !== 0) pauseEl.title = _pauseLabel(_lastPauseFlags);
  };

  // Secondes depuis minuit → "HH:MM:SS" (replié sur 24 h, jamais négatif).
  function _fmt(sec) {
    if (!Number.isFinite(sec)) return PLACEHOLDER;
    let s = Math.floor(sec) % 86400;
    if (s < 0) s += 86400;
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    const p = (n) => String(n).padStart(2, '0');
    return `${p(h)}:${p(m)}:${p(ss)}`;
  }

  // Affiche la valeur lissée courante (ZULU + LOCAL dérivé via l'offset fuseau).
  function _render() {
    if (_dispZulu === null) return;
    utcEl.textContent = _fmt(_dispZulu);
    locEl.textContent = _fmt(_dispZulu + _offset);
  }

  // Un pas de lissage. Avance de 1 s/s (feed-forward) + recalage doux vers le
  // temps sim estimé, sans jamais reculer. GELÉ pendant la pause (ESC) :
  // l'affichage ne bouge plus tant qu'une pause est active.
  function _tick() {
    if (_dispZulu === null || _baseZulu === null) return;
    const now = performance.now();
    const dtReal = (now - _lastTick) / 1000;
    _lastTick = now;
    if (_lastPauseFlags !== 0) return; // horloges figées pendant la pause sim
    const elapsed = (now - _basePerf) / 1000;
    const predicted = _baseZulu + elapsed; // estimation du ZULU sim « maintenant »
    if (Math.abs(predicted - _dispZulu) > SNAP_S) {
      _dispZulu = predicted; // gros écart → recalage immédiat
    } else {
      let next = _dispZulu + dtReal;
      next += (predicted - next) * GAIN;
      if (next < _dispZulu) next = _dispZulu; // anti-recul
      _dispZulu = next;
    }
    _render();
  }

  function _startTicker() {
    if (_ticker) return;
    _lastTick = performance.now();
    _ticker = setInterval(_tick, TICK_MS);
  }
  function _stopTicker() {
    if (_ticker) { clearInterval(_ticker); _ticker = null; }
  }

  if (window.api && typeof window.api.onSimTime === 'function') {
    window.api.onSimTime((data) => {
      if (!data) return;
      if (!Number.isFinite(data.zulu) || !Number.isFinite(data.local)) return;
      _baseZulu = data.zulu;
      _offset   = data.local - data.zulu;
      _basePerf = performance.now();
      if (_dispZulu === null) { _dispZulu = _baseZulu; _render(); } // 1er échantillon : snap
      if (wrap.style.display === 'none') wrap.style.display = '';
      _startTicker();
    });
  }

  // État de pause (Pause_EX1) → badge ⏸ + tooltip décrivant l'état.
  if (window.api && typeof window.api.onSimPause === 'function') {
    window.api.onSimPause((data) => {
      if (!data) return;
      _applyPause(data.flags | 0);
    });
  }

  // Déconnexion MSFS → on masque et on remet les placeholders (les SimVars
  // ne sont plus alimentées, autant ne pas afficher une heure figée).
  if (window.api && typeof window.api.onStatusSimConnect === 'function') {
    window.api.onStatusSimConnect((status) => {
      if (status && status.state === 'disconnected') {
        _stopTicker();
        _baseZulu = null;
        _dispZulu = null;
        wrap.style.display = 'none';
        utcEl.textContent = PLACEHOLDER;
        locEl.textContent = PLACEHOLDER;
        _applyPause(0); // masque le badge de pause
      }
    });
  }
}

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
// NavXpressVFR — timers.js
// Chronomètre (MM:SS) + Timer (HH:MM:SS) — instances StopWatch
// Extrait de ui.js (Phase 2 — Lot A). Appelé par l'orchestrateur ui.js.
// ============================================================

function initTimers() {
  // ----------------------------------------------------------
  // Chronomètre (MM:SS) + Timer (HH:MM:SS)
  // ----------------------------------------------------------
  let chrono = null;
  let timer = null;

  const chronoDisplay = document.getElementById('chrono-display');
  if (chronoDisplay) {
    chrono = new StopWatch(chronoDisplay, 'mmss', {
      start: document.getElementById('chrono-start'),
      stop: document.getElementById('chrono-stop'),
      reset: document.getElementById('chrono-reset'),
    });
    document.getElementById('chrono-start')?.addEventListener('click', () => chrono.start());
    document.getElementById('chrono-stop')?.addEventListener('click', () => chrono.stop());
    document.getElementById('chrono-reset')?.addEventListener('click', () => chrono.reset());
  }

  const timerDisplay = document.getElementById('timer-display');
  if (timerDisplay) {
    timer = new StopWatch(timerDisplay, 'hhmmss', {
      start: document.getElementById('timer-start'),
      stop: document.getElementById('timer-stop'),
      reset: document.getElementById('timer-reset'),
    });
    document.getElementById('timer-start')?.addEventListener('click', () => timer.start());
    document.getElementById('timer-stop')?.addEventListener('click', () => timer.stop());
    document.getElementById('timer-reset')?.addEventListener('click', () => timer.reset());
  }

  // --- Gel pendant la pause simulateur (ESC / Pause_EX1) ---
  // Le chronomètre et le timer se figent dès qu'une pause est active et
  // reprennent exactement où ils s'étaient arrêtés (le temps de pause n'est
  // pas compté). Déclenché par le system event diffusé depuis main.js.
  function _setTimersFrozen(frozen) {
    chrono?.setFrozen(frozen);
    timer?.setFrozen(frozen);
  }

  if (window.api && typeof window.api.onSimPause === 'function') {
    window.api.onSimPause((data) => {
      _setTimersFrozen(!!(data && (data.flags | 0) !== 0));
    });
  }

  // Déconnexion MSFS : on ne reçoit plus d'événement de reprise → on dégèle
  // pour ne pas laisser le chrono/timer bloqués si la coupure survient en pause.
  if (window.api && typeof window.api.onStatusSimConnect === 'function') {
    window.api.onStatusSimConnect((status) => {
      if (status && status.state === 'disconnected') _setTimersFrozen(false);
    });
  }
}

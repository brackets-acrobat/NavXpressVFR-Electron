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
// NavXpressVFR — tank.js
// Changement de réservoir (tank selector) — utilise _jouerSon global
// Extrait de ui.js (Phase 2 — Lot A). Appelé par l'orchestrateur ui.js.
// ============================================================

function initTank() {
  // ============================================================
  // CHANGEMENT DE RÉSERVOIR (TANK SELECTOR)
  // ============================================================
  const btnTankSwitch = document.getElementById('btn-tank-switch');
  const tankOverlay = document.getElementById('tank-overlay');
  const tankSlider = document.getElementById('tank-slider');
  const tankMinutes = document.getElementById('tank-minutes');
  const tankCountdown = document.getElementById('tank-countdown');
  const btnTankStart = document.getElementById('tank-start');
  const btnTankStop = document.getElementById('tank-stop');
  const btnTankReset = document.getElementById('tank-reset');
  const btnTankClose = document.getElementById('btn-tank-close');

  // Préchargement des sons de changement de réservoir
  const _tankSounds = {
    fr: new Audio('sounds/change_res_fr.wav'),
    en: new Audio('sounds/change_res_en.wav'),
  };
  _tankSounds.fr.preload = 'auto';
  _tankSounds.en.preload = 'auto';

  function _jouerSonChangementReservoir() {
    _jouerSon(_tankSounds[currentLang] || _tankSounds.fr);
  }

  // --- Liaison bidirectionnelle slider ↔ champ texte ---
  function _setTankMinutes(min) {
    let m = Math.round(parseFloat(min));
    if (!Number.isFinite(m)) m = 15;
    if (m < 10) m = 10;
    if (m > 45) m = 45;
    if (tankSlider && tankSlider.value !== String(m)) tankSlider.value = m;
    if (tankMinutes && document.activeElement !== tankMinutes) tankMinutes.value = m;
    // Si le compte à rebours n'est pas en marche, on synchronise l'affichage du décompte
    if (!_tankRunning) {
      _tankRemainingMs = m * 60 * 1000;
      _renderTankCountdown();
    }
  }

  if (tankSlider) {
    tankSlider.addEventListener('input', () => _setTankMinutes(tankSlider.value));
  }
  if (tankMinutes) {
    tankMinutes.addEventListener('input', () => {
      // Filtrer pour entiers uniquement
      const v = tankMinutes.value.replace(/[^0-9]/g, '');
      if (v !== tankMinutes.value) tankMinutes.value = v;
      if (v === '') return; // attend que l'utilisateur tape quelque chose
      _setTankMinutes(v);
    });
    tankMinutes.addEventListener('blur', () => {
      // Reformate proprement à la perte de focus
      _setTankMinutes(tankMinutes.value || 1);
    });
  }

  // --- Compte à rebours ---
  let _tankRunning = false;       // intention de marche (indépendante du gel)
  let _tankFrozen = false;        // gelé par la pause sim (ESC / Pause_EX1)
  let _tankRemainingMs = 15 * 60 * 1000; // ms restantes
  let _tankTickHandle = null;
  let _tankEndTime = 0;

  // (Re)met l'interval en cohérence avec l'état (en marche ET non gelé).
  function _tankSyncInterval() {
    const shouldRun = _tankRunning && !_tankFrozen;
    if (shouldRun && !_tankTickHandle) {
      _tankTickHandle = setInterval(_tankTick, 200);
    } else if (!shouldRun && _tankTickHandle) {
      clearInterval(_tankTickHandle);
      _tankTickHandle = null;
    }
  }

  function _formatCountdown(ms) {
    if (ms < 0) ms = 0;
    const totalSec = Math.ceil(ms / 1000);
    const mm = Math.floor(totalSec / 60).toString().padStart(2, '0');
    const ss = (totalSec % 60).toString().padStart(2, '0');
    return `${mm}:${ss}`;
  }

  function _renderTankCountdown() {
    if (tankCountdown) tankCountdown.textContent = _formatCountdown(_tankRemainingMs);
  }

  function _tankUpdateBtns() {
    if (btnTankStart) btnTankStart.disabled = _tankRunning || _tankRemainingMs <= 0;
    if (btnTankStop) btnTankStop.disabled = !_tankRunning;
    if (btnTankReset) btnTankReset.disabled = false;
  }

  function _tankTick() {
    _tankRemainingMs = Math.max(0, _tankEndTime - Date.now());
    _renderTankCountdown();
    if (_tankRemainingMs <= 0) {
      // Décompte arrivé à zéro : on joue le son et on REDÉMARRE automatiquement
      // depuis la valeur courante du champ texte. Boucle infinie jusqu'à
      // ce que l'utilisateur clique sur Stop ou Reset.
      _jouerSonChangementReservoir();
      const m = parseInt(tankMinutes?.value, 10)
        || parseInt(tankSlider?.value, 10) || 15;
      _tankRemainingMs = m * 60 * 1000;
      _tankEndTime = Date.now() + _tankRemainingMs;
      _renderTankCountdown();
    }
  }

  function _tankStart() {
    if (_tankRunning) return;
    // Si le décompte est à 0, on repart de la valeur courante du slider/champ
    if (_tankRemainingMs <= 0) {
      const m = parseInt(tankMinutes?.value, 10) || parseInt(tankSlider?.value, 10) || 15;
      _tankRemainingMs = m * 60 * 1000;
    }
    _tankRunning = true;
    _tankEndTime = Date.now() + _tankRemainingMs;
    if (tankCountdown) {
      tankCountdown.classList.add('running');
      tankCountdown.classList.remove('finished');
    }
    _tankSyncInterval();
    _tankUpdateBtns();
  }

  function _tankStop(reachedZero = false) {
    _tankRunning = false;
    _tankSyncInterval();
    if (tankCountdown) {
      tankCountdown.classList.remove('running');
      if (reachedZero) tankCountdown.classList.add('finished');
    }
    if (reachedZero) _jouerSonChangementReservoir();
    _tankUpdateBtns();
  }

  function _tankReset() {
    _tankRunning = false;
    _tankSyncInterval();
    const m = parseInt(tankMinutes?.value, 10) || parseInt(tankSlider?.value, 10) || 15;
    _tankRemainingMs = m * 60 * 1000;
    if (tankCountdown) {
      tankCountdown.classList.remove('running');
      tankCountdown.classList.remove('finished');
    }
    _renderTankCountdown();
    _tankUpdateBtns();
  }

  if (btnTankStart) btnTankStart.addEventListener('click', _tankStart);
  if (btnTankStop) btnTankStop.addEventListener('click', () => _tankStop(false));
  if (btnTankReset) btnTankReset.addEventListener('click', _tankReset);

  // --- Gel pendant la pause simulateur (ESC / Pause_EX1) ---
  // Le compte à rebours se fige et reprend exactement là où il s'était arrêté
  // (le temps de pause n'est pas décompté).
  function _setTankFrozen(frozen) {
    frozen = !!frozen;
    if (_tankFrozen === frozen) return;
    if (frozen) {
      // Fige le restant avant de suspendre.
      if (_tankRunning) _tankRemainingMs = Math.max(0, _tankEndTime - Date.now());
    } else {
      // Reprend : recale l'échéance pour ne pas compter le temps de pause.
      if (_tankRunning) _tankEndTime = Date.now() + _tankRemainingMs;
    }
    _tankFrozen = frozen;
    _tankSyncInterval();
    _renderTankCountdown();
  }

  if (window.api && typeof window.api.onSimPause === 'function') {
    window.api.onSimPause((data) => {
      _setTankFrozen(!!(data && (data.flags | 0) !== 0));
    });
  }
  // Déconnexion MSFS : plus d'événement de reprise → on dégèle par sécurité.
  if (window.api && typeof window.api.onStatusSimConnect === 'function') {
    window.api.onStatusSimConnect((status) => {
      if (status && status.state === 'disconnected') _setTankFrozen(false);
    });
  }

  // --- Ouverture / fermeture de la modale ---
  function _ouvrirTank() {
    if (!tankOverlay) return;
    tankOverlay.classList.add('visible');
  }
  function _fermerTank() {
    if (tankOverlay) tankOverlay.classList.remove('visible');
    // NB : on NE remet PAS à zéro le décompte à la fermeture, pour permettre
    // au pilote de fermer la modale tout en laissant le compte à rebours actif.
  }
  if (btnTankSwitch) btnTankSwitch.addEventListener('click', _ouvrirTank);
  if (btnTankClose) btnTankClose.addEventListener('click', _fermerTank);
  if (tankOverlay) {
    tankOverlay.addEventListener('click', e => {
      if (e.target === tankOverlay) _fermerTank();
    });
  }
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && tankOverlay && tankOverlay.classList.contains('visible')) {
      _fermerTank();
    }
  });

  // Init affichage
  _setTankMinutes(15);
  _tankUpdateBtns();
}

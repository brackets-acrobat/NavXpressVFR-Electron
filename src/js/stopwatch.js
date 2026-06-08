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
// NavXpressVFR — stopwatch.js
// Chronomètre / Timer générique  (extrait de ui.js — Phase 1)
// ============================================================

// -------------------------------------------------------
// Chronomètre / Timer générique (compte le temps écoulé)
//   format = 'mmss'   → 00:00
//   format = 'hhmmss' → 00:00:00
// -------------------------------------------------------
class StopWatch {
  constructor(displayEl, format, buttons) {
    this.displayEl = displayEl;
    this.format = format;
    this.btnStart = buttons.start;
    this.btnStop = buttons.stop;
    this.btnReset = buttons.reset;
    this.elapsed = 0;       // ms cumulés
    this.startTime = null;  // timestamp Date.now() du dernier démarrage
    this.intervalId = null;
    this.running = false;   // INTENTION de marche (indépendante du gel)
    this.frozen = false;    // gelé par la pause sim (ESC) — suspend sans "arrêter"
    this.render();
    this._updateButtons();
  }

  start() {
    if (this.running) return; // déjà en marche
    this.running = true;
    this.startTime = Date.now() - this.elapsed;
    this._sync();
    this._updateButtons();
  }

  stop() {
    if (!this.running) return;
    this.elapsed = Date.now() - this.startTime;
    this.running = false;
    this._sync();
    this.render();
    this._updateButtons();
  }

  reset() {
    this.running = false;
    this.elapsed = 0;
    this.startTime = null;
    this._sync();
    this.render();
    this._updateButtons();
  }

  // Gèle / dégèle SANS modifier l'intention de marche : utilisé par la pause
  // simulateur (ESC). Pendant le gel, le temps écoulé n'avance pas ; à la
  // reprise, le décompte continue exactement d'où il s'était figé.
  setFrozen(frozen) {
    frozen = !!frozen;
    if (this.frozen === frozen) return;
    if (frozen) {
      // Fige la valeur courante avant de suspendre le décompte.
      if (this.running) this.elapsed = Date.now() - this.startTime;
    } else {
      // Reprend : recale l'origine pour ne pas compter le temps de pause.
      if (this.running) this.startTime = Date.now() - this.elapsed;
    }
    this.frozen = frozen;
    this._sync();
    this.render();
  }

  // (Re)met l'interval en cohérence avec l'état (en marche ET non gelé).
  _sync() {
    const shouldRun = this.running && !this.frozen;
    if (shouldRun && this.intervalId === null) {
      this.intervalId = setInterval(() => this._tick(), 250);
    } else if (!shouldRun && this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    // La classe "running" reflète l'intention de marche (reste pendant le gel).
    if (this.displayEl) this.displayEl.classList.toggle('running', this.running);
  }

  _tick() {
    this.elapsed = Date.now() - this.startTime;
    this.render();
  }

  render() {
    if (!this.displayEl) return;
    const totalSec = Math.floor(this.elapsed / 1000);
    if (this.format === 'mmss') {
      const m = Math.floor(totalSec / 60);
      const s = totalSec % 60;
      // Cap visuel à 99:59 (le format MM:SS n'a pas d'heures)
      const mm = Math.min(m, 99);
      this.displayEl.textContent =
        String(mm).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    } else {
      const h = Math.floor(totalSec / 3600);
      const m = Math.floor((totalSec % 3600) / 60);
      const s = totalSec % 60;
      this.displayEl.textContent =
        String(h).padStart(2, '0') + ':' +
        String(m).padStart(2, '0') + ':' +
        String(s).padStart(2, '0');
    }
  }

  _updateButtons() {
    const running = this.running;
    if (this.btnStart) this.btnStart.disabled = running;
    if (this.btnStop) this.btnStop.disabled = !running;
    if (this.btnReset) this.btnReset.disabled = (this.elapsed === 0 && !running);
  }
}


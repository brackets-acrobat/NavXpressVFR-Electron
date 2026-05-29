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
    this.render();
    this._updateButtons();
  }

  start() {
    if (this.intervalId !== null) return; // déjà en marche
    this.startTime = Date.now() - this.elapsed;
    this.intervalId = setInterval(() => this._tick(), 250);
    if (this.displayEl) this.displayEl.classList.add('running');
    this._updateButtons();
  }

  stop() {
    if (this.intervalId === null) return;
    this.elapsed = Date.now() - this.startTime;
    clearInterval(this.intervalId);
    this.intervalId = null;
    if (this.displayEl) this.displayEl.classList.remove('running');
    this.render();
    this._updateButtons();
  }

  reset() {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.elapsed = 0;
    this.startTime = null;
    if (this.displayEl) this.displayEl.classList.remove('running');
    this.render();
    this._updateButtons();
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
    const running = this.intervalId !== null;
    if (this.btnStart) this.btnStart.disabled = running;
    if (this.btnStop) this.btnStop.disabled = !running;
    if (this.btnReset) this.btnReset.disabled = (this.elapsed === 0 && !running);
  }
}


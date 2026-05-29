// ============================================================
// NavXpressVFR — timers.js
// Chronomètre (MM:SS) + Timer (HH:MM:SS) — instances StopWatch
// Extrait de ui.js (Phase 2 — Lot A). Appelé par l'orchestrateur ui.js.
// ============================================================

function initTimers() {
  // ----------------------------------------------------------
  // Chronomètre (MM:SS) + Timer (HH:MM:SS)
  // ----------------------------------------------------------
  const chronoDisplay = document.getElementById('chrono-display');
  if (chronoDisplay) {
    const chrono = new StopWatch(chronoDisplay, 'mmss', {
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
    const timer = new StopWatch(timerDisplay, 'hhmmss', {
      start: document.getElementById('timer-start'),
      stop: document.getElementById('timer-stop'),
      reset: document.getElementById('timer-reset'),
    });
    document.getElementById('timer-start')?.addEventListener('click', () => timer.start());
    document.getElementById('timer-stop')?.addEventListener('click', () => timer.stop());
    document.getElementById('timer-reset')?.addEventListener('click', () => timer.reset());
  }
}

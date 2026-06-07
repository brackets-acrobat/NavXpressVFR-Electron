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
  if (!wrap || !utcEl || !locEl) return;

  const PLACEHOLDER = '--:--:--';

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

  if (window.api && typeof window.api.onSimTime === 'function') {
    window.api.onSimTime((data) => {
      if (!data) return;
      utcEl.textContent = _fmt(data.zulu);
      locEl.textContent = _fmt(data.local);
      if (wrap.style.display === 'none') wrap.style.display = '';
    });
  }

  // Déconnexion MSFS → on masque et on remet les placeholders (les SimVars
  // ne sont plus alimentées, autant ne pas afficher une heure figée).
  if (window.api && typeof window.api.onStatusSimConnect === 'function') {
    window.api.onStatusSimConnect((status) => {
      if (status && status.state === 'disconnected') {
        wrap.style.display = 'none';
        utcEl.textContent = PLACEHOLDER;
        locEl.textContent = PLACEHOLDER;
      }
    });
  }
}

// ============================================================
// NavXpressVFR — utils.js
// Helpers génériques (toast, échappement HTML, formatage)  (extrait de ui.js — Phase 1)
// ============================================================

// -------------------------------------------------------
// Toast non-bloquant (remplace alert() — pas de gel de focus dans Electron)
// -------------------------------------------------------
function showToast(message, type = 'info', duration = 2500) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = 'toast toast-' + type;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('toast-fade-out');
    setTimeout(() => { try { toast.remove(); } catch (_) { } }, 320);
  }, duration);
}


function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildKVTable(rows) {
  const ths = rows.map(r => `<tr><th>${escapeHtml(r[0])}</th><td>${r[1] ?? ''}</td></tr>`).join('');
  return `<table class="ap-info-table"><tbody>${ths}</tbody></table>`;
}

// Libellé localisé du type d'aéroport (FR traduit, EN = type nettoyé)
function formatAirportType(type) {
  const t = (type || '').trim();
  if (currentLang === 'fr') {
    const FR = {
      small_airport: 'Petit aéroport',
      medium_airport: 'Aéroport moyen',
      large_airport: 'Grand aéroport',
      heliport: 'Héliport',
      seaplane_base: 'Hydrobase',
      closed: 'Fermé',
    };
    return FR[t] || t.replace(/_/g, ' ');
  }
  return t.replace(/_/g, ' ');
}


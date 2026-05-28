// ============================================================
// NavXpressVFR — ui.js  (version bilingue FR/EN)
// Dépend de i18n.js chargé avant ce fichier
// ============================================================

// Clé API OpenAIP — chargée depuis le fichier de configuration au démarrage
let OPENAIP_API_KEY = '';

let flightPlan = [];
let legAltitudes = []; // Altitude par leg (index 1-based : legAltitudes[i] = altitude du leg i)
let map;
let segmentsCarte = []; // Un L.polyline par leg (remplace flightPathLine unique)
let marqueursCarte = []; // Marqueurs waypoints (cercles orange)
let declinaisonMoyenneGlobale = 0.0;
let activeLegIndex = 1; // Le leg actif (1-based, correspond au numéro affiché)
let insertLegIndex = 0; // Index d'insertion du point tournant (position dans flightPlan)

// --- État Direct To ---
let _directToActive = false;
let _directToOrigin = null;       // {lat, lon} = position avion au moment de l'activation
let _directToTargetIndex = null;  // index dans flightPlan du waypoint cible
let _directToLayer = null;        // L.polyline magenta dashed sur la carte
let _lastAircraftPos = null;      // {lat, lon} : dernière position avion reçue de MSFS

const ALT_MIN = 500;
const ALT_MAX = 15000;
const ALT_DEFAULT = 3000;
const ALT_STEP = 500;

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

// -------------------------------------------------------
// Modale Détails d'un aéroport (clic sur un marqueur de la carte)
// -------------------------------------------------------
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

async function ouvrirInfoAeroport(ident) {
  if (!ident) return;
  const overlay = document.getElementById('airport-info-overlay');
  const codeEl = document.getElementById('airport-info-code');
  const nameEl = document.getElementById('airport-info-name');
  const typeEl = document.getElementById('airport-info-type');
  const genEl = document.getElementById('airport-info-general');
  const rwyEl = document.getElementById('airport-info-runways');
  const freqEl = document.getElementById('airport-info-frequencies');
  const cmtEl = document.getElementById('airport-info-comments');
  if (!overlay) return;

  // Loading state
  codeEl.textContent = '…';
  nameEl.textContent = currentLang === 'fr' ? 'Chargement…' : 'Loading…';
  typeEl.textContent = '';
  genEl.innerHTML = '<div class="ap-info-empty">…</div>';
  rwyEl.innerHTML = '';
  freqEl.innerHTML = '';
  cmtEl.innerHTML = '';
  overlay.classList.add('visible');

  let res;
  try {
    res = await window.api.detailsAeroport(ident);
  } catch (err) {
    nameEl.textContent = 'Error: ' + err.message;
    return;
  }
  if (!res || !res.ok) {
    nameEl.textContent = currentLang === 'fr'
      ? `Aéroport introuvable (${ident})`
      : `Airport not found (${ident})`;
    return;
  }

  const a = res.airport;
  // Code à afficher (mêmes règles que côté carte)
  const code = (a.icao_code && a.icao_code.trim())
    || (a.gps_code && a.gps_code.trim())
    || (a.local_code && a.local_code.trim())
    || a.ident || '';
  codeEl.textContent = code;
  nameEl.textContent = a.name || a.ident;
  typeEl.textContent = (a.type || '').replace(/_/g, ' ');

  // --- Général ---
  const lat = parseFloat(a.latitude_deg);
  const lon = parseFloat(a.longitude_deg);
  const elev = a.elevation_ft;

  // ICAO affiché : si le champ icao_code est vide MAIS que le code résolu
  // est composé de 4 lettres uniquement (ex: LFNN dans gps_code, Narbonne),
  // on l'utilise comme ICAO. Les codes du type 2 lettres + 4 chiffres
  // (ex: LF1923 ULM) ne matchent pas ce filtre — comportement inchangé.
  let icaoAffiche = (a.icao_code && a.icao_code.trim()) || '';
  if (!icaoAffiche && /^[A-Za-z]{4}$/.test(code)) {
    icaoAffiche = code;
  }

  const rowsGen = [
    [currentLang === 'fr' ? 'ICAO' : 'ICAO', escapeHtml(icaoAffiche || '—')],
    [currentLang === 'fr' ? 'IATA' : 'IATA', escapeHtml(a.iata_code || '—')],
    ['GPS code', escapeHtml(a.gps_code || '—')],
    [currentLang === 'fr' ? 'Code local' : 'Local code', escapeHtml(a.local_code || '—')],
    ['Ident', escapeHtml(a.ident || '—')],
    [currentLang === 'fr' ? 'Pays' : 'Country', escapeHtml(a.iso_country || '—')],
    [currentLang === 'fr' ? 'Région' : 'Region', escapeHtml(a.iso_region || '—')],
    [currentLang === 'fr' ? 'Ville' : 'City', escapeHtml(a.municipality || '—')],
    ['Lat', Number.isFinite(lat) ? lat.toFixed(6) + '°' : '—'],
    ['Lon', Number.isFinite(lon) ? lon.toFixed(6) + '°' : '—'],
    [currentLang === 'fr' ? 'Élévation' : 'Elevation', elev ? `${elev} ft` : '—'],
    [currentLang === 'fr' ? 'Vol commercial' : 'Scheduled service',
    a.scheduled_service === 'yes' ? (currentLang === 'fr' ? 'Oui' : 'Yes') : (currentLang === 'fr' ? 'Non' : 'No')],
  ];
  if (a.home_link) rowsGen.push(['Web', `<a class="ap-info-link" href="${escapeHtml(a.home_link)}" target="_blank" rel="noopener">${escapeHtml(a.home_link)}</a>`]);
  if (a.wikipedia_link) rowsGen.push(['Wikipedia', `<a class="ap-info-link" href="${escapeHtml(a.wikipedia_link)}" target="_blank" rel="noopener">${escapeHtml(a.wikipedia_link)}</a>`]);
  if (a.keywords) rowsGen.push([currentLang === 'fr' ? 'Mots-clés' : 'Keywords', escapeHtml(a.keywords)]);
  genEl.innerHTML = buildKVTable(rowsGen);

  // --- Pistes ---
  if (!res.runways || res.runways.length === 0) {
    rwyEl.innerHTML = `<div class="ap-info-empty">${currentLang === 'fr' ? 'Aucune piste référencée' : 'No runway data'}</div>`;
  } else {
    const head = currentLang === 'fr'
      ? '<tr><th>Désignation</th><th>Long.</th><th>Larg.</th><th>Surface</th><th>Cap (°vrai)</th><th>Bal.</th><th>État</th></tr>'
      : '<tr><th>Designation</th><th>Length</th><th>Width</th><th>Surface</th><th>Hdg (°true)</th><th>Lit</th><th>Status</th></tr>';
    const rows = res.runways.map(r => {
      const name = r.le_ident + (r.he_ident ? '/' + r.he_ident : '');
      const heading = r.headingDegT !== null
        ? String(Math.round(r.headingDegT) % 360).padStart(3, '0') + '°'
        : '—';
      const len = r.length_ft ? `${r.length_ft} ft` : '—';
      const wid = r.width_ft ? `${r.width_ft} ft` : '—';
      const status = r.closed
        ? `<span style="color:#ff5252;">${currentLang === 'fr' ? 'Fermée' : 'Closed'}</span>`
        : `<span style="color:#00e676;">${currentLang === 'fr' ? 'Active' : 'Active'}</span>`;
      const lit = r.lighted ? (currentLang === 'fr' ? 'Oui' : 'Yes') : (currentLang === 'fr' ? 'Non' : 'No');
      return `<tr><td>${escapeHtml(name)}</td><td>${len}</td><td>${wid}</td><td>${escapeHtml(r.surface || '—')}</td><td>${heading}</td><td>${lit}</td><td>${status}</td></tr>`;
    }).join('');
    rwyEl.innerHTML = `<table class="ap-info-table"><thead>${head}</thead><tbody>${rows}</tbody></table>`;
  }

  // --- Fréquences ---
  if (!res.frequencies || res.frequencies.length === 0) {
    freqEl.innerHTML = `<div class="ap-info-empty">${currentLang === 'fr' ? 'Aucune fréquence référencée' : 'No frequency data'}</div>`;
  } else {
    const head = currentLang === 'fr'
      ? '<tr><th>Type</th><th>Description</th><th>MHz</th></tr>'
      : '<tr><th>Type</th><th>Description</th><th>MHz</th></tr>';
    const rows = res.frequencies.map(f =>
      `<tr><td>${escapeHtml(f.type)}</td><td>${escapeHtml(f.description)}</td><td>${escapeHtml(f.frequency_mhz)}</td></tr>`
    ).join('');
    freqEl.innerHTML = `<table class="ap-info-table"><thead>${head}</thead><tbody>${rows}</tbody></table>`;
  }

  // --- Commentaires ---
  if (!res.comments || res.comments.length === 0) {
    cmtEl.innerHTML = `<div class="ap-info-empty">${currentLang === 'fr' ? 'Aucun commentaire' : 'No comments'}</div>`;
  } else {
    cmtEl.innerHTML = res.comments.map(c => `
      <div class="ap-info-comment">
        <div class="ap-info-comment-head">
          <span class="ap-info-comment-author">${escapeHtml(c.author || '?')}</span>
          <span>${escapeHtml(c.date || '')}</span>
        </div>
        ${c.subject ? `<div class="ap-info-comment-subject">${escapeHtml(c.subject)}</div>` : ''}
        <div class="ap-info-comment-body">${escapeHtml(c.body || '')}</div>
      </div>
    `).join('');
  }
}

function fermerInfoAeroport() {
  const overlay = document.getElementById('airport-info-overlay');
  if (overlay) overlay.classList.remove('visible');
}

// -------------------------------------------------------
// Modale Détails d'un navaid (clic sur un marqueur)
// -------------------------------------------------------
function formatNavaidFreqGlobal(type, freqKhz) {
  const v = parseFloat(freqKhz);
  if (!v || !Number.isFinite(v) || v <= 0) return '—';
  if (type === 'NDB' || type === 'NDB-DME') return Math.round(v) + ' kHz';
  return (v / 1000).toFixed(2) + ' MHz';
}

async function ouvrirInfoNavaid(id) {
  if (!id) return;
  const overlay = document.getElementById('navaid-info-overlay');
  const identEl = document.getElementById('navaid-info-ident');
  const nameEl = document.getElementById('navaid-info-name');
  const typeEl = document.getElementById('navaid-info-type');
  const tableEl = document.getElementById('navaid-info-table');
  if (!overlay) return;

  identEl.textContent = '…';
  nameEl.textContent = currentLang === 'fr' ? 'Chargement…' : 'Loading…';
  typeEl.textContent = '';
  tableEl.innerHTML = '';
  overlay.classList.add('visible');

  let res;
  try { res = await window.api.detailsNavaid(id); }
  catch (err) {
    nameEl.textContent = 'Error: ' + err.message;
    return;
  }
  if (!res || !res.ok) {
    nameEl.textContent = currentLang === 'fr' ? 'Navaid introuvable' : 'Navaid not found';
    return;
  }

  const n = res.navaid;
  identEl.textContent = n.ident || '—';
  nameEl.textContent = n.name || '—';
  typeEl.textContent = n.type || '';

  const lat = parseFloat(n.latitude_deg);
  const lon = parseFloat(n.longitude_deg);

  const rows = [
    [currentLang === 'fr' ? 'Nom' : 'Name', escapeHtml(n.name || '—')],
    ['Ident', escapeHtml(n.ident || '—')],
    [currentLang === 'fr' ? 'Type' : 'Type', escapeHtml(n.type || '—')],
    [currentLang === 'fr' ? 'Fréquence' : 'Frequency', escapeHtml(formatNavaidFreqGlobal(n.type, n.frequency_khz))],
    [currentLang === 'fr' ? 'Pays' : 'Country', escapeHtml(n.iso_country || '—')],
    ['Latitude', Number.isFinite(lat) ? lat.toFixed(6) + '°' : '—'],
    ['Longitude', Number.isFinite(lon) ? lon.toFixed(6) + '°' : '—'],
    [currentLang === 'fr' ? 'Élévation' : 'Elevation', n.elevation_ft ? `${n.elevation_ft} ft` : '—'],
  ];
  tableEl.innerHTML = buildKVTable(rows);
}

function fermerInfoNavaid() {
  const overlay = document.getElementById('navaid-info-overlay');
  if (overlay) overlay.classList.remove('visible');
}

// Câblages globaux (boutons fermeture / overlay)
document.addEventListener('DOMContentLoaded', () => {
  // Modale aéroport
  const overlayAp = document.getElementById('airport-info-overlay');
  const btnCloseAp = document.getElementById('btn-airport-info-close');
  if (btnCloseAp) btnCloseAp.addEventListener('click', fermerInfoAeroport);
  if (overlayAp) {
    overlayAp.addEventListener('click', (e) => {
      if (e.target === overlayAp) fermerInfoAeroport();
    });
  }
  // Modale navaid
  const overlayNv = document.getElementById('navaid-info-overlay');
  const btnCloseNv = document.getElementById('btn-navaid-info-close');
  if (btnCloseNv) btnCloseNv.addEventListener('click', fermerInfoNavaid);
  if (overlayNv) {
    overlayNv.addEventListener('click', (e) => {
      if (e.target === overlayNv) fermerInfoNavaid();
    });
  }
  // Escape ferme les deux
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (overlayAp && overlayAp.classList.contains('visible')) fermerInfoAeroport();
    if (overlayNv && overlayNv.classList.contains('visible')) fermerInfoNavaid();
  });
});

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

// -------------------------------------------------------
// Rose des vents : met à jour la flèche + le panneau données.
// Convention aviation : windDir = direction d'où vient le vent.
// La flèche pointe vers où VA le vent (= windDir + 180°).
// -------------------------------------------------------
function updateWindRose(dir, speed, source) {
  const arrow = document.getElementById('wind-arrow');
  const dirEl = document.getElementById('wind-rose-dir');
  const spdEl = document.getElementById('wind-rose-speed');
  const srcEl = document.getElementById('wind-rose-source');

  // Normaliser direction sur 0..360
  let d = Number.isFinite(dir) ? dir : 0;
  d = ((d % 360) + 360) % 360;

  // Vitesse
  let v = Number.isFinite(speed) ? speed : 0;
  if (v < 0) v = 0;

  // Mise à jour de la flèche : pointe vers où VA le vent → rotation = d + 180
  if (arrow) {
    arrow.setAttribute('transform', `rotate(${d + 180})`);
    // Si vent calme, masquer la flèche
    arrow.style.opacity = v < 0.5 ? '0.2' : '1';
  }

  if (dirEl) dirEl.textContent = Math.round(d).toString().padStart(3, '0');
  if (spdEl) spdEl.textContent = Math.round(v).toString();

  if (srcEl) {
    if (source === 'msfs') {
      srcEl.textContent = (typeof t === 'function') ? t('windPanelSourceMSFS') : 'Depuis MSFS';
      srcEl.style.color = '#00e676';
    } else {
      srcEl.textContent = (typeof t === 'function') ? t('windPanelSourceManual') : 'Saisie manuelle';
      srcEl.style.color = '#666';
    }
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  console.log("UI NavXpressVFR chargée et prête.");

  // --- Chargement silencieux de la clé OpenAIP ---
  try {
    const savedKey = await window.api.lireCleOpenAIP();
    if (savedKey) {
      OPENAIP_API_KEY = savedKey;
      console.log("🔑 Clé OpenAIP chargée depuis le fichier de configuration.");
    }
  } catch (err) {
    console.warn("Impossible de lire la clé OpenAIP:", err);
  }

  // --- Bouton + Modale : API OpenAIP ---
  const btnApiOpenAIP = document.getElementById('btn-api-openaip');
  const apiOverlay = document.getElementById('api-openaip-overlay');
  const apiInput = document.getElementById('api-openaip-input');
  const apiHint = document.getElementById('api-openaip-hint');
  const apiTestResult = document.getElementById('api-test-result');
  const apiError = document.getElementById('api-openaip-error');
  const btnApiVisibility = document.getElementById('btn-api-toggle-visibility');
  const btnApiTest = document.getElementById('btn-api-test');
  const btnApiCancel = document.getElementById('btn-api-cancel');
  const btnApiValidate = document.getElementById('btn-api-validate');

  if (btnApiOpenAIP) {
    btnApiOpenAIP.addEventListener('click', () => {
      // Réinitialiser la modale
      apiInput.value = '';
      apiInput.type = 'password';
      btnApiVisibility.textContent = '👁️';
      apiTestResult.textContent = '';
      apiError.textContent = '';

      // Si une clé existe déjà, afficher le hint et masquer la valeur
      if (OPENAIP_API_KEY) {
        apiHint.style.display = 'block';
        apiHint.textContent = t('apiModalMaskedHint');
        apiInput.placeholder = '••••••••••••••••••••••••••••••••';
      } else {
        apiHint.style.display = 'none';
        apiInput.placeholder = t('apiModalPlaceholder');
      }

      apiOverlay.classList.add('visible');
      setTimeout(() => apiInput.focus(), 80);
    });
  }

  // Toggle visibilité clé
  if (btnApiVisibility) {
    btnApiVisibility.addEventListener('click', () => {
      if (apiInput.type === 'password') {
        apiInput.type = 'text';
        btnApiVisibility.textContent = '🙈';
      } else {
        apiInput.type = 'password';
        btnApiVisibility.textContent = '👁️';
      }
    });
  }

  // Tester la clé
  if (btnApiTest) {
    btnApiTest.addEventListener('click', async () => {
      const keyToTest = apiInput.value.trim() || OPENAIP_API_KEY;
      if (!keyToTest) {
        apiTestResult.style.color = '#ff5252';
        apiTestResult.textContent = t('apiEmptyKey');
        return;
      }
      apiTestResult.style.color = '#aaa';
      apiTestResult.textContent = t('apiTestLoading');
      btnApiTest.disabled = true;
      try {
        const resp = await fetch(
          'https://api.core.openaip.net/api/airports?page=1&limit=1',
          { headers: { 'x-openaip-api-key': keyToTest } }
        );
        if (resp.ok) {
          apiTestResult.style.color = '#00e676';
          apiTestResult.textContent = t('apiTestOk');
        } else {
          apiTestResult.style.color = '#ff5252';
          apiTestResult.textContent = t('apiTestFail');
        }
      } catch (err) {
        apiTestResult.style.color = '#ff5252';
        apiTestResult.textContent = t('apiTestFail');
      } finally {
        btnApiTest.disabled = false;
      }
    });
  }

  // Annuler
  if (btnApiCancel) {
    btnApiCancel.addEventListener('click', () => apiOverlay.classList.remove('visible'));
  }
  if (apiOverlay) {
    apiOverlay.addEventListener('click', (e) => {
      if (e.target === apiOverlay) apiOverlay.classList.remove('visible');
    });
  }

  // --- Modale de confirmation d'écrasement ---
  const apiConfirmOverlay = document.getElementById('api-confirm-overlay');
  const btnApiConfirmCancel = document.getElementById('btn-api-confirm-cancel');
  const btnApiConfirmOk = document.getElementById('btn-api-confirm-ok');
  let _pendingNewApiKey = null;

  async function doSaveApiKey(key) {
    apiError.style.color = '#aaa';
    apiError.textContent = currentLang === 'fr' ? '⏳ Sauvegarde...' : '⏳ Saving...';
    try {
      const result = await window.api.sauvegarderCleOpenAIP(key);
      const ok = (result === true) || (result && result.ok === true);
      if (ok) {
        OPENAIP_API_KEY = key;
        apiError.style.color = '#00e676';
        apiError.textContent = t('apiSaveSuccess');
        setTimeout(() => {
          apiOverlay.classList.remove('visible');
          apiError.textContent = '';
        }, 1200);
      } else {
        const msg = result && result.error ? result.error : t('apiSaveError');
        apiError.style.color = '#ff5252';
        apiError.textContent = '❌ ' + msg;
      }
    } catch (err) {
      console.error('doSaveApiKey error:', err);
      apiError.style.color = '#ff5252';
      apiError.textContent = '❌ ' + err.message;
    }
  }

  if (btnApiConfirmCancel) {
    btnApiConfirmCancel.addEventListener('click', () => {
      apiConfirmOverlay.classList.remove('visible');
      _pendingNewApiKey = null;
    });
  }
  if (apiConfirmOverlay) {
    apiConfirmOverlay.addEventListener('click', (e) => {
      if (e.target === apiConfirmOverlay) {
        apiConfirmOverlay.classList.remove('visible');
        _pendingNewApiKey = null;
      }
    });
  }
  if (btnApiConfirmOk) {
    btnApiConfirmOk.addEventListener('click', async () => {
      apiConfirmOverlay.classList.remove('visible');
      if (_pendingNewApiKey) {
        await doSaveApiKey(_pendingNewApiKey);
        _pendingNewApiKey = null;
      }
    });
  }

  // Valider (sauvegarder) — avec confirmation si une clé existe déjà
  if (btnApiValidate) {
    btnApiValidate.addEventListener('click', async () => {
      const newKey = apiInput.value.trim();
      apiError.textContent = '';

      // Champ vide + clé existante → fermer sans modifier
      if (!newKey && OPENAIP_API_KEY) {
        apiOverlay.classList.remove('visible');
        return;
      }
      if (!newKey) {
        apiError.style.color = '#ff5252';
        apiError.textContent = t('apiEmptyKey');
        return;
      }

      // Une ancienne clé existe → demander confirmation
      if (OPENAIP_API_KEY) {
        _pendingNewApiKey = newKey;
        // Appliquer les traductions sur la modale de confirmation
        apiConfirmOverlay.querySelectorAll('[data-i18n]').forEach(el => {
          el.textContent = t(el.getAttribute('data-i18n'));
        });
        apiConfirmOverlay.classList.add('visible');
      } else {
        // Pas d'ancienne clé → sauvegarder directement
        await doSaveApiKey(newKey);
      }
    });
  }

  // --- Bouton + Modales : Import OurAirports ---
  const btnImportOA = document.getElementById('btn-import-ourairports');
  const oaConfirmOverlay = document.getElementById('oa-confirm-overlay');
  const btnOaConfirmCancel = document.getElementById('btn-oa-confirm-cancel');
  const btnOaConfirmOk = document.getElementById('btn-oa-confirm-ok');
  const oaProgressOverlay = document.getElementById('oa-progress-overlay');
  const oaProgressList = document.getElementById('oa-progress-list');
  const oaProgressBarFill = document.getElementById('oa-progress-bar-fill');
  const oaProgressCount = document.getElementById('oa-progress-count');
  const oaProgressSummary = document.getElementById('oa-progress-summary');
  const btnOaProgressClose = document.getElementById('btn-oa-progress-close');

  let _oaImportInProgress = false;
  let _oaProgressUnsub = null;

  function applyI18nIn(el) {
    if (!el) return;
    el.querySelectorAll('[data-i18n]').forEach(n => {
      n.textContent = t(n.getAttribute('data-i18n'));
    });
  }

  async function lancerImportOurAirports() {
    if (_oaImportInProgress) return;
    _oaImportInProgress = true;

    // Réinitialiser la modale de progression
    applyI18nIn(oaProgressOverlay);
    oaProgressList.innerHTML = '';
    oaProgressBarFill.style.width = '0%';
    oaProgressCount.textContent = '0 / 0';
    oaProgressSummary.textContent = '';
    oaProgressSummary.style.color = '#888';
    btnOaProgressClose.disabled = true;
    oaProgressOverlay.classList.add('visible');

    // Map name -> <li> pour mise à jour rapide
    const itemByName = new Map();
    let totalFiles = 0;
    let doneCount = 0;

    // S'abonner aux events de progression
    if (_oaProgressUnsub) { try { _oaProgressUnsub(); } catch (_) { } }
    _oaProgressUnsub = window.api.onOurAirportsProgress((data) => {
      if (data.type === 'start') {
        totalFiles = data.total;
        doneCount = 0;
        oaProgressCount.textContent = `0 / ${totalFiles}`;
        oaProgressList.innerHTML = '';
        itemByName.clear();
        data.files.forEach(name => {
          const li = document.createElement('li');
          li.style.padding = '4px 8px';
          li.style.color = '#888';
          li.textContent = `⏸️ ${name}`;
          oaProgressList.appendChild(li);
          itemByName.set(name, li);
        });
      } else if (data.type === 'file-start') {
        const li = itemByName.get(data.name);
        if (li) {
          li.style.color = '#00bcd4';
          li.textContent = t('oaProgressDownloading')(data.name);
        }
      } else if (data.type === 'file-done') {
        const li = itemByName.get(data.name);
        if (li) {
          li.style.color = '#00e676';
          li.textContent = t('oaProgressFileOk')(data.name, data.count);
        }
        doneCount++;
        oaProgressCount.textContent = `${doneCount} / ${totalFiles}`;
        oaProgressBarFill.style.width = Math.round((doneCount / totalFiles) * 100) + '%';
      } else if (data.type === 'file-error') {
        const li = itemByName.get(data.name);
        if (li) {
          li.style.color = '#ff5252';
          li.textContent = t('oaProgressFileError')(data.name) + ' — ' + data.error;
        }
        doneCount++;
        oaProgressCount.textContent = `${doneCount} / ${totalFiles}`;
        oaProgressBarFill.style.width = Math.round((doneCount / totalFiles) * 100) + '%';
      } else if (data.type === 'done') {
        const okCount = data.results.filter(r => r.ok).length;
        const allOk = okCount === data.results.length;
        oaProgressSummary.style.color = allOk ? '#00e676' : '#ffb300';
        oaProgressSummary.innerHTML =
          `<div>${t('oaProgressDone')(okCount, data.results.length)}</div>` +
          `<div style="margin-top:4px; color:#888; font-size:11px; white-space:pre-wrap;">${t('oaProgressDoneDir')(data.dir)}</div>`;
        btnOaProgressClose.disabled = false;
      }
    });

    try {
      await window.api.importerOurAirports();
    } catch (err) {
      console.error('Import OurAirports échec:', err);
      oaProgressSummary.style.color = '#ff5252';
      oaProgressSummary.textContent = '❌ ' + err.message;
      btnOaProgressClose.disabled = false;
    } finally {
      _oaImportInProgress = false;
    }
  }

  if (btnImportOA) {
    btnImportOA.addEventListener('click', async () => {
      let existe = false;
      try { existe = await window.api.ourAirportsExiste(); } catch (_) { }
      if (existe) {
        applyI18nIn(oaConfirmOverlay);
        oaConfirmOverlay.classList.add('visible');
      } else {
        await lancerImportOurAirports();
      }
    });
  }

  if (btnOaConfirmCancel) {
    btnOaConfirmCancel.addEventListener('click', () => oaConfirmOverlay.classList.remove('visible'));
  }
  if (oaConfirmOverlay) {
    oaConfirmOverlay.addEventListener('click', (e) => {
      if (e.target === oaConfirmOverlay) oaConfirmOverlay.classList.remove('visible');
    });
  }
  if (btnOaConfirmOk) {
    btnOaConfirmOk.addEventListener('click', async () => {
      oaConfirmOverlay.classList.remove('visible');
      await lancerImportOurAirports();
    });
  }

  if (btnOaProgressClose) {
    btnOaProgressClose.addEventListener('click', () => {
      if (!btnOaProgressClose.disabled) oaProgressOverlay.classList.remove('visible');
    });
  }
  if (oaProgressOverlay) {
    oaProgressOverlay.addEventListener('click', (e) => {
      if (e.target === oaProgressOverlay && !btnOaProgressClose.disabled) {
        oaProgressOverlay.classList.remove('visible');
      }
    });
  }

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

  // --- Initialisation du système i18n ---
  initI18n();

  // --- Bouton toggle FR / EN ---
  const btnLang = document.getElementById('btn-lang-toggle');
  if (btnLang) {
    btnLang.addEventListener('click', () => {
      const newLang = currentLang === 'fr' ? 'en' : 'fr';
      setLanguage(newLang);
      // Redessiner le tableau (les en-têtes sont gérés par applyTranslations,
      // mais les lignes dynamiques doivent être regénérées)
      mettreAJourLogDeNav();
      // Mettre à jour le badge de statut simulateur (réapplique le texte dans la nouvelle langue)
      appliquerEtatSim(_simState);
      // Mettre à jour la déclinaison dans le titre
      actualiserAffichageDeclinaison();
      // Régénérer le dropdown des calques (libellés des toggles)
      if (typeof window._refreshLayersDropdown === 'function') window._refreshLayersDropdown();
      // Régénérer les tooltips aéroports (langue dans "Piste / Runway")
      if (typeof window._refreshAirports === 'function') window._refreshAirports();
    });
  }

  // --- 1. Initialisation de la carte Leaflet ---
  try {
    map = L.map('map-container', { zoomControl: true }).setView([46.5, 2.5], 6);

    // --- Couches de fond ---
    const layerSatellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Tiles &copy; Esri',
      maxZoom: 19
    });

    const layerTopo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://opentopomap.org">OpenTopoMap</a>',
      maxZoom: 17
    });

    const layerOSM = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19
    });

    const layers = [
      { key: 'satellite', layer: layerSatellite, label: '🛰️ Satellite', next: '🗺️ Topo' },
      { key: 'topo', layer: layerTopo, label: '🗺️ Topo', next: '🗺️ OSM' },
      { key: 'osm', layer: layerOSM, label: '🗺️ OSM', next: '🛰️ Satellite' },
    ];
    let currentLayerIdx = 2;
    layers[currentLayerIdx].layer.addTo(map);

    // --- Bouton déroulant de changement de fond ---
    const btnLayerToggle = L.control({ position: 'topright' });
    btnLayerToggle.onAdd = function () {
      const wrapper = L.DomUtil.create('div', 'layer-toggle-wrapper');
      L.DomEvent.disableClickPropagation(wrapper);
      L.DomEvent.disableScrollPropagation(wrapper);

      const btn = L.DomUtil.create('button', 'btn-layer-toggle', wrapper);
      btn.innerHTML = '🗺️ OSM ▾';

      const dropdown = L.DomUtil.create('div', 'layer-dropdown', wrapper);
      dropdown.style.display = 'none';

      const options = [
        { key: 'satellite', label: '🛰️ Satellite' },
        { key: 'topo', label: '🗺️ Topo' },
        { key: 'osm', label: '🗺️ OSM' },
      ];

      options.forEach(opt => {
        const item = L.DomUtil.create('div', 'layer-dropdown-item', dropdown);
        item.innerHTML = opt.label;
        if (opt.key === 'osm') item.classList.add('active');
        item.addEventListener('click', () => {
          map.removeLayer(layers[currentLayerIdx].layer);
          currentLayerIdx = layers.findIndex(l => l.key === opt.key);
          layers[currentLayerIdx].layer.addTo(map);
          // Si les espaces aériens sont activés, les remettre au premier plan
          // (sinon la nouvelle couche de tuiles les masque)
          if (airspacesVisible && airspaceTileLayer && airspaceTileLayer.bringToFront) {
            airspaceTileLayer.bringToFront();
          }
          btn.innerHTML = opt.label + ' ▾';
          dropdown.querySelectorAll('.layer-dropdown-item').forEach(el => el.classList.remove('active'));
          item.classList.add('active');
          dropdown.style.display = 'none';
        });
      });

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const wasOpen = dropdown.style.display !== 'none';
        // Fermer tous les dropdowns Leaflet ouverts (les nôtres uniquement)
        document.querySelectorAll('.layer-dropdown').forEach(d => { d.style.display = 'none'; });
        dropdown.style.display = wasOpen ? 'none' : 'block';
      });

      // Fermer si clic ailleurs
      document.addEventListener('click', (e) => {
        if (!wrapper.contains(e.target)) dropdown.style.display = 'none';
      });

      return wrapper;
    };
    btnLayerToggle.addTo(map);

    // --- ÉTAT DES COUCHES (espaces aériens, aéroports, navaids) ---
    let airspacesVisible = false;
    let airspaceTileLayer = null;
    let airportsEnabled = true;
    let navaidsEnabled = true;

    function creerCoucheEspacesAeriens() {
      // La clé API est injectée automatiquement par le main process via
      // session.defaultSession.webRequest.onBeforeSendHeaders — pas besoin
      // de l'exposer dans l'URL côté renderer.
      return L.tileLayer(
        'https://{s}.api.tiles.openaip.net/api/data/openaip/{z}/{x}/{y}.png',
        {
          subdomains: ['a', 'b', 'c'],
          attribution: '&copy; <a href="https://www.openaip.net">OpenAIP</a>',
          opacity: 0.85,
          maxZoom: 14,
          minZoom: 4,
          tileSize: 256
        }
      );
    }

    function setAirspacesVisible(on) {
      if (on && !OPENAIP_API_KEY) {
        alert(t('apiKeyMissing'));
        return false; // toggle refusé
      }
      if (on && !airspacesVisible) {
        airspaceTileLayer = creerCoucheEspacesAeriens();
        airspaceTileLayer.addTo(map);
        airspacesVisible = true;
      } else if (!on && airspacesVisible) {
        if (airspaceTileLayer) {
          map.removeLayer(airspaceTileLayer);
          airspaceTileLayer = null;
        }
        airspacesVisible = false;
      }
      return true;
    }

    // -------------------------------------------------------
    // Affichage des aéroports OurAirports (zoom >= 8)
    // -------------------------------------------------------
    const ZOOM_MIN_AEROPORTS = 8;
    const airportsLayer = L.layerGroup().addTo(map);
    let _aeroportsMoveTimer = null;
    let _aeroportsLastRequestId = 0;

    // Tailles selon le type d'aéroport (rayon du cercle)
    const TAILLES_AEROPORT = {
      large_airport: 9,
      medium_airport: 7,
      small_airport: 5,
    };

    // Construit l'icône SVG d'un aéroport (cercle + trait piste orienté)
    function makeAirportIcon(airport) {
      const r = TAILLES_AEROPORT[airport.type] || 5;
      const size = r * 2 + 12; // marge pour la piste qui dépasse + tooltip
      const heading = airport.runway ? airport.runway.headingDegT : 0;
      const hasRunway = !!airport.runway;

      // Le trait de piste dépasse de chaque côté du cercle ; sa rotation est
      // appliquée sur le <line> (centre = 0,0). L'icône globale n'est pas tournée.
      // Le trait est horizontal par défaut (E-W) ; un cap 0° = Nord (donc N-S
      // sur l'écran) → on soustrait 90° à la rotation.
      const lineExtent = r + 4;
      const rotation = heading - 90;
      const svg = `
        <svg viewBox="-${size / 2} -${size / 2} ${size} ${size}" width="${size}" height="${size}" style="overflow:visible;">
          ${hasRunway ? `<line x1="-${lineExtent}" y1="0" x2="${lineExtent}" y2="0"
                stroke="#000" stroke-width="2.2" stroke-linecap="round"
                transform="rotate(${rotation})"/>` : ''}
          <circle cx="0" cy="0" r="${r}" fill="#fff" stroke="#000" stroke-width="1.6"/>
        </svg>
      `;
      return L.divIcon({
        className: 'airport-marker',
        html: svg,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      });
    }

    // Tooltip HTML
    function makeAirportTooltipHtml(airport) {
      // Priorité : code calculé côté main (icao → gps → local → ident)
      const code = airport.code || airport.icao || airport.ident;
      const name = airport.name;
      let pisteLigne = '';
      if (airport.runway) {
        const heading = Math.round(airport.runway.headingDegT) % 360;
        pisteLigne = `<div class="ap-tt-rwy">${currentLang === 'fr' ? 'Piste' : 'Runway'} ${airport.runway.name} (${String(heading).padStart(3, '0')}°)</div>`;
      }
      return `
        <div class="ap-tt-icao">${code}</div>
        <div class="ap-tt-name">${name}</div>
        ${pisteLigne}
      `;
    }

    async function refreshAirportsOnMap() {
      if (!map) return;
      if (!airportsEnabled) {
        airportsLayer.clearLayers();
        return;
      }
      const zoom = map.getZoom();
      if (zoom < ZOOM_MIN_AEROPORTS) {
        airportsLayer.clearLayers();
        return;
      }
      const b = map.getBounds();
      const bbox = {
        south: b.getSouth(),
        west: b.getWest(),
        north: b.getNorth(),
        east: b.getEast(),
      };

      // Annule la dernière requête si une nouvelle arrive
      const reqId = ++_aeroportsLastRequestId;
      let res;
      try {
        res = await window.api.aeroportsDansBbox(bbox);
      } catch (err) {
        console.warn('Erreur lecture aéroports bbox:', err);
        return;
      }
      // Si une requête plus récente a déjà été envoyée, on ignore le résultat
      if (reqId !== _aeroportsLastRequestId) return;
      if (!res || !res.ok) {
        // Pas de données = silencieux (l'utilisateur n'a peut-être pas encore importé)
        airportsLayer.clearLayers();
        return;
      }

      airportsLayer.clearLayers();
      for (const a of res.airports) {
        const marker = L.marker([a.lat, a.lon], {
          icon: makeAirportIcon(a),
          interactive: true,
          keyboard: false,
        });
        marker.bindTooltip(makeAirportTooltipHtml(a), {
          direction: 'top',
          offset: [0, -8],
          className: 'airport-tooltip',
          opacity: 1,
          sticky: false,
        });
        // Click → ouvrir la modale d'informations détaillées
        marker.on('click', () => ouvrirInfoAeroport(a.ident));
        marker.addTo(airportsLayer);
      }
    }

    function scheduleAirportRefresh() {
      if (_aeroportsMoveTimer) clearTimeout(_aeroportsMoveTimer);
      _aeroportsMoveTimer = setTimeout(refreshAirportsOnMap, 200);
    }

    map.on('moveend', scheduleAirportRefresh);
    map.on('zoomend', scheduleAirportRefresh);
    // Premier render
    scheduleAirportRefresh();

    // Exposer pour debug / langue (le texte "Piste" / "Runway" doit changer)
    window._refreshAirports = refreshAirportsOnMap;

    // -------------------------------------------------------
    // Affichage des NAVAIDS OurAirports (zoom >= 8)
    // -------------------------------------------------------
    const ZOOM_MIN_NAVAIDS = 8;
    const NAV_COLOR = '#1565c0';
    const navaidsLayer = L.layerGroup().addTo(map);
    let _navaidsMoveTimer = null;
    let _navaidsLastRequestId = 0;

    // Formate la fréquence selon le type
    //   NDB / NDB-DME    → kHz
    //   VOR / VOR-DME / VORTAC / TACAN / DME → MHz
    function formatNavaidFreq(type, freqKhz) {
      if (!freqKhz || !Number.isFinite(freqKhz) || freqKhz <= 0) return '—';
      if (type === 'NDB' || type === 'NDB-DME') {
        return Math.round(freqKhz) + ' kHz';
      }
      // MHz = kHz / 1000, 2 décimales
      return (freqKhz / 1000).toFixed(2) + ' MHz';
    }

    // Génère l'icône SVG selon le type. Toutes les icônes sont en bleu sur fond blanc.
    function makeNavaidIcon(navaid) {
      const type = navaid.type;
      const C = NAV_COLOR;
      const size = 22;
      const sw = 1.6;
      let inner = '';

      // Géométries de base
      const hexPts = '-7,4 -7,-4 0,-8 7,-4 7,4 0,8';
      const hexInsidePts = '-5,2.9 -5,-2.9 0,-5.8 5,-2.9 5,2.9 0,5.8';

      switch (type) {
        case 'VOR':
          inner = `
            <polygon points="${hexPts}" fill="#fff" stroke="${C}" stroke-width="${sw}"/>
            <circle cx="0" cy="0" r="1.6" fill="${C}"/>
          `;
          break;
        case 'VOR-DME':
          inner = `
            <rect x="-9" y="-9" width="18" height="18" fill="#fff" stroke="${C}" stroke-width="${sw}"/>
            <polygon points="${hexInsidePts}" fill="#fff" stroke="${C}" stroke-width="1.3"/>
            <circle cx="0" cy="0" r="1.4" fill="${C}"/>
          `;
          break;
        case 'VORTAC':
          // Hexagone + 3 petites barres aux sommets alternés (haut, bas-gauche, bas-droit)
          inner = `
            <rect x="-2.6" y="-11" width="5.2" height="3" fill="${C}"/>
            <rect x="-2.6" y="-1.5" width="5.2" height="3" fill="${C}" transform="rotate(120 0 0) translate(0 9.5)"/>
            <rect x="-2.6" y="-1.5" width="5.2" height="3" fill="${C}" transform="rotate(-120 0 0) translate(0 9.5)"/>
            <polygon points="${hexPts}" fill="#fff" stroke="${C}" stroke-width="${sw}"/>
            <circle cx="0" cy="0" r="1.6" fill="${C}"/>
          `;
          break;
        case 'TACAN':
          // Triangle équilatéral pointe en haut
          inner = `
            <polygon points="0,-8 7,5 -7,5" fill="#fff" stroke="${C}" stroke-width="${sw}"/>
            <circle cx="0" cy="1" r="1.4" fill="${C}"/>
          `;
          break;
        case 'NDB':
          // Cercle pointillé + point central
          inner = `
            <circle cx="0" cy="0" r="7" fill="#fff" stroke="${C}" stroke-width="1.5" stroke-dasharray="1.8 1.8"/>
            <circle cx="0" cy="0" r="1.8" fill="${C}"/>
          `;
          break;
        case 'NDB-DME':
          inner = `
            <rect x="-9" y="-9" width="18" height="18" fill="#fff" stroke="${C}" stroke-width="${sw}"/>
            <circle cx="0" cy="0" r="5.5" fill="#fff" stroke="${C}" stroke-width="1.4" stroke-dasharray="1.6 1.6"/>
            <circle cx="0" cy="0" r="1.6" fill="${C}"/>
          `;
          break;
        case 'DME':
        default:
          inner = `
            <rect x="-7" y="-7" width="14" height="14" fill="#fff" stroke="${C}" stroke-width="${sw}"/>
            <text x="0" y="3.5" text-anchor="middle" fill="${C}" font-size="8" font-weight="bold" font-family="Arial, sans-serif">D</text>
          `;
          break;
      }

      const svg = `
        <svg viewBox="-12 -12 24 24" width="${size}" height="${size}" style="overflow:visible;">
          ${inner}
        </svg>
      `;
      return L.divIcon({
        className: 'navaid-marker',
        html: svg,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      });
    }

    function makeNavaidTooltipHtml(navaid) {
      const freqLabel = formatNavaidFreq(navaid.type, navaid.freqKhz);
      return `
        <div class="nv-tt-ident">${escapeHtml(navaid.ident || '')}</div>
        <div class="nv-tt-type">${escapeHtml(navaid.type)}</div>
        <div class="nv-tt-freq">${freqLabel}</div>
      `;
    }

    async function refreshNavaidsOnMap() {
      if (!map) return;
      if (!navaidsEnabled) {
        navaidsLayer.clearLayers();
        return;
      }
      const zoom = map.getZoom();
      if (zoom < ZOOM_MIN_NAVAIDS) {
        navaidsLayer.clearLayers();
        return;
      }
      const b = map.getBounds();
      const bbox = {
        south: b.getSouth(),
        west: b.getWest(),
        north: b.getNorth(),
        east: b.getEast(),
      };
      const reqId = ++_navaidsLastRequestId;
      let res;
      try { res = await window.api.navaidsDansBbox(bbox); }
      catch (err) { console.warn('Erreur lecture navaids bbox:', err); return; }
      if (reqId !== _navaidsLastRequestId) return;
      if (!res || !res.ok) { navaidsLayer.clearLayers(); return; }

      navaidsLayer.clearLayers();
      for (const n of res.navaids) {
        const marker = L.marker([n.lat, n.lon], {
          icon: makeNavaidIcon(n),
          interactive: true,
          keyboard: false,
        });
        marker.bindTooltip(makeNavaidTooltipHtml(n), {
          direction: 'top',
          offset: [0, -8],
          className: 'navaid-tooltip',
          opacity: 1,
          sticky: false,
        });
        marker.on('click', () => ouvrirInfoNavaid(n.id));
        marker.addTo(navaidsLayer);
      }
    }

    function scheduleNavaidRefresh() {
      if (_navaidsMoveTimer) clearTimeout(_navaidsMoveTimer);
      _navaidsMoveTimer = setTimeout(refreshNavaidsOnMap, 200);
    }
    map.on('moveend', scheduleNavaidRefresh);
    map.on('zoomend', scheduleNavaidRefresh);
    scheduleNavaidRefresh();
    window._refreshNavaids = refreshNavaidsOnMap;

    // Bascule labels permanents / hover des waypoints à chaque changement de zoom
    map.on('zoomend', updateAllWaypointLabels);

    // --- Bouton déroulant des CALQUES (Espaces aériens / Aéroports / Navaids) ---
    // Placé à gauche du dropdown des fonds de carte (grâce au row-reverse CSS sur topright)
    const btnLayersFilter = L.control({ position: 'topright' });
    btnLayersFilter.onAdd = function () {
      const wrapper = L.DomUtil.create('div', 'layer-toggle-wrapper layers-filter-wrapper');
      L.DomEvent.disableClickPropagation(wrapper);
      L.DomEvent.disableScrollPropagation(wrapper);

      const btn = L.DomUtil.create('button', 'btn-layer-toggle', wrapper);
      const dropdown = L.DomUtil.create('div', 'layer-dropdown layers-filter-dropdown', wrapper);
      dropdown.style.display = 'none';

      // Construit (ou reconstruit, après changement de langue) le contenu
      function rebuild() {
        btn.innerHTML = (currentLang === 'fr' ? '🗂️ Calques' : '🗂️ Layers') + ' ▾';
        dropdown.innerHTML = '';
        const items = [
          { id: 'airspaces', labelFr: 'Espaces aériens', labelEn: 'Airspaces', checked: airspacesVisible },
          { id: 'airports', labelFr: 'Aéroports', labelEn: 'Airports', checked: airportsEnabled },
          { id: 'navaids', labelFr: 'Navaids', labelEn: 'Navaids', checked: navaidsEnabled },
        ];
        items.forEach(it => {
          const row = L.DomUtil.create('label', 'layer-toggle-row', dropdown);
          row.innerHTML = `
            <span>${currentLang === 'fr' ? it.labelFr : it.labelEn}</span>
            <input type="checkbox" class="toggle-switch" data-layer="${it.id}" ${it.checked ? 'checked' : ''}>
          `;
          const input = row.querySelector('input');
          L.DomEvent.on(input, 'click', e => e.stopPropagation());
          L.DomEvent.on(input, 'change', () => {
            const on = input.checked;
            if (it.id === 'airspaces') {
              const ok = setAirspacesVisible(on);
              if (!ok) input.checked = false; // ex: pas de clé API → toggle refusé
            } else if (it.id === 'airports') {
              airportsEnabled = on;
              if (on) refreshAirportsOnMap(); else airportsLayer.clearLayers();
            } else if (it.id === 'navaids') {
              navaidsEnabled = on;
              if (on) refreshNavaidsOnMap(); else navaidsLayer.clearLayers();
            }
          });
        });
      }
      rebuild();
      window._refreshLayersDropdown = rebuild;

      btn.addEventListener('click', e => {
        e.stopPropagation();
        const wasOpen = dropdown.style.display !== 'none';
        document.querySelectorAll('.layer-dropdown').forEach(d => { d.style.display = 'none'; });
        dropdown.style.display = wasOpen ? 'none' : 'block';
      });
      document.addEventListener('click', e => {
        if (!wrapper.contains(e.target)) dropdown.style.display = 'none';
      });

      return wrapper;
    };
    btnLayersFilter.addTo(map);

    console.log("Carte Leaflet initialisée avec succès.");
  } catch (mapError) {
    console.error("Erreur d'initialisation de la carte:", mapError);
  }

  // --- 2. BOUTON : NOUVEAU (reset) ---
  const btnNew = document.getElementById('btn-new-flight');
  const confirmResetOverlay = document.getElementById('confirm-reset-overlay');
  const btnConfirmResetOk = document.getElementById('btn-confirm-reset-ok');
  const btnConfirmResetCancel = document.getElementById('btn-confirm-reset-cancel');

  function doReset() {
    flightPlan = [];
    legAltitudes = [];
    declinaisonMoyenneGlobale = 0.0;
    activeLegIndex = 1;
    document.getElementById('input-icao-dep').value = '';
    document.getElementById('input-icao-arr').value = '';
    marqueursCarte.forEach(m => map.removeLayer(m));
    marqueursCarte = [];
    supprimerSegmentsCarte();
    actualiserAffichageDeclinaison();
    mettreAJourLogDeNav();
  }

  if (btnNew) {
    btnNew.addEventListener('click', () => {
      confirmResetOverlay.style.display = 'flex';
    });
  }

  btnConfirmResetOk.addEventListener('click', () => {
    confirmResetOverlay.style.display = 'none';
    doReset();
  });

  btnConfirmResetCancel.addEventListener('click', () => {
    confirmResetOverlay.style.display = 'none';
  });

  confirmResetOverlay.addEventListener('click', (e) => {
    if (e.target === confirmResetOverlay) confirmResetOverlay.style.display = 'none';
  });

  // --- Modale : confirmation suppression leg — listeners (scope DOMContentLoaded) ---
  document.getElementById('btn-confirm-delete-ok').addEventListener('click', () => {
    document.getElementById('confirm-delete-overlay').style.display = 'none';
    if (window._deleteLegCallback) { window._deleteLegCallback(); window._deleteLegCallback = null; }
  });

  document.getElementById('btn-confirm-delete-cancel').addEventListener('click', () => {
    document.getElementById('confirm-delete-overlay').style.display = 'none';
    window._deleteLegCallback = null;
  });

  document.getElementById('confirm-delete-overlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('confirm-delete-overlay')) {
      document.getElementById('confirm-delete-overlay').style.display = 'none';
      window._deleteLegCallback = null;
    }
  });

  // --- Modale : édition leg — listeners ---
  window._editLegIndex = null;

  // Helper : ferme la modale Édit leg + nettoie les états de recherche
  function fermerModaleEditLeg() {
    document.getElementById('edit-leg-overlay').style.display = 'none';
    // Invalider toute recherche en cours et vider les résultats
    ['search-results-edit-dep', 'search-results-edit-arr'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el._searchReqId = (el._searchReqId || 0) + 1; // invalide les réponses pendantes
        el.innerHTML = '';
        el.classList.remove('visible');
      }
    });
    ['search-status-edit-dep', 'search-status-edit-arr'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.textContent = ''; el.className = 'search-status'; }
    });
  }

  document.getElementById('btn-edit-leg-cancel').addEventListener('click', fermerModaleEditLeg);

  document.getElementById('edit-leg-overlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('edit-leg-overlay'))
      fermerModaleEditLeg();
  });

  // Helper : afficher/cacher + sync checkbox d'une rangée pattern d'Édit Leg
  function _syncEditLegPatternRow(side) {
    const nameEl = document.getElementById(`edit-leg-${side}-name`);
    const row = document.getElementById(`edit-leg-${side}-pattern-row`);
    const cb = document.getElementById(`edit-leg-${side}-pattern-cb`);
    if (!nameEl || !row || !cb) return;
    const isPattern = nameEl.dataset.pattern === 'true';
    if (isPattern) {
      row.style.display = 'block';
      cb.checked = true;
    } else {
      // On garde la rangée visible si elle l'était déjà (l'utilisateur peut
      // re-cocher après avoir décoché). Sinon, on la laisse cachée.
      cb.checked = false;
    }
  }

  // Recherche multi pour Édit leg — Départ (avec question Tour de piste si aéroport)
  document.getElementById('btn-search-edit-dep').addEventListener('click', () => {
    rechercherMulti({
      code: document.getElementById('edit-leg-dep-name').value,
      statusEl: document.getElementById('search-status-edit-dep'),
      resultsEl: document.getElementById('search-results-edit-dep'),
      latEl: document.getElementById('edit-leg-dep-lat'),
      lonEl: document.getElementById('edit-leg-dep-lon'),
      latRadioName: 'edit-dep-lat-dir',
      lonRadioName: 'edit-dep-lon-dir',
      nameEl: document.getElementById('edit-leg-dep-name'),
      askPatternOnAirport: true,
      onPatternSet: () => _syncEditLegPatternRow('dep'),
    });
  });

  // Recherche multi pour Édit leg — Arrivée (avec question Tour de piste si aéroport)
  document.getElementById('btn-search-edit-arr').addEventListener('click', () => {
    rechercherMulti({
      code: document.getElementById('edit-leg-arr-name').value,
      statusEl: document.getElementById('search-status-edit-arr'),
      resultsEl: document.getElementById('search-results-edit-arr'),
      latEl: document.getElementById('edit-leg-arr-lat'),
      lonEl: document.getElementById('edit-leg-arr-lon'),
      latRadioName: 'edit-arr-lat-dir',
      lonRadioName: 'edit-arr-lon-dir',
      nameEl: document.getElementById('edit-leg-arr-name'),
      askPatternOnAirport: true,
      onPatternSet: () => _syncEditLegPatternRow('arr'),
    });
  });

  // Décochage de la checkbox → met à jour dataset.pattern (la rangée reste visible
  // pour permettre une re-cochage sans avoir à re-rechercher)
  document.getElementById('edit-leg-dep-pattern-cb').addEventListener('change', e => {
    document.getElementById('edit-leg-dep-name').dataset.pattern = e.target.checked ? 'true' : '';
  });
  document.getElementById('edit-leg-arr-pattern-cb').addEventListener('change', e => {
    document.getElementById('edit-leg-arr-name').dataset.pattern = e.target.checked ? 'true' : '';
  });

  document.getElementById('btn-edit-leg-validate').addEventListener('click', () => {
    const legIndex = window._editLegIndex;
    if (legIndex === null) return;
    const errEl = document.getElementById('edit-leg-error');
    errEl.textContent = '';

    // Lire et valider les champs
    function readPoint(nameId, latId, latRadio, lonId, lonRadio) {
      const name = document.getElementById(nameId).value.trim();
      const latRaw = parseFloat(document.getElementById(latId).value);
      const lonRaw = parseFloat(document.getElementById(lonId).value);
      const latDir = document.querySelector(`input[name="${latRadio}"]:checked`)?.value || 'N';
      const lonDir = document.querySelector(`input[name="${lonRadio}"]:checked`)?.value || 'E';
      if (!name || isNaN(latRaw) || isNaN(lonRaw)) return null;
      if (latRaw < 0 || latRaw > 90 || lonRaw < 0 || lonRaw > 180) return null;
      return {
        name, ident: name,
        lat: latDir === 'N' ? latRaw : -latRaw,
        lon: lonDir === 'E' ? lonRaw : -lonRaw
      };
    }

    const newDep = readPoint('edit-leg-dep-name', 'edit-leg-dep-lat', 'edit-dep-lat-dir', 'edit-leg-dep-lon', 'edit-dep-lon-dir');
    const newArr = readPoint('edit-leg-arr-name', 'edit-leg-arr-lat', 'edit-arr-lat-dir', 'edit-leg-arr-lon', 'edit-arr-lon-dir');

    if (!newDep || !newArr) {
      errEl.textContent = t('fillFields');
      return;
    }

    // Récupérer l'état "Tour de piste prévu" depuis dataset.pattern
    newDep.pattern = document.getElementById('edit-leg-dep-name').dataset.pattern === 'true';
    newArr.pattern = document.getElementById('edit-leg-arr-name').dataset.pattern === 'true';

    // Appliquer — les deux points sont partagés avec les legs adjacents
    flightPlan[legIndex - 1] = { ...flightPlan[legIndex - 1], ...newDep };
    flightPlan[legIndex] = { ...flightPlan[legIndex], ...newArr };

    fermerModaleEditLeg();

    // Recalculer et redessiner toute la carte
    marqueursCarte.forEach(m => map.removeLayer(m));
    marqueursCarte = [];
    supprimerSegmentsCarte();
    flightPlan.forEach((p, idx) => tracerPointVisuel(p, idx));
    redessinerSegments();
    if (flightPlan.length > 1) {
      const bounds = L.latLngBounds(flightPlan.map(p => [p.lat, p.lon]));
      map.fitBounds(bounds, { padding: [50, 50], animate: false });
    }
    mettreAJourLogDeNav();
  });

  // --- 3. BOUTON : CRÉER PLAN DE VOL ---
  const btnCreate = document.getElementById('btn-create-flight');
  const createOverlay = document.getElementById('create-flight-overlay');
  const btnCreateCancel = document.getElementById('btn-create-cancel');
  const btnCreateValidate = document.getElementById('btn-create-validate');

  if (btnCreate && createOverlay) {
    // Ouvrir la modale
    btnCreate.addEventListener('click', () => {
      const depIcao = document.getElementById('create-icao-dep');
      const arrIcao = document.getElementById('create-icao-arr');
      depIcao.value = '';
      arrIcao.value = '';
      depIcao.dataset.pattern = ''; // reset des flags tour de piste
      arrIcao.dataset.pattern = '';
      document.getElementById('create-lat-dep').value = '';
      document.getElementById('create-lon-dep').value = '';
      document.getElementById('create-lat-arr').value = '';
      document.getElementById('create-lon-arr').value = '';
      document.getElementById('create-flight-error').textContent = '';
      document.getElementById('search-status-dep').textContent = '';
      document.getElementById('search-status-arr').textContent = '';
      document.getElementById('search-status-dep').className = 'search-status';
      document.getElementById('search-status-arr').className = 'search-status';
      createOverlay.classList.add('visible');
    });

    // Fermer sur Annuler
    btnCreateCancel.addEventListener('click', () => {
      createOverlay.classList.remove('visible');
    });

    // Fermer en cliquant sur le fond
    createOverlay.addEventListener('click', (e) => {
      if (e.target === createOverlay) createOverlay.classList.remove('visible');
    });

    // Boutons Rechercher
    const searchDepInput = document.getElementById('create-icao-dep');
    const searchArrInput = document.getElementById('create-icao-arr');

    document.getElementById('btn-search-dep').addEventListener('click', () => {
      rechercherAeroport(
        document.getElementById('create-icao-dep').value,
        document.getElementById('search-status-dep'),
        document.getElementById('create-lat-dep'),
        document.getElementById('create-lon-dep'),
        document.getElementById('create-icao-dep')
      );
    });

    document.getElementById('btn-search-arr').addEventListener('click', () => {
      rechercherAeroport(
        document.getElementById('create-icao-arr').value,
        document.getElementById('search-status-arr'),
        document.getElementById('create-lat-arr'),
        document.getElementById('create-lon-arr'),
        document.getElementById('create-icao-arr')
      );
    });

    // Validation chiffres décimaux uniquement sur les champs coord de la modale création
    ['create-lat-dep', 'create-lon-dep', 'create-lat-arr', 'create-lon-arr'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', () => {
        let v = el.value.replace(/[^0-9.]/g, '');
        const parts = v.split('.');
        if (parts.length > 2) v = parts[0] + '.' + parts.slice(1).join('');
        el.value = v;
      });
    });

    // Valider le plan de vol
    btnCreateValidate.addEventListener('click', async () => {
      const icaoDep = document.getElementById('create-icao-dep').value.trim().toUpperCase();
      const latDepRaw = parseFloat(document.getElementById('create-lat-dep').value);
      const lonDepRaw = parseFloat(document.getElementById('create-lon-dep').value);
      const icaoArr = document.getElementById('create-icao-arr').value.trim().toUpperCase();
      const latArrRaw = parseFloat(document.getElementById('create-lat-arr').value);
      const lonArrRaw = parseFloat(document.getElementById('create-lon-arr').value);
      const errEl = document.getElementById('create-flight-error');

      // Lecture des directions (radios)
      const depLatDir = document.querySelector('input[name="dep-lat-dir"]:checked').value;
      const depLonDir = document.querySelector('input[name="dep-lon-dir"]:checked').value;
      const arrLatDir = document.querySelector('input[name="arr-lat-dir"]:checked').value;
      const arrLonDir = document.querySelector('input[name="arr-lon-dir"]:checked').value;

      // Application du signe selon N/S et E/W
      const latDep = depLatDir === 'S' ? -Math.abs(latDepRaw) : Math.abs(latDepRaw);
      const lonDep = depLonDir === 'W' ? -Math.abs(lonDepRaw) : Math.abs(lonDepRaw);
      const latArr = arrLatDir === 'S' ? -Math.abs(latArrRaw) : Math.abs(latArrRaw);
      const lonArr = arrLonDir === 'W' ? -Math.abs(lonArrRaw) : Math.abs(lonArrRaw);

      // Validation
      if (!icaoDep || !icaoArr) {
        errEl.textContent = currentLang === 'fr' ? 'Veuillez renseigner les codes ICAO.' : 'Please enter ICAO codes.';
        return;
      }
      if (isNaN(latDepRaw) || isNaN(lonDepRaw) || isNaN(latArrRaw) || isNaN(lonArrRaw)) {
        errEl.textContent = currentLang === 'fr' ? 'Veuillez renseigner toutes les coordonnées.' : 'Please fill in all coordinates.';
        return;
      }

      // Réinitialiser le plan
      flightPlan = [];
      legAltitudes = [];
      activeLegIndex = 1;
      marqueursCarte.forEach(m => map.removeLayer(m));
      marqueursCarte = [];
      supprimerSegmentsCarte();

      // Détecter vol local (départ == arrivée) → triangle équilatéral ~10 nm
      const isVolLocal = (icaoDep === icaoArr) ||
        (Math.abs(latDep - latArr) < 0.0001 && Math.abs(lonDep - lonArr) < 0.0001);

      if (isVolLocal) {
        const NM_PAR_DEGRE_LAT = 60.0;
        const coteNM = 10.0;
        const hauteurNM = coteNM * Math.sqrt(3) / 2;
        const demiBaseNM = coteNM / 2;
        const facteurLon = Math.cos(latDep * Math.PI / 180);

        const wp1 = {
          name: 'WP1', ident: 'WP1',
          lat: latDep + (hauteurNM / 3) / NM_PAR_DEGRE_LAT,
          lon: lonDep - demiBaseNM / (NM_PAR_DEGRE_LAT * facteurLon)
        };
        const wp2 = {
          name: 'WP2', ident: 'WP2',
          lat: latDep + (hauteurNM / 3) / NM_PAR_DEGRE_LAT,
          lon: lonDep + demiBaseNM / (NM_PAR_DEGRE_LAT * facteurLon)
        };

        flightPlan.push({ name: icaoDep, ident: icaoDep, lat: latDep, lon: lonDep });
        flightPlan.push(wp1);
        flightPlan.push(wp2);
        flightPlan.push({ name: icaoArr, ident: icaoArr, lat: latArr, lon: lonArr });
        legAltitudes = [undefined, ALT_DEFAULT, ALT_DEFAULT, ALT_DEFAULT];
      } else {
        // Vol normal départ → arrivée
        flightPlan.push({ name: icaoDep, ident: icaoDep, lat: latDep, lon: lonDep });
        flightPlan.push({ name: icaoArr, ident: icaoArr, lat: latArr, lon: lonArr });
        legAltitudes = [undefined, ALT_DEFAULT];
      }

      // Appliquer les flags "Tour de piste prévu" sur les waypoints concernés
      const depPattern = document.getElementById('create-icao-dep').dataset.pattern === 'true';
      const arrPattern = document.getElementById('create-icao-arr').dataset.pattern === 'true';
      if (depPattern) flightPlan[0].pattern = true;
      if (arrPattern) flightPlan[flightPlan.length - 1].pattern = true;

      // Injecter dans les champs ICAO de la config vol
      document.getElementById('input-icao-dep').value = icaoDep;
      document.getElementById('input-icao-arr').value = icaoArr;

      // Tracer sur la carte
      await calculerDeclinaisonCentroide();
      flightPlan.forEach((p, idx) => tracerPointVisuel(p, idx));
      redessinerSegments();
      const bounds = L.latLngBounds(flightPlan.map(p => [p.lat, p.lon]));
      map.fitBounds(bounds, { padding: [50, 50] });

      mettreAJourLogDeNav();

      // Fermer la modale
      createOverlay.classList.remove('visible');
    });
  }

  // --- 4. BOUTON : IMPORTER .LNMPLN ---
  const btnImport = document.getElementById('btn-import-lnm');
  if (btnImport) {
    btnImport.addEventListener('click', async () => {
      console.log("Clic sur Importer LNMPLN");
      const xmlContenu = await window.api.ouvrirLNM();
      if (!xmlContenu) {
        console.log(t('importCancelled'));
        return;
      }

      try {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlContenu, "text/xml");
        const waypointsXML = xmlDoc.getElementsByTagName("Waypoint");

        if (waypointsXML.length === 0) {
          alert(t('noWaypointsInFile'));
          return;
        }

        console.log(`${waypointsXML.length} waypoints détectés dans le XML.`);

        flightPlan = [];
        legAltitudes = [];
        activeLegIndex = 1;
        marqueursCarte.forEach(m => map.removeLayer(m));
        marqueursCarte = [];
        supprimerSegmentsCarte();

        for (let i = 0; i < waypointsXML.length; i++) {
          const wp = waypointsXML[i];
          const ident = wp.getElementsByTagName("Ident")[0]?.textContent || `WP${i}`;
          const name = wp.getElementsByTagName("Name")[0]?.textContent || ident;
          const pos = wp.getElementsByTagName("Pos")[0];

          if (pos) {
            const lat = parseFloat(pos.getAttribute("Lat"));
            const lon = parseFloat(pos.getAttribute("Lon"));
            if (!isNaN(lat) && !isNaN(lon)) {
              flightPlan.push({ name, ident, lat, lon });
            }
          }
        }

        console.log("Plan de vol extrait en mémoire:", flightPlan);

        // Initialiser les altitudes à ALT_DEFAULT pour chaque leg importé
        legAltitudes = [undefined]; // index 0 inutilisé
        for (let i = 1; i < flightPlan.length; i++) legAltitudes.push(ALT_DEFAULT);

        // Injection des ICAO départ / arrivée dans la config vol
        if (flightPlan.length >= 1) {
          const inputDep = document.getElementById('input-icao-dep');
          const inputArr = document.getElementById('input-icao-arr');
          if (inputDep) inputDep.value = flightPlan[0].ident;
          if (inputArr) inputArr.value = flightPlan[flightPlan.length - 1].ident;
        }

        await calculerDeclinaisonCentroide();
        flightPlan.forEach((p, idx) => tracerPointVisuel(p, idx));
        redessinerSegments();

        if (flightPlan.length > 0) {
          const bounds = L.latLngBounds(flightPlan.map(p => [p.lat, p.lon]));
          map.fitBounds(bounds, { padding: [50, 50] });
        }

        mettreAJourLogDeNav();

      } catch (error) {
        console.error("Erreur lors de l'analyse du plan de vol:", error);
        alert(t('parseError') + error.message);
      }
    });
  }

  // --- 4. BOUTON : CHARGER PLAN DE VOL (.navxpv natif) ---
  const btnLoad = document.getElementById('btn-load-flight');
  if (btnLoad) {
    btnLoad.addEventListener('click', async () => {
      const res = await window.api.ouvrirNavXpv();
      if (!res) return; // annulation
      if (!res.ok || !res.data) {
        alert(t('navxpvParseError') + (res && res.error ? res.error : ''));
        return;
      }
      const data = res.data;

      // Validation minimale
      if (data.format !== 'navxpv' || !Array.isArray(data.waypoints)) {
        alert(t('navxpvBadFormat'));
        return;
      }

      try {
        // Réinitialiser l'état actuel
        flightPlan = [];
        legAltitudes = [];
        activeLegIndex = 1;
        marqueursCarte.forEach(m => map.removeLayer(m));
        marqueursCarte = [];
        supprimerSegmentsCarte();

        // Re-peupler les waypoints
        for (const wp of data.waypoints) {
          if (typeof wp.lat === 'number' && typeof wp.lon === 'number') {
            const entry = {
              name: wp.name || wp.ident || '',
              ident: wp.ident || wp.name || '',
              lat: wp.lat,
              lon: wp.lon,
            };
            if (wp.pattern) entry.pattern = true;
            flightPlan.push(entry);
          }
        }

        // Altitudes (null → undefined pour respecter la convention interne)
        if (Array.isArray(data.legAltitudes) && data.legAltitudes.length === flightPlan.length) {
          legAltitudes = data.legAltitudes.map(a => (a === null ? undefined : a));
        } else {
          legAltitudes = [undefined];
          for (let i = 1; i < flightPlan.length; i++) legAltitudes.push(ALT_DEFAULT);
        }

        // Config (Vp + vent)
        if (data.config) {
          const inputVp = document.getElementById('input-vp');
          const inputWindDir = document.getElementById('input-wind-dir');
          const inputWindSpeed = document.getElementById('input-wind-speed');
          if (inputVp && typeof data.config.trueAirspeed === 'number') inputVp.value = data.config.trueAirspeed;
          if (inputWindDir && typeof data.config.windDirection === 'number') inputWindDir.value = data.config.windDirection;
          if (inputWindSpeed && typeof data.config.windSpeed === 'number') inputWindSpeed.value = data.config.windSpeed;
          // Rafraîchir la rose des vents
          if (typeof updateWindRose === 'function') {
            updateWindRose(
              data.config.windDirection ?? 0,
              data.config.windSpeed ?? 0,
              'manual'
            );
          }
        }

        // ICAO départ / arrivée (champs en lecture seule, peuplés depuis le plan)
        if (flightPlan.length >= 1) {
          const inputDep = document.getElementById('input-icao-dep');
          const inputArr = document.getElementById('input-icao-arr');
          if (inputDep) inputDep.value = flightPlan[0].ident;
          if (inputArr) inputArr.value = flightPlan[flightPlan.length - 1].ident;
        }

        await calculerDeclinaisonCentroide();
        flightPlan.forEach((p, idx) => tracerPointVisuel(p, idx));
        redessinerSegments();

        if (flightPlan.length > 0) {
          const bounds = L.latLngBounds(flightPlan.map(p => [p.lat, p.lon]));
          map.fitBounds(bounds, { padding: [50, 50] });
        }

        mettreAJourLogDeNav();
      } catch (err) {
        console.error('Erreur chargement .navxpv:', err);
        alert(t('navxpvParseError') + err.message);
      }
    });
  }

  // --- 4. BOUTON : SAUVEGARDER (.navxpv natif uniquement) ---
  const btnSave = document.getElementById('btn-save-flight');
  if (btnSave) {
    btnSave.addEventListener('click', async () => {
      if (flightPlan.length === 0) {
        alert(t('nothingToSave'));
        return;
      }

      const planData = {
        format: 'navxpv',
        version: 1,
        savedAt: new Date().toISOString(),
        config: {
          trueAirspeed: parseFloat(document.getElementById('input-vp').value) || 90,
          windDirection: parseFloat(document.getElementById('input-wind-dir').value) || 0,
          windSpeed: parseFloat(document.getElementById('input-wind-speed').value) || 0,
        },
        // Snapshot des waypoints (on ne sérialise pas d'éventuels objets Leaflet)
        waypoints: flightPlan.map(wp => ({
          name: wp.name,
          ident: wp.ident || wp.name,
          lat: wp.lat,
          lon: wp.lon,
          pattern: !!wp.pattern,
        })),
        // legAltitudes : index 0 inutilisé → null en JSON (undefined non sérialisable)
        legAltitudes: legAltitudes.map(a => (a === undefined ? null : a)),
      };

      const result = await window.api.sauvegarderNavXpv(planData);
      if (result && result.ok) {
        showToast(t('saveSuccess'), 'success');
      } else if (result && !result.canceled) {
        showToast('❌ ' + (result.error || 'Erreur sauvegarde'), 'error');
      }
    });
  }

  // --- 6. Validation et recalcul en temps réel ---

  // Champs ICAO en lecture seule — remplis automatiquement à l'import

  // --- Popup d'avertissement custom ---
  const overlay = document.getElementById('warning-overlay');
  const warnMsg = document.getElementById('warning-message');
  const warnClose = document.getElementById('warning-close');
  let _pendingFocusEl = null;

  function showWarning(message, fieldEl) {
    _pendingFocusEl = fieldEl;
    warnMsg.textContent = message;
    overlay.classList.add('visible');
  }

  warnClose.addEventListener('click', () => {
    overlay.classList.remove('visible');
    if (_pendingFocusEl) {
      _pendingFocusEl.value = '';
      setTimeout(() => { _pendingFocusEl.focus(); _pendingFocusEl = null; }, 50);
    }
    mettreAJourLogDeNav();
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) warnClose.click();
  });

  function validerAuBlur(el, tester, messageKey) {
    el.addEventListener('blur', () => {
      const val = parseFloat(el.value);
      if (el.value !== '' && tester(val)) {
        showWarning(t(messageKey), el);
      } else {
        mettreAJourLogDeNav();
      }
    });
  }

  const inputWindDir = document.getElementById('input-wind-dir');
  const inputWindSpeed = document.getElementById('input-wind-speed');
  const inputVp = document.getElementById('input-vp');

  if (inputWindDir) validerAuBlur(inputWindDir, val => isNaN(val) || val < 0 || val > 360, 'alertWindDirInvalid');
  if (inputWindSpeed) {
    inputWindSpeed.addEventListener('blur', () => {
      const val = parseFloat(inputWindSpeed.value);
      if (inputWindSpeed.value !== '' && !isNaN(val) && val < 0) {
        showWarning(t('alertWindNegative'), inputWindSpeed);
      } else if (inputWindSpeed.value !== '' && (isNaN(val) || val > 40)) {
        showWarning(t('alertWindTooStrong'), inputWindSpeed);
      } else {
        mettreAJourLogDeNav();
      }
    });
  }
  if (inputVp) validerAuBlur(inputVp, val => isNaN(val) || val < 40 || val > 250, 'alertVpInvalid');

  // Recalcul au Enter sur ces champs (le blur s'en chargera pour la validation)
  [inputWindDir, inputWindSpeed, inputVp].forEach(el => {
    if (!el) return;
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter') el.blur();
    });
  });

  // Mise à jour live de la rose des vents pendant la saisie utilisateur
  const updateRoseFromInputs = () => {
    const d = parseFloat(inputWindDir?.value) || 0;
    const v = parseFloat(inputWindSpeed?.value) || 0;
    updateWindRose(d, v, 'manual');
  };
  if (inputWindDir) inputWindDir.addEventListener('input', updateRoseFromInputs);
  if (inputWindSpeed) inputWindSpeed.addEventListener('input', updateRoseFromInputs);

  // État initial de la rose
  updateRoseFromInputs();
  // ----------------------------------------------------------
  // SimConnect : connexion MSFS + injection vent
  // ----------------------------------------------------------
  const statusBadge = document.getElementById('sim-status');
  let _simState = 'disconnected'; // disconnected | connecting | connected

  function appliquerEtatSim(state, info) {
    _simState = state;
    if (!statusBadge) return;
    statusBadge.disabled = (state === 'connecting');
    statusBadge.removeAttribute('data-i18n'); // on gère le texte manuellement
    switch (state) {
      case 'connected':
        statusBadge.textContent = t('simConnected');
        statusBadge.style.backgroundColor = '#2e7d32'; // vert
        statusBadge.title = t('simClickToDisconnect');
        break;
      case 'connecting':
        statusBadge.textContent = t('simConnecting');
        statusBadge.style.backgroundColor = '#ef6c00'; // orange foncé
        statusBadge.title = '';
        break;
      case 'disconnected':
      default:
        statusBadge.textContent = t('simDisconnectedClick');
        statusBadge.style.backgroundColor = '#d32f2f'; // rouge
        statusBadge.title = t('simClickToConnect');
        break;
    }
  }

  // État initial
  appliquerEtatSim('disconnected');

  if (statusBadge) {
    statusBadge.addEventListener('click', async () => {
      if (_simState === 'connecting') return;
      if (_simState === 'connected') {
        await window.api.simConnectDeconnecter();
      } else {
        appliquerEtatSim('connecting');
        const res = await window.api.simConnectConnecter();
        if (!res || !res.ok) {
          appliquerEtatSim('disconnected');
          // Petite info dans la console — pas d'alerte intrusive
          console.warn('Connexion MSFS échouée:', res && res.error);
          // Flash visuel rapide pour signaler l'erreur
          if (statusBadge) {
            const prev = statusBadge.textContent;
            statusBadge.textContent = t('simConnectFailed');
            setTimeout(() => {
              if (_simState === 'disconnected') statusBadge.textContent = t('simDisconnectedClick');
            }, 2500);
          }
        }
      }
    });
  }

  // Écouter les changements de statut côté main process
  window.api.onStatusSimConnect((status) => {
    if (!status || !status.state) return;
    appliquerEtatSim(status.state, status);
  });

  // Recevoir les données de vol (vent) et injecter dans les inputs
  window.api.onDonneesVol((data) => {
    if (!data) return;
    let modifie = false;
    if (typeof data.windDir === 'number' && Number.isFinite(data.windDir)) {
      // Normaliser 0..360
      let d = data.windDir % 360;
      if (d < 0) d += 360;
      const val = Math.round(d).toString();
      if (inputWindDir && inputWindDir.value !== val) {
        inputWindDir.value = val;
        modifie = true;
      }
    }
    if (typeof data.windSpeed === 'number' && Number.isFinite(data.windSpeed)) {
      // Plafonner à 0..40 pour respecter la validation existante
      let v = data.windSpeed;
      if (v < 0) v = 0;
      if (v > 40) v = 40;
      const val = Math.round(v).toString();
      if (inputWindSpeed && inputWindSpeed.value !== val) {
        inputWindSpeed.value = val;
        modifie = true;
      }
    }
    if (modifie && typeof mettreAJourLogDeNav === 'function') {
      mettreAJourLogDeNav();
    }
    // Mettre à jour la rose avec les valeurs brutes reçues de MSFS
    if (typeof data.windDir === 'number' && typeof data.windSpeed === 'number') {
      updateWindRose(data.windDir, data.windSpeed, 'msfs');
    }
  });

  // Quand l'utilisateur se déconnecte de MSFS, revenir à 'manuel'
  window.api.onStatusSimConnect((status) => {
    if (status && status.state === 'disconnected') {
      const d = parseFloat(inputWindDir?.value) || 0;
      const v = parseFloat(inputWindSpeed?.value) || 0;
      updateWindRose(d, v, 'manual');
    }
  });

  // ----------------------------------------------------------
  // Alerte sonore de proximité waypoint
  //   Reçoit la position de l'avion toutes les 5 s depuis MSFS,
  //   calcule la distance au point d'arrivée du leg actif et
  //   joue waypoint_fr.wav / waypoint_en.wav quand < 1.5 NM.
  // ----------------------------------------------------------
  const WAYPOINT_RADIUS_NM = 1.5;
  const DEVIATION_MAX_NM = 1.2;
  const PATTERN_RADIUS_NM = 2;
  // Précharge des fichiers audio (situés dans src/sounds/)
  const _wpSounds = {
    fr: new Audio('sounds/waypoint_fr.wav'),
    en: new Audio('sounds/waypoint_en.wav'),
  };
  const _arrivalSound = new Audio('sounds/cuckoo.wav'); // joué à l'arrivée finale (langue-agnostique)
  const _devSounds = {
    fr: new Audio('sounds/deviation_fr.wav'),
    en: new Audio('sounds/deviation_en.wav'),
  };
  const _touchSounds = {
    fr: new Audio('sounds/touch_fr.wav'),
    en: new Audio('sounds/touch_en.wav'),
  };
  // Pré-chargement (au cas où le 1er play soit en différé)
  _wpSounds.fr.preload = 'auto';
  _wpSounds.en.preload = 'auto';
  _arrivalSound.preload = 'auto';
  _devSounds.fr.preload = 'auto';
  _devSounds.en.preload = 'auto';
  _touchSounds.fr.preload = 'auto';
  _touchSounds.en.preload = 'auto';

  let _lastSoundLegIndex = null;     // index du leg pour lequel le son d'arrivée a déjà été joué
  let _lastSoundSession = false;     // mémoire qu'on était DANS le rayon au précédent tick

  // État de l'alerte d'écart latéral
  let _deviationLegIndex = null;     // index du leg pour lequel on a alerté la dernière fois
  let _deviationOutside = false;     // currently hors du couloir 1.2 NM
  let _deviationLastAlertTime = 0;   // timestamp ms de la dernière alerte (pour rappel toutes les 2 min)
  const DEVIATION_REMIND_MS = 2 * 60 * 1000; // 2 minutes

  function _distanceNM(lat1, lon1, lat2, lon2) {
    const R_NM = 3440.065;
    const toRad = d => d * Math.PI / 180;
    const φ1 = toRad(lat1);
    const φ2 = toRad(lat2);
    const Δφ = toRad(lat2 - lat1);
    const Δλ = toRad(lon2 - lon1);
    const a = Math.sin(Δφ / 2) ** 2
      + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R_NM * c;
  }

  // Cross-track distance (XTD) : distance perpendiculaire signée d'un point P
  // à la route grand-cercle A→B. Positif = à droite de la route, négatif = à gauche.
  // Résultat en nautical miles. Pour le test de seuil on utilisera Math.abs().
  function _crossTrackNM(latP, lonP, latA, lonA, latB, lonB) {
    const R_NM = 3440.065;
    const toRad = d => d * Math.PI / 180;
    const φA = toRad(latA), λA = toRad(lonA);
    const φP = toRad(latP), λP = toRad(lonP);
    const φB = toRad(latB), λB = toRad(lonB);

    // Distance angulaire A→P (en radians)
    const Δφap = φP - φA;
    const Δλap = λP - λA;
    const aap = Math.sin(Δφap / 2) ** 2
      + Math.cos(φA) * Math.cos(φP) * Math.sin(Δλap / 2) ** 2;
    const d_AP = 2 * Math.atan2(Math.sqrt(aap), Math.sqrt(1 - aap));

    // Relevement A→B et A→P
    function bearing(φ1, λ1, φ2, λ2) {
      const y = Math.sin(λ2 - λ1) * Math.cos(φ2);
      const x = Math.cos(φ1) * Math.sin(φ2)
        - Math.sin(φ1) * Math.cos(φ2) * Math.cos(λ2 - λ1);
      return Math.atan2(y, x);
    }
    const θ_AB = bearing(φA, λA, φB, λB);
    const θ_AP = bearing(φA, λA, φP, λP);

    return Math.asin(Math.sin(d_AP) * Math.sin(θ_AP - θ_AB)) * R_NM;
  }

  function _jouerSon(audioEl) {
    try {
      audioEl.currentTime = 0;
      audioEl.play().catch(err => console.warn('Lecture son refusée :', err));
    } catch (err) {
      console.warn('Erreur son :', err);
    }
  }
  function _jouerSonWaypoint() {
    _jouerSon(_wpSounds[currentLang] || _wpSounds.fr);
  }
  function _jouerSonArrivee() {
    _jouerSon(_arrivalSound);
  }
  function _jouerSonDeviation() {
    _jouerSon(_devSounds[currentLang] || _devSounds.fr);
  }
  function _jouerSonTouch() {
    _jouerSon(_touchSounds[currentLang] || _touchSounds.fr);
  }

  // Calcul cap magnétique + temps + distance pour une trajectoire (A → B).
  // Utilise la déclinaison magnétique globale et les valeurs courantes Vp/vent
  // (lues depuis les inputs). Retourne null si Vp invalide.
  function calcLegInfo(latA, lonA, latB, lonB) {
    const vp = parseFloat(document.getElementById('input-vp').value) || 90;
    const dirVent = parseFloat(document.getElementById('input-wind-dir').value) || 0;
    const vitVent = parseFloat(document.getElementById('input-wind-speed').value) || 0;

    const R = 3440.065;
    const toRad = d => d * Math.PI / 180;
    const dLat = toRad(latB - latA);
    const dLon = toRad(lonB - lonA);
    const lat1Rad = toRad(latA);
    const lat2Rad = toRad(latB);
    const a = Math.sin(dLat / 2) ** 2
      + Math.sin(dLon / 2) ** 2 * Math.cos(lat1Rad) * Math.cos(lat2Rad);
    const distanceNM = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    // Route vraie (bearing initial du grand-cercle)
    const y = Math.sin(dLon) * Math.cos(lat2Rad);
    const x = Math.cos(lat1Rad) * Math.sin(lat2Rad)
      - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);
    const rvDeg = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;

    // Triangle des vitesses (dérive + GS)
    const alphaRad = ((dirVent - rvDeg) * Math.PI) / 180;
    let deriveDeg = 0;
    if (vp > 0) {
      const sinX = (vitVent * Math.sin(alphaRad)) / vp;
      if (Math.abs(sinX) <= 1) deriveDeg = (Math.asin(sinX) * 180) / Math.PI;
    }
    const deriveRad = (deriveDeg * Math.PI) / 180;
    let gs = vp * Math.cos(deriveRad) - vitVent * Math.cos(alphaRad);
    if (gs < 0) gs = 0;

    let tempsSec = null;
    let tempsFormate = '--:--';
    if (gs > 0) {
      tempsSec = Math.round((distanceNM / gs) * 3600);
      const mm = Math.floor(tempsSec / 60).toString().padStart(2, '0');
      const ss = (tempsSec % 60).toString().padStart(2, '0');
      tempsFormate = `${mm}:${ss}`;
    }

    const capMagDeg = (rvDeg + deriveDeg - declinaisonMoyenneGlobale + 360) % 360;
    return { distanceNM, rvDeg, capMagDeg, gs, tempsSec, tempsFormate };
  }

  window.api.onDonneesPosition((pos) => {
    if (!pos || typeof pos.lat !== 'number' || typeof pos.lon !== 'number') return;
    // Cache la dernière position avion (utilisée par Direct To)
    _lastAircraftPos = { lat: pos.lat, lon: pos.lon };
    if (!flightPlan || flightPlan.length < 2) return;
    // Le leg actif doit avoir un point d'arrivée valide
    if (activeLegIndex < 1 || activeLegIndex >= flightPlan.length) return;

    // Si l'utilisateur a changé de leg actif depuis la dernière fois,
    // on reset le tracking (le son pourra être rejoué pour le nouveau leg)
    if (_lastSoundLegIndex !== null && _lastSoundLegIndex !== activeLegIndex) {
      _lastSoundLegIndex = null;
      _lastSoundSession = false;
    }
    // Idem pour le tracking d'écart latéral
    if (_deviationLegIndex !== null && _deviationLegIndex !== activeLegIndex) {
      _deviationLegIndex = null;
      _deviationOutside = false;
      _deviationLastAlertTime = 0;
    }

    // En mode Direct To, le DÉPART de la trajectoire est figé à la position
    // de l'avion au moment de l'activation, pas le précédent waypoint.
    // L'ARRIVÉE reste flightPlan[activeLegIndex].
    const dep = _directToActive ? _directToOrigin : flightPlan[activeLegIndex - 1];
    const arr = flightPlan[activeLegIndex];
    const distance = _distanceNM(pos.lat, pos.lon, arr.lat, arr.lon);
    const insideRadius = distance < WAYPOINT_RADIUS_NM;

    // --- Vérification de l'écart latéral à la trajectoire du leg actif ---
    if (dep) {
      // ZONE DE TOUR DE PISTE : si l'avion est à < 2 NM d'un aéroport du leg
      // actif marqué pour un tour de piste (départ ou arrivée), on suspend
      // les alertes de déviation. Le pilote tourne autour de l'aéroport, l'écart
      // à la trajectoire est attendu et ne doit pas déclencher d'alarme.
      // L'annonce d'arrivée (1.5 NM) reste active.
      const distToDep = _distanceNM(pos.lat, pos.lon, dep.lat, dep.lon);
      const inPatternZone =
        (dep.pattern && distToDep < PATTERN_RADIUS_NM) ||
        (arr.pattern && distance < PATTERN_RADIUS_NM);

      if (inPatternZone) {
        // Reset le tracking : à la sortie du rayon, une déviation effective
        // sera détectée fraîchement et alertée normalement.
        if (_deviationOutside) {
          _deviationOutside = false;
          _deviationLastAlertTime = 0;
        }
      } else {
        const xtd = _crossTrackNM(pos.lat, pos.lon, dep.lat, dep.lon, arr.lat, arr.lon);
        const horsCouloir = Math.abs(xtd) > DEVIATION_MAX_NM;
        if (horsCouloir) {
          const now = Date.now();
          if (!_deviationOutside) {
            // 1ère alerte (transition dans → hors couloir)
            _jouerSonDeviation();
            _deviationOutside = true;
            _deviationLegIndex = activeLegIndex;
            _deviationLastAlertTime = now;
          } else if (now - _deviationLastAlertTime >= DEVIATION_REMIND_MS) {
            // Rappel : toujours hors couloir et 2 minutes se sont écoulées
            _jouerSonDeviation();
            _deviationLastAlertTime = now;
          }
        } else if (_deviationOutside) {
          // Retour dans le couloir → reset complet, la prochaine déviation rejouera
          _deviationOutside = false;
          _deviationLastAlertTime = 0;
        }
      }
    }

    // Détection de FRANCHISSEMENT du seuil (transition extérieur → intérieur)
    // pour ne jouer le son qu'une fois par entrée dans le rayon.
    if (insideRadius && _lastSoundLegIndex !== activeLegIndex) {
      // Si un toucher est prévu à l'arrivée → on joue le son "touch" et on
      // remplace les sons waypoint/cuckoo habituels.
      // Sinon : dernier leg → cuckoo, leg intermédiaire → waypoint.
      const estDernierLeg = (activeLegIndex === flightPlan.length - 1);
      if (arr.pattern) {
        _jouerSonTouch();
      } else if (estDernierLeg) {
        _jouerSonArrivee();
      } else {
        _jouerSonWaypoint();
      }
      _lastSoundLegIndex = activeLegIndex;
      _lastSoundSession = true;
      // Auto-validation : on marque le leg comme fait → activeLegIndex++
      // (identique au comportement de la checkbox "Fait" cochée manuellement)
      activeLegIndex = activeLegIndex + 1;
      // Si on était en mode Direct To, on le quitte → le plan reprend son
      // cours normal à partir du leg suivant
      if (_directToActive) {
        _directToActive = false;
        _directToOrigin = null;
        _directToTargetIndex = null;
        _supprimerLigneDirectTo();
      }
      if (typeof mettreAJourLogDeNav === 'function') mettreAJourLogDeNav();
    } else if (!insideRadius && _lastSoundSession) {
      // L'avion sort du rayon. On garde _lastSoundLegIndex mémorisé pour ne pas
      // rejouer s'il revient dans le rayon sur le MÊME leg (pas d'oscillation).
      _lastSoundSession = false;
    }
  });

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
  let _tankRunning = false;
  let _tankRemainingMs = 15 * 60 * 1000; // ms restantes
  let _tankTickHandle = null;
  let _tankEndTime = 0;

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
    _tankTickHandle = setInterval(_tankTick, 200);
    _tankUpdateBtns();
  }

  function _tankStop(reachedZero = false) {
    if (_tankTickHandle) { clearInterval(_tankTickHandle); _tankTickHandle = null; }
    _tankRunning = false;
    if (tankCountdown) {
      tankCountdown.classList.remove('running');
      if (reachedZero) tankCountdown.classList.add('finished');
    }
    if (reachedZero) _jouerSonChangementReservoir();
    _tankUpdateBtns();
  }

  function _tankReset() {
    if (_tankTickHandle) { clearInterval(_tankTickHandle); _tankTickHandle = null; }
    _tankRunning = false;
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

  // ============================================================
  // CONVERSIONS D'UNITÉS — bouton + modale
  // ============================================================
  const btnConversions = document.getElementById('btn-conversions');
  const convOverlay = document.getElementById('conversions-overlay');

  // Helpers : filtre le texte saisi pour n'autoriser que les chiffres,
  // un point décimal et un signe moins. Accepte aussi la virgule (convertie).
  function _convCleanInput(el) {
    const before = el.value;
    let v = before.replace(/,/g, '.').replace(/[^0-9.\-]/g, '');
    // Au plus un point et un signe moins en début
    const firstDot = v.indexOf('.');
    if (firstDot !== -1) {
      v = v.slice(0, firstDot + 1) + v.slice(firstDot + 1).replace(/\./g, '');
    }
    if (v.lastIndexOf('-') > 0) v = v.replace(/-/g, '');
    if (v !== before) el.value = v;
  }
  // Formate un nombre en supprimant les zéros de fin inutiles (max N décimales)
  function _convFmt(num, decimals = 3) {
    if (!isFinite(num)) return '';
    return parseFloat(num.toFixed(decimals)).toString();
  }

  // Lien bidirectionnel entre deux inputs (paire simple)
  function linkPair(idA, idB, aToB, bToA, decimals = 2) {
    const a = document.getElementById(idA);
    const b = document.getElementById(idB);
    if (!a || !b) return;
    a.addEventListener('input', () => {
      _convCleanInput(a);
      const v = parseFloat(a.value);
      b.value = isFinite(v) ? _convFmt(aToB(v), decimals) : '';
    });
    b.addEventListener('input', () => {
      _convCleanInput(b);
      const v = parseFloat(b.value);
      a.value = isFinite(v) ? _convFmt(bToA(v), decimals) : '';
    });
  }

  // Lien à 3 unités (vitesse : kt, km/h, mph) via une base commune (kt)
  function linkTripletSpeed() {
    const items = [
      { id: 'conv-kt', toKt: v => v, fromKt: v => v },
      { id: 'conv-kmh', toKt: v => v / 1.852, fromKt: v => v * 1.852 },
      { id: 'conv-mph', toKt: v => v / 1.150779, fromKt: v => v * 1.150779 },
    ];
    items.forEach(src => {
      const el = document.getElementById(src.id);
      if (!el) return;
      el.addEventListener('input', () => {
        _convCleanInput(el);
        const v = parseFloat(el.value);
        if (!isFinite(v)) {
          items.forEach(o => {
            if (o.id !== src.id) document.getElementById(o.id).value = '';
          });
          return;
        }
        const ktVal = src.toKt(v);
        items.forEach(o => {
          if (o.id === src.id) return;
          document.getElementById(o.id).value = _convFmt(o.fromKt(ktVal), 2);
        });
      });
    });
  }

  // Câblages des paires
  // Distance NM ↔ km : 1 NM = 1.852 km
  linkPair('conv-nm', 'conv-km', v => v * 1.852, v => v / 1.852, 3);
  // Distance ft ↔ m : 1 ft = 0.3048 m
  linkPair('conv-ft', 'conv-m', v => v * 0.3048, v => v / 0.3048, 2);
  // Vitesse triplet
  linkTripletSpeed();
  // Température °C ↔ °F
  linkPair('conv-c', 'conv-f', v => v * 9 / 5 + 32, v => (v - 32) * 5 / 9, 1);
  // Pression hPa ↔ inHg : 1 inHg = 33.8639 hPa
  linkPair('conv-hpa', 'conv-inhg', v => v / 33.8639, v => v * 33.8639, 3);
  // Poids kg ↔ lb : 1 kg = 2.20462 lb
  linkPair('conv-kg', 'conv-lb', v => v * 2.20462, v => v / 2.20462, 3);
  // Volume US gal ↔ L : 1 US gal = 3.785411784 L
  linkPair('conv-usgal', 'conv-l', v => v * 3.785411784, v => v / 3.785411784, 3);

  // Ouverture / fermeture de la modale
  function _ouvrirConversions() {
    if (!convOverlay) return;
    convOverlay.classList.add('visible');
    setTimeout(() => {
      const first = document.getElementById('conv-nm');
      if (first) { first.focus(); first.select(); }
    }, 50);
  }
  function _fermerConversions() {
    if (convOverlay) convOverlay.classList.remove('visible');
    // Vider tous les champs de conversion
    convOverlay?.querySelectorAll('.conv-input').forEach(el => { el.value = ''; });
  }
  if (btnConversions) btnConversions.addEventListener('click', _ouvrirConversions);
  if (convOverlay) {
    convOverlay.addEventListener('click', e => {
      if (e.target === convOverlay) _fermerConversions();
    });
  }
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && convOverlay && convOverlay.classList.contains('visible')) {
      _fermerConversions();
    }
  });

  // ============================================================
  // DIRECT TO — bouton + 2 modales + logique
  // ============================================================
  const btnDirectTo = document.getElementById('btn-direct-to');
  const dtOverlay = document.getElementById('direct-to-overlay');
  const dtList = document.getElementById('dt-wp-list');
  const dtError = document.getElementById('dt-error');
  const btnDtCancel = document.getElementById('btn-dt-cancel');
  const btnDtValidate = document.getElementById('btn-dt-validate');
  const dtInfoOverlay = document.getElementById('direct-to-info-overlay');
  const dtInfoTarget = document.getElementById('dt-info-target');
  const dtInfoCap = document.getElementById('dt-info-cap');
  const dtInfoDist = document.getElementById('dt-info-dist');
  const dtInfoTime = document.getElementById('dt-info-time');
  const dtProgressFill = document.getElementById('dt-progress-fill');
  const btnDtInfoClose = document.getElementById('btn-dt-info-close');

  // Etat d'activation du bouton (MSFS connecté + plan présent)
  function _majBoutonDirectTo() {
    if (!btnDirectTo) return;
    const peut = (_simState === 'connected') && Array.isArray(flightPlan) && flightPlan.length >= 1;
    btnDirectTo.disabled = !peut;
    btnDirectTo.title = peut
      ? (currentLang === 'fr' ? "Direct To — Aller directement vers un waypoint"
        : "Direct To — Fly directly to a waypoint")
      : (currentLang === 'fr' ? "Direct To — MSFS doit être connecté et un plan chargé"
        : "Direct To — MSFS must be connected and a flight plan loaded");
  }
  // Mise à jour à la connexion / déconnexion + après chaque rafraîchissement du nav log
  window.api.onStatusSimConnect(() => _majBoutonDirectTo());
  // Hook dans mettreAJourLogDeNav (ré-évalué à chaque redraw)
  const _origMajLog = mettreAJourLogDeNav;
  mettreAJourLogDeNav = function () {
    const r = _origMajLog.apply(this, arguments);
    _majBoutonDirectTo();
    return r;
  };
  _majBoutonDirectTo();

  // --- Ouverture modale 1 : sélection waypoint ---
  if (btnDirectTo) {
    btnDirectTo.addEventListener('click', () => {
      if (btnDirectTo.disabled) return;
      if (!flightPlan || flightPlan.length === 0) return;
      // Remplit la liste (TOUS les waypoints, départ inclus)
      dtList.innerHTML = '';
      dtError.textContent = '';
      btnDtValidate.disabled = true;
      flightPlan.forEach((wp, idx) => {
        const item = document.createElement('label');
        item.className = 'dt-wp-item';
        item.innerHTML = `
          <input type="radio" name="dt-target" value="${idx}">
          <span class="dt-wp-index">#${idx}</span>
          <span class="dt-wp-name">${escapeHtml(wp.name || wp.ident || '?')}</span>
        `;
        dtList.appendChild(item);
      });
      dtList.querySelectorAll('input[type="radio"]').forEach(r => {
        r.addEventListener('change', () => { btnDtValidate.disabled = false; });
      });
      dtOverlay.classList.add('visible');
    });
  }

  function _fermerDtSelect() { dtOverlay.classList.remove('visible'); }
  if (btnDtCancel) btnDtCancel.addEventListener('click', _fermerDtSelect);
  if (dtOverlay) {
    dtOverlay.addEventListener('click', e => { if (e.target === dtOverlay) _fermerDtSelect(); });
  }

  // --- Validation modale 1 → activation Direct To + modale 2 ---
  if (btnDtValidate) {
    btnDtValidate.addEventListener('click', () => {
      const checked = dtList.querySelector('input[type="radio"]:checked');
      if (!checked) {
        dtError.textContent = t('dtNoWaypoint');
        return;
      }
      const targetIdx = parseInt(checked.value, 10);
      if (!_lastAircraftPos) {
        dtError.textContent = currentLang === 'fr'
          ? 'Position avion inconnue — MSFS non connecté ?'
          : 'Aircraft position unknown — MSFS not connected?';
        return;
      }
      _activerDirectTo(targetIdx);
      _fermerDtSelect();
    });
  }

  // --- Ligne magenta dashed sur la carte ---
  function _supprimerLigneDirectTo() {
    if (_directToLayer) {
      try { map.removeLayer(_directToLayer); } catch (_) { }
      _directToLayer = null;
    }
  }
  // Exposer pour le bloc auto-validation arrivée (qui appelle aussi cette fonction)
  window._supprimerLigneDirectTo = _supprimerLigneDirectTo;

  function _tracerLigneDirectTo(origin, target) {
    _supprimerLigneDirectTo();
    if (!map || !origin || !target) return;
    _directToLayer = L.polyline(
      [[origin.lat, origin.lon], [target.lat, target.lon]],
      { color: '#e91e63', weight: 3, opacity: 0.9, dashArray: '10 6' }
    ).addTo(map);
  }

  // --- Activation : passage en mode Direct To ---
  function _activerDirectTo(targetIdx) {
    const target = flightPlan[targetIdx];
    if (!target || !_lastAircraftPos) return;

    // Etat
    _directToActive = true;
    _directToOrigin = { lat: _lastAircraftPos.lat, lon: _lastAircraftPos.lon };
    _directToTargetIndex = targetIdx;

    // Reset tracking déviation et waypoint pour ce nouveau "leg"
    _lastSoundLegIndex = null;
    _lastSoundSession = false;
    _deviationLegIndex = null;
    _deviationOutside = false;
    _deviationLastAlertTime = 0;

    // Le leg dont l'arrivée est ce waypoint devient actif.
    // Si l'utilisateur cible le waypoint #0 (départ), activeLegIndex = 0
    // (= "rien encore fait"). Sinon, activeLegIndex = targetIdx.
    activeLegIndex = targetIdx;

    // Trace la ligne magenta sur la carte
    _tracerLigneDirectTo(_directToOrigin, target);

    // Redessine table + segments (couleurs mises à jour selon activeLegIndex)
    mettreAJourLogDeNav();

    // Calcul cap / temps / distance et ouvre la modale info
    const info = calcLegInfo(_directToOrigin.lat, _directToOrigin.lon, target.lat, target.lon);
    _afficherInfoDirectTo(target, info);
  }

  // --- Modale 2 : info cap + temps + auto-close 10 s ---
  let _dtInfoTimer = null;
  let _dtInfoStart = 0;
  const DT_INFO_DURATION_MS = 10000;

  function _afficherInfoDirectTo(target, info) {
    if (!dtInfoOverlay) return;
    dtInfoTarget.textContent = (currentLang === 'fr' ? 'Vers ' : 'To ')
      + (target.name || target.ident || '?');
    dtInfoCap.textContent = info.gs > 0
      ? String(Math.round(info.capMagDeg)).padStart(3, '0')
      : '---';
    dtInfoDist.textContent = info.distanceNM.toFixed(1);
    dtInfoTime.textContent = info.tempsFormate;
    dtProgressFill.style.width = '100%';
    dtInfoOverlay.classList.add('visible');

    if (_dtInfoTimer) clearInterval(_dtInfoTimer);
    _dtInfoStart = Date.now();
    _dtInfoTimer = setInterval(() => {
      const elapsed = Date.now() - _dtInfoStart;
      const remaining = Math.max(0, DT_INFO_DURATION_MS - elapsed);
      const pct = (remaining / DT_INFO_DURATION_MS) * 100;
      dtProgressFill.style.width = pct + '%';
      if (remaining <= 0) _fermerDtInfo();
    }, 100);
  }

  function _fermerDtInfo() {
    if (_dtInfoTimer) { clearInterval(_dtInfoTimer); _dtInfoTimer = null; }
    if (dtInfoOverlay) dtInfoOverlay.classList.remove('visible');
  }
  if (btnDtInfoClose) btnDtInfoClose.addEventListener('click', _fermerDtInfo);
  if (dtInfoOverlay) {
    dtInfoOverlay.addEventListener('click', e => {
      if (e.target === dtInfoOverlay) _fermerDtInfo();
    });
  }

  // --- 8. MODALE : INSÉRER UN POINT TOURNANT ---
  const insertOverlay = document.getElementById('insert-wp-overlay');
  const btnInsertCancel = document.getElementById('btn-insert-wp-cancel');
  const btnInsertValidate = document.getElementById('btn-insert-wp-validate');

  if (insertOverlay) {
    // Fermer sur Annuler
    btnInsertCancel.addEventListener('click', () => insertOverlay.classList.remove('visible'));

    // Fermer en cliquant sur le fond
    insertOverlay.addEventListener('click', (e) => {
      if (e.target === insertOverlay) insertOverlay.classList.remove('visible');
    });

    // Validation du nom à la frappe : lettres, chiffres, - et apostrophe uniquement
    const inputNom = document.getElementById('insert-wp-icao');
    inputNom.addEventListener('input', () => {
      inputNom.value = inputNom.value.replace(/[^a-zA-Z0-9\-']/g, '');
    });

    // Validation des coords à la frappe : chiffres et point décimal uniquement
    ['insert-wp-lat', 'insert-wp-lon'].forEach(id => {
      const el = document.getElementById(id);
      el.addEventListener('input', () => {
        // Garder uniquement chiffres et un seul point décimal
        let v = el.value.replace(/[^0-9.]/g, '');
        const parts = v.split('.');
        if (parts.length > 2) v = parts[0] + '.' + parts.slice(1).join('');
        el.value = v;
      });
    });

    // Recherche multi (airports + navaids) pour le point tournant
    // — avec question Tour de piste si le résultat est un aéroport
    document.getElementById('btn-search-wp').addEventListener('click', () => {
      rechercherMulti({
        code: document.getElementById('insert-wp-icao').value,
        statusEl: document.getElementById('search-status-wp'),
        resultsEl: document.getElementById('search-results-wp'),
        latEl: document.getElementById('insert-wp-lat'),
        lonEl: document.getElementById('insert-wp-lon'),
        latRadioName: 'lat-dir',
        lonRadioName: 'lon-dir',
        nameEl: document.getElementById('insert-wp-icao'),
        askPatternOnAirport: true,
      });
    });

    // Valider l'insertion
    btnInsertValidate.addEventListener('click', async () => {
      const name = document.getElementById('insert-wp-icao').value.trim();
      const latDir = document.querySelector('input[name="lat-dir"]:checked').value;
      const lonDir = document.querySelector('input[name="lon-dir"]:checked').value;
      const latRaw = parseFloat(document.getElementById('insert-wp-lat').value);
      const lonRaw = parseFloat(document.getElementById('insert-wp-lon').value);
      const errEl = document.getElementById('insert-wp-error');

      if (!name) {
        errEl.textContent = currentLang === 'fr' ? 'Veuillez renseigner un identifiant.' : 'Please enter an identifier.';
        return;
      }
      if (isNaN(latRaw) || isNaN(lonRaw)) {
        errEl.textContent = currentLang === 'fr' ? 'Veuillez renseigner les coordonnées.' : 'Please fill in the coordinates.';
        return;
      }

      // Appliquer le signe selon N/S et E/W
      const lat = latDir === 'S' ? -Math.abs(latRaw) : Math.abs(latRaw);
      const lon = lonDir === 'W' ? -Math.abs(lonRaw) : Math.abs(lonRaw);

      // Récupérer le flag "Tour de piste prévu" depuis dataset.pattern
      const isPattern = document.getElementById('insert-wp-icao').dataset.pattern === 'true';
      const nouveauPoint = { name, ident: name, lat, lon };
      if (isPattern) nouveauPoint.pattern = true;
      flightPlan.splice(insertLegIndex, 0, nouveauPoint);

      // Insérer une altitude par défaut pour le nouveau leg à insertLegIndex
      // Le nouveau leg prend l'altitude du leg suivant (ou ALT_DEFAULT si absent)
      const altVoisin = legAltitudes[insertLegIndex] ?? ALT_DEFAULT;
      legAltitudes.splice(insertLegIndex, 0, altVoisin);

      // Si le leg actif est >= insertLegIndex, le décaler d'un cran
      if (activeLegIndex >= insertLegIndex) activeLegIndex++;

      // Redessiner la carte complètement
      marqueursCarte.forEach(m => map.removeLayer(m));
      marqueursCarte = [];
      supprimerSegmentsCarte();
      await calculerDeclinaisonCentroide();
      flightPlan.forEach((p, idx) => tracerPointVisuel(p, idx));
      redessinerSegments();
      const bounds = L.latLngBounds(flightPlan.map(p => [p.lat, p.lon]));
      map.fitBounds(bounds, { padding: [50, 50] });

      mettreAJourLogDeNav();
      insertOverlay.classList.remove('visible');
    });
  }

  // --- 9. MODALE : ALTITUDE ---
  const altOverlay = document.getElementById('alt-overlay');
  const altInput = document.getElementById('alt-input');
  const altLegNum = document.getElementById('alt-leg-num');
  const altError = document.getElementById('alt-error');
  let altEditingLegIndex = 0; // index 1-based du leg en cours d'édition

  document.getElementById('btn-alt-cancel').addEventListener('click', () => {
    altOverlay.classList.remove('visible');
  });

  altOverlay.addEventListener('click', (e) => {
    if (e.target === altOverlay) altOverlay.classList.remove('visible');
  });

  document.getElementById('btn-alt-minus').addEventListener('click', () => {
    const val = parseInt(altInput.value) || ALT_DEFAULT;
    const newVal = Math.max(ALT_MIN, val - ALT_STEP);
    altInput.value = newVal;
    altError.textContent = '';
  });

  document.getElementById('btn-alt-plus').addEventListener('click', () => {
    const val = parseInt(altInput.value) || ALT_DEFAULT;
    const newVal = Math.min(ALT_MAX, val + ALT_STEP);
    altInput.value = newVal;
    altError.textContent = '';
  });

  // Validation saisie manuelle : chiffres uniquement
  altInput.addEventListener('input', () => {
    altInput.value = altInput.value.replace(/[^0-9]/g, '');
    altError.textContent = '';
  });

  document.getElementById('btn-alt-validate').addEventListener('click', () => {
    const val = parseInt(altInput.value);
    if (isNaN(val) || val < ALT_MIN || val > ALT_MAX) {
      altError.textContent = currentLang === 'fr'
        ? `Altitude entre ${ALT_MIN} et ${ALT_MAX} ft.`
        : `Altitude between ${ALT_MIN} and ${ALT_MAX} ft.`;
      return;
    }
    legAltitudes[altEditingLegIndex] = val;
    altOverlay.classList.remove('visible');
    mettreAJourLogDeNav();
  });


  // --- 10. MODALE : CONFIRMATION WAYPOINT (scission / déplacement) ---
  const wpConfirmOverlay = document.getElementById('wp-confirm-overlay');

  document.getElementById('btn-wp-confirm-cancel').addEventListener('click', () => {
    wpConfirmOverlay.classList.remove('visible');
    // Nettoyer le marqueur temporaire si présent
    if (marqueurTemporaire) {
      map.removeLayer(marqueurTemporaire);
      marqueurTemporaire = null;
    }
    _confirmCallback = null;
  });

  wpConfirmOverlay.addEventListener('click', (e) => {
    if (e.target === wpConfirmOverlay) {
      document.getElementById('btn-wp-confirm-cancel').click();
    }
  });

  document.getElementById('btn-wp-confirm-validate').addEventListener('click', () => {
    if (_confirmCallback) _confirmCallback();
  });

  // Valider avec Entrée sur le champ nom
  document.getElementById('wp-confirm-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('btn-wp-confirm-validate').click();
  });

  // Fonction appelée depuis mettreAJourLogDeNav pour ouvrir la modale
  window.ouvrirModaleAltitude = (legIndex) => {
    altEditingLegIndex = legIndex;
    altLegNum.textContent = legIndex;
    altInput.value = legAltitudes[legIndex] ?? ALT_DEFAULT;
    altError.textContent = '';
    altOverlay.classList.add('visible');
    setTimeout(() => altInput.select(), 50);
  };

});

// -------------------------------------------------------
// Modale "Tour de piste / Toucher prévu ?" — simple Y/N
// Renvoie une Promise<boolean>
// -------------------------------------------------------
function askPatternModal(airportCode) {
  return new Promise(resolve => {
    const overlay = document.getElementById('ask-pattern-overlay');
    const codeEl = document.getElementById('ask-pattern-code');
    const btnYes = document.getElementById('btn-ask-pattern-yes');
    const btnNo = document.getElementById('btn-ask-pattern-no');
    if (!overlay || !codeEl || !btnYes || !btnNo) return resolve(false);

    codeEl.textContent = airportCode || '';

    let done = false;
    function cleanup() {
      done = true;
      overlay.classList.remove('visible');
      btnYes.removeEventListener('click', onYes);
      btnNo.removeEventListener('click', onNo);
      overlay.removeEventListener('click', onBg);
      document.removeEventListener('keydown', onKey);
    }
    function onYes() { if (done) return; cleanup(); resolve(true); }
    function onNo()  { if (done) return; cleanup(); resolve(false); }
    function onBg(e) { if (e.target === overlay) onNo(); }
    function onKey(e) { if (e.key === 'Escape') onNo(); }

    btnYes.addEventListener('click', onYes);
    btnNo.addEventListener('click', onNo);
    overlay.addEventListener('click', onBg);
    document.addEventListener('keydown', onKey);

    overlay.classList.add('visible');
  });
}

// -------------------------------------------------------
// Recherche aéroport — utilise la base OurAirports locale
// (utilisée par toutes les modales)
// -------------------------------------------------------
async function rechercherAeroport(icao, statusEl, latEl, lonEl, nameEl) {
  const code = icao.trim().toUpperCase();
  if (!code) return;

  statusEl.className = 'search-status';
  statusEl.textContent = t('searchSearching');
  // Réinitialise le flag tour de piste à chaque nouvelle recherche
  if (nameEl) nameEl.dataset.pattern = '';

  try {
    const res = await window.api.rechercherAeroportOA(code);

    if (!res || !res.found) {
      statusEl.className = 'search-status error';
      if (res && res.reason === 'no-data') {
        statusEl.textContent = t('oaDataMissing');
      } else if (res && res.reason === 'no-coords') {
        statusEl.textContent = t('searchCoordsNotFound');
      } else {
        statusEl.textContent = t('searchNotFound');
      }
      return;
    }

    const { lat, lon, name } = res;

    // Injection des coordonnées (valeur absolue — les radios N/S/E/W gèrent le signe)
    latEl.value = Math.abs(lat).toFixed(6);
    lonEl.value = Math.abs(lon).toFixed(6);

    // Mettre à jour les radios N/S et E/W si présentes dans le même formulaire
    const latRadioName = latEl.closest('form, div')
      ?.querySelector('input[type="radio"][value="N"], input[type="radio"][value="S"]')
      ?.name;
    const lonRadioName = lonEl.closest('form, div')
      ?.querySelector('input[type="radio"][value="E"], input[type="radio"][value="W"]')
      ?.name;

    if (latRadioName) {
      const latDir = lat >= 0 ? 'N' : 'S';
      document.querySelector(`input[name="${latRadioName}"][value="${latDir}"]`).checked = true;
    }
    if (lonRadioName) {
      const lonDir = lon >= 0 ? 'E' : 'W';
      document.querySelector(`input[name="${lonRadioName}"][value="${lonDir}"]`).checked = true;
    }

    statusEl.className = 'search-status ok';
    statusEl.textContent = name || code;

    // Si on a un nameEl associé, demander "Tour de piste / Toucher ?"
    // (rechercherAeroport renvoie uniquement des aéroports, donc on demande
    // toujours quand un résultat est trouvé)
    if (nameEl) {
      const yes = await askPatternModal(name || code);
      if (yes) nameEl.dataset.pattern = 'true';
    }
  } catch (err) {
    statusEl.className = 'search-status error';
    statusEl.textContent = t('searchNetworkError');
    console.error('OurAirports search error:', err);
  }
}

// -------------------------------------------------------
// Recherche MULTI (airports + navaids) avec liste de résultats à radios
// + bouton "Sélectionner". Utilisée par "Insérer point tournant" et
// "Éditer leg" (Départ / Arrivée).
// -------------------------------------------------------
async function rechercherMulti(opts) {
  const {
    code,            // string saisi par l'utilisateur
    statusEl,        // élément où afficher le statut de recherche
    resultsEl,       // container <div> où injecter la liste de radios
    latEl, lonEl,    // inputs cible (où injecter les coordonnées sélectionnées)
    latRadioName,    // name des radios N/S
    lonRadioName,    // name des radios E/W
    nameEl,          // (optionnel) input "Nom/Ident" à mettre à jour à la sélection
  } = opts;

  const up = (code || '').trim().toUpperCase();
  if (!up) return;

  statusEl.className = 'search-status';
  statusEl.textContent = t('searchSearching');
  // Cacher la liste précédente
  resultsEl.innerHTML = '';
  resultsEl.classList.remove('visible');

  // Anti-race : on attache un identifiant unique sur le container ; quand le
  // résultat IPC revient, si l'identifiant a changé (= nouvelle recherche ou
  // réouverture de modale entre-temps), on abandonne ce résultat.
  const reqId = (resultsEl._searchReqId || 0) + 1;
  resultsEl._searchReqId = reqId;

  let res;
  try {
    res = await window.api.chercherCorrespondances(up);
  } catch (err) {
    if (resultsEl._searchReqId !== reqId) return;
    statusEl.className = 'search-status error';
    statusEl.textContent = t('searchNetworkError');
    return;
  }
  // Réponse tardive (modale fermée ou rouverte entre-temps) → ignorer
  if (resultsEl._searchReqId !== reqId) return;
  if (!res || !res.ok) {
    statusEl.className = 'search-status error';
    statusEl.textContent = (res && res.reason === 'no-data') ? t('oaDataMissing') : t('searchNotFound');
    return;
  }
  if (!res.matches || res.matches.length === 0) {
    statusEl.className = 'search-status error';
    statusEl.textContent = t('searchNotFound');
    return;
  }

  // Statut OK
  statusEl.className = 'search-status ok';
  statusEl.textContent = currentLang === 'fr'
    ? `${res.matches.length} résultat${res.matches.length > 1 ? 's' : ''}`
    : `${res.matches.length} result${res.matches.length > 1 ? 's' : ''}`;

  // Construire la liste avec radios
  const groupName = 'wp-search-' + Math.random().toString(36).slice(2, 9);
  resultsEl.innerHTML = '';
  res.matches.forEach((m, idx) => {
    const item = document.createElement('label');
    item.className = 'wp-result-item';
    const typeLabel = m.kind === 'airport' ? m.type.replace(/_/g, ' ') : m.type;
    item.innerHTML = `
      <input type="radio" name="${groupName}" value="${idx}">
      <span class="wp-result-code">${escapeHtml(m.code)}</span>
      <span class="wp-result-type">${escapeHtml(typeLabel)}</span>
      <span class="wp-result-country">${escapeHtml(m.country || '—')}</span>
      <span class="wp-result-name">${escapeHtml(m.name || '')}</span>
    `;
    resultsEl.appendChild(item);
  });

  // Zone d'action avec bouton Sélectionner
  const actions = document.createElement('div');
  actions.className = 'wp-results-action';
  const btnSelect = document.createElement('button');
  btnSelect.className = 'btn-wp-select';
  btnSelect.textContent = t('btnSelectChoice');
  btnSelect.disabled = true;
  actions.appendChild(btnSelect);
  resultsEl.appendChild(actions);

  resultsEl.classList.add('visible');

  // Activer le bouton dès qu'un radio est coché
  resultsEl.querySelectorAll('input[type="radio"]').forEach(r => {
    r.addEventListener('change', () => { btnSelect.disabled = false; });
  });

  btnSelect.addEventListener('click', async () => {
    const checked = resultsEl.querySelector('input[type="radio"]:checked');
    if (!checked) return;
    const match = res.matches[parseInt(checked.value, 10)];
    if (!match) return;
    // Injection coordonnées
    latEl.value = Math.abs(match.lat).toFixed(6);
    lonEl.value = Math.abs(match.lon).toFixed(6);
    if (latRadioName) {
      const dir = match.lat >= 0 ? 'N' : 'S';
      const el = document.querySelector(`input[name="${latRadioName}"][value="${dir}"]`);
      if (el) el.checked = true;
    }
    if (lonRadioName) {
      const dir = match.lon >= 0 ? 'E' : 'W';
      const el = document.querySelector(`input[name="${lonRadioName}"][value="${dir}"]`);
      if (el) el.checked = true;
    }
    if (nameEl) {
      nameEl.value = match.code;
    }
    statusEl.className = 'search-status ok';
    statusEl.textContent = match.name || match.code;
    resultsEl.innerHTML = '';
    resultsEl.classList.remove('visible');

    // Question "Tour de piste prévu ?" — uniquement si activé par le caller
    // ET si le match est bien un aéroport
    if (opts.askPatternOnAirport && nameEl) {
      nameEl.dataset.pattern = ''; // reset par défaut
      if (match.kind === 'airport') {
        const yes = await askPatternModal(match.code);
        if (yes) nameEl.dataset.pattern = 'true';
      }
      // Notifier le caller pour qu'il puisse synchroniser son UI (checkbox)
      if (typeof opts.onPatternSet === 'function') {
        opts.onPatternSet(nameEl.dataset.pattern === 'true');
      }
    }
  });
}

// -------------------------------------------------------
// Calcule le prochain nom WP disponible (WP1, WP2, ...)
// -------------------------------------------------------
function prochainNomWP() {
  const nums = flightPlan
    .map(p => p.name)
    .filter(n => /^WP\d+$/i.test(n))
    .map(n => parseInt(n.replace(/^WP/i, ''), 10));
  const max = nums.length > 0 ? Math.max(...nums) : 0;
  return `WP${max + 1}`;
}

// -------------------------------------------------------
// Supprime tous les segments de route de la carte
// -------------------------------------------------------
function supprimerSegmentsCarte() {
  segmentsCarte.forEach(seg => map.removeLayer(seg));
  segmentsCarte = [];
}

// Couleur d'un segment selon l'état du leg :
//   leg fait    (i < active) → gris moyen
//   leg actif   (i === active) → magenta
//   leg à faire (i > active)   → bleu
function _legColor(legIndex, active) {
  if (legIndex < active) return '#888888';
  if (legIndex === active) return '#e91e63';
  return '#4088DC';
}

// -------------------------------------------------------
// Redessine tous les segments de route (un polyline par leg)
// avec interactivité clic → scission. Couleur selon état (fait/actif/à faire).
// -------------------------------------------------------
function redessinerSegments() {
  supprimerSegmentsCarte();
  if (flightPlan.length < 2) return;

  for (let i = 1; i < flightPlan.length; i++) {
    const ptA = flightPlan[i - 1];
    const ptB = flightPlan[i];
    const legIndex = i;
    const baseColor = _legColor(legIndex, activeLegIndex);

    const seg = L.polyline(
      [[ptA.lat, ptA.lon], [ptB.lat, ptB.lon]],
      { color: baseColor, weight: 3, opacity: 0.85 }
    ).addTo(map);
    seg._baseColor = baseColor;

    // Curseur main + survol (on garde la couleur d'état, on augmente juste l'épaisseur)
    seg.on('mouseover', () => {
      seg.setStyle({ weight: 5 });
      map.getContainer().style.cursor = 'crosshair';
    });
    seg.on('mouseout', () => {
      seg.setStyle({ weight: 3 });
      map.getContainer().style.cursor = '';
    });

    // Mousedown sur le segment → démarrage drag immédiat
    seg.on('mousedown', (e) => {
      L.DomEvent.stopPropagation(e);
      L.DomEvent.preventDefault(e);
      initierDragScission(e.latlng, legIndex, e.originalEvent);
    });

    segmentsCarte.push(seg);
  }
}

// -------------------------------------------------------
// Scission : crée un marqueur draggable temporaire
// -------------------------------------------------------
let marqueurTemporaire = null; // Marqueur en cours de drag

function initierDragScission(latlng, legIndex, originalMouseEvent) {
  // Supprimer un éventuel marqueur temporaire précédent
  if (marqueurTemporaire) {
    map.removeLayer(marqueurTemporaire);
    marqueurTemporaire = null;
  }

  // Désactiver le drag de la carte pendant notre drag
  map.dragging.disable();

  // Créer le marqueur à la position du clic
  marqueurTemporaire = L.marker(latlng, {
    draggable: false, // on gère le drag manuellement via les events DOM
    icon: L.divIcon({
      className: '',
      html: '<div style="width:14px;height:14px;background:#00bcd4;border:2px solid #fff;border-radius:50%;box-shadow:0 0 6px rgba(0,188,212,0.8);"></div>',
      iconSize: [14, 14],
      iconAnchor: [7, 7]
    })
  }).addTo(map);

  map.getContainer().style.cursor = 'grabbing';

  // Suivi du drag via les événements DOM natifs sur le container de la carte
  function onMouseMove(e) {
    const containerRect = map.getContainer().getBoundingClientRect();
    const point = L.point(e.clientX - containerRect.left, e.clientY - containerRect.top);
    const newLatLng = map.containerPointToLatLng(point);
    marqueurTemporaire.setLatLng(newLatLng);
  }

  function onMouseUp(e) {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);

    map.dragging.enable();
    map.getContainer().style.cursor = '';

    const pos = marqueurTemporaire.getLatLng();
    ouvrirModaleConfirmation(pos, legIndex, null);
  }

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
}

// -------------------------------------------------------
// Affichage du NOM des waypoints :
//   - zoom >= 8  → tooltip permanent (toujours visible à côté du point)
//   - zoom <  8  → tooltip non-permanent (apparaît au survol)
// Placement perpendiculaire à la direction de vol (côté starboard) afin
// que les labels de waypoints voisins n'aient pas tendance à se chevaucher.
// -------------------------------------------------------
const WP_LABEL_ZOOM_MIN = 9;
const WP_LABEL_OFFSET = 10;

// Choisit la direction (right/left/top/bottom) la plus proche de la
// perpendiculaire à la direction de vol au niveau du waypoint d'index donné.
function _wpDirectionAndOffset(index) {
  const off = WP_LABEL_OFFSET;
  const pt = flightPlan[index];
  if (!pt) return { direction: 'right', offset: [off, 0] };

  const prev = index > 0 ? flightPlan[index - 1] : null;
  const next = index < flightPlan.length - 1 ? flightPlan[index + 1] : null;

  // Direction de vol moyenne (somme des deltas incoming + outgoing)
  let dx = 0, dy = 0;
  if (prev) { dx += pt.lon - prev.lon; dy += pt.lat - prev.lat; }
  if (next) { dx += next.lon - pt.lon; dy += next.lat - pt.lat; }
  if (dx === 0 && dy === 0) return { direction: 'right', offset: [off, 0] };

  // Perpendiculaire "à droite" en repère écran (l'axe y de l'écran pointe
  // vers le bas, opposé à la latitude). Rotation -90° sur écran de la
  // direction de vol projetée donne : perpScreen = (dy_geo, dx_geo).
  const perpX = dy;
  const perpY = dx;

  if (Math.abs(perpX) > Math.abs(perpY)) {
    return perpX > 0
      ? { direction: 'right', offset: [off, 0] }
      : { direction: 'left', offset: [-off, 0] };
  }
  return perpY > 0
    ? { direction: 'bottom', offset: [0, off] }
    : { direction: 'top', offset: [0, -off] };
}

function _wpTooltipOptions(permanent, dirOpts) {
  return {
    permanent,
    direction: dirOpts.direction,
    offset: dirOpts.offset,
    className: 'waypoint-label',
    opacity: 1,
    sticky: false,
  };
}

function _bindWaypointTooltip(marqueur, index) {
  if (!map || !marqueur._wpName) return;
  const permanent = map.getZoom() >= WP_LABEL_ZOOM_MIN;
  const idx = (typeof index === 'number') ? index : marqueursCarte.indexOf(marqueur);
  const dirOpts = _wpDirectionAndOffset(idx);
  marqueur.bindTooltip(marqueur._wpName, _wpTooltipOptions(permanent, dirOpts));
}

function _rectsOverlap(a, b) {
  if (!a || !b) return false;
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function _tooltipRect(marker) {
  const ttip = marker.getTooltip();
  if (!ttip) return null;
  const el = ttip.getElement();
  if (!el) return null;
  return el.getBoundingClientRect();
}

async function updateAllWaypointLabels() {
  if (!map) return;
  const permanent = map.getZoom() >= WP_LABEL_ZOOM_MIN;

  // États mutables par marqueur (direction + offset)
  const states = [];
  marqueursCarte.forEach((m, i) => {
    if (!m._wpName) return;
    const d = _wpDirectionAndOffset(i);
    states.push({ marker: m, index: i, direction: d.direction, offset: d.offset });
  });

  // Bind initial (positionnement perpendiculaire à la route)
  states.forEach(s => {
    s.marker.unbindTooltip();
    s.marker.bindTooltip(s.marker._wpName, _wpTooltipOptions(permanent, s));
  });

  // En mode "hover" (zoom < 9) on ne fait pas de gestion de collision
  if (!permanent || states.length < 2) return;

  // Attendre le rendu DOM pour mesurer les bounding boxes
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

  // ---------- Phase 1 : collisions résolues par left/right (lon) ----------
  let touched = false;
  for (let i = 0; i < states.length; i++) {
    for (let j = i + 1; j < states.length; j++) {
      const ri = _tooltipRect(states[i].marker);
      const rj = _tooltipRect(states[j].marker);
      if (!_rectsOverlap(ri, rj)) continue;

      const pi = flightPlan[states[i].index];
      const pj = flightPlan[states[j].index];
      if (!pi || !pj) continue;

      // Le plus à droite (lon plus élevée) → label à droite, l'autre à gauche
      const [right, left] = pi.lon >= pj.lon ? [states[i], states[j]] : [states[j], states[i]];
      if (right.direction !== 'right') {
        right.direction = 'right';
        right.offset = [WP_LABEL_OFFSET, 0];
        right.marker.unbindTooltip();
        right.marker.bindTooltip(right.marker._wpName, _wpTooltipOptions(permanent, right));
        touched = true;
      }
      if (left.direction !== 'left') {
        left.direction = 'left';
        left.offset = [-WP_LABEL_OFFSET, 0];
        left.marker.unbindTooltip();
        left.marker.bindTooltip(left.marker._wpName, _wpTooltipOptions(permanent, left));
        touched = true;
      }
    }
  }

  if (touched) await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

  // ---------- Phase 2 : collisions résiduelles → décalage vertical ----------
  // On parcourt à nouveau et on décale verticalement les labels encore en collision.
  // On alterne haut / bas pour minimiser l'impact.
  const LABEL_H = 18;
  const verticalAdjustedIndexes = new Set();
  for (let i = 0; i < states.length; i++) {
    for (let j = i + 1; j < states.length; j++) {
      const ri = _tooltipRect(states[i].marker);
      const rj = _tooltipRect(states[j].marker);
      if (!_rectsOverlap(ri, rj)) continue;

      // On décale celui qui n'a pas encore été décalé verticalement
      const target = verticalAdjustedIndexes.has(states[i].index) ? states[j] : states[i];
      // Direction du décalage (alternance pour répartir)
      const dy = (verticalAdjustedIndexes.size % 2 === 0) ? -LABEL_H : LABEL_H;
      target.offset = [target.offset[0], target.offset[1] + dy];
      target.marker.unbindTooltip();
      target.marker.bindTooltip(target.marker._wpName, _wpTooltipOptions(permanent, target));
      verticalAdjustedIndexes.add(target.index);
    }
  }
}

// -------------------------------------------------------
// Rendu visuel d'un point sur la carte (avec drag si ni départ ni arrivée)
// -------------------------------------------------------
function tracerPointVisuel(point, indexDansFlightPlan) {
  if (!map) return;

  const isDraggable = indexDansFlightPlan !== undefined
    && indexDansFlightPlan > 0
    && indexDansFlightPlan < flightPlan.length - 1;

  const stylePointVFR = {
    radius: isDraggable ? 7 : 5,
    fillColor: isDraggable ? "#ff7043" : "#888",
    color: "#ffffff",
    weight: isDraggable ? 2 : 1.5,
    opacity: 1,
    fillOpacity: 0.9
  };

  const marqueur = L.circleMarker([point.lat, point.lon], stylePointVFR)
    .addTo(map);
  marqueur._wpName = point.name;
  _bindWaypointTooltip(marqueur, indexDansFlightPlan);

  if (isDraggable) {
    marqueur.on('mouseover', () => {
      map.getContainer().style.cursor = 'grab';
    });
    marqueur.on('mouseout', () => {
      map.getContainer().style.cursor = '';
    });

    // Mousedown → drag DOM natif immédiat, sans créer d'étape intermédiaire
    marqueur.on('mousedown', (e) => {
      L.DomEvent.stopPropagation(e);
      L.DomEvent.preventDefault(e);

      map.dragging.disable();
      map.getContainer().style.cursor = 'grabbing';
      marqueur.setStyle({ opacity: 0.4, fillOpacity: 0.4 });

      function onMouseMove(ev) {
        const containerRect = map.getContainer().getBoundingClientRect();
        const pt = L.point(ev.clientX - containerRect.left, ev.clientY - containerRect.top);
        const newLatLng = map.containerPointToLatLng(pt);
        marqueur.setLatLng(newLatLng);
      }

      function onMouseUp(ev) {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);

        map.dragging.enable();
        map.getContainer().style.cursor = '';
        marqueur.setStyle({ opacity: 1, fillOpacity: 0.9 });

        const pos = marqueur.getLatLng();
        ouvrirModaleConfirmation(pos, null, indexDansFlightPlan);
      }

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  }

  marqueursCarte.push(marqueur);
}

// -------------------------------------------------------
// Modale de confirmation (scission ou déplacement)
// insertLeg   : index du leg scindé (scission), ou null si déplacement
// moveIndex   : index dans flightPlan du point déplacé, ou null si scission
// -------------------------------------------------------
let _confirmCallback = null;

function ouvrirModaleConfirmation(latlng, insertLeg, moveIndex) {
  const overlay = document.getElementById('wp-confirm-overlay');
  const titleEl = document.getElementById('wp-confirm-title');
  const nameInput = document.getElementById('wp-confirm-name');
  const latEl = document.getElementById('wp-confirm-lat');
  const lonEl = document.getElementById('wp-confirm-lon');
  const errEl = document.getElementById('wp-confirm-error');

  // Titre selon le contexte
  if (moveIndex !== null) {
    titleEl.textContent = currentLang === 'fr'
      ? `Déplacer ${flightPlan[moveIndex].name}`
      : `Move ${flightPlan[moveIndex].name}`;
    nameInput.value = flightPlan[moveIndex].name;
  } else {
    titleEl.textContent = currentLang === 'fr' ? 'Nouveau point de report' : 'New waypoint';
    nameInput.value = prochainNomWP();
  }

  latEl.value = latlng.lat.toFixed(6);
  lonEl.value = latlng.lng.toFixed(6);
  errEl.textContent = '';

  overlay.classList.add('visible');
  setTimeout(() => nameInput.focus(), 50);

  // Stocker le callback selon le mode
  _confirmCallback = async () => {
    const name = nameInput.value.trim();
    if (!name) {
      errEl.textContent = currentLang === 'fr' ? 'Veuillez renseigner un identifiant.' : 'Please enter an identifier.';
      return;
    }

    overlay.classList.remove('visible');

    if (moveIndex !== null) {
      // Déplacement : mise à jour des coordonnées du point existant
      flightPlan[moveIndex].lat = latlng.lat;
      flightPlan[moveIndex].lon = latlng.lng;
      flightPlan[moveIndex].name = name;
      flightPlan[moveIndex].ident = name;
    } else {
      // Scission : insertion du nouveau point dans le plan
      const nouveauPoint = { name, ident: name, lat: latlng.lat, lon: latlng.lng };
      flightPlan.splice(insertLeg, 0, nouveauPoint);
      const altVoisin = legAltitudes[insertLeg] ?? ALT_DEFAULT;
      legAltitudes.splice(insertLeg, 0, altVoisin);
      if (activeLegIndex >= insertLeg) activeLegIndex++;
    }

    // Nettoyer le marqueur temporaire si présent
    if (marqueurTemporaire) {
      map.removeLayer(marqueurTemporaire);
      marqueurTemporaire = null;
    }

    // Redessiner carte complète
    marqueursCarte.forEach(m => map.removeLayer(m));
    marqueursCarte = [];
    supprimerSegmentsCarte();
    await calculerDeclinaisonCentroide();
    flightPlan.forEach((p, idx) => tracerPointVisuel(p, idx));
    redessinerSegments();
    const bounds = L.latLngBounds(flightPlan.map(p => [p.lat, p.lon]));
    map.fitBounds(bounds, { padding: [50, 50] });
    mettreAJourLogDeNav();
  };
}

// -------------------------------------------------------
// Calcul de la déclinaison magnétique au centroïde
// -------------------------------------------------------
async function calculerDeclinaisonCentroide() {
  if (flightPlan.length === 0) {
    declinaisonMoyenneGlobale = 0.0;
    actualiserAffichageDeclinaison();
    return;
  }

  let sommeLat = 0;
  let sommeLon = 0;
  flightPlan.forEach(p => { sommeLat += p.lat; sommeLon += p.lon; });

  const latCentroide = sommeLat / flightPlan.length;
  const lonCentroide = sommeLon / flightPlan.length;

  try {
    console.log(`Calcul de la déclinaison au centroïde : Lat ${latCentroide.toFixed(4)} / Lon ${lonCentroide.toFixed(4)}`);
    const resDecl = await window.api.calculerDeclinaison(latCentroide, lonCentroide, 3000);

    if (resDecl && resDecl.valeur) {
      let valDecl = parseFloat(resDecl.valeur);
      if (resDecl.direction === "O" || resDecl.direction === "W") {
        valDecl = -valDecl;
      }
      declinaisonMoyenneGlobale = valDecl;
      console.log(`🧭 Déclinaison magnétique moyenne : ${declinaisonMoyenneGlobale.toFixed(2)}°`);
    } else {
      console.warn("Résultat déclinaison invalide, repli sur 0.0°");
      declinaisonMoyenneGlobale = 0.0;
    }
  } catch (err) {
    console.error("Erreur déclinaison centroïde :", err);
    declinaisonMoyenneGlobale = 0.0;
  }

  actualiserAffichageDeclinaison();
}

// -------------------------------------------------------
// Modale édition leg (scope global — appelée depuis mettreAJourLogDeNav)
// -------------------------------------------------------
function ouvrirModaleEditLeg(legIndex) {
  const ptA = flightPlan[legIndex - 1];
  const ptB = flightPlan[legIndex];

  // Nettoyer les listes de résultats de recherche + invalider toute
  // requête IPC encore en cours (anti-race condition)
  ['search-results-edit-dep', 'search-results-edit-arr'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el._searchReqId = (el._searchReqId || 0) + 1;
      el.innerHTML = '';
      el.classList.remove('visible');
    }
  });
  ['search-status-edit-dep', 'search-status-edit-arr'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.textContent = ''; el.className = 'search-status'; }
  });
  // Défensif : s'assurer que les inputs ne portent pas readonly/disabled
  ['edit-leg-dep-name', 'edit-leg-arr-name'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.removeAttribute('readonly');
    el.removeAttribute('disabled');
  });

  // Remplir le sous-titre
  document.getElementById('edit-leg-subtitle').textContent =
    TRANSLATIONS[currentLang].editLegSubtitle(legIndex);

  // Helper : valeur absolue + direction radio
  function fillCoord(latId, latRadioName, lonId, lonRadioName, pt) {
    document.getElementById(latId).value = Math.abs(pt.lat).toFixed(6);
    document.getElementById(lonId).value = Math.abs(pt.lon).toFixed(6);
    document.querySelectorAll(`input[name="${latRadioName}"]`).forEach(r => {
      r.checked = (r.value === (pt.lat >= 0 ? 'N' : 'S'));
    });
    document.querySelectorAll(`input[name="${lonRadioName}"]`).forEach(r => {
      r.checked = (r.value === (pt.lon >= 0 ? 'E' : 'W'));
    });
  }

  document.getElementById('edit-leg-dep-name').value = ptA.name;
  fillCoord('edit-leg-dep-lat', 'edit-dep-lat-dir', 'edit-leg-dep-lon', 'edit-dep-lon-dir', ptA);

  document.getElementById('edit-leg-arr-name').value = ptB.name;
  fillCoord('edit-leg-arr-lat', 'edit-arr-lat-dir', 'edit-leg-arr-lon', 'edit-arr-lon-dir', ptB);

  // État courant du flag "tour de piste" : préservé si l'utilisateur ne re-cherche pas
  document.getElementById('edit-leg-dep-name').dataset.pattern = ptA.pattern ? 'true' : '';
  document.getElementById('edit-leg-arr-name').dataset.pattern = ptB.pattern ? 'true' : '';

  // Afficher ou cacher la rangée checkbox "Tour de piste prévu" pour chaque côté
  ['dep', 'arr'].forEach(side => {
    const wp = side === 'dep' ? ptA : ptB;
    const row = document.getElementById(`edit-leg-${side}-pattern-row`);
    const cb = document.getElementById(`edit-leg-${side}-pattern-cb`);
    if (!row || !cb) return;
    if (wp.pattern) {
      row.style.display = 'block';
      cb.checked = true;
    } else {
      row.style.display = 'none';
      cb.checked = false;
    }
  });

  document.getElementById('edit-leg-error').textContent = '';

  // Stocker l'index courant pour la validation
  window._editLegIndex = legIndex;
  document.getElementById('edit-leg-overlay').style.display = 'flex';
  // Focus l'input Départ (sélectionne le contenu pour faciliter le remplacement)
  setTimeout(() => {
    const el = document.getElementById('edit-leg-dep-name');
    if (el) { el.focus(); el.select(); }
  }, 50);
}

// -------------------------------------------------------
// Modale suppression leg (scope global — appelée depuis mettreAJourLogDeNav)
// -------------------------------------------------------
window._deleteLegCallback = null;

function ouvrirModaleDeleteLeg(legIndex) {
  const ptA = flightPlan[legIndex - 1];
  const ptB = flightPlan[legIndex];
  const msg = TRANSLATIONS[currentLang].deleteLegMsg(ptA.name, ptB.name);
  document.getElementById('confirm-delete-msg').textContent = msg;
  window._deleteLegCallback = () => {
    flightPlan.splice(legIndex, 1);
    legAltitudes.splice(legIndex, 1);
    if (activeLegIndex > flightPlan.length - 1) activeLegIndex = Math.max(1, flightPlan.length - 1);
    marqueursCarte.forEach(m => map.removeLayer(m));
    marqueursCarte = [];
    supprimerSegmentsCarte();
    flightPlan.forEach((p, idx) => tracerPointVisuel(p, idx));
    redessinerSegments();
    if (flightPlan.length > 1) {
      const bounds = L.latLngBounds(flightPlan.map(p => [p.lat, p.lon]));
      map.fitBounds(bounds, { padding: [50, 50], animate: false });
    }
    mettreAJourLogDeNav();
  };
  document.getElementById('confirm-delete-overlay').style.display = 'flex';
}

// -------------------------------------------------------
// Affichage de la déclinaison dans le titre
// -------------------------------------------------------
function actualiserAffichageDeclinaison() {
  const dirStr = declinaisonMoyenneGlobale >= 0 ? t('declEast') : t('declWest');
  const absVal = Math.abs(declinaisonMoyenneGlobale).toFixed(1);

  // Injection dans le champ dédié de la config vol
  const inputDecl = document.getElementById('input-decl-mag');
  if (inputDecl) {
    inputDecl.value = `${absVal}° ${dirStr}`;
  }

  // Mise à jour du span déclinaison à côté du logo (le logo reste intact)
  const declSpan = document.getElementById('app-decl');
  if (declSpan) declSpan.textContent = `(D: ${absVal}° ${dirStr})`;
}

// -------------------------------------------------------
// Redessine le tableau de navigation (legs)
// -------------------------------------------------------
function mettreAJourLogDeNav() {
  const tbody = document.getElementById('nav-log-body');
  if (!tbody) return;

  tbody.innerHTML = '';

  if (flightPlan.length === 0) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="12">${t('emptyPlan')}</td></tr>`;
    return;
  }

  const vp = parseFloat(document.getElementById('input-vp').value) || 90;
  const dirVent = parseFloat(document.getElementById('input-wind-dir').value) || 0;
  const vitVent = parseFloat(document.getElementById('input-wind-speed').value) || 0;

  // Cas : un seul point (départ uniquement)
  // Helper : nom du waypoint avec indicateur "Tour de piste" si applicable
  function _renderWpName(wp) {
    const name = escapeHtml(wp.name || '');
    if (wp.pattern) {
      return `${name} <span class="pattern-indicator" title="${escapeHtml(t('patternTooltip'))}"></span>`;
    }
    return name;
  }

  if (flightPlan.length === 1) {
    tbody.innerHTML = `
      <tr>
        <td>-</td>
        <td>${t('departure')}</td>
        <td>${_renderWpName(flightPlan[0])}</td>
        <td>-</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td>
        <td><input type="checkbox" disabled></td>
      </tr>`;
    return;
  }

  // Boucle sur les legs
  for (let i = 1; i < flightPlan.length; i++) {
    const ptA = flightPlan[i - 1];
    const ptB = flightPlan[i];

    // 1. Distance (Haversine → NM)
    const R = 3440.065;
    const dLat = ((ptB.lat - ptA.lat) * Math.PI) / 180;
    const dLon = ((ptB.lon - ptA.lon) * Math.PI) / 180;
    const lat1Rad = (ptA.lat * Math.PI) / 180;
    const lat2Rad = (ptB.lat * Math.PI) / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1Rad) * Math.cos(lat2Rad);
    const distanceNM = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    // 2. Route vraie (Rv)
    const y = Math.sin(dLon) * Math.cos(lat2Rad);
    const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);
    let rvDeg = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;

    // 3. Triangle des vitesses (dérive + GS)
    const alphaRad = ((dirVent - rvDeg) * Math.PI) / 180;
    let deriveDeg = 0;
    if (vp > 0) {
      const sinX = (vitVent * Math.sin(alphaRad)) / vp;
      if (Math.abs(sinX) <= 1) deriveDeg = (Math.asin(sinX) * 180) / Math.PI;
    }
    const deriveRad = (deriveDeg * Math.PI) / 180;
    let gs = vp * Math.cos(deriveRad) - vitVent * Math.cos(alphaRad);
    if (gs < 0) gs = 0;

    // 4. Durée
    let tempsFormate = "--:--";
    if (gs > 0) {
      const totalSec = Math.round((distanceNM / gs) * 3600);
      const mm = Math.floor(totalSec / 60).toString().padStart(2, '0');
      const ss = (totalSec % 60).toString().padStart(2, '0');
      tempsFormate = `${mm}:${ss}`;
    }

    // 5. Cap magnétique
    const capMagDeg = (rvDeg + deriveDeg - declinaisonMoyenneGlobale + 360) % 360;

    // 6. Détermination de l'état du leg
    const isDone = i < activeLegIndex;   // legs au-dessus du leg actif = terminés
    const isActive = i === activeLegIndex; // leg actif courant

    // 6b. Altitude du leg
    const altLeg = legAltitudes[i] ?? ALT_DEFAULT;

    // 7. Injection dans le tableau
    const row = document.createElement('tr');
    row.dataset.legIndex = i;

    // Construire le HTML d'abord
    row.innerHTML = `
      <td><b>${i}</b></td>
      <td>${_renderWpName(ptA)}</td>
      <td></td>
      <td>${_renderWpName(ptB)}</td>
      <td><span class="alt-val">${altLeg}</span> <button class="btn-edit-alt" onclick="window.ouvrirModaleAltitude(${i})" title="${currentLang === 'fr' ? 'Modifier l\'altitude' : 'Edit altitude'}">✏️</button></td>
      <td>${distanceNM.toFixed(1)}</td>
      <td>${Math.round(rvDeg).toString().padStart(3, '0')}°</td>
      <td>${Math.round(capMagDeg).toString().padStart(3, '0')}°</td>
      <td>${Math.round(gs)}</td>
      <td>${tempsFormate}</td>
      <td></td>
      <td></td>
    `;

    // Appliquer le style sur chaque td APRÈS innerHTML pour surpasser td { color } de styles.css
    if (isDone) {
      row.querySelectorAll('td').forEach(td => td.style.color = '#5d5d5d');
    } else if (isActive) {
      row.style.backgroundColor = '#4088DC';
      row.style.fontWeight = 'bold';
      row.querySelectorAll('td').forEach(td => td.style.color = '#ffff00');
    }

    // Bouton + dans la 3ème cellule (entre Depuis et Vers)
    const btnPlus = document.createElement('button');
    btnPlus.className = 'btn-insert-wp';
    btnPlus.textContent = '+';
    btnPlus.title = currentLang === 'fr' ? 'Insérer un point tournant' : 'Insert a waypoint';
    btnPlus.addEventListener('click', () => {
      // i = numéro du leg (1-based), l'insertion se fait à l'index i dans flightPlan
      // (entre flightPlan[i-1] et flightPlan[i])
      insertLegIndex = i;
      const nomWP = prochainNomWP();
      const icaoEl = document.getElementById('insert-wp-icao');
      icaoEl.value = nomWP;
      icaoEl.dataset.pattern = ''; // reset du flag tour de piste à chaque ouverture
      document.getElementById('insert-wp-lat').value = '';
      document.getElementById('insert-wp-lon').value = '';
      document.getElementById('insert-wp-error').textContent = '';
      document.getElementById('search-status-wp').textContent = '';
      document.getElementById('search-status-wp').className = 'search-status';
      const resWp = document.getElementById('search-results-wp');
      if (resWp) { resWp.innerHTML = ''; resWp.classList.remove('visible'); }
      const subtitle = document.getElementById('insert-wp-subtitle');
      subtitle.textContent = currentLang === 'fr'
        ? `Insertion entre ${ptA.name} et ${ptB.name}`
        : `Inserting between ${ptA.name} and ${ptB.name}`;
      document.getElementById('insert-wp-overlay').classList.add('visible');
    });
    row.querySelectorAll('td')[2].appendChild(btnPlus);

    // Créer et insérer la checkbox
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = isDone;
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        activeLegIndex = i + 1;
      } else {
        activeLegIndex = i;
      }
      mettreAJourLogDeNav();
    });
    row.querySelector('td:nth-last-child(2)').appendChild(checkbox);

    // Bouton éditer leg — désactivé si le leg touche un aéroport fixe (1er ou dernier point)
    const toucheAeroport = (i === 1) || (i === flightPlan.length - 1);
    const btnEdit = document.createElement('button');
    btnEdit.className = 'btn-edit-leg';
    btnEdit.textContent = '✏️';
    btnEdit.title = currentLang === 'fr' ? 'Éditer ce leg' : 'Edit this leg';
    btnEdit.disabled = toucheAeroport;
    btnEdit.addEventListener('click', () => ouvrirModaleEditLeg(i));
    row.querySelector('td:last-child').appendChild(btnEdit);

    // Bouton supprimer leg — désactivé s'il ne reste que 2 points
    const canDelete = flightPlan.length > 2;
    const btnDelete = document.createElement('button');
    btnDelete.className = 'btn-delete-leg';
    btnDelete.textContent = '🗑️';
    btnDelete.title = currentLang === 'fr' ? 'Supprimer ce leg' : 'Delete this leg';
    btnDelete.disabled = !canDelete;
    btnDelete.addEventListener('click', () => ouvrirModaleDeleteLeg(i));
    row.querySelector('td:last-child').appendChild(btnDelete);

    tbody.appendChild(row);
  }

  // Refléter l'état des legs (fait/actif/à faire) sur les segments de la carte
  if (typeof redessinerSegments === 'function') redessinerSegments();
}

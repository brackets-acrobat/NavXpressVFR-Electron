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
// NavXpressVFR — metar.js
// Boîte METAR (départ / arrivée) à côté de la boîte chronomètre.
// - Affiche le METAR BRUT de l'aéroport de départ et d'arrivée du plan
//   (ou de la station émettrice la plus proche si le terrain n'en émet pas).
// - Bouton œil 👁 à gauche de chaque METAR → modale « METAR décodé ».
// - Bouton ↻ pour rafraîchir manuellement.
// - Auto-refresh quand le départ/arrivée du plan change (décorateur sur
//   mettreAJourLogDeNav, comme logbook-bridge.js).
// Données : window.api.metarAeroport (main.js → aviationweather.gov).
// DOIT être chargé APRÈS i18n.js (utilise t() / currentLang) et nav-log.js.
// ============================================================

function initMetar() {
  const els = {
    box:        document.getElementById('metar-box'),
    refresh:    document.getElementById('btn-metar-refresh'),
    depRaw:     document.getElementById('metar-dep-raw'),
    depEye:     document.getElementById('metar-dep-eye'),
    arrRaw:     document.getElementById('metar-arr-raw'),
    arrEye:     document.getElementById('metar-arr-eye'),
    overlay:    document.getElementById('metar-decode-overlay'),
    mClose:     document.getElementById('btn-metar-decode-close'),
    mStation:   document.getElementById('metar-decode-station'),
    mRaw:       document.getElementById('metar-decode-raw'),
    mBody:      document.getElementById('metar-decode-body'),
  };
  if (!els.box) return; // boîte absente → rien à faire

  // État courant des deux METAR.  Chaque entrée :
  //   { status:'loading'|'ok'|'none'|'error', raw, station, exact, distNM }
  const state = { dep: null, arr: null };
  let lastDep = null, lastArr = null;  // derniers idents interrogés (anti-spam)
  let openWhich = null;                // 'dep' | 'arr' | null (modale ouverte)

  const esc = (s) => (typeof escapeHtml === 'function' ? escapeHtml(String(s)) : String(s));

  // ---- Extraction départ / arrivée du plan -----------------------------
  function endpoints() {
    const plan = Array.isArray(flightPlan) ? flightPlan : [];
    const dep = plan.length >= 1 ? plan[0] : null;
    const arr = plan.length >= 2 ? plan[plan.length - 1] : null;
    const pick = (wp) => wp ? {
      icao: (wp.ident || '').trim().toUpperCase(),
      lat: Number.isFinite(wp.lat) ? wp.lat : null,
      lon: Number.isFinite(wp.lon) ? wp.lon : null,
    } : null;
    return { dep: pick(dep), arr: pick(arr) };
  }

  // ---- Rendu d'une ligne (dep|arr) -------------------------------------
  // La boîte n'affiche QUE le METAR brut (l'info « station la plus proche /
  // distance » est désormais montrée dans la modale de décodage).
  function renderRow(which) {
    const raw = which === 'dep' ? els.depRaw : els.arrRaw;
    const eye = which === 'dep' ? els.depEye : els.arrEye;
    const st = state[which];
    if (!raw) return;

    if (!st)                     { raw.textContent = '—';              eye.disabled = true; return; }
    if (st.status === 'loading') { raw.textContent = t('metarLoading'); eye.disabled = true; return; }
    if (st.status === 'none')    { raw.textContent = t('metarNone');    eye.disabled = true; return; }
    if (st.status === 'error')   { raw.textContent = t('metarError');   eye.disabled = true; return; }

    // status === 'ok'
    raw.textContent = st.raw;
    eye.disabled = false;
  }

  function renderAll() { renderRow('dep'); renderRow('arr'); }

  // ---- Récupération réseau ---------------------------------------------
  async function fetchOne(which, ep) {
    if (!ep || (!/^[A-Z0-9]{4}$/.test(ep.icao) && ep.lat == null)) {
      state[which] = null; renderRow(which); return;
    }
    state[which] = { status: 'loading' };
    renderRow(which);
    try {
      const res = await window.api.metarAeroport({ icao: ep.icao, lat: ep.lat, lon: ep.lon });
      if (res && res.ok && res.raw) {
        state[which] = { status: 'ok', raw: res.raw, station: res.station, exact: !!res.exact, distNM: res.distNM };
      } else {
        state[which] = { status: 'none' };
      }
    } catch (e) {
      console.warn('[METAR] fetch KO', which, e && e.message);
      state[which] = { status: 'error' };
    }
    renderRow(which);
    if (openWhich === which) refreshOpenModal();
  }

  // Récupère les deux (forcé ou seulement si l'ident a changé).
  function refresh(force) {
    const { dep, arr } = endpoints();
    const depIcao = dep ? dep.icao : null;
    const arrIcao = arr ? arr.icao : null;
    if (force || depIcao !== lastDep) { lastDep = depIcao; fetchOne('dep', dep); }
    if (force || arrIcao !== lastArr) { lastArr = arrIcao; fetchOne('arr', arr); }
  }

  // ---- Modale METAR décodé ---------------------------------------------
  // Remplit la modale de décodage : en-tête HTML + METAR brut + lignes décodées.
  function renderDecodeInto(headerHtml, raw) {
    els.mStation.innerHTML = headerHtml;
    els.mRaw.textContent = raw;
    const lines = decodeMetar(raw);
    els.mBody.innerHTML = lines.map(l =>
      `<div class="md-line"><span class="md-label">${esc(l.label)}</span>` +
      `<span class="md-value">${esc(l.value)}</span></div>`
    ).join('');
  }

  function refreshOpenModal() {
    if (!openWhich) return;   // modale ouverte par la recherche → ne pas écraser
    const st = state[openWhich];
    if (!st || st.status !== 'ok') { closeModal(); return; }
    const label = openWhich === 'dep' ? t('metarDep') : t('metarArr');
    // En-tête : "Départ — LFPG" + (si station ≠ terrain demandé) une ligne
    // orange « ≈ station la plus proche · N NM » (déplacée ici depuis la boîte).
    let html = `${esc(label)} — ${esc(st.station)}`;
    if (!st.exact) {
      const dist = Number.isFinite(st.distNM) ? ` · ${st.distNM} NM` : '';
      html += `<div class="metar-decode-note">≈ ${esc(t('metarNearest'))}${esc(dist)}</div>`;
    }
    renderDecodeInto(html, st.raw);
  }

  function openModal(which) {
    const st = state[which];
    if (!st || st.status !== 'ok') return;
    openWhich = which;
    refreshOpenModal();
    if (els.overlay) els.overlay.classList.add('visible');
  }

  // Ouvre la modale de décodage pour un METAR arbitraire (issu de la recherche).
  // openWhich reste null → un changement de plan ne réécrit pas cette modale.
  function openDecodeRaw(headerHtml, raw) {
    openWhich = null;
    renderDecodeInto(headerHtml, raw);
    if (els.overlay) els.overlay.classList.add('visible');
  }

  function closeModal() {
    openWhich = null;
    if (els.overlay) els.overlay.classList.remove('visible');
  }

  // ---- Câblage ----------------------------------------------------------
  if (els.refresh) els.refresh.addEventListener('click', () => refresh(true));
  if (els.depEye) els.depEye.addEventListener('click', () => openModal('dep'));
  if (els.arrEye) els.arrEye.addEventListener('click', () => openModal('arr'));
  if (els.mClose) els.mClose.addEventListener('click', closeModal);
  if (els.overlay) els.overlay.addEventListener('click', (e) => { if (e.target === els.overlay) closeModal(); });

  // ---- Recherche METAR par code OACI (bouton 🔍 METAR) ----------------
  const searchBtn     = document.getElementById('btn-metar-search');
  const searchOverlay = document.getElementById('metar-search-overlay');
  const searchClose   = document.getElementById('btn-metar-search-close');
  const searchInput   = document.getElementById('metar-search-input');
  const searchGo      = document.getElementById('btn-metar-search-go');
  const searchResult  = document.getElementById('metar-search-result');

  function openSearch() {
    if (!searchOverlay) return;
    if (searchResult) searchResult.innerHTML = '';
    if (searchInput) searchInput.value = '';
    searchOverlay.classList.add('visible');
    if (searchInput) setTimeout(() => searchInput.focus(), 0);
  }
  function closeSearch() {
    if (searchOverlay) searchOverlay.classList.remove('visible');
  }
  function searchMsg(text, color) {
    if (searchResult) searchResult.innerHTML =
      `<div class="metar-search-msg"${color ? ` style="color:${color}"` : ''}>${esc(text)}</div>`;
  }
  function renderSearchResult(res) {
    if (!searchResult) return;
    if (!res || res.status === 'error') { searchMsg(t('metarSearchErrorNet')); return; }
    if (res.status === 'invalid')    { searchMsg(t('metarSearchInvalid')); return; }
    if (res.status === 'unknown')    { searchMsg(t('metarSearchUnknown')); return; }
    if (res.status === 'no-service') { searchMsg(t('metarSearchNoService')); return; }
    if (res.status === 'none-now')   { searchMsg(t('metarSearchNoneNow')); return; }
    if (res.status === 'available') {
      const head = `${esc(res.station || res.icao)}${res.name ? ' — ' + esc(res.name) : ''}`;
      searchResult.innerHTML =
        `<div class="metar-search-station">${head}</div>` +
        `<div class="metar-row">` +
          `<button class="metar-eye" id="metar-search-eye" type="button" title="${esc(t('metarEyeTitle'))}">👁</button>` +
          `<span class="metar-raw">${esc(res.raw)}</span>` +
        `</div>`;
      const eye = document.getElementById('metar-search-eye');
      if (eye) eye.addEventListener('click', () => openDecodeRaw(head, res.raw));
    }
  }
  async function doSearch() {
    if (!searchInput) return;
    const code = searchInput.value.trim().toUpperCase();
    if (!code) return;
    searchMsg(t('metarSearchSearching'), '#888');
    try {
      const res = await window.api.metarRecherche(code);
      renderSearchResult(res);
    } catch (e) {
      console.warn('[METAR] recherche KO', e && e.message);
      renderSearchResult({ status: 'error' });
    }
  }

  if (searchBtn) searchBtn.addEventListener('click', openSearch);
  if (searchGo) searchGo.addEventListener('click', doSearch);
  if (searchInput) searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doSearch(); } });
  if (searchClose) searchClose.addEventListener('click', closeSearch);
  if (searchOverlay) searchOverlay.addEventListener('click', (e) => { if (e.target === searchOverlay) closeSearch(); });

  // Échap : ferme la modale du dessus en priorité (décodage > recherche).
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (els.overlay && els.overlay.classList.contains('visible')) { e.stopPropagation(); closeModal(); }
    else if (searchOverlay && searchOverlay.classList.contains('visible')) { e.stopPropagation(); closeSearch(); }
  });

  // Décorateur sur mettreAJourLogDeNav : re-rendu (langue) + refresh si
  // l'ident départ/arrivée a changé. Debounce pour éviter les rafales
  // pendant l'édition du plan.
  let _t = null;
  if (typeof mettreAJourLogDeNav === 'function') {
    const _orig = mettreAJourLogDeNav;
    // eslint-disable-next-line no-global-assign
    mettreAJourLogDeNav = function () {
      const r = _orig.apply(this, arguments);
      renderAll();              // re-rendu immédiat (langue, notes)
      refreshOpenModal();
      if (_t) clearTimeout(_t);
      _t = setTimeout(() => { _t = null; refresh(false); }, 400);
      return r;
    };
  }

  // Premier rendu + récupération initiale si un plan est déjà chargé.
  renderAll();
  refresh(true);
}

// ======================================================================
// Décodeur METAR — renvoie [{label, value}] dans la langue courante.
// ======================================================================
function decodeMetar(raw) {
  const FR = currentLang !== 'en';

  // Dictionnaires de codes (FR / EN).
  const COVER = {
    FEW: FR ? 'épars (1–2/8)'    : 'few (1–2/8)',
    SCT: FR ? 'fragmenté (3–4/8)': 'scattered (3–4/8)',
    BKN: FR ? 'morcelé (5–7/8)'  : 'broken (5–7/8)',
    OVC: FR ? 'couvert (8/8)'    : 'overcast (8/8)',
    VV:  FR ? 'ciel invisible'   : 'vertical visibility',
  };
  const NOCLOUD = {
    NSC: FR ? 'aucun nuage significatif' : 'no significant cloud',
    NCD: FR ? 'aucun nuage détecté'      : 'no cloud detected',
    SKC: FR ? 'ciel clair'               : 'sky clear',
    CLR: FR ? 'ciel clair'               : 'clear',
  };
  const CB = { CB: FR ? ' cumulonimbus (orageux)' : ' cumulonimbus', TCU: FR ? ' cumulus bourgeonnant' : ' towering cumulus' };
  const INTENS = { '-': FR ? 'faible ' : 'light ', '+': FR ? 'fort ' : 'heavy ', 'VC': FR ? 'à proximité ' : 'vicinity ' };
  const DESC = {
    MI: FR ? 'mince ' : 'shallow ', BC: FR ? 'bancs de ' : 'patches ', PR: FR ? 'partiel ' : 'partial ',
    DR: FR ? 'chasse-poussière bas ' : 'low drifting ', BL: FR ? 'chasse-neige élevé ' : 'blowing ',
    SH: FR ? 'averse de ' : 'showers of ', TS: FR ? 'orage ' : 'thunderstorm ', FZ: FR ? 'surfondu ' : 'freezing ',
  };
  const PHENOM = {
    DZ: FR ? 'bruine' : 'drizzle', RA: FR ? 'pluie' : 'rain', SN: FR ? 'neige' : 'snow',
    SG: FR ? 'neige en grains' : 'snow grains', IC: FR ? 'cristaux de glace' : 'ice crystals',
    PL: FR ? 'granules de glace' : 'ice pellets', GR: FR ? 'grêle' : 'hail', GS: FR ? 'grésil' : 'small hail',
    UP: FR ? 'précipitation inconnue' : 'unknown precip',
    BR: FR ? 'brume' : 'mist', FG: FR ? 'brouillard' : 'fog', FU: FR ? 'fumée' : 'smoke',
    VA: FR ? 'cendres volcaniques' : 'volcanic ash', DU: FR ? 'poussière étendue' : 'widespread dust',
    SA: FR ? 'sable' : 'sand', HZ: FR ? 'brume sèche' : 'haze',
    PO: FR ? 'tourbillons de poussière' : 'dust whirls', SQ: FR ? 'grain' : 'squall',
    FC: FR ? 'trombe / tornade' : 'funnel cloud', SS: FR ? 'tempête de sable' : 'sandstorm',
    DS: FR ? 'tempête de poussière' : 'duststorm',
  };
  const TREND = {
    NOSIG: FR ? 'aucun changement significatif (2 h)' : 'no significant change (2 h)',
    BECMG: FR ? 'évolution vers' : 'becoming', TEMPO: FR ? 'temporairement' : 'temporarily',
  };
  const DAYS = FR ? 'le' : 'day';
  const AT = FR ? 'à' : 'at';
  const VARY = FR ? 'variable de' : 'variable';
  const GUST = FR ? 'rafales' : 'gusting';
  const CAVOK = FR
    ? 'CAVOK — visi ≥ 10 km, aucun nuage sous 1500 m, aucun phénomène significatif'
    : 'CAVOK — visibility ≥ 10 km, no cloud below 5000 ft, no significant weather';
  const CALM = FR ? 'calme' : 'calm';

  // Décodeur d'une couche nuageuse, tolérant aux « slashes » des stations
  // automatiques : cover/hauteur/type peuvent être remplacés par /// (non
  // déterminé). Ex. BKN026/// (type inconnu), ///CB (nébulosité inconnue, CB).
  // Renvoie la chaîne décodée, ou null si le jeton n'est pas une couche.
  const CLOUD_RE = /^(FEW|SCT|BKN|OVC|VV|\/\/\/)(\d{3}|\/\/\/)?(CB|TCU|\/\/\/)?$/;
  function decodeCloud(tk) {
    const m = tk.match(CLOUD_RE);
    if (!m) return null;
    const coverKnown = m[1] !== '///';
    const heightKnown = m[2] && m[2] !== '///';
    let s;
    if (coverKnown) {
      s = COVER[m[1]] || m[1];
      s += heightKnown ? ` ${FR ? 'à' : 'at'} ${parseInt(m[2], 10) * 100} ft`
                       : (FR ? ' (hauteur non précisée)' : ' (height N/A)');
    } else {
      s = FR ? 'nébulosité non précisée' : 'cloud amount N/A';
      if (heightKnown) s += ` ${FR ? 'à' : 'at'} ${parseInt(m[2], 10) * 100} ft`;
    }
    if (m[3] === 'CB') s += CB.CB;
    else if (m[3] === 'TCU') s += CB.TCU;
    return s;
  }

  const out = [];
  const push = (label, value) => out.push({ label, value });
  if (!raw) return out;

  const tokens = String(raw)
    .replace(/^(METAR|SPECI)\s+/i, '').replace(/=\s*$/, '').trim().split(/\s+/);
  let i = 0;

  // Station (4 lettres) — déjà affichée dans l'en-tête, on saute.
  if (tokens[i] && /^[A-Z]{4}$/.test(tokens[i])) i++;

  // Date/heure ddhhmmZ
  if (tokens[i] && /^\d{6}Z$/.test(tokens[i])) {
    const d = tokens[i];
    push(t('mdObs'), `${DAYS} ${d.slice(0, 2)} ${AT} ${d.slice(2, 4)}:${d.slice(4, 6)} UTC`);
    i++;
  }
  // AUTO / COR (ignorés pour l'affichage)
  while (tokens[i] === 'AUTO' || tokens[i] === 'COR') i++;

  // Vent
  if (tokens[i] && /^(\d{3}|VRB)P?\d{2,3}(GP?\d{2,3})?(KT|MPS|KMH)$/.test(tokens[i])) {
    const m = tokens[i].match(/^(\d{3}|VRB)P?(\d{2,3})(?:GP?(\d{2,3}))?(KT|MPS|KMH)$/);
    const unit = m[4] === 'KT' ? 'kt' : (m[4] === 'MPS' ? 'm/s' : 'km/h');
    let v;
    if (parseInt(m[2], 10) === 0 && m[1] === '000') v = CALM;
    else {
      const dir = m[1] === 'VRB' ? (FR ? 'variable' : 'variable') : `${parseInt(m[1], 10)}°`;
      v = `${dir} / ${parseInt(m[2], 10)} ${unit}`;
      if (m[3]) v += `, ${GUST} ${parseInt(m[3], 10)} ${unit}`;
    }
    i++;
    if (tokens[i] && /^\d{3}V\d{3}$/.test(tokens[i])) {
      const vm = tokens[i].match(/^(\d{3})V(\d{3})$/);
      v += `, ${VARY} ${parseInt(vm[1], 10)}° ${FR ? 'à' : 'to'} ${parseInt(vm[2], 10)}°`;
      i++;
    }
    push(t('mdWind'), v);
  }

  // Visibilité / CAVOK
  if (tokens[i] === 'CAVOK') {
    push(t('mdVis'), CAVOK); i++;
  } else if (tokens[i] && /^\d{4}$/.test(tokens[i])) {
    const v = parseInt(tokens[i], 10);
    push(t('mdVis'), v >= 9999 ? '≥ 10 km' : (v >= 5000 ? `${(v / 1000).toFixed(0)} km` : `${v} m`));
    i++;
    while (tokens[i] && /^\d{4}[NSEW]{1,2}$/.test(tokens[i])) i++; // visi directionnelle
  } else if (tokens[i] && /^(M)?\d+(\/\d+)?SM$/.test(tokens[i])) {
    let vis = tokens[i].replace('SM', ' SM').replace(/^M/, '< ');
    if (tokens[i + 1] && /^\d+\/\d+SM$/.test(tokens[i + 1])) { vis = `${parseInt(tokens[i], 10)} ${tokens[i + 1].replace('SM', ' SM')}`; i++; }
    push(t('mdVis'), vis); i++;
  }

  // RVR (R30/0600 …) — ignoré (rarement utile en VFR)
  while (tokens[i] && /^R\d{2}[LRC]?\//.test(tokens[i])) i++;

  // Phénomènes météo
  const isWx = (tk) => /^(\+|-|VC)?(MI|PR|BC|DR|BL|SH|TS|FZ)*(DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PO|SQ|FC|SS|DS)+$/.test(tk)
    && !/^(NSC|NCD|SKC|CLR)$/.test(tk);
  const wx = [];
  while (tokens[i] && isWx(tokens[i])) { wx.push(decodeWx(tokens[i], { INTENS, DESC, PHENOM })); i++; }
  if (wx.length) push(t('mdWx'), wx.join(', '));

  // Nuages (gère les couches « slashées » des stations auto : BKN026///, ///CB)
  const clouds = [];
  while (tokens[i]) {
    const c = decodeCloud(tokens[i]);
    if (c === null) break;
    clouds.push(c);
    i++;
  }
  if (clouds.length) push(t('mdClouds'), clouds.join(' · '));
  else if (tokens[i] && NOCLOUD[tokens[i]]) { push(t('mdClouds'), NOCLOUD[tokens[i]]); i++; }

  // Température / point de rosée
  if (tokens[i] && /^M?\d{2}\/M?\d{2}$/.test(tokens[i])) {
    const m = tokens[i].match(/^(M?\d{2})\/(M?\d{2})$/);
    const c = (s) => `${s.startsWith('M') ? '-' : ''}${parseInt(s.replace('M', ''), 10)} °C`;
    push(t('mdTemp'), c(m[1]));
    push(t('mdDew'), c(m[2]));
    i++;
  }

  // QNH
  if (tokens[i] && /^Q\d{4}$/.test(tokens[i])) {
    push(t('mdQnh'), `${parseInt(tokens[i].slice(1), 10)} hPa`); i++;
  } else if (tokens[i] && /^A\d{4}$/.test(tokens[i])) {
    const inHg = parseInt(tokens[i].slice(1), 10) / 100;
    push(t('mdQnh'), `${inHg.toFixed(2)} inHg (${Math.round(inHg * 33.8639)} hPa)`); i++;
  }

  // Décode le contenu d'un groupe d'évolution (après TEMPO / BECMG) :
  // indicateurs horaires FM/TL/AT, vent, visibilité, phénomènes, nuages, NSW.
  // Réutilise les dictionnaires et helpers ci-dessus.
  function decodeChange(toks) {
    const parts = [];
    for (let j = 0; j < toks.length; j++) {
      const tk = toks[j];
      let m;
      if (TREND[tk]) { parts.push(TREND[tk]); continue; }
      if ((m = tk.match(/^(FM|TL|AT)(\d{2})(\d{2})$/))) {
        const word = m[1] === 'FM' ? (FR ? 'à partir de' : 'from')
          : m[1] === 'TL' ? (FR ? "jusqu'à" : 'until')
          : (FR ? 'à' : 'at');
        parts.push(`${word} ${m[2]}:${m[3]}`);
        continue;
      }
      if ((m = tk.match(/^(\d{3}|VRB)P?(\d{2,3})(?:GP?(\d{2,3}))?(KT|MPS|KMH)$/))) {
        const unit = m[4] === 'KT' ? 'kt' : (m[4] === 'MPS' ? 'm/s' : 'km/h');
        let v;
        if (parseInt(m[2], 10) === 0 && m[1] === '000') v = CALM;
        else {
          const dir = m[1] === 'VRB' ? (FR ? 'variable' : 'variable') : `${parseInt(m[1], 10)}°`;
          v = `${dir} / ${parseInt(m[2], 10)} ${unit}`;
          if (m[3]) v += `, ${GUST} ${parseInt(m[3], 10)} ${unit}`;
        }
        parts.push(`${FR ? 'vent' : 'wind'} ${v}`);
        continue;
      }
      if ((m = tk.match(/^(\d{3})V(\d{3})$/))) {
        parts.push(`${VARY} ${parseInt(m[1], 10)}° ${FR ? 'à' : 'to'} ${parseInt(m[2], 10)}°`);
        continue;
      }
      if (tk === 'CAVOK') { parts.push('CAVOK'); continue; }
      if (tk === 'NSW') { parts.push(FR ? 'fin des phénomènes significatifs' : 'no significant weather'); continue; }
      if (/^\d{4}$/.test(tk)) {
        const v = parseInt(tk, 10);
        parts.push(`${FR ? 'visi' : 'vis'} ` + (v >= 9999 ? '≥ 10 km' : (v >= 5000 ? `${(v / 1000).toFixed(0)} km` : `${v} m`)));
        continue;
      }
      if (/^(M)?\d+(\/\d+)?SM$/.test(tk)) {
        parts.push(`${FR ? 'visi' : 'vis'} ` + tk.replace('SM', ' SM').replace(/^M/, '< '));
        continue;
      }
      const cloud = decodeCloud(tk);
      if (cloud !== null) { parts.push(cloud); continue; }
      if (NOCLOUD[tk]) { parts.push(NOCLOUD[tk]); continue; }
      if (isWx(tk)) { parts.push(decodeWx(tk, { INTENS, DESC, PHENOM })); continue; }
      parts.push(tk); // jeton non reconnu : laissé brut
    }
    return parts.join(', ');
  }

  // Évolution (NOSIG / BECMG / TEMPO) + Remarques (RMK …)
  const rest = tokens.slice(i);
  const rmkIdx = rest.indexOf('RMK');
  const trendToks = rmkIdx >= 0 ? rest.slice(0, rmkIdx) : rest;
  const rmkToks = rmkIdx >= 0 ? rest.slice(rmkIdx + 1) : [];
  if (trendToks.length) {
    if (TREND[trendToks[0]]) {
      const head = TREND[trendToks[0]];
      const tail = decodeChange(trendToks.slice(1));
      push(t('mdTrend'), tail ? `${head} : ${tail}` : head);
    } else {
      push(t('mdTrend'), decodeChange(trendToks));
    }
  }
  if (rmkToks.length) push(t('mdRmk'), rmkToks.join(' '));

  return out;
}

// Décode un groupe de phénomène (ex. "+SHRA", "VCTS", "FZFG").
function decodeWx(tk, dicts) {
  const { INTENS, DESC, PHENOM } = dicts;
  let s = tk, prefix = '';
  const im = s.match(/^(\+|-|VC)/);
  if (im) { prefix += INTENS[im[1]] || ''; s = s.slice(im[1].length); }
  let parts = '';
  for (let k = 0; k < s.length; k += 2) {
    const code = s.slice(k, k + 2);
    if (DESC[code]) parts += DESC[code];
    else if (PHENOM[code]) parts += (parts && !parts.endsWith(' ') ? ' ' : '') + PHENOM[code] + ' ';
    else parts += code + ' ';
  }
  return (prefix + parts).trim();
}

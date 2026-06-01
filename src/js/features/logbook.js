// ============================================================
// NavXpressVFR — logbook.js (feature renderer)
// Bouton « 📖 Carnet de vol » → modale liste des vols + modale détails.
//
// Données : window.api.logbookHistorique() → { ok, flights:[] }
// (handler main 'logbook-historique' qui lit logbook/flights.jsonl).
// Chaque vol a la forme écrite par logbook.js (main process) :
//   { id, aircraft:{category,type,model,title},
//     departure:{icao,name,lat,lon,offBlockUtc,takeoffUtc},
//     arrival:{icao,name,lat,lon,landingUtc,onBlockUtc}|null,
//     totals:{blockMinutes,flightMinutes}, touchAndGoCount,
//     landing:{ts,verticalSpeedFpm,gForceMax,bufferSize}|null,
//     touchAndGoLandings:[...], route:[{ident,name,pattern,...}], directTo:[...] }
//
// Liste triée du plus récent au plus ancien. Colonnes : Date, Durée du vol,
// Avion (SimVar Title), ICAO départ, ICAO arrivée, Détails (bouton).
//
// initLogbook() est appelée par l'orchestrateur ui.js.
// ============================================================

// Libellés de la modale détails (rendus dynamiquement → map locale bilingue,
// même approche que formatAirportType dans utils.js, pour ne pas alourdir
// i18n.js de ~30 clés à usage unique).
const LB_LABELS = {
  fr: {
    secAircraft: 'Appareil', secDep: 'Départ', secArr: 'Arrivée', secTimes: 'Temps',
    secLanding: 'Atterrissage final', secTng: 'Touch-and-go', secRoute: 'Route', secDt: 'Direct To',
    category: 'Catégorie', type: 'Type', model: 'Modèle', title: 'Détail appareil',
    icao: 'ICAO', name: 'Nom', offBlock: 'Off-block', takeoff: 'Décollage',
    landing: 'Atterrissage', onBlock: 'On-block',
    blockTime: 'Temps block', flightTime: 'Temps de vol',
    vs: 'Vitesse vert.', gForce: 'Facteur charge', tngCount: 'Touch-and-go',
    precision: 'Précision du vol',
    noArrival: 'Vol non terminé (pas d\'arrivée enregistrée).',
    wpPattern: 'tour de piste',
    dtPlan: 'Vers waypoint du plan', dtAirport: 'Vers aéroport', dtPoint: 'Vers point carte',
  },
  en: {
    secAircraft: 'Aircraft', secDep: 'Departure', secArr: 'Arrival', secTimes: 'Times',
    secLanding: 'Final landing', secTng: 'Touch-and-go', secRoute: 'Route', secDt: 'Direct To',
    category: 'Category', type: 'Type', model: 'Model', title: 'Aircraft detail',
    icao: 'ICAO', name: 'Name', offBlock: 'Off-block', takeoff: 'Takeoff',
    landing: 'Landing', onBlock: 'On-block',
    blockTime: 'Block time', flightTime: 'Flight time',
    vs: 'Vertical speed', gForce: 'Load factor', tngCount: 'Touch-and-go',
    precision: 'Flight precision',
    noArrival: 'Flight not completed (no arrival recorded).',
    wpPattern: 'pattern',
    dtPlan: 'To plan waypoint', dtAirport: 'To airport', dtPoint: 'To map point',
  },
};

function initLogbook() {
  const btn = document.getElementById('btn-logbook');
  if (!btn) return;

  const overlay = document.getElementById('logbook-overlay');
  const tbody = document.getElementById('logbook-tbody');
  const emptyEl = document.getElementById('logbook-empty');
  const tableEl = document.getElementById('logbook-table');
  const btnClose = document.getElementById('btn-logbook-close');

  const detailOverlay = document.getElementById('logbook-detail-overlay');
  const detailBody = document.getElementById('logbook-detail-body');
  const btnDetailClose = document.getElementById('btn-logbook-detail-close');

  // Vols actuellement affichés, déjà triés (récent → ancien). L'index de
  // chaque bouton Détails pointe dans ce tableau.
  let _flights = [];

  // --- Helpers de formatage --------------------------------------------
  const esc = (s) => escapeHtml(s);
  const _loc = () => (currentLang === 'en' ? 'en-US' : 'fr-FR');
  const _lbl = (k) => (LB_LABELS[currentLang] || LB_LABELS.fr)[k] || LB_LABELS.fr[k] || k;

  // Timestamp de référence d'un vol pour le tri / la date affichée.
  function _flightTs(f) {
    const iso = (f && f.id) || (f && f.departure && f.departure.offBlockUtc) || null;
    const ms = iso ? Date.parse(iso) : NaN;
    return Number.isFinite(ms) ? ms : 0;
  }

  function _fmtDate(iso) {
    const ms = iso ? Date.parse(iso) : NaN;
    if (!Number.isFinite(ms)) return '—';
    return new Date(ms).toLocaleDateString(_loc(), { year: 'numeric', month: '2-digit', day: '2-digit' });
  }

  function _fmtDateTime(iso) {
    const ms = iso ? Date.parse(iso) : NaN;
    if (!Number.isFinite(ms)) return '—';
    return new Date(ms).toLocaleString(_loc(), {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    });
  }

  function _fmtTime(iso) {
    const ms = iso ? Date.parse(iso) : NaN;
    if (!Number.isFinite(ms)) return '—';
    return new Date(ms).toLocaleTimeString(_loc(), { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  // Durée en minutes → « 1 h 23 » / « 1h 23 » ou « 45 min ».
  function _fmtDuration(min) {
    if (!Number.isFinite(min)) return '—';
    const h = Math.floor(min / 60);
    const m = min % 60;
    if (h > 0) return `${h} h ${String(m).padStart(2, '0')}`;
    return `${m} min`;
  }

  function _fmtCoord(x) {
    return Number.isFinite(x) ? x.toFixed(4) : '—';
  }

  // --- Modale liste -----------------------------------------------------
  function _rowHtml(f, idx) {
    const dep = f.departure || {};
    const arr = f.arrival || null;
    const dateIso = dep.takeoffUtc || dep.offBlockUtc || f.id;
    const aircraft = (f.aircraft && f.aircraft.title) ? f.aircraft.title : '—';
    const depIcao = dep.icao || '—';
    const arrIcao = (arr && arr.icao) ? arr.icao : '—';
    const dur = f.totals ? _fmtDuration(f.totals.flightMinutes) : '—';
    return `<tr>
      <td>${esc(_fmtDate(dateIso))}</td>
      <td>${esc(dur)}</td>
      <td class="lb-aircraft" title="${esc(aircraft)}">${esc(aircraft)}</td>
      <td class="lb-icao">${esc(depIcao)}</td>
      <td class="lb-icao">${esc(arrIcao)}</td>
      <td><button type="button" class="lb-details-btn" data-idx="${idx}">${esc(t('lbBtnDetails'))}</button></td>
    </tr>`;
  }

  async function _openList() {
    if (!window.api || typeof window.api.logbookHistorique !== 'function') {
      showToast(t('lbReadError'), 'error', 3000);
      return;
    }
    try {
      const res = await window.api.logbookHistorique();
      const flights = (res && Array.isArray(res.flights)) ? res.flights : [];
      _flights = flights.slice().sort((a, b) => _flightTs(b) - _flightTs(a));

      if (_flights.length === 0) {
        tbody.innerHTML = '';
        if (tableEl) tableEl.style.display = 'none';
        if (emptyEl) emptyEl.style.display = '';
      } else {
        if (tableEl) tableEl.style.display = '';
        if (emptyEl) emptyEl.style.display = 'none';
        tbody.innerHTML = _flights.map((f, i) => _rowHtml(f, i)).join('');
      }
      if (overlay) overlay.classList.add('visible');
    } catch (err) {
      console.error('[Carnet de vol] Lecture KO :', err);
      showToast(t('lbReadError'), 'error', 3000);
    }
  }

  function _closeList() {
    if (overlay) overlay.classList.remove('visible');
  }

  // --- Modale détails ---------------------------------------------------
  function _section(title, innerHtml) {
    return `<div class="lb-detail-section"><h4>${esc(title)}</h4>${innerHtml}</div>`;
  }

  function _openDetail(f) {
    if (!f || !detailBody || !detailOverlay) return;
    const ac = f.aircraft || {};
    const dep = f.departure || {};
    const arr = f.arrival || null;
    const tot = f.totals || {};
    const land = f.landing || null;

    let html = '';

    // Appareil
    html += _section(_lbl('secAircraft'), buildKVTable([
      [_lbl('category'), esc(ac.category) || '—'],
      [_lbl('type'), esc(ac.type) || '—'],
      [_lbl('model'), esc(ac.model) || '—'],
      [_lbl('title'), esc(ac.title) || '—'],
    ]));

    // Départ
    html += _section(_lbl('secDep'), buildKVTable([
      [_lbl('icao'), `<span class="lb-icao">${esc(dep.icao) || '—'}</span>`],
      [_lbl('name'), esc(dep.name) || '—'],
      [_lbl('offBlock'), esc(_fmtDateTime(dep.offBlockUtc))],
      [_lbl('takeoff'), esc(_fmtDateTime(dep.takeoffUtc))],
    ]));

    // Arrivée
    if (arr) {
      html += _section(_lbl('secArr'), buildKVTable([
        [_lbl('icao'), `<span class="lb-icao">${esc(arr.icao) || '—'}</span>`],
        [_lbl('name'), esc(arr.name) || '—'],
        [_lbl('landing'), esc(_fmtDateTime(arr.landingUtc))],
        [_lbl('onBlock'), esc(_fmtDateTime(arr.onBlockUtc))],
      ]));
    } else {
      html += _section(_lbl('secArr'), `<div class="lb-muted">${esc(_lbl('noArrival'))}</div>`);
    }

    // Temps
    html += _section(_lbl('secTimes'), buildKVTable([
      [_lbl('blockTime'), esc(_fmtDuration(tot.blockMinutes))],
      [_lbl('flightTime'), esc(_fmtDuration(tot.flightMinutes))],
    ]));

    // Atterrissage final + compteur T&G
    const landRows = [];
    if (land) {
      landRows.push([_lbl('vs'), `${esc(land.verticalSpeedFpm)} ft/min`]);
      landRows.push([_lbl('gForce'), `${esc(land.gForceMax)} G`]);
    } else {
      landRows.push([_lbl('vs'), '—']);
    }
    landRows.push([_lbl('tngCount'), esc(String(f.touchAndGoCount || 0))]);
    // Score de précision (présent seulement si l'évaluation était active à ce vol).
    if (Number.isFinite(f.precision)) {
      landRows.push([_lbl('precision'), `${esc(String(f.precision))} %`]);
    }
    html += _section(_lbl('secLanding'), buildKVTable(landRows));

    // Liste des touch-and-go (chacun avec sa VS/G)
    const tng = Array.isArray(f.touchAndGoLandings) ? f.touchAndGoLandings : [];
    if (tng.length) {
      const items = tng.map((tg, i) =>
        `<li>#${i + 1} — ${esc(tg.verticalSpeedFpm)} ft/min · ${esc(tg.gForceMax)} G `
        + `<span class="lb-muted">· ${esc(_fmtTime(tg.ts))}</span></li>`).join('');
      html += _section(_lbl('secTng'), `<ul class="lb-list">${items}</ul>`);
    }

    // Route (waypoints figés au décollage) — tous les legs sur une seule ligne,
    // séparés par des flèches : LFMA → LFNR (tour de piste) → … → LFNZ
    const route = Array.isArray(f.route) ? f.route : [];
    if (route.length) {
      const items = route.map((wp) => {
        const label = esc(wp.ident || wp.name || '?');
        const pat = wp.pattern ? ` <span class="lb-muted">(${esc(_lbl('wpPattern'))})</span>` : '';
        return label + pat;
      }).join(' <span class="lb-route-arrow">→</span> ');
      html += _section(_lbl('secRoute'), `<div class="lb-route">${items}</div>`);
    }

    // Direct To effectués pendant le vol
    const dts = Array.isArray(f.directTo) ? f.directTo : [];
    if (dts.length) {
      const items = dts.map((d) => {
        let label;
        if (d.kind === 'plan') {
          label = `${esc(_lbl('dtPlan'))} : ${esc(d.name || ('#' + d.targetIndex))}`;
        } else if (d.kind === 'airport') {
          label = `${esc(_lbl('dtAirport'))} : ${esc(d.code || '')} ${esc(d.name || '')}`;
        } else if (d.kind === 'point') {
          label = `${esc(_lbl('dtPoint'))} (${esc(_fmtCoord(d.lat))}, ${esc(_fmtCoord(d.lon))})`;
        } else {
          label = esc(d.kind);
        }
        return `<li>${label} <span class="lb-muted">· ${esc(_fmtTime(d.ts))}</span></li>`;
      }).join('');
      html += _section(_lbl('secDt'), `<ul class="lb-list">${items}</ul>`);
    }

    detailBody.innerHTML = html;
    detailOverlay.classList.add('visible');
  }

  function _closeDetail() {
    if (detailOverlay) detailOverlay.classList.remove('visible');
  }

  // --- Câblage ----------------------------------------------------------
  btn.addEventListener('click', _openList);

  // Délégation : un seul listener pour tous les boutons Détails.
  if (tbody) {
    tbody.addEventListener('click', (e) => {
      const b = e.target.closest('.lb-details-btn');
      if (!b) return;
      const idx = parseInt(b.getAttribute('data-idx'), 10);
      if (Number.isFinite(idx) && _flights[idx]) _openDetail(_flights[idx]);
    });
  }

  if (btnClose) btnClose.addEventListener('click', _closeList);
  if (overlay) overlay.addEventListener('click', (e) => { if (e.target === overlay) _closeList(); });

  if (btnDetailClose) btnDetailClose.addEventListener('click', _closeDetail);
  if (detailOverlay) detailOverlay.addEventListener('click', (e) => { if (e.target === detailOverlay) _closeDetail(); });

  // Escape : ferme d'abord la modale détails (au-dessus), sinon la liste.
  // (La modale de fin de vol n'est PAS fermable par Escape : elle exige un
  // choix explicite Oui/Non pour ne pas perdre l'enregistrement par accident.)
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (detailOverlay && detailOverlay.classList.contains('visible')) _closeDetail();
    else if (overlay && overlay.classList.contains('visible')) _closeList();
  });

  // --- Modale « Le vol est-il terminé ? » (déclenchée par le moteur main) ---
  const endOverlay = document.getElementById('logbook-end-overlay');
  const endSummary = document.getElementById('logbook-end-summary');
  const btnEndYes = document.getElementById('btn-logbook-end-yes');
  const btnEndNo = document.getElementById('btn-logbook-end-no');

  function _closeEnd() { if (endOverlay) endOverlay.classList.remove('visible'); }
  function _respondEnd(confirmed) {
    _closeEnd();
    // Si l'utilisateur confirme la fin du vol, on finalise l'évaluation de
    // précision AVANT l'IPC : finalize() applique la contribution des touchers,
    // affiche la modale résultat, et renvoie le score à stocker dans la fiche
    // du vol. Sur « Non », le vol continue → on ne touche pas à la précision.
    let precision = null;
    if (confirmed && window.precision && typeof window.precision.finalize === 'function') {
      try { precision = window.precision.finalize(); }
      catch (err) { console.warn('[Précision] finalize KO :', err); }
    }
    if (window.api && typeof window.api.logbookEndResponse === 'function') {
      window.api.logbookEndResponse(confirmed, precision).catch((err) => {
        console.warn('[Carnet de vol] Réponse fin de vol KO :', err);
      });
    }
  }
  if (btnEndYes) btnEndYes.addEventListener('click', () => _respondEnd(true));
  if (btnEndNo) btnEndNo.addEventListener('click', () => _respondEnd(false));

  if (window.api && typeof window.api.onLogbookConfirmEnd === 'function') {
    window.api.onLogbookConfirmEnd((summary) => {
      if (endSummary) {
        const dep = (summary && summary.departureIcao) || '—';
        const arr = (summary && summary.arrivalIcao) || '—';
        const ac = (summary && summary.aircraft) || '';
        const tng = (summary && summary.touchAndGoCount) || 0;
        let html = `<div class="lb-end-route"><span class="lb-icao">${esc(dep)}</span>`
          + ` → <span class="lb-icao">${esc(arr)}</span></div>`;
        if (ac) html += `<div class="lb-end-aircraft">${esc(ac)}</div>`;
        if (tng) html += `<div class="lb-muted">${esc(String(tng))} touch-and-go</div>`;
        endSummary.innerHTML = html;
      }
      if (endOverlay) endOverlay.classList.add('visible');
    });
  }
  if (window.api && typeof window.api.onLogbookConfirmCancel === 'function') {
    window.api.onLogbookConfirmCancel(() => _closeEnd());
  }
}

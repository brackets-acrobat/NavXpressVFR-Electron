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
// NavXpressVFR — logbook.js (feature renderer)
// Bouton « Carnet de vol » → modale liste des vols + modale détails.
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
    // Mise en page paysage
    flightNo: 'Vol N°', date: 'Date', acField: 'Avion', from: 'De', to: 'Vers',
    brakesOff: 'Freins Off', brakesOn: 'Freins On',
    secTouches: 'Touchers', colTime: 'Heure', colVs: 'VS', colG: 'G',
    noTouches: 'Aucun toucher', noLanding: 'Aucun atterrissage enregistré',
    mapBtn: 'Voir le tracé sur la carte', noRoute: 'Route non enregistrée',
    touchMarker: 'Toucher', vpRelief: 'Relief', vpAircraft: 'Avion',
    vpAlt: 'Alt (ft)', vpDist: 'Dist (NM)',
    vpNoTrack: 'Tracé effectif non disponible (vol enregistré avant cette version).',
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
    // Landscape layout
    flightNo: 'Flight No.', date: 'Date', acField: 'Aircraft', from: 'From', to: 'To',
    brakesOff: 'Brakes off', brakesOn: 'Brakes on',
    secTouches: 'Touch-and-go', colTime: 'Time', colVs: 'VS', colG: 'G',
    noTouches: 'No touch-and-go', noLanding: 'No landing recorded',
    mapBtn: 'View route on map', noRoute: 'Route not recorded',
    touchMarker: 'Touchdown', vpRelief: 'Terrain', vpAircraft: 'Aircraft',
    vpAlt: 'Alt (ft)', vpDist: 'Dist (NM)',
    vpNoTrack: 'Actual track unavailable (flight recorded before this version).',
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

  // Modale carte du tracé (Leaflet dédié, plan de vol seul).
  const rmOverlay = document.getElementById('logbook-route-map-overlay');
  const btnRmClose = document.getElementById('btn-logbook-route-map-close');
  const vpEl = document.getElementById('logbook-vert-profile'); // profil vertical
  let _routeMap = null;        // instance Leaflet (créée à la 1re ouverture)
  let _routeLayer = null;      // L.layerGroup contenant tracé + marqueurs
  let _detailFlight = null;    // vol actuellement affiché dans la modale détails

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

  function _fmtTime(iso) {
    const ms = iso ? Date.parse(iso) : NaN;
    if (!Number.isFinite(ms)) return '—';
    return new Date(ms).toLocaleTimeString(_loc(), { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  // --- Date & heure LOCALES du simulateur ------------------------------
  // sim = chaîne « AAAA-MM-JJTHH:MM:SS » = horloge MURALE du simulateur (date +
  // heure simulées, météo/éphémérides comprises). On la parse SANS objet Date
  // (pas de conversion de fuseau du PC) et on formate selon la langue, suivi de
  // « (Loc.) ». Les vols enregistrés AVANT cette version n'ont pas ce champ :
  // on retombe alors sur le timestamp PC (sans « (Loc.) »).
  function _parseSim(sim) {
    if (typeof sim !== 'string') return null;
    const m = sim.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/);
    if (!m) return null;
    return { y: m[1], mo: m[2], d: m[3], hh: m[4], mi: m[5], ss: m[6] };
  }

  // Heure simulée seule + « (Loc.) ». Fallback : heure PC du timestamp.
  function _fmtSimTime(sim, isoFallback) {
    const p = _parseSim(sim);
    if (!p) return _fmtTime(isoFallback);
    return `${p.hh}:${p.mi}:${p.ss} (Loc.)`;
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
    // Date RÉELLE du vol (timestamp PC) : la liste est triée et affichée selon
    // l'ordre chronologique réel des vols effectués. Seul le RAPPORT (détail)
    // affiche les dates/heures simulées.
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
  // Petit champ « encadré » lecture seule : libellé + valeur en boîte.
  // valHtml peut contenir du HTML déjà échappé (ex. <span class="lb-icao">).
  function _pgField(label, valHtml, extraClass) {
    const cls = extraClass ? ` ${extraClass}` : '';
    return `<div class="lb-pg-field${cls}"><label>${esc(label)}</label>`
      + `<span class="lb-pg-val">${valHtml}</span></div>`;
  }

  // Mise en page PAYSAGE façon Plan-G (lecture seule). Toutes les heures sont en
  // heure simulateur « (Loc.) » (fallback PC) ; seule la Date d'en-tête est la
  // date RÉELLE du vol (cohérent avec la colonne Date de la liste).
  function _openDetail(f) {
    if (!f || !detailBody || !detailOverlay) return;
    _detailFlight = f;
    const ac = f.aircraft || {};
    const dep = f.departure || {};
    const arr = f.arrival || null;
    const tot = f.totals || {};
    const land = f.landing || null;

    const dash = '<span class="lb-muted">—</span>';
    const volNo = Number.isFinite(f.seq) ? String(f.seq).padStart(4, '0') : '—';
    const dateIso = dep.takeoffUtc || dep.offBlockUtc || f.id;
    const precStr = Number.isFinite(f.precision) ? `${f.precision} %` : '—';
    const acStr = ac.title || [ac.type, ac.model].filter(Boolean).join(' ') || '—';
    const depIcao = dep.icao ? `<span class="lb-icao">${esc(dep.icao)}</span>` : dash;
    const arrIcao = (arr && arr.icao) ? `<span class="lb-icao">${esc(arr.icao)}</span>` : dash;

    // Bloc des temps (off-block / décollage / atterrissage / on-block + durées).
    const tOffBlock = _fmtSimTime(dep.offBlockSim, dep.offBlockUtc);
    const tTakeoff = _fmtSimTime(dep.takeoffSim, dep.takeoffUtc);
    const tLanding = arr ? _fmtSimTime(arr.landingSim, arr.landingUtc) : '—';
    const tOnBlock = arr ? _fmtSimTime(arr.onBlockSim, arr.onBlockUtc) : '—';

    // Route textuelle (legs séparés par des flèches) + flag présence de coords.
    const route = Array.isArray(f.route) ? f.route : [];
    const trackArr = Array.isArray(f.track) ? f.track : [];
    const hasRouteCoords = route.some(wp => Number.isFinite(wp.lat) && Number.isFinite(wp.lon))
      || trackArr.some(p => Number.isFinite(p.lat) && Number.isFinite(p.lon));
    let routeHtml = `<span class="lb-muted">${esc(_lbl('noRoute'))}</span>`;
    if (route.length) {
      routeHtml = route.map((wp) => {
        const label = esc(wp.ident || wp.name || '?');
        const pat = wp.pattern ? ` <span class="lb-muted">(${esc(_lbl('wpPattern'))})</span>` : '';
        return label + pat;
      }).join(' <span class="lb-route-arrow">→</span> ');
    }
    const mapBtn = hasRouteCoords
      ? `<button type="button" class="lb-map-btn" title="${esc(_lbl('mapBtn'))}" aria-label="${esc(_lbl('mapBtn'))}"><i class="ph-light ph-map-trifold" aria-hidden="true"></i></button>`
      : '';

    // Panneau « Touchers » (touch-and-go) : tableau n° / heure / VS / G.
    const tng = Array.isArray(f.touchAndGoLandings) ? f.touchAndGoLandings : [];
    const tngHead = `<tr><th>#</th><th>${esc(_lbl('colTime'))}</th>`
      + `<th>${esc(_lbl('colVs'))}</th><th>${esc(_lbl('colG'))}</th></tr>`;
    const tngBody = tng.length
      ? tng.map((tg, i) =>
          `<tr><td>${i + 1}</td><td>${esc(_fmtSimTime(tg.sim, tg.ts))}</td>`
          + `<td>${esc(tg.verticalSpeedFpm)} ft/min</td><td>${esc(tg.gForceMax)} G</td></tr>`).join('')
      : `<tr><td colspan="4" class="lb-muted">${esc(_lbl('noTouches'))}</td></tr>`;

    // Panneau « Atterrissage final » : heure / VS / G (une ligne).
    const landHead = `<tr><th>${esc(_lbl('colTime'))}</th>`
      + `<th>${esc(_lbl('colVs'))}</th><th>${esc(_lbl('colG'))}</th></tr>`;
    const landBody = land
      ? `<tr><td>${esc(_fmtSimTime(land.sim, land.ts))}</td>`
        + `<td>${esc(land.verticalSpeedFpm)} ft/min</td><td>${esc(land.gForceMax)} G</td></tr>`
      : `<tr><td colspan="3" class="lb-muted">${esc(_lbl('noLanding'))}</td></tr>`;

    let html = '<div class="lb-pg">';

    // Ligne 1 : Vol N° · Date réelle · Précision (remplace « Simu » de Plan-G)
    html += '<div class="lb-pg-row lb-pg-head">'
      + _pgField(_lbl('flightNo'), esc(volNo))
      + _pgField(_lbl('date'), esc(_fmtDate(dateIso)))
      + _pgField(_lbl('precision'), esc(precStr))
      + '</div>';

    // Ligne 2 : Avion (pleine largeur)
    html += '<div class="lb-pg-row">'
      + _pgField(_lbl('acField'), esc(acStr), 'lb-pg-wide')
      + '</div>';

    // Lignes 3-4 : déroulé chronologique du vol, grille 4 colonnes × 2 lignes
    //   L3 (départ) : De · Freins Off · Décollage · Temps de vol
    //   L4 (arrivée) : Vers · Atterrissage · Freins On · Temps block
    html += '<div class="lb-pg-row">'
      + '<div class="lb-pg-grid4">'
      +   _pgField(_lbl('from'), depIcao)
      +   _pgField(_lbl('brakesOff'), esc(tOffBlock))
      +   _pgField(_lbl('takeoff'), esc(tTakeoff))
      +   _pgField(_lbl('flightTime'), esc(_fmtDuration(tot.flightMinutes)))
      +   _pgField(_lbl('to'), arrIcao)
      +   _pgField(_lbl('landing'), esc(tLanding))
      +   _pgField(_lbl('brakesOn'), esc(tOnBlock))
      +   _pgField(_lbl('blockTime'), esc(_fmtDuration(tot.blockMinutes)))
      + '</div>'
      + '</div>';

    // Ligne 4 : Route textuelle + bouton carte
    html += '<div class="lb-pg-row">'
      + '<div class="lb-pg-field lb-pg-wide"><label>' + esc(_lbl('secRoute')) + '</label>'
      +   '<div class="lb-pg-route-line">'
      +     `<span class="lb-pg-val lb-route">${routeHtml}</span>`
      +     mapBtn
      +   '</div>'
      + '</div>'
      + '</div>';

    // Ligne 5 : deux panneaux côte à côte (Touchers | Atterrissage final)
    html += '<div class="lb-pg-row lb-pg-bottom">'
      + `<div class="lb-pg-panel"><h4>${esc(_lbl('secTouches'))}</h4>`
      +   `<table class="lb-pg-table">${tngHead}${tngBody}</table></div>`
      + `<div class="lb-pg-panel"><h4>${esc(_lbl('secLanding'))}</h4>`
      +   `<table class="lb-pg-table">${landHead}${landBody}</table></div>`
      + '</div>';

    // Direct To effectués pendant le vol (conservé, affiché seulement si présent)
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
        return `<li>${label} <span class="lb-muted">· ${esc(_fmtSimTime(d.sim, d.ts))}</span></li>`;
      }).join('');
      html += `<div class="lb-pg-dt"><h4>${esc(_lbl('secDt'))}</h4>`
        + `<ul class="lb-list">${items}</ul></div>`;
    }

    html += '</div>';

    detailBody.innerHTML = html;
    detailOverlay.classList.add('visible');
  }

  function _closeDetail() {
    if (detailOverlay) detailOverlay.classList.remove('visible');
  }

  // --- Modale carte du tracé (Leaflet, plan de vol SEUL) ----------------
  // Déroulage local des longitudes (antiméridien) pour que le tracé suive le
  // plus court chemin, identique à la logique de la carte principale.
  function _routeLatLngs(route) {
    const pts = (route || []).filter(wp => Number.isFinite(wp.lat) && Number.isFinite(wp.lon));
    let prev = null;
    return pts.map((wp) => {
      let lon = wp.lon;
      if (prev !== null) {
        while (lon - prev > 180) lon -= 360;
        while (lon - prev < -180) lon += 360;
      }
      prev = lon;
      return { latlng: [wp.lat, lon], wp };
    });
  }

  // Distance grand-cercle en milles nautiques (pour l'axe du profil vertical).
  function _haversineNm(aLat, aLon, bLat, bLon) {
    const R = 3440.065; // rayon Terre en NM
    const dLat = (bLat - aLat) * Math.PI / 180;
    const dLon = (bLon - aLon) * Math.PI / 180;
    const la1 = aLat * Math.PI / 180, la2 = bLat * Math.PI / 180;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  // Liste ordonnée des touchers (touch-and-go #1..#N puis atterrissage final),
  // avec position + VS, pour les marqueurs violets et leurs tooltips.
  function _touchdowns(f) {
    const tng = Array.isArray(f.touchAndGoLandings) ? f.touchAndGoLandings : [];
    const all = tng.slice();
    if (f.landing) all.push(f.landing);
    return all
      .filter(t => t && Number.isFinite(t.lat) && Number.isFinite(t.lon))
      .map((t, i) => ({ n: i + 1, lat: t.lat, lon: t.lon, vs: t.verticalSpeedFpm }));
  }

  // Construit le SVG du profil vertical : zone de relief (terrain MSL) + courbe
  // de l'avion (MSL = terrain + AGL), axe X = distance cumulée le long du tracé.
  // Si le relief est indisponible (groundElevFt null), référence sol à 0.
  function _buildVertProfile(track) {
    if (!Array.isArray(track) || track.length < 2) {
      return `<div class="lb-vp-empty">${esc(_lbl('vpNoTrack'))}</div>`;
    }
    // Construit les séries (distance cumulée, relief, altitude avion).
    let dist = 0;
    const pts = [];
    for (let i = 0; i < track.length; i++) {
      const t = track[i];
      if (i > 0) {
        const p = track[i - 1];
        if (Number.isFinite(p.lat) && Number.isFinite(t.lat)) {
          dist += _haversineNm(p.lat, p.lon, t.lat, t.lon);
        }
      }
      const ground = Number.isFinite(t.groundElevFt) ? t.groundElevFt : 0;
      // Altitude avion = AMSL réelle (PLANE ALTITUDE). Repli pour les vols
      // enregistrés avant ce champ : relief + AGL.
      const plane = Number.isFinite(t.amslFt)
        ? t.amslFt
        : (ground + (Number.isFinite(t.aglFt) ? t.aglFt : 0));
      pts.push({ d: dist, ground, plane, agl: Number.isFinite(t.aglFt) ? t.aglFt : null });
    }
    const totalD = pts[pts.length - 1].d || 1;
    let minY = Infinity, maxY = -Infinity;
    for (const p of pts) {
      minY = Math.min(minY, p.ground, p.plane);
      maxY = Math.max(maxY, p.ground, p.plane);
    }
    if (minY > 0) minY = 0;                 // ancre le relief au niveau de la mer
    if (maxY - minY < 100) maxY = minY + 100;
    const padY = (maxY - minY) * 0.08;
    minY -= padY * 0.2; maxY += padY;

    // Géométrie SVG
    const W = 780, H = 180, mL = 46, mR = 10, mT = 10, mB = 22;
    const pw = W - mL - mR, ph = H - mT - mB;
    const X = d => mL + (d / totalD) * pw;
    const Y = a => mT + (1 - (a - minY) / (maxY - minY)) * ph;

    // Aire de relief : suit la courbe terrain puis referme sur le bas de l'axe.
    let terr = `M ${X(pts[0].d).toFixed(1)} ${Y(pts[0].ground).toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) terr += ` L ${X(pts[i].d).toFixed(1)} ${Y(pts[i].ground).toFixed(1)}`;
    terr += ` L ${X(totalD).toFixed(1)} ${(mT + ph).toFixed(1)} L ${X(0).toFixed(1)} ${(mT + ph).toFixed(1)} Z`;

    // Courbe avion
    let plane = `M ${X(pts[0].d).toFixed(1)} ${Y(pts[0].plane).toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) plane += ` L ${X(pts[i].d).toFixed(1)} ${Y(pts[i].plane).toFixed(1)}`;

    // Graduations Y (3 repères) + X (départ / milieu / fin)
    const yTicks = [minY, (minY + maxY) / 2, maxY];
    let grid = '';
    for (const v of yTicks) {
      const y = Y(v).toFixed(1);
      grid += `<line x1="${mL}" y1="${y}" x2="${W - mR}" y2="${y}" stroke="#2a2a2a" stroke-width="1"/>`;
      grid += `<text x="${mL - 5}" y="${(Y(v) + 3).toFixed(1)}" fill="#888" font-size="9" text-anchor="end">${Math.round(v)}</text>`;
    }
    let xLabels = '';
    for (const d of [0, totalD / 2, totalD]) {
      xLabels += `<text x="${X(d).toFixed(1)}" y="${H - 6}" fill="#888" font-size="9" text-anchor="middle">${d.toFixed(1)}</text>`;
    }

    // Segments de SURVOL invisibles le long de la ligne avion : un par intervalle,
    // stroke transparent épais (zone de hover confortable). Portent l'AMSL et l'AGL
    // (moyenne des 2 extrémités) lus par le handler tooltip. Dessinés EN DERNIER
    // pour être au-dessus de tout → captent le survol de façon fiable.
    let hits = '';
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const amsl = Math.round((a.plane + b.plane) / 2);
      let agl = null;
      if (Number.isFinite(a.agl) && Number.isFinite(b.agl)) agl = Math.round((a.agl + b.agl) / 2);
      else if (Number.isFinite(a.agl)) agl = a.agl;
      else if (Number.isFinite(b.agl)) agl = b.agl;
      hits += `<line class="lb-vp-hit" x1="${X(a.d).toFixed(1)}" y1="${Y(a.plane).toFixed(1)}"`
        + ` x2="${X(b.d).toFixed(1)}" y2="${Y(b.plane).toFixed(1)}"`
        + ` stroke="#000" stroke-opacity="0" stroke-width="12" pointer-events="stroke"`
        + ` data-amsl="${amsl}" data-agl="${agl === null ? '' : agl}"/>`;
    }

    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(_lbl('vpAlt'))}">`
      + grid
      + `<path d="${terr}" fill="#3d3326" stroke="#6b5a3e" stroke-width="1"/>`
      + `<path d="${plane}" fill="none" stroke="#F7230C" stroke-width="1.8"/>`
      + xLabels
      + `<text x="4" y="${mT + 8}" fill="#888" font-size="9">${esc(_lbl('vpAlt'))}</text>`
      + `<text x="${W - mR}" y="${H - 6}" fill="#888" font-size="9" text-anchor="end">${esc(_lbl('vpDist'))}</text>`
      + hits
      + '</svg>'
      + '<div class="lb-vp-tooltip"></div>';
  }

  function _openRouteMap() {
    if (!rmOverlay || !_detailFlight) return;
    if (typeof L === 'undefined') return;
    const f = _detailFlight;
    const planned = _routeLatLngs(f.route);
    const effective = _routeLatLngs(f.track);
    if (!planned.length && !effective.length) return;

    rmOverlay.classList.add('visible');

    // Profil vertical (rendu HTML synchrone, indépendant de Leaflet).
    if (vpEl) vpEl.innerHTML = _buildVertProfile(f.track);

    // La modale vient d'apparaître (display:flex) : le container a enfin une
    // taille. On initialise / redimensionne Leaflet au tick suivant.
    setTimeout(() => {
      if (!_routeMap) {
        _routeMap = L.map('logbook-route-map', { zoomControl: true });
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
          maxZoom: 19,
        }).addTo(_routeMap);
        _routeLayer = L.layerGroup().addTo(_routeMap);
      }
      _routeMap.invalidateSize();
      _routeLayer.clearLayers();

      const allLatLngs = [];

      // 1) Route PLANIFIÉE (plan de vol) — bleu + marqueurs waypoints
      const plLL = planned.map(p => p.latlng);
      if (plLL.length >= 2) {
        L.polyline(plLL, { color: '#0131B4', weight: 3, opacity: 0.9 }).addTo(_routeLayer);
      }
      planned.forEach((p) => {
        const m = L.circleMarker(p.latlng, {
          radius: 5, fillColor: '#ff7043', color: '#ffffff',
          weight: 1.5, opacity: 1, fillOpacity: 0.95,
        }).addTo(_routeLayer);
        const label = esc(p.wp.ident || p.wp.name || '?')
          + (p.wp.pattern ? ` (${esc(_lbl('wpPattern'))})` : '');
        m.bindTooltip(label, { direction: 'top' });
        allLatLngs.push(p.latlng);
      });

      // 2) Route EFFECTIVE (réellement volée) — rouge-orangé #F7230C, tracée en
      //    SEGMENTS (un par intervalle de 10 s) pour qu'un survol affiche la KIAS
      //    locale (tooltip « sticky » qui suit le curseur). KIAS du segment =
      //    moyenne des deux extrémités (ou la seule valeur dispo).
      for (let i = 1; i < effective.length; i++) {
        const a = effective[i - 1], b = effective[i];
        const seg = L.polyline([a.latlng, b.latlng], {
          color: '#F7230C', weight: 2.5, opacity: 0.9,
        }).addTo(_routeLayer);
        const ka = a.wp.kiasKt, kb = b.wp.kiasKt;
        let kias = null;
        if (Number.isFinite(ka) && Number.isFinite(kb)) kias = Math.round((ka + kb) / 2);
        else if (Number.isFinite(ka)) kias = ka;
        else if (Number.isFinite(kb)) kias = kb;
        if (kias !== null) {
          seg.bindTooltip(`${esc(kias)} KIAS`, { sticky: true, direction: 'top' });
        }
      }
      effective.forEach(p => allLatLngs.push(p.latlng));

      // 3) Touchers — points violets #800080, tooltip n° + VS d'atterrissage
      _touchdowns(f).forEach((td) => {
        const m = L.circleMarker([td.lat, td.lon], {
          radius: 6, fillColor: '#800080', color: '#ffffff',
          weight: 1.5, opacity: 1, fillOpacity: 0.95,
        }).addTo(_routeLayer);
        m.bindTooltip(`${esc(_lbl('touchMarker'))} #${td.n} — ${esc(td.vs)} ft/min`,
          { direction: 'top' });
        allLatLngs.push([td.lat, td.lon]);
      });

      if (allLatLngs.length === 1) _routeMap.setView(allLatLngs[0], 11);
      else if (allLatLngs.length) _routeMap.fitBounds(L.latLngBounds(allLatLngs), { padding: [40, 40] });
    }, 30);
  }

  function _closeRouteMap() {
    if (rmOverlay) rmOverlay.classList.remove('visible');
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

  // Bouton « carte » de la rubrique Route (délégation sur le corps détail).
  if (detailBody) {
    detailBody.addEventListener('click', (e) => {
      if (e.target.closest('.lb-map-btn')) _openRouteMap();
    });
  }
  if (btnRmClose) btnRmClose.addEventListener('click', _closeRouteMap);
  if (rmOverlay) rmOverlay.addEventListener('click', (e) => { if (e.target === rmOverlay) _closeRouteMap(); });

  // Tooltip du profil vertical : survol des segments de la ligne avion → AMSL/AGL
  // (même principe que le tooltip KIAS du tracé effectif). Délégation sur vpEl,
  // dont le contenu (SVG + .lb-vp-tooltip) est reconstruit à chaque ouverture.
  if (vpEl) {
    vpEl.addEventListener('mousemove', (e) => {
      const tip = vpEl.querySelector('.lb-vp-tooltip');
      if (!tip) return;
      const hit = e.target.closest ? e.target.closest('.lb-vp-hit') : null;
      if (!hit) { tip.style.display = 'none'; return; }
      const amsl = hit.getAttribute('data-amsl');
      const agl = hit.getAttribute('data-agl');
      tip.innerHTML = `AMSL ${esc(amsl)} ft &middot; AGL ${agl ? esc(agl) + ' ft' : '—'}`;
      const r = vpEl.getBoundingClientRect();
      tip.style.left = (e.clientX - r.left) + 'px';
      tip.style.top = (e.clientY - r.top - 8) + 'px';
      tip.style.display = 'block';
    });
    vpEl.addEventListener('mouseleave', () => {
      const tip = vpEl.querySelector('.lb-vp-tooltip');
      if (tip) tip.style.display = 'none';
    });
  }

  // Escape : ferme la modale du dessus en priorité (carte → détails → liste).
  // (La modale de fin de vol n'est PAS fermable par Escape : elle exige un
  // choix explicite Oui/Non pour ne pas perdre l'enregistrement par accident.)
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (rmOverlay && rmOverlay.classList.contains('visible')) _closeRouteMap();
    else if (detailOverlay && detailOverlay.classList.contains('visible')) _closeDetail();
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

  // --- Modale « Vitesse verticale d'atterrissage » ----------------------
  // S'ouvre à CHAQUE toucher (event 'landing-result', déjà filtré des rebonds
  // par la FSM main → c'est exactement la VS retenue/enregistrée). Affiche la
  // VS pendant LANDING_RATE_MS puis se ferme automatiquement. Refermable
  // manuellement (clic extérieur / Escape).
  const LANDING_RATE_MS = 10_000;
  const lrOverlay = document.getElementById('landing-rate-overlay');
  const lrVsEl = document.getElementById('landing-rate-vs');
  const lrGEl = document.getElementById('landing-rate-g');
  let _lrTimer = null;

  function _closeLandingRate() {
    if (_lrTimer) { clearTimeout(_lrTimer); _lrTimer = null; }
    if (lrOverlay) lrOverlay.classList.remove('visible');
  }

  // Classe de sévérité selon |VS| (ft/min) — purement visuel.
  function _lrSeverity(absVs) {
    if (absVs < 100) return 'lr-soft';
    if (absVs < 300) return 'lr-normal';
    if (absVs < 500) return 'lr-firm';
    if (absVs < 800) return 'lr-hard';
    return 'lr-crash';
  }

  function _showLandingRate(r) {
    if (!lrOverlay || !lrVsEl || !r) return;
    const vs = Number(r.verticalSpeedFpm);
    if (!Number.isFinite(vs)) return;
    lrVsEl.textContent = String(Math.round(vs));
    lrVsEl.className = _lrSeverity(Math.abs(vs));
    if (lrGEl) {
      lrGEl.textContent = Number.isFinite(r.gForceMax)
        ? `${t('lrGLabel')} : ${r.gForceMax} G`
        : '';
    }
    if (_lrTimer) clearTimeout(_lrTimer);
    lrOverlay.classList.add('visible');
    _lrTimer = setTimeout(_closeLandingRate, LANDING_RATE_MS);
  }

  if (lrOverlay) {
    lrOverlay.addEventListener('click', (e) => { if (e.target === lrOverlay) _closeLandingRate(); });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && lrOverlay && lrOverlay.classList.contains('visible')) _closeLandingRate();
  });

  if (window.api && typeof window.api.onLandingResult === 'function') {
    window.api.onLandingResult((r) => _showLandingRate(r));
  }
}

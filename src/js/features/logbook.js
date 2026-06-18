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
    // Modale Statistiques
    stEmpty: 'Aucun vol enregistré pour établir des statistiques.',
    stG1: 'Vue d\'ensemble', stG2: 'Durées, distances & activité', stG3: 'Aéroports',
    stG4: 'Appareils', stG5: 'Atterrissages', stG6: 'Précision',
    stTotalFlights: 'Nombre total de vols',
    stTotalHours: 'Total heures de vol',
    stTotalDist: 'Total distance parcourue (nm)',
    stAvgTime: 'Temps de vol moyen',
    stAvgDist: 'Distance moyenne par vol (nm)',
    stLongestTime: 'Vol le plus long (temps)',
    stLongestDist: 'Vol le plus long (distance)',
    stShortestTime: 'Vol le plus court (temps)',
    stShortestDist: 'Vol le plus court (distance)',
    stFlightsPerMonth: 'Vols par mois (moy.)',
    stFlightsPerYear: 'Vols par an (moy.)',
    stHoursPerMonth: 'Heures par mois (moy.)',
    stHoursPerYear: 'Heures par an (moy.)',
    stBusiestMonth: 'Mois le plus actif',
    stAirportsVisited: 'Aéroports différents visités',
    stBusiestAirport: 'Aéroport le plus fréquenté',
    stCountries: 'Pays visités',
    stAircraftUsed: 'Avions utilisés',
    stTopAcHours: 'Top 3 avions (heures de vol)',
    stTopAcFlights: 'Top 3 avions (nombre de vols)',
    stSoftest: 'Atterrissage le plus doux (ft/min)',
    stHardest: 'Atterrissage le plus dur (ft/min)',
    stAvgVs: 'VS moyenne atterrissages (ft/min)',
    stTotalTng: 'Total touchers',
    stAvgPrec: 'Précision moyenne',
    stBestPrec: 'Meilleur score de précision',
    stWorstPrec: 'Pire score de précision',
    stFlightsUnit: 'vols', stHoursUnit: 'h',
    // Carte des aéroports visités (tooltips)
    stMapDepartures: 'Nombre de décollages :',
    stMapLandings: 'Nombre d\'atterrissages :',
    stMapTouchers: 'Nombre de touchers effectués :',
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
    // Statistics modal
    stEmpty: 'No flights recorded yet to compute statistics.',
    stG1: 'Overview', stG2: 'Durations, distances & activity', stG3: 'Airports',
    stG4: 'Aircraft', stG5: 'Landings', stG6: 'Precision',
    stTotalFlights: 'Total number of flights',
    stTotalHours: 'Total flight time',
    stTotalDist: 'Total distance flown (nm)',
    stAvgTime: 'Average flight time',
    stAvgDist: 'Average distance per flight (nm)',
    stLongestTime: 'Longest flight (time)',
    stLongestDist: 'Longest flight (distance)',
    stShortestTime: 'Shortest flight (time)',
    stShortestDist: 'Shortest flight (distance)',
    stFlightsPerMonth: 'Flights per month (avg)',
    stFlightsPerYear: 'Flights per year (avg)',
    stHoursPerMonth: 'Hours per month (avg)',
    stHoursPerYear: 'Hours per year (avg)',
    stBusiestMonth: 'Busiest month',
    stAirportsVisited: 'Different airports visited',
    stBusiestAirport: 'Most visited airport',
    stCountries: 'Countries visited',
    stAircraftUsed: 'Aircraft used',
    stTopAcHours: 'Top 3 aircraft (flight hours)',
    stTopAcFlights: 'Top 3 aircraft (number of flights)',
    stSoftest: 'Softest landing (ft/min)',
    stHardest: 'Hardest landing (ft/min)',
    stAvgVs: 'Average landing VS (ft/min)',
    stTotalTng: 'Total touch-and-go',
    stAvgPrec: 'Average precision',
    stBestPrec: 'Best precision score',
    stWorstPrec: 'Worst precision score',
    stFlightsUnit: 'flights', stHoursUnit: 'h',
    // Visited-airports map (tooltips)
    stMapDepartures: 'Departures:',
    stMapLandings: 'Landings:',
    stMapTouchers: 'Touch-and-go landings:',
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
  const statHoursEl = document.getElementById('logbook-stat-hours');
  const statDistEl = document.getElementById('logbook-stat-distance');
  const btnStats = document.getElementById('btn-logbook-stats');
  const statsOverlay = document.getElementById('logbook-stats-overlay');
  const statsBody = document.getElementById('logbook-stats-body');
  const btnStatsClose = document.getElementById('btn-logbook-stats-close');
  const btnStatsMap = document.getElementById('btn-logbook-stats-map');
  const smOverlay = document.getElementById('logbook-stats-map-overlay');
  const btnSmClose = document.getElementById('btn-logbook-stats-map-close');
  let _statsMap = null;        // instance Leaflet de la carte des aéroports visités
  let _statsMapLayer = null;   // L.layerGroup des points (rouge/jaune/orange)

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

  // Distance grand-cercle parcourue (NM) d'un vol, calculée le long du tracé
  // effectif échantillonné (`f.track`). Les vols enregistrés avant l'ajout du
  // tracé (pas de `track`) comptent pour 0 NM.
  function _flightDistanceNm(f) {
    const track = (f && Array.isArray(f.track)) ? f.track : [];
    let d = 0;
    for (let i = 1; i < track.length; i++) {
      const p = track[i - 1], q = track[i];
      if (Number.isFinite(p.lat) && Number.isFinite(p.lon)
        && Number.isFinite(q.lat) && Number.isFinite(q.lon)) {
        d += _haversineNm(p.lat, p.lon, q.lat, q.lon);
      }
    }
    return d;
  }

  // Met à jour le bandeau de totaux (heures de vol + distance) sous le titre.
  function _renderStats(flights) {
    let totalMin = 0, totalNm = 0;
    flights.forEach(f => {
      const m = f.totals && f.totals.flightMinutes;
      if (Number.isFinite(m)) totalMin += m;
      totalNm += _flightDistanceNm(f);
    });
    if (statHoursEl) statHoursEl.textContent = _fmtDuration(totalMin);
    if (statDistEl) statDistEl.textContent = Math.round(totalNm).toLocaleString(_loc());
  }

  // Centre horizontalement le bouton Statistiques sur la colonne Détails. La
  // largeur des colonnes étant dynamique, on lit la position réelle de l'en-tête
  // de la dernière colonne et on place le bouton (absolu) à son centre. Carnet
  // vide (tableau masqué) → repli aligné à droite de la barre.
  function _positionStatsBtn() {
    if (!btnStats) return;
    const statsBar = document.getElementById('logbook-stats');
    if (!statsBar) return;
    const th = tableEl ? tableEl.querySelector('thead th:last-child') : null;
    if (!th || (tableEl && tableEl.style.display === 'none')) {
      btnStats.style.left = '100%';
      btnStats.style.transform = 'translate(-100%, -50%)';
      return;
    }
    const barRect = statsBar.getBoundingClientRect();
    const thRect = th.getBoundingClientRect();
    btnStats.style.left = (thRect.left + thRect.width / 2 - barRect.left) + 'px';
    btnStats.style.transform = 'translate(-50%, -50%)';
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
      _renderStats(_flights);

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
      // Layout prêt → centrer le bouton Statistiques sur la colonne Détails.
      requestAnimationFrame(_positionStatsBtn);
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
      + _pgField(_lbl('from'), depIcao)
      + _pgField(_lbl('brakesOff'), esc(tOffBlock))
      + _pgField(_lbl('takeoff'), esc(tTakeoff))
      + _pgField(_lbl('flightTime'), esc(_fmtDuration(tot.flightMinutes)))
      + _pgField(_lbl('to'), arrIcao)
      + _pgField(_lbl('landing'), esc(tLanding))
      + _pgField(_lbl('brakesOn'), esc(tOnBlock))
      + _pgField(_lbl('blockTime'), esc(_fmtDuration(tot.blockMinutes)))
      + '</div>'
      + '</div>';

    // Ligne 4 : Route textuelle + bouton carte
    html += '<div class="lb-pg-row">'
      + '<div class="lb-pg-field lb-pg-wide"><label>' + esc(_lbl('secRoute')) + '</label>'
      + '<div class="lb-pg-route-line">'
      + `<span class="lb-pg-val lb-route">${routeHtml}</span>`
      + mapBtn
      + '</div>'
      + '</div>'
      + '</div>';

    // Ligne 5 : deux panneaux côte à côte (Touchers | Atterrissage final)
    html += '<div class="lb-pg-row lb-pg-bottom">'
      + `<div class="lb-pg-panel"><h4>${esc(_lbl('secTouches'))}</h4>`
      + `<table class="lb-pg-table">${tngHead}${tngBody}</table></div>`
      + `<div class="lb-pg-panel"><h4>${esc(_lbl('secLanding'))}</h4>`
      + `<table class="lb-pg-table">${landHead}${landBody}</table></div>`
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

  // --- Statistiques -----------------------------------------------------
  // Code ICAO assaini (null si inconnu / placeholder).
  function _cleanIcao(icao) {
    const c = (icao == null ? '' : String(icao)).trim().toUpperCase();
    if (!c || c === '—' || c === 'UNKN' || c === '????') return null;
    return c;
  }

  // « Pays » approximatif déduit du préfixe ICAO. La plupart des pays = 2 lettres
  // (LF=France, EG=UK…) ; quelques zones utilisent une seule lettre régionale
  // (K=USA, C=Canada, Y=Australie). Approximation suffisante pour un compteur.
  function _country(icao) {
    const c = _cleanIcao(icao);
    if (!c) return null;
    return /^[KCY]/.test(c) ? c[0] : c.slice(0, 2);
  }

  // Étiquette « DEP→ARR » d'un vol (— si inconnu).
  function _routeLabel(f) {
    const dep = _cleanIcao(f.departure && f.departure.icao) || '—';
    const arr = _cleanIcao(f.arrival && f.arrival.icao) || '—';
    return `${dep}→${arr}`;
  }

  // Agrège tous les indicateurs affichés dans la modale Statistiques.
  function _computeStats(flights) {
    const n = flights.length;
    const _fm = (f) => (f.totals && Number.isFinite(f.totals.flightMinutes)) ? f.totals.flightMinutes : 0;
    let totalMin = 0, totalNm = 0;
    flights.forEach(f => { totalMin += _fm(f); totalNm += _flightDistanceNm(f); });

    // Extrêmes (temps > 0 / distance > 0 pour ignorer les vols incomplets).
    let longT = null, shortT = null, longD = null, shortD = null;
    flights.forEach(f => {
      const m = _fm(f), d = _flightDistanceNm(f), label = _routeLabel(f);
      if (m > 0) {
        if (!longT || m > longT.v) longT = { v: m, label };
        if (!shortT || m < shortT.v) shortT = { v: m, label };
      }
      if (d > 0) {
        if (!longD || d > longD.v) longD = { v: d, label };
        if (!shortD || d < shortD.v) shortD = { v: d, label };
      }
    });

    // Temporel : comptes par mois/an + amplitude active (1er → dernier vol).
    const monthCount = {};
    let minTs = Infinity, maxTs = -Infinity;
    flights.forEach(f => {
      const ts = _flightTs(f);
      if (!ts) return;
      if (ts < minTs) minTs = ts;
      if (ts > maxTs) maxTs = ts;
      const dt = new Date(ts);
      const ym = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0');
      monthCount[ym] = (monthCount[ym] || 0) + 1;
    });
    let spanMonths = 1, spanYears = 1;
    if (Number.isFinite(minTs) && Number.isFinite(maxTs) && maxTs >= minTs) {
      const a = new Date(minTs), b = new Date(maxTs);
      spanMonths = Math.max(1, (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()) + 1);
      spanYears = Math.max(1, b.getFullYear() - a.getFullYear() + 1);
    }
    let busiestMonth = null;
    Object.keys(monthCount).forEach(k => {
      if (!busiestMonth || monthCount[k] > busiestMonth.v) busiestMonth = { k, v: monthCount[k] };
    });

    // Aéroports (départ + arrivée).
    const apCount = {};
    flights.forEach(f => {
      [f.departure && f.departure.icao, f.arrival && f.arrival.icao].forEach(ic => {
        const c = _cleanIcao(ic);
        if (c) apCount[c] = (apCount[c] || 0) + 1;
      });
    });
    let busiestAirport = null;
    Object.keys(apCount).forEach(k => {
      if (!busiestAirport || apCount[k] > busiestAirport.v) busiestAirport = { k, v: apCount[k] };
    });
    const countries = new Set();
    Object.keys(apCount).forEach(k => { const c = _country(k); if (c) countries.add(c); });

    // Appareils (par titre SimVar).
    const acMin = {}, acCount = {};
    flights.forEach(f => {
      const t = (f.aircraft && f.aircraft.title) ? f.aircraft.title : null;
      if (!t) return;
      acMin[t] = (acMin[t] || 0) + _fm(f);
      acCount[t] = (acCount[t] || 0) + 1;
    });
    const topAcHours = Object.keys(acMin).map(t => ({ t, v: acMin[t] })).sort((a, b) => b.v - a.v).slice(0, 3);
    const topAcFlights = Object.keys(acCount).map(t => ({ t, v: acCount[t] })).sort((a, b) => b.v - a.v).slice(0, 3);

    // Atterrissages (VS en ft/min, négatif = descente). Doux = |VS| min.
    let softest = null, hardest = null, vsSum = 0, vsN = 0, tng = 0;
    flights.forEach(f => {
      const land = f.landing;
      const vs = land ? Number(land.verticalSpeedFpm) : NaN;
      if (Number.isFinite(vs)) {
        const mag = Math.abs(vs);
        if (!softest || mag < softest.mag) softest = { vs, mag };
        if (!hardest || mag > hardest.mag) hardest = { vs, mag };
        vsSum += vs; vsN++;
      }
      tng += Array.isArray(f.touchAndGoLandings) ? f.touchAndGoLandings.length : (Number(f.touchAndGoCount) || 0);
    });

    // Précision.
    const precs = flights.map(f => f.precision).filter(p => Number.isFinite(p));

    return {
      n, totalMin, totalNm,
      avgMin: n ? totalMin / n : 0, avgNm: n ? totalNm / n : 0,
      longT, shortT, longD, shortD,
      flightsPerMonth: n / spanMonths, flightsPerYear: n / spanYears,
      hoursPerMonth: (totalMin / 60) / spanMonths, hoursPerYear: (totalMin / 60) / spanYears,
      busiestMonth,
      airportsVisited: Object.keys(apCount).length, busiestAirport, countries: countries.size,
      aircraftUsed: Object.keys(acCount).length, topAcHours, topAcFlights,
      softest, hardest, avgVs: vsN ? vsSum / vsN : null, totalTng: tng,
      avgPrec: precs.length ? precs.reduce((a, b) => a + b, 0) / precs.length : null,
      bestPrec: precs.length ? Math.max(...precs) : null,
      worstPrec: precs.length ? Math.min(...precs) : null,
    };
  }

  // Construit le HTML de la modale Statistiques à partir de l'agrégat.
  function _renderStatsHtml(s) {
    const dash = '<span class="lb-stats-muted">—</span>';
    const nm = (x) => Math.round(x).toLocaleString(_loc());
    const fmtMonth = (m) => {
      if (!m) return dash;
      const [y, mo] = m.k.split('-').map(Number);
      const name = new Date(y, mo - 1, 1).toLocaleDateString(_loc(), { month: 'long', year: 'numeric' });
      return `<span class="lb-stats-muted">${esc(name)}</span> ${m.v} ${esc(_lbl('stFlightsUnit'))}`;
    };
    const fmtExtremeT = (e) => e ? `<span class="lb-stats-muted">${esc(e.label)}</span> ${esc(_fmtDuration(e.v))}` : dash;
    const fmtExtremeD = (e) => e ? `<span class="lb-stats-muted">${esc(e.label)}</span> ${nm(e.v)} nm` : dash;
    const fmtTopList = (arr, valFn) => arr.length
      ? arr.map((it, i) => `<span class="lb-stats-sub"><span class="lb-stats-muted">${i + 1}. ${esc(it.t)}</span><span class="lb-stats-sub-val">${esc(valFn(it.v))}</span></span>`).join('')
      : dash;

    const row = (k, valHtml, stack, id) => `<div class="lb-stats-row${stack ? ' lb-stats-row-stack' : ''}"${id ? ` id="${id}"` : ''}><span class="lb-stats-label">${esc(_lbl(k))}</span><span class="lb-stats-value">${valHtml}</span></div>`;
    const group = (titleKey, rows) => `<div class="lb-stats-group"><h4 class="lb-stats-group-title">${esc(_lbl(titleKey))}</h4>${rows.join('')}</div>`;

    const g1 = group('stG1', [
      row('stTotalFlights', String(s.n)),
      row('stTotalHours', esc(_fmtDuration(s.totalMin))),
      row('stTotalDist', nm(s.totalNm)),
    ]);
    const g2 = group('stG2', [
      row('stAvgTime', esc(_fmtDuration(Math.round(s.avgMin)))),
      row('stAvgDist', nm(s.avgNm)),
      row('stLongestTime', fmtExtremeT(s.longT)),
      row('stLongestDist', fmtExtremeD(s.longD)),
      row('stShortestTime', fmtExtremeT(s.shortT)),
      row('stShortestDist', fmtExtremeD(s.shortD)),
      row('stFlightsPerMonth', s.flightsPerMonth.toFixed(1)),
      row('stFlightsPerYear', s.flightsPerYear.toFixed(1)),
      row('stHoursPerMonth', s.hoursPerMonth.toFixed(1) + ' ' + esc(_lbl('stHoursUnit'))),
      row('stHoursPerYear', s.hoursPerYear.toFixed(1) + ' ' + esc(_lbl('stHoursUnit'))),
      row('stBusiestMonth', fmtMonth(s.busiestMonth)),
    ]);
    const g3 = group('stG3', [
      row('stAirportsVisited', String(s.airportsVisited)),
      row('stBusiestAirport', s.busiestAirport ? `<span class="lb-stats-muted">${s.busiestAirport.v} ${esc(_lbl('stFlightsUnit'))}</span> ${esc(s.busiestAirport.k)}` : dash, false, 'lb-stat-busiest-row'),
      row('stCountries', String(s.countries)),
    ]);
    const g4 = group('stG4', [
      row('stTopAcHours', fmtTopList(s.topAcHours, (v) => _fmtDuration(v)), true),
      row('stTopAcFlights', fmtTopList(s.topAcFlights, (v) => `${v} ${_lbl('stFlightsUnit')}`), true),
      row('stAircraftUsed', String(s.aircraftUsed)),
    ]);
    const g5 = group('stG5', [
      row('stSoftest', s.softest ? `${Math.round(s.softest.vs)} ft/min` : dash),
      row('stHardest', s.hardest ? `${Math.round(s.hardest.vs)} ft/min` : dash),
      row('stAvgVs', s.avgVs != null ? `${Math.round(s.avgVs)} ft/min` : dash),
      row('stTotalTng', String(s.totalTng)),
    ]);
    const g6 = group('stG6', [
      row('stAvgPrec', s.avgPrec != null ? `${Math.round(s.avgPrec)} %` : dash),
      row('stBestPrec', s.bestPrec != null ? `${s.bestPrec} %` : dash),
      row('stWorstPrec', s.worstPrec != null ? `${s.worstPrec} %` : dash),
    ]);
    return g1 + g2 + g3 + g4 + g5 + g6;
  }

  function _closeStats() { if (statsOverlay) statsOverlay.classList.remove('visible'); }

  // Trouve l'aéroport déjà agrégé proche de (lat,lon) — fusion par PROXIMITÉ
  // (< 1.5 NM) pour réunir un même terrain quelle que soit la source de ses
  // coordonnées (départ/arrivée résolus vs aéroport le plus proche d'un toucher).
  // Crée l'entrée si aucune ne correspond.
  function _findOrCreateAirport(list, lat, lon, icao, name) {
    for (const a of list) {
      if (_haversineNm(a.lat, a.lon, lat, lon) < 1.5) {
        if (!a.icao && icao) a.icao = icao;
        if (!a.name && name) a.name = name;
        return a;
      }
    }
    const a = { lat, lon, icao: icao || '', name: name || '', dep: 0, arr: 0, touch: 0 };
    list.push(a);
    return a;
  }

  // Tooltip d'un point de la carte des aéroports visités.
  function _statsMapTooltip(a, visited, touched) {
    const head = esc(a.icao || a.name || '');
    const lines = [];
    if (visited) {
      lines.push(`${esc(_lbl('stMapDepartures'))} ${a.dep}`);
      lines.push(`${esc(_lbl('stMapLandings'))} ${a.arr}`);
    }
    if (touched) lines.push(`${esc(_lbl('stMapTouchers'))} ${a.touch}`);
    return (head ? `<b>${head}</b><br>` : '') + lines.join('<br>');
  }

  // Ouvre la carte des aéroports visités : fond CARTO Positron + un point par
  // aéroport. Rouge = décollage/atterrissage, jaune = touchers, orange = les
  // deux. Tooltip au survol avec les comptes.
  async function _openStatsMap() {
    if (typeof L === 'undefined' || !smOverlay) return;

    // Source des vols (réutilise la liste déjà chargée si dispo).
    let flights = (Array.isArray(_flights) && _flights.length) ? _flights : null;
    if (!flights) {
      try {
        const res = await window.api.logbookHistorique();
        flights = (res && Array.isArray(res.flights)) ? res.flights : [];
      } catch (_) { flights = []; }
    }

    // Agrégation des aéroports (départs + arrivées = points "visités").
    const airports = [];
    flights.forEach(f => {
      const d = f.departure;
      if (d && Number.isFinite(d.lat) && Number.isFinite(d.lon)) {
        _findOrCreateAirport(airports, d.lat, d.lon, _cleanIcao(d.icao), d.name).dep++;
      }
      const a = f.arrival;
      if (a && Number.isFinite(a.lat) && Number.isFinite(a.lon)) {
        _findOrCreateAirport(airports, a.lat, a.lon, _cleanIcao(a.icao), a.name).arr++;
      }
    });

    // Touchers — deux cas :
    //  • toucher GÉOLOCALISÉ (vols récents) → résolu vers l'aéroport le plus
    //    proche (asynchrone, plus bas) ;
    //  • toucher SANS position (vols anciens : ni lat/lon sur le toucher, ni
    //    tracé) → rattaché aux waypoints « tour de piste » (pattern) de la route :
    //    ils portent ident + coordonnées et marquent justement où les
    //    touch-and-go ont été faits. Répartition en ordre (round-robin si le
    //    nombre de touchers diffère du nombre de waypoints pattern).
    const positionedTouchers = [];
    flights.forEach(f => {
      const tgs = Array.isArray(f.touchAndGoLandings) ? f.touchAndGoLandings : [];
      if (!tgs.length) return;
      const patternWps = (Array.isArray(f.route) ? f.route : [])
        .filter(wp => wp && wp.pattern && Number.isFinite(wp.lat) && Number.isFinite(wp.lon));
      let patIdx = 0;
      tgs.forEach(t => {
        if (Number.isFinite(t.lat) && Number.isFinite(t.lon)) {
          positionedTouchers.push(t);
        } else if (patternWps.length) {
          const wp = patternWps[patIdx % patternWps.length];
          patIdx++;
          _findOrCreateAirport(airports, wp.lat, wp.lon, _cleanIcao(wp.ident), wp.name).touch++;
        }
      });
    });
    if (positionedTouchers.length && window.api && typeof window.api.aeroportsProches === 'function') {
      const resolved = await Promise.all(positionedTouchers.map(t =>
        window.api.aeroportsProches({ lat: t.lat, lon: t.lon, limit: 1 })
          .then(r => (r && r.ok && r.airports && r.airports[0]) ? r.airports[0] : null)
          .catch(() => null)
      ));
      resolved.forEach(ap => {
        if (ap && Number.isFinite(ap.lat) && Number.isFinite(ap.lon)) {
          _findOrCreateAirport(airports, ap.lat, ap.lon, _cleanIcao(ap.code || ap.ident), ap.name).touch++;
        }
      });
    }

    smOverlay.classList.add('visible');

    // La modale vient d'apparaître → le container a une taille : on (ré)initialise
    // Leaflet au tick suivant (même pattern que la carte du tracé).
    setTimeout(() => {
      if (!_statsMap) {
        _statsMap = L.map('logbook-stats-map', { zoomControl: true });
        L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}{r}.png', {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
          subdomains: 'abcd', maxZoom: 20,
        }).addTo(_statsMap);
        _statsMapLayer = L.layerGroup().addTo(_statsMap);
      }
      _statsMap.invalidateSize();
      _statsMapLayer.clearLayers();

      const allLatLngs = [];
      airports.forEach(a => {
        const visited = (a.dep + a.arr) > 0;
        const touched = a.touch > 0;
        const color = (visited && touched) ? '#ff8c00' : (visited ? '#ff0000' : '#ffd700');
        const m = L.circleMarker([a.lat, a.lon], {
          radius: 5, fillColor: color, color: '#000000',
          weight: 1, opacity: 1, fillOpacity: 1,
        }).addTo(_statsMapLayer);
        m.bindTooltip(_statsMapTooltip(a, visited, touched), { direction: 'top' });
        allLatLngs.push([a.lat, a.lon]);
      });

      if (allLatLngs.length === 1) _statsMap.setView(allLatLngs[0], 9);
      else if (allLatLngs.length) _statsMap.fitBounds(L.latLngBounds(allLatLngs), { padding: [40, 40] });
      else _statsMap.setView([46.6, 2.5], 5);   // repli (France) si aucun point
    }, 30);
  }

  function _closeStatsMap() { if (smOverlay) smOverlay.classList.remove('visible'); }

  // Cale verticalement le bouton « Voir la carte » sur la ligne « Aéroport le
  // plus fréquenté » (position horizontale inchangée, gérée en CSS).
  function _positionStatsMapBtn() {
    const footer = document.getElementById('logbook-stats-footer');
    const popup = document.getElementById('logbook-stats-popup');
    const rowEl = document.getElementById('lb-stat-busiest-row');
    if (!footer || !popup || !rowEl) return;
    const popupRect = popup.getBoundingClientRect();
    const rowRect = rowEl.getBoundingClientRect();
    footer.style.top = (rowRect.top + rowRect.height / 2 - popupRect.top - popup.clientTop) + 'px';
  }

  // Ouvre la modale Statistiques. Réutilise la liste déjà chargée (_flights) si
  // disponible (le bouton n'apparaît que dans la modale liste, déjà ouverte) ;
  // repli sur un chargement direct sinon.
  function _openStats() {
    if (!statsOverlay || !statsBody) return;
    const render = (flights) => {
      const has = flights.length > 0;
      statsBody.innerHTML = has
        ? _renderStatsHtml(_computeStats(flights))
        : `<div class="logbook-empty">${esc(_lbl('stEmpty'))}</div>`;
      const footer = document.getElementById('logbook-stats-footer');
      if (footer) footer.style.display = has ? 'flex' : 'none';
      statsOverlay.classList.add('visible');
      if (has) requestAnimationFrame(_positionStatsMapBtn);
    };
    if (Array.isArray(_flights) && _flights.length) { render(_flights); return; }
    if (window.api && typeof window.api.logbookHistorique === 'function') {
      window.api.logbookHistorique()
        .then(res => render((res && Array.isArray(res.flights)) ? res.flights : []))
        .catch(() => render([]));
    } else { render([]); }
  }

  // --- Câblage ----------------------------------------------------------
  btn.addEventListener('click', _openList);
  if (btnStats) btnStats.addEventListener('click', _openStats);
  if (btnStatsClose) btnStatsClose.addEventListener('click', _closeStats);
  if (btnStatsMap) btnStatsMap.addEventListener('click', _openStatsMap);
  if (btnSmClose) btnSmClose.addEventListener('click', _closeStatsMap);
  if (smOverlay) smOverlay.addEventListener('click', (e) => { if (e.target === smOverlay) _closeStatsMap(); });
  if (statsOverlay) statsOverlay.addEventListener('click', (e) => { if (e.target === statsOverlay) _closeStats(); });
  window.addEventListener('resize', () => {
    if (overlay && overlay.classList.contains('visible')) _positionStatsBtn();
    if (statsOverlay && statsOverlay.classList.contains('visible')) _positionStatsMapBtn();
  });

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
    else if (smOverlay && smOverlay.classList.contains('visible')) _closeStatsMap();
    else if (statsOverlay && statsOverlay.classList.contains('visible')) _closeStats();
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

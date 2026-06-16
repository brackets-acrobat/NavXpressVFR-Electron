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
// NavXpressVFR — traffic-pattern.js
// Tour de piste : clic droit sur un aéroport → "Tracer un tour de piste" →
// modale (choix piste/QFU, sens main G/D, longueur montée initiale, longueur
// vent traversier, longueur de finale, altitude). À la validation, trace le
// circuit en ligne continue ROUGE (3 px) ; le CAP magnétique de chaque branche
// s'affiche, aligné sur la ligne, décalé ~4 px vers l'EXTÉRIEUR du circuit.
//   - Tracé visible à partir du zoom 11.
//   - Étiquettes de cap visibles à partir du zoom 13.
//
// Géométrie — depuis les DEUX seuils de la piste (le_/he_latitude_deg, MSFS) :
//   THR     = seuil d'atterrissage (extrémité choisie)
//   OPP     = seuil opposé (départ)
//   brng    = relèvement THR→OPP = sens d'atterrissage (vrai)
//   side    = brng ± 90 selon le sens (gauche = −90)
//   Pf      = destination(THR, brng+180, finale)        — entrée de finale
//   Pu      = destination(OPP, brng, montée initiale)   — fin de la montée
//   PuSide  = destination(Pu,  side, vent traversier)   — fin du vent traversier
//   PfSide  = destination(Pf,  side, vent traversier)   — fin du vent arrière
// Boucle : Pf→THR→OPP (piste) →Pu (montée) →PuSide (traversier) →PfSide (vent
// arrière) →Pf (base). Pf,THR,OPP,Pu sont alignés (axe de piste, non étiqueté).
//
// Les tours de piste sont conservés dans le tableau global `toursDePiste`
// (globals.js) ET sauvegardés dans le plan de vol (.navxpv via flightplan-io).
//
// Expose :
//   window.demanderTourDePiste(airport)   — clic droit "Tracer un tour de piste"
//   window.supprimerTourDePiste(entry)    — clic droit sur une ligne "Supprimer"
//   window.effacerTousToursDePiste()      — reset / nouveau plan
//   window.aDesToursDePiste()             — visibilité item "Effacer"
//   window.serialiserToursDePiste()       — save .navxpv
//   window.chargerToursDePiste(arr)       — load .navxpv
// Doit être appelé APRÈS initMap (carte Leaflet présente).
// ============================================================

function initTrafficPattern() {
  if (typeof map === 'undefined' || !map || typeof L === 'undefined') return;

  const overlay = document.getElementById('traffic-pattern-overlay');
  const rwyListEl = document.getElementById('tp-runway-list');
  const subtitleEl = document.getElementById('tp-subtitle');
  const inUpwind = document.getElementById('tp-upwind');
  const inCrosswind = document.getElementById('tp-crosswind');
  const inFinal = document.getElementById('tp-final');
  const inAlt = document.getElementById('tp-altitude');
  const errorEl = document.getElementById('tp-error');
  const btnCancel = document.getElementById('btn-tp-cancel');
  const btnValidate = document.getElementById('btn-tp-validate');
  if (!overlay || !rwyListEl) return;

  const RED = '#FF0000';
  const ZOOM_MIN_PATTERN = 11;   // tracé visible à partir de ce zoom
  const ZOOM_MIN_CAPS = 13;      // étiquettes de cap visibles à partir de ce zoom
  const NM_M = 1852;             // 1 NM en mètres
  const R_M = 6371000;           // rayon terrestre (grand cercle)
  const CORNER_RADIUS_NM = 0.1;  // rayon d'arrondi des angles du rectangle
  // Décalage écran de l'étiquette vers l'extérieur (≈ 4 px de marge au-dessus de
  // la ligne : demi-hauteur de police 22 px + demi-épaisseur trait + 4 px).
  const LABEL_OFFSET_PX = 16;

  // Deux couches : la ligne (zoom ≥ 11) et les étiquettes de cap (zoom ≥ 13).
  const _lineLayer = L.layerGroup();
  const _labelLayer = L.layerGroup();
  let _linesOn = false, _labelsOn = false;
  function _syncZoom() {
    const has = toursDePiste.length > 0;
    const z = map.getZoom();
    const showLines = has && z >= ZOOM_MIN_PATTERN;
    const showLabels = has && z >= ZOOM_MIN_CAPS;
    if (showLines && !_linesOn) { _lineLayer.addTo(map); _linesOn = true; }
    else if (!showLines && _linesOn) { map.removeLayer(_lineLayer); _linesOn = false; }
    if (showLabels && !_labelsOn) { _labelLayer.addTo(map); _labelsOn = true; }
    else if (!showLabels && _labelsOn) { map.removeLayer(_labelLayer); _labelsOn = false; }
  }
  map.on('zoomend', _syncZoom);

  // --- Helpers géodésiques ---
  const toRad = d => d * Math.PI / 180;
  const toDeg = r => r * 180 / Math.PI;

  // Point d'arrivée d'un cap (vrai) et d'une distance depuis (lat,lon).
  function destination(lat, lon, brngDeg, distM) {
    const d = distM / R_M, t = toRad(brngDeg);
    const f1 = toRad(lat), l1 = toRad(lon);
    const sinf2 = Math.sin(f1) * Math.cos(d) + Math.cos(f1) * Math.sin(d) * Math.cos(t);
    const f2 = Math.asin(Math.min(1, Math.max(-1, sinf2)));
    const y = Math.sin(t) * Math.sin(d) * Math.cos(f1);
    const x = Math.cos(d) - Math.sin(f1) * sinf2;
    const l2 = l1 + Math.atan2(y, x);
    return { lat: toDeg(f2), lon: ((toDeg(l2) + 540) % 360) - 180 };
  }

  // Relèvement initial (vrai) de A vers B, en degrés [0,360).
  function bearing(latA, lonA, latB, lonB) {
    const f1 = toRad(latA), f2 = toRad(latB), dl = toRad(lonB - lonA);
    const y = Math.sin(dl) * Math.cos(f2);
    const x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  }

  // Écart angulaire absolu entre deux caps (°).
  function angDiff(a, b) { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }

  // Angle écran (degrés, sens horaire) pour aligner un texte horizontal sur une
  // branche de relèvement vrai `tb`. Carte nord en haut → nord = écran -y, est =
  // écran +x. Ramené dans (−90,90] pour ne jamais écrire à l'envers.
  function screenAngle(tb) {
    let a = toDeg(Math.atan2(-Math.cos(toRad(tb)), Math.sin(toRad(tb))));
    if (a > 90) a -= 180; else if (a < -90) a += 180;
    return a;
  }

  // Boucle fermée [ [lat,lon], … ] à partir de `coins` ({lat,lon}), chaque angle
  // remplacé par un congé (arc circulaire) de rayon `rNM`. Calcul en projection
  // planaire locale (équirectangulaire) autour du 1er coin — exact à l'échelle
  // d'un tour de piste. La distance de tangence est clampée à la demi-longueur
  // des côtés adjacents (rayon réduit si un côté est plus court que le rayon).
  function _boucleArrondie(coins, rNM, segParArc) {
    const n = coins.length;
    if (n < 3) return coins.map(c => [c.lat, c.lon]);
    const lat0 = coins[0].lat, lon0 = coins[0].lon;
    const MPD = 111320;
    const cosL = Math.cos(lat0 * Math.PI / 180) || 1e-6;
    const toXY = c => ({ x: (c.lon - lon0) * MPD * cosL, y: (c.lat - lat0) * MPD });
    const toLL = p => [lat0 + p.y / MPD, lon0 + p.x / (MPD * cosL)];
    const P = coins.map(toXY);
    const rM = rNM * NM_M;
    const out = [];
    for (let i = 0; i < n; i++) {
      const cur = P[i], prev = P[(i - 1 + n) % n], next = P[(i + 1) % n];
      let ax = prev.x - cur.x, ay = prev.y - cur.y;
      let bx = next.x - cur.x, by = next.y - cur.y;
      const la = Math.hypot(ax, ay) || 1, lb = Math.hypot(bx, by) || 1;
      ax /= la; ay /= la; bx /= lb; by /= lb;
      let dot = Math.max(-1, Math.min(1, ax * bx + ay * by));
      const alpha = Math.acos(dot);                 // angle intérieur au coin
      if (alpha < 1e-3 || Math.PI - alpha < 1e-3) { out.push(toLL(cur)); continue; }
      const half = alpha / 2;
      let t = Math.min(rM / Math.tan(half), 0.5 * la, 0.5 * lb);
      const rEff = t * Math.tan(half);
      const T1 = { x: cur.x + ax * t, y: cur.y + ay * t };
      let bisx = ax + bx, bisy = ay + by;
      const lbis = Math.hypot(bisx, bisy) || 1;
      bisx /= lbis; bisy /= lbis;
      const O = { x: cur.x + bisx * (rEff / Math.sin(half)), y: cur.y + bisy * (rEff / Math.sin(half)) };
      const a1 = Math.atan2(T1.y - O.y, T1.x - O.x);
      const T2 = { x: cur.x + bx * t, y: cur.y + by * t };
      let da = Math.atan2(T2.y - O.y, T2.x - O.x) - a1;
      while (da > Math.PI) da -= 2 * Math.PI;
      while (da < -Math.PI) da += 2 * Math.PI;
      const steps = Math.max(2, segParArc);
      for (let s = 0; s <= steps; s++) {
        const ang = a1 + da * (s / steps);
        out.push(toLL({ x: O.x + rEff * Math.cos(ang), y: O.y + rEff * Math.sin(ang) }));
      }
    }
    return out;
  }

  // --- État de la modale ---
  let _airport = null;   // { ident, name, code, lat, lon }
  let _ends = [];        // extrémités exploitables : [{ ident, oppIdent, thr, opp, lengthFt }]

  function _fermer() { overlay.classList.remove('visible'); }

  // Ouvre la modale pour un aéroport (objet marqueur carte : ident/name/lat/lon/code).
  async function _ouvrir(airport) {
    if (!airport || !airport.ident) return;

    let res = null;
    try { res = await window.api.detailsAeroport(airport.ident); } catch (_) { res = null; }
    const a = (res && res.ok) ? res.airport : null;
    _airport = {
      ident: airport.ident,
      name: (a && a.name) || airport.name || airport.ident,
      code: airport.code || (a && a.icao_code && a.icao_code.trim()) || airport.ident,
      lat: (a && parseFloat(a.latitude_deg)) || airport.lat,
      lon: (a && parseFloat(a.longitude_deg)) || airport.lon,
      // Élévation terrain (ft) → hauteur au-dessus de l'aérodrome pour l'annonce
      // vocale (cf. traffic-pattern-voice.js). null si inconnue → repli sur AGL.
      elevFt: (a && Number.isFinite(parseFloat(a.elevation_ft))) ? parseFloat(a.elevation_ft) : null,
    };

    // Une entrée par EXTRÉMITÉ de piste (le sens d'atterrissage définit le
    // circuit). On ne garde que les pistes aux deux seuils géolocalisés et non
    // fermées.
    _ends = [];
    const rwys = (res && Array.isArray(res.runways)) ? res.runways : [];
    rwys.forEach(r => {
      const ok = Number.isFinite(r.le_latitude_deg) && Number.isFinite(r.le_longitude_deg)
        && Number.isFinite(r.he_latitude_deg) && Number.isFinite(r.he_longitude_deg);
      if (!ok || r.closed) return;
      _ends.push({
        ident: r.le_ident || '?', oppIdent: r.he_ident || '?',
        thr: { lat: r.le_latitude_deg, lon: r.le_longitude_deg },
        opp: { lat: r.he_latitude_deg, lon: r.he_longitude_deg },
        lengthFt: r.length_ft,
      });
      _ends.push({
        ident: r.he_ident || '?', oppIdent: r.le_ident || '?',
        thr: { lat: r.he_latitude_deg, lon: r.he_longitude_deg },
        opp: { lat: r.le_latitude_deg, lon: r.le_longitude_deg },
        lengthFt: r.length_ft,
      });
    });

    if (subtitleEl) subtitleEl.textContent = `${_airport.code} — ${_airport.name}`;

    if (_ends.length === 0) {
      rwyListEl.innerHTML = `<div class="ap-info-empty">${escapeHtml(t('tpNoRunway'))}</div>`;
    } else {
      rwyListEl.innerHTML = _ends.map((e, i) => {
        const len = e.lengthFt ? ` — ${e.lengthFt} ft` : '';
        return `<label class="tp-radio-row"><input type="radio" name="tp-runway" value="${i}" ${i === 0 ? 'checked' : ''}><span>${escapeHtml(t('tpRunwayWord'))} ${escapeHtml(e.ident)}${len}</span></label>`;
      }).join('');
    }

    // Valeurs par défaut conservées entre deux ouvertures (sauf 1er appel).
    if (!inUpwind.value) inUpwind.value = '0.5';
    if (!inCrosswind.value) inCrosswind.value = '0.5';
    if (!inFinal.value) inFinal.value = '0.7';
    if (!inAlt.value) inAlt.value = '1000';
    if (errorEl) errorEl.textContent = '';

    overlay.classList.add('visible');
  }

  async function _valider() {
    if (errorEl) errorEl.textContent = '';
    if (_ends.length === 0) { _fermer(); return; }

    const sel = rwyListEl.querySelector('input[name="tp-runway"]:checked');
    if (!sel) { if (errorEl) errorEl.textContent = t('tpErrRunway'); return; }
    const end = _ends[parseInt(sel.value, 10)];
    if (!end) { if (errorEl) errorEl.textContent = t('tpErrRunway'); return; }

    const handSel = overlay.querySelector('input[name="tp-hand"]:checked');
    const hand = handSel ? handSel.value : 'left';

    const Lu = parseFloat((inUpwind.value || '').replace(',', '.'));
    const W = parseFloat((inCrosswind.value || '').replace(',', '.'));
    const Lf = parseFloat((inFinal.value || '').replace(',', '.'));
    const alt = parseFloat((inAlt.value || '').replace(',', '.'));
    if (!(Lu >= 0.1 && Lu <= 3)) { errorEl.textContent = t('tpErrUpwind'); return; }
    if (!(W >= 0.1 && W <= 3)) { errorEl.textContent = t('tpErrCrosswind'); return; }
    if (!(Lf >= 0.1 && Lf <= 4)) { errorEl.textContent = t('tpErrFinal'); return; }
    if (!(alt >= 500 && alt <= 3000)) { errorEl.textContent = t('tpErrAlt'); return; }

    // Déclinaison magnétique locale → caps en magnétique (repli 0 = vrai).
    let decl = 0;
    try {
      const rd = await window.api.calculerDeclinaison(_airport.lat, _airport.lon, alt);
      if (rd && rd.valeur != null) {
        decl = parseFloat(rd.valeur) || 0;
        if (rd.direction === 'O' || rd.direction === 'W') decl = -decl;
      }
    } catch (_) { /* repli vrai */ }

    _dessiner({
      airportIdent: _airport.ident,
      airportName: _airport.name,
      airportCode: _airport.code,
      lat: _airport.lat,
      lon: _airport.lon,
      runwayIdent: end.ident,
      oppositeIdent: end.oppIdent,
      airportElevFt: _airport.elevFt,
      thr: { lat: end.thr.lat, lon: end.thr.lon },
      opp: { lat: end.opp.lat, lon: end.opp.lon },
      hand,
      upwindNM: Lu,
      crosswindNM: W,
      finalNM: Lf,
      altitudeFt: alt,
      declination: decl,
    });
    _fermer();
  }

  // Construit la géométrie + le tracé d'un tour de piste à partir d'un objet de
  // paramètres complet (utilisé par la modale ET par le chargement du plan).
  // Pousse l'entrée (paramètres + _layers Leaflet) dans `toursDePiste`.
  function _dessiner(p) {
    if (!p || !p.thr || !p.opp) return null;
    const THR = p.thr, OPP = p.opp;
    const brng = bearing(THR.lat, THR.lon, OPP.lat, OPP.lon);
    const side = ((p.hand === 'left' ? brng - 90 : brng + 90) + 360) % 360;

    const Pf = destination(THR.lat, THR.lon, (brng + 180) % 360, p.finalNM * NM_M);
    const Pu = destination(OPP.lat, OPP.lon, brng, p.upwindNM * NM_M);
    const PuSide = destination(Pu.lat, Pu.lon, side, p.crosswindNM * NM_M);
    const PfSide = destination(Pf.lat, Pf.lon, side, p.crosswindNM * NM_M);

    const decl = p.declination || 0;
    const capMag = (tb) => String(Math.round(((tb - decl) % 360 + 360) % 360) % 360).padStart(3, '0');

    // Centroïde du circuit → sens « extérieur » des étiquettes.
    const pts = [Pf, THR, OPP, Pu, PuSide, PfSide];
    const cLat = pts.reduce((s, q) => s + q.lat, 0) / pts.length;
    const cLon = pts.reduce((s, q) => s + q.lon, 0) / pts.length;

    // Branches étiquetées (la piste THR→OPP n'est pas étiquetée).
    const segs = [
      { from: OPP, to: Pu },        // montée initiale
      { from: Pu, to: PuSide },     // vent traversier
      { from: PuSide, to: PfSide }, // vent arrière
      { from: PfSide, to: Pf },     // étape de base
      { from: Pf, to: THR },        // finale
    ];

    const entry = {
      airportIdent: p.airportIdent,
      airportName: p.airportName,
      airportCode: p.airportCode,
      lat: p.lat,
      lon: p.lon,
      runwayIdent: p.runwayIdent,
      oppositeIdent: p.oppositeIdent,
      airportElevFt: Number.isFinite(p.airportElevFt) ? p.airportElevFt : null,
      thr: { lat: THR.lat, lon: THR.lon },
      opp: { lat: OPP.lat, lon: OPP.lon },
      hand: p.hand,
      upwindNM: p.upwindNM,
      crosswindNM: p.crosswindNM,
      finalNM: p.finalNM,
      altitudeFt: p.altitudeFt,
      declination: decl,
      brngTrue: brng,
      // Géométrie du vent arrière (PuSide = début, PfSide = fin) pour l'annonce
      // vocale (cf. traffic-pattern-voice.js). Recalculée à chaque tracé/chargement.
      downwind: {
        start: { lat: PuSide.lat, lon: PuSide.lon },
        end: { lat: PfSide.lat, lon: PfSide.lon },
        brngTrue: bearing(PuSide.lat, PuSide.lon, PfSide.lat, PfSide.lon),
        lengthNM: (typeof distanceNM === 'function')
          ? distanceNM(PuSide.lat, PuSide.lon, PfSide.lat, PfSide.lon) : 0,
      },
      _layers: [],
    };

    // Rectangle aux angles arrondis (rayon CORNER_RADIUS_NM) à partir des 4
    // coins Pf→Pu (axe/piste) →PuSide (traversier) →PfSide (vent arrière) →base.
    const linePts = _boucleArrondie([Pf, Pu, PuSide, PfSide], CORNER_RADIUS_NM, 8);
    linePts.push(linePts[0]); // ferme la boucle (côté base)

    // Zone de clic élargie (invisible) pour faciliter le clic droit "Supprimer".
    const hit = L.polyline(linePts, { color: RED, weight: 14, opacity: 0, interactive: true });
    hit.on('contextmenu', (e) => {
      if (e.originalEvent) { e.originalEvent.preventDefault(); e.originalEvent.stopPropagation(); }
      L.DomEvent.stopPropagation(e);
      const ox = (e.originalEvent && e.originalEvent.pageX) || 0;
      const oy = (e.originalEvent && e.originalEvent.pageY) || 0;
      if (typeof window.ouvrirMenuContextuelCarte === 'function') {
        window.ouvrirMenuContextuelCarte(e.latlng, ox, oy, { trafficPattern: entry });
      }
    });
    _lineLayer.addLayer(hit);
    entry._layers.push(hit);

    // Ligne visible rouge, 3 px.
    const poly = L.polyline(linePts, { color: RED, weight: 3, opacity: 1, fill: false, interactive: false });
    _lineLayer.addLayer(poly);
    entry._layers.push(poly);

    // Étiquettes : cap magnétique seul, aligné sur la ligne, décalé vers
    // l'extérieur (~4 px au-dessus de la ligne).
    const sgn = v => (v >= 0 ? `+ ${v.toFixed(1)}px` : `- ${Math.abs(v).toFixed(1)}px`);
    segs.forEach(s => {
      const tb = bearing(s.from.lat, s.from.lon, s.to.lat, s.to.lon);
      const cap = capMag(tb);
      const rot = screenAngle(tb);
      const mid = { lat: (s.from.lat + s.to.lat) / 2, lon: (s.from.lon + s.to.lon) / 2 };
      // Perpendiculaire « extérieure » = celle des deux qui s'éloigne du centroïde.
      const bCM = bearing(cLat, cLon, mid.lat, mid.lon);
      const p1 = (tb + 90) % 360, p2 = (tb + 270) % 360;
      const op = angDiff(p1, bCM) <= angDiff(p2, bCM) ? p1 : p2;
      const ox = Math.sin(toRad(op)) * LABEL_OFFSET_PX;
      const oy = -Math.cos(toRad(op)) * LABEL_OFFSET_PX;
      const transform = `translate(calc(-50% ${sgn(ox)}), calc(-50% ${sgn(oy)})) rotate(${rot.toFixed(1)}deg)`;
      const label = L.marker([mid.lat, mid.lon], {
        interactive: false,
        keyboard: false,
        icon: L.divIcon({
          className: 'tp-branch-label',
          html: `<span class="tp-branch-label-text" style="transform:${transform};">${cap}°</span>`,
          iconSize: [0, 0],
          iconAnchor: [0, 0],
        }),
      });
      _labelLayer.addLayer(label);
      entry._layers.push(label);

      // Pointe de flèche rouge (contour noir) au milieu de la branche, orientée
      // dans le SENS DE VOL → montre le sens du tour de piste. Affichée avec le
      // tracé (zoom ≥ 11). Angle écran réel (non ramené dans ±90, contrairement
      // au texte) pour pointer dans la vraie direction.
      const rawAngle = toDeg(Math.atan2(-Math.cos(toRad(tb)), Math.sin(toRad(tb))));
      const arrow = L.marker([mid.lat, mid.lon], {
        interactive: false,
        keyboard: false,
        icon: L.divIcon({
          className: 'tp-branch-label',
          html: `<span class="tp-branch-arrow" style="transform:translate(-50%,-50%) rotate(${rawAngle.toFixed(1)}deg);"><svg width="20" height="20" viewBox="-10 -10 20 20" style="display:block;overflow:visible;"><polygon points="-4,-6 7,0 -4,6" fill="#FF0000"/></svg></span>`,
          iconSize: [0, 0],
          iconAnchor: [0, 0],
        }),
      });
      _lineLayer.addLayer(arrow);
      entry._layers.push(arrow);
    });

    // Altitude (AGL paramétrée dans la modale) au CENTRE du rectangle, alignée
    // sur les grands côtés (axe de piste / vent arrière → cap `brng`).
    const rectCenter = [
      (Pf.lat + Pu.lat + PuSide.lat + PfSide.lat) / 4,
      (Pf.lon + Pu.lon + PuSide.lon + PfSide.lon) / 4,
    ];
    const altRot = screenAngle(brng).toFixed(1);
    const altLabel = L.marker(rectCenter, {
      interactive: false,
      keyboard: false,
      icon: L.divIcon({
        className: 'tp-branch-label',
        html: `<span class="tp-alt-label-text" style="transform:translate(-50%,-50%) rotate(${altRot}deg);">${entry.altitudeFt} ft</span>`,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      }),
    });
    _labelLayer.addLayer(altLabel);
    entry._layers.push(altLabel);

    toursDePiste.push(entry);
    _syncZoom();
    return entry;
  }

  // Supprime UN tour de piste (clic droit sur sa ligne → "Supprimer ce tour de
  // piste"). Retiré de la carte ET du plan (toursDePiste, sauvegardé au prochain
  // enregistrement).
  function _supprimer(entry) {
    const idx = toursDePiste.indexOf(entry);
    if (idx < 0) return;
    (entry._layers || []).forEach(l => {
      if (_lineLayer.hasLayer(l)) _lineLayer.removeLayer(l);
      if (_labelLayer.hasLayer(l)) _labelLayer.removeLayer(l);
    });
    toursDePiste.splice(idx, 1);
    _syncZoom();
  }

  function _effacerTous() {
    _lineLayer.clearLayers();
    _labelLayer.clearLayers();
    toursDePiste.length = 0;
    _syncZoom();
  }

  // Sérialisation pour le .navxpv (sans les objets Leaflet).
  function _serialiser() {
    return toursDePiste.map(e => ({
      airportIdent: e.airportIdent,
      airportName: e.airportName,
      airportCode: e.airportCode,
      lat: e.lat,
      lon: e.lon,
      runwayIdent: e.runwayIdent,
      oppositeIdent: e.oppositeIdent,
      airportElevFt: e.airportElevFt,
      thr: { lat: e.thr.lat, lon: e.thr.lon },
      opp: { lat: e.opp.lat, lon: e.opp.lon },
      hand: e.hand,
      upwindNM: e.upwindNM,
      crosswindNM: e.crosswindNM,
      finalNM: e.finalNM,
      altitudeFt: e.altitudeFt,
      declination: e.declination,
    }));
  }

  // Reconstruit les tours de piste depuis le .navxpv (déclinaison déjà stockée,
  // pas d'appel réseau). Les entrées invalides sont ignorées.
  function _charger(arr) {
    _effacerTous();
    if (!Array.isArray(arr)) return;
    arr.forEach(p => {
      if (!p || !p.thr || !p.opp
        || !Number.isFinite(p.thr.lat) || !Number.isFinite(p.thr.lon)
        || !Number.isFinite(p.opp.lat) || !Number.isFinite(p.opp.lon)) return;
      _dessiner({
        airportIdent: p.airportIdent,
        airportName: p.airportName,
        airportCode: p.airportCode,
        lat: p.lat,
        lon: p.lon,
        runwayIdent: p.runwayIdent,
        oppositeIdent: p.oppositeIdent,
        airportElevFt: Number.isFinite(p.airportElevFt) ? p.airportElevFt : null,
        thr: { lat: p.thr.lat, lon: p.thr.lon },
        opp: { lat: p.opp.lat, lon: p.opp.lon },
        hand: p.hand === 'right' ? 'right' : 'left',
        upwindNM: Number(p.upwindNM) || 0.5,
        crosswindNM: Number(p.crosswindNM) || 0.5,
        finalNM: Number(p.finalNM) || 0.7,
        altitudeFt: Number(p.altitudeFt) || 1000,
        declination: Number(p.declination) || 0,
      });
    });
  }

  if (btnValidate) btnValidate.addEventListener('click', _valider);
  if (btnCancel) btnCancel.addEventListener('click', _fermer);
  overlay.addEventListener('click', e => { if (e.target === overlay) _fermer(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && overlay.classList.contains('visible')) _fermer();
  });
  [inUpwind, inCrosswind, inFinal, inAlt].forEach(inp => {
    if (!inp) return;
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); _valider(); }
    });
  });

  window.demanderTourDePiste = _ouvrir;
  window.supprimerTourDePiste = _supprimer;
  window.effacerTousToursDePiste = _effacerTous;
  window.aDesToursDePiste = () => toursDePiste.length > 0;
  window.serialiserToursDePiste = _serialiser;
  window.chargerToursDePiste = _charger;
}

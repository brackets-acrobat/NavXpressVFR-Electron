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
// NavXpressVFR — map-measure.js
// Outil de mesure sur la carte : trait bleu foncé en direct du 1er point
// au curseur, finalisé au 2e clic gauche avec un label "route vraie /
// route magnétique / distance NM" au milieu du tracé.
// Annulation pendant le traçage : touche Échap.
//
// Une seule mesure à la fois : démarrer une nouvelle efface la précédente.
// Expose window.demarrerMesure / window.effacerMesure / window.aUneMesure
// (utilisées par le menu contextuel de la carte).
// ============================================================

function initMapMeasure() {
  if (typeof map === 'undefined' || !map) return;

  let _start = null;          // L.LatLng — point de départ
  let _line = null;           // L.Polyline (du 1er point au curseur, puis figée au 2e clic)
  let _labels = [];           // L.Marker divIcons posés après finalisation (top + bottom)
  let _tracing = false;       // true entre le démarrage et le 2e clic

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

  // Relèvement initial grand-cercle (true bearing) lat1/lon1 → lat2/lon2, en degrés [0..360[
  function _trueBearingDeg(lat1, lon1, lat2, lon2) {
    const toRad = d => d * Math.PI / 180;
    const toDeg = r => r * 180 / Math.PI;
    const φ1 = toRad(lat1);
    const φ2 = toRad(lat2);
    const Δλ = toRad(lon2 - lon1);
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2)
      - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  }

  function _formatDeg(deg) {
    return String(Math.round(deg) % 360).padStart(3, '0');
  }

  function _onMouseMove(e) {
    if (!_tracing || !_line || !_start) return;
    _line.setLatLngs([_start, e.latlng]);
  }

  function _onClick(e) {
    if (!_tracing || !_start) return;
    _terminer(e.latlng);
  }

  function _onKeyDown(e) {
    if (e.key === 'Escape' && _tracing) {
      effacerMesure();
    }
  }

  function _attacherHandlers() {
    map.on('mousemove', _onMouseMove);
    map.on('click', _onClick);
    document.addEventListener('keydown', _onKeyDown);
  }
  function _detacherHandlers() {
    map.off('mousemove', _onMouseMove);
    map.off('click', _onClick);
    document.removeEventListener('keydown', _onKeyDown);
  }

  function _terminer(endLatLng) {
    _tracing = false;
    _detacherHandlers();
    if (!_line || !_start || !endLatLng) return;
    _line.setLatLngs([_start, endLatLng]);

    const dist = _distanceNM(_start.lat, _start.lng, endLatLng.lat, endLatLng.lng);
    const trueDeg = _trueBearingDeg(_start.lat, _start.lng, endLatLng.lat, endLatLng.lng);
    const magDeg = (trueDeg - (declinaisonMoyenneGlobale || 0) + 360) % 360;

    // Milieu visuel du tracé (suffisant pour distances raisonnables)
    const midLat = (_start.lat + endLatLng.lat) / 2;
    const midLng = (_start.lng + endLatLng.lng) / 2;

    // Angle du tracé en pixels écran (Mercator étant conforme localement,
    // l'angle est invariant par zoom/pan — pas besoin de recalculer ensuite).
    // Borne à [-90,90] pour garder le texte lisible (jamais à l'envers).
    const p1 = map.latLngToContainerPoint(_start);
    const p2 = map.latLngToContainerPoint(endLatLng);
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    let angleDeg = Math.atan2(dy, dx) * 180 / Math.PI;
    if (angleDeg > 90) angleDeg -= 180;
    else if (angleDeg < -90) angleDeg += 180;

    // Perpendiculaire à la ligne, orientée vers le HAUT de l'écran (y plus petit).
    // Décalage : demi-épaisseur ligne (1) + écart visuel (3) + demi-hauteur texte 15 px (7,5) ≈ 12 px.
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    let perpX = -dy / len;
    let perpY = dx / len;
    if (perpY > 0) { perpX = -perpX; perpY = -perpY; }  // garder "vers le haut écran"
    const OFFSET_PX = 12;

    // Deux labels : route/cap AU-DESSUS, distance EN-DESSOUS (perpendiculaire opposée).
    const topText = `${_formatDeg(trueDeg)}°T / ${_formatDeg(magDeg)}°M`;
    const bottomText = `${dist.toFixed(1)} NM`;

    function _poserLabel(text, signe) {
      const offX = perpX * OFFSET_PX * signe;
      const offY = perpY * OFFSET_PX * signe;
      // Composition droite→gauche : 1) rotate, 2) centre sur l'anchor, 3) décale perpendiculairement.
      const transform = `translate(${offX}px,${offY}px) translate(-50%,-50%) rotate(${angleDeg}deg)`;
      const m = L.marker([midLat, midLng], {
        icon: L.divIcon({
          className: 'map-measure-label',
          html: `<div class="map-measure-label-inner" style="transform:${transform}">${text}</div>`,
          iconSize: null,
          iconAnchor: [0, 0],
        }),
        interactive: false,
        keyboard: false,
      }).addTo(map);
      _labels.push(m);
    }
    _poserLabel(topText, +1);     // au-dessus
    _poserLabel(bottomText, -1);  // en-dessous
  }

  function demarrerMesure(latlng) {
    if (!latlng) return;
    effacerMesure();   // jamais plus d'une mesure à la fois
    _start = L.latLng(latlng.lat, latlng.lng !== undefined ? latlng.lng : latlng.lon);
    _line = L.polyline([_start, _start], {
      color: '#0d47a1',
      weight: 2,
      opacity: 1,
      interactive: false,
    }).addTo(map);
    _tracing = true;
    _attacherHandlers();
  }

  function effacerMesure() {
    _tracing = false;
    _detacherHandlers();
    if (_line) { try { map.removeLayer(_line); } catch (_) { } }
    _labels.forEach(m => { try { map.removeLayer(m); } catch (_) { } });
    _line = null;
    _labels = [];
    _start = null;
  }

  function aUneMesure() {
    return !!(_line || _labels.length > 0);
  }

  // Ponts pour le menu contextuel (et usage futur)
  window.demarrerMesure = demarrerMesure;
  window.effacerMesure = effacerMesure;
  window.aUneMesure = aUneMesure;
}

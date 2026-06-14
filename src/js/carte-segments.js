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
// NavXpressVFR — carte-segments.js
// Segments de route sur la carte + drag de scission + rendu points  (extrait de ui.js — Phase 1)
// ============================================================

// -------------------------------------------------------
// Antiméridien (ligne de changement de date) — longitudes « déroulées » pour
// l'AFFICHAGE uniquement. Chaque point est ramené à moins de 180° de longitude
// du précédent, afin que segments, marqueurs et cadrage franchissent la ligne
// ±180° par le plus court chemin (ex. Tokyo RJTT → Los Angeles KLAX = Pacifique,
// et non Asie/Europe/Atlantique). Les longitudes STOCKÉES dans flightPlan
// restent normalisées dans [-180, 180] (la donnée n'est pas modifiée).
// -------------------------------------------------------
// Déroulage de base : chaque point ramené à moins de 180° du précédent, en
// ancrant le PREMIER point sur sa longitude canonique [-180,180]. Une route
// qui ne franchit pas l'antiméridien reste donc entièrement dans [-180,180].
function _unwrapLonsBase(points) {
  const out = [];
  let prev = null;
  for (const p of points) {
    let lon = (p && Number.isFinite(p.lon)) ? p.lon : 0;
    if (prev !== null) {
      while (lon - prev > 180) lon -= 360;
      while (lon - prev < -180) lon += 360;
    }
    out.push(lon);
    prev = lon;
  }
  return out;
}

// Décalage global (multiple de 360) à appliquer aux longitudes d'affichage de
// la route pour qu'elle soit dessinée sur la « copie » du monde actuellement
// visible. NÉCESSAIRE uniquement quand la route franchit l'antiméridien : sinon
// `worldCopyJump` ramène le centre dans [-180,180] où la route canonique est
// déjà visible, et on renvoie 0 (→ comportement strictement identique à avant).
// Pour une route franchissant la ligne, ses vertices > 180° resteraient sinon
// dessinés sur une copie voisine, donc invisibles (Leaflet ne rabat pas les
// polylignes sur la copie visible). On recentre alors la route près du centre
// courant de la carte. Dernier décalage appliqué mémorisé pour le redraw au pan.
let _lastAppliedRouteShift = 0;
function _fullPlanDisplayShift() {
  if (typeof map === 'undefined' || !map || typeof map.getCenter !== 'function') return 0;
  if (!Array.isArray(flightPlan) || flightPlan.length < 2) return 0;
  const base = _unwrapLonsBase(flightPlan);
  let min = Infinity, max = -Infinity;
  for (const l of base) { if (l < min) min = l; if (l > max) max = l; }
  if (min >= -180 && max <= 180) return 0; // ne franchit pas l'antiméridien
  const mid = (min + max) / 2;
  const centerLng = map.getCenter().lng;
  return Math.round((centerLng - mid) / 360) * 360;
}

// Déroulage d'affichage = base + décalage vers la copie visible (0 si route
// normale). Toutes les fonctions d'affichage (segments, marqueurs, fitBounds)
// passent par ici, donc restent cohérentes entre elles.
function _unwrapLons(points) {
  const base = _unwrapLonsBase(points);
  const shift = _fullPlanDisplayShift();
  return shift ? base.map(l => l + shift) : base;
}

// Redessine la géométrie de la route si la copie du monde visible a changé
// (pan par-delà l'antiméridien). Appelé sur `moveend` depuis map.js. Pour une
// route normale, le décalage vaut toujours 0 → aucun redraw, aucun surcoût.
function _reanchorRouteIfNeeded() {
  if (typeof map === 'undefined' || !map) return;
  if (!Array.isArray(flightPlan) || flightPlan.length < 2) return;
  const shift = _fullPlanDisplayShift();
  if (shift === _lastAppliedRouteShift) return; // copie inchangée
  marqueursCarte.forEach(m => { try { map.removeLayer(m); } catch (_) { } });
  marqueursCarte = [];
  flightPlan.forEach((p, idx) => tracerPointVisuel(p, idx));
  redessinerSegments();
  if (typeof updateAllWaypointLabels === 'function') updateAllWaypointLabels();
}
if (typeof window !== 'undefined') window._reanchorRouteIfNeeded = _reanchorRouteIfNeeded;

// Longitude d'affichage (déroulée) du point d'index idx de flightPlan.
function _displayLon(idx) {
  if (!Array.isArray(flightPlan) || idx == null || idx < 0 || idx >= flightPlan.length) {
    return null;
  }
  const disp = _unwrapLons(flightPlan.slice(0, idx + 1));
  return disp[disp.length - 1];
}

// Paires [lat, lonAffichage] de tout le plan, pour L.latLngBounds (fitBounds) :
// le cadrage suit ainsi lui aussi le plus court chemin à travers l'antiméridien.
function flightPlanDisplayLatLngs() {
  const disp = _unwrapLons(flightPlan);
  return flightPlan.map((p, i) => [p.lat, disp[i]]);
}

// Ramène une longitude quelconque dans [-180, 180] — pour stocker une coordonnée
// issue d'un clic / drag effectué dans le repère « déroulé » (peut sortir de la
// plage standard quand le plan franchit la ligne de changement de date).
function wrapLon(l) {
  return ((l + 180) % 360 + 360) % 360 - 180;
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

  // Longitudes d'affichage déroulées (gestion antiméridien).
  const disp = _unwrapLons(flightPlan);

  for (let i = 1; i < flightPlan.length; i++) {
    const ptA = flightPlan[i - 1];
    const ptB = flightPlan[i];
    const legIndex = i;
    const baseColor = _legColor(legIndex, activeLegIndex);

    const seg = L.polyline(
      [[ptA.lat, disp[i - 1]], [ptB.lat, disp[i]]],
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

  // Mémorise la copie du monde sur laquelle la route vient d'être dessinée,
  // pour que le redraw au pan (_reanchorRouteIfNeeded) ne se déclenche qu'au
  // changement effectif de copie.
  _lastAppliedRouteShift = _fullPlanDisplayShift();
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

  // Longitude d'affichage déroulée (antiméridien) : le marqueur reste dans le
  // même « tour du monde » que les segments adjacents. La coordonnée stockée
  // (point.lon) n'est pas modifiée.
  const dispLon = (indexDansFlightPlan != null) ? _displayLon(indexDansFlightPlan) : null;
  const marqueur = L.circleMarker([point.lat, dispLon != null ? dispLon : point.lon], stylePointVFR)
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


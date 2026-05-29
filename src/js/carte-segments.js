// ============================================================
// NavXpressVFR — carte-segments.js
// Segments de route sur la carte + drag de scission + rendu points  (extrait de ui.js — Phase 1)
// ============================================================

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


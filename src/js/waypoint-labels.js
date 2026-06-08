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
// NavXpressVFR — waypoint-labels.js
// Étiquettes (tooltips) des waypoints sur la carte  (extrait de ui.js — Phase 1)
// ============================================================

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


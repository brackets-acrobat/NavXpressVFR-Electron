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
// NavXpressVFR — windrose.js
// Rose des vents (flèche + panneau données)  (extrait de ui.js — Phase 1)
// ============================================================

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

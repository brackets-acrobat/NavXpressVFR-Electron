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
// NavXpressVFR — range-circle.js
// Cercle de portée : clic droit sur la carte → "Cercle de portée" → modale qui
// demande un rayon en NM. À la validation, trace un cercle magenta (#FF00FF) du
// rayon saisi + un point central de 8 px de diamètre (même magenta).
// Les cercles s'accumulent ; ils sont effacés par "Nouveau plan" (reset.js).
//
// Expose :
//   window.ouvrirModaleCerclePortee(latlng)   — clic droit "Cercle de portée"
//   window.tracerCerclePorteeNavaid(navaid)    — clic droit navaid "Cercle de
//                                                portée navaid" (rayon = rangeNm)
//   window.effacerTousCerclesPortee()          — appelée par reset.js
// Doit être appelé APRÈS initMap (carte Leaflet présente).
// ============================================================

function initRangeCircle() {
  if (typeof map === 'undefined' || !map || typeof L === 'undefined') return;

  const overlay = document.getElementById('range-circle-overlay');
  const input = document.getElementById('range-circle-radius');
  const errorEl = document.getElementById('range-circle-error');
  const btnCancel = document.getElementById('btn-range-circle-cancel');
  const btnValidate = document.getElementById('btn-range-circle-validate');
  if (!overlay || !input) return;

  const MAGENTA = '#FF00FF';
  let _pendingLatLng = null;
  const _layers = []; // [{ circle, dot }]

  function _fermer() {
    overlay.classList.remove('visible');
    _pendingLatLng = null;
  }

  function _ouvrir(latlng) {
    _pendingLatLng = latlng;
    input.value = '';
    if (errorEl) errorEl.textContent = '';
    overlay.classList.add('visible');
    setTimeout(() => { try { input.focus(); } catch (_) {} }, 50);
  }

  // Trace un cercle de portée magenta (anneau, rayon en mètres = NM × 1852).
  // withDot=true ajoute un point central plein de 8 px (rayon 4 px) — utilisé
  // pour le cercle manuel ; inutile pour un navaid qui marque déjà son centre.
  function _dessinerCercle(lat, lon, nm, withDot) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(nm) || nm <= 0) return;
    const circle = L.circle([lat, lon], {
      radius: nm * 1852,
      color: MAGENTA,
      weight: 2,
      opacity: 1,
      fill: false,
      interactive: false,
    }).addTo(map);
    let dot = null;
    if (withDot) {
      dot = L.circleMarker([lat, lon], {
        radius: 4,
        stroke: false,
        fill: true,
        fillColor: MAGENTA,
        fillOpacity: 1,
        interactive: false,
      }).addTo(map);
    }
    _layers.push({ circle, dot });
  }

  function _tracer() {
    if (!_pendingLatLng) return;
    const raw = (input.value || '').trim().replace(',', '.');
    const nm = parseFloat(raw);
    if (!Number.isFinite(nm) || nm <= 0) {
      if (errorEl) errorEl.textContent = t('rangeCircleInvalid');
      return;
    }
    _dessinerCercle(_pendingLatLng.lat, _pendingLatLng.lng, nm, true);
    _fermer();
  }

  // Cercle de portée d'un navaid (clic droit → "Cercle de portée navaid").
  // Rayon = portée publiée du navaid (navaid.rangeNm), centré sur sa position.
  function _tracerCerclePorteeNavaid(navaid) {
    if (!navaid) return;
    _dessinerCercle(navaid.lat, navaid.lon, navaid.rangeNm, false);
  }

  function _effacerTous() {
    _layers.forEach(({ circle, dot }) => {
      try { map.removeLayer(circle); } catch (_) {}
      if (dot) { try { map.removeLayer(dot); } catch (_) {} }
    });
    _layers.length = 0;
  }

  if (btnValidate) btnValidate.addEventListener('click', _tracer);
  if (btnCancel) btnCancel.addEventListener('click', _fermer);
  overlay.addEventListener('click', e => { if (e.target === overlay) _fermer(); });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); _tracer(); }
    else if (e.key === 'Escape') { e.preventDefault(); _fermer(); }
  });

  window.ouvrirModaleCerclePortee = _ouvrir;
  window.tracerCerclePorteeNavaid = _tracerCerclePorteeNavaid;
  window.effacerTousCerclesPortee = _effacerTous;
  // Présence d'au moins un cercle (manuel ou navaid) — pour la visibilité de
  // l'item "Effacer tous les cercles de portée" du menu contextuel.
  window.aDesCerclesPortee = () => _layers.length > 0;
}

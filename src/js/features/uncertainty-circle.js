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
// NavXpressVFR — uncertainty-circle.js
// Cercle d'incertitude : bouton flottant sur la carte qui affiche
// temporairement (5 s) un disque gris anthracite de 3 NM positionné
// aléatoirement, avec garantie que la position avion est à l'intérieur.
//
// Tirage : angle θ aléatoire + distance d = R·√(rand) (uniforme dans le
// disque) → centre = avion + offset (d, θ). Donc dist(avion, centre) < R
// par construction.
//
// Bouton désactivé tant que MSFS n'est pas connecté ET qu'une position avion
// n'a pas encore été reçue. Synchro via window.api.onStatusSimConnect +
// poll 1 Hz (la première position arrive ~5 s après connect, sans event).
//
// Placé dans le corner topright APRÈS les autres contrôles → apparaît à
// GAUCHE du menu calques (le corner est en `flex-direction: row-reverse`).
//
// Expose window._refreshUncertaintyBtn (libellé + tooltip à la bascule langue).
// ============================================================

function initUncertaintyCircle() {
  if (typeof map === 'undefined' || !map) return;
  if (typeof L === 'undefined') return;

  const R_NM = 3;
  const R_METERS = R_NM * 1852;
  const DISPLAY_MS = 5000;
  const COOLDOWN_MS = 5 * 60 * 1000;    // 5 min entre deux tirages effectifs
  const COOLDOWN_NOTICE_MS = 5000;       // durée d'affichage de la modale d'avertissement

  let _btnEl = null;
  let _activeCircle = null;
  let _activeTimer = null;
  let _lastTriggerMs = 0;                // 0 = jamais tiré, donc pas de cooldown actif
  let _cooldownNoticeTimer = null;

  // --- Réfs modale "cooldown" (peuvent être null si le DOM n'inclut pas la modale) ---
  const cooldownOverlay = document.getElementById('uncertainty-cooldown-overlay');
  const cooldownMsg = document.getElementById('uncertainty-cooldown-msg');
  const btnCooldownClose = document.getElementById('btn-uncertainty-cooldown-close');

  function _formatMMSS(ms) {
    const sec = Math.max(0, Math.ceil(ms / 1000));
    const mm = Math.floor(sec / 60);
    const ss = (sec % 60).toString().padStart(2, '0');
    return `${mm}:${ss}`;
  }

  function _fermerCooldown() {
    if (_cooldownNoticeTimer) { clearTimeout(_cooldownNoticeTimer); _cooldownNoticeTimer = null; }
    if (cooldownOverlay) cooldownOverlay.classList.remove('visible');
  }

  function _afficherCooldown(remainingMs) {
    if (!cooldownOverlay || !cooldownMsg) return;
    cooldownMsg.textContent = t('uncertaintyCooldownMsgFmt')(_formatMMSS(remainingMs));
    cooldownOverlay.classList.add('visible');
    if (_cooldownNoticeTimer) clearTimeout(_cooldownNoticeTimer);
    _cooldownNoticeTimer = setTimeout(_fermerCooldown, COOLDOWN_NOTICE_MS);
  }

  // Fermeture anticipée : × ou clic ailleurs dans la fenêtre (fond plein écran de l'overlay).
  if (btnCooldownClose) btnCooldownClose.addEventListener('click', _fermerCooldown);
  if (cooldownOverlay) {
    cooldownOverlay.addEventListener('click', e => {
      if (e.target === cooldownOverlay) _fermerCooldown();
    });
  }

  function _peutTirer() {
    return _simState === 'connected'
      && _lastAircraftPos
      && typeof _lastAircraftPos.lat === 'number'
      && typeof _lastAircraftPos.lon === 'number';
  }

  function _majBtn() {
    if (!_btnEl) return;
    const ok = _peutTirer();
    _btnEl.disabled = !ok;
    _btnEl.textContent = t('uncertaintyBtnLabel');
    _btnEl.title = ok ? t('uncertaintyBtnTooltipReady') : t('uncertaintyBtnTooltipDisabled');
  }

  function _effacer() {
    if (_activeTimer) { clearTimeout(_activeTimer); _activeTimer = null; }
    if (_activeCircle) {
      try { map.removeLayer(_activeCircle); } catch (_) { }
      _activeCircle = null;
    }
  }

  function _tirer() {
    if (!_peutTirer()) return;
    _effacer();
    _lastTriggerMs = Date.now();
    const lat0 = _lastAircraftPos.lat;
    const lon0 = _lastAircraftPos.lon;
    const theta = Math.random() * 2 * Math.PI;
    const dNM = R_NM * Math.sqrt(Math.random());
    const dLat = (dNM / 60) * Math.cos(theta);
    const dLon = (dNM / 60) * Math.sin(theta) / Math.cos(lat0 * Math.PI / 180);
    _activeCircle = L.circle([lat0 + dLat, lon0 + dLon], {
      radius: R_METERS,
      color: '#2c3e50',
      weight: 1,
      fillColor: '#2c3e50',
      fillOpacity: 0.75,
      opacity: 0.75,
      interactive: false,
    }).addTo(map);
    _activeTimer = setTimeout(_effacer, DISPLAY_MS);
  }

  const ctrl = L.control({ position: 'topright' });
  ctrl.onAdd = function () {
    const wrapper = L.DomUtil.create('div', 'layer-toggle-wrapper');
    L.DomEvent.disableClickPropagation(wrapper);
    L.DomEvent.disableScrollPropagation(wrapper);
    _btnEl = L.DomUtil.create('button', 'btn-layer-toggle', wrapper);
    _btnEl.type = 'button';
    _majBtn();
    _btnEl.addEventListener('click', e => {
      e.stopPropagation();
      if (_btnEl.disabled) return;
      const remaining = COOLDOWN_MS - (Date.now() - _lastTriggerMs);
      if (_lastTriggerMs > 0 && remaining > 0) {
        _afficherCooldown(remaining);
        return;
      }
      _tirer();
    });
    return wrapper;
  };
  ctrl.addTo(map);

  if (window.api && typeof window.api.onStatusSimConnect === 'function') {
    window.api.onStatusSimConnect(() => _majBtn());
  }
  setInterval(_majBtn, 1000);

  window._refreshUncertaintyBtn = _majBtn;
}

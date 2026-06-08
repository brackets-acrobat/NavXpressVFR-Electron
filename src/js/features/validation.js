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
// NavXpressVFR — validation.js
// Validation des champs vent/Vp + recalcul temps réel + popup avertissement.
// Extrait de ui.js (Phase 2 — Lot C).
// ============================================================

function initValidation() {
  // --- 6. Validation et recalcul en temps réel ---

  // Champs ICAO en lecture seule — remplis automatiquement à l'import

  // --- Popup d'avertissement custom ---
  const overlay = document.getElementById('warning-overlay');
  const warnMsg = document.getElementById('warning-message');
  const warnClose = document.getElementById('warning-close');
  let _pendingFocusEl = null;

  function showWarning(message, fieldEl) {
    _pendingFocusEl = fieldEl;
    warnMsg.textContent = message;
    overlay.classList.add('visible');
  }

  warnClose.addEventListener('click', () => {
    overlay.classList.remove('visible');
    if (_pendingFocusEl) {
      _pendingFocusEl.value = '';
      setTimeout(() => { _pendingFocusEl.focus(); _pendingFocusEl = null; }, 50);
    }
    mettreAJourLogDeNav();
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) warnClose.click();
  });

  function validerAuBlur(el, tester, messageKey) {
    el.addEventListener('blur', () => {
      const val = parseFloat(el.value);
      if (el.value !== '' && tester(val)) {
        showWarning(t(messageKey), el);
      } else {
        mettreAJourLogDeNav();
      }
    });
  }

  const inputWindDir = document.getElementById('input-wind-dir');
  const inputWindSpeed = document.getElementById('input-wind-speed');
  const inputVp = document.getElementById('input-vp');

  if (inputWindDir) validerAuBlur(inputWindDir, val => isNaN(val) || val < 0 || val > 360, 'alertWindDirInvalid');
  if (inputWindSpeed) {
    inputWindSpeed.addEventListener('blur', () => {
      const val = parseFloat(inputWindSpeed.value);
      if (inputWindSpeed.value !== '' && !isNaN(val) && val < 0) {
        showWarning(t('alertWindNegative'), inputWindSpeed);
      } else if (inputWindSpeed.value !== '' && (isNaN(val) || val > 40)) {
        showWarning(t('alertWindTooStrong'), inputWindSpeed);
      } else {
        mettreAJourLogDeNav();
      }
    });
  }
  if (inputVp) validerAuBlur(inputVp, val => isNaN(val) || val < 40 || val > 250, 'alertVpInvalid');

  // Recalcul au Enter sur ces champs (le blur s'en chargera pour la validation)
  [inputWindDir, inputWindSpeed, inputVp].forEach(el => {
    if (!el) return;
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter') el.blur();
    });
  });

  // Mise à jour live de la rose des vents pendant la saisie utilisateur
  const updateRoseFromInputs = () => {
    const d = parseFloat(inputWindDir?.value) || 0;
    const v = parseFloat(inputWindSpeed?.value) || 0;
    updateWindRose(d, v, 'manual');
  };
  if (inputWindDir) inputWindDir.addEventListener('input', updateRoseFromInputs);
  if (inputWindSpeed) inputWindSpeed.addEventListener('input', updateRoseFromInputs);

  // État initial de la rose
  updateRoseFromInputs();
}

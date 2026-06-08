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
// NavXpressVFR — openaip.js
// Clé + bouton + modale API OpenAIP
// Extrait de ui.js (Phase 2 — Lot A). Appelé par l'orchestrateur ui.js.
// ============================================================

async function chargerCleOpenAIP() {
  // --- Chargement silencieux de la clé OpenAIP ---
  try {
    const savedKey = await window.api.lireCleOpenAIP();
    if (savedKey) {
      OPENAIP_API_KEY = savedKey;
      console.log("🔑 Clé OpenAIP chargée depuis le fichier de configuration.");
    }
  } catch (err) {
    console.warn("Impossible de lire la clé OpenAIP:", err);
  }
}

function initOpenAIP() {
  // --- Bouton + Modale : API OpenAIP ---
  const btnApiOpenAIP = document.getElementById('btn-api-openaip');
  const apiOverlay = document.getElementById('api-openaip-overlay');
  const apiInput = document.getElementById('api-openaip-input');
  const apiHint = document.getElementById('api-openaip-hint');
  const apiTestResult = document.getElementById('api-test-result');
  const apiError = document.getElementById('api-openaip-error');
  const btnApiVisibility = document.getElementById('btn-api-toggle-visibility');
  const btnApiTest = document.getElementById('btn-api-test');
  const btnApiCancel = document.getElementById('btn-api-cancel');
  const btnApiValidate = document.getElementById('btn-api-validate');

  if (btnApiOpenAIP) {
    btnApiOpenAIP.addEventListener('click', () => {
      // Réinitialiser la modale
      apiInput.value = '';
      apiInput.type = 'password';
      btnApiVisibility.textContent = '👁️';
      apiTestResult.textContent = '';
      apiError.textContent = '';

      // Si une clé existe déjà, afficher le hint et masquer la valeur
      if (OPENAIP_API_KEY) {
        apiHint.style.display = 'block';
        apiHint.textContent = t('apiModalMaskedHint');
        apiInput.placeholder = '••••••••••••••••••••••••••••••••';
      } else {
        apiHint.style.display = 'none';
        apiInput.placeholder = t('apiModalPlaceholder');
      }

      apiOverlay.classList.add('visible');
      setTimeout(() => apiInput.focus(), 80);
    });
  }

  // Toggle visibilité clé
  if (btnApiVisibility) {
    btnApiVisibility.addEventListener('click', () => {
      if (apiInput.type === 'password') {
        apiInput.type = 'text';
        btnApiVisibility.textContent = '🙈';
      } else {
        apiInput.type = 'password';
        btnApiVisibility.textContent = '👁️';
      }
    });
  }

  // Tester la clé
  if (btnApiTest) {
    btnApiTest.addEventListener('click', async () => {
      const keyToTest = apiInput.value.trim() || OPENAIP_API_KEY;
      if (!keyToTest) {
        apiTestResult.style.color = '#ff5252';
        apiTestResult.textContent = t('apiEmptyKey');
        return;
      }
      apiTestResult.style.color = '#aaa';
      apiTestResult.textContent = t('apiTestLoading');
      btnApiTest.disabled = true;
      try {
        const resp = await fetch(
          'https://api.core.openaip.net/api/airports?page=1&limit=1',
          { headers: { 'x-openaip-api-key': keyToTest } }
        );
        if (resp.ok) {
          apiTestResult.style.color = '#00e676';
          apiTestResult.textContent = t('apiTestOk');
        } else {
          apiTestResult.style.color = '#ff5252';
          apiTestResult.textContent = t('apiTestFail');
        }
      } catch (err) {
        apiTestResult.style.color = '#ff5252';
        apiTestResult.textContent = t('apiTestFail');
      } finally {
        btnApiTest.disabled = false;
      }
    });
  }

  // Annuler
  if (btnApiCancel) {
    btnApiCancel.addEventListener('click', () => apiOverlay.classList.remove('visible'));
  }
  if (apiOverlay) {
    apiOverlay.addEventListener('click', (e) => {
      if (e.target === apiOverlay) apiOverlay.classList.remove('visible');
    });
  }

  // --- Modale de confirmation d'écrasement ---
  const apiConfirmOverlay = document.getElementById('api-confirm-overlay');
  const btnApiConfirmCancel = document.getElementById('btn-api-confirm-cancel');
  const btnApiConfirmOk = document.getElementById('btn-api-confirm-ok');
  let _pendingNewApiKey = null;

  async function doSaveApiKey(key) {
    apiError.style.color = '#aaa';
    apiError.textContent = currentLang === 'fr' ? '⏳ Sauvegarde...' : '⏳ Saving...';
    try {
      const result = await window.api.sauvegarderCleOpenAIP(key);
      const ok = (result === true) || (result && result.ok === true);
      if (ok) {
        OPENAIP_API_KEY = key;
        apiError.style.color = '#00e676';
        apiError.textContent = t('apiSaveSuccess');
        setTimeout(() => {
          apiOverlay.classList.remove('visible');
          apiError.textContent = '';
        }, 1200);
      } else {
        const msg = result && result.error ? result.error : t('apiSaveError');
        apiError.style.color = '#ff5252';
        apiError.textContent = '❌ ' + msg;
      }
    } catch (err) {
      console.error('doSaveApiKey error:', err);
      apiError.style.color = '#ff5252';
      apiError.textContent = '❌ ' + err.message;
    }
  }

  if (btnApiConfirmCancel) {
    btnApiConfirmCancel.addEventListener('click', () => {
      apiConfirmOverlay.classList.remove('visible');
      _pendingNewApiKey = null;
    });
  }
  if (apiConfirmOverlay) {
    apiConfirmOverlay.addEventListener('click', (e) => {
      if (e.target === apiConfirmOverlay) {
        apiConfirmOverlay.classList.remove('visible');
        _pendingNewApiKey = null;
      }
    });
  }
  if (btnApiConfirmOk) {
    btnApiConfirmOk.addEventListener('click', async () => {
      apiConfirmOverlay.classList.remove('visible');
      if (_pendingNewApiKey) {
        await doSaveApiKey(_pendingNewApiKey);
        _pendingNewApiKey = null;
      }
    });
  }

  // Valider (sauvegarder) — avec confirmation si une clé existe déjà
  if (btnApiValidate) {
    btnApiValidate.addEventListener('click', async () => {
      const newKey = apiInput.value.trim();
      apiError.textContent = '';

      // Champ vide + clé existante → fermer sans modifier
      if (!newKey && OPENAIP_API_KEY) {
        apiOverlay.classList.remove('visible');
        return;
      }
      if (!newKey) {
        apiError.style.color = '#ff5252';
        apiError.textContent = t('apiEmptyKey');
        return;
      }

      // Une ancienne clé existe → demander confirmation
      if (OPENAIP_API_KEY) {
        _pendingNewApiKey = newKey;
        // Appliquer les traductions sur la modale de confirmation
        apiConfirmOverlay.querySelectorAll('[data-i18n]').forEach(el => {
          el.textContent = t(el.getAttribute('data-i18n'));
        });
        apiConfirmOverlay.classList.add('visible');
      } else {
        // Pas d'ancienne clé → sauvegarder directement
        await doSaveApiKey(newKey);
      }
    });
  }
}

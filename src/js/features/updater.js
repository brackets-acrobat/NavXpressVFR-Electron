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
// NavXpressVFR — updater.js
// Bannière de mise à jour automatique (electron-updater).
//
// Le main process (setupAutoUpdater dans main.js) vérifie les Releases GitHub,
// télécharge en arrière-plan et relaie les étapes via window.api.onUpdate* :
//   - update-available  : une version plus récente existe → téléchargement lancé
//   - update-progress   : avancement du téléchargement ({ percent })
//   - update-downloaded : prête → on propose « Redémarrer et installer »
//   - update-error      : silencieux (on masque simplement la bannière)
//
// La bannière (#update-banner) est masquée par défaut. Le bouton « Plus tard »
// la referme sans annuler la MAJ (electron-updater l'installera au prochain quit
// puisque autoInstallOnAppQuit = true côté main).
// ============================================================

function initUpdater() {
  if (!window.api || typeof window.api.onUpdateAvailable !== 'function') return;

  const banner = document.getElementById('update-banner');
  const textEl = document.getElementById('update-banner-text');
  const actionBtn = document.getElementById('update-banner-action');
  const closeBtn = document.getElementById('update-banner-close');
  if (!banner || !textEl || !actionBtn || !closeBtn) return;

  // Version embarquée dans le dernier event (affichée à côté du libellé).
  let _version = '';
  const vSuffix = () => (_version ? ` (v${_version})` : '');

  function show() { banner.style.display = 'flex'; }
  function hide() { banner.style.display = 'none'; }

  // Étape « disponible / en téléchargement » : pas de bouton d'action.
  function showDownloading(percent) {
    actionBtn.style.display = 'none';
    const pct = Number.isFinite(percent) ? ` ${Math.round(percent)}%` : '';
    textEl.textContent = t('updateAvailable') + vSuffix() + pct;
    show();
  }

  // Étape « prête » : bouton « Redémarrer et installer ».
  function showReady() {
    actionBtn.style.display = '';
    actionBtn.textContent = t('updateInstallBtn');
    textEl.textContent = t('updateReady') + vSuffix();
    show();
  }

  window.api.onUpdateAvailable((data) => {
    _version = (data && data.version) || '';
    showDownloading();
  });

  window.api.onUpdateProgress((data) => {
    // N'affiche la progression que si la bannière « prête » n'est pas déjà là.
    if (actionBtn.style.display === 'none') showDownloading(data && data.percent);
  });

  window.api.onUpdateDownloaded((data) => {
    if (data && data.version) _version = data.version;
    showReady();
  });

  window.api.onUpdateError(() => {
    // Échec réseau / pas de release : on n'embête pas l'utilisateur.
    hide();
  });

  actionBtn.addEventListener('click', () => {
    actionBtn.disabled = true;
    if (typeof window.api.installUpdate === 'function') window.api.installUpdate();
  });

  closeBtn.addEventListener('click', hide);
}

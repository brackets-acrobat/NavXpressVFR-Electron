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
// NavXpressVFR — map-coords.js
// "Coordonnées du point" : clic droit sur la carte → modale affichant les
// coordonnées GPS du point cliqué, avec une icône "Copier".
//
// Les coordonnées copiées sont stockées dans la mémoire interne `coordsCopiees`
// (cf. globals.js) sous forme { lat, lon } décimal signé. Elles peuvent ensuite
// être collées UNE SEULE FOIS dans :
//   - la modale "Insérer un point tournant"  (un jeu de coords)
//   - la modale "Éditer le leg"               (départ OU arrivée)
// Après un collage, la mémoire est vidée et tous les boutons "Coller"
// disparaissent (tant qu'aucune nouvelle copie n'a été faite).
//
// Ponts exposés :
//   window.ouvrirModaleCoordsPoint(latlng)  — ouvre la modale (menu contextuel)
//   window.rafraichirBoutonsCollage()        — (ré)affiche/cache les boutons Coller
// ============================================================

function initMapCoords() {
  const overlay = document.getElementById('coords-point-overlay');
  if (!overlay) return;

  const latInput = document.getElementById('coords-point-lat');
  const lonInput = document.getElementById('coords-point-lon');
  const btnCopy = document.getElementById('btn-coords-point-copy');
  const btnClose = document.getElementById('btn-coords-point-close');
  const copiedMsg = document.getElementById('coords-point-copied');

  // Point actuellement affiché dans la modale (décimal signé).
  let _point = null;
  let _copiedTimer = null;

  function _setRadio(name, value) {
    document.querySelectorAll(`input[name="${name}"]`).forEach(r => {
      r.checked = (r.value === value);
    });
  }

  function _ouvrir(latlng) {
    if (!latlng) return;
    // wrapLon : re-normalise la longitude dans [-180, 180] (repère déroulé possible
    // à proximité de l'antiméridien).
    const lat = latlng.lat;
    const lon = (typeof wrapLon === 'function')
      ? wrapLon(latlng.lng !== undefined ? latlng.lng : latlng.lon)
      : (latlng.lng !== undefined ? latlng.lng : latlng.lon);
    _point = { lat, lon };

    if (latInput) latInput.value = Math.abs(lat).toFixed(6);
    if (lonInput) lonInput.value = Math.abs(lon).toFixed(6);
    _setRadio('coords-point-lat-dir', lat >= 0 ? 'N' : 'S');
    _setRadio('coords-point-lon-dir', lon >= 0 ? 'E' : 'W');

    if (copiedMsg) copiedMsg.style.display = 'none';
    overlay.classList.add('visible');
  }

  function _fermer() {
    overlay.classList.remove('visible');
    if (_copiedTimer) { clearTimeout(_copiedTimer); _copiedTimer = null; }
  }

  function _copier() {
    if (!_point) return;
    // Stockage interne (consommé au collage)
    coordsCopiees = { lat: _point.lat, lon: _point.lon };
    // Bonus : presse-papier système (best-effort, sans bloquer en cas d'échec)
    try {
      const txt = `${_point.lat.toFixed(6)}, ${_point.lon.toFixed(6)}`;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).catch(() => {});
      }
    } catch (_) { /* ignore */ }

    // Retour visuel "Copié !"
    if (copiedMsg) {
      copiedMsg.style.display = 'inline';
      if (_copiedTimer) clearTimeout(_copiedTimer);
      _copiedTimer = setTimeout(() => {
        if (copiedMsg) copiedMsg.style.display = 'none';
        _copiedTimer = null;
      }, 1800);
    }

    // Les boutons Coller deviennent disponibles
    rafraichirBoutonsCollage();
  }

  if (btnCopy) btnCopy.addEventListener('click', _copier);
  if (btnClose) btnClose.addEventListener('click', _fermer);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) _fermer(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay.classList.contains('visible')) _fermer();
  });

  // -------------------------------------------------------
  // Boutons "Coller" dans les modales Insérer / Éditer le leg
  // -------------------------------------------------------
  // Chaque cible décrit où écrire : ids des champs lat/lon + noms des groupes
  // de radios N/S et E/W.
  const PASTE_TARGETS = [
    {
      btnId: 'btn-insert-wp-paste',
      latId: 'insert-wp-lat', latRadio: 'lat-dir',
      lonId: 'insert-wp-lon', lonRadio: 'lon-dir',
    },
    {
      btnId: 'btn-edit-leg-dep-paste',
      latId: 'edit-leg-dep-lat', latRadio: 'edit-dep-lat-dir',
      lonId: 'edit-leg-dep-lon', lonRadio: 'edit-dep-lon-dir',
    },
    {
      btnId: 'btn-edit-leg-arr-paste',
      latId: 'edit-leg-arr-lat', latRadio: 'edit-arr-lat-dir',
      lonId: 'edit-leg-arr-lon', lonRadio: 'edit-arr-lon-dir',
    },
  ];

  function _collerDans(target) {
    if (!coordsCopiees) return;
    const { lat, lon } = coordsCopiees;
    const latEl = document.getElementById(target.latId);
    const lonEl = document.getElementById(target.lonId);
    if (latEl) latEl.value = Math.abs(lat).toFixed(6);
    if (lonEl) lonEl.value = Math.abs(lon).toFixed(6);
    _setRadio(target.latRadio, lat >= 0 ? 'N' : 'S');
    _setRadio(target.lonRadio, lon >= 0 ? 'E' : 'W');

    // Consommation : usage unique → on vide la mémoire et on cache les boutons.
    coordsCopiees = null;
    rafraichirBoutonsCollage();
  }

  // (Ré)affiche ou cache TOUS les boutons Coller selon l'état de coordsCopiees.
  function rafraichirBoutonsCollage() {
    const visible = !!coordsCopiees;
    PASTE_TARGETS.forEach(target => {
      const btn = document.getElementById(target.btnId);
      if (btn) btn.style.display = visible ? '' : 'none';
    });
  }

  // Câblage des clics sur les boutons Coller
  PASTE_TARGETS.forEach(target => {
    const btn = document.getElementById(target.btnId);
    if (btn) btn.addEventListener('click', () => _collerDans(target));
  });

  // État initial : rien de copié → boutons cachés
  rafraichirBoutonsCollage();

  // -------------------------------------------------------
  // Ponts publics
  // -------------------------------------------------------
  window.ouvrirModaleCoordsPoint = _ouvrir;
  window.rafraichirBoutonsCollage = rafraichirBoutonsCollage;
}

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
// NavXpressVFR — map-context-menu.js
// Menu contextuel (clic droit) sur la carte Leaflet.
//
// Conçu pour être EXTENSIBLE : la liste d'items est définie dans
// MAP_CONTEXT_MENU_ITEMS — chaque item a { id, labelKey, action(latlng) }.
// Pour ajouter une entrée future, ajouter un item à ce tableau.
// ============================================================

// Contexte de l'ouverture courante du menu (module-level pour que les prédicats
// `visible()` et les `action()` des items — définis hors de initMapContextMenu —
// puissent le consulter). Mis à jour à chaque ouverture, remis à null à la
// fermeture. Ex. { navaid } quand on a fait un clic droit sur un VOR.
let _mapCtxContext = null;

// Registre des items du menu. Ordre = ordre d'affichage.
// labelKey  : clé i18n pour le libellé (cf. src/i18n.js).
// action    : fonction (latlng, context) appelée quand l'utilisateur clique sur
//             l'item. `context` = _mapCtxContext de l'ouverture courante (ou null).
// visible   : (optionnel) prédicat () => bool. Si défini et retourne false,
//             l'item n'est pas rendu à l'ouverture du menu.
const MAP_CONTEXT_MENU_ITEMS = [
  {
    id: 'flanquement-vor',
    labelKey: 'mapCtxFlanquement',
    // Ne s'affiche que sur clic droit d'un VOR (contexte navaid présent).
    visible: () => !!(_mapCtxContext && _mapCtxContext.navaid),
    action: (latlng, context) => {
      if (context && context.navaid && typeof window.ouvrirModaleFlanquement === 'function') {
        window.ouvrirModaleFlanquement(context.navaid);
      }
    },
  },
  {
    id: 'direct-to',
    labelKey: 'mapCtxDirectTo',
    action: (latlng) => {
      if (typeof window.demanderDirectToPoint === 'function') {
        window.demanderDirectToPoint(latlng.lat, latlng.lng);
      }
    },
  },
  {
    id: 'add-marker',
    labelKey: 'mapCtxAddMarker',
    action: (latlng) => {
      if (typeof window.demanderAjoutRepere === 'function') {
        window.demanderAjoutRepere(latlng);
      }
    },
  },
  {
    id: 'measure-from',
    labelKey: 'mapCtxMeasureFrom',
    action: (latlng) => {
      if (typeof window.demarrerMesure === 'function') {
        window.demarrerMesure(latlng);
      }
    },
  },
  {
    id: 'measure-clear',
    labelKey: 'mapCtxMeasureClear',
    visible: () => (typeof window.aUneMesure === 'function') && window.aUneMesure(),
    action: () => {
      if (typeof window.effacerMesure === 'function') {
        window.effacerMesure();
      }
    },
  },
  {
    id: 'coords',
    labelKey: 'mapCtxCoords',
    action: (latlng) => {
      if (typeof window.ouvrirModaleCoordsPoint === 'function') {
        window.ouvrirModaleCoordsPoint(latlng);
      }
    },
  },
  // --- Ajouter ici les futurs items du menu contextuel ---
];

function initMapContextMenu() {
  if (typeof map === 'undefined' || !map) return;
  const menuEl = document.getElementById('map-context-menu');
  if (!menuEl) return;

  // (Re)construit le DOM interne du menu à partir du registre.
  // Appelé à chaque ouverture pour rafraîchir les labels i18n et la
  // visibilité dynamique des items (champ visible() optionnel).
  function _construireMenu() {
    menuEl.innerHTML = '';
    const ul = document.createElement('ul');
    let count = 0;
    MAP_CONTEXT_MENU_ITEMS.forEach(item => {
      if (typeof item.visible === 'function' && !item.visible()) return;
      const li = document.createElement('li');
      li.className = 'map-ctx-menu-item';
      li.dataset.itemId = item.id;
      li.textContent = t(item.labelKey);
      ul.appendChild(li);
      count++;
    });
    menuEl.appendChild(ul);
    return count;
  }
  _construireMenu();

  let _currentLatLng = null;

  function _fermer() {
    menuEl.style.display = 'none';
    _currentLatLng = null;
    _mapCtxContext = null;
  }

  function _ouvrir(latlng, pageX, pageY, context) {
    _currentLatLng = latlng;
    _mapCtxContext = context || null;
    _construireMenu();   // refresh i18n au cas où la langue ait changé

    // Positionnement : on affiche d'abord pour mesurer, puis on ajuste si
    // le menu déborde du viewport (coin bas-droit notamment).
    menuEl.style.left = pageX + 'px';
    menuEl.style.top = pageY + 'px';
    menuEl.style.display = 'block';
    const rect = menuEl.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (rect.right > vw) menuEl.style.left = (pageX - rect.width) + 'px';
    if (rect.bottom > vh) menuEl.style.top = (pageY - rect.height) + 'px';
  }

  // Délégation : un seul listener sur le conteneur du menu.
  menuEl.addEventListener('click', (e) => {
    const li = e.target.closest('.map-ctx-menu-item');
    if (!li) return;
    const itemId = li.dataset.itemId;
    const item = MAP_CONTEXT_MENU_ITEMS.find(x => x.id === itemId);
    const latlng = _currentLatLng;
    const context = _mapCtxContext;
    _fermer();
    if (item && latlng && typeof item.action === 'function') {
      try { item.action(latlng, context); }
      catch (err) { console.error('Map context menu action error:', err); }
    }
  });

  // Ouverture sur clic droit dans la carte (Leaflet propage depuis les
  // marqueurs sauf si ceux-ci interceptent l'événement).
  map.on('contextmenu', (e) => {
    if (e.originalEvent) {
      e.originalEvent.preventDefault();
      e.originalEvent.stopPropagation();
    }
    const ox = (e.originalEvent && e.originalEvent.pageX) || 0;
    const oy = (e.originalEvent && e.originalEvent.pageY) || 0;
    _ouvrir(e.latlng, ox, oy, null);
  });

  // Ouverture programmatique avec contexte (ex. clic droit sur un marqueur VOR,
  // déclenché depuis map.js). Le contexte est consulté par visible()/action().
  window.ouvrirMenuContextuelCarte = (latlng, pageX, pageY, context) => {
    _ouvrir(latlng, pageX, pageY, context);
  };

  // Fermeture par clic ailleurs : CAPTURE-phase + stopImmediatePropagation,
  // pour intercepter le clic AVANT que la carte (et notamment l'outil de
  // mesure en cours de traçage) ne le voie comme un clic valide.
  document.addEventListener('click', (e) => {
    if (menuEl.style.display === 'none') return;
    if (e.target.closest('#map-context-menu')) return;
    e.stopImmediatePropagation();
    _fermer();
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') _fermer();
  });
  map.on('movestart zoomstart', _fermer);

  // Bloque le menu contextuel natif du navigateur sur la carte (sécurité
  // pour les zones qui ne passeraient pas par le handler Leaflet).
  const mapContainer = map.getContainer ? map.getContainer() : document.getElementById('map-container');
  if (mapContainer) {
    mapContainer.addEventListener('contextmenu', (e) => e.preventDefault());
  }
}

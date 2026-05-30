// ============================================================
// NavXpressVFR — map-context-menu.js
// Menu contextuel (clic droit) sur la carte Leaflet.
//
// Conçu pour être EXTENSIBLE : la liste d'items est définie dans
// MAP_CONTEXT_MENU_ITEMS — chaque item a { id, labelKey, action(latlng) }.
// Pour ajouter une entrée future, ajouter un item à ce tableau.
// ============================================================

// Registre des items du menu. Ordre = ordre d'affichage.
// labelKey  : clé i18n pour le libellé (cf. src/i18n.js).
// action    : fonction (latlng) appelée quand l'utilisateur clique sur l'item.
const MAP_CONTEXT_MENU_ITEMS = [
  {
    id: 'direct-to',
    labelKey: 'mapCtxDirectTo',
    action: (latlng) => {
      if (typeof window.demanderDirectToPoint === 'function') {
        window.demanderDirectToPoint(latlng.lat, latlng.lng);
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
  // Appelé à l'init ET à chaque ouverture pour rafraîchir les labels i18n.
  function _construireMenu() {
    menuEl.innerHTML = '';
    const ul = document.createElement('ul');
    MAP_CONTEXT_MENU_ITEMS.forEach(item => {
      const li = document.createElement('li');
      li.className = 'map-ctx-menu-item';
      li.dataset.itemId = item.id;
      li.textContent = t(item.labelKey);
      ul.appendChild(li);
    });
    menuEl.appendChild(ul);
  }
  _construireMenu();

  let _currentLatLng = null;

  function _fermer() {
    menuEl.style.display = 'none';
    _currentLatLng = null;
  }

  function _ouvrir(latlng, pageX, pageY) {
    _currentLatLng = latlng;
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
    _fermer();
    if (item && latlng && typeof item.action === 'function') {
      try { item.action(latlng); }
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
    _ouvrir(e.latlng, ox, oy);
  });

  // Fermeture : clic gauche ailleurs, scroll, Esc, déplacement de la carte.
  document.addEventListener('click', (e) => {
    if (menuEl.style.display === 'none') return;
    if (e.target.closest('#map-context-menu')) return;
    _fermer();
  });
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

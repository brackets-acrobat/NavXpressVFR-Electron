// ============================================================
// NavXpressVFR — map-search.js
// Bouton 🔍 « Rechercher » placé en BAS À GAUCHE de la carte. Au clic, ouvre
// une modale qui permet de chercher :
//   - Aéroport par 'name' (libellé « Nom », sous-chaîne insensible casse/accents)
//   - Aéroport par 'icao'  (libellé « Code ICAO », exact insensible casse)
//   - Navaid   par 'name'  (libellé « Nom », sous-chaîne insensible casse/accents)
//   - Navaid   par 'ident' (libellé « Code », exact insensible casse)
// Les recherches sont plafonnées à 50 résultats côté main.
//
// Comportement :
//   - 0 résultat  → message "Aucun résultat"
//   - 1 résultat  → centrage IMMÉDIAT sur la cible (zoom MAP_SEARCH_ZOOM), modale fermée
//   - >1 résultats→ liste de radios avec pays affiché, bouton « Sélectionner »
//                   → centrage à la validation
//
// Expose window._refreshMapSearchBtn (relibellage tooltip à la bascule langue).
// ============================================================

function initMapSearch() {
  if (typeof map === 'undefined' || !map) return;
  if (typeof L === 'undefined') return;

  const MAP_SEARCH_ZOOM = 11;
  const MAX_RESULTS = 50; // doit refléter RECHERCHE_MODALE_MAX côté main.js

  // --- Réfs DOM (modale présente dans index.html) ---
  const overlay      = document.getElementById('map-search-overlay');
  const popup        = document.getElementById('map-search-popup');
  const input        = document.getElementById('ms-input');
  const btnSearch    = document.getElementById('btn-ms-search');
  const btnCancel    = document.getElementById('btn-ms-cancel');
  const btnClose     = document.getElementById('btn-map-search-close');
  const statusEl     = document.getElementById('ms-status');
  const resultsEl    = document.getElementById('ms-results');
  const labelName    = document.getElementById('ms-field-name-label');
  const labelCode    = document.getElementById('ms-field-code-label');

  if (!overlay || !input || !btnSearch || !statusEl || !resultsEl) {
    console.warn('[map-search] Modale introuvable dans le DOM — initialisation abandonnée.');
    return;
  }

  // --- Bouton flottant Leaflet (bottomleft) ---
  let _btnEl = null;
  let _nightBtnEl = null;
  const ctrl = L.control({ position: 'bottomleft' });
  ctrl.onAdd = function () {
    const wrapper = L.DomUtil.create('div', 'layer-toggle-wrapper map-search-wrapper');
    L.DomEvent.disableClickPropagation(wrapper);
    L.DomEvent.disableScrollPropagation(wrapper);
    _btnEl = L.DomUtil.create('button', 'btn-map-search', wrapper);
    _btnEl.type = 'button';
    // Icône loupe SVG
    _btnEl.innerHTML = `
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none"
           stroke="currentColor" stroke-width="2.2"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="10.5" cy="10.5" r="6.5"></circle>
        <line x1="20" y1="20" x2="15.2" y2="15.2"></line>
      </svg>
    `;
    _btnEl.setAttribute('aria-label', t('mapSearchBtnTooltip'));
    _btnEl.title = t('mapSearchBtnTooltip');
    _btnEl.addEventListener('click', e => {
      e.stopPropagation();
      _ouvrirModale();
    });

    // --- Bouton toggle Jour/Nuit (à droite de la loupe, même wrapper) ---
    _nightBtnEl = L.DomUtil.create('button', 'btn-map-search btn-map-night', wrapper);
    _nightBtnEl.type = 'button';
    // Icône lune SVG (croissant)
    _nightBtnEl.innerHTML = `
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none"
           stroke="currentColor" stroke-width="2.2"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.5 6.5 0 0 0 9.8 9.8z"></path>
      </svg>
    `;
    _nightBtnEl.title = t('mapNightBtnTooltip');
    _nightBtnEl.setAttribute('aria-label', t('mapNightBtnTooltip'));
    _nightBtnEl.addEventListener('click', e => {
      e.stopPropagation();
      _toggleNight();
    });
    // État initial restauré depuis les options (window.appOptions déjà chargé)
    _applyNight(!!(window.appOptions && window.appOptions.mapNightMode));

    return wrapper;
  };
  ctrl.addTo(map);

  // ---------- Mode nuit : assombrit les tuiles via classe sur #map-container ----------
  function _applyNight(on) {
    const container = document.getElementById('map-container');
    if (container) container.classList.toggle('map-night', on);
    if (_nightBtnEl) {
      _nightBtnEl.classList.toggle('active', on);
      _nightBtnEl.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  function _toggleNight() {
    const on = !(window.appOptions && window.appOptions.mapNightMode);
    _applyNight(on);
    if (typeof setAppOption === 'function') setAppOption('mapNightMode', on); // persiste
  }

  // Bascule langue : titres des boutons
  function _majBtn() {
    if (_btnEl) {
      _btnEl.title = t('mapSearchBtnTooltip');
      _btnEl.setAttribute('aria-label', t('mapSearchBtnTooltip'));
    }
    if (_nightBtnEl) {
      _nightBtnEl.title = t('mapNightBtnTooltip');
      _nightBtnEl.setAttribute('aria-label', t('mapNightBtnTooltip'));
    }
  }
  window._refreshMapSearchBtn = _majBtn;

  // ---------- Modale : ouverture / fermeture ----------
  function _ouvrirModale() {
    // Reset état
    statusEl.textContent = '';
    statusEl.className = 'search-status';
    resultsEl.innerHTML = '';
    resultsEl.classList.remove('visible');
    input.value = '';
    // Toujours réinitialiser le choix au défaut "Aéroport / Nom"
    const radEntAirport = overlay.querySelector('input[name="ms-entity"][value="airport"]');
    if (radEntAirport) radEntAirport.checked = true;
    const radFieldName = overlay.querySelector('input[name="ms-field"][value="name"]');
    if (radFieldName) radFieldName.checked = true;
    _majLabelsEtPlaceholder();
    overlay.classList.add('visible');
    setTimeout(() => input.focus(), 50);
  }

  function _fermerModale() {
    overlay.classList.remove('visible');
  }

  // ---------- Mise à jour des libellés du sélecteur de champ ----------
  // Aéroport → ("Nom", "Code ICAO") | Navaid → ("Nom", "Code")
  function _entiteCourante() {
    const el = overlay.querySelector('input[name="ms-entity"]:checked');
    return el ? el.value : 'airport';
  }
  function _champCourant() {
    const el = overlay.querySelector('input[name="ms-field"]:checked');
    return el ? el.value : 'name';
  }
  function _majLabelsEtPlaceholder() {
    const ent = _entiteCourante();
    const fld = _champCourant();
    if (ent === 'airport') {
      labelName.textContent = t('mapSearchFieldAirportName');
      labelCode.textContent = t('mapSearchFieldAirportIcao');
    } else {
      labelName.textContent = t('mapSearchFieldNavaidName');
      labelCode.textContent = t('mapSearchFieldNavaidIdent');
    }
    if (fld === 'name') {
      input.placeholder = t('mapSearchPlaceholderName');
    } else if (ent === 'airport') {
      input.placeholder = t('mapSearchPlaceholderIcao');
    } else {
      input.placeholder = t('mapSearchPlaceholderIdent');
    }
  }

  // ---------- Recherche ----------
  let _reqId = 0;

  async function _lancerRecherche() {
    const q = (input.value || '').trim();
    if (!q) {
      statusEl.className = 'search-status error';
      statusEl.textContent = t('searchNotFound');
      resultsEl.innerHTML = '';
      resultsEl.classList.remove('visible');
      return;
    }
    const ent = _entiteCourante();
    const fld = _champCourant();
    // Mappe le sélecteur générique 'code' → 'icao' (airport) | 'ident' (navaid)
    const fieldApi = fld === 'name'
      ? 'name'
      : (ent === 'airport' ? 'icao' : 'ident');

    statusEl.className = 'search-status';
    statusEl.textContent = t('searchSearching');
    resultsEl.innerHTML = '';
    resultsEl.classList.remove('visible');

    const reqId = ++_reqId;
    let res;
    try {
      res = await window.api.rechercheModale({ entity: ent, field: fieldApi, query: q });
    } catch (err) {
      if (reqId !== _reqId) return;
      console.error('[map-search] IPC error:', err);
      statusEl.className = 'search-status error';
      statusEl.textContent = t('searchNetworkError');
      return;
    }
    if (reqId !== _reqId) return; // réponse périmée

    if (!res || !res.ok) {
      statusEl.className = 'search-status error';
      if (res && res.reason === 'no-data') {
        statusEl.textContent = t('mapSearchNoData');
      } else if (res && res.reason === 'empty') {
        statusEl.textContent = t('searchNotFound');
      } else {
        statusEl.textContent = t('searchNetworkError');
      }
      return;
    }

    const matches = res.matches || [];
    if (matches.length === 0) {
      statusEl.className = 'search-status error';
      statusEl.textContent = t('mapSearchNoResult');
      return;
    }

    // Cas 1 résultat → centrage immédiat (cf. spec utilisateur :
    // « Si plusieurs résultats sont possible, une modale s'ouvrira »)
    if (matches.length === 1) {
      _selectionner(matches[0]);
      return;
    }

    // >1 résultats → liste de radios + bouton Sélectionner
    statusEl.className = 'search-status ok';
    statusEl.textContent = res.truncated
      ? t('mapSearchTruncated')(MAX_RESULTS)
      : t('mapSearchResultsCount')(matches.length);

    _renderResultsList(matches);
  }

  function _renderResultsList(matches) {
    resultsEl.innerHTML = '';
    const groupName = 'ms-result-' + Math.random().toString(36).slice(2, 9);

    matches.forEach((m, idx) => {
      const item = document.createElement('label');
      item.className = 'wp-result-item';
      const typeLabel = m.kind === 'airport'
        ? (typeof formatAirportType === 'function' ? formatAirportType(m.type) : (m.type || ''))
        : (m.type || '');
      item.innerHTML = `
        <input type="radio" name="${groupName}" value="${idx}">
        <span class="wp-result-code">${escapeHtml(m.code || '')}</span>
        <span class="wp-result-type">${escapeHtml(typeLabel)}</span>
        <span class="wp-result-country">${escapeHtml(m.country || '—')}</span>
        <span class="wp-result-name">${escapeHtml(m.name || '')}</span>
      `;
      resultsEl.appendChild(item);
    });

    // Zone d'action avec bouton Sélectionner
    const actions = document.createElement('div');
    actions.className = 'wp-results-action';
    const btnSelect = document.createElement('button');
    btnSelect.className = 'btn-wp-select';
    btnSelect.textContent = t('btnSelectChoice');
    btnSelect.disabled = true;
    actions.appendChild(btnSelect);
    resultsEl.appendChild(actions);

    resultsEl.classList.add('visible');

    resultsEl.querySelectorAll('input[type="radio"]').forEach(r => {
      r.addEventListener('change', () => { btnSelect.disabled = false; });
    });

    btnSelect.addEventListener('click', () => {
      const checked = resultsEl.querySelector('input[type="radio"]:checked');
      if (!checked) return;
      const m = matches[parseInt(checked.value, 10)];
      if (!m) return;
      _selectionner(m);
    });
  }

  // Centre la carte sur le résultat puis ferme la modale.
  function _selectionner(m) {
    if (typeof m.lat !== 'number' || typeof m.lon !== 'number') {
      statusEl.className = 'search-status error';
      statusEl.textContent = t('searchCoordsNotFound');
      return;
    }
    try {
      map.setView([m.lat, m.lon], MAP_SEARCH_ZOOM);
    } catch (err) {
      console.error('[map-search] setView error:', err);
    }
    _fermerModale();
  }

  // ---------- Wiring DOM ----------
  btnSearch.addEventListener('click', _lancerRecherche);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); _lancerRecherche(); }
    else if (e.key === 'Escape') { e.preventDefault(); _fermerModale(); }
  });
  if (btnCancel) btnCancel.addEventListener('click', _fermerModale);
  if (btnClose)  btnClose.addEventListener('click', _fermerModale);
  // Clic sur le fond (en dehors du popup) → fermer
  overlay.addEventListener('click', e => {
    if (e.target === overlay) _fermerModale();
  });
  // Esc global tant que la modale est ouverte
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && overlay.classList.contains('visible')) _fermerModale();
  });

  // Changement d'entité ou de champ → réinitialise libellés / placeholder / résultats
  overlay.querySelectorAll('input[name="ms-entity"], input[name="ms-field"]').forEach(r => {
    r.addEventListener('change', () => {
      _majLabelsEtPlaceholder();
      statusEl.textContent = '';
      statusEl.className = 'search-status';
      resultsEl.innerHTML = '';
      resultsEl.classList.remove('visible');
    });
  });

  // Premier rendu des libellés
  _majLabelsEtPlaceholder();
}

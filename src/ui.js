// ============================================================
// NavXpressVFR — ui.js  (version bilingue FR/EN)
// Dépend de i18n.js chargé avant ce fichier
// ============================================================

// Clé API OpenAIP — chargée depuis le fichier de configuration au démarrage
let OPENAIP_API_KEY = '';

let flightPlan = [];
let legAltitudes = []; // Altitude par leg (index 1-based : legAltitudes[i] = altitude du leg i)
let map;
let segmentsCarte = []; // Un L.polyline par leg (remplace flightPathLine unique)
let marqueursCarte = []; // Marqueurs waypoints (cercles orange)
let declinaisonMoyenneGlobale = 0.0;
let activeLegIndex = 1; // Le leg actif (1-based, correspond au numéro affiché)
let insertLegIndex = 0; // Index d'insertion du point tournant (position dans flightPlan)

const ALT_MIN = 500;
const ALT_MAX = 15000;
const ALT_DEFAULT = 3000;
const ALT_STEP = 500;

document.addEventListener('DOMContentLoaded', async () => {
  console.log("UI NavXpressVFR chargée et prête.");

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

  // --- Bouton + Modale : API OpenAIP ---
  const btnApiOpenAIP   = document.getElementById('btn-api-openaip');
  const apiOverlay      = document.getElementById('api-openaip-overlay');
  const apiInput        = document.getElementById('api-openaip-input');
  const apiHint         = document.getElementById('api-openaip-hint');
  const apiTestResult   = document.getElementById('api-test-result');
  const apiError        = document.getElementById('api-openaip-error');
  const btnApiVisibility = document.getElementById('btn-api-toggle-visibility');
  const btnApiTest      = document.getElementById('btn-api-test');
  const btnApiCancel    = document.getElementById('btn-api-cancel');
  const btnApiValidate  = document.getElementById('btn-api-validate');

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

  // --- Initialisation du système i18n ---
  initI18n();

  // --- Bouton toggle FR / EN ---
  const btnLang = document.getElementById('btn-lang-toggle');
  if (btnLang) {
    btnLang.addEventListener('click', () => {
      const newLang = currentLang === 'fr' ? 'en' : 'fr';
      setLanguage(newLang);
      // Redessiner le tableau (les en-têtes sont gérés par applyTranslations,
      // mais les lignes dynamiques doivent être regénérées)
      mettreAJourLogDeNav();
      // Mettre à jour le badge de statut simulateur
      const statusBadge = document.getElementById('sim-status');
      if (statusBadge) statusBadge.textContent = t('simDisconnectedEngine');
      // Mettre à jour la déclinaison dans le titre
      actualiserAffichageDeclinaison();
      // Màj label bouton espaces aériens
      if (window._btnAirspacesLeaflet && !window._btnAirspacesLeaflet.disabled) {
        window._btnAirspacesLeaflet.innerHTML = newLang === 'fr' ? '🛡️ Espaces aériens' : '🛡️ Airspaces';
      }
    });
  }

  // --- 1. Initialisation de la carte Leaflet ---
  try {
    map = L.map('map-container', { zoomControl: true }).setView([46.5, 2.5], 6);

    // --- Couches de fond ---
    const layerSatellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Tiles &copy; Esri',
      maxZoom: 19
    });

    const layerTopo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://opentopomap.org">OpenTopoMap</a>',
      maxZoom: 17
    });

    const layerOSM = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19
    });

    const layers = [
      { key: 'satellite', layer: layerSatellite, label: '🛰️ Satellite', next: '🗺️ Topo' },
      { key: 'topo',      layer: layerTopo,      label: '🗺️ Topo',      next: '🗺️ OSM' },
      { key: 'osm',       layer: layerOSM,       label: '🗺️ OSM',       next: '🛰️ Satellite' },
    ];
    let currentLayerIdx = 2;
    layers[currentLayerIdx].layer.addTo(map);

    // --- Bouton déroulant de changement de fond ---
    const btnLayerToggle = L.control({ position: 'topright' });
    btnLayerToggle.onAdd = function() {
      const wrapper = L.DomUtil.create('div', 'layer-toggle-wrapper');
      L.DomEvent.disableClickPropagation(wrapper);
      L.DomEvent.disableScrollPropagation(wrapper);

      const btn = L.DomUtil.create('button', 'btn-layer-toggle', wrapper);
      btn.innerHTML = '🗺️ OSM ▾';

      const dropdown = L.DomUtil.create('div', 'layer-dropdown', wrapper);
      dropdown.style.display = 'none';

      const options = [
        { key: 'satellite', label: '🛰️ Satellite' },
        { key: 'topo',      label: '🗺️ Topo' },
        { key: 'osm',       label: '🗺️ OSM' },
      ];

      options.forEach(opt => {
        const item = L.DomUtil.create('div', 'layer-dropdown-item', dropdown);
        item.innerHTML = opt.label;
        if (opt.key === 'osm') item.classList.add('active');
        item.addEventListener('click', () => {
          map.removeLayer(layers[currentLayerIdx].layer);
          currentLayerIdx = layers.findIndex(l => l.key === opt.key);
          layers[currentLayerIdx].layer.addTo(map);
          btn.innerHTML = opt.label + ' ▾';
          dropdown.querySelectorAll('.layer-dropdown-item').forEach(el => el.classList.remove('active'));
          item.classList.add('active');
          dropdown.style.display = 'none';
        });
      });

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
      });

      // Fermer si clic ailleurs
      document.addEventListener('click', (e) => {
        if (!wrapper.contains(e.target)) dropdown.style.display = 'none';
      });

      return wrapper;
    };
    btnLayerToggle.addTo(map);

    // --- BOUTON ESPACES AÉRIENS (topleft) — couche TileLayer OpenAIP ---
    // On utilise l'API Tiles d'OpenAIP : couche PNG transparente, complète,
    // aucune limite de pagination. URL recommandée par OpenAIP officiel.
    let airspacesVisible = false;
    let airspaceTileLayer = null;

    function creerCoucheEspacesAeriens() {
      // La clé API est injectée automatiquement par le main process via
      // session.defaultSession.webRequest.onBeforeSendHeaders — pas besoin
      // de l'exposer dans l'URL côté renderer.
      // Subdomains a/b/c confirmés par le forum officiel OpenAIP.
      // Pas de tms:true (tuiles XYZ standard, pas TMS).
      return L.tileLayer(
        'https://{s}.api.tiles.openaip.net/api/data/openaip/{z}/{x}/{y}.png',
        {
          subdomains: ['a', 'b', 'c'],
          attribution: '&copy; <a href="https://www.openaip.net">OpenAIP</a>',
          opacity: 0.85,
          maxZoom: 14,
          minZoom: 4,
          tileSize: 256
        }
      );
    }

    // Contrôle Leaflet — bouton espaces aériens (topleft)
    const btnAirspaces = L.control({ position: 'topleft' });
    btnAirspaces.onAdd = function () {
      const btn = L.DomUtil.create('button', 'btn-airspaces');
      btn.innerHTML = currentLang === 'fr' ? '🛡️ Espaces aériens' : '🛡️ Airspaces';
      btn.title = currentLang === 'fr'
        ? 'Afficher / masquer les espaces aériens'
        : 'Show / hide airspaces';

      L.DomEvent.disableClickPropagation(btn);
      L.DomEvent.on(btn, 'click', () => {
        if (!OPENAIP_API_KEY) {
          alert(t('apiKeyMissing'));
          return;
        }
        if (!airspacesVisible) {
          airspaceTileLayer = creerCoucheEspacesAeriens();
          airspaceTileLayer.addTo(map);
          airspacesVisible = true;
          btn.classList.add('active');
        } else {
          if (airspaceTileLayer) {
            map.removeLayer(airspaceTileLayer);
            airspaceTileLayer = null;
          }
          airspacesVisible = false;
          btn.classList.remove('active');
        }
      });

      // Stocker une référence pour màj de la langue
      window._btnAirspacesLeaflet = btn;
      return btn;
    };
    btnAirspaces.addTo(map);

    console.log("Carte Leaflet initialisée avec succès.");
  } catch (mapError) {
    console.error("Erreur d'initialisation de la carte:", mapError);
  }

  // --- 2. BOUTON : NOUVEAU (reset) ---
  const btnNew = document.getElementById('btn-new-flight');
  const confirmResetOverlay = document.getElementById('confirm-reset-overlay');
  const btnConfirmResetOk = document.getElementById('btn-confirm-reset-ok');
  const btnConfirmResetCancel = document.getElementById('btn-confirm-reset-cancel');

  function doReset() {
    flightPlan = [];
    legAltitudes = [];
    declinaisonMoyenneGlobale = 0.0;
    activeLegIndex = 1;
    document.getElementById('input-icao-dep').value = '';
    document.getElementById('input-icao-arr').value = '';
    marqueursCarte.forEach(m => map.removeLayer(m));
    marqueursCarte = [];
    supprimerSegmentsCarte();
    actualiserAffichageDeclinaison();
    mettreAJourLogDeNav();
  }

  if (btnNew) {
    btnNew.addEventListener('click', () => {
      confirmResetOverlay.style.display = 'flex';
    });
  }

  btnConfirmResetOk.addEventListener('click', () => {
    confirmResetOverlay.style.display = 'none';
    doReset();
  });

  btnConfirmResetCancel.addEventListener('click', () => {
    confirmResetOverlay.style.display = 'none';
  });

  confirmResetOverlay.addEventListener('click', (e) => {
    if (e.target === confirmResetOverlay) confirmResetOverlay.style.display = 'none';
  });

  // --- Modale : confirmation suppression leg — listeners (scope DOMContentLoaded) ---
  document.getElementById('btn-confirm-delete-ok').addEventListener('click', () => {
    document.getElementById('confirm-delete-overlay').style.display = 'none';
    if (window._deleteLegCallback) { window._deleteLegCallback(); window._deleteLegCallback = null; }
  });

  document.getElementById('btn-confirm-delete-cancel').addEventListener('click', () => {
    document.getElementById('confirm-delete-overlay').style.display = 'none';
    window._deleteLegCallback = null;
  });

  document.getElementById('confirm-delete-overlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('confirm-delete-overlay')) {
      document.getElementById('confirm-delete-overlay').style.display = 'none';
      window._deleteLegCallback = null;
    }
  });

  // --- Modale : édition leg — listeners ---
  window._editLegIndex = null;

  document.getElementById('btn-edit-leg-cancel').addEventListener('click', () => {
    document.getElementById('edit-leg-overlay').style.display = 'none';
  });

  document.getElementById('edit-leg-overlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('edit-leg-overlay'))
      document.getElementById('edit-leg-overlay').style.display = 'none';
  });

  document.getElementById('btn-edit-leg-validate').addEventListener('click', () => {
    const legIndex = window._editLegIndex;
    if (legIndex === null) return;
    const errEl = document.getElementById('edit-leg-error');
    errEl.textContent = '';

    // Lire et valider les champs
    function readPoint(nameId, latId, latRadio, lonId, lonRadio) {
      const name = document.getElementById(nameId).value.trim();
      const latRaw = parseFloat(document.getElementById(latId).value);
      const lonRaw = parseFloat(document.getElementById(lonId).value);
      const latDir = document.querySelector(`input[name="${latRadio}"]:checked`)?.value || 'N';
      const lonDir = document.querySelector(`input[name="${lonRadio}"]:checked`)?.value || 'E';
      if (!name || isNaN(latRaw) || isNaN(lonRaw)) return null;
      if (latRaw < 0 || latRaw > 90 || lonRaw < 0 || lonRaw > 180) return null;
      return {
        name, ident: name,
        lat: latDir === 'N' ? latRaw : -latRaw,
        lon: lonDir === 'E' ? lonRaw : -lonRaw
      };
    }

    const newDep = readPoint('edit-leg-dep-name', 'edit-leg-dep-lat', 'edit-dep-lat-dir', 'edit-leg-dep-lon', 'edit-dep-lon-dir');
    const newArr = readPoint('edit-leg-arr-name', 'edit-leg-arr-lat', 'edit-arr-lat-dir', 'edit-leg-arr-lon', 'edit-arr-lon-dir');

    if (!newDep || !newArr) {
      errEl.textContent = t('fillFields');
      return;
    }

    // Appliquer — les deux points sont partagés avec les legs adjacents
    flightPlan[legIndex - 1] = { ...flightPlan[legIndex - 1], ...newDep };
    flightPlan[legIndex]     = { ...flightPlan[legIndex],     ...newArr };

    document.getElementById('edit-leg-overlay').style.display = 'none';

    // Recalculer et redessiner toute la carte
    marqueursCarte.forEach(m => map.removeLayer(m));
    marqueursCarte = [];
    supprimerSegmentsCarte();
    flightPlan.forEach((p, idx) => tracerPointVisuel(p, idx));
    redessinerSegments();
    if (flightPlan.length > 1) {
      const bounds = L.latLngBounds(flightPlan.map(p => [p.lat, p.lon]));
      map.fitBounds(bounds, { padding: [50, 50], animate: false });
    }
    mettreAJourLogDeNav();
  });

  // --- 3. BOUTON : CRÉER PLAN DE VOL ---
  const btnCreate = document.getElementById('btn-create-flight');
  const createOverlay = document.getElementById('create-flight-overlay');
  const btnCreateCancel = document.getElementById('btn-create-cancel');
  const btnCreateValidate = document.getElementById('btn-create-validate');

  if (btnCreate && createOverlay) {
    // Ouvrir la modale
    btnCreate.addEventListener('click', () => {
      document.getElementById('create-icao-dep').value = '';
      document.getElementById('create-lat-dep').value = '';
      document.getElementById('create-lon-dep').value = '';
      document.getElementById('create-icao-arr').value = '';
      document.getElementById('create-lat-arr').value = '';
      document.getElementById('create-lon-arr').value = '';
      document.getElementById('create-flight-error').textContent = '';
      document.getElementById('search-status-dep').textContent = '';
      document.getElementById('search-status-arr').textContent = '';
      document.getElementById('search-status-dep').className = 'search-status';
      document.getElementById('search-status-arr').className = 'search-status';
      createOverlay.classList.add('visible');
    });

    // Fermer sur Annuler
    btnCreateCancel.addEventListener('click', () => {
      createOverlay.classList.remove('visible');
    });

    // Fermer en cliquant sur le fond
    createOverlay.addEventListener('click', (e) => {
      if (e.target === createOverlay) createOverlay.classList.remove('visible');
    });

    // Boutons Rechercher
    const searchDepInput = document.getElementById('create-icao-dep');
    const searchArrInput = document.getElementById('create-icao-arr');

    document.getElementById('btn-search-dep').addEventListener('click', () => {
      rechercherAeroport(
        document.getElementById('create-icao-dep').value,
        document.getElementById('search-status-dep'),
        document.getElementById('create-lat-dep'),
        document.getElementById('create-lon-dep')
      );
    });

    document.getElementById('btn-search-arr').addEventListener('click', () => {
      rechercherAeroport(
        document.getElementById('create-icao-arr').value,
        document.getElementById('search-status-arr'),
        document.getElementById('create-lat-arr'),
        document.getElementById('create-lon-arr')
      );
    });

    // Validation chiffres décimaux uniquement sur les champs coord de la modale création
    ['create-lat-dep', 'create-lon-dep', 'create-lat-arr', 'create-lon-arr'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', () => {
        let v = el.value.replace(/[^0-9.]/g, '');
        const parts = v.split('.');
        if (parts.length > 2) v = parts[0] + '.' + parts.slice(1).join('');
        el.value = v;
      });
    });

    // Valider le plan de vol
    btnCreateValidate.addEventListener('click', async () => {
      const icaoDep = document.getElementById('create-icao-dep').value.trim().toUpperCase();
      const latDepRaw = parseFloat(document.getElementById('create-lat-dep').value);
      const lonDepRaw = parseFloat(document.getElementById('create-lon-dep').value);
      const icaoArr = document.getElementById('create-icao-arr').value.trim().toUpperCase();
      const latArrRaw = parseFloat(document.getElementById('create-lat-arr').value);
      const lonArrRaw = parseFloat(document.getElementById('create-lon-arr').value);
      const errEl = document.getElementById('create-flight-error');

      // Lecture des directions (radios)
      const depLatDir = document.querySelector('input[name="dep-lat-dir"]:checked').value;
      const depLonDir = document.querySelector('input[name="dep-lon-dir"]:checked').value;
      const arrLatDir = document.querySelector('input[name="arr-lat-dir"]:checked').value;
      const arrLonDir = document.querySelector('input[name="arr-lon-dir"]:checked').value;

      // Application du signe selon N/S et E/W
      const latDep = depLatDir === 'S' ? -Math.abs(latDepRaw) : Math.abs(latDepRaw);
      const lonDep = depLonDir === 'W' ? -Math.abs(lonDepRaw) : Math.abs(lonDepRaw);
      const latArr = arrLatDir === 'S' ? -Math.abs(latArrRaw) : Math.abs(latArrRaw);
      const lonArr = arrLonDir === 'W' ? -Math.abs(lonArrRaw) : Math.abs(lonArrRaw);

      // Validation
      if (!icaoDep || !icaoArr) {
        errEl.textContent = currentLang === 'fr' ? 'Veuillez renseigner les codes ICAO.' : 'Please enter ICAO codes.';
        return;
      }
      if (isNaN(latDepRaw) || isNaN(lonDepRaw) || isNaN(latArrRaw) || isNaN(lonArrRaw)) {
        errEl.textContent = currentLang === 'fr' ? 'Veuillez renseigner toutes les coordonnées.' : 'Please fill in all coordinates.';
        return;
      }

      // Réinitialiser le plan
      flightPlan = [];
      legAltitudes = [];
      activeLegIndex = 1;
      marqueursCarte.forEach(m => map.removeLayer(m));
      marqueursCarte = [];
      supprimerSegmentsCarte();

      // Détecter vol local (départ == arrivée) → triangle équilatéral ~10 nm
      const isVolLocal = (icaoDep === icaoArr) ||
        (Math.abs(latDep - latArr) < 0.0001 && Math.abs(lonDep - lonArr) < 0.0001);

      if (isVolLocal) {
        const NM_PAR_DEGRE_LAT = 60.0;
        const coteNM = 10.0;
        const hauteurNM = coteNM * Math.sqrt(3) / 2;
        const demiBaseNM = coteNM / 2;
        const facteurLon = Math.cos(latDep * Math.PI / 180);

        const wp1 = {
          name: 'WP1', ident: 'WP1',
          lat: latDep + (hauteurNM / 3) / NM_PAR_DEGRE_LAT,
          lon: lonDep - demiBaseNM / (NM_PAR_DEGRE_LAT * facteurLon)
        };
        const wp2 = {
          name: 'WP2', ident: 'WP2',
          lat: latDep + (hauteurNM / 3) / NM_PAR_DEGRE_LAT,
          lon: lonDep + demiBaseNM / (NM_PAR_DEGRE_LAT * facteurLon)
        };

        flightPlan.push({ name: icaoDep, ident: icaoDep, lat: latDep, lon: lonDep });
        flightPlan.push(wp1);
        flightPlan.push(wp2);
        flightPlan.push({ name: icaoArr, ident: icaoArr, lat: latArr, lon: lonArr });
        legAltitudes = [undefined, ALT_DEFAULT, ALT_DEFAULT, ALT_DEFAULT];
      } else {
        // Vol normal départ → arrivée
        flightPlan.push({ name: icaoDep, ident: icaoDep, lat: latDep, lon: lonDep });
        flightPlan.push({ name: icaoArr, ident: icaoArr, lat: latArr, lon: lonArr });
        legAltitudes = [undefined, ALT_DEFAULT];
      }

      // Injecter dans les champs ICAO de la config vol
      document.getElementById('input-icao-dep').value = icaoDep;
      document.getElementById('input-icao-arr').value = icaoArr;

      // Tracer sur la carte
      await calculerDeclinaisonCentroide();
      flightPlan.forEach((p, idx) => tracerPointVisuel(p, idx));
      redessinerSegments();
      const bounds = L.latLngBounds(flightPlan.map(p => [p.lat, p.lon]));
      map.fitBounds(bounds, { padding: [50, 50] });

      mettreAJourLogDeNav();

      // Fermer la modale
      createOverlay.classList.remove('visible');
    });
  }

  // --- 4. BOUTON : IMPORTER .LNMPLN ---
  const btnImport = document.getElementById('btn-import-lnm');
  if (btnImport) {
    btnImport.addEventListener('click', async () => {
      console.log("Clic sur Importer LNMPLN");
      const xmlContenu = await window.api.ouvrirLNM();
      if (!xmlContenu) {
        console.log(t('importCancelled'));
        return;
      }

      try {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlContenu, "text/xml");
        const waypointsXML = xmlDoc.getElementsByTagName("Waypoint");

        if (waypointsXML.length === 0) {
          alert(t('noWaypointsInFile'));
          return;
        }

        console.log(`${waypointsXML.length} waypoints détectés dans le XML.`);

        flightPlan = [];
        legAltitudes = [];
        activeLegIndex = 1;
        marqueursCarte.forEach(m => map.removeLayer(m));
        marqueursCarte = [];
        supprimerSegmentsCarte();

        for (let i = 0; i < waypointsXML.length; i++) {
          const wp = waypointsXML[i];
          const ident = wp.getElementsByTagName("Ident")[0]?.textContent || `WP${i}`;
          const name = wp.getElementsByTagName("Name")[0]?.textContent || ident;
          const pos = wp.getElementsByTagName("Pos")[0];

          if (pos) {
            const lat = parseFloat(pos.getAttribute("Lat"));
            const lon = parseFloat(pos.getAttribute("Lon"));
            if (!isNaN(lat) && !isNaN(lon)) {
              flightPlan.push({ name, ident, lat, lon });
            }
          }
        }

        console.log("Plan de vol extrait en mémoire:", flightPlan);

        // Initialiser les altitudes à ALT_DEFAULT pour chaque leg importé
        legAltitudes = [undefined]; // index 0 inutilisé
        for (let i = 1; i < flightPlan.length; i++) legAltitudes.push(ALT_DEFAULT);

        // Injection des ICAO départ / arrivée dans la config vol
        if (flightPlan.length >= 1) {
          const inputDep = document.getElementById('input-icao-dep');
          const inputArr = document.getElementById('input-icao-arr');
          if (inputDep) inputDep.value = flightPlan[0].ident;
          if (inputArr) inputArr.value = flightPlan[flightPlan.length - 1].ident;
        }

        await calculerDeclinaisonCentroide();
        flightPlan.forEach((p, idx) => tracerPointVisuel(p, idx));
        redessinerSegments();

        if (flightPlan.length > 0) {
          const bounds = L.latLngBounds(flightPlan.map(p => [p.lat, p.lon]));
          map.fitBounds(bounds, { padding: [50, 50] });
        }

        mettreAJourLogDeNav();

      } catch (error) {
        console.error("Erreur lors de l'analyse du plan de vol:", error);
        alert(t('parseError') + error.message);
      }
    });
  }

  // --- 4. BOUTON : SAUVEGARDER ---
  const btnSave = document.getElementById('btn-save-flight');
  if (btnSave) {
    btnSave.addEventListener('click', async () => {
      if (flightPlan.length === 0) {
        alert(t('nothingToSave'));
        return;
      }

      let xmlString = `<?xml version="1.0" encoding="UTF-8"?>\n<LittleNavmap>\n  <Flightplan>\n    <Waypoints>\n`;
      flightPlan.forEach(wp => {
        xmlString += `      <Waypoint>\n        <Name>${wp.name}</Name>\n        <Ident>${wp.name}</Ident>\n        <Pos Lon="${wp.lon.toFixed(6)}" Lat="${wp.lat.toFixed(6)}"/>\n      </Waypoint>\n`;
      });
      xmlString += `    </Waypoints>\n  </Flightplan>\n</LittleNavmap>`;

      const reussite = await window.api.sauvegarderPlan(xmlString);
      if (reussite) alert(t('saveSuccess'));
    });
  }

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
  const statusBadge = document.getElementById('sim-status');
  if (statusBadge) {
    statusBadge.textContent = t('simDisconnectedEngine');
    statusBadge.style.backgroundColor = "#e65100";
  }

  // --- 8. MODALE : INSÉRER UN POINT TOURNANT ---
  const insertOverlay = document.getElementById('insert-wp-overlay');
  const btnInsertCancel = document.getElementById('btn-insert-wp-cancel');
  const btnInsertValidate = document.getElementById('btn-insert-wp-validate');

  if (insertOverlay) {
    // Fermer sur Annuler
    btnInsertCancel.addEventListener('click', () => insertOverlay.classList.remove('visible'));

    // Fermer en cliquant sur le fond
    insertOverlay.addEventListener('click', (e) => {
      if (e.target === insertOverlay) insertOverlay.classList.remove('visible');
    });

    // Validation du nom à la frappe : lettres, chiffres, - et apostrophe uniquement
    const inputNom = document.getElementById('insert-wp-icao');
    inputNom.addEventListener('input', () => {
      inputNom.value = inputNom.value.replace(/[^a-zA-Z0-9\-']/g, '');
    });

    // Validation des coords à la frappe : chiffres et point décimal uniquement
    ['insert-wp-lat', 'insert-wp-lon'].forEach(id => {
      const el = document.getElementById(id);
      el.addEventListener('input', () => {
        // Garder uniquement chiffres et un seul point décimal
        let v = el.value.replace(/[^0-9.]/g, '');
        const parts = v.split('.');
        if (parts.length > 2) v = parts[0] + '.' + parts.slice(1).join('');
        el.value = v;
      });
    });

    // Recherche OpenAIP pour le point tournant (bouton)
    document.getElementById('btn-search-wp').addEventListener('click', () => {
      rechercherAeroport(
        document.getElementById('insert-wp-icao').value,
        document.getElementById('search-status-wp'),
        document.getElementById('insert-wp-lat'),
        document.getElementById('insert-wp-lon')
      );
    });

    // Valider l'insertion
    btnInsertValidate.addEventListener('click', async () => {
      const name = document.getElementById('insert-wp-icao').value.trim();
      const latDir = document.querySelector('input[name="lat-dir"]:checked').value;
      const lonDir = document.querySelector('input[name="lon-dir"]:checked').value;
      const latRaw = parseFloat(document.getElementById('insert-wp-lat').value);
      const lonRaw = parseFloat(document.getElementById('insert-wp-lon').value);
      const errEl = document.getElementById('insert-wp-error');

      if (!name) {
        errEl.textContent = currentLang === 'fr' ? 'Veuillez renseigner un identifiant.' : 'Please enter an identifier.';
        return;
      }
      if (isNaN(latRaw) || isNaN(lonRaw)) {
        errEl.textContent = currentLang === 'fr' ? 'Veuillez renseigner les coordonnées.' : 'Please fill in the coordinates.';
        return;
      }

      // Appliquer le signe selon N/S et E/W
      const lat = latDir === 'S' ? -Math.abs(latRaw) : Math.abs(latRaw);
      const lon = lonDir === 'W' ? -Math.abs(lonRaw) : Math.abs(lonRaw);

      const nouveauPoint = { name, ident: name, lat, lon };
      flightPlan.splice(insertLegIndex, 0, nouveauPoint);

      // Insérer une altitude par défaut pour le nouveau leg à insertLegIndex
      // Le nouveau leg prend l'altitude du leg suivant (ou ALT_DEFAULT si absent)
      const altVoisin = legAltitudes[insertLegIndex] ?? ALT_DEFAULT;
      legAltitudes.splice(insertLegIndex, 0, altVoisin);

      // Si le leg actif est >= insertLegIndex, le décaler d'un cran
      if (activeLegIndex >= insertLegIndex) activeLegIndex++;

      // Redessiner la carte complètement
      marqueursCarte.forEach(m => map.removeLayer(m));
      marqueursCarte = [];
      supprimerSegmentsCarte();
      await calculerDeclinaisonCentroide();
      flightPlan.forEach((p, idx) => tracerPointVisuel(p, idx));
      redessinerSegments();
      const bounds = L.latLngBounds(flightPlan.map(p => [p.lat, p.lon]));
      map.fitBounds(bounds, { padding: [50, 50] });

      mettreAJourLogDeNav();
      insertOverlay.classList.remove('visible');
    });
  }

  // --- 9. MODALE : ALTITUDE ---
  const altOverlay = document.getElementById('alt-overlay');
  const altInput = document.getElementById('alt-input');
  const altLegNum = document.getElementById('alt-leg-num');
  const altError = document.getElementById('alt-error');
  let altEditingLegIndex = 0; // index 1-based du leg en cours d'édition

  document.getElementById('btn-alt-cancel').addEventListener('click', () => {
    altOverlay.classList.remove('visible');
  });

  altOverlay.addEventListener('click', (e) => {
    if (e.target === altOverlay) altOverlay.classList.remove('visible');
  });

  document.getElementById('btn-alt-minus').addEventListener('click', () => {
    const val = parseInt(altInput.value) || ALT_DEFAULT;
    const newVal = Math.max(ALT_MIN, val - ALT_STEP);
    altInput.value = newVal;
    altError.textContent = '';
  });

  document.getElementById('btn-alt-plus').addEventListener('click', () => {
    const val = parseInt(altInput.value) || ALT_DEFAULT;
    const newVal = Math.min(ALT_MAX, val + ALT_STEP);
    altInput.value = newVal;
    altError.textContent = '';
  });

  // Validation saisie manuelle : chiffres uniquement
  altInput.addEventListener('input', () => {
    altInput.value = altInput.value.replace(/[^0-9]/g, '');
    altError.textContent = '';
  });

  document.getElementById('btn-alt-validate').addEventListener('click', () => {
    const val = parseInt(altInput.value);
    if (isNaN(val) || val < ALT_MIN || val > ALT_MAX) {
      altError.textContent = currentLang === 'fr'
        ? `Altitude entre ${ALT_MIN} et ${ALT_MAX} ft.`
        : `Altitude between ${ALT_MIN} and ${ALT_MAX} ft.`;
      return;
    }
    legAltitudes[altEditingLegIndex] = val;
    altOverlay.classList.remove('visible');
    mettreAJourLogDeNav();
  });


  // --- 10. MODALE : CONFIRMATION WAYPOINT (scission / déplacement) ---
  const wpConfirmOverlay = document.getElementById('wp-confirm-overlay');

  document.getElementById('btn-wp-confirm-cancel').addEventListener('click', () => {
    wpConfirmOverlay.classList.remove('visible');
    // Nettoyer le marqueur temporaire si présent
    if (marqueurTemporaire) {
      map.removeLayer(marqueurTemporaire);
      marqueurTemporaire = null;
    }
    _confirmCallback = null;
  });

  wpConfirmOverlay.addEventListener('click', (e) => {
    if (e.target === wpConfirmOverlay) {
      document.getElementById('btn-wp-confirm-cancel').click();
    }
  });

  document.getElementById('btn-wp-confirm-validate').addEventListener('click', () => {
    if (_confirmCallback) _confirmCallback();
  });

  // Valider avec Entrée sur le champ nom
  document.getElementById('wp-confirm-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('btn-wp-confirm-validate').click();
  });

  // Fonction appelée depuis mettreAJourLogDeNav pour ouvrir la modale
  window.ouvrirModaleAltitude = (legIndex) => {
    altEditingLegIndex = legIndex;
    altLegNum.textContent = legIndex;
    altInput.value = legAltitudes[legIndex] ?? ALT_DEFAULT;
    altError.textContent = '';
    altOverlay.classList.add('visible');
    setTimeout(() => altInput.select(), 50);
  };

});

// -------------------------------------------------------
// Recherche OpenAIP — fonction globale (utilisée par toutes les modales)
// -------------------------------------------------------
async function rechercherAeroport(icao, statusEl, latEl, lonEl) {
  const code = icao.trim().toUpperCase();
  if (!code) return;

  // Clé absente → message dans le statut, on laisse la main à l'utilisateur
  if (!OPENAIP_API_KEY) {
    statusEl.className = 'search-status error';
    statusEl.textContent = t('apiKeyMissing');
    return;
  }

  statusEl.className = 'search-status';
  statusEl.textContent = t('searchSearching');

  try {
    const url = `https://api.core.openaip.net/api/airports?icaoCode=${code}&page=1&limit=1`;
    const resp = await fetch(url, {
      headers: { 'x-openaip-api-key': OPENAIP_API_KEY }
    });

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();

    if (!data.items || data.items.length === 0) {
      statusEl.className = 'search-status error';
      statusEl.textContent = t('searchNotFound');
      return;
    }

    const airport = data.items[0];
    const lat = airport.geometry?.coordinates?.[1];
    const lon = airport.geometry?.coordinates?.[0];
    const name = airport.name || code;

    if (lat !== undefined && lon !== undefined) {
      // Injection des coordonnées (valeur absolue — les radios N/S/E/W gèrent le signe)
      latEl.value = Math.abs(lat).toFixed(6);
      lonEl.value = Math.abs(lon).toFixed(6);

      // Mettre à jour les radios N/S et E/W si présentes dans le même formulaire
      const latRadioName = latEl.closest('form, div')
        ?.querySelector('input[type="radio"][value="N"], input[type="radio"][value="S"]')
        ?.name;
      const lonRadioName = lonEl.closest('form, div')
        ?.querySelector('input[type="radio"][value="E"], input[type="radio"][value="W"]')
        ?.name;

      if (latRadioName) {
        const latDir = lat >= 0 ? 'N' : 'S';
        document.querySelector(`input[name="${latRadioName}"][value="${latDir}"]`).checked = true;
      }
      if (lonRadioName) {
        const lonDir = lon >= 0 ? 'E' : 'W';
        document.querySelector(`input[name="${lonRadioName}"][value="${lonDir}"]`).checked = true;
      }

      statusEl.className = 'search-status ok';
      statusEl.textContent = name;
    } else {
      statusEl.className = 'search-status error';
      statusEl.textContent = t('searchCoordsNotFound');
    }
  } catch (err) {
    statusEl.className = 'search-status error';
    statusEl.textContent = t('searchNetworkError');
    console.error('OpenAIP error:', err);
  }
}

// -------------------------------------------------------
// Calcule le prochain nom WP disponible (WP1, WP2, ...)
// -------------------------------------------------------
function prochainNomWP() {
  const nums = flightPlan
    .map(p => p.name)
    .filter(n => /^WP\d+$/i.test(n))
    .map(n => parseInt(n.replace(/^WP/i, ''), 10));
  const max = nums.length > 0 ? Math.max(...nums) : 0;
  return `WP${max + 1}`;
}

// -------------------------------------------------------
// Supprime tous les segments de route de la carte
// -------------------------------------------------------
function supprimerSegmentsCarte() {
  segmentsCarte.forEach(seg => map.removeLayer(seg));
  segmentsCarte = [];
}

// -------------------------------------------------------
// Redessine tous les segments de route (un polyline par leg)
// avec interactivité clic → scission
// -------------------------------------------------------
function redessinerSegments() {
  supprimerSegmentsCarte();
  if (flightPlan.length < 2) return;

  for (let i = 1; i < flightPlan.length; i++) {
    const ptA = flightPlan[i - 1];
    const ptB = flightPlan[i];
    const legIndex = i;

    const seg = L.polyline(
      [[ptA.lat, ptA.lon], [ptB.lat, ptB.lon]],
      { color: '#ff1744', weight: 3, opacity: 0.6 }
    ).addTo(map);

    // Curseur main + survol
    seg.on('mouseover', () => {
      seg.setStyle({ weight: 3, color: '#ff6d00' });
      map.getContainer().style.cursor = 'crosshair';
    });
    seg.on('mouseout', () => {
      seg.setStyle({ weight: 3, color: '#ff1744' });
      map.getContainer().style.cursor = '';
    });

    // Mousedown sur le segment → démarrage drag immédiat
    seg.on('mousedown', (e) => {
      L.DomEvent.stopPropagation(e);
      L.DomEvent.preventDefault(e);
      initierDragScission(e.latlng, legIndex, e.originalEvent);
    });

    segmentsCarte.push(seg);
  }
}

// -------------------------------------------------------
// Scission : crée un marqueur draggable temporaire
// -------------------------------------------------------
let marqueurTemporaire = null; // Marqueur en cours de drag

function initierDragScission(latlng, legIndex, originalMouseEvent) {
  // Supprimer un éventuel marqueur temporaire précédent
  if (marqueurTemporaire) {
    map.removeLayer(marqueurTemporaire);
    marqueurTemporaire = null;
  }

  // Désactiver le drag de la carte pendant notre drag
  map.dragging.disable();

  // Créer le marqueur à la position du clic
  marqueurTemporaire = L.marker(latlng, {
    draggable: false, // on gère le drag manuellement via les events DOM
    icon: L.divIcon({
      className: '',
      html: '<div style="width:14px;height:14px;background:#00bcd4;border:2px solid #fff;border-radius:50%;box-shadow:0 0 6px rgba(0,188,212,0.8);"></div>',
      iconSize: [14, 14],
      iconAnchor: [7, 7]
    })
  }).addTo(map);

  map.getContainer().style.cursor = 'grabbing';

  // Suivi du drag via les événements DOM natifs sur le container de la carte
  function onMouseMove(e) {
    const containerRect = map.getContainer().getBoundingClientRect();
    const point = L.point(e.clientX - containerRect.left, e.clientY - containerRect.top);
    const newLatLng = map.containerPointToLatLng(point);
    marqueurTemporaire.setLatLng(newLatLng);
  }

  function onMouseUp(e) {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);

    map.dragging.enable();
    map.getContainer().style.cursor = '';

    const pos = marqueurTemporaire.getLatLng();
    ouvrirModaleConfirmation(pos, legIndex, null);
  }

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
}

// -------------------------------------------------------
// Rendu visuel d'un point sur la carte (avec drag si ni départ ni arrivée)
// -------------------------------------------------------
function tracerPointVisuel(point, indexDansFlightPlan) {
  if (!map) return;

  const isDraggable = indexDansFlightPlan !== undefined
    && indexDansFlightPlan > 0
    && indexDansFlightPlan < flightPlan.length - 1;

  const stylePointVFR = {
    radius: isDraggable ? 7 : 5,
    fillColor: isDraggable ? "#ff7043" : "#888",
    color: "#ffffff",
    weight: isDraggable ? 2 : 1.5,
    opacity: 1,
    fillOpacity: 0.9
  };

  const marqueur = L.circleMarker([point.lat, point.lon], stylePointVFR)
    .addTo(map)
    .bindPopup(`<b>${point.name}</b>`);

  if (isDraggable) {
    marqueur.on('mouseover', () => {
      map.getContainer().style.cursor = 'grab';
    });
    marqueur.on('mouseout', () => {
      map.getContainer().style.cursor = '';
    });

    // Mousedown → drag DOM natif immédiat, sans créer d'étape intermédiaire
    marqueur.on('mousedown', (e) => {
      L.DomEvent.stopPropagation(e);
      L.DomEvent.preventDefault(e);

      map.dragging.disable();
      map.getContainer().style.cursor = 'grabbing';
      marqueur.setStyle({ opacity: 0.4, fillOpacity: 0.4 });

      function onMouseMove(ev) {
        const containerRect = map.getContainer().getBoundingClientRect();
        const pt = L.point(ev.clientX - containerRect.left, ev.clientY - containerRect.top);
        const newLatLng = map.containerPointToLatLng(pt);
        marqueur.setLatLng(newLatLng);
      }

      function onMouseUp(ev) {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);

        map.dragging.enable();
        map.getContainer().style.cursor = '';
        marqueur.setStyle({ opacity: 1, fillOpacity: 0.9 });

        const pos = marqueur.getLatLng();
        ouvrirModaleConfirmation(pos, null, indexDansFlightPlan);
      }

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  }

  marqueursCarte.push(marqueur);
}

// -------------------------------------------------------
// Modale de confirmation (scission ou déplacement)
// insertLeg   : index du leg scindé (scission), ou null si déplacement
// moveIndex   : index dans flightPlan du point déplacé, ou null si scission
// -------------------------------------------------------
let _confirmCallback = null;

function ouvrirModaleConfirmation(latlng, insertLeg, moveIndex) {
  const overlay = document.getElementById('wp-confirm-overlay');
  const titleEl = document.getElementById('wp-confirm-title');
  const nameInput = document.getElementById('wp-confirm-name');
  const latEl = document.getElementById('wp-confirm-lat');
  const lonEl = document.getElementById('wp-confirm-lon');
  const errEl = document.getElementById('wp-confirm-error');

  // Titre selon le contexte
  if (moveIndex !== null) {
    titleEl.textContent = currentLang === 'fr'
      ? `Déplacer ${flightPlan[moveIndex].name}`
      : `Move ${flightPlan[moveIndex].name}`;
    nameInput.value = flightPlan[moveIndex].name;
  } else {
    titleEl.textContent = currentLang === 'fr' ? 'Nouveau point de report' : 'New waypoint';
    nameInput.value = prochainNomWP();
  }

  latEl.value = latlng.lat.toFixed(6);
  lonEl.value = latlng.lng.toFixed(6);
  errEl.textContent = '';

  overlay.classList.add('visible');
  setTimeout(() => nameInput.focus(), 50);

  // Stocker le callback selon le mode
  _confirmCallback = async () => {
    const name = nameInput.value.trim();
    if (!name) {
      errEl.textContent = currentLang === 'fr' ? 'Veuillez renseigner un identifiant.' : 'Please enter an identifier.';
      return;
    }

    overlay.classList.remove('visible');

    if (moveIndex !== null) {
      // Déplacement : mise à jour des coordonnées du point existant
      flightPlan[moveIndex].lat = latlng.lat;
      flightPlan[moveIndex].lon = latlng.lng;
      flightPlan[moveIndex].name = name;
      flightPlan[moveIndex].ident = name;
    } else {
      // Scission : insertion du nouveau point dans le plan
      const nouveauPoint = { name, ident: name, lat: latlng.lat, lon: latlng.lng };
      flightPlan.splice(insertLeg, 0, nouveauPoint);
      const altVoisin = legAltitudes[insertLeg] ?? ALT_DEFAULT;
      legAltitudes.splice(insertLeg, 0, altVoisin);
      if (activeLegIndex >= insertLeg) activeLegIndex++;
    }

    // Nettoyer le marqueur temporaire si présent
    if (marqueurTemporaire) {
      map.removeLayer(marqueurTemporaire);
      marqueurTemporaire = null;
    }

    // Redessiner carte complète
    marqueursCarte.forEach(m => map.removeLayer(m));
    marqueursCarte = [];
    supprimerSegmentsCarte();
    await calculerDeclinaisonCentroide();
    flightPlan.forEach((p, idx) => tracerPointVisuel(p, idx));
    redessinerSegments();
    const bounds = L.latLngBounds(flightPlan.map(p => [p.lat, p.lon]));
    map.fitBounds(bounds, { padding: [50, 50] });
    mettreAJourLogDeNav();
  };
}

// -------------------------------------------------------
// Calcul de la déclinaison magnétique au centroïde
// -------------------------------------------------------
async function calculerDeclinaisonCentroide() {
  if (flightPlan.length === 0) {
    declinaisonMoyenneGlobale = 0.0;
    actualiserAffichageDeclinaison();
    return;
  }

  let sommeLat = 0;
  let sommeLon = 0;
  flightPlan.forEach(p => { sommeLat += p.lat; sommeLon += p.lon; });

  const latCentroide = sommeLat / flightPlan.length;
  const lonCentroide = sommeLon / flightPlan.length;

  try {
    console.log(`Calcul de la déclinaison au centroïde : Lat ${latCentroide.toFixed(4)} / Lon ${lonCentroide.toFixed(4)}`);
    const resDecl = await window.api.calculerDeclinaison(latCentroide, lonCentroide, 3000);

    if (resDecl && resDecl.valeur) {
      let valDecl = parseFloat(resDecl.valeur);
      if (resDecl.direction === "O" || resDecl.direction === "W") {
        valDecl = -valDecl;
      }
      declinaisonMoyenneGlobale = valDecl;
      console.log(`🧭 Déclinaison magnétique moyenne : ${declinaisonMoyenneGlobale.toFixed(2)}°`);
    } else {
      console.warn("Résultat déclinaison invalide, repli sur 0.0°");
      declinaisonMoyenneGlobale = 0.0;
    }
  } catch (err) {
    console.error("Erreur déclinaison centroïde :", err);
    declinaisonMoyenneGlobale = 0.0;
  }

  actualiserAffichageDeclinaison();
}

// -------------------------------------------------------
// Modale édition leg (scope global — appelée depuis mettreAJourLogDeNav)
// -------------------------------------------------------
function ouvrirModaleEditLeg(legIndex) {
  const ptA = flightPlan[legIndex - 1];
  const ptB = flightPlan[legIndex];

  // Remplir le sous-titre
  document.getElementById('edit-leg-subtitle').textContent =
    TRANSLATIONS[currentLang].editLegSubtitle(legIndex);

  // Helper : valeur absolue + direction radio
  function fillCoord(latId, latRadioName, lonId, lonRadioName, pt) {
    document.getElementById(latId).value = Math.abs(pt.lat).toFixed(6);
    document.getElementById(lonId).value = Math.abs(pt.lon).toFixed(6);
    document.querySelectorAll(`input[name="${latRadioName}"]`).forEach(r => {
      r.checked = (r.value === (pt.lat >= 0 ? 'N' : 'S'));
    });
    document.querySelectorAll(`input[name="${lonRadioName}"]`).forEach(r => {
      r.checked = (r.value === (pt.lon >= 0 ? 'E' : 'W'));
    });
  }

  document.getElementById('edit-leg-dep-name').value = ptA.name;
  fillCoord('edit-leg-dep-lat', 'edit-dep-lat-dir', 'edit-leg-dep-lon', 'edit-dep-lon-dir', ptA);

  document.getElementById('edit-leg-arr-name').value = ptB.name;
  fillCoord('edit-leg-arr-lat', 'edit-arr-lat-dir', 'edit-leg-arr-lon', 'edit-arr-lon-dir', ptB);

  document.getElementById('edit-leg-error').textContent = '';

  // Stocker l'index courant pour la validation
  window._editLegIndex = legIndex;
  document.getElementById('edit-leg-overlay').style.display = 'flex';
}

// -------------------------------------------------------
// Modale suppression leg (scope global — appelée depuis mettreAJourLogDeNav)
// -------------------------------------------------------
window._deleteLegCallback = null;

function ouvrirModaleDeleteLeg(legIndex) {
  const ptA = flightPlan[legIndex - 1];
  const ptB = flightPlan[legIndex];
  const msg = TRANSLATIONS[currentLang].deleteLegMsg(ptA.name, ptB.name);
  document.getElementById('confirm-delete-msg').textContent = msg;
  window._deleteLegCallback = () => {
    flightPlan.splice(legIndex, 1);
    legAltitudes.splice(legIndex, 1);
    if (activeLegIndex > flightPlan.length - 1) activeLegIndex = Math.max(1, flightPlan.length - 1);
    marqueursCarte.forEach(m => map.removeLayer(m));
    marqueursCarte = [];
    supprimerSegmentsCarte();
    flightPlan.forEach((p, idx) => tracerPointVisuel(p, idx));
    redessinerSegments();
    if (flightPlan.length > 1) {
      const bounds = L.latLngBounds(flightPlan.map(p => [p.lat, p.lon]));
      map.fitBounds(bounds, { padding: [50, 50], animate: false });
    }
    mettreAJourLogDeNav();
  };
  document.getElementById('confirm-delete-overlay').style.display = 'flex';
}

// -------------------------------------------------------
// Affichage de la déclinaison dans le titre
// -------------------------------------------------------
function actualiserAffichageDeclinaison() {
  const dirStr = declinaisonMoyenneGlobale >= 0 ? t('declEast') : t('declWest');
  const absVal = Math.abs(declinaisonMoyenneGlobale).toFixed(1);

  // Injection dans le champ dédié de la config vol
  const inputDecl = document.getElementById('input-decl-mag');
  if (inputDecl) {
    inputDecl.value = `${absVal}° ${dirStr}`;
  }

  // Mise à jour du titre avec la déclinaison
  const titleElem = document.getElementById('app-title');
  if (!titleElem) return;
  titleElem.innerHTML = `NavXpressVFR <span style="font-size: 13px; color: #888; font-weight: normal; margin-left: 10px;">(D: ${absVal}° ${dirStr})</span>`;
}

// -------------------------------------------------------
// Redessine le tableau de navigation (legs)
// -------------------------------------------------------
function mettreAJourLogDeNav() {
  const tbody = document.getElementById('nav-log-body');
  if (!tbody) return;

  tbody.innerHTML = '';

  if (flightPlan.length === 0) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="12">${t('emptyPlan')}</td></tr>`;
    return;
  }

  const vp = parseFloat(document.getElementById('input-vp').value) || 90;
  const dirVent = parseFloat(document.getElementById('input-wind-dir').value) || 0;
  const vitVent = parseFloat(document.getElementById('input-wind-speed').value) || 0;

  // Cas : un seul point (départ uniquement)
  if (flightPlan.length === 1) {
    tbody.innerHTML = `
      <tr>
        <td>-</td>
        <td>${t('departure')}</td>
        <td>${flightPlan[0].name}</td>
        <td>-</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td>
        <td><input type="checkbox" disabled></td>
      </tr>`;
    return;
  }

  // Boucle sur les legs
  for (let i = 1; i < flightPlan.length; i++) {
    const ptA = flightPlan[i - 1];
    const ptB = flightPlan[i];

    // 1. Distance (Haversine → NM)
    const R = 3440.065;
    const dLat = ((ptB.lat - ptA.lat) * Math.PI) / 180;
    const dLon = ((ptB.lon - ptA.lon) * Math.PI) / 180;
    const lat1Rad = (ptA.lat * Math.PI) / 180;
    const lat2Rad = (ptB.lat * Math.PI) / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1Rad) * Math.cos(lat2Rad);
    const distanceNM = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    // 2. Route vraie (Rv)
    const y = Math.sin(dLon) * Math.cos(lat2Rad);
    const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);
    let rvDeg = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;

    // 3. Triangle des vitesses (dérive + GS)
    const alphaRad = ((dirVent - rvDeg) * Math.PI) / 180;
    let deriveDeg = 0;
    if (vp > 0) {
      const sinX = (vitVent * Math.sin(alphaRad)) / vp;
      if (Math.abs(sinX) <= 1) deriveDeg = (Math.asin(sinX) * 180) / Math.PI;
    }
    const deriveRad = (deriveDeg * Math.PI) / 180;
    let gs = vp * Math.cos(deriveRad) - vitVent * Math.cos(alphaRad);
    if (gs < 0) gs = 0;

    // 4. Durée
    let tempsFormate = "--:--";
    if (gs > 0) {
      const totalSec = Math.round((distanceNM / gs) * 3600);
      const mm = Math.floor(totalSec / 60).toString().padStart(2, '0');
      const ss = (totalSec % 60).toString().padStart(2, '0');
      tempsFormate = `${mm}:${ss}`;
    }

    // 5. Cap magnétique
    const capMagDeg = (rvDeg + deriveDeg - declinaisonMoyenneGlobale + 360) % 360;

    // 6. Détermination de l'état du leg
    const isDone = i < activeLegIndex;   // legs au-dessus du leg actif = terminés
    const isActive = i === activeLegIndex; // leg actif courant

    // 6b. Altitude du leg
    const altLeg = legAltitudes[i] ?? ALT_DEFAULT;

    // 7. Injection dans le tableau
    const row = document.createElement('tr');
    row.dataset.legIndex = i;

    // Construire le HTML d'abord
    row.innerHTML = `
      <td><b>${i}</b></td>
      <td>${ptA.name}</td>
      <td></td>
      <td>${ptB.name}</td>
      <td><span class="alt-val">${altLeg}</span> <button class="btn-edit-alt" onclick="window.ouvrirModaleAltitude(${i})" title="${currentLang === 'fr' ? 'Modifier l\'altitude' : 'Edit altitude'}">✏️</button></td>
      <td>${distanceNM.toFixed(1)}</td>
      <td>${Math.round(rvDeg).toString().padStart(3, '0')}°</td>
      <td>${Math.round(capMagDeg).toString().padStart(3, '0')}°</td>
      <td>${Math.round(gs)}</td>
      <td>${tempsFormate}</td>
      <td></td>
      <td></td>
    `;

    // Appliquer le style sur chaque td APRÈS innerHTML pour surpasser td { color } de styles.css
    if (isDone) {
      row.querySelectorAll('td').forEach(td => td.style.color = '#5d5d5d');
    } else if (isActive) {
      row.style.backgroundColor = '#4088DC';
      row.style.fontWeight = 'bold';
      row.querySelectorAll('td').forEach(td => td.style.color = '#ffff00');
    }

    // Bouton + dans la 3ème cellule (entre Depuis et Vers)
    const btnPlus = document.createElement('button');
    btnPlus.className = 'btn-insert-wp';
    btnPlus.textContent = '+';
    btnPlus.title = currentLang === 'fr' ? 'Insérer un point tournant' : 'Insert a waypoint';
    btnPlus.addEventListener('click', () => {
      // i = numéro du leg (1-based), l'insertion se fait à l'index i dans flightPlan
      // (entre flightPlan[i-1] et flightPlan[i])
      insertLegIndex = i;
      const nomWP = prochainNomWP();
      document.getElementById('insert-wp-icao').value = nomWP;
      document.getElementById('insert-wp-lat').value = '';
      document.getElementById('insert-wp-lon').value = '';
      document.getElementById('insert-wp-error').textContent = '';
      document.getElementById('search-status-wp').textContent = '';
      document.getElementById('search-status-wp').className = 'search-status';
      const subtitle = document.getElementById('insert-wp-subtitle');
      subtitle.textContent = currentLang === 'fr'
        ? `Insertion entre ${ptA.name} et ${ptB.name}`
        : `Inserting between ${ptA.name} and ${ptB.name}`;
      document.getElementById('insert-wp-overlay').classList.add('visible');
    });
    row.querySelectorAll('td')[2].appendChild(btnPlus);

    // Créer et insérer la checkbox
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = isDone;
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        activeLegIndex = i + 1;
      } else {
        activeLegIndex = i;
      }
      mettreAJourLogDeNav();
    });
    row.querySelector('td:nth-last-child(2)').appendChild(checkbox);

    // Bouton éditer leg — désactivé si le leg touche un aéroport fixe (1er ou dernier point)
    const toucheAeroport = (i === 1) || (i === flightPlan.length - 1);
    const btnEdit = document.createElement('button');
    btnEdit.className = 'btn-edit-leg';
    btnEdit.textContent = '✏️';
    btnEdit.title = currentLang === 'fr' ? 'Éditer ce leg' : 'Edit this leg';
    btnEdit.disabled = toucheAeroport;
    btnEdit.addEventListener('click', () => ouvrirModaleEditLeg(i));
    row.querySelector('td:last-child').appendChild(btnEdit);

    // Bouton supprimer leg — désactivé s'il ne reste que 2 points
    const canDelete = flightPlan.length > 2;
    const btnDelete = document.createElement('button');
    btnDelete.className = 'btn-delete-leg';
    btnDelete.textContent = '🗑️';
    btnDelete.title = currentLang === 'fr' ? 'Supprimer ce leg' : 'Delete this leg';
    btnDelete.disabled = !canDelete;
    btnDelete.addEventListener('click', () => ouvrirModaleDeleteLeg(i));
    row.querySelector('td:last-child').appendChild(btnDelete);

    tbody.appendChild(row);
  }
}

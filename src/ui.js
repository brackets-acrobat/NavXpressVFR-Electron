// ============================================================
// NavXpressVFR — ui.js  (version bilingue FR/EN)
// Dépend de i18n.js et de src/js/*.js chargés AVANT ce fichier.
// Ne contient plus que le grand bloc DOMContentLoaded (init + câblage).
// Les fonctions globales ont été extraites vers src/js/ (Phase 1).
// ============================================================

document.addEventListener('DOMContentLoaded', async () => {
  console.log("UI NavXpressVFR chargée et prête.");

  await chargerCleOpenAIP();

  initOpenAIP();

  initImports();

  initTimers();

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
      // Mettre à jour le badge de statut simulateur (réapplique le texte dans la nouvelle langue)
      appliquerEtatSim(_simState);
      // Mettre à jour la déclinaison dans le titre
      actualiserAffichageDeclinaison();
      // Régénérer le dropdown des calques (libellés des toggles)
      if (typeof window._refreshLayersDropdown === 'function') window._refreshLayersDropdown();
      // Régénérer les tooltips aéroports (langue dans "Piste / Runway")
      if (typeof window._refreshAirports === 'function') window._refreshAirports();
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
      { key: 'topo', layer: layerTopo, label: '🗺️ Topo', next: '🗺️ OSM' },
      { key: 'osm', layer: layerOSM, label: '🗺️ OSM', next: '🛰️ Satellite' },
    ];
    let currentLayerIdx = 2;
    layers[currentLayerIdx].layer.addTo(map);

    // --- Bouton déroulant de changement de fond ---
    const btnLayerToggle = L.control({ position: 'topright' });
    btnLayerToggle.onAdd = function () {
      const wrapper = L.DomUtil.create('div', 'layer-toggle-wrapper');
      L.DomEvent.disableClickPropagation(wrapper);
      L.DomEvent.disableScrollPropagation(wrapper);

      const btn = L.DomUtil.create('button', 'btn-layer-toggle', wrapper);
      btn.innerHTML = '🗺️ OSM ▾';

      const dropdown = L.DomUtil.create('div', 'layer-dropdown', wrapper);
      dropdown.style.display = 'none';

      const options = [
        { key: 'satellite', label: '🛰️ Satellite' },
        { key: 'topo', label: '🗺️ Topo' },
        { key: 'osm', label: '🗺️ OSM' },
      ];

      options.forEach(opt => {
        const item = L.DomUtil.create('div', 'layer-dropdown-item', dropdown);
        item.innerHTML = opt.label;
        if (opt.key === 'osm') item.classList.add('active');
        item.addEventListener('click', () => {
          map.removeLayer(layers[currentLayerIdx].layer);
          currentLayerIdx = layers.findIndex(l => l.key === opt.key);
          layers[currentLayerIdx].layer.addTo(map);
          // Si les espaces aériens sont activés, les remettre au premier plan
          // (sinon la nouvelle couche de tuiles les masque)
          if (airspacesVisible && airspaceTileLayer && airspaceTileLayer.bringToFront) {
            airspaceTileLayer.bringToFront();
          }
          btn.innerHTML = opt.label + ' ▾';
          dropdown.querySelectorAll('.layer-dropdown-item').forEach(el => el.classList.remove('active'));
          item.classList.add('active');
          dropdown.style.display = 'none';
        });
      });

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const wasOpen = dropdown.style.display !== 'none';
        // Fermer tous les dropdowns Leaflet ouverts (les nôtres uniquement)
        document.querySelectorAll('.layer-dropdown').forEach(d => { d.style.display = 'none'; });
        dropdown.style.display = wasOpen ? 'none' : 'block';
      });

      // Fermer si clic ailleurs
      document.addEventListener('click', (e) => {
        if (!wrapper.contains(e.target)) dropdown.style.display = 'none';
      });

      return wrapper;
    };
    btnLayerToggle.addTo(map);

    // --- ÉTAT DES COUCHES (espaces aériens, aéroports, navaids) ---
    let airspacesVisible = false;
    let airspaceTileLayer = null;
    let airportsEnabled = true;
    let heliportsEnabled = true;
    let navaidsEnabled = true;

    function creerCoucheEspacesAeriens() {
      // La clé API est injectée automatiquement par le main process via
      // session.defaultSession.webRequest.onBeforeSendHeaders — pas besoin
      // de l'exposer dans l'URL côté renderer.
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

    function setAirspacesVisible(on) {
      if (on && !OPENAIP_API_KEY) {
        alert(t('apiKeyMissing'));
        return false; // toggle refusé
      }
      if (on && !airspacesVisible) {
        airspaceTileLayer = creerCoucheEspacesAeriens();
        airspaceTileLayer.addTo(map);
        airspacesVisible = true;
      } else if (!on && airspacesVisible) {
        if (airspaceTileLayer) {
          map.removeLayer(airspaceTileLayer);
          airspaceTileLayer = null;
        }
        airspacesVisible = false;
      }
      return true;
    }

    // -------------------------------------------------------
    // Affichage des aéroports OurAirports (zoom >= 8)
    // -------------------------------------------------------
    const ZOOM_MIN_AEROPORTS = 8;
    const airportsLayer = L.layerGroup().addTo(map);
    const heliportsLayer = L.layerGroup().addTo(map);
    let _aeroportsMoveTimer = null;
    let _aeroportsLastRequestId = 0;

    // Tailles selon le type d'aéroport (rayon du cercle)
    const TAILLES_AEROPORT = {
      large_airport: 9,
      medium_airport: 7,
      small_airport: 5,
      heliport: 6,
    };

    // Construit l'icône SVG d'un aéroport (cercle + trait piste orienté)
    function makeAirportIcon(airport) {
      // Hélistation : cercle blanc avec un « H » noir au centre (pas de piste)
      if (airport.type === 'heliport') {
        const rh = TAILLES_AEROPORT.heliport || 6;
        const sizeH = rh * 2 + 12;
        const fs = Math.round(rh * 1.7);
        const svgH = `
          <svg viewBox="-${sizeH / 2} -${sizeH / 2} ${sizeH} ${sizeH}" width="${sizeH}" height="${sizeH}" style="overflow:visible;">
            <circle cx="0" cy="0" r="${rh}" fill="#fff" stroke="#000" stroke-width="1.6"/>
            <text x="0" y="0" text-anchor="middle" dominant-baseline="central"
                  font-family="Arial, sans-serif" font-weight="700" font-size="${fs}" fill="#000">H</text>
          </svg>
        `;
        return L.divIcon({
          className: 'airport-marker heliport-marker',
          html: svgH,
          iconSize: [sizeH, sizeH],
          iconAnchor: [sizeH / 2, sizeH / 2],
        });
      }

      const r = TAILLES_AEROPORT[airport.type] || 5;
      const size = r * 2 + 12; // marge pour la piste qui dépasse + tooltip
      const heading = airport.runway ? airport.runway.headingDegT : 0;
      const hasRunway = !!airport.runway;

      // Le trait de piste dépasse de chaque côté du cercle ; sa rotation est
      // appliquée sur le <line> (centre = 0,0). L'icône globale n'est pas tournée.
      // Le trait est horizontal par défaut (E-W) ; un cap 0° = Nord (donc N-S
      // sur l'écran) → on soustrait 90° à la rotation.
      const lineExtent = r + 4;
      const rotation = heading - 90;
      const svg = `
        <svg viewBox="-${size / 2} -${size / 2} ${size} ${size}" width="${size}" height="${size}" style="overflow:visible;">
          ${hasRunway ? `<line x1="-${lineExtent}" y1="0" x2="${lineExtent}" y2="0"
                stroke="#000" stroke-width="2.2" stroke-linecap="round"
                transform="rotate(${rotation})"/>` : ''}
          <circle cx="0" cy="0" r="${r}" fill="#fff" stroke="#000" stroke-width="1.6"/>
        </svg>
      `;
      return L.divIcon({
        className: 'airport-marker',
        html: svg,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      });
    }

    // Tooltip HTML
    function makeAirportTooltipHtml(airport) {
      // Priorité : code calculé côté main (icao → gps → local → ident)
      const code = airport.code || airport.icao || airport.ident;
      const name = airport.name;
      let pisteLigne = '';
      if (airport.runway) {
        const heading = Math.round(airport.runway.headingDegT) % 360;
        pisteLigne = `<div class="ap-tt-rwy">${currentLang === 'fr' ? 'Piste' : 'Runway'} ${airport.runway.name} (${String(heading).padStart(3, '0')}°)</div>`;
      }
      return `
        <div class="ap-tt-icao">${code}</div>
        <div class="ap-tt-name">${name}</div>
        ${pisteLigne}
      `;
    }

    async function refreshAirportsOnMap() {
      if (!map) return;
      // Aéroports et hélistations partagent la même requête bbox mais sont
      // rendus dans deux couches distinctes, pilotées par deux toggles.
      if (!airportsEnabled && !heliportsEnabled) {
        airportsLayer.clearLayers();
        heliportsLayer.clearLayers();
        return;
      }
      const zoom = map.getZoom();
      if (zoom < ZOOM_MIN_AEROPORTS) {
        airportsLayer.clearLayers();
        heliportsLayer.clearLayers();
        return;
      }
      const b = map.getBounds();
      const bbox = {
        south: b.getSouth(),
        west: b.getWest(),
        north: b.getNorth(),
        east: b.getEast(),
      };

      // Annule la dernière requête si une nouvelle arrive
      const reqId = ++_aeroportsLastRequestId;
      let res;
      try {
        res = await window.api.aeroportsDansBbox(bbox);
      } catch (err) {
        console.warn('Erreur lecture aéroports bbox:', err);
        return;
      }
      // Si une requête plus récente a déjà été envoyée, on ignore le résultat
      if (reqId !== _aeroportsLastRequestId) return;
      if (!res || !res.ok) {
        // Pas de données = silencieux (l'utilisateur n'a peut-être pas encore importé)
        airportsLayer.clearLayers();
        heliportsLayer.clearLayers();
        return;
      }

      airportsLayer.clearLayers();
      heliportsLayer.clearLayers();
      for (const a of res.airports) {
        const isHeli = a.type === 'heliport';
        // Chaque type respecte son propre toggle
        if (isHeli ? !heliportsEnabled : !airportsEnabled) continue;
        const marker = L.marker([a.lat, a.lon], {
          icon: makeAirportIcon(a),
          interactive: true,
          keyboard: false,
        });
        marker.bindTooltip(makeAirportTooltipHtml(a), {
          direction: 'top',
          offset: [0, -8],
          className: 'airport-tooltip',
          opacity: 1,
          sticky: false,
        });
        // Click → ouvrir la modale d'informations détaillées
        marker.on('click', () => ouvrirInfoAeroport(a.ident));
        marker.addTo(isHeli ? heliportsLayer : airportsLayer);
      }
    }

    function scheduleAirportRefresh() {
      if (_aeroportsMoveTimer) clearTimeout(_aeroportsMoveTimer);
      _aeroportsMoveTimer = setTimeout(refreshAirportsOnMap, 200);
    }

    map.on('moveend', scheduleAirportRefresh);
    map.on('zoomend', scheduleAirportRefresh);
    // Premier render
    scheduleAirportRefresh();

    // Exposer pour debug / langue (le texte "Piste" / "Runway" doit changer)
    window._refreshAirports = refreshAirportsOnMap;

    // -------------------------------------------------------
    // Affichage des NAVAIDS OurAirports (zoom >= 8)
    // -------------------------------------------------------
    const ZOOM_MIN_NAVAIDS = 8;
    const NAV_COLOR = '#1565c0';
    const navaidsLayer = L.layerGroup().addTo(map);
    let _navaidsMoveTimer = null;
    let _navaidsLastRequestId = 0;

    // Formate la fréquence selon le type
    //   NDB / NDB-DME    → kHz
    //   VOR / VOR-DME / VORTAC / TACAN / DME → MHz
    function formatNavaidFreq(type, freqKhz) {
      if (!freqKhz || !Number.isFinite(freqKhz) || freqKhz <= 0) return '—';
      if (type === 'NDB' || type === 'NDB-DME') {
        return Math.round(freqKhz) + ' kHz';
      }
      // MHz = kHz / 1000, 2 décimales
      return (freqKhz / 1000).toFixed(2) + ' MHz';
    }

    // Génère l'icône SVG selon le type. Toutes les icônes sont en bleu sur fond blanc.
    function makeNavaidIcon(navaid) {
      const type = navaid.type;
      const C = NAV_COLOR;
      const size = 22;
      const sw = 1.6;
      let inner = '';

      // Géométries de base
      const hexPts = '-7,4 -7,-4 0,-8 7,-4 7,4 0,8';
      const hexInsidePts = '-5,2.9 -5,-2.9 0,-5.8 5,-2.9 5,2.9 0,5.8';

      switch (type) {
        case 'VOR':
          inner = `
            <polygon points="${hexPts}" fill="#fff" stroke="${C}" stroke-width="${sw}"/>
            <circle cx="0" cy="0" r="1.6" fill="${C}"/>
          `;
          break;
        case 'VOR-DME':
          inner = `
            <rect x="-9" y="-9" width="18" height="18" fill="#fff" stroke="${C}" stroke-width="${sw}"/>
            <polygon points="${hexInsidePts}" fill="#fff" stroke="${C}" stroke-width="1.3"/>
            <circle cx="0" cy="0" r="1.4" fill="${C}"/>
          `;
          break;
        case 'VORTAC':
          // Hexagone + 3 petites barres aux sommets alternés (haut, bas-gauche, bas-droit)
          inner = `
            <rect x="-2.6" y="-11" width="5.2" height="3" fill="${C}"/>
            <rect x="-2.6" y="-1.5" width="5.2" height="3" fill="${C}" transform="rotate(120 0 0) translate(0 9.5)"/>
            <rect x="-2.6" y="-1.5" width="5.2" height="3" fill="${C}" transform="rotate(-120 0 0) translate(0 9.5)"/>
            <polygon points="${hexPts}" fill="#fff" stroke="${C}" stroke-width="${sw}"/>
            <circle cx="0" cy="0" r="1.6" fill="${C}"/>
          `;
          break;
        case 'TACAN':
          // Triangle équilatéral pointe en haut
          inner = `
            <polygon points="0,-8 7,5 -7,5" fill="#fff" stroke="${C}" stroke-width="${sw}"/>
            <circle cx="0" cy="1" r="1.4" fill="${C}"/>
          `;
          break;
        case 'NDB':
          // Cercle pointillé + point central
          inner = `
            <circle cx="0" cy="0" r="7" fill="#fff" stroke="${C}" stroke-width="1.5" stroke-dasharray="1.8 1.8"/>
            <circle cx="0" cy="0" r="1.8" fill="${C}"/>
          `;
          break;
        case 'NDB-DME':
          inner = `
            <rect x="-9" y="-9" width="18" height="18" fill="#fff" stroke="${C}" stroke-width="${sw}"/>
            <circle cx="0" cy="0" r="5.5" fill="#fff" stroke="${C}" stroke-width="1.4" stroke-dasharray="1.6 1.6"/>
            <circle cx="0" cy="0" r="1.6" fill="${C}"/>
          `;
          break;
        case 'DME':
        default:
          inner = `
            <rect x="-7" y="-7" width="14" height="14" fill="#fff" stroke="${C}" stroke-width="${sw}"/>
            <text x="0" y="3.5" text-anchor="middle" fill="${C}" font-size="8" font-weight="bold" font-family="Arial, sans-serif">D</text>
          `;
          break;
      }

      const svg = `
        <svg viewBox="-12 -12 24 24" width="${size}" height="${size}" style="overflow:visible;">
          ${inner}
        </svg>
      `;
      return L.divIcon({
        className: 'navaid-marker',
        html: svg,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      });
    }

    function makeNavaidTooltipHtml(navaid) {
      const freqLabel = formatNavaidFreq(navaid.type, navaid.freqKhz);
      return `
        <div class="nv-tt-ident">${escapeHtml(navaid.ident || '')}</div>
        <div class="nv-tt-type">${escapeHtml(navaid.type)}</div>
        <div class="nv-tt-freq">${freqLabel}</div>
      `;
    }

    async function refreshNavaidsOnMap() {
      if (!map) return;
      if (!navaidsEnabled) {
        navaidsLayer.clearLayers();
        return;
      }
      const zoom = map.getZoom();
      if (zoom < ZOOM_MIN_NAVAIDS) {
        navaidsLayer.clearLayers();
        return;
      }
      const b = map.getBounds();
      const bbox = {
        south: b.getSouth(),
        west: b.getWest(),
        north: b.getNorth(),
        east: b.getEast(),
      };
      const reqId = ++_navaidsLastRequestId;
      let res;
      try { res = await window.api.navaidsDansBbox(bbox); }
      catch (err) { console.warn('Erreur lecture navaids bbox:', err); return; }
      if (reqId !== _navaidsLastRequestId) return;
      if (!res || !res.ok) { navaidsLayer.clearLayers(); return; }

      navaidsLayer.clearLayers();
      for (const n of res.navaids) {
        const marker = L.marker([n.lat, n.lon], {
          icon: makeNavaidIcon(n),
          interactive: true,
          keyboard: false,
        });
        marker.bindTooltip(makeNavaidTooltipHtml(n), {
          direction: 'top',
          offset: [0, -8],
          className: 'navaid-tooltip',
          opacity: 1,
          sticky: false,
        });
        marker.on('click', () => ouvrirInfoNavaid(n.id));
        marker.addTo(navaidsLayer);
      }
    }

    function scheduleNavaidRefresh() {
      if (_navaidsMoveTimer) clearTimeout(_navaidsMoveTimer);
      _navaidsMoveTimer = setTimeout(refreshNavaidsOnMap, 200);
    }
    map.on('moveend', scheduleNavaidRefresh);
    map.on('zoomend', scheduleNavaidRefresh);
    scheduleNavaidRefresh();
    window._refreshNavaids = refreshNavaidsOnMap;

    // Bascule labels permanents / hover des waypoints à chaque changement de zoom
    map.on('zoomend', updateAllWaypointLabels);

    // --- Bouton déroulant des CALQUES (Espaces aériens / Aéroports / Navaids) ---
    // Placé à gauche du dropdown des fonds de carte (grâce au row-reverse CSS sur topright)
    const btnLayersFilter = L.control({ position: 'topright' });
    btnLayersFilter.onAdd = function () {
      const wrapper = L.DomUtil.create('div', 'layer-toggle-wrapper layers-filter-wrapper');
      L.DomEvent.disableClickPropagation(wrapper);
      L.DomEvent.disableScrollPropagation(wrapper);

      const btn = L.DomUtil.create('button', 'btn-layer-toggle', wrapper);
      const dropdown = L.DomUtil.create('div', 'layer-dropdown layers-filter-dropdown', wrapper);
      dropdown.style.display = 'none';

      // Construit (ou reconstruit, après changement de langue) le contenu
      function rebuild() {
        btn.innerHTML = (currentLang === 'fr' ? '🗂️ Calques' : '🗂️ Layers') + ' ▾';
        dropdown.innerHTML = '';
        const items = [
          { id: 'airspaces', labelFr: 'Espaces aériens', labelEn: 'Airspaces', checked: airspacesVisible },
          { id: 'airports', labelFr: 'Aéroports', labelEn: 'Airports', checked: airportsEnabled },
          { id: 'heliports', labelFr: 'Hélistations', labelEn: 'Heliports', checked: heliportsEnabled },
          { id: 'navaids', labelFr: 'Navaids', labelEn: 'Navaids', checked: navaidsEnabled },
        ];
        items.forEach(it => {
          const row = L.DomUtil.create('label', 'layer-toggle-row', dropdown);
          row.innerHTML = `
            <span>${currentLang === 'fr' ? it.labelFr : it.labelEn}</span>
            <input type="checkbox" class="toggle-switch" data-layer="${it.id}" ${it.checked ? 'checked' : ''}>
          `;
          const input = row.querySelector('input');
          L.DomEvent.on(input, 'click', e => e.stopPropagation());
          L.DomEvent.on(input, 'change', () => {
            const on = input.checked;
            if (it.id === 'airspaces') {
              const ok = setAirspacesVisible(on);
              if (!ok) input.checked = false; // ex: pas de clé API → toggle refusé
            } else if (it.id === 'airports') {
              airportsEnabled = on;
              if (on) refreshAirportsOnMap(); else airportsLayer.clearLayers();
            } else if (it.id === 'heliports') {
              heliportsEnabled = on;
              if (on) refreshAirportsOnMap(); else heliportsLayer.clearLayers();
            } else if (it.id === 'navaids') {
              navaidsEnabled = on;
              if (on) refreshNavaidsOnMap(); else navaidsLayer.clearLayers();
            }
          });
        });
      }
      rebuild();
      window._refreshLayersDropdown = rebuild;

      btn.addEventListener('click', e => {
        e.stopPropagation();
        const wasOpen = dropdown.style.display !== 'none';
        document.querySelectorAll('.layer-dropdown').forEach(d => { d.style.display = 'none'; });
        dropdown.style.display = wasOpen ? 'none' : 'block';
      });
      document.addEventListener('click', e => {
        if (!wrapper.contains(e.target)) dropdown.style.display = 'none';
      });

      return wrapper;
    };
    btnLayersFilter.addTo(map);

    console.log("Carte Leaflet initialisée avec succès.");
  } catch (mapError) {
    console.error("Erreur d'initialisation de la carte:", mapError);
  }

  initReset();

  initLegModals();

  // --- 3. BOUTON : CRÉER PLAN DE VOL ---
  const btnCreate = document.getElementById('btn-create-flight');
  const createOverlay = document.getElementById('create-flight-overlay');
  const btnCreateCancel = document.getElementById('btn-create-cancel');
  const btnCreateValidate = document.getElementById('btn-create-validate');

  if (btnCreate && createOverlay) {
    // Ouvrir la modale
    btnCreate.addEventListener('click', () => {
      const depIcao = document.getElementById('create-icao-dep');
      const arrIcao = document.getElementById('create-icao-arr');
      depIcao.value = '';
      arrIcao.value = '';
      depIcao.dataset.pattern = ''; // reset des flags tour de piste
      arrIcao.dataset.pattern = '';
      document.getElementById('create-lat-dep').value = '';
      document.getElementById('create-lon-dep').value = '';
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
        document.getElementById('create-lon-dep'),
        document.getElementById('create-icao-dep')
      );
    });

    document.getElementById('btn-search-arr').addEventListener('click', () => {
      rechercherAeroport(
        document.getElementById('create-icao-arr').value,
        document.getElementById('search-status-arr'),
        document.getElementById('create-lat-arr'),
        document.getElementById('create-lon-arr'),
        document.getElementById('create-icao-arr')
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

      // Appliquer les flags "Tour de piste prévu" sur les waypoints concernés
      const depPattern = document.getElementById('create-icao-dep').dataset.pattern === 'true';
      const arrPattern = document.getElementById('create-icao-arr').dataset.pattern === 'true';
      if (depPattern) flightPlan[0].pattern = true;
      if (arrPattern) flightPlan[flightPlan.length - 1].pattern = true;

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

  // --- 4. BOUTON : CHARGER PLAN DE VOL (.navxpv natif) ---
  const btnLoad = document.getElementById('btn-load-flight');
  if (btnLoad) {
    btnLoad.addEventListener('click', async () => {
      const res = await window.api.ouvrirNavXpv();
      if (!res) return; // annulation
      if (!res.ok || !res.data) {
        alert(t('navxpvParseError') + (res && res.error ? res.error : ''));
        return;
      }
      const data = res.data;

      // Validation minimale
      if (data.format !== 'navxpv' || !Array.isArray(data.waypoints)) {
        alert(t('navxpvBadFormat'));
        return;
      }

      try {
        // Réinitialiser l'état actuel
        flightPlan = [];
        legAltitudes = [];
        activeLegIndex = 1;
        marqueursCarte.forEach(m => map.removeLayer(m));
        marqueursCarte = [];
        supprimerSegmentsCarte();

        // Re-peupler les waypoints
        for (const wp of data.waypoints) {
          if (typeof wp.lat === 'number' && typeof wp.lon === 'number') {
            const entry = {
              name: wp.name || wp.ident || '',
              ident: wp.ident || wp.name || '',
              lat: wp.lat,
              lon: wp.lon,
            };
            if (wp.pattern) entry.pattern = true;
            flightPlan.push(entry);
          }
        }

        // Altitudes (null → undefined pour respecter la convention interne)
        if (Array.isArray(data.legAltitudes) && data.legAltitudes.length === flightPlan.length) {
          legAltitudes = data.legAltitudes.map(a => (a === null ? undefined : a));
        } else {
          legAltitudes = [undefined];
          for (let i = 1; i < flightPlan.length; i++) legAltitudes.push(ALT_DEFAULT);
        }

        // Config (Vp + vent)
        if (data.config) {
          const inputVp = document.getElementById('input-vp');
          const inputWindDir = document.getElementById('input-wind-dir');
          const inputWindSpeed = document.getElementById('input-wind-speed');
          if (inputVp && typeof data.config.trueAirspeed === 'number') inputVp.value = data.config.trueAirspeed;
          if (inputWindDir && typeof data.config.windDirection === 'number') inputWindDir.value = data.config.windDirection;
          if (inputWindSpeed && typeof data.config.windSpeed === 'number') inputWindSpeed.value = data.config.windSpeed;
          // Rafraîchir la rose des vents
          if (typeof updateWindRose === 'function') {
            updateWindRose(
              data.config.windDirection ?? 0,
              data.config.windSpeed ?? 0,
              'manual'
            );
          }
        }

        // ICAO départ / arrivée (champs en lecture seule, peuplés depuis le plan)
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
      } catch (err) {
        console.error('Erreur chargement .navxpv:', err);
        alert(t('navxpvParseError') + err.message);
      }
    });
  }

  // --- 4. BOUTON : SAUVEGARDER (.navxpv natif uniquement) ---
  const btnSave = document.getElementById('btn-save-flight');
  if (btnSave) {
    btnSave.addEventListener('click', async () => {
      if (flightPlan.length === 0) {
        alert(t('nothingToSave'));
        return;
      }

      const planData = {
        format: 'navxpv',
        version: 1,
        savedAt: new Date().toISOString(),
        config: {
          trueAirspeed: parseFloat(document.getElementById('input-vp').value) || 90,
          windDirection: parseFloat(document.getElementById('input-wind-dir').value) || 0,
          windSpeed: parseFloat(document.getElementById('input-wind-speed').value) || 0,
        },
        // Snapshot des waypoints (on ne sérialise pas d'éventuels objets Leaflet)
        waypoints: flightPlan.map(wp => ({
          name: wp.name,
          ident: wp.ident || wp.name,
          lat: wp.lat,
          lon: wp.lon,
          pattern: !!wp.pattern,
        })),
        // legAltitudes : index 0 inutilisé → null en JSON (undefined non sérialisable)
        legAltitudes: legAltitudes.map(a => (a === undefined ? null : a)),
      };

      const result = await window.api.sauvegarderNavXpv(planData);
      if (result && result.ok) {
        showToast(t('saveSuccess'), 'success');
      } else if (result && !result.canceled) {
        showToast('❌ ' + (result.error || 'Erreur sauvegarde'), 'error');
      }
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
  // ----------------------------------------------------------
  // SimConnect : connexion MSFS + injection vent
  // ----------------------------------------------------------
  const statusBadge = document.getElementById('sim-status');
  let _simState = 'disconnected'; // disconnected | connecting | connected

  function appliquerEtatSim(state, info) {
    _simState = state;
    if (!statusBadge) return;
    statusBadge.disabled = (state === 'connecting');
    statusBadge.removeAttribute('data-i18n'); // on gère le texte manuellement
    switch (state) {
      case 'connected':
        statusBadge.textContent = t('simConnected');
        statusBadge.style.backgroundColor = '#2e7d32'; // vert
        statusBadge.title = t('simClickToDisconnect');
        break;
      case 'connecting':
        statusBadge.textContent = t('simConnecting');
        statusBadge.style.backgroundColor = '#ef6c00'; // orange foncé
        statusBadge.title = '';
        break;
      case 'disconnected':
      default:
        statusBadge.textContent = t('simDisconnectedClick');
        statusBadge.style.backgroundColor = '#d32f2f'; // rouge
        statusBadge.title = t('simClickToConnect');
        break;
    }
  }

  // État initial
  appliquerEtatSim('disconnected');

  if (statusBadge) {
    statusBadge.addEventListener('click', async () => {
      if (_simState === 'connecting') return;
      if (_simState === 'connected') {
        await window.api.simConnectDeconnecter();
      } else {
        appliquerEtatSim('connecting');
        const res = await window.api.simConnectConnecter();
        if (!res || !res.ok) {
          appliquerEtatSim('disconnected');
          // Petite info dans la console — pas d'alerte intrusive
          console.warn('Connexion MSFS échouée:', res && res.error);
          // Flash visuel rapide pour signaler l'erreur
          if (statusBadge) {
            const prev = statusBadge.textContent;
            statusBadge.textContent = t('simConnectFailed');
            setTimeout(() => {
              if (_simState === 'disconnected') statusBadge.textContent = t('simDisconnectedClick');
            }, 2500);
          }
        }
      }
    });
  }

  // Écouter les changements de statut côté main process
  window.api.onStatusSimConnect((status) => {
    if (!status || !status.state) return;
    appliquerEtatSim(status.state, status);
  });

  // Recevoir les données de vol (vent) et injecter dans les inputs
  window.api.onDonneesVol((data) => {
    if (!data) return;
    let modifie = false;
    if (typeof data.windDir === 'number' && Number.isFinite(data.windDir)) {
      // Normaliser 0..360
      let d = data.windDir % 360;
      if (d < 0) d += 360;
      const val = Math.round(d).toString();
      if (inputWindDir && inputWindDir.value !== val) {
        inputWindDir.value = val;
        modifie = true;
      }
    }
    if (typeof data.windSpeed === 'number' && Number.isFinite(data.windSpeed)) {
      // Plafonner à 0..40 pour respecter la validation existante
      let v = data.windSpeed;
      if (v < 0) v = 0;
      if (v > 40) v = 40;
      const val = Math.round(v).toString();
      if (inputWindSpeed && inputWindSpeed.value !== val) {
        inputWindSpeed.value = val;
        modifie = true;
      }
    }
    if (modifie && typeof mettreAJourLogDeNav === 'function') {
      mettreAJourLogDeNav();
    }
    // Mettre à jour la rose avec les valeurs brutes reçues de MSFS
    if (typeof data.windDir === 'number' && typeof data.windSpeed === 'number') {
      updateWindRose(data.windDir, data.windSpeed, 'msfs');
    }
  });

  // Quand l'utilisateur se déconnecte de MSFS, revenir à 'manuel'
  window.api.onStatusSimConnect((status) => {
    if (status && status.state === 'disconnected') {
      const d = parseFloat(inputWindDir?.value) || 0;
      const v = parseFloat(inputWindSpeed?.value) || 0;
      updateWindRose(d, v, 'manual');
    }
  });

  // ----------------------------------------------------------
  // Alerte sonore de proximité waypoint
  //   Reçoit la position de l'avion toutes les 5 s depuis MSFS,
  //   calcule la distance au point d'arrivée du leg actif et
  //   joue waypoint_fr.wav / waypoint_en.wav quand < 1.5 NM.
  // ----------------------------------------------------------
  const WAYPOINT_RADIUS_NM = 1.5;
  const DEVIATION_MAX_NM = 1.2;
  const PATTERN_RADIUS_NM = 2;
  // Précharge des fichiers audio (situés dans src/sounds/)
  const _wpSounds = {
    fr: new Audio('sounds/waypoint_fr.wav'),
    en: new Audio('sounds/waypoint_en.wav'),
  };
  const _arrivalSound = new Audio('sounds/cuckoo.wav'); // joué à l'arrivée finale (langue-agnostique)
  const _devSounds = {
    fr: new Audio('sounds/deviation_fr.wav'),
    en: new Audio('sounds/deviation_en.wav'),
  };
  const _touchSounds = {
    fr: new Audio('sounds/touch_fr.wav'),
    en: new Audio('sounds/touch_en.wav'),
  };
  // Pré-chargement (au cas où le 1er play soit en différé)
  _wpSounds.fr.preload = 'auto';
  _wpSounds.en.preload = 'auto';
  _arrivalSound.preload = 'auto';
  _devSounds.fr.preload = 'auto';
  _devSounds.en.preload = 'auto';
  _touchSounds.fr.preload = 'auto';
  _touchSounds.en.preload = 'auto';

  let _lastSoundLegIndex = null;     // index du leg pour lequel le son d'arrivée a déjà été joué
  let _lastSoundSession = false;     // mémoire qu'on était DANS le rayon au précédent tick

  // État de l'alerte d'écart latéral
  let _deviationLegIndex = null;     // index du leg pour lequel on a alerté la dernière fois
  let _deviationOutside = false;     // currently hors du couloir 1.2 NM
  let _deviationLastAlertTime = 0;   // timestamp ms de la dernière alerte (pour rappel toutes les 2 min)
  const DEVIATION_REMIND_MS = 2 * 60 * 1000; // 2 minutes

  function _distanceNM(lat1, lon1, lat2, lon2) {
    const R_NM = 3440.065;
    const toRad = d => d * Math.PI / 180;
    const φ1 = toRad(lat1);
    const φ2 = toRad(lat2);
    const Δφ = toRad(lat2 - lat1);
    const Δλ = toRad(lon2 - lon1);
    const a = Math.sin(Δφ / 2) ** 2
      + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R_NM * c;
  }

  // Cross-track distance (XTD) : distance perpendiculaire signée d'un point P
  // à la route grand-cercle A→B. Positif = à droite de la route, négatif = à gauche.
  // Résultat en nautical miles. Pour le test de seuil on utilisera Math.abs().
  function _crossTrackNM(latP, lonP, latA, lonA, latB, lonB) {
    const R_NM = 3440.065;
    const toRad = d => d * Math.PI / 180;
    const φA = toRad(latA), λA = toRad(lonA);
    const φP = toRad(latP), λP = toRad(lonP);
    const φB = toRad(latB), λB = toRad(lonB);

    // Distance angulaire A→P (en radians)
    const Δφap = φP - φA;
    const Δλap = λP - λA;
    const aap = Math.sin(Δφap / 2) ** 2
      + Math.cos(φA) * Math.cos(φP) * Math.sin(Δλap / 2) ** 2;
    const d_AP = 2 * Math.atan2(Math.sqrt(aap), Math.sqrt(1 - aap));

    // Relevement A→B et A→P
    function bearing(φ1, λ1, φ2, λ2) {
      const y = Math.sin(λ2 - λ1) * Math.cos(φ2);
      const x = Math.cos(φ1) * Math.sin(φ2)
        - Math.sin(φ1) * Math.cos(φ2) * Math.cos(λ2 - λ1);
      return Math.atan2(y, x);
    }
    const θ_AB = bearing(φA, λA, φB, λB);
    const θ_AP = bearing(φA, λA, φP, λP);

    return Math.asin(Math.sin(d_AP) * Math.sin(θ_AP - θ_AB)) * R_NM;
  }

  // _jouerSon(audioEl) → déplacé vers js/sounds.js (partagé sim/tank)
  function _jouerSonWaypoint() {
    _jouerSon(_wpSounds[currentLang] || _wpSounds.fr);
  }
  function _jouerSonArrivee() {
    _jouerSon(_arrivalSound);
  }
  function _jouerSonDeviation() {
    _jouerSon(_devSounds[currentLang] || _devSounds.fr);
  }
  function _jouerSonTouch() {
    _jouerSon(_touchSounds[currentLang] || _touchSounds.fr);
  }

  // Calcul cap magnétique + temps + distance pour une trajectoire (A → B).
  // Utilise la déclinaison magnétique globale et les valeurs courantes Vp/vent
  // (lues depuis les inputs). Retourne null si Vp invalide.
  function calcLegInfo(latA, lonA, latB, lonB) {
    const vp = parseFloat(document.getElementById('input-vp').value) || 90;
    const dirVent = parseFloat(document.getElementById('input-wind-dir').value) || 0;
    const vitVent = parseFloat(document.getElementById('input-wind-speed').value) || 0;

    const R = 3440.065;
    const toRad = d => d * Math.PI / 180;
    const dLat = toRad(latB - latA);
    const dLon = toRad(lonB - lonA);
    const lat1Rad = toRad(latA);
    const lat2Rad = toRad(latB);
    const a = Math.sin(dLat / 2) ** 2
      + Math.sin(dLon / 2) ** 2 * Math.cos(lat1Rad) * Math.cos(lat2Rad);
    const distanceNM = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    // Route vraie (bearing initial du grand-cercle)
    const y = Math.sin(dLon) * Math.cos(lat2Rad);
    const x = Math.cos(lat1Rad) * Math.sin(lat2Rad)
      - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);
    const rvDeg = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;

    // Triangle des vitesses (dérive + GS)
    const alphaRad = ((dirVent - rvDeg) * Math.PI) / 180;
    let deriveDeg = 0;
    if (vp > 0) {
      const sinX = (vitVent * Math.sin(alphaRad)) / vp;
      if (Math.abs(sinX) <= 1) deriveDeg = (Math.asin(sinX) * 180) / Math.PI;
    }
    const deriveRad = (deriveDeg * Math.PI) / 180;
    let gs = vp * Math.cos(deriveRad) - vitVent * Math.cos(alphaRad);
    if (gs < 0) gs = 0;

    let tempsSec = null;
    let tempsFormate = '--:--';
    if (gs > 0) {
      tempsSec = Math.round((distanceNM / gs) * 3600);
      const mm = Math.floor(tempsSec / 60).toString().padStart(2, '0');
      const ss = (tempsSec % 60).toString().padStart(2, '0');
      tempsFormate = `${mm}:${ss}`;
    }

    const capMagDeg = (rvDeg + deriveDeg - declinaisonMoyenneGlobale + 360) % 360;
    return { distanceNM, rvDeg, capMagDeg, gs, tempsSec, tempsFormate };
  }

  window.api.onDonneesPosition((pos) => {
    if (!pos || typeof pos.lat !== 'number' || typeof pos.lon !== 'number') return;
    // Cache la dernière position avion (utilisée par Direct To)
    _lastAircraftPos = { lat: pos.lat, lon: pos.lon };
    if (!flightPlan || flightPlan.length < 2) return;
    // Le leg actif doit avoir un point d'arrivée valide
    if (activeLegIndex < 1 || activeLegIndex >= flightPlan.length) return;

    // Si l'utilisateur a changé de leg actif depuis la dernière fois,
    // on reset le tracking (le son pourra être rejoué pour le nouveau leg)
    if (_lastSoundLegIndex !== null && _lastSoundLegIndex !== activeLegIndex) {
      _lastSoundLegIndex = null;
      _lastSoundSession = false;
    }
    // Idem pour le tracking d'écart latéral
    if (_deviationLegIndex !== null && _deviationLegIndex !== activeLegIndex) {
      _deviationLegIndex = null;
      _deviationOutside = false;
      _deviationLastAlertTime = 0;
    }

    // En mode Direct To, le DÉPART de la trajectoire est figé à la position
    // de l'avion au moment de l'activation, pas le précédent waypoint.
    // L'ARRIVÉE reste flightPlan[activeLegIndex].
    const dep = _directToActive ? _directToOrigin : flightPlan[activeLegIndex - 1];
    const arr = flightPlan[activeLegIndex];
    const distance = _distanceNM(pos.lat, pos.lon, arr.lat, arr.lon);
    const insideRadius = distance < WAYPOINT_RADIUS_NM;

    // --- Vérification de l'écart latéral à la trajectoire du leg actif ---
    if (dep) {
      // ZONE DE TOUR DE PISTE : si l'avion est à < 2 NM d'un aéroport du leg
      // actif marqué pour un tour de piste (départ ou arrivée), on suspend
      // les alertes de déviation. Le pilote tourne autour de l'aéroport, l'écart
      // à la trajectoire est attendu et ne doit pas déclencher d'alarme.
      // L'annonce d'arrivée (1.5 NM) reste active.
      const distToDep = _distanceNM(pos.lat, pos.lon, dep.lat, dep.lon);
      const inPatternZone =
        (dep.pattern && distToDep < PATTERN_RADIUS_NM) ||
        (arr.pattern && distance < PATTERN_RADIUS_NM);

      if (inPatternZone) {
        // Reset le tracking : à la sortie du rayon, une déviation effective
        // sera détectée fraîchement et alertée normalement.
        if (_deviationOutside) {
          _deviationOutside = false;
          _deviationLastAlertTime = 0;
        }
      } else {
        const xtd = _crossTrackNM(pos.lat, pos.lon, dep.lat, dep.lon, arr.lat, arr.lon);
        const horsCouloir = Math.abs(xtd) > DEVIATION_MAX_NM;
        if (horsCouloir) {
          const now = Date.now();
          if (!_deviationOutside) {
            // 1ère alerte (transition dans → hors couloir)
            _jouerSonDeviation();
            _deviationOutside = true;
            _deviationLegIndex = activeLegIndex;
            _deviationLastAlertTime = now;
          } else if (now - _deviationLastAlertTime >= DEVIATION_REMIND_MS) {
            // Rappel : toujours hors couloir et 2 minutes se sont écoulées
            _jouerSonDeviation();
            _deviationLastAlertTime = now;
          }
        } else if (_deviationOutside) {
          // Retour dans le couloir → reset complet, la prochaine déviation rejouera
          _deviationOutside = false;
          _deviationLastAlertTime = 0;
        }
      }
    }

    // Détection de FRANCHISSEMENT du seuil (transition extérieur → intérieur)
    // pour ne jouer le son qu'une fois par entrée dans le rayon.
    if (insideRadius && _lastSoundLegIndex !== activeLegIndex) {
      // Si un toucher est prévu à l'arrivée → on joue le son "touch" et on
      // remplace les sons waypoint/cuckoo habituels.
      // Sinon : dernier leg → cuckoo, leg intermédiaire → waypoint.
      const estDernierLeg = (activeLegIndex === flightPlan.length - 1);
      if (arr.pattern) {
        _jouerSonTouch();
      } else if (estDernierLeg) {
        _jouerSonArrivee();
      } else {
        _jouerSonWaypoint();
      }
      _lastSoundLegIndex = activeLegIndex;
      _lastSoundSession = true;
      // Auto-validation : on marque le leg comme fait → activeLegIndex++
      // (identique au comportement de la checkbox "Fait" cochée manuellement)
      activeLegIndex = activeLegIndex + 1;
      // Si on était en mode Direct To, on le quitte → le plan reprend son
      // cours normal à partir du leg suivant
      if (_directToActive) {
        _directToActive = false;
        _directToOrigin = null;
        _directToTargetIndex = null;
        _supprimerLigneDirectTo();
      }
      if (typeof mettreAJourLogDeNav === 'function') mettreAJourLogDeNav();
    } else if (!insideRadius && _lastSoundSession) {
      // L'avion sort du rayon. On garde _lastSoundLegIndex mémorisé pour ne pas
      // rejouer s'il revient dans le rayon sur le MÊME leg (pas d'oscillation).
      _lastSoundSession = false;
    }
  });

  // ============================================================
  // EMPORT CARBURANT — calcul et affichage du total
  // ============================================================
  const fuelConsoEl = document.getElementById('fuel-conso');
  const fuelNightEl = document.getElementById('fuel-night');
  const fuelDistAltEl = document.getElementById('fuel-dist-alt');
  const fuelReserveEl = document.getElementById('fuel-reserve');
  const fuelTotalEl = document.getElementById('fuel-total');

  // Filtre décimal (réutilise la même logique que les conversions, déclarée
  // dans le bloc CONVERSIONS plus bas — on en redéfinit une locale ici par
  // sécurité, indépendante de l'ordre des blocs)
  function _fuelCleanInput(el) {
    const before = el.value;
    let v = before.replace(/,/g, '.').replace(/[^0-9.\-]/g, '');
    const firstDot = v.indexOf('.');
    if (firstDot !== -1) {
      v = v.slice(0, firstDot + 1) + v.slice(firstDot + 1).replace(/\./g, '');
    }
    if (v.lastIndexOf('-') > 0) v = v.replace(/-/g, '');
    if (v !== before) el.value = v;
  }

  // Calcule le temps total du plan de vol (somme des durées des legs) en secondes.
  // Renvoie 0 si aucun plan ou si le calcul n'est pas possible.
  function _calcTempsTripSec() {
    if (!flightPlan || flightPlan.length < 2) return 0;
    let total = 0;
    for (let i = 1; i < flightPlan.length; i++) {
      const a = flightPlan[i - 1];
      const b = flightPlan[i];
      const info = calcLegInfo(a.lat, a.lon, b.lat, b.lon);
      if (info && Number.isFinite(info.tempsSec)) total += info.tempsSec;
    }
    return total;
  }

  function updateFuelTotal() {
    if (!fuelTotalEl) return;
    const conso = parseFloat(fuelConsoEl?.value) || 0;
    const distAlt = parseFloat(fuelDistAltEl?.value) || 0;
    const reserveDisc = parseFloat(fuelReserveEl?.value) || 0;
    const vfrNuit = !!fuelNightEl?.checked;
    const vp = parseFloat(document.getElementById('input-vp')?.value) || 0;

    // Durées (en heures)
    const taxiH = 10 / 60;
    const tripH = _calcTempsTripSec() / 3600;
    const reserveRegMin = vfrNuit ? 45 : 30;
    const reserveRegH = reserveRegMin / 60;
    const altH = (vp > 0 && distAlt > 0) ? (distAlt / vp) : 0;

    // Carburant (USG) = consommation (USG/h) × temps (h)
    const fTaxi = conso * taxiH;
    const fTrip = conso * tripH;
    const fReserve = conso * reserveRegH;
    const fAlt = conso * altH;
    // Réserve de route : 10% de la consommation horaire (aléas météo, etc.)
    const fRouteReserve = conso * 0.10;
    const total = fTaxi + fTrip + fReserve + fAlt + fRouteReserve + reserveDisc;

    fuelTotalEl.textContent = total.toFixed(1);
  }

  // Listeners sur les champs carburant
  [fuelConsoEl, fuelDistAltEl, fuelReserveEl].forEach(el => {
    if (!el) return;
    el.addEventListener('input', () => {
      _fuelCleanInput(el);
      updateFuelTotal();
    });
  });
  if (fuelNightEl) fuelNightEl.addEventListener('change', updateFuelTotal);

  // Quand le plan de vol / Vp / vent changent, le trip time change → recalcul.
  // mettreAJourLogDeNav est déjà wrappé plus bas par le bloc Direct To, donc
  // pour ne pas perdre les autres effets on hook ici aussi.
  const _origMajLogForFuel = mettreAJourLogDeNav;
  mettreAJourLogDeNav = function () {
    const r = _origMajLogForFuel.apply(this, arguments);
    try { updateFuelTotal(); } catch (_) { }
    return r;
  };

  // Calcul initial
  updateFuelTotal();

  // --- Bouton + Modale Emport Carburant ---
  const btnFuel = document.getElementById('btn-fuel');
  const fuelOverlay = document.getElementById('fuel-overlay');
  const btnFuelClose = document.getElementById('btn-fuel-close');

  function _ouvrirFuel() {
    if (!fuelOverlay) return;
    updateFuelTotal(); // s'assure que le total est à jour à l'ouverture
    fuelOverlay.classList.add('visible');
    setTimeout(() => {
      if (fuelConsoEl) { fuelConsoEl.focus(); fuelConsoEl.select(); }
    }, 50);
  }
  function _fermerFuel() {
    if (fuelOverlay) fuelOverlay.classList.remove('visible');
    // Les valeurs des champs sont conservées (pas de reset) → persistance entre ouvertures
  }
  if (btnFuel) btnFuel.addEventListener('click', _ouvrirFuel);
  if (btnFuelClose) btnFuelClose.addEventListener('click', _fermerFuel);
  if (fuelOverlay) {
    fuelOverlay.addEventListener('click', e => {
      if (e.target === fuelOverlay) _fermerFuel();
    });
  }
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && fuelOverlay && fuelOverlay.classList.contains('visible')) {
      _fermerFuel();
    }
  });

  initTank();

  initConversions();

  // ============================================================
  // DIRECT TO — bouton + 2 modales + logique
  // ============================================================
  const btnDirectTo = document.getElementById('btn-direct-to');
  const dtOverlay = document.getElementById('direct-to-overlay');
  const dtList = document.getElementById('dt-wp-list');
  const dtError = document.getElementById('dt-error');
  const btnDtCancel = document.getElementById('btn-dt-cancel');
  const btnDtValidate = document.getElementById('btn-dt-validate');
  const dtInfoOverlay = document.getElementById('direct-to-info-overlay');
  const dtInfoTarget = document.getElementById('dt-info-target');
  const dtInfoCap = document.getElementById('dt-info-cap');
  const dtInfoDist = document.getElementById('dt-info-dist');
  const dtInfoTime = document.getElementById('dt-info-time');
  const dtProgressFill = document.getElementById('dt-progress-fill');
  const btnDtInfoClose = document.getElementById('btn-dt-info-close');

  // Etat d'activation du bouton (MSFS connecté + plan présent)
  function _majBoutonDirectTo() {
    if (!btnDirectTo) return;
    const peut = (_simState === 'connected') && Array.isArray(flightPlan) && flightPlan.length >= 1;
    btnDirectTo.disabled = !peut;
    btnDirectTo.title = peut
      ? (currentLang === 'fr' ? "Direct To — Aller directement vers un waypoint"
        : "Direct To — Fly directly to a waypoint")
      : (currentLang === 'fr' ? "Direct To — MSFS doit être connecté et un plan chargé"
        : "Direct To — MSFS must be connected and a flight plan loaded");
  }
  // Mise à jour à la connexion / déconnexion + après chaque rafraîchissement du nav log
  window.api.onStatusSimConnect(() => _majBoutonDirectTo());
  // Hook dans mettreAJourLogDeNav (ré-évalué à chaque redraw)
  const _origMajLog = mettreAJourLogDeNav;
  mettreAJourLogDeNav = function () {
    const r = _origMajLog.apply(this, arguments);
    _majBoutonDirectTo();
    return r;
  };
  _majBoutonDirectTo();

  // --- Ouverture modale 1 : sélection waypoint ---
  if (btnDirectTo) {
    btnDirectTo.addEventListener('click', () => {
      if (btnDirectTo.disabled) return;
      if (!flightPlan || flightPlan.length === 0) return;
      // Remplit la liste (TOUS les waypoints, départ inclus)
      dtList.innerHTML = '';
      dtError.textContent = '';
      btnDtValidate.disabled = true;
      flightPlan.forEach((wp, idx) => {
        const item = document.createElement('label');
        item.className = 'dt-wp-item';
        item.innerHTML = `
          <input type="radio" name="dt-target" value="${idx}">
          <span class="dt-wp-index">#${idx}</span>
          <span class="dt-wp-name">${escapeHtml(wp.name || wp.ident || '?')}</span>
        `;
        dtList.appendChild(item);
      });
      dtList.querySelectorAll('input[type="radio"]').forEach(r => {
        r.addEventListener('change', () => { btnDtValidate.disabled = false; });
      });
      dtOverlay.classList.add('visible');
    });
  }

  function _fermerDtSelect() { dtOverlay.classList.remove('visible'); }
  if (btnDtCancel) btnDtCancel.addEventListener('click', _fermerDtSelect);
  if (dtOverlay) {
    dtOverlay.addEventListener('click', e => { if (e.target === dtOverlay) _fermerDtSelect(); });
  }

  // --- Validation modale 1 → activation Direct To + modale 2 ---
  if (btnDtValidate) {
    btnDtValidate.addEventListener('click', () => {
      const checked = dtList.querySelector('input[type="radio"]:checked');
      if (!checked) {
        dtError.textContent = t('dtNoWaypoint');
        return;
      }
      const targetIdx = parseInt(checked.value, 10);
      if (!_lastAircraftPos) {
        dtError.textContent = currentLang === 'fr'
          ? 'Position avion inconnue — MSFS non connecté ?'
          : 'Aircraft position unknown — MSFS not connected?';
        return;
      }
      _activerDirectTo(targetIdx);
      _fermerDtSelect();
    });
  }

  // --- Ligne magenta dashed sur la carte ---
  function _supprimerLigneDirectTo() {
    if (_directToLayer) {
      try { map.removeLayer(_directToLayer); } catch (_) { }
      _directToLayer = null;
    }
  }
  // Exposer pour le bloc auto-validation arrivée (qui appelle aussi cette fonction)
  window._supprimerLigneDirectTo = _supprimerLigneDirectTo;

  function _tracerLigneDirectTo(origin, target) {
    _supprimerLigneDirectTo();
    if (!map || !origin || !target) return;
    _directToLayer = L.polyline(
      [[origin.lat, origin.lon], [target.lat, target.lon]],
      { color: '#e91e63', weight: 3, opacity: 0.9, dashArray: '10 6' }
    ).addTo(map);
  }

  // --- Activation : passage en mode Direct To ---
  function _activerDirectTo(targetIdx) {
    const target = flightPlan[targetIdx];
    if (!target || !_lastAircraftPos) return;

    // Etat
    _directToActive = true;
    _directToOrigin = { lat: _lastAircraftPos.lat, lon: _lastAircraftPos.lon };
    _directToTargetIndex = targetIdx;

    // Reset tracking déviation et waypoint pour ce nouveau "leg"
    _lastSoundLegIndex = null;
    _lastSoundSession = false;
    _deviationLegIndex = null;
    _deviationOutside = false;
    _deviationLastAlertTime = 0;

    // Le leg dont l'arrivée est ce waypoint devient actif.
    // Si l'utilisateur cible le waypoint #0 (départ), activeLegIndex = 0
    // (= "rien encore fait"). Sinon, activeLegIndex = targetIdx.
    activeLegIndex = targetIdx;

    // Trace la ligne magenta sur la carte
    _tracerLigneDirectTo(_directToOrigin, target);

    // Redessine table + segments (couleurs mises à jour selon activeLegIndex)
    mettreAJourLogDeNav();

    // Calcul cap / temps / distance et ouvre la modale info
    const info = calcLegInfo(_directToOrigin.lat, _directToOrigin.lon, target.lat, target.lon);
    _afficherInfoDirectTo(target, info);
  }

  // --- Modale 2 : info cap + temps + auto-close 10 s ---
  let _dtInfoTimer = null;
  let _dtInfoStart = 0;
  const DT_INFO_DURATION_MS = 10000;

  function _afficherInfoDirectTo(target, info) {
    if (!dtInfoOverlay) return;
    dtInfoTarget.textContent = (currentLang === 'fr' ? 'Vers ' : 'To ')
      + (target.name || target.ident || '?');
    dtInfoCap.textContent = info.gs > 0
      ? String(Math.round(info.capMagDeg)).padStart(3, '0')
      : '---';
    dtInfoDist.textContent = info.distanceNM.toFixed(1);
    dtInfoTime.textContent = info.tempsFormate;
    dtProgressFill.style.width = '100%';
    dtInfoOverlay.classList.add('visible');

    if (_dtInfoTimer) clearInterval(_dtInfoTimer);
    _dtInfoStart = Date.now();
    _dtInfoTimer = setInterval(() => {
      const elapsed = Date.now() - _dtInfoStart;
      const remaining = Math.max(0, DT_INFO_DURATION_MS - elapsed);
      const pct = (remaining / DT_INFO_DURATION_MS) * 100;
      dtProgressFill.style.width = pct + '%';
      if (remaining <= 0) _fermerDtInfo();
    }, 100);
  }

  function _fermerDtInfo() {
    if (_dtInfoTimer) { clearInterval(_dtInfoTimer); _dtInfoTimer = null; }
    if (dtInfoOverlay) dtInfoOverlay.classList.remove('visible');
  }
  if (btnDtInfoClose) btnDtInfoClose.addEventListener('click', _fermerDtInfo);
  if (dtInfoOverlay) {
    dtInfoOverlay.addEventListener('click', e => {
      if (e.target === dtInfoOverlay) _fermerDtInfo();
    });
  }

  initWaypointModals();

});

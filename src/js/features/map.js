// ============================================================
// NavXpressVFR — map.js
// Initialisation de la carte Leaflet (fonds, calques, aéroports, navaids).
// Extrait de ui.js (Phase 2 — Lot C). Pose window._refreshAirports/_refreshNavaids/_refreshLayersDropdown.
// ============================================================

function initMap() {
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
    // Fond restauré depuis les options (défaut OSM). map.js tourne après
    // chargerOptions() (awaité dans ui.js), donc window.appOptions est prêt.
    const _savedBase = (window.appOptions && window.appOptions.mapBaseLayer) || 'osm';
    let currentLayerIdx = layers.findIndex(l => l.key === _savedBase);
    if (currentLayerIdx < 0) currentLayerIdx = 2; // OSM par défaut
    layers[currentLayerIdx].layer.addTo(map);

    // --- Bouton déroulant de changement de fond ---
    const btnLayerToggle = L.control({ position: 'topright' });
    btnLayerToggle.onAdd = function () {
      const wrapper = L.DomUtil.create('div', 'layer-toggle-wrapper');
      L.DomEvent.disableClickPropagation(wrapper);
      L.DomEvent.disableScrollPropagation(wrapper);

      const btn = L.DomUtil.create('button', 'btn-layer-toggle', wrapper);
      btn.innerHTML = layers[currentLayerIdx].label + ' ▾';

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
        if (opt.key === layers[currentLayerIdx].key) item.classList.add('active');
        item.addEventListener('click', () => {
          map.removeLayer(layers[currentLayerIdx].layer);
          currentLayerIdx = layers.findIndex(l => l.key === opt.key);
          layers[currentLayerIdx].layer.addTo(map);
          setAppOption('mapBaseLayer', opt.key); // persiste le fond choisi
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
    // État initial des calques : restauré depuis window.appOptions (chargé et
    // awaité par ui.js avant initMap). `!== false` → défaut true si absent.
    const _opt = window.appOptions || {};
    let airportsEnabled = _opt.layerAirportsEnabled !== false;
    let heliportsEnabled = _opt.layerHeliportsEnabled !== false;
    let seaplanesEnabled = _opt.layerSeaplanesEnabled !== false;
    let navaidsEnabled = _opt.layerNavaidsEnabled !== false;

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
    const seaplanesLayer = L.layerGroup().addTo(map);
    let _aeroportsMoveTimer = null;
    let _aeroportsLastRequestId = 0;

    // Tailles selon le type d'aéroport (rayon du cercle)
    const TAILLES_AEROPORT = {
      large_airport: 9,
      medium_airport: 7,
      small_airport: 5,
      heliport: 6,
      seaplane_base: 6,
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

      // Hydrobase : cercle bleu eau avec le trait de piste (orienté).
      if (airport.type === 'seaplane_base') {
        const rs = TAILLES_AEROPORT.seaplane_base || 6;
        const sizeS = rs * 2 + 12;
        const headingS = airport.runway ? airport.runway.headingDegT : 0;
        const hasRwyS = !!airport.runway;
        const extS = rs + 4;
        const svgS = `
          <svg viewBox="-${sizeS / 2} -${sizeS / 2} ${sizeS} ${sizeS}" width="${sizeS}" height="${sizeS}" style="overflow:visible;">
            ${hasRwyS ? `<line x1="-${extS}" y1="0" x2="${extS}" y2="0"
                  stroke="#0d4d6e" stroke-width="2.2" stroke-linecap="round"
                  transform="rotate(${headingS - 90})"/>` : ''}
            <circle cx="0" cy="0" r="${rs}" fill="#2970ff" stroke="#0a2a66" stroke-width="1.6"/>
          </svg>
        `;
        return L.divIcon({
          className: 'airport-marker seaplane-marker',
          html: svgS,
          iconSize: [sizeS, sizeS],
          iconAnchor: [sizeS / 2, sizeS / 2],
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
      // Aéroports, hélistations et hydrobases partagent la même requête bbox
      // mais sont rendus dans des couches distinctes, pilotées par trois toggles.
      if (!airportsEnabled && !heliportsEnabled && !seaplanesEnabled) {
        airportsLayer.clearLayers();
        heliportsLayer.clearLayers();
        seaplanesLayer.clearLayers();
        return;
      }
      const zoom = map.getZoom();
      if (zoom < ZOOM_MIN_AEROPORTS) {
        airportsLayer.clearLayers();
        heliportsLayer.clearLayers();
        seaplanesLayer.clearLayers();
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
        seaplanesLayer.clearLayers();
        return;
      }

      airportsLayer.clearLayers();
      heliportsLayer.clearLayers();
      seaplanesLayer.clearLayers();
      for (const a of res.airports) {
        const isHeli = a.type === 'heliport';
        const isSeaplane = a.type === 'seaplane_base';
        // Chaque type respecte son propre toggle
        const enabled = isHeli ? heliportsEnabled : isSeaplane ? seaplanesEnabled : airportsEnabled;
        if (!enabled) continue;
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
        marker.addTo(isHeli ? heliportsLayer : isSeaplane ? seaplanesLayer : airportsLayer);
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
          { id: 'seaplanes', labelFr: 'Hydrobases', labelEn: 'Seaplane bases', checked: seaplanesEnabled },
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
              setAppOption('layerAirportsEnabled', on);
              if (on) refreshAirportsOnMap(); else airportsLayer.clearLayers();
            } else if (it.id === 'heliports') {
              heliportsEnabled = on;
              setAppOption('layerHeliportsEnabled', on);
              if (on) refreshAirportsOnMap(); else heliportsLayer.clearLayers();
            } else if (it.id === 'seaplanes') {
              seaplanesEnabled = on;
              setAppOption('layerSeaplanesEnabled', on);
              if (on) refreshAirportsOnMap(); else seaplanesLayer.clearLayers();
            } else if (it.id === 'navaids') {
              navaidsEnabled = on;
              setAppOption('layerNavaidsEnabled', on);
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
}

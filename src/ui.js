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

  initFlightPlanIO();

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

  // calcLegInfo() → déplacé vers js/nav-core.js (partagé fuel/Direct To)

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

  initFuel();

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

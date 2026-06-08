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
// NavXpressVFR — flightplan-io.js
// Création / import .lnmpln / charger & sauver .navxpv
// Extrait de ui.js (Phase 2 — Lot B).
// ============================================================

function initFlightPlanIO() {
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
        document.getElementById('create-icao-dep'),
        'dep-lat-dir',
        'dep-lon-dir'
      );
    });

    document.getElementById('btn-search-arr').addEventListener('click', () => {
      rechercherAeroport(
        document.getElementById('create-icao-arr').value,
        document.getElementById('search-status-arr'),
        document.getElementById('create-lat-arr'),
        document.getElementById('create-lon-arr'),
        document.getElementById('create-icao-arr'),
        'arr-lat-dir',
        'arr-lon-dir'
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
      if (typeof window.effacerTousReperesVisuels === 'function') window.effacerTousReperesVisuels();

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
      const bounds = L.latLngBounds(flightPlanDisplayLatLngs());
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
        if (typeof window.effacerTousReperesVisuels === 'function') window.effacerTousReperesVisuels();

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
          const bounds = L.latLngBounds(flightPlanDisplayLatLngs());
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
        if (typeof window.effacerTousReperesVisuels === 'function') window.effacerTousReperesVisuels();
        if (typeof window.effacerTousFlanquements === 'function') window.effacerTousFlanquements();

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
          const bounds = L.latLngBounds(flightPlanDisplayLatLngs());
          map.fitBounds(bounds, { padding: [50, 50] });
        }

        // Repères visuels du plan (cercles jaunes)
        if (typeof window.chargerReperesVisuels === 'function') {
          window.chargerReperesVisuels(data.markers);
        }

        // Flanquements VOR (radiaux) — APRÈS calculerDeclinaisonCentroide ci-dessus
        // (le radial magnétique en dépend) et APRÈS chargement des repères (cibles).
        if (typeof window.chargerFlanquements === 'function') {
          window.chargerFlanquements(data.flanquements);
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
        // Repères visuels (cercles jaunes posés à la main) — on ne sérialise pas
        // l'objet Leaflet, seulement nom / description / coordonnées.
        markers: (typeof reperesVisuels !== 'undefined' ? reperesVisuels : []).map(r => ({
          name: r.name || '',
          description: r.description || '',
          lat: r.lat,
          lon: r.lon,
        })),
        // Flanquements VOR (radiaux tracés vers un point/repère) — on sérialise
        // l'identité de la station + la géométrie ; radial/distance recalculés
        // au chargement (la déclinaison magnétique peut avoir changé).
        flanquements: (typeof flanquements !== 'undefined' ? flanquements : []).map(f => ({
          vorIdent: f.vorIdent || '',
          vorLat: f.vorLat,
          vorLon: f.vorLon,
          targetName: f.targetName || '',
          targetKind: f.targetKind || 'waypoint',
          lat: f.lat,
          lon: f.lon,
          rangeNM: f.rangeNM,
        })),
      };

      const result = await window.api.sauvegarderNavXpv(planData);
      if (result && result.ok) {
        showToast(t('saveSuccess'), 'success');
      } else if (result && !result.canceled) {
        showToast('❌ ' + (result.error || 'Erreur sauvegarde'), 'error');
      }
    });
  }
}

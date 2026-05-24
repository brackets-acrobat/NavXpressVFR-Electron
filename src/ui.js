// ============================================================
// NavXpressVFR — ui.js  (version bilingue FR/EN)
// Dépend de i18n.js chargé avant ce fichier
// ============================================================

let flightPlan = [];
let map;
let flightPathLine;
let marqueursCarte = [];
let declinaisonMoyenneGlobale = 0.0;
let activeLegIndex = 1; // Le leg actif (1-based, correspond au numéro affiché)

document.addEventListener('DOMContentLoaded', async () => {
  console.log("UI NavXpressVFR chargée et prête.");

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
    });
  }

  // --- 1. Initialisation de la carte Leaflet ---
  try {
    map = L.map('map-container').setView([45.70, 2.03], 9);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Tiles &copy; Esri',
      maxZoom: 19
    }).addTo(map);

    flightPathLine = L.polyline([], { color: '#ff1744', weight: 3, opacity: 0.8 }).addTo(map);
    console.log("Carte Leaflet initialisée avec succès.");
  } catch (mapError) {
    console.error("Erreur d'initialisation de la carte:", mapError);
  }

  // --- 2. BOUTON : NOUVEAU (reset) ---
  const btnNew = document.getElementById('btn-new-flight');
  if (btnNew) {
    btnNew.addEventListener('click', () => {
      if (confirm(t('confirmReset'))) {
        flightPlan = [];
        declinaisonMoyenneGlobale = 0.0;
        activeLegIndex = 1;
        document.getElementById('input-icao-dep').value = '';
        document.getElementById('input-icao-arr').value = '';
        marqueursCarte.forEach(m => map.removeLayer(m));
        marqueursCarte = [];
        flightPathLine.setLatLngs([]);
        actualiserAffichageDeclinaison();
        mettreAJourLogDeNav();
      }
    });
  }

  // --- 3. BOUTON : IMPORTER .LNMPLN ---
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
        activeLegIndex = 1;
        marqueursCarte.forEach(m => map.removeLayer(m));
        marqueursCarte = [];
        flightPathLine.setLatLngs([]);

        for (let i = 0; i < waypointsXML.length; i++) {
          const wp = waypointsXML[i];
          const ident = wp.getElementsByTagName("Ident")[0]?.textContent || `WP${i}`;
          const name  = wp.getElementsByTagName("Name")[0]?.textContent  || ident;
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

        // Injection des ICAO départ / arrivée dans la config vol
        if (flightPlan.length >= 1) {
          const inputDep = document.getElementById('input-icao-dep');
          const inputArr = document.getElementById('input-icao-arr');
          if (inputDep) inputDep.value = flightPlan[0].ident;
          if (inputArr) inputArr.value = flightPlan[flightPlan.length - 1].ident;
        }

        await calculerDeclinaisonCentroide();
        flightPlan.forEach(point => tracerPointVisuel(point));

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

  // --- 5. BOUTON : AJOUTER UN WAYPOINT MANUELLEMENT ---
  const btnAdd = document.getElementById('btn-add-waypoint');
  if (btnAdd) {
    btnAdd.addEventListener('click', async () => {
      const nameInput = document.getElementById('waypoint-name');
      const latInput  = document.getElementById('waypoint-lat');
      const lonInput  = document.getElementById('waypoint-lon');

      const name = nameInput.value.trim().toUpperCase();
      const lat  = parseFloat(latInput.value);
      const lon  = parseFloat(lonInput.value);

      if (!name || isNaN(lat) || isNaN(lon)) {
        alert(t('fillFields'));
        return;
      }

      const newPoint = { name, lat, lon };
      flightPlan.push(newPoint);
      await calculerDeclinaisonCentroide();
      tracerPointVisuel(newPoint);

      if (flightPlan.length === 1) {
        map.panTo([lat, lon]);
      } else {
        const bounds = L.latLngBounds(flightPlan.map(p => [p.lat, p.lon]));
        map.fitBounds(bounds, { padding: [50, 50] });
      }

      mettreAJourLogDeNav();
      nameInput.value = '';
      latInput.value  = '';
      lonInput.value  = '';
    });
  }

  // --- 6. Validation et recalcul en temps réel ---

  // Champs ICAO en lecture seule — remplis automatiquement à l'import

  // --- Popup d'avertissement custom ---
  const overlay   = document.getElementById('warning-overlay');
  const warnMsg   = document.getElementById('warning-message');
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

  const inputWindDir   = document.getElementById('input-wind-dir');
  const inputWindSpeed = document.getElementById('input-wind-speed');
  const inputVp        = document.getElementById('input-vp');

  if (inputWindDir)   validerAuBlur(inputWindDir,   val => isNaN(val) || val < 0 || val > 360, 'alertWindDirInvalid');
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
  if (inputVp)        validerAuBlur(inputVp,        val => isNaN(val) || val < 40 || val > 250,'alertVpInvalid');

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
});

// -------------------------------------------------------
// Rendu visuel d'un point sur la carte
// -------------------------------------------------------
function tracerPointVisuel(point) {
  if (!map) return;

  const stylePointVFR = {
    radius: 5,
    fillColor: "#ff7043",
    color: "#ffffff",
    weight: 1.5,
    opacity: 1,
    fillOpacity: 0.9
  };

  const popupText = `<b>${point.name}</b>`;
  const marqueur = L.circleMarker([point.lat, point.lon], stylePointVFR)
    .addTo(map)
    .bindPopup(popupText);

  marqueursCarte.push(marqueur);
  flightPathLine.addLatLng([point.lat, point.lon]);
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
    tbody.innerHTML = `<tr class="empty-row"><td colspan="10">${t('emptyPlan')}</td></tr>`;
    return;
  }

  const vp       = parseFloat(document.getElementById('input-vp').value) || 90;
  const dirVent  = parseFloat(document.getElementById('input-wind-dir').value) || 0;
  const vitVent  = parseFloat(document.getElementById('input-wind-speed').value) || 0;

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
    const isDone  = i < activeLegIndex;   // legs au-dessus du leg actif = terminés
    const isActive = i === activeLegIndex; // leg actif courant

    // 7. Injection dans le tableau
    const row = document.createElement('tr');
    row.dataset.legIndex = i;

    // Construire le HTML d'abord
    row.innerHTML = `
      <td><b>${i}</b></td>
      <td>${ptA.name}</td>
      <td>${ptB.name}</td>
      <td>3000</td>
      <td>${distanceNM.toFixed(1)}</td>
      <td>${Math.round(rvDeg).toString().padStart(3, '0')}°</td>
      <td>${Math.round(capMagDeg).toString().padStart(3, '0')}°</td>
      <td>${Math.round(gs)}</td>
      <td>${tempsFormate}</td>
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
    row.querySelector('td:last-child').appendChild(checkbox);

    tbody.appendChild(row);
  }
}

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
// NavXpressVFR — options.js
// Bouton "⚙️ Options" du header + modale Options + état persistant.
//
// Persistance : fichier Documents/NavXpressVFR/options.json
// (handlers IPC lire-options / sauvegarder-options dans main.js).
//
// État partagé : window.appOptions — plain object, lu par les features
// concernées (ex : agl-warning.js teste window.appOptions.aglWarningEnabled).
// Les defaults sont définis ici et toujours appliqués par-dessus les
// valeurs persistées : si un toggle n'existait pas à la version précédente,
// il prend la valeur par défaut au prochain démarrage.
//
// chargerOptions() est appelé tôt par ui.js (avant les init*) — async.
// initOptions() câble la modale (ouvrir/fermer) et synchronise les
// checkboxes avec window.appOptions.
// ============================================================

// Valeurs par défaut. AGL warning à true → préserve le comportement
// existant pour quiconque mettait l'app à jour sans modifier ses options.
const DEFAULT_OPTIONS = {
  aglWarningEnabled: true,
  routeDeviationEnabled: true,
  waypointAnnounceEnabled: true,
  touchAnnounceEnabled: true,
  downwindAnnounceEnabled: true,
  finalArrivalEnabled: true,
  logbookEnabled: true,
  precisionEnabled: true,
  // Volume global des sons (0..1). Appliqué par sounds.js sur chaque audio
  // juste avant lecture. Défaut 1 → comportement inchangé.
  soundVolume: 1,
  // Mode de navigation : false = normal (marges actuelles), true = difficile
  // (marges réduites). Lu par sim.js : couloir de déviation 1,2→0,7 NM et rayon
  // waypoint/toucher/bascule de leg 1,5→1,0 NM. Défaut false → comportement inchangé.
  hardNavigationMode: false,
  // Préférences d'affichage carte (restaurées au démarrage). Gérées par map.js
  // via setAppOption — pas d'UI dans la modale Options.
  layerAirportsEnabled: true,
  layerHeliportsEnabled: true,
  layerSeaplanesEnabled: true,
  layerNavaidsEnabled: true,
  mapBaseLayer: 'osm', // 'satellite' | 'topo' | 'osm' | 'positron' | 'dark'
  // Mode nuit carte : assombrit uniquement les tuiles (.leaflet-tile-pane).
  // false = jour (comportement inchangé). Géré par map-search.js (toggle 🌙).
  mapNightMode: false,
};

// État global mutable (lecture par d'autres features, écriture via setAppOption).
window.appOptions = { ...DEFAULT_OPTIONS };

async function chargerOptions() {
  if (!window.api || typeof window.api.lireOptions !== 'function') return;
  try {
    const saved = await window.api.lireOptions();
    if (saved && typeof saved === 'object') {
      // On n'autorise que les clés connues — évite qu'un fichier corrompu
      // injecte des champs inattendus dans window.appOptions.
      for (const k of Object.keys(DEFAULT_OPTIONS)) {
        if (k in saved) window.appOptions[k] = saved[k];
      }
    }
  } catch (err) {
    console.warn("Impossible de lire les options :", err);
  }
}

// Set + persistance asynchrone. La valeur en mémoire est mise à jour
// synchrone (lecture immédiate possible par les features) ; l'écriture
// fichier part en parallèle, les erreurs sont loggées sans bloquer l'UI.
//
// On dispatche aussi un event 'app-option-changed' pour permettre aux
// features de réagir à un changement (ex : sim.js reset _lastSoundLegIndex
// quand on réactive un toggle son, pour rejouer l'annonce si l'avion est
// encore dans le rayon).
function setAppOption(key, value) {
  window.appOptions[key] = value;
  document.dispatchEvent(new CustomEvent('app-option-changed', { detail: { key, value } }));
  if (!window.api || typeof window.api.sauvegarderOptions !== 'function') return;
  // On envoie l'objet complet — handler main.js écrase le fichier.
  window.api.sauvegarderOptions({ ...window.appOptions }).catch(err => {
    console.warn("Échec sauvegarde options :", err);
  });
}

function initOptions() {
  const btnOptions = document.getElementById('btn-options');
  const optionsOverlay = document.getElementById('options-overlay');
  const btnOptionsClose = document.getElementById('btn-options-close');

  // Toggle "Alerte audio < 500 ft AGL"
  const cbAglWarning = document.getElementById('opt-agl-warning');
  if (cbAglWarning) {
    // État initial = valeur actuellement chargée
    cbAglWarning.checked = !!window.appOptions.aglWarningEnabled;
    cbAglWarning.addEventListener('change', () => {
      setAppOption('aglWarningEnabled', cbAglWarning.checked);
    });
  }

  // Toggle "Alerte de déviation de la route"
  const cbRouteDeviation = document.getElementById('opt-route-deviation');
  if (cbRouteDeviation) {
    cbRouteDeviation.checked = !!window.appOptions.routeDeviationEnabled;
    cbRouteDeviation.addEventListener('change', () => {
      setAppOption('routeDeviationEnabled', cbRouteDeviation.checked);
    });
  }

  // Toggle "Annonce d'arrivée au point tournant (waypoint)"
  const cbWaypointAnnounce = document.getElementById('opt-waypoint-announce');
  if (cbWaypointAnnounce) {
    cbWaypointAnnounce.checked = !!window.appOptions.waypointAnnounceEnabled;
    cbWaypointAnnounce.addEventListener('change', () => {
      setAppOption('waypointAnnounceEnabled', cbWaypointAnnounce.checked);
    });
  }

  // Toggle "Annonce d'arrivée pour tour de piste / touché"
  const cbTouchAnnounce = document.getElementById('opt-touch-announce');
  if (cbTouchAnnounce) {
    cbTouchAnnounce.checked = !!window.appOptions.touchAnnounceEnabled;
    cbTouchAnnounce.addEventListener('change', () => {
      setAppOption('touchAnnounceEnabled', cbTouchAnnounce.checked);
    });
  }

  // Toggle "Annonce de vent arrière (tour de piste)"
  const cbDownwindAnnounce = document.getElementById('opt-downwind-announce');
  if (cbDownwindAnnounce) {
    cbDownwindAnnounce.checked = !!window.appOptions.downwindAnnounceEnabled;
    cbDownwindAnnounce.addEventListener('change', () => {
      setAppOption('downwindAnnounceEnabled', cbDownwindAnnounce.checked);
    });
  }

  // Toggle "Son d'arrivée finale (cuckoo)"
  const cbFinalArrival = document.getElementById('opt-final-arrival');
  if (cbFinalArrival) {
    cbFinalArrival.checked = !!window.appOptions.finalArrivalEnabled;
    cbFinalArrival.addEventListener('change', () => {
      setAppOption('finalArrivalEnabled', cbFinalArrival.checked);
    });
  }

  // Toggle "Logbook automatique"
  const cbLogbook = document.getElementById('opt-logbook-enabled');
  if (cbLogbook) {
    cbLogbook.checked = !!window.appOptions.logbookEnabled;
    cbLogbook.addEventListener('change', () => {
      setAppOption('logbookEnabled', cbLogbook.checked);
    });
  }

  // Toggle "Évaluation de précision du vol".
  // NB : la checkbox est verrouillée (disabled) en vol par precision.js
  // (impossible d'activer/désactiver une fois l'avion en l'air).
  const cbPrecision = document.getElementById('opt-precision-enabled');
  if (cbPrecision) {
    cbPrecision.checked = !!window.appOptions.precisionEnabled;
    cbPrecision.addEventListener('change', () => {
      setAppOption('precisionEnabled', cbPrecision.checked);
    });
  }

  // Glissière "Volume des sons" (0..100 % → soundVolume 0..1).
  const sliderVolume = document.getElementById('opt-sound-volume');
  const sliderVolumeVal = document.getElementById('opt-sound-volume-val');
  function _syncVolumeUI() {
    if (!sliderVolume) return;
    const cur = (typeof window.appOptions.soundVolume === 'number') ? window.appOptions.soundVolume : 1;
    const pct = Math.round(cur * 100);
    sliderVolume.value = String(pct);
    if (sliderVolumeVal) sliderVolumeVal.textContent = pct + ' %';
  }
  // Élément d'aperçu réutilisé (un seul → évite d'accumuler des nœuds Web Audio
  // côté sounds.js quand on déplace souvent la glissière).
  let _previewAudio = null;
  if (sliderVolume) {
    _syncVolumeUI();
    // input : maj live de la valeur en mémoire + affichage (PAS d'écriture disque
    // à chaque pixel — sounds.js lit window.appOptions.soundVolume en direct).
    sliderVolume.addEventListener('input', () => {
      const pct = parseInt(sliderVolume.value, 10) || 0;
      window.appOptions.soundVolume = pct / 100;
      if (sliderVolumeVal) sliderVolumeVal.textContent = pct + ' %';
    });
    // change (relâchement) : persistance + aperçu sonore au nouveau volume.
    sliderVolume.addEventListener('change', () => {
      const pct = parseInt(sliderVolume.value, 10) || 0;
      setAppOption('soundVolume', pct / 100);
      if (typeof _jouerSon === 'function') {
        if (!_previewAudio) _previewAudio = new Audio('sounds/waypoint_en.mp3');
        _jouerSon(_previewAudio);
      }
    });
  }

  // Toggle "Navigation en mode difficile".
  // NB : la checkbox est verrouillée (disabled) en vol — voir le listener
  // onFlightAirborne plus bas (impossible de changer de mode une fois décollé).
  const cbHardNav = document.getElementById('opt-hard-nav');
  if (cbHardNav) {
    cbHardNav.checked = !!window.appOptions.hardNavigationMode;
    cbHardNav.addEventListener('change', () => {
      setAppOption('hardNavigationMode', cbHardNav.checked);
    });
  }

  // Verrou du toggle difficulté en vol : grisé dès que l'avion est en l'air,
  // réactivé au sol (ou à la déconnexion du simulateur). On s'appuie sur l'état
  // « airborne » (SimVar SIM ON GROUND) diffusé par main, INDÉPENDANT du carnet
  // de vol → le verrou fonctionne même quand le logbook est désactivé.
  if (cbHardNav && window.api && typeof window.api.onFlightAirborne === 'function') {
    window.api.onFlightAirborne((s) => {
      if (!s) return;
      cbHardNav.disabled = !!s.airborne;
    });
  }

  // Lien "(voir les marges)" → ouvre la modale comparative des marges.
  // Le lien est DANS le <label for="opt-hard-nav"> : sans preventDefault +
  // stopPropagation, cliquer le lien basculerait aussi la checkbox.
  const margesOverlay = document.getElementById('margins-overlay');
  const linkShowMargins = document.getElementById('link-show-margins');
  const btnMarginsClose = document.getElementById('btn-margins-close');

  function _fermerMarges() {
    if (margesOverlay) margesOverlay.classList.remove('visible');
  }

  if (linkShowMargins && margesOverlay) {
    linkShowMargins.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      margesOverlay.classList.add('visible');
    });
  }
  if (btnMarginsClose) btnMarginsClose.addEventListener('click', _fermerMarges);
  if (margesOverlay) {
    margesOverlay.addEventListener('click', e => {
      if (e.target === margesOverlay) _fermerMarges();
    });
  }

  function _ouvrirOptions() {
    if (!optionsOverlay) return;
    // Resynchronise les checkboxes au cas où l'état aurait changé ailleurs.
    if (cbAglWarning) cbAglWarning.checked = !!window.appOptions.aglWarningEnabled;
    if (cbRouteDeviation) cbRouteDeviation.checked = !!window.appOptions.routeDeviationEnabled;
    if (cbWaypointAnnounce) cbWaypointAnnounce.checked = !!window.appOptions.waypointAnnounceEnabled;
    if (cbTouchAnnounce) cbTouchAnnounce.checked = !!window.appOptions.touchAnnounceEnabled;
    if (cbDownwindAnnounce) cbDownwindAnnounce.checked = !!window.appOptions.downwindAnnounceEnabled;
    if (cbFinalArrival) cbFinalArrival.checked = !!window.appOptions.finalArrivalEnabled;
    if (cbLogbook) cbLogbook.checked = !!window.appOptions.logbookEnabled;
    if (cbPrecision) cbPrecision.checked = !!window.appOptions.precisionEnabled;
    if (cbHardNav) cbHardNav.checked = !!window.appOptions.hardNavigationMode;
    _syncVolumeUI();
    optionsOverlay.classList.add('visible');
  }

  function _fermerOptions() {
    if (optionsOverlay) optionsOverlay.classList.remove('visible');
  }

  if (btnOptions) btnOptions.addEventListener('click', _ouvrirOptions);
  if (btnOptionsClose) btnOptionsClose.addEventListener('click', _fermerOptions);

  // Clic sur l'overlay (en dehors de la popup) → fermeture
  if (optionsOverlay) {
    optionsOverlay.addEventListener('click', e => {
      if (e.target === optionsOverlay) _fermerOptions();
    });
  }

  // Modale "À propos" (bouton "?" du header)
  const btnAbout = document.getElementById('btn-about');
  const aboutOverlay = document.getElementById('about-overlay');
  const btnAboutClose = document.getElementById('btn-about-close');

  function _fermerAbout() {
    if (aboutOverlay) aboutOverlay.classList.remove('visible');
  }
  if (btnAbout && aboutOverlay) {
    btnAbout.addEventListener('click', () => aboutOverlay.classList.add('visible'));
  }
  if (btnAboutClose) btnAboutClose.addEventListener('click', _fermerAbout);
  if (aboutOverlay) {
    aboutOverlay.addEventListener('click', e => {
      if (e.target === aboutOverlay) _fermerAbout();
    });
  }

  // Touche Escape → fermeture. La modale Marges s'empile au-dessus des Options :
  // on la ferme en priorité (et on s'arrête là pour ne pas fermer aussi Options).
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (aboutOverlay && aboutOverlay.classList.contains('visible')) {
      _fermerAbout();
      return;
    }
    if (margesOverlay && margesOverlay.classList.contains('visible')) {
      _fermerMarges();
      return;
    }
    if (optionsOverlay && optionsOverlay.classList.contains('visible')) {
      _fermerOptions();
    }
  });
}

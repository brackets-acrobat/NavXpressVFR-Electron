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
  finalArrivalEnabled: true,
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

  // Toggle "Son d'arrivée finale (cuckoo)"
  const cbFinalArrival = document.getElementById('opt-final-arrival');
  if (cbFinalArrival) {
    cbFinalArrival.checked = !!window.appOptions.finalArrivalEnabled;
    cbFinalArrival.addEventListener('change', () => {
      setAppOption('finalArrivalEnabled', cbFinalArrival.checked);
    });
  }

  function _ouvrirOptions() {
    if (!optionsOverlay) return;
    // Resynchronise les checkboxes au cas où l'état aurait changé ailleurs.
    if (cbAglWarning) cbAglWarning.checked = !!window.appOptions.aglWarningEnabled;
    if (cbRouteDeviation) cbRouteDeviation.checked = !!window.appOptions.routeDeviationEnabled;
    if (cbWaypointAnnounce) cbWaypointAnnounce.checked = !!window.appOptions.waypointAnnounceEnabled;
    if (cbTouchAnnounce) cbTouchAnnounce.checked = !!window.appOptions.touchAnnounceEnabled;
    if (cbFinalArrival) cbFinalArrival.checked = !!window.appOptions.finalArrivalEnabled;
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

  // Touche Escape → fermeture
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && optionsOverlay && optionsOverlay.classList.contains('visible')) {
      _fermerOptions();
    }
  });
}

// ============================================================
// NavXpressVFR — sim.js
// Connexion MSFS (SimConnect) : badge état, injection vent, suivi de leg,
// alertes de proximité / déviation, sons. Extrait de ui.js (Phase 2 — Lot C).
// Expose window.appliquerEtatSim (utilisé par le toggle i18n).
// ============================================================

function initSim() {
  // Réfs des champs vent (réacquises ici ; validation les déclare de son côté)
  const inputWindDir = document.getElementById('input-wind-dir');
  const inputWindSpeed = document.getElementById('input-wind-speed');

  // ----------------------------------------------------------
  // SimConnect : connexion MSFS + injection vent
  // ----------------------------------------------------------
  const statusBadge = document.getElementById('sim-status');
  // _simState : hissé dans globals.js (Lot C, C0)

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
      }
      if (typeof mettreAJourLogDeNav === 'function') mettreAJourLogDeNav();
    } else if (!insideRadius && _lastSoundSession) {
      // L'avion sort du rayon. On garde _lastSoundLegIndex mémorisé pour ne pas
      // rejouer s'il revient dans le rayon sur le MÊME leg (pas d'oscillation).
      _lastSoundSession = false;
    }
  });

  // Pont pour le toggle i18n (réappliquer le badge dans la nouvelle langue)
  window.appliquerEtatSim = appliquerEtatSim;
}

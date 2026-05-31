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

  // Identifiant de "session de tracking". Pour les legs du plan : c'est l'index
  // du leg (entier ≥ 1). Pour un Direct To vers aéroport hors plan : la valeur
  // sentinelle 'ext'. Changer d'identifiant reset les sons/déviation pour
  // démarrer une nouvelle session proprement.
  let _lastSoundLegIndex = null;     // session pour laquelle le son d'arrivée a déjà été joué
  let _lastSoundSession = false;     // mémoire qu'on était DANS le rayon au précédent tick

  // État de l'alerte d'écart latéral
  let _deviationLegIndex = null;     // session pour laquelle on a alerté la dernière fois
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

    // --- Choix du mode + dep/arr/sessionId ---
    // 3 modes :
    //   'ext'      : Direct To vers aéroport hors plan         → dep = origin gelée, arr = target externe
    //   'plan-dt'  : Direct To vers waypoint du plan           → dep = origin gelée, arr = flightPlan[activeLegIndex]
    //   'plan'     : suivi normal du leg actif                 → dep = flightPlan[activeLegIndex-1], arr = flightPlan[activeLegIndex]
    // sessionId identifie la session de tracking ('ext' pour externe, sinon activeLegIndex).
    let mode, dep, arr, sessionId;
    if (_directToExternalActive && _directToExternalTarget && _directToOrigin) {
      mode = 'ext';
      dep = _directToOrigin;
      arr = _directToExternalTarget;
      sessionId = 'ext';
    } else {
      if (!flightPlan || flightPlan.length < 2) return;
      if (activeLegIndex < 1 || activeLegIndex >= flightPlan.length) return;
      if (_directToActive && _directToOrigin) {
        mode = 'plan-dt';
        dep = _directToOrigin;
      } else {
        mode = 'plan';
        dep = flightPlan[activeLegIndex - 1];
      }
      arr = flightPlan[activeLegIndex];
      sessionId = activeLegIndex;
    }

    // Changement de session → reset tracking son d'arrivée + déviation
    if (_lastSoundLegIndex !== null && _lastSoundLegIndex !== sessionId) {
      _lastSoundLegIndex = null;
      _lastSoundSession = false;
    }
    if (_deviationLegIndex !== null && _deviationLegIndex !== sessionId) {
      _deviationLegIndex = null;
      _deviationOutside = false;
      _deviationLastAlertTime = 0;
    }

    const distance = _distanceNM(pos.lat, pos.lon, arr.lat, arr.lon);
    const insideRadius = distance < WAYPOINT_RADIUS_NM;

    // --- Vérification de l'écart latéral à la trajectoire active ---
    // Toggle utilisateur (modale Options) : alerte de déviation désactivée
    // → reset état + skip tout le bloc. Si l'utilisateur réactive l'option
    // alors qu'on est en déviation, la transition false → _deviationOutside
    // au tick suivant déclenchera une alerte fraîche (pas d'attente du
    // rappel 2 min), même comportement que l'AGL.
    if (dep && window.appOptions && window.appOptions.routeDeviationEnabled === false) {
      if (_deviationOutside) {
        _deviationOutside = false;
        _deviationLastAlertTime = 0;
      }
    } else if (dep) {
      // ZONES DE SUSPENSION DES ALERTES DE DÉVIATION :
      //  1. Tour de piste : à < 2 NM d'un aéroport (dep ou arr) marqué pour un
      //     tour de piste — le pilote tourne, l'écart à la trajectoire est attendu.
      //     En mode 'ext', dep est la position avion gelée (pas un aéroport) → seul
      //     arr.pattern compte.
      //  2. Approche d'arrivée : à < 1,5 NM (= WAYPOINT_RADIUS_NM) du point d'arrivée,
      //     on suspend les alertes pour tous les arrivées (pattern ou non). Pour les
      //     legs du plan, ça aligne le comportement avec le franchissement du rayon
      //     d'annonce (le leg bascule à 1,5 NM, donc plus d'alerte de toute façon).
      //  3. Direct To externe juste arrivé : on vient de basculer en mode 'plan' sur
      //     le leg N+1, mais l'avion est encore près de l'aéroport visité — pas sur
      //     le nouveau leg. Tant qu'on reste proche du dernier point d'arrivée
      //     externe (2 NM si pattern, 1,5 NM sinon), on suspend les alertes.
      //     Libération par hystérésis quand l'avion s'éloigne (> 2× le rayon).
      const distToDep = _distanceNM(pos.lat, pos.lon, dep.lat, dep.lon);

      let nearExtArrived = false;
      if (_extDtLastArrival) {
        const dExt = _distanceNM(
          pos.lat, pos.lon, _extDtLastArrival.lat, _extDtLastArrival.lon
        );
        const rExt = _extDtLastArrival.pattern ? PATTERN_RADIUS_NM : WAYPOINT_RADIUS_NM;
        if (dExt > rExt * 2) {
          _extDtLastArrival = null;   // hystérésis — libère la mémoire
        } else if (dExt < rExt) {
          nearExtArrived = true;
        }
      }

      const inPatternZone =
        (dep.pattern && distToDep < PATTERN_RADIUS_NM) ||
        (arr.pattern && distance < PATTERN_RADIUS_NM) ||
        (distance < WAYPOINT_RADIUS_NM) ||
        nearExtArrived;

      if (inPatternZone) {
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
            _jouerSonDeviation();
            _deviationOutside = true;
            _deviationLegIndex = sessionId;
            _deviationLastAlertTime = now;
          } else if (now - _deviationLastAlertTime >= DEVIATION_REMIND_MS) {
            _jouerSonDeviation();
            _deviationLastAlertTime = now;
          }
        } else if (_deviationOutside) {
          _deviationOutside = false;
          _deviationLastAlertTime = 0;
        }
      }
    }

    // --- Détection de FRANCHISSEMENT du rayon d'arrivée ---
    if (insideRadius && _lastSoundLegIndex !== sessionId) {
      // Son d'arrivée selon le mode
      if (mode === 'ext') {
        // Direct To externe : son "touch" si pattern, sinon son waypoint
        // (jamais le cuckoo : il est réservé à la dernière étape du plan)
        if (arr.pattern) {
          _jouerSonTouch();
        } else {
          _jouerSonWaypoint();
        }
      } else {
        // Modes plan / plan-dt : logique inchangée
        const estDernierLeg = (activeLegIndex === flightPlan.length - 1);
        if (arr.pattern) {
          _jouerSonTouch();
        } else if (estDernierLeg) {
          _jouerSonArrivee();
        } else {
          _jouerSonWaypoint();
        }
      }
      _lastSoundLegIndex = sessionId;
      _lastSoundSession = true;

      if (mode === 'ext') {
        // Arrivée à l'aéroport / point hors plan : on sort du mode externe.
        // Le leg actif devient le leg qui SUIT celui qu'on a quitté à l'activation.
        // C'est ensuite à l'utilisateur de décider quoi faire.
        //
        // On mémorise le point d'arrivée pour suspendre les alertes de déviation
        // tant que l'avion reste à proximité (sinon le nouveau leg du plan
        // calculerait un gros XTD et alerterait alors qu'on vient juste d'arriver).
        _extDtLastArrival = { lat: arr.lat, lon: arr.lon, pattern: !!arr.pattern };
        const next = (_directToReturnLegIndex || 0) + 1;
        activeLegIndex = next;
        _directToExternalActive = false;
        _directToExternalTarget = null;
        _directToReturnLegIndex = null;
        _directToOrigin = null;
        // Retire le marqueur rouge si la cible était un point carte
        if (typeof window._supprimerMarqueurPointDt === 'function') {
          window._supprimerMarqueurPointDt();
        }
      } else {
        // Comportement existant : auto-validation du leg
        activeLegIndex = activeLegIndex + 1;
        if (_directToActive) {
          _directToActive = false;
          _directToOrigin = null;
          _directToTargetIndex = null;
        }
      }
      if (typeof mettreAJourLogDeNav === 'function') mettreAJourLogDeNav();
    } else if (!insideRadius && _lastSoundSession) {
      // L'avion sort du rayon. On garde _lastSoundLegIndex mémorisé pour éviter
      // l'oscillation si l'avion fait des allers-retours sur la même session.
      _lastSoundSession = false;
    }
  });

  // Pont pour le toggle i18n (réappliquer le badge dans la nouvelle langue)
  window.appliquerEtatSim = appliquerEtatSim;
}

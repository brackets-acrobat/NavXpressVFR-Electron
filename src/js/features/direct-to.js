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
// NavXpressVFR — direct-to.js
// Direct To : bouton + 2 modales + logique.
// Extrait de ui.js (Phase 2 — Lot C).
// Utilise calcLegInfo (nav-core), _simState (globals). Installe le décorateur #2.
// ============================================================

function initDirectTo() {
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

  // --- Réfs section recherche aéroport ICAO (hors plan) ---
  const dtAirportIcao = document.getElementById('dt-airport-icao');
  const btnDtAirportSearch = document.getElementById('btn-dt-airport-search');
  const dtAirportStatus = document.getElementById('dt-airport-status');
  const dtConfirmOverlay = document.getElementById('dt-airport-confirm-overlay');
  const dtConfirmText = document.getElementById('dt-airport-confirm-text');
  const btnDtAirportConfirmYes = document.getElementById('btn-dt-airport-confirm-yes');
  const btnDtAirportConfirmNo = document.getElementById('btn-dt-airport-confirm-no');

  // Cible airport sélectionnée (résultat de la dernière recherche OK et ≤ 80 NM)
  // { lat, lon, code, name, distance } — null si pas de cible.
  const DT_AIRPORT_MAX_NM = 80;
  let _dtAirportCandidate = null;

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

  // --- Helpers ---
  function _resetAirportSection() {
    _dtAirportCandidate = null;
    if (dtAirportIcao) dtAirportIcao.value = '';
    if (dtAirportStatus) {
      dtAirportStatus.className = 'search-status';
      dtAirportStatus.textContent = '';
    }
  }

  // Distance grand-cercle NM (formule haversine), copiée localement pour ne pas
  // dépendre du scope de sim.js. Utilisée seulement pour la limite VFR 80 NM.
  function _dtDistanceNM(lat1, lon1, lat2, lon2) {
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

  // --- Ouverture modale 1 : sélection waypoint ---
  if (btnDirectTo) {
    btnDirectTo.addEventListener('click', () => {
      if (btnDirectTo.disabled) return;
      if (!flightPlan || flightPlan.length === 0) return;
      // Remplit la liste (TOUS les waypoints, départ inclus)
      dtList.innerHTML = '';
      dtError.textContent = '';
      btnDtValidate.disabled = true;
      _resetAirportSection();
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
        r.addEventListener('change', () => {
          // Sélection d'un waypoint → annule la cible airport si présente
          if (_dtAirportCandidate) _resetAirportSection();
          btnDtValidate.disabled = false;
        });
      });
      dtOverlay.classList.add('visible');
    });
  }

  function _fermerDtSelect() { dtOverlay.classList.remove('visible'); }
  if (btnDtCancel) btnDtCancel.addEventListener('click', _fermerDtSelect);
  if (dtOverlay) {
    dtOverlay.addEventListener('click', e => { if (e.target === dtOverlay) _fermerDtSelect(); });
  }

  // --- Recherche aéroport ICAO (hors plan) ---
  async function _lancerRechercheAirport() {
    if (!dtAirportIcao || !dtAirportStatus) return;
    const code = (dtAirportIcao.value || '').trim().toUpperCase();
    _dtAirportCandidate = null;

    // Si une cible airport était validée, on retire le verrou sur Valider
    // (un waypoint radio peut être encore coché → ne pas le casser).
    const wpChecked = dtList.querySelector('input[type="radio"]:checked');
    btnDtValidate.disabled = !wpChecked;

    if (!code) {
      dtAirportStatus.className = 'search-status error';
      dtAirportStatus.textContent = t('dtAirportNoIcao');
      return;
    }
    if (!_lastAircraftPos) {
      dtAirportStatus.className = 'search-status error';
      dtAirportStatus.textContent = t('dtAirportNoPos');
      return;
    }

    dtAirportStatus.className = 'search-status';
    dtAirportStatus.textContent = t('searchSearching');

    let res;
    try {
      res = await window.api.rechercherAeroportOA(code);
    } catch (err) {
      dtAirportStatus.className = 'search-status error';
      dtAirportStatus.textContent = t('searchNetworkError');
      console.error('Direct To airport search error:', err);
      return;
    }

    if (!res || !res.found) {
      dtAirportStatus.className = 'search-status error';
      if (res && res.reason === 'no-data') {
        dtAirportStatus.textContent = t('oaDataMissing');
      } else {
        dtAirportStatus.textContent = t('dtAirportNotFound');
      }
      return;
    }

    const { lat, lon, name } = res;
    const dist = _dtDistanceNM(_lastAircraftPos.lat, _lastAircraftPos.lon, lat, lon);
    const distStr = dist.toFixed(1);

    if (dist > DT_AIRPORT_MAX_NM) {
      dtAirportStatus.className = 'search-status error';
      dtAirportStatus.textContent = t('dtAirportTooFarFmt')(distStr);
      return;
    }

    // OK : on mémorise la cible et on active Valider, en décochant un éventuel waypoint
    _dtAirportCandidate = { lat, lon, code, name: name || code, distance: dist };
    const checkedWp = dtList.querySelector('input[type="radio"]:checked');
    if (checkedWp) checkedWp.checked = false;
    dtAirportStatus.className = 'search-status ok dt-airport-selected';
    dtAirportStatus.textContent = t('dtAirportFoundFmt')(code, name || code, distStr);
    btnDtValidate.disabled = false;
  }

  if (btnDtAirportSearch) btnDtAirportSearch.addEventListener('click', _lancerRechercheAirport);
  if (dtAirportIcao) {
    dtAirportIcao.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        _lancerRechercheAirport();
      }
    });
  }

  // --- Modale de confirmation Direct To générique (Promise<boolean>) ---
  // Utilisée pour DT airport ET DT point carte (même overlay réutilisé).
  function _confirmDirectTo(messageText) {
    return new Promise(resolve => {
      if (!dtConfirmOverlay || !dtConfirmText) return resolve(false);
      dtConfirmText.textContent = messageText;
      let done = false;
      function cleanup() {
        done = true;
        dtConfirmOverlay.classList.remove('visible');
        btnDtAirportConfirmYes.removeEventListener('click', onYes);
        btnDtAirportConfirmNo.removeEventListener('click', onNo);
        dtConfirmOverlay.removeEventListener('click', onBg);
        document.removeEventListener('keydown', onKey);
      }
      function onYes() { if (done) return; cleanup(); resolve(true); }
      function onNo()  { if (done) return; cleanup(); resolve(false); }
      function onBg(e) { if (e.target === dtConfirmOverlay) onNo(); }
      function onKey(e) { if (e.key === 'Escape') onNo(); }
      btnDtAirportConfirmYes.addEventListener('click', onYes);
      btnDtAirportConfirmNo.addEventListener('click', onNo);
      dtConfirmOverlay.addEventListener('click', onBg);
      document.addEventListener('keydown', onKey);
      dtConfirmOverlay.classList.add('visible');
    });
  }

  // --- Validation modale 1 → activation Direct To + modale 2 ---
  if (btnDtValidate) {
    btnDtValidate.addEventListener('click', async () => {
      // Cible airport hors plan prioritaire si sélectionnée
      if (_dtAirportCandidate) {
        if (!_lastAircraftPos) {
          dtError.textContent = t('dtAirportNoPos');
          return;
        }
        const cand = _dtAirportCandidate;
        const distStr = cand.distance.toFixed(1);
        const ok = await _confirmDirectTo(t('dtAirportConfirmTextFmt')(cand.code, distStr));
        if (!ok) return;
        // IMPORTANT : fermer la modale Direct To AVANT d'ouvrir askPatternModal.
        // ask-pattern-overlay est déclaré AVANT direct-to-overlay dans le DOM
        // (même z-index) ; si direct-to-overlay reste visible, le pattern modal
        // est caché derrière et l'utilisateur reste bloqué sur Direct To.
        _fermerDtSelect();
        // Question "Tour de piste / Toucher prévu ?"
        const isPattern = await askPatternModal(cand.code);
        _activerDirectToExterne({
          lat: cand.lat,
          lon: cand.lon,
          code: cand.code,
          name: cand.name,
          pattern: !!isPattern,
        });
        return;
      }

      // Sinon : cible waypoint du plan
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

  // --- Activation : passage en mode Direct To ---
  function _activerDirectTo(targetIdx) {
    const target = flightPlan[targetIdx];
    if (!target || !_lastAircraftPos) return;

    // Nouveau DT plan → on retire un éventuel marqueur point carte précédent
    _supprimerMarqueurPointDt();

    // Annule proprement un éventuel Direct To EXTERNE en cours (aéroport hors
    // plan, point carte ou atterrissage d'urgence). Sans ça, sim.js — qui donne
    // la priorité au mode 'ext' — continuerait de guider vers l'ancienne cible
    // externe et le plan ne reviendrait pas à la normale (annonce d'urgence
    // incluse). Symétrique de ce que fait _activerDirectToExterne.
    _directToExternalActive = false;
    _directToExternalTarget = null;
    _directToReturnLegIndex = null;

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

    // Redessine table + segments (couleurs mises à jour selon activeLegIndex)
    mettreAJourLogDeNav();

    // Calcul cap / temps / distance et ouvre la modale info
    const info = calcLegInfo(_directToOrigin.lat, _directToOrigin.lon, target.lat, target.lon);
    _afficherInfoDirectTo(target, info);

    // Notification pour le carnet de vol (logbook-bridge.js écoute)
    document.dispatchEvent(new CustomEvent('logbook-direct-to', {
      detail: {
        kind: 'plan',
        targetIndex: targetIdx,
        name: target.name || target.ident || '',
      },
    }));
  }

  // --- Activation Direct To externe (aéroport HORS plan OU point carte) ---
  // target = { lat, lon, code, name, pattern }
  // Le marqueur rouge du Direct To point précédent est retiré ; il est replacé
  // ensuite par _activerDirectToPoint() seulement si la cible est un point carte.
  function _activerDirectToExterne(target) {
    if (!target || !_lastAircraftPos) return;

    // Nouveau DT → on retire un éventuel marqueur point carte précédent
    _supprimerMarqueurPointDt();

    // Désactive un éventuel Direct To "plan" en cours
    _directToActive = false;
    _directToTargetIndex = null;

    // État externe
    _directToExternalActive = true;
    _directToExternalTarget = {
      lat: target.lat,
      lon: target.lon,
      code: target.code,
      name: target.name,
      pattern: !!target.pattern,
      // Atterrissage d'urgence : sim.js joue urgence_xx.mp3 à l'arrivée.
      emergency: !!target.emergency,
    };
    _directToReturnLegIndex = activeLegIndex;
    _directToOrigin = { lat: _lastAircraftPos.lat, lon: _lastAircraftPos.lon };

    // Note : le reset du tracking (sons d'approche / déviation) est fait dans
    // sim.js qui détecte la transition de mode (les vars de tracking y sont en closure).

    // Redessine table + segments (l'activeLegIndex est inchangé : le leg "quitté"
    // reste visuellement actif jusqu'à l'arrivée à l'aéroport hors plan)
    mettreAJourLogDeNav();

    // Calcul cap / temps / distance depuis _directToOrigin → target
    const info = calcLegInfo(_directToOrigin.lat, _directToOrigin.lon, target.lat, target.lon);
    // Format compatible avec _afficherInfoDirectTo (utilise target.name)
    _afficherInfoDirectTo({ name: target.name || target.code }, info);

    // Notification pour le carnet de vol. Le DT externe couvre deux cas :
    //   - aéroport hors plan (code = ICAO réel, ex. 'LFRG')
    //   - point carte (code = 'POINT' — convention posée par _activerDirectToPoint)
    // On distingue côté event pour que le logbook range bien dans la bonne
    // catégorie (kind: 'airport' avec ICAO vs 'point' avec coords seules).
    const isMapPoint = target.code === 'POINT';
    document.dispatchEvent(new CustomEvent('logbook-direct-to', {
      detail: isMapPoint
        ? { kind: 'point', lat: target.lat, lon: target.lon }
        : {
            kind: 'airport',
            code: target.code,
            name: target.name || target.code,
            lat: target.lat,
            lon: target.lon,
            pattern: !!target.pattern,
          },
    }));
  }

  // --- Marqueur rouge du point cible d'un Direct To "point carte" ---
  function _placerMarqueurPointDt(lat, lon) {
    if (typeof map === 'undefined' || !map || typeof L === 'undefined') return;
    _supprimerMarqueurPointDt();
    _directToPointMarker = L.circleMarker([lat, lon], {
      radius: 6,
      color: '#ff1744',
      weight: 2,
      fillColor: '#ff1744',
      fillOpacity: 1,
      className: 'dt-point-marker',
      interactive: false,
    }).addTo(map);
  }
  function _supprimerMarqueurPointDt() {
    if (_directToPointMarker && typeof map !== 'undefined' && map) {
      try { map.removeLayer(_directToPointMarker); } catch (_) { }
    }
    _directToPointMarker = null;
  }
  // Pont pour sim.js (suppression à l'arrivée, via la transition ext → plan)
  window._supprimerMarqueurPointDt = _supprimerMarqueurPointDt;

  // --- Activation Direct To "point carte" ---
  // Réutilise tout le mécanisme du Direct To externe (state, tracking sim.js,
  // suspension de déviation post-arrivée). Seule particularité : marqueur rouge.
  function _activerDirectToPoint(lat, lon) {
    _activerDirectToExterne({
      lat,
      lon,
      code: 'POINT',
      name: t('dtPointName'),
      pattern: false,
    });
    _placerMarqueurPointDt(lat, lon);
  }

  // --- Entrée publique appelée depuis le menu contextuel de la carte ---
  // Vérifie position avion + distance ≤ 80 NM, demande confirmation, active.
  async function _demanderDirectToPoint(lat, lon) {
    if (!_lastAircraftPos) {
      showToast(t('dtAirportNoPos'), 'error', 3000);
      return;
    }
    const dist = _dtDistanceNM(_lastAircraftPos.lat, _lastAircraftPos.lon, lat, lon);
    const distStr = dist.toFixed(1);
    if (dist > DT_AIRPORT_MAX_NM) {
      showToast(t('dtAirportTooFarFmt')(distStr), 'error', 3500);
      return;
    }
    const ok = await _confirmDirectTo(t('dtPointConfirmTextFmt')(distStr));
    if (!ok) return;
    _activerDirectToPoint(lat, lon);
  }
  window.demanderDirectToPoint = _demanderDirectToPoint;

  // --- Entrée publique : Direct To « atterrissage d'urgence » vers un aéroport ---
  // Réutilise tout le mécanisme du Direct To externe (guidage, modale info,
  // avertissements de déviation), avec emergency:true → annonce vocale d'urgence
  // à l'arrivée (sim.js). target = { lat, lon, code, name }.
  function _activerDirectToUrgence(target) {
    if (!target || !_lastAircraftPos) return;
    _activerDirectToExterne({
      lat: target.lat,
      lon: target.lon,
      code: target.code,
      name: target.name || target.code,
      pattern: false,
      emergency: true,
    });
  }
  window.activerDirectToUrgence = _activerDirectToUrgence;

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
}

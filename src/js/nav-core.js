// ============================================================
// NavXpressVFR — nav-core.js
// Helpers de navigation partagés (calcul cap/temps/distance).
// Extrait de ui.js (Phase 2 — Lot B).
// Chargé après globals.js (utilise declinaisonMoyenneGlobale), avant les features.
// ============================================================

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

  // --------------------------------------------------------------------------
  // Helpers géo partagés (haversine + cross-track) + résolution du leg actif.
  // Utilisés par l'évaluation de précision (precision.js). sim.js conserve ses
  // propres copies locales (non refactoré ici pour ne pas toucher à sa machine
  // sons/déviation) — duplication mineure assumée.
  // --------------------------------------------------------------------------

  // Distance grand-cercle entre deux points (nautical miles).
  function distanceNM(lat1, lon1, lat2, lon2) {
    const R_NM = 3440.065;
    const toRad = d => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2
      + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  // Cross-track distance (XTD) signée d'un point P à la route grand-cercle A→B
  // (nautical miles). Positif = à droite de la route, négatif = à gauche.
  // Pour un test de seuil, prendre Math.abs(). (Identique à sim.js.)
  function crossTrackNM(latP, lonP, latA, lonA, latB, lonB) {
    const R_NM = 3440.065;
    const toRad = d => d * Math.PI / 180;
    const φA = toRad(latA), λA = toRad(lonA);
    const φP = toRad(latP), λP = toRad(lonP);
    const φB = toRad(latB), λB = toRad(lonB);
    const Δφap = φP - φA, Δλap = λP - λA;
    const aap = Math.sin(Δφap / 2) ** 2
      + Math.cos(φA) * Math.cos(φP) * Math.sin(Δλap / 2) ** 2;
    const d_AP = 2 * Math.atan2(Math.sqrt(aap), Math.sqrt(1 - aap));
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

  // Résout le leg actif courant (dep → arr) pour les features qui ont besoin de
  // la trajectoire suivie (ex. évaluation de précision). MÊME logique de choix
  // que sim.js (modes Direct-To externe / Direct-To plan / leg du plan), pour
  // que le « leg » vu par la précision corresponde à celui vu par l'alerte de
  // déviation. Retourne { dep:{lat,lon}, arr:{lat,lon} } ou null s'il n'y a pas
  // de leg actif (→ la précision gèle l'évaluation).
  function getActiveLeg() {
    if (_directToExternalActive && _directToExternalTarget && _directToOrigin) {
      return { dep: _directToOrigin, arr: _directToExternalTarget };
    }
    if (!flightPlan || flightPlan.length < 2) return null;
    if (activeLegIndex < 1 || activeLegIndex >= flightPlan.length) return null;
    const dep = (_directToActive && _directToOrigin)
      ? _directToOrigin
      : flightPlan[activeLegIndex - 1];
    const arr = flightPlan[activeLegIndex];
    if (!dep || !arr
      || !Number.isFinite(dep.lat) || !Number.isFinite(dep.lon)
      || !Number.isFinite(arr.lat) || !Number.isFinite(arr.lon)) {
      return null;
    }
    return { dep, arr };
  }

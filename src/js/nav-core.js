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

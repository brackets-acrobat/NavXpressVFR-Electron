// ============================================================
// NavXpressVFR — sounds.js
// Lecteur audio générique partagé (suivi sim + changement de réservoir).
// Extrait de ui.js (Phase 2 — Lot A). Chargé AVANT ui.js.
// ============================================================

  function _jouerSon(audioEl) {
    try {
      audioEl.currentTime = 0;
      audioEl.play().catch(err => console.warn('Lecture son refusée :', err));
    } catch (err) {
      console.warn('Erreur son :', err);
    }
  }

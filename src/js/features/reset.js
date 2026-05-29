// ============================================================
// NavXpressVFR — reset.js
// Bouton NOUVEAU (reset) + modale de confirmation
// Extrait de ui.js (Phase 2 — Lot A). Appelé par l'orchestrateur ui.js.
// ============================================================

function initReset() {
  // --- 2. BOUTON : NOUVEAU (reset) ---
  const btnNew = document.getElementById('btn-new-flight');
  const confirmResetOverlay = document.getElementById('confirm-reset-overlay');
  const btnConfirmResetOk = document.getElementById('btn-confirm-reset-ok');
  const btnConfirmResetCancel = document.getElementById('btn-confirm-reset-cancel');

  function doReset() {
    flightPlan = [];
    legAltitudes = [];
    declinaisonMoyenneGlobale = 0.0;
    activeLegIndex = 1;
    document.getElementById('input-icao-dep').value = '';
    document.getElementById('input-icao-arr').value = '';
    marqueursCarte.forEach(m => map.removeLayer(m));
    marqueursCarte = [];
    supprimerSegmentsCarte();
    actualiserAffichageDeclinaison();
    mettreAJourLogDeNav();
  }

  if (btnNew) {
    btnNew.addEventListener('click', () => {
      confirmResetOverlay.style.display = 'flex';
    });
  }

  btnConfirmResetOk.addEventListener('click', () => {
    confirmResetOverlay.style.display = 'none';
    doReset();
  });

  btnConfirmResetCancel.addEventListener('click', () => {
    confirmResetOverlay.style.display = 'none';
  });

  confirmResetOverlay.addEventListener('click', (e) => {
    if (e.target === confirmResetOverlay) confirmResetOverlay.style.display = 'none';
  });
}

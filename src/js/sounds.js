// ============================================================
// NavXpressVFR — sounds.js
// Lecteur audio générique partagé (suivi sim, changement de réservoir,
// avertissement <500 ft AGL, etc.). Chargé AVANT ui.js.
//
// SÉRIALISATION : tous les sons demandés via _jouerSon() sont mis en file
// d'attente et joués les uns APRÈS les autres (pas de chevauchement). Si
// plusieurs alertes se déclenchent simultanément (ex. déviation + 500 ft
// AGL au même tick SimConnect), on les entend séquentiellement.
//
// Filet de sécurité : un sound qui ne déclencherait jamais 'ended' (audio
// bloqué, erreur silencieuse) est libéré après 30 s pour ne pas geler la
// file.
// ============================================================

  const _soundQueue = [];
  let _soundPlaying = false;

  function _jouerSon(audioEl) {
    if (!audioEl) return;
    _soundQueue.push(audioEl);
    if (!_soundPlaying) _traiterFileSon();
  }

  function _traiterFileSon() {
    if (_soundQueue.length === 0) { _soundPlaying = false; return; }
    _soundPlaying = true;
    const audioEl = _soundQueue.shift();

    let _finiAppele = false;
    const _safetyMs = 30000; // libère la file si 'ended' ne vient jamais
    let _safetyId = null;

    function _fini() {
      if (_finiAppele) return;
      _finiAppele = true;
      audioEl.removeEventListener('ended', _fini);
      audioEl.removeEventListener('error', _fini);
      if (_safetyId !== null) { clearTimeout(_safetyId); _safetyId = null; }
      _traiterFileSon();
    }

    audioEl.addEventListener('ended', _fini);
    audioEl.addEventListener('error', _fini);
    _safetyId = setTimeout(_fini, _safetyMs);

    try {
      audioEl.currentTime = 0;
      const p = audioEl.play();
      if (p && typeof p.catch === 'function') {
        p.catch(err => {
          console.warn('Lecture son refusée :', err);
          _fini();
        });
      }
    } catch (err) {
      console.warn('Erreur son :', err);
      _fini();
    }
  }

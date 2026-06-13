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

  // Volume global (0..1) appliqué sur chaque audio juste avant lecture, lu en
  // direct depuis les options → un changement de glissière s'applique au
  // prochain son sans recharger.
  function _applyVolume(audioEl) {
    const v = (window.appOptions && typeof window.appOptions.soundVolume === 'number')
      ? window.appOptions.soundVolume : 1;
    audioEl.volume = Math.max(0, Math.min(1, v));
  }

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
      _applyVolume(audioEl); // volume global (0..1,5), lu en direct à chaque lecture
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

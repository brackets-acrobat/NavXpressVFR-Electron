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
// NavXpressVFR — agl-warning.js
// Avertissement audio « < 500 ft AGL ».
//
// Source AGL : champ pos.altAgl (PLANE ALT ABOVE GROUND, pieds)
// publié par main.js dans l'event 'donnees-position' SimConnect.
// Pas d'usage des fichiers elevation/ pour cette feature : AGL natif
// MSFS = relief simulateur exact, instantané.
//
// Cadence : sur chaque event onDonneesPosition (~5 s — c'est déjà le
// pas de SimConnect, pas de setInterval séparé qui dériverait).
//
// Règles :
//   - altAgl >= 500 ft  → reset complet (hors zone basse, cooldown effacé).
//   - altAgl <  500 ft  → joue le son si :
//        a) on vient d'entrer en zone basse (premier tick <500 depuis la
//           dernière sortie), OU
//        b) on est en zone basse depuis ≥ 2 min depuis le dernier son joué.
//        ET on n'est PAS à < 2 NM d'un aéroport éligible.
//
//   - Si on est près d'un aéroport (large/medium/small_airport, exclut
//     heliports) : on marque qu'on est en zone basse mais on ne joue pas
//     et on n'arme pas le cooldown 2 min. Conséquence : si on s'éloigne
//     ensuite tout en restant <500 ft, le son partira au tick suivant.
//
// Choix langue : sounds[currentLang] (fallback FR si autre).
//
// Sécurité (absence de données aéroports) : si l'IPC échoue ou renvoie
// no-data, on considère qu'on n'est PAS près d'un aéroport → on joue le
// son. Mieux vaut un faux positif qu'un avertissement raté.
// ============================================================

function initAglWarning() {
  if (!window.api || typeof window.api.onDonneesPosition !== 'function') return;

  const THRESHOLD_FT = 500;
  const REPLAY_MS = 2 * 60 * 1000;       // 2 min entre deux sons si toujours <500 ft
  const NEAR_AIRPORT_NM = 2;
  const BBOX_HALF_DEG = 0.1;              // ~6 NM en latitude → couvre largement 2 NM
  const RELEVANT_TYPES = new Set(['large_airport', 'medium_airport', 'small_airport']);

  const _sounds = {
    fr: new Audio('sounds/500agl_fr.wav'),
    en: new Audio('sounds/500agl_en.wav'),
  };
  _sounds.fr.preload = 'auto';
  _sounds.en.preload = 'auto';

  let _belowZone = false;                 // l'avion est-il actuellement <500 ft AGL ?
  let _lastPlayedMs = 0;                  // 0 = jamais joué depuis la dernière sortie
  let _bboxQueryInFlight = false;         // évite empilement de requêtes IPC

  function _distanceNM(lat1, lon1, lat2, lon2) {
    const R = 3440.065;                   // rayon Terre en NM
    const toRad = Math.PI / 180;
    const dLat = (lat2 - lat1) * toRad;
    const dLon = (lon2 - lon1) * toRad;
    const a = Math.sin(dLat / 2) ** 2
      + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  // true si un aéroport éligible (RELEVANT_TYPES) est à < 2 NM de (lat, lon).
  // Absence de données / erreur IPC → false (cf. règle de sécurité dans l'en-tête).
  async function _estPresAeroport(lat, lon) {
    if (_bboxQueryInFlight) return false; // tick suivant arrive dans 5 s
    _bboxQueryInFlight = true;
    try {
      const bbox = {
        south: lat - BBOX_HALF_DEG,
        north: lat + BBOX_HALF_DEG,
        west: lon - BBOX_HALF_DEG,
        east: lon + BBOX_HALF_DEG,
      };
      const res = await window.api.aeroportsDansBbox(bbox);
      if (!res || !res.ok || !Array.isArray(res.airports)) return false;
      for (const a of res.airports) {
        if (!RELEVANT_TYPES.has(a.type)) continue;
        if (_distanceNM(lat, lon, a.lat, a.lon) < NEAR_AIRPORT_NM) return true;
      }
      return false;
    } catch (_) {
      return false;
    } finally {
      _bboxQueryInFlight = false;
    }
  }

  function _jouer() {
    const lang = (typeof currentLang === 'string' && _sounds[currentLang]) ? currentLang : 'fr';
    _jouerSon(_sounds[lang]);
  }

  window.api.onDonneesPosition(async (pos) => {
    // Toggle utilisateur (modale Options). Désactivé → on coupe court avant
    // tout traitement. On reset aussi l'état interne : si l'utilisateur
    // réactive l'option en zone basse, le prochain tick déclenchera l'alerte
    // au lieu d'attendre une « rentrée » de zone qui n'arrivera pas.
    if (window.appOptions && window.appOptions.aglWarningEnabled === false) {
      _belowZone = false;
      _lastPlayedMs = 0;
      return;
    }

    if (!pos || typeof pos.altAgl !== 'number' || !isFinite(pos.altAgl)) return;
    if (typeof pos.lat !== 'number' || typeof pos.lon !== 'number') return;

    // Au-dessus du seuil : reset complet.
    if (pos.altAgl >= THRESHOLD_FT) {
      _belowZone = false;
      _lastPlayedMs = 0;
      return;
    }

    // En zone basse + dans la fenêtre de cooldown 2 min depuis le dernier
    // son joué → silence. Le test _lastPlayedMs > 0 distingue « jamais joué
    // depuis la sortie » (cas où le silence venait de la proximité aéroport)
    // de « joué récemment » (vrai cooldown).
    const now = Date.now();
    if (_belowZone && _lastPlayedMs > 0 && (now - _lastPlayedMs) < REPLAY_MS) {
      return;
    }

    if (await _estPresAeroport(pos.lat, pos.lon)) {
      // Près d'un aéroport : on note qu'on est en zone basse mais on n'arme
      // pas le cooldown. Si on s'en éloigne au tick suivant (toujours <500),
      // le son partira sans attendre 2 min.
      _belowZone = true;
      return;
    }

    _jouer();
    _belowZone = true;
    _lastPlayedMs = now;
  });
}

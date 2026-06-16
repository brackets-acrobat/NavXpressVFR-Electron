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
// NavXpressVFR — traffic-pattern-voice.js
// Annonces vocales du tour de piste — ÉTAPE 2.
//
// "Vent arrière" : joue sounds/vent-arriere-{fr|en}.mp3 quand l'avion entre en
// vent arrière d'un tour de piste tracé (cf. traffic-pattern.js, global
// `toursDePiste`, champ `entry.downwind = {start, end, brngTrue, lengthNM}`).
//
// Conditions (TOUTES requises) — vent arrière = PuSide(start) → PfSide(end) :
//   1. cap vrai avion ≈ cap vrai du vent arrière, ± 15°.
//   2. écart latéral à la branche ≤ 0.3 NM (de part et d'autre).
//   3. hauteur au-dessus de l'aérodrome (MSL − élévation terrain, indépendante
//      du relief survolé) ≈ altitude du tour de piste (modale), ± 300 ft.
//      Repli sur l'AGL si MSL/élévation indisponible.
//   4. position le long de la branche entre 0.4 NM EN AMONT du début nominal
//      (s ≥ −0.4 : circuit un peu large, établi avant la fin du vent traversier)
//      et le début du DERNIER QUART (s ≤ 0.75 × longueur : jamais juste avant la
//      base). → on déclenche dès qu'on est ÉTABLI dans le couloir, peu importe
//      où l'on a rejoint le vent arrière (virage anticipé/retardé robuste).
//
// Déclenchement = front montant (entrée dans la zone) + anti-rebond 15 s, donc
// une annonce par passage et re-déclenchement au tour suivant. État par entrée :
// `_dwInZone` / `_dwLastPlayMs` (ajoutés à la volée sur l'objet de toursDePiste).
//
// Cap : pos.headingTrue (PLANE HEADING DEGREES TRUE, ajouté au groupe position
// de main.js → NÉCESSITE une reconnexion au sim). Tant qu'absent, pas d'annonce.
// Altitude : hauteur au-dessus de l'aérodrome = pos.altMsl (PLANE ALTITUDE) −
// entry.airportElevFt ; repli pos.altAgl (PLANE ALT ABOVE GROUND) si indispo.
//
// Helpers géo partagés : distanceNM / crossTrackNM (nav-core.js, globaux) ;
// lecture audio : _jouerSon (sounds.js) ; langue : currentLang.
// ============================================================

function initTrafficPatternVoice() {
  if (!window.api || typeof window.api.onDonneesPosition !== 'function') return;

  const UPSTREAM_NM = 0.4;       // tolérance EN AMONT du début nominal (s ≥ −0.4)
  const LATERAL_NM = 0.3;        // ± 0.3 NM de part et d'autre
  const HEADING_TOL_DEG = 15;    // ± 15°
  const ALT_TOL_FT = 300;        // ± 300 ft
  const LAST_QUARTER = 0.75;     // exclut le dernier quart
  const REPLAY_MS = 15000;       // anti-rebond (évite un double déclenchement)

  const _sounds = {
    fr: new Audio('sounds/vent-arriere-fr.mp3'),
    en: new Audio('sounds/vent-arriere-en.mp3'),
  };
  _sounds.fr.preload = 'auto';
  _sounds.en.preload = 'auto';

  const toRad = d => d * Math.PI / 180;
  const toDeg = r => r * 180 / Math.PI;

  function bearing(latA, lonA, latB, lonB) {
    const f1 = toRad(latA), f2 = toRad(latB), dl = toRad(lonB - lonA);
    const y = Math.sin(dl) * Math.cos(f2);
    const x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  }
  // Écart angulaire absolu entre deux caps (0..180°).
  function headingDiff(a, b) { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }

  function _jouer() {
    const lang = (typeof currentLang === 'string' && _sounds[currentLang]) ? currentLang : 'fr';
    _jouerSon(_sounds[lang]);
  }

  window.api.onDonneesPosition((pos) => {
    // Toggle Options : désactivé → on coupe et on reset l'état (réactivation en
    // vent arrière → le prochain tick re-déclenchera au lieu d'attendre un
    // nouveau passage). Même logique que l'AGL / la déviation.
    if (window.appOptions && window.appOptions.downwindAnnounceEnabled === false) {
      if (Array.isArray(toursDePiste)) toursDePiste.forEach(e => { if (e) e._dwInZone = false; });
      return;
    }
    if (!pos || typeof pos.lat !== 'number' || typeof pos.lon !== 'number') return;
    // Cap requis (sinon main.js pas à jour / pas reconnecté → on n'annonce pas).
    if (typeof pos.headingTrue !== 'number' || !isFinite(pos.headingTrue)) return;
    // Au moins une altitude exploitable (MSL préférée, AGL en repli).
    const hasMsl = typeof pos.altMsl === 'number' && isFinite(pos.altMsl);
    const hasAgl = typeof pos.altAgl === 'number' && isFinite(pos.altAgl);
    if (!hasMsl && !hasAgl) return;
    if (typeof toursDePiste === 'undefined' || !toursDePiste.length) return;

    const now = Date.now();
    for (const e of toursDePiste) {
      const dw = e && e.downwind;
      if (!dw || !dw.start || !dw.end) { if (e) e._dwInZone = false; continue; }

      // 1. Cap dans la tolérance ?
      if (headingDiff(pos.headingTrue, dw.brngTrue) > HEADING_TOL_DEG) { e._dwInZone = false; continue; }
      // 3. Hauteur dans la tolérance ? Référence = hauteur au-dessus de
      // l'aérodrome (MSL − élévation terrain), indépendante du relief survolé.
      // Repli sur l'AGL si MSL ou élévation aérodrome indisponible.
      let hauteur;
      if (hasMsl && Number.isFinite(e.airportElevFt)) hauteur = pos.altMsl - e.airportElevFt;
      else if (hasAgl) hauteur = pos.altAgl;
      else { e._dwInZone = false; continue; }
      if (Math.abs(hauteur - (e.altitudeFt || 0)) > ALT_TOL_FT) { e._dwInZone = false; continue; }
      // 2. Écart latéral à la branche ?
      const xt = Math.abs(crossTrackNM(pos.lat, pos.lon, dw.start.lat, dw.start.lon, dw.end.lat, dw.end.lon));
      if (xt > LATERAL_NM) { e._dwInZone = false; continue; }
      // 4. Position le long de la branche (signée depuis le début) : établi dans
      // le couloir, de 0.4 NM en amont du début nominal jusqu'au dernier quart.
      const dStart = distanceNM(dw.start.lat, dw.start.lon, pos.lat, pos.lon);
      const brToP = bearing(dw.start.lat, dw.start.lon, pos.lat, pos.lon);
      const s = dStart * Math.cos(toRad(brToP - dw.brngTrue));
      const sMax = dw.lengthNM > 0 ? LAST_QUARTER * dw.lengthNM : UPSTREAM_NM;
      const inZone = s >= -UPSTREAM_NM && s <= sMax;

      // Front montant + anti-rebond.
      if (inZone && !e._dwInZone) {
        if (!e._dwLastPlayMs || (now - e._dwLastPlayMs) > REPLAY_MS) {
          _jouer();
          e._dwLastPlayMs = now;
        }
      }
      e._dwInZone = inZone;
    }
  });
}

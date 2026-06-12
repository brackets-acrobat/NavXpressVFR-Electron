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
// NavXpressVFR — logbook.js
// Carnet de vol automatisé (machine à états) + analyseur d'atterrissage.
//
// Conçu pour tourner dans le main process Electron. Le module est
// totalement découplé de la couche IPC : il reçoit ses entrées via
// feedTracking() / feedLandingFrame() et émet ses sorties via un
// callback unique fourni à la création (emit). C'est main.js qui se
// charge de :
//   - alimenter feedTracking() depuis les events SimConnect (~2 s)
//   - alimenter feedLandingFrame() depuis SIM_FRAME (uniquement quand
//     le moteur le demande, cf. shouldSampleLanding())
//   - écouter les emit() pour les retransmettre au renderer
//
// Cycle d'états :
//   OFF_TRACK  ─[combustion=true]→ OFF_BLOCK
//   OFF_BLOCK  ─[onGround=false]→  IN_FLIGHT          (snapshot du plan)
//   IN_FLIGHT  ─[onGround=true]→   touchdown          (analyse buffer)
//                                  └─ <15 s en l'air  → touch-and-go++, reste IN_FLIGHT
//                                  └─ ≥15 s au sol    → ON_BLOCK
//   ON_BLOCK   ─[combustion=false]→ SHUTDOWN          (écriture JSONL)
//   SHUTDOWN   ─→                   OFF_TRACK
//
// Buffer tournant : 5 dernières frames {ts, vsFpm, gForce} échantillonnées
// à fréquence SIM_FRAME quand l'avion est en IN_FLIGHT sous 500 ft AGL.
// À l'instant exact du touchdown, on fige une copie pour en extraire
// min(vsFpm) et max(gForce) — MSFS écrasant la VS à 0 dès le contact.
//
// Hystérésis 500/700 ft : main.js demande au moteur shouldSampleLanding()
// à chaque tick de tracking, qui répond true entre 0 et 500 ft (entrée) et
// reste true tant qu'on n'est pas repassé au-dessus de 700 ft (sortie).
// Évite le flapping ON/OFF quand on vole pile autour de 500 ft.
// ============================================================

const fs = require('fs');
const path = require('path');

// --- États possibles de la machine ---
const STATES = Object.freeze({
  OFF_TRACK: 'OFF_TRACK',  // Moteur éteint, parking — état initial / repos
  OFF_BLOCK: 'OFF_BLOCK',  // Moteur tourne, encore au sol (roulage / prêt)
  IN_FLIGHT: 'IN_FLIGHT',  // En vol (peut alterner touchdown/redécollage pour les T&G)
  ON_BLOCK:  'ON_BLOCK',   // Atterri, stabilisé au sol depuis ≥15 s
  SHUTDOWN:  'SHUTDOWN',   // État transitoire d'écriture, redevient OFF_TRACK
});

// Durée de stabilisation au sol pour passer IN_FLIGHT → ON_BLOCK.
// Un redécollage avant cette échéance compte comme touch-and-go.
const TOUCH_AND_GO_WINDOW_MS = 15_000;

// Fenêtre de regroupement des rebonds. Un nouveau contact survenant moins de
// BOUNCE_WINDOW_MS après le contact précédent = rebond du MÊME atterrissage :
// on conserve le 1er toucher (sa VS/G) et on ignore les suivants. Au-delà de
// cette fenêtre, un retour en l'air = remise de gaz confirmée (touch-and-go),
// et un nouveau contact = nouvel atterrissage. Valeur choisie > écart
// inter-rebonds observé (~6 s) et très inférieure à la durée d'un circuit
// (plusieurs minutes). Ajustable.
const BOUNCE_WINDOW_MS = 10_000;

// Seuil « vitesse à zéro » (kt) pour la détection de fin de vol. GROUND
// VELOCITY n'est jamais pile 0 (micro-dérive physique) → on tolère < 1 kt.
const GROUND_STOP_KT = 1;

// Seuils AGL pour l'activation conditionnelle du buffer landing (hystérésis).
const LANDING_SAMPLE_ENTER_FT = 500;
const LANDING_SAMPLE_EXIT_FT  = 700;

// Taille du rolling buffer (frames SIM_FRAME stockées avant figeage au touchdown).
const ROLLING_BUFFER_SIZE = 5;

// Intervalle d'échantillonnage de la position pour le tracé EFFECTIF (route
// réellement volée + profil vertical). Capturé uniquement en IN_FLIGHT, et
// stocké dans flight.track (lat/lon/AGL/relief). 10 s = compromis taille/finesse.
const TRACK_SAMPLE_INTERVAL_MS = 10_000;

// --- Buffer tournant ----------------------------------------------------
// Implémentation FIFO simple : on garde au max N éléments, push() évince
// le plus ancien. snapshot() renvoie une copie indépendante (le buffer
// peut continuer à se remplir pendant que l'appelant exploite la copie).
class RollingBuffer {
  constructor(maxSize = ROLLING_BUFFER_SIZE) {
    this._max = maxSize;
    this._items = [];
  }
  push(item) {
    this._items.push(item);
    if (this._items.length > this._max) this._items.shift();
  }
  snapshot() {
    return this._items.slice();
  }
  clear() {
    this._items = [];
  }
  get size() {
    return this._items.length;
  }
}

// --- Stub : aéroport le plus proche -------------------------------------
// TODO (futur) : brancher sur l'index aéroports déjà chargé en mémoire
// dans main.js (variable _oaAirportsList — base MSFS ou OurAirports selon
// présence du fichier airports-msfs.jsonl). En attendant, on renvoie un
// placeholder pour que la chaîne complète (capture du départ, capture de
// l'arrivée, écriture JSONL) puisse être testée end-to-end.
function getClosestAirport(lat, lon) {
  return {
    icao: 'UNKN',
    name: 'Inconnu',
    lat: Number.isFinite(lat) ? lat : null,
    lon: Number.isFinite(lon) ? lon : null,
    distanceNm: null,
  };
}

// --- Nommage des fichiers de vol individuels ----------------------------
// Depuis la 1.12, chaque vol est écrit dans SON fichier (au lieu d'une ligne
// dans flights.jsonl), nommé « NNNN_DEP-ARR.json » :
//   - NNNN  = numéro de séquence unique, incrémenté à chaque vol (4 chiffres
//             mini, zéro-paddé pour un tri alphabétique = chronologique) ;
//   - DEP   = ICAO de départ assaini ;
//   - ARR   = ICAO d'arrivée assaini.
// Ces helpers sont partagés avec main.js (migration de l'ancien flights.jsonl).

// Assainit un code ICAO pour un nom de fichier (majuscules, alphanum. seul).
function sanitizeIcao(code) {
  const s = String(code == null ? '' : code).toUpperCase().replace(/[^A-Z0-9]/g, '');
  return s || 'UNKN';
}

// Numéro de séquence zéro-paddé (4 chiffres mini ; au-delà, longueur naturelle).
function padSeq(n) {
  return String(n).padStart(4, '0');
}

// Nom de fichier d'un vol : NNNN_DEP-ARR.json.
function logbookFileName(seq, depIcao, arrIcao) {
  return `${padSeq(seq)}_${sanitizeIcao(depIcao)}-${sanitizeIcao(arrIcao)}.json`;
}

// Plus grand numéro de séquence déjà présent dans le dossier (0 si aucun).
// Sert à attribuer le prochain numéro sans état persistant séparé.
function maxLogbookSeq(dir) {
  let max = 0;
  try {
    for (const name of fs.readdirSync(dir)) {
      const m = /^(\d+)_.*\.json$/i.exec(name);
      if (!m) continue;
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
  } catch (_) { /* dossier absent → 0 */ }
  return max;
}

// ------------------------------------------------------------------------
// LogbookEngine — instance unique tenue par main.js
// ------------------------------------------------------------------------
class LogbookEngine {
  // opts :
  //   logbookDir   : dossier où écrire flights.jsonl (créé par main.js)
  //   emit         : fn(channel, payload) — relais IPC
  //   isEnabled    : fn() → bool — lecture dynamique du toggle Options
  //                  (renderer pousse via IPC ; main.js mémorise un flag
  //                  et expose la lecture via cette closure)
  //   closestAirport : fn(lat, lon) → {icao, name, lat, lon} — override
  //                    optionnel du stub (conservé pour repli/futur ; non
  //                    utilisé en stratégie « plan strict »)
  //   resolveAirport : fn(codeOrIdent) → {icao, name, lat, lon} | null —
  //                    résout départ/arrivée depuis l'ICAO du plan de vol
  //                    (1er / dernier waypoint) dans la base aéroports.
  //   getAircraftInfo : fn() → {category, type, model, title} | null —
  //                    identité de l'appareil courant (cache main.js alimenté
  //                    par les SimVars CATEGORY/ATC TYPE/ATC MODEL/TITLE).
  constructor(opts) {
    this._logbookDir = opts.logbookDir;
    this._emit = typeof opts.emit === 'function' ? opts.emit : () => {};
    this._isEnabled = typeof opts.isEnabled === 'function' ? opts.isEnabled : () => true;
    this._closestAirport = typeof opts.closestAirport === 'function'
      ? opts.closestAirport
      : getClosestAirport;
    this._resolveAirport = typeof opts.resolveAirport === 'function'
      ? opts.resolveAirport
      : () => null;
    this._getAircraftInfo = typeof opts.getAircraftInfo === 'function'
      ? opts.getAircraftInfo
      : () => null;
    // Élévation du terrain (ft) à (lat, lon) pour le profil vertical. null si
    // dataset relief absent → le profil retombe sur une référence sol à 0.
    this._elevationAt = typeof opts.elevationAt === 'function'
      ? opts.elevationAt
      : () => null;

    // État machine + buffer landing
    this._state = STATES.OFF_TRACK;
    this._stateSince = Date.now();
    this._buffer = new RollingBuffer(ROLLING_BUFFER_SIZE);

    // Hystérésis AGL pour l'activation du sampling rapide
    this._landingSamplingActive = false;

    // Plan de vol courant (poussé par renderer, snapshot pris au décollage).
    // Forme : Array<{name, ident, lat, lon, pattern?}>
    this._currentPlan = [];

    // Vol en cours d'enregistrement (rempli au fil des transitions).
    // null quand aucun vol n'est actif (OFF_TRACK ou SHUTDOWN terminé).
    this._currentFlight = null;

    // Suivi des contacts au sol pour le filtrage des rebonds + la
    // classification touch-and-go / atterrissage final :
    //   _lastContactTs   : date (ms) du DERNIER contact physique. Sert à
    //                      détecter un rebond (contact < BOUNCE_WINDOW_MS après
    //                      le précédent) et à mesurer l'immobilisation (≥15 s).
    //   _landingFirstTs  : date (ms) du PREMIER contact de l'événement courant
    //                      = heure d'atterrissage retenue.
    //   _pendingTouchdown: VS/G mesurés au PREMIER contact ; les rebonds qui
    //                      suivent sont ignorés (on garde la 1re valeur).
    // L'événement se conclut soit en touch-and-go (reparti en l'air au-delà de
    // BOUNCE_WINDOW_MS), soit en atterrissage final (confirmé par le pilote).
    this._lastContactTs = 0;
    this._landingFirstTs = 0;
    this._pendingTouchdown = null;

    // Datetime LOCAL du simulateur « AAAA-MM-JJTHH:MM:SS », alimenté par
    // feedTracking(). Sert à horodater TOUS les événements du carnet à la
    // date/heure du simulateur (et non du PC). _landingFirstSim = datetime sim
    // figé au 1er contact de l'atterrissage courant.
    this._lastSimLocal = null;
    this._landingFirstSim = null;

    // Dernière position connue (mise à jour à chaque feedTracking). Sert à
    // stamper la position des touchers et à échantillonner le tracé effectif.
    this._lastLat = null;
    this._lastLon = null;
    // Horodatage (ms) du dernier point de tracé échantillonné (0 = jamais).
    this._lastTrackSampleTs = 0;

    // Confirmation de fin de vol (≥2 conditions parmi vitesse≈0 / moteur
    // éteint / frein de parking) :
    //   _endConfirmActive   : une demande est en cours (modale ouverte côté
    //                         renderer, en attente de réponse). Pas de relance.
    //   _endConfirmDeclined : l'utilisateur a répondu « Non » ; pas de relance
    //                         tant que les conditions ne sont pas retombées
    //                         sous le seuil de 2 (puis ré-réunies).
    this._endConfirmActive = false;
    this._endConfirmDeclined = false;

    // Dernier état des entrées (utile pour détecter les fronts montants)
    this._lastOnGround = true;
    this._lastEng1 = false;
    this._lastEng2 = false;
  }

  // ----------------------------------------------------------------------
  // API publique appelée par main.js
  // ----------------------------------------------------------------------

  // True si le moteur souhaite recevoir des frames SIM_FRAME (VS + G).
  // main.js bascule en conséquence le groupe SimConnect entre SIM_FRAME
  // et NEVER. Lecture pure — pas d'effet de bord.
  shouldSampleLanding() {
    return this._landingSamplingActive;
  }

  // Pousse le plan de vol courant (event renderer → main). Le moteur
  // garde ce plan en mémoire en permanence ; il sera figé dans le vol
  // au moment exact du décollage (transition OFF_BLOCK → IN_FLIGHT).
  setFlightPlan(plan) {
    if (!Array.isArray(plan)) { this._currentPlan = []; return; }
    // Normalisation : on ne garde que les champs utiles + on coerce les types
    this._currentPlan = plan.map((wp, idx) => ({
      index: idx,
      name: wp && wp.name ? String(wp.name) : '',
      ident: wp && wp.ident ? String(wp.ident) : '',
      lat: Number(wp && wp.lat),
      lon: Number(wp && wp.lon),
      pattern: !!(wp && wp.pattern),
    }));
  }

  // Enregistre un Direct To effectué en cours de vol. event = {kind, ...} :
  //   kind: 'plan'    → { targetIndex, name }
  //   kind: 'airport' → { code, name, lat, lon, pattern }
  //   kind: 'point'   → { lat, lon }
  // Ignoré silencieusement si on n'est pas en vol (rien à enregistrer hors
  // d'un vol actif — évite que des DT déclenchés au sol polluent l'histo).
  recordDirectTo(event) {
    if (!this._currentFlight) return;
    if (!event || !event.kind) return;
    const entry = { ts: new Date().toISOString(), sim: this._lastSimLocal, kind: event.kind };
    if (event.kind === 'plan') {
      entry.targetIndex = Number.isFinite(event.targetIndex) ? event.targetIndex : null;
      entry.name = event.name ? String(event.name) : '';
    } else if (event.kind === 'airport') {
      entry.code = event.code ? String(event.code) : '';
      entry.name = event.name ? String(event.name) : '';
      entry.lat = Number(event.lat);
      entry.lon = Number(event.lon);
      entry.pattern = !!event.pattern;
    } else if (event.kind === 'point') {
      entry.lat = Number(event.lat);
      entry.lon = Number(event.lon);
    } else {
      return; // kind inconnu → ignoré
    }
    this._currentFlight.directTo.push(entry);
  }

  // Tick lent (toutes les 2 s) — variables d'état de l'avion.
  // frame = { onGround, eng1, eng2, lat, lon, groundSpeedKt, altAglFt }
  // Tous les champs numériques sont attendus en unités lisibles (kts, ft, deg).
  feedTracking(frame) {
    if (!this._isEnabled()) {
      // Toggle OFF : on relâche un éventuel sampling rapide et on
      // ne fait rien d'autre. La FSM est conservée en mémoire au cas
      // où l'utilisateur réactive en cours de session — mais aucune
      // transition n'est traitée tant qu'OFF.
      this._setLandingSampling(false);
      return;
    }
    if (!frame) return;

    // Datetime local du simulateur (poussé par main.js). Tenu à jour en continu
    // pour horodater les événements à la date/heure du sim plutôt que du PC.
    if (frame.simLocal) this._lastSimLocal = frame.simLocal;

    const now = Date.now();
    const onGround = !!frame.onGround;
    const eng1 = !!frame.eng1;
    const eng2 = !!frame.eng2;
    const combustion = eng1 || eng2;           // mono OU bimoteur
    const lat = Number.isFinite(frame.lat) ? frame.lat : null;
    const lon = Number.isFinite(frame.lon) ? frame.lon : null;
    const altAgl = Number.isFinite(frame.altAglFt) ? frame.altAglFt : null;
    const gsKt = Number.isFinite(frame.groundSpeedKt) ? frame.groundSpeedKt : null;
    const kiasKt = Number.isFinite(frame.kiasKt) ? frame.kiasKt : null;
    const amslFt = Number.isFinite(frame.amslFt) ? frame.amslFt : null;
    const parkingBrake = !!frame.parkingBrake;

    // Mémorise la dernière position connue (touchers + tracé effectif).
    if (lat !== null) this._lastLat = lat;
    if (lon !== null) this._lastLon = lon;

    // 1) Hystérésis du sampling rapide : ON sous 500, OFF au-dessus de 700.
    //    Désactivé d'office hors IN_FLIGHT (au sol, on ne mesure pas un impact).
    if (this._state === STATES.IN_FLIGHT && altAgl !== null) {
      if (!this._landingSamplingActive && altAgl < LANDING_SAMPLE_ENTER_FT) {
        this._setLandingSampling(true);
      } else if (this._landingSamplingActive && altAgl > LANDING_SAMPLE_EXIT_FT) {
        this._setLandingSampling(false);
      }
    } else if (this._landingSamplingActive) {
      this._setLandingSampling(false);
    }

    // 2) Transitions de la machine à états
    switch (this._state) {

      case STATES.OFF_TRACK: {
        // Démarrage moteur → OFF_BLOCK + capture du départ block.
        // Départ = 1er waypoint du plan courant (stratégie « plan strict »).
        if (combustion) {
          const depWp = this._currentPlan.length ? this._currentPlan[0] : null;
          const dep = this._airportFromWp(depWp);
          const ac = this._getAircraftInfo() || {};
          this._currentFlight = {
            id: new Date().toISOString(),  // identifiant unique = ISO de départ block
            // Identification appareil. Ordre demandé : CATEGORY, ATC TYPE,
            // ATC MODEL, TITLE (les clés JS conservent cet ordre à la sérialisation).
            aircraft: {
              category: ac.category || '',
              type: ac.type || '',
              model: ac.model || '',
              title: ac.title || '',
            },
            departure: {
              icao: dep.icao,
              name: dep.name,
              lat: dep.lat,
              lon: dep.lon,
              offBlockUtc: new Date().toISOString(),
              offBlockSim: this._lastSimLocal,
              takeoffUtc: null,
              takeoffSim: null,
            },
            arrival: null,
            totals: null,
            touchAndGoCount: 0,
            // Atterrissage final (full-stop) — VS/G figés au passage ON_BLOCK
            landing: null,
            // Tous les touchés intermédiaires suivis d'un redécollage, dans
            // l'ordre chronologique. Chaque entrée = même forme que landing
            // ({ts, verticalSpeedFpm, gForceMax, bufferSize}).
            touchAndGoLandings: [],
            route: [],
            directTo: [],
            // Tracé EFFECTIF : positions échantillonnées en vol (toutes les 10 s).
            // Chaque point : {ts, sim, lat, lon, aglFt, groundElevFt}.
            track: [],
          };
          this._transition(STATES.OFF_BLOCK);
        }
        break;
      }

      case STATES.OFF_BLOCK: {
        // Décollage (front descendant de onGround) → IN_FLIGHT + snapshot du plan
        if (!onGround && this._lastOnGround) {
          if (this._currentFlight) {
            this._currentFlight.departure.takeoffUtc = new Date().toISOString();
            this._currentFlight.departure.takeoffSim = this._lastSimLocal;
            // Snapshot figé du plan : on copie le tableau actuel — toute modif
            // ultérieure du plan côté renderer n'affectera plus ce vol.
            this._currentFlight.route = this._currentPlan.map(wp => ({ ...wp }));
          }
          // Force l'échantillonnage immédiat d'un 1er point de tracé au décollage.
          this._lastTrackSampleTs = 0;
          this._transition(STATES.IN_FLIGHT);
        }
        // Cas limite : moteur coupé avant même de décoller → retour OFF_TRACK
        // sans rien enregistrer (le vol n'a pas eu lieu).
        else if (!combustion) {
          this._currentFlight = null;
          this._buffer.clear();
          this._pendingTouchdown = null;
          this._lastContactTs = 0;
          this._landingFirstTs = 0;
          this._endConfirmActive = false;
          this._endConfirmDeclined = false;
          this._transition(STATES.OFF_TRACK);
        }
        break;
      }

      case STATES.IN_FLIGHT: {
        // (a) Contact au sol (front montant de onGround)
        if (onGround && !this._lastOnGround) {
          if (this._pendingTouchdown && (now - this._lastContactTs) <= BOUNCE_WINDOW_MS) {
            // REBOND du même atterrissage : on garde le 1er toucher et on
            // ignore la mesure de ce contact. On purge le buffer (frames du
            // rebond) et on réarme la fenêtre d'immobilisation depuis ce contact.
            this._buffer.clear();
            this._lastContactTs = now;
          } else {
            // Nouveau toucher = 1er contact d'un nouvel événement d'atterrissage.
            this._handleTouchdown(now);
          }
        }

        // (b) Classification : remise de gaz (touch-and-go) confirmée
        if (this._pendingTouchdown
            && !onGround && (now - this._lastContactTs) > BOUNCE_WINDOW_MS) {
          // Reparti en l'air au-delà de la fenêtre rebond → c'était un
          // touch-and-go. On archive le 1er toucher et on annule une
          // éventuelle demande de fin de vol restée ouverte.
          if (this._currentFlight) {
            this._currentFlight.touchAndGoCount++;
            this._currentFlight.touchAndGoLandings.push(this._pendingTouchdown);
          }
          this._pendingTouchdown = null;
          this._lastContactTs = 0;
          this._landingFirstTs = 0;
          this._cancelEndConfirm();
        }

        // (c) Détection de fin de vol : on a atterri (pending présent) et on
        // est au sol. Si ≥2 des 3 conditions {vitesse≈0, moteur éteint, frein
        // de parking} sont réunies → on demande confirmation au pilote.
        if (this._pendingTouchdown && onGround) {
          const cStop   = (gsKt !== null && gsKt < GROUND_STOP_KT) ? 1 : 0;
          const cEngOff = combustion ? 0 : 1;
          const cBrake  = parkingBrake ? 1 : 0;
          const met = cStop + cEngOff + cBrake;
          if (met >= 2) {
            if (!this._endConfirmActive && !this._endConfirmDeclined) {
              this._endConfirmActive = true;
              this._emit('logbook-confirm-end', this._endSummary());
            }
          } else {
            // Conditions retombées → ré-arme pour une future stabilisation.
            this._endConfirmDeclined = false;
          }
        }
        break;
      }

      case STATES.ON_BLOCK: {
        // État transitoire : atteint uniquement via confirmEndOfFlight(true),
        // qui enchaîne immédiatement _handleOnBlock() puis _handleShutdown().
        // On ne déclenche donc plus rien sur la coupure moteur ici (la fin de
        // vol est pilotée par la modale de confirmation).
        break;
      }

      case STATES.SHUTDOWN: {
        // État transitoire — _handleShutdown() rebascule vers OFF_TRACK.
        // Si on est encore ici, c'est qu'une écriture a échoué : on retombe
        // proprement pour ne pas rester bloqué.
        this._transition(STATES.OFF_TRACK);
        break;
      }
    }

    // 2bis) Échantillonnage du tracé EFFECTIF (toutes les 10 s, uniquement en vol).
    //       On capture lat/lon/AGL + relief (closure élévation) pour tracer la
    //       route réellement volée et le profil vertical dans la carte du vol.
    if (this._state === STATES.IN_FLIGHT && this._currentFlight
        && lat !== null && lon !== null
        && (now - this._lastTrackSampleTs) >= TRACK_SAMPLE_INTERVAL_MS) {
      this._lastTrackSampleTs = now;
      const ge = this._elevationAt(lat, lon);
      this._currentFlight.track.push({
        ts: new Date(now).toISOString(),
        sim: this._lastSimLocal,
        lat: Math.round(lat * 1e6) / 1e6,
        lon: Math.round(lon * 1e6) / 1e6,
        aglFt: (altAgl !== null) ? Math.round(altAgl) : null,
        groundElevFt: Number.isFinite(ge) ? Math.round(ge) : null,
        kiasKt: (kiasKt !== null) ? Math.round(kiasKt) : null,
        amslFt: (amslFt !== null) ? Math.round(amslFt) : null,
      });
    }

    // 3) Mémorisation des entrées pour la détection de fronts au prochain tick
    this._lastOnGround = onGround;
    this._lastEng1 = eng1;
    this._lastEng2 = eng2;
  }

  // Tick rapide (SIM_FRAME, ≥20 Hz) — uniquement quand shouldSampleLanding()
  // est vrai. main.js gère le on/off de la souscription SimConnect.
  // vsFpm   : VERTICAL SPEED en feet per minute (négatif = descente)
  // gForce  : G FORCE en G
  feedLandingFrame(vsFpm, gForce) {
    if (!this._isEnabled()) return;
    if (!this._landingSamplingActive) return; // safety belt si tick orphelin
    if (!Number.isFinite(vsFpm) || !Number.isFinite(gForce)) return;
    this._buffer.push({ ts: Date.now(), vsFpm, gForce });
  }

  // Renvoie un instantané de l'état (debug / future UI).
  getState() {
    return {
      state: this._state,
      since: this._stateSince,
      hasFlight: !!this._currentFlight,
      touchAndGoCount: this._currentFlight ? this._currentFlight.touchAndGoCount : 0,
      bufferSize: this._buffer.size,
      landingSampling: this._landingSamplingActive,
    };
  }

  // ----------------------------------------------------------------------
  // Internes
  // ----------------------------------------------------------------------

  _transition(newState) {
    if (this._state === newState) return;
    this._state = newState;
    this._stateSince = Date.now();
    this._emit('logbook-state', {
      state: newState,
      since: this._stateSince,
      touchAndGoCount: this._currentFlight ? this._currentFlight.touchAndGoCount : 0,
    });
  }

  _setLandingSampling(active) {
    if (this._landingSamplingActive === active) return;
    this._landingSamplingActive = active;
    // Sur désactivation, on NE vide PAS le buffer : si l'avion repasse
    // <500 ft tout en restant en vol, les anciennes frames sont périmées
    // mais elles seront évincées naturellement par le FIFO dès que les
    // nouvelles arrivent. On vide en revanche à la transition de phase
    // (post-touchdown traité, ou sortie de IN_FLIGHT).
    if (!active) this._buffer.clear();
    this._emit('logbook-sampling', { active });
  }

  // Construit l'entrée aéroport (départ ou arrivée) depuis un waypoint du plan.
  // Stratégie « plan strict » : ident du WP = ICAO, nom (+ coords) résolus dans
  // la base via _resolveAirport. Pas de repli géographique : si le WP n'a pas
  // d'ident ou est introuvable en base, on conserve ce que le plan fournit.
  _airportFromWp(wp) {
    if (!wp || !wp.ident) {
      return { icao: 'UNKN', name: 'Inconnu', lat: null, lon: null };
    }
    const r = this._resolveAirport(wp.ident);
    if (r) {
      return {
        icao: r.icao || wp.ident,
        name: r.name || wp.ident,
        lat: r.lat,
        lon: r.lon,
      };
    }
    return {
      icao: wp.ident,
      name: wp.name || wp.ident,
      lat: Number.isFinite(wp.lat) ? wp.lat : null,
      lon: Number.isFinite(wp.lon) ? wp.lon : null,
    };
  }

  _handleTouchdown(now) {
    // Figeage IMMÉDIAT du buffer — MSFS écrasera la VS à 0 dans la frame
    // qui suit le contact sol, donc tout ce qui n'a pas été poussé avant
    // ce point est définitivement perdu.
    const snapshot = this._buffer.snapshot();
    let vsMin = 0;            // VS la plus négative trouvée (= impact max)
    let gMax = 0;             // G max
    if (snapshot.length > 0) {
      vsMin = snapshot[0].vsFpm;
      gMax = snapshot[0].gForce;
      for (let i = 1; i < snapshot.length; i++) {
        if (snapshot[i].vsFpm < vsMin) vsMin = snapshot[i].vsFpm;
        if (snapshot[i].gForce > gMax) gMax = snapshot[i].gForce;
      }
    }

    // Buffer consommé → on le vide (frames de cette descente). Chaque toucher
    // ne mesure ainsi que sa propre approche.
    this._buffer.clear();

    const result = {
      ts: new Date(now).toISOString(),
      sim: this._lastSimLocal,   // datetime local sim du toucher
      verticalSpeedFpm: Math.round(vsMin),
      gForceMax: Math.round(gMax * 100) / 100,
      bufferSize: snapshot.length,
      // Position du toucher (pour le marqueur violet sur la carte du tracé).
      lat: Number.isFinite(this._lastLat) ? Math.round(this._lastLat * 1e6) / 1e6 : null,
      lon: Number.isFinite(this._lastLon) ? Math.round(this._lastLon * 1e6) / 1e6 : null,
    };

    // 1er contact de l'événement : on retient sa mesure (les rebonds suivants
    // seront ignorés) et l'heure du toucher.
    this._pendingTouchdown = result;
    this._landingFirstTs = now;
    this._landingFirstSim = this._lastSimLocal;
    this._lastContactTs = now;

    // Nouvel événement d'atterrissage → ré-arme la confirmation de fin de vol
    // (un refus précédent ne doit pas bloquer ce nouvel atterrissage).
    this._endConfirmDeclined = false;

    // Émission immédiate vers le renderer (popup landing-rate).
    this._emit('landing-result', result);
  }

  // Réponse de la modale « Le vol est-il terminé ? » (relayée par main.js).
  //   confirmed = true  → on fige l'arrivée + l'atterrissage et on écrit le vol.
  //   confirmed = false → le vol continue ; on ne relance pas la demande tant
  //                       que les conditions ne sont pas retombées puis ré-réunies.
  // Ignorée s'il n'y a pas de demande active (réponse tardive / obsolète).
  //   precisionScore (optionnel) = score d'évaluation de précision (0..100)
  //                       calculé côté renderer ; figé sur la fiche du vol avant
  //                       écriture JSONL. Absent / non-fini → champ omis.
  confirmEndOfFlight(confirmed, precisionScore) {
    if (!this._endConfirmActive) return;
    this._endConfirmActive = false;
    if (!this._currentFlight) return;
    if (confirmed) {
      if (Number.isFinite(precisionScore)) {
        this._currentFlight.precision = precisionScore;
      }
      this._handleOnBlock();   // arrivée + atterrissage final → ON_BLOCK
      this._handleShutdown();  // totaux + écriture JSONL → OFF_TRACK
    } else {
      this._endConfirmDeclined = true;
    }
  }

  // Annule une demande de confirmation en cours (ex. l'avion a redécollé) et
  // demande au renderer de fermer la modale si elle est ouverte.
  _cancelEndConfirm() {
    if (this._endConfirmActive) {
      this._endConfirmActive = false;
      this._emit('logbook-confirm-cancel', {});
    }
    this._endConfirmDeclined = false;
  }

  // Résumé succinct pour la modale de confirmation (départ/arrivée/appareil).
  // L'arrivée est calculée à titre indicatif (dernier waypoint du plan) ; elle
  // sera figée pour de bon dans _handleOnBlock() si l'utilisateur confirme.
  _endSummary() {
    const f = this._currentFlight;
    const route = (f && Array.isArray(f.route)) ? f.route : [];
    const arrWp = route.length ? route[route.length - 1] : null;
    const arr = this._airportFromWp(arrWp);
    return {
      departureIcao: (f && f.departure) ? f.departure.icao : '',
      arrivalIcao: arr.icao,
      aircraft: (f && f.aircraft) ? f.aircraft.title : '',
      touchAndGoCount: f ? f.touchAndGoCount : 0,
    };
  }

  _handleOnBlock() {
    if (!this._currentFlight) {
      // Cas anormal — on retombe proprement
      this._lastContactTs = 0;
      this._landingFirstTs = 0;
      this._pendingTouchdown = null;
      this._transition(STATES.ON_BLOCK);
      return;
    }
    // Aéroport d'arrivée = dernier waypoint du plan figé (stratégie « plan
    // strict »). Le plan a été snapshotté dans route au décollage.
    const route = Array.isArray(this._currentFlight.route) ? this._currentFlight.route : [];
    const arrWp = route.length ? route[route.length - 1] : null;
    const arr = this._airportFromWp(arrWp);

    this._currentFlight.arrival = {
      icao: arr.icao,
      name: arr.name,
      lat: arr.lat,
      lon: arr.lon,
      // landingUtc = 1er contact de l'atterrissage final (rebonds exclus).
      landingUtc: new Date(this._landingFirstTs).toISOString(),
      landingSim: this._landingFirstSim,
      onBlockUtc: new Date().toISOString(),
      onBlockSim: this._lastSimLocal,
    };

    // L'avion s'est immobilisé : le 1er contact en attente était l'atterrissage
    // final. On le fige dans landing (et PAS dans touchAndGoLandings).
    if (this._pendingTouchdown) {
      this._currentFlight.landing = this._pendingTouchdown;
    }

    this._lastContactTs = 0;
    this._landingFirstTs = 0;
    this._pendingTouchdown = null;
    this._transition(STATES.ON_BLOCK);
  }

  _handleShutdown() {
    if (!this._currentFlight) {
      this._transition(STATES.OFF_TRACK);
      return;
    }
    // Calcul des totaux : block = off→on block ; flight = takeoff→landing.
    // Conversion en minutes entières (arrondi standard) pour l'affichage carnet.
    const f = this._currentFlight;
    const blockStart = Date.parse(f.departure.offBlockUtc);
    const blockEnd = Date.now();
    const takeoff = f.departure.takeoffUtc ? Date.parse(f.departure.takeoffUtc) : null;
    const landing = f.arrival && f.arrival.landingUtc ? Date.parse(f.arrival.landingUtc) : null;

    f.totals = {
      blockMinutes: Math.max(0, Math.round((blockEnd - blockStart) / 60_000)),
      flightMinutes: (takeoff && landing)
        ? Math.max(0, Math.round((landing - takeoff) / 60_000))
        : 0,
    };

    this._transition(STATES.SHUTDOWN);

    // Écriture JSONL append-only — ne bloque pas la FSM si elle échoue
    this._writeFlight(f).then((ok) => {
      if (ok) this._emit('logbook-flight-saved', f);
    }).catch((err) => {
      console.error('[Logbook] Écriture échouée :', err);
    });

    // Reset pour le prochain vol
    this._currentFlight = null;
    this._buffer.clear();
    this._pendingTouchdown = null;
    this._lastContactTs = 0;
    this._landingFirstTs = 0;
    this._endConfirmActive = false;
    this._endConfirmDeclined = false;
    this._transition(STATES.OFF_TRACK);
  }

  // Écrit le vol dans SON fichier individuel « NNNN_DEP-ARR.json » (numéro de
  // séquence = max présent dans le dossier + 1). Création du dossier si absent.
  // Le numéro attribué est aussi stocké dans le vol (champ `seq`). JSON indenté
  // pour rester lisible/exploitable à la main. Erreurs loggées + remontées.
  async _writeFlight(flight) {
    try {
      if (!fs.existsSync(this._logbookDir)) {
        fs.mkdirSync(this._logbookDir, { recursive: true });
      }
      const seq = maxLogbookSeq(this._logbookDir) + 1;
      flight.seq = seq;
      const depIcao = flight.departure ? flight.departure.icao : '';
      const arrIcao = flight.arrival ? flight.arrival.icao : '';
      const fileName = logbookFileName(seq, depIcao, arrIcao);
      const filePath = path.join(this._logbookDir, fileName);
      await fs.promises.writeFile(filePath, JSON.stringify(flight, null, 2), 'utf-8');
      console.log('[Logbook] Vol enregistré :', fileName,
        '(' + flight.totals.flightMinutes + ' min vol)');
      return true;
    } catch (err) {
      console.error('[Logbook] Erreur écriture du fichier de vol :', err);
      throw err;
    }
  }
}

// Factory : main.js fait `const lb = createLogbook({...})` une seule fois.
function createLogbook(opts) {
  return new LogbookEngine(opts);
}

module.exports = {
  createLogbook,
  getClosestAirport,
  // Nommage des fichiers de vol individuels (partagé avec la migration main.js)
  logbookFileName,
  maxLogbookSeq,
  sanitizeIcao,
  STATES,
  // Exportés pour testabilité / introspection éventuelle
  RollingBuffer,
  ROLLING_BUFFER_SIZE,
  TOUCH_AND_GO_WINDOW_MS,
  BOUNCE_WINDOW_MS,
  GROUND_STOP_KT,
  LANDING_SAMPLE_ENTER_FT,
  LANDING_SAMPLE_EXIT_FT,
};

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

/* ============================================================
 * PROTOTYPE / SONDE : navaids autour de l'avion (MSFS 2024)
 * ------------------------------------------------------------
 * BUT : MESURER, sans rien changer à l'app, ce que SimConnect
 * renvoie réellement via l'API Facility "list" pour les VOR,
 * NDB et WAYPOINT — couverture (rayon autour de l'avion),
 * débit (entrées/s), complétude des champs (fréquence, magvar,
 * glide/ILS), et taux de doublons.
 *
 * Ce n'est PAS un extracteur de production : il ne produit pas
 * la base navaids. Il sert à décider si l'approche "tout
 * SimConnect" vaut le coup avant d'investir (cf. note mémoire
 * decision_msfs_only_airports). Renderer/main NON touchés.
 *
 * Méthode :
 *   - subscribeToFacilities(VOR/NDB/WAYPOINT) : envoie la liste
 *     "cached" actuelle (ce qui est chargé autour de l'avion)
 *     PUIS pousse les nouveaux éléments au fil du streaming.
 *   - On lit PLANE LATITUDE/LONGITUDE pour calculer la distance
 *     de chaque navaid → rayon de couverture effectif.
 *   - On dé-doublonne (icao+region+pos arrondie) et on chronomètre.
 *
 * Sortie :
 *   - console : progression 1 Hz + résumé final (couverture,
 *     débit, complétude, histogramme de distance).
 *   - fichier : Documents/NavXpressVFR/navaids-probe.jsonl
 *     (un navaid par ligne, pour inspection manuelle).
 *
 * Pré-requis : MSFS 2024 lancé, un vol chargé (avion posé OK).
 *
 * Usage :
 *   node probe-navaids-msfs.js [--seconds N] [--types vor,ndb,wpt]
 *                              [--out DIR] [--no-file]
 *   (défauts : 90 s, les 3 types, dossier Documents/NavXpressVFR)
 * ============================================================ */

const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  open: scOpen,
  Protocol: SCProtocol,
  FacilityListType,
  SimConnectDataType: SCDataType,
  SimConnectPeriod: SCPeriod,
  SimConnectConstants: SCConst,
} = require('node-simconnect');

// --------------------------------------------------------------
// Constantes
// --------------------------------------------------------------
const REQ_VOR = 8101;
const REQ_NDB = 8102;
const REQ_WPT = 8103;

const POS_DEF_ID = 8200;
const POS_REQ_ID = 8201;

const DEFAULT_OUT_DIR = path.join(os.homedir(), 'Documents', 'NavXpressVFR');
const OUT_FILENAME = 'navaids-probe.jsonl';

const DEFAULT_SECONDS = 90;

// --------------------------------------------------------------
// Helpers
// --------------------------------------------------------------
function round(v, n) { const f = 10 ** n; return Math.round(v * f) / f; }
function normMagVar(m) {
  if (!Number.isFinite(m)) return null;
  let v = m % 360;
  if (v > 180) v -= 360;
  return round(v, 1);
}
// Distance grand-cercle en NM entre deux points (lat/lon en °).
function haversineNM(lat1, lon1, lat2, lon2) {
  const R = 3440.065; // rayon terrestre moyen en milles nautiques
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}
function fmtDuration(ms) {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
}
// Clé de dé-doublonnage : un même navaid est ré-émis à chaque (re)subscribe.
function key(icao, region, lat, lon) {
  return `${icao}|${region}|${lat.toFixed(3)}|${lon.toFixed(3)}`;
}

// ==============================================================
// Sonde réutilisable
// ==============================================================
// Options : { seconds, types:Set<'vor'|'ndb'|'wpt'>, outDir, writeFile, onProgress }
// Résout avec un objet summary ; rejette si la connexion échoue.
function runProbe(opts = {}) {
  const SECONDS = opts.seconds > 0 ? opts.seconds : DEFAULT_SECONDS;
  const TYPES = opts.types || new Set(['vor', 'ndb', 'wpt']);
  const OUT_DIR = opts.outDir || DEFAULT_OUT_DIR;
  const WRITE_FILE = opts.writeFile !== false;
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};

  const OUT_FILE = path.join(OUT_DIR, OUT_FILENAME);

  return new Promise((resolve, reject) => {
    let handle = null;
    let finished = false;
    let simName = '';

    // Position avion (pour le rayon de couverture). null tant que non reçue.
    let acft = { lat: null, lon: null, haveFix: false };

    // Stockage dé-doublonné par type.
    const store = { vor: new Map(), ndb: new Map(), wpt: new Map() };
    // Compteurs bruts (avant dé-doublonnage) = débit réseau réel.
    const rawCount = { vor: 0, ndb: 0, wpt: 0 };

    let startTime = 0;
    let endTimer = null;
    let progTimer = null;

    const emit = (p) => { try { onProgress(p); } catch (_) {} };

    // ---- enregistrement d'un navaid ----
    function record(kind, f, extra) {
      rawCount[kind]++;
      const lat = f.latitude, lon = f.longitude;
      const k = key(f.icao, f.region, lat, lon);
      const m = store[kind];
      if (m.has(k)) return; // déjà vu (ré-émission)
      const rec = {
        kind,
        icao: f.icao,
        region: f.region,
        latitude_deg: round(lat, 6),
        longitude_deg: round(lon, 6),
        elevation_ft: Number.isFinite(f.altitude) ? Math.round(f.altitude / 0.3048) : null,
        magnetic_variation_deg: normMagVar(f.magVar),
        distance_nm: null, // recalculé en fin de sonde (cf. finish)
        ...extra,
      };
      m.set(k, rec);
    }

    function finish(reason) {
      if (finished) return;
      finished = true;
      if (endTimer) { clearTimeout(endTimer); endTimer = null; }
      if (progTimer) { clearInterval(progTimer); progTimer = null; }

      // Désabonnement propre (best-effort).
      try {
        if (handle) {
          if (TYPES.has('vor')) handle.unSubscribeToFacilities(FacilityListType.VOR);
          if (TYPES.has('ndb')) handle.unSubscribeToFacilities(FacilityListType.NDB);
          if (TYPES.has('wpt')) handle.unSubscribeToFacilities(FacilityListType.WAYPOINT);
        }
      } catch (_) {}

      const elapsed = startTime ? Date.now() - startTime : 0;

      const buildTypeStats = (kind) => {
        const recs = [...store[kind].values()];
        // Rayons recalculés ICI (et non à la réception) : la liste "cached"
        // arrive avant le 1er fix avion (période SECOND), donc distance_nm
        // serait nulle pour tout le monde. On recalcule depuis la position
        // avion finale + les coordonnées stockées de chaque navaid.
        const dists = acft.haveFix
          ? recs
              .map((r) => haversineNM(acft.lat, acft.lon, r.latitude_deg, r.longitude_deg))
              .filter((d) => Number.isFinite(d))
          : [];
        const withFreq = recs.filter((r) => r.frequency_mhz != null || r.frequency_khz != null).length;
        const withMag = recs.filter((r) => r.magnetic_variation_deg != null).length;
        return {
          unique: recs.length,
          raw: rawCount[kind],
          duplicates: rawCount[kind] - recs.length,
          maxDistNM: dists.length ? round(Math.max(...dists), 1) : null,
          medDistNM: dists.length ? round(dists.sort((a, b) => a - b)[Math.floor(dists.length / 2)], 1) : null,
          withFreqPct: recs.length ? Math.round((withFreq / recs.length) * 100) : null,
          withMagPct: recs.length ? Math.round((withMag / recs.length) * 100) : null,
        };
      };

      // Écriture du fichier EN FIN de sonde : on a maintenant la position
      // avion finale → on recalcule distance_nm pour chaque navaid stocké.
      let fileWritten = null;
      if (WRITE_FILE) {
        try {
          fs.mkdirSync(OUT_DIR, { recursive: true });
          const lines = [JSON.stringify({
            __meta: true, kind: 'navaids-probe', sim: simName,
            generatedAt: new Date().toISOString(),
            aircraft: acft.haveFix ? { lat: round(acft.lat, 5), lon: round(acft.lon, 5) } : null,
          })];
          for (const kind of ['vor', 'ndb', 'wpt']) {
            for (const rec of store[kind].values()) {
              rec.distance_nm = acft.haveFix
                ? round(haversineNM(acft.lat, acft.lon, rec.latitude_deg, rec.longitude_deg), 1)
                : null;
              lines.push(JSON.stringify(rec));
            }
          }
          fs.writeFileSync(OUT_FILE, lines.join('\n') + '\n', 'utf8');
          fileWritten = OUT_FILE;
        } catch (_) { /* écriture échouée : summary.file restera null */ }
      }

      try { handle && handle.close(); } catch (_) {}
      const summary = {
        ok: true,
        reason,
        sim: simName,
        durationMs: elapsed,
        haveAircraftFix: acft.haveFix,
        aircraft: acft.haveFix ? { lat: round(acft.lat, 5), lon: round(acft.lon, 5) } : null,
        vor: TYPES.has('vor') ? buildTypeStats('vor') : null,
        ndb: TYPES.has('ndb') ? buildTypeStats('ndb') : null,
        wpt: TYPES.has('wpt') ? buildTypeStats('wpt') : null,
        file: fileWritten,
      };
      emit({ phase: 'done', ...summary });
      resolve(summary);
    }

    // ---- connexion ----
    emit({ phase: 'connect' });
    scOpen(opts.appName || 'NavXpressVFR-Probe', SCProtocol.SunRise).then((res) => {
      handle = res.handle;
      simName = (res.recvOpen && res.recvOpen.applicationName) || '';
      emit({ phase: 'connected', sim: simName });

      // Position avion : 1 Hz (pour rayon de couverture).
      handle.addToDataDefinition(POS_DEF_ID, 'PLANE LATITUDE', 'degrees', SCDataType.FLOAT64);
      handle.addToDataDefinition(POS_DEF_ID, 'PLANE LONGITUDE', 'degrees', SCDataType.FLOAT64);
      handle.requestDataOnSimObject(POS_REQ_ID, POS_DEF_ID, SCConst.OBJECT_ID_USER, SCPeriod.SECOND, 0, 0, 0);

      handle.on('simObjectData', (recv) => {
        if (recv.requestID !== POS_REQ_ID) return;
        try {
          const lat = recv.data.readFloat64();
          const lon = recv.data.readFloat64();
          if (Number.isFinite(lat) && Number.isFinite(lon)) {
            acft.lat = lat; acft.lon = lon; acft.haveFix = true;
          }
        } catch (_) {}
      });

      // --- VOR ---
      handle.on('vorList', (recv) => {
        if (recv.requestID !== REQ_VOR) return;
        for (const v of recv.vors) {
          record('vor', v, {
            frequency_mhz: Number.isFinite(v.frequency) ? round(v.frequency / 1e6, 3) : null,
            has_dme: v.hasDME(),
            has_localizer: v.hasLocalizer(),
            has_glide_slope: v.hasGlideSlope(),
            has_nav_signal: v.hasNavSignal(),
            glide_slope_angle: v.hasGlideSlope() && Number.isFinite(v.glideSlipeAngle) ? round(v.glideSlipeAngle, 2) : null,
          });
        }
      });

      // --- NDB ---
      handle.on('ndbList', (recv) => {
        if (recv.requestID !== REQ_NDB) return;
        for (const n of recv.ndbs) {
          record('ndb', n, {
            frequency_khz: Number.isFinite(n.frequency) ? round(n.frequency / 1000, 1) : null,
          });
        }
      });

      // --- WAYPOINT ---
      handle.on('waypointList', (recv) => {
        if (recv.requestID !== REQ_WPT) return;
        for (const w of recv.waypoints) {
          record('wpt', w, {});
        }
      });

      handle.on('exception', (ex) => {
        emit({ phase: 'exception', exception: ex && ex.exception, sendId: ex && ex.sendId });
      });
      handle.on('error', () => { /* transport : le timer de fin gère */ });
      handle.on('quit', () => finish('sim fermé'));

      // Abonnements (envoie la liste cached immédiatement, puis stream).
      if (TYPES.has('vor')) handle.subscribeToFacilities(FacilityListType.VOR, REQ_VOR);
      if (TYPES.has('ndb')) handle.subscribeToFacilities(FacilityListType.NDB, REQ_NDB);
      if (TYPES.has('wpt')) handle.subscribeToFacilities(FacilityListType.WAYPOINT, REQ_WPT);

      startTime = Date.now();

      // Progression 1 Hz.
      progTimer = setInterval(() => {
        if (finished) return;
        const elapsed = (Date.now() - startTime) / 1000;
        const totRaw = rawCount.vor + rawCount.ndb + rawCount.wpt;
        emit({
          phase: 'tick',
          elapsed,
          remaining: Math.max(0, SECONDS - elapsed),
          haveFix: acft.haveFix,
          vor: store.vor.size, ndb: store.ndb.size, wpt: store.wpt.size,
          rawTotal: totRaw,
          ratePerSec: elapsed > 0 ? totRaw / elapsed : 0,
        });
      }, 1000);

      // Fin programmée.
      endTimer = setTimeout(() => finish(`durée ${SECONDS}s atteinte`), SECONDS * 1000);
    }).catch((err) => {
      reject(new Error((err && err.message) || 'connexion impossible'));
    });
  });
}

module.exports = { runProbe, OUT_FILENAME, DEFAULT_OUT_DIR };

// ==============================================================
// CLI
// ==============================================================
if (require.main === module) {
  function argVal(name, def) {
    const i = process.argv.indexOf(name);
    return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
  }
  const SECONDS = parseInt(argVal('--seconds', String(DEFAULT_SECONDS)), 10) || DEFAULT_SECONDS;
  const OUT_DIR = argVal('--out', DEFAULT_OUT_DIR);
  const WRITE_FILE = process.argv.indexOf('--no-file') === -1;
  const typesArg = argVal('--types', 'vor,ndb,wpt');
  const TYPES = new Set(
    typesArg.split(',').map((s) => s.trim().toLowerCase())
      .map((s) => (s === 'waypoint' ? 'wpt' : s))
      .filter((s) => ['vor', 'ndb', 'wpt'].includes(s))
  );

  const onProgress = (p) => {
    switch (p.phase) {
      case 'connect':
        console.log('Connexion à MSFS via SimConnect (protocole SunRise / MSFS 2024)…');
        break;
      case 'connected':
        console.log('Connecté à : ' + p.sim);
        console.log(`Abonnement aux navaids (${[...TYPES].join(', ')}) pour ${SECONDS}s.`);
        console.log('→ Pour mesurer la couverture en vol : laissez tourner, voire déplacez l\'avion.\n');
        break;
      case 'tick':
        process.stdout.write(
          `\r[${Math.round(p.elapsed)}s/${SECONDS}s] ` +
          `VOR:${p.vor}  NDB:${p.ndb}  WPT:${p.wpt}  ` +
          `(brut ${p.rawTotal}, ${p.ratePerSec.toFixed(0)}/s)  ` +
          `${p.haveFix ? 'fix avion ✓' : 'fix avion …'}   `
        );
        break;
      case 'exception':
        // Affiché en clair une seule fois suffirait ; ici on reste discret.
        break;
      default:
        break;
    }
  };

  runProbe({ seconds: SECONDS, types: TYPES, outDir: OUT_DIR, writeFile: WRITE_FILE, onProgress })
    .then((s) => {
      const line = (label, st) => {
        if (!st) return;
        console.log(
          `  ${label.padEnd(9)} uniques:${String(st.unique).padStart(5)}  ` +
          `brut:${String(st.raw).padStart(6)}  doublons:${String(st.duplicates).padStart(6)}  ` +
          `rayon max:${st.maxDistNM == null ? '   ?' : String(st.maxDistNM).padStart(5)} NM  ` +
          `méd:${st.medDistNM == null ? '  ?' : String(st.medDistNM).padStart(4)} NM  ` +
          `freq:${st.withFreqPct == null ? ' - ' : st.withFreqPct + '%'}  ` +
          `magvar:${st.withMagPct == null ? ' - ' : st.withMagPct + '%'}`
        );
      };
      console.log('\n\n──────────────────────────────────────────────');
      console.log(`Fin de la sonde (${s.reason}).`);
      console.log(`  Sim                : ${s.sim}`);
      console.log(`  Durée              : ${fmtDuration(s.durationMs)}`);
      console.log(`  Fix avion obtenu   : ${s.haveAircraftFix ? 'oui' : 'NON (rayons non calculés)'}` +
        (s.aircraft ? `  @ ${s.aircraft.lat}, ${s.aircraft.lon}` : ''));
      console.log('  ────────────────────────────────────────────');
      line('VOR/DME', s.vor);
      line('NDB', s.ndb);
      line('WAYPOINT', s.wpt);
      console.log('  ────────────────────────────────────────────');
      console.log('  Lecture : "uniques" = navaids distincts vus ; "brut" = total reçu');
      console.log('  (doublons = ré-émissions) ; "rayon max" = portée effective de');
      console.log('  l\'API list autour de l\'avion ; freq/magvar = complétude des champs.');
      if (s.file) console.log(`\n✅ Détail écrit : ${s.file}`);
      console.log('──────────────────────────────────────────────');
      process.exit(0);
    })
    .catch((err) => {
      console.log('\n❌ Connexion impossible :', err.message);
      console.log('   → MSFS 2024 est-il lancé avec un vol en cours ?');
      process.exit(1);
    });
}

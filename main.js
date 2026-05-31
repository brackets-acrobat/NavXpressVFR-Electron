const { app, BrowserWindow, ipcMain, dialog, session } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const extract = require('extract-zip'); // Extraction d'archives ZIP (données d'élévation)
const geomagnetism = require('geomagnetism'); // Le NOUVEAU module magnétique fiable
const {
  open: scOpen,
  Protocol: SCProtocol,
  SimConnectDataType: SCDataType,
  SimConnectPeriod: SCPeriod,
  SimConnectConstants: SCConst,
} = require('node-simconnect');

// Moteur d'extraction des aéroports MSFS 2024 (module partagé avec le CLI).
const { runExtraction: runMsfsExtraction } = require('./extract-airports-msfs');

// --- CHEMINS DE STOCKAGE ---
function getNavXpressDirs() {
  const docs = app.getPath('documents');
  const root         = path.join(docs, 'NavXpressVFR');
  const apiDir       = path.join(root, 'API');
  const fpDir        = path.join(root, 'Flight plans');
  const ourAirportsDir = path.join(root, 'ourairports data');
  const elevationDir = path.join(root, 'elevation');
  return { root, apiDir, fpDir, ourAirportsDir, elevationDir };
}

function getApiKeyPath() {
  return path.join(getNavXpressDirs().apiDir, 'openaip.json');
}

function ensureNavXpressDirs() {
  const { root, apiDir, fpDir, ourAirportsDir, elevationDir } = getNavXpressDirs();
  [root, apiDir, fpDir, ourAirportsDir, elevationDir].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });
}

// --- ÉLÉVATION (dataset GLOBE 30 arc-sec, ~1 km) ---
// 16 tuiles a10g..p10g pavant le globe ; entiers 16-bit signés little-endian,
// en mètres, rangés depuis le coin NO de chaque tuile. Océan / no-data = -500.
const GLOBE_COLS = 10800;          // colonnes par tuile (90° à 30")
const GLOBE_CELL = 1 / 120;        // degrés par cellule (30 arc-sec)
const GLOBE_BANDS = [
  { latMax: 90,  rows: 4800, tiles: ['a10g', 'b10g', 'c10g', 'd10g'] }, // 50°N..90°N
  { latMax: 50,  rows: 6000, tiles: ['e10g', 'f10g', 'g10g', 'h10g'] }, // 0°..50°N
  { latMax: 0,   rows: 6000, tiles: ['i10g', 'j10g', 'k10g', 'l10g'] }, // 50°S..0°
  { latMax: -50, rows: 4800, tiles: ['m10g', 'n10g', 'o10g', 'p10g'] }, // 90°S..50°S
];
const _globeFds = new Map(); // nom tuile -> descripteur (null si fichier absent)

function _globeFd(tile) {
  if (_globeFds.has(tile)) return _globeFds.get(tile);
  let fd = null;
  try { fd = fs.openSync(path.join(getNavXpressDirs().elevationDir, tile), 'r'); }
  catch (e) { fd = null; }
  _globeFds.set(tile, fd);
  return fd;
}

// Élévation en mètres à (lat, lon). null si tuile absente, 0 pour océan/no-data.
const _globeBuf = Buffer.alloc(2);
function lireElevation(lat, lon) {
  if (!isFinite(lat) || !isFinite(lon)) return 0;
  const la = Math.max(-90, Math.min(90, lat));
  const lo = ((lon + 180) % 360 + 360) % 360 - 180; // normalise dans [-180,180)
  let b;
  if (la >= 50) b = 0; else if (la >= 0) b = 1; else if (la >= -50) b = 2; else b = 3;
  const band = GLOBE_BANDS[b];
  let g = Math.floor((lo + 180) / 90);
  if (g < 0) g = 0; else if (g > 3) g = 3;
  const fd = _globeFd(band.tiles[g]);
  if (fd == null) return null;
  let row = Math.floor((band.latMax - la) / GLOBE_CELL);
  if (row < 0) row = 0; else if (row >= band.rows) row = band.rows - 1;
  let col = Math.floor((lo - (-180 + g * 90)) / GLOBE_CELL);
  if (col < 0) col = 0; else if (col >= GLOBE_COLS) col = GLOBE_COLS - 1;
  try { fs.readSync(fd, _globeBuf, 0, 2, (row * GLOBE_COLS + col) * 2); }
  catch (e) { return null; }
  const v = _globeBuf.readInt16LE(0);
  return v <= -500 ? 0 : v;
}

// Distance grand-cercle en milles nautiques.
function _distNM(aLat, aLon, bLat, bLon) {
  const R = 3440.065, toRad = Math.PI / 180;
  const dLat = (bLat - aLat) * toRad, dLon = (bLon - aLon) * toRad;
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * toRad) * Math.cos(bLat * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

// Les tuiles GLOBE sont-elles déjà installées (à la racine de elevation/) ?
function elevationTilesPresent() {
  const { elevationDir } = getNavXpressDirs();
  return ['a10g', 'g10g', 'p10g'].every(t => fs.existsSync(path.join(elevationDir, t)));
}

// Ferme et oublie les descripteurs GLOBE ouverts (avant un (ré)import).
function resetGlobeFds() {
  for (const fd of _globeFds.values()) {
    if (fd != null) { try { fs.closeSync(fd); } catch (e) { /* silencieux */ } }
  }
  _globeFds.clear();
}

// --- OURAIRPORTS : liste des fichiers à récupérer ---
const OURAIRPORTS_FILES = [
  { name: 'airports',            url: 'https://davidmegginson.github.io/ourairports-data/airports.csv' },
  { name: 'airport-frequencies', url: 'https://davidmegginson.github.io/ourairports-data/airport-frequencies.csv' },
  { name: 'airport-comments',    url: 'https://davidmegginson.github.io/ourairports-data/airport-comments.csv' },
  { name: 'runways',             url: 'https://davidmegginson.github.io/ourairports-data/runways.csv' },
  { name: 'navaids',             url: 'https://davidmegginson.github.io/ourairports-data/navaids.csv' },
  { name: 'countries',           url: 'https://davidmegginson.github.io/ourairports-data/countries.csv' },
  { name: 'regions',             url: 'https://davidmegginson.github.io/ourairports-data/regions.csv' },
];

// Télécharge une URL HTTPS en suivant jusqu'à 5 redirections.
function httpsGetFollow(url, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    const doGet = (currentUrl, redirectsLeft) => {
      const req = https.get(currentUrl, { headers: { 'User-Agent': 'NavXpressVFR-Electron' } }, (res) => {
        const { statusCode, headers } = res;
        if (statusCode >= 300 && statusCode < 400 && headers.location) {
          if (redirectsLeft <= 0) {
            res.resume();
            reject(new Error('Trop de redirections pour ' + url));
            return;
          }
          res.resume();
          const next = new URL(headers.location, currentUrl).toString();
          doGet(next, redirectsLeft - 1);
          return;
        }
        if (statusCode !== 200) {
          res.resume();
          reject(new Error('HTTP ' + statusCode + ' pour ' + currentUrl));
          return;
        }
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        res.on('error', reject);
      });
      req.on('error', reject);
      req.setTimeout(60000, () => {
        req.destroy(new Error('Timeout (60s) pour ' + currentUrl));
      });
    };
    doGet(url, maxRedirects);
  });
}

// Télécharge une URL HTTPS en streaming vers un fichier (binaire, gros volumes).
// Suit les redirections, signale la progression via onProgress(reçu, total).
function downloadToFile(url, destPath, onProgress, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    const doGet = (currentUrl, redirectsLeft) => {
      const req = https.get(currentUrl, { headers: { 'User-Agent': 'NavXpressVFR-Electron' } }, (res) => {
        const { statusCode, headers } = res;
        if (statusCode >= 300 && statusCode < 400 && headers.location) {
          if (redirectsLeft <= 0) { res.resume(); reject(new Error('Trop de redirections pour ' + url)); return; }
          res.resume();
          doGet(new URL(headers.location, currentUrl).toString(), redirectsLeft - 1);
          return;
        }
        if (statusCode !== 200) { res.resume(); reject(new Error('HTTP ' + statusCode + ' pour ' + currentUrl)); return; }

        const total = parseInt(headers['content-length'] || '0', 10);
        let received = 0;
        const out = fs.createWriteStream(destPath);
        res.on('data', (chunk) => {
          received += chunk.length;
          if (onProgress) onProgress(received, total);
        });
        res.on('error', (e) => { out.destroy(); reject(e); });
        out.on('error', (e) => reject(e));
        out.on('finish', () => out.close(() => resolve({ received, total })));
        res.pipe(out);
      });
      req.on('error', reject);
      // Timeout d'inactivité : se déclenche seulement si aucune donnée ne circule.
      req.setTimeout(90000, () => req.destroy(new Error('Timeout (90 s sans données) pour ' + currentUrl)));
    };
    doGet(url, maxRedirects);
  });
}

// Parser CSV minimaliste mais conforme à RFC 4180 : gère guillemets doubles,
// virgules et sauts de ligne dans les champs entre guillemets.
function parseCSV(text) {
  // Normaliser les fins de ligne
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // strip BOM
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        row.push(field); field = '';
      } else if (c === '\r') {
        // ignore — \n suivra
      } else if (c === '\n') {
        row.push(field); field = '';
        rows.push(row); row = [];
      } else {
        field += c;
      }
    }
  }
  // Dernière cellule / ligne (fichier sans \n final)
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  if (rows.length === 0) return [];
  const headers = rows[0];
  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    // Ignorer les lignes complètement vides
    if (cells.length === 1 && cells[0] === '') continue;
    const obj = {};
    for (let h = 0; h < headers.length; h++) {
      obj[headers[h]] = cells[h] !== undefined ? cells[h] : '';
    }
    out.push(obj);
  }
  return out;
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 1280,
    minHeight: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.setMenuBarVisibility(false);
  // DevTools (console de debug) seulement en mode développement,
  // jamais dans la version packagée distribuée aux utilisateurs.
  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools();
  }
  mainWindow.loadFile(path.join(__dirname, 'src/index.html'));
}

// --- ÉCOUTEURS INTER-PROCESSUS (IPC) ---

// 1. Calcul de la déclinaison magnétique avec Geomagnetism
ipcMain.handle('calculer-declinaison', async (event, { lat, lon, alt }) => {
  try {
    // Interroge le modèle magnétique mondial pour les coordonnées données
    const info = geomagnetism.model().point([lat, lon]);
    const decl = info.decl; // Récupère la déclinaison exacte

    return {
      valeur: Math.abs(decl).toFixed(2),
      direction: decl >= 0 ? "E" : "O"
    };
  } catch (err) {
    console.error("Erreur calcul Geomagnetism dans Main Process:", err);
    return { valeur: "0.00", direction: "E" };
  }
});

// 1bis. Profil vertical : échantillonne le relief GLOBE le long du plan de vol.
// payload = { waypoints: [{lat,lon,name}], legAltitudes: [null, alt1, alt2, ...] }
// Renvoie distances (NM), terrain (ft) et altitude prévue (ft) par échantillon.
ipcMain.handle('profil-vertical', async (event, payload) => {
  const wps = Array.isArray(payload && payload.waypoints) ? payload.waypoints : [];
  const legAlt = Array.isArray(payload && payload.legAltitudes) ? payload.legAltitudes : [];
  if (wps.length < 2) return { ok: false, dist: [], terrain: [], planned: [], waypoints: [] };

  const M2FT = 3.28084;
  const ALT_FALLBACK = 3000;

  // Distance par leg (NM) — legDist[i] = wp[i-1] -> wp[i]
  const legDist = [];
  let totalNM = 0;
  for (let i = 1; i < wps.length; i++) {
    const d = _distNM(wps[i - 1].lat, wps[i - 1].lon, wps[i].lat, wps[i].lon);
    legDist[i] = d;
    totalNM += d;
  }

  // Pas d'échantillonnage : ~1 km (résolution GLOBE), borné à MAX_SAMPLES points.
  const MAX_SAMPLES = 1500;
  const totalKm = totalNM * 1.852;
  let stepKm = 1.0;
  if (totalKm / stepKm > MAX_SAMPLES) stepKm = totalKm / MAX_SAMPLES;

  const dist = [], terrain = [], planned = [], waypoints = [];
  let cumNM = 0;
  let gotData = false; // au moins une tuile GLOBE a pu être lue
  waypoints.push({ d: 0, name: (wps[0].name || '') });

  for (let i = 1; i < wps.length; i++) {
    const a = wps[i - 1], b = wps[i];
    const legNM = legDist[i];
    const altFt = (legAlt[i] != null ? legAlt[i] : ALT_FALLBACK);
    const nSeg = Math.max(1, Math.round((legNM * 1.852) / stepKm));
    // s commence à 0 sur le 1er leg (inclut le point de départ), sinon à 1
    // pour ne pas dupliquer le waypoint partagé entre deux legs.
    for (let s = (i === 1 ? 0 : 1); s <= nSeg; s++) {
      const f = s / nSeg;
      const lat = a.lat + (b.lat - a.lat) * f;
      const lon = a.lon + (b.lon - a.lon) * f;
      let e = lireElevation(lat, lon);
      if (e == null) e = 0; else gotData = true;
      dist.push(cumNM + legNM * f);
      terrain.push(e * M2FT);
      planned.push(altFt);
    }
    cumNM += legNM;
    waypoints.push({ d: cumNM, name: (b.name || '') });
  }

  // Aucune tuile lisible → relief indisponible (dossier elevation absent)
  if (!gotData) return { ok: false, reason: 'no-data', dist: [], terrain: [], planned: [], waypoints: [] };

  return { ok: true, totalNM, dist, terrain, planned, waypoints };
});

// 1ter. Données d'élévation déjà présentes ?
ipcMain.handle('elevation-existe', async () => {
  try { ensureNavXpressDirs(); return elevationTilesPresent(); }
  catch (e) { return false; }
});

// 1quater. Importer les données d'élévation : crée Documents/NavXpressVFR/elevation,
// télécharge all10g.zip (dataset GLOBE complet), l'extrait, aplatit le sous-dossier
// all10/ et supprime l'archive. Progression via events 'elevation-progress'.
const ELEVATION_ZIP_URL = 'https://www.ngdc.noaa.gov/mgg/topo/DATATILES/elev/all10g.zip';
ipcMain.handle('importer-elevation', async (event) => {
  ensureNavXpressDirs();
  const { elevationDir } = getNavXpressDirs();
  const wc = event.sender;
  const zipPath = path.join(elevationDir, 'all10g.zip');

  resetGlobeFds(); // libère d'éventuels descripteurs ouverts (cas du réimport)

  try {
    wc.send('elevation-progress', { type: 'start' });

    // 1) Téléchargement (progression limitée à ~4 msg/s)
    let lastSent = 0;
    await downloadToFile(ELEVATION_ZIP_URL, zipPath, (received, total) => {
      const now = Date.now();
      if (now - lastSent >= 250 || (total && received >= total)) {
        lastSent = now;
        wc.send('elevation-progress', { type: 'download', received, total });
      }
    });

    // 2) Extraction de l'archive
    wc.send('elevation-progress', { type: 'extract' });
    await extract(zipPath, { dir: elevationDir });

    // 3) Aplatissement : déplace elevation/all10/* vers elevation/
    wc.send('elevation-progress', { type: 'flatten' });
    const all10Dir = path.join(elevationDir, 'all10');
    if (fs.existsSync(all10Dir)) {
      for (const name of fs.readdirSync(all10Dir)) {
        const src = path.join(all10Dir, name);
        const dst = path.join(elevationDir, name);
        try { if (fs.existsSync(dst)) fs.rmSync(dst, { force: true }); } catch (e) { /* silencieux */ }
        fs.renameSync(src, dst);
      }
      try { fs.rmSync(all10Dir, { recursive: true, force: true }); } catch (e) { /* silencieux */ }
    }

    // 4) Nettoyage de l'archive
    try { fs.rmSync(zipPath, { force: true }); } catch (e) { /* silencieux */ }

    const ok = elevationTilesPresent();
    wc.send('elevation-progress', { type: 'done', dir: elevationDir, ok });
    return { ok, dir: elevationDir };
  } catch (err) {
    console.error('[Elevation] Import échec :', err);
    try { if (fs.existsSync(zipPath)) fs.rmSync(zipPath, { force: true }); } catch (e) { /* silencieux */ }
    wc.send('elevation-progress', { type: 'error', error: err.message });
    return { ok: false, error: err.message };
  }
});

// 2. Écouteur pour Ouvrir un fichier .lnmpln
ipcMain.handle('ouvrir-dialogue-lnm', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, {
    title: "Importer un plan de vol Little Navmap",
    properties: ['openFile'],
    filters: [{ name: 'Fichiers Little Navmap', extensions: ['lnmpln'] }]
  });

  if (result.canceled || result.filePaths.length === 0) return null;

  try {
    return fs.readFileSync(result.filePaths[0], 'utf-8');
  } catch (err) {
    console.error("Erreur de lecture du fichier:", err);
    return null;
  }
});

// 3a. Sauvegarder un plan de vol au format natif .navxpv
ipcMain.handle('sauvegarder-navxpv', async (event, planData) => {
  ensureNavXpressDirs();
  const { fpDir } = getNavXpressDirs();
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showSaveDialog(win, {
    title: "Sauvegarder le plan de vol (.navxpv)",
    defaultPath: path.join(fpDir, 'flightplan.navxpv'),
    filters: [{ name: 'Plan de vol NavXpressVFR', extensions: ['navxpv'] }]
  });

  if (result.canceled || !result.filePath) return { ok: false, canceled: true };

  try {
    // planData est un objet JS reçu du renderer — on le sérialise ici en JSON
    const json = JSON.stringify(planData, null, 2);
    fs.writeFileSync(result.filePath, json, 'utf-8');
    return { ok: true, filePath: result.filePath };
  } catch (err) {
    console.error("Erreur d'écriture du fichier .navxpv:", err);
    return { ok: false, error: err.message };
  }
});

// 3b. Ouvrir un plan de vol natif .navxpv
ipcMain.handle('ouvrir-navxpv', async (event) => {
  ensureNavXpressDirs();
  const { fpDir } = getNavXpressDirs();
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, {
    title: "Charger un plan de vol (.navxpv)",
    defaultPath: fpDir,
    properties: ['openFile'],
    filters: [{ name: 'Plan de vol NavXpressVFR', extensions: ['navxpv'] }]
  });

  if (result.canceled || result.filePaths.length === 0) return null;

  try {
    const raw = fs.readFileSync(result.filePaths[0], 'utf-8');
    const data = JSON.parse(raw);
    return { ok: true, data, filePath: result.filePaths[0] };
  } catch (err) {
    console.error("Erreur de lecture du fichier .navxpv:", err);
    return { ok: false, error: err.message };
  }
});

// 4. Lire la clé OpenAIP depuis le fichier JSON
ipcMain.handle('lire-cle-openaip', async () => {
  try {
    ensureNavXpressDirs();
    const filePath = getApiKeyPath();
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);
    return data.apiKey || null;
  } catch (err) {
    console.error("Erreur lecture clé OpenAIP:", err);
    return null;
  }
});

// 5. Sauvegarder la clé OpenAIP dans le fichier JSON
ipcMain.handle('sauvegarder-cle-openaip', async (event, apiKey) => {
  try {
    ensureNavXpressDirs();
    const filePath = getApiKeyPath();
    console.log('[NavXpress] Sauvegarde clé dans :', filePath);
    const data = {
      apiKey: apiKey.trim(),
      savedAt: new Date().toISOString()
    };
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    console.log('[NavXpress] Clé sauvegardée avec succès.');
    return { ok: true };
  } catch (err) {
    console.error("Erreur sauvegarde clé OpenAIP:", err);
    return { ok: false, error: err.message };
  }
});

// --- INDEX EN MÉMOIRE des aéroports OurAirports (chargé à la 1re recherche) ---
let _oaAirportsIndex = null; // Map<UPPER_CODE, airportObj>

// Quand la base MSFS (airports-msfs.jsonl) est présente, elle REMPLACE
// totalement les aéroports OurAirports : tous les index aéroports sont
// construits depuis ce fichier (les navaids restent sur OurAirports).
const MSFS_AIRPORTS_FILE = 'airports-msfs.jsonl';
let _msfsActive = false;

function loadOurAirportsIndex() {
  if (ensureAirportsLoaded()) return true;
  const { ourAirportsDir } = getNavXpressDirs();
  const jsonlPath = path.join(ourAirportsDir, 'airports.jsonl');
  if (!fs.existsSync(jsonlPath)) {
    _oaAirportsIndex = null;
    return false;
  }
  const text = fs.readFileSync(jsonlPath, 'utf-8');
  const lines = text.split('\n');
  const idx = new Map();
  for (const line of lines) {
    if (!line) continue;
    let obj;
    try { obj = JSON.parse(line); } catch (_) { continue; }
    // Indexer sur tous les codes possibles (en majuscules)
    const keys = [obj.ident, obj.icao_code, obj.gps_code, obj.iata_code, obj.local_code];
    for (const k of keys) {
      if (!k) continue;
      const up = String(k).toUpperCase();
      // Premier arrivé, premier servi : évite qu'un petit aérodrome écrase un grand
      if (!idx.has(up)) idx.set(up, obj);
    }
  }
  _oaAirportsIndex = idx;
  return true;
}

function invalidateOurAirportsIndex() {
  _oaAirportsIndex = null;
  _oaRunwaysByAirport = null;
  _oaAirportsList = null;
  _oaFrequenciesByAirport = null;
  _oaCommentsByAirport = null;
  _oaNavaidsList = null;
  _oaNavaidsByIdent = null;
  _msfsActive = false;
}

// --- INDEX NAVAIDS : liste plate filtrée + map par (ident+id) pour détails ---
const NAVAID_TYPES = new Set([
  'VOR', 'VOR-DME', 'VORTAC', 'TACAN', 'NDB', 'NDB-DME', 'DME',
]);
let _oaNavaidsList = null;       // [{id, ident, name, type, freqKhz, lat, lon, elev, country}]
let _oaNavaidsByIdent = null;    // Map<id, full navaid object>  (par id pour éviter ambiguïté ident)

function loadOurAirportsNavaidsList() {
  if (_oaNavaidsList) return true;
  const { ourAirportsDir } = getNavXpressDirs();
  const jsonlPath = path.join(ourAirportsDir, 'navaids.jsonl');
  if (!fs.existsSync(jsonlPath)) {
    _oaNavaidsList = null;
    _oaNavaidsByIdent = null;
    return false;
  }
  const text = fs.readFileSync(jsonlPath, 'utf-8');
  const lines = text.split('\n');
  const list = [];
  const byId = new Map();
  for (const line of lines) {
    if (!line) continue;
    let n;
    try { n = JSON.parse(line); } catch (_) { continue; }
    if (!NAVAID_TYPES.has(n.type)) continue;
    const lat = parseFloat(n.latitude_deg);
    const lon = parseFloat(n.longitude_deg);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    list.push({
      id: n.id,
      ident: n.ident,
      name: n.name,
      type: n.type,
      freqKhz: parseFloat(n.frequency_khz) || 0,
      lat, lon,
      elev: n.elevation_ft,
      country: n.iso_country,
    });
    if (n.id) byId.set(String(n.id), n);
  }
  _oaNavaidsList = list;
  _oaNavaidsByIdent = byId;
  console.log('[OurAirports] Navaids chargés :', list.length);
  return true;
}

// --- INDEX FRÉQUENCES : airport_ident → tableau de fréquences ---
let _oaFrequenciesByAirport = null;

function loadOurAirportsFrequenciesIndex() {
  if (ensureAirportsLoaded()) return true;
  const { ourAirportsDir } = getNavXpressDirs();
  const jsonlPath = path.join(ourAirportsDir, 'airport-frequencies.jsonl');
  if (!fs.existsSync(jsonlPath)) {
    _oaFrequenciesByAirport = null;
    return false;
  }
  const text = fs.readFileSync(jsonlPath, 'utf-8');
  const lines = text.split('\n');
  const idx = new Map();
  for (const line of lines) {
    if (!line) continue;
    let obj;
    try { obj = JSON.parse(line); } catch (_) { continue; }
    const ident = (obj.airport_ident || '').toUpperCase();
    if (!ident) continue;
    if (!idx.has(ident)) idx.set(ident, []);
    idx.get(ident).push({
      type: obj.type || '',
      description: obj.description || '',
      frequency_mhz: obj.frequency_mhz || '',
    });
  }
  _oaFrequenciesByAirport = idx;
  return true;
}

// --- INDEX COMMENTAIRES : airport_ident → tableau de commentaires ---
//   NOTE : le CSV source a des clés avec espaces parasites (" airportIdent" etc.)
//   → on trim les clés au chargement
let _oaCommentsByAirport = null;

function loadOurAirportsCommentsIndex() {
  if (ensureAirportsLoaded()) return true;
  const { ourAirportsDir } = getNavXpressDirs();
  const jsonlPath = path.join(ourAirportsDir, 'airport-comments.jsonl');
  if (!fs.existsSync(jsonlPath)) {
    _oaCommentsByAirport = null;
    return false;
  }
  const text = fs.readFileSync(jsonlPath, 'utf-8');
  const lines = text.split('\n');
  const idx = new Map();
  for (const line of lines) {
    if (!line) continue;
    let raw;
    try { raw = JSON.parse(line); } catch (_) { continue; }
    // Nettoyer les clés (espaces parasites du CSV source)
    const obj = {};
    for (const k of Object.keys(raw)) obj[k.trim()] = raw[k];
    const ident = (obj.airportIdent || '').toUpperCase();
    if (!ident) continue;
    if (!idx.has(ident)) idx.set(ident, []);
    idx.get(ident).push({
      date: obj.date || '',
      author: obj.memberNickname || '',
      subject: obj.subject || '',
      body: obj.body || '',
    });
  }
  _oaCommentsByAirport = idx;
  return true;
}

// --- INDEX RUNWAYS : airport_ident → tableau de toutes les pistes ---
let _oaRunwaysByAirport = null; // Map<UPPER_IDENT, Array<runway>>

function loadOurAirportsRunwaysIndex() {
  if (ensureAirportsLoaded()) return true;
  const { ourAirportsDir } = getNavXpressDirs();
  const jsonlPath = path.join(ourAirportsDir, 'runways.jsonl');
  if (!fs.existsSync(jsonlPath)) {
    _oaRunwaysByAirport = null;
    return false;
  }
  const text = fs.readFileSync(jsonlPath, 'utf-8');
  const lines = text.split('\n');
  const idx = new Map();
  for (const line of lines) {
    if (!line) continue;
    let rw;
    try { rw = JSON.parse(line); } catch (_) { continue; }
    const ident = (rw.airport_ident || '').toUpperCase();
    if (!ident) continue;

    const closed = rw.closed === '1' || rw.closed === 1;
    const length = parseFloat(rw.length_ft) || 0;
    const width = parseFloat(rw.width_ft) || 0;
    const heading = parseFloat(rw.le_heading_degT);

    const r = {
      le_ident: rw.le_ident || '',
      he_ident: rw.he_ident || '',
      headingDegT: Number.isFinite(heading) ? heading : null,
      length_ft: length,
      width_ft: width,
      surface: rw.surface || '',
      lighted: rw.lighted === '1' || rw.lighted === 1,
      closed,
    };

    if (!idx.has(ident)) idx.set(ident, []);
    idx.get(ident).push(r);
  }
  _oaRunwaysByAirport = idx;
  return true;
}

// Retourne la piste principale (la plus longue, non fermée, avec heading valide)
function _oaMainRunway(runways) {
  if (!runways || runways.length === 0) return null;
  let best = null;
  for (const r of runways) {
    if (r.closed) continue;
    if (r.headingDegT === null) continue;
    if (!best || r.length_ft > best.length_ft) best = r;
  }
  return best;
}

// --- LISTE PLATE des airports utilisables (en mémoire) pour filtrage bbox rapide ---
let _oaAirportsList = null;       // [{ident, name, lat, lon, type, runway?}]
let _oaAirportsRawByIdent = null; // Map<UPPER_IDENT, full airport object>

function loadOurAirportsListForMap() {
  if (ensureAirportsLoaded()) return true;
  if (_oaAirportsList) return true;
  const { ourAirportsDir } = getNavXpressDirs();
  const jsonlPath = path.join(ourAirportsDir, 'airports.jsonl');
  if (!fs.existsSync(jsonlPath)) {
    _oaAirportsList = null;
    return false;
  }
  if (!_oaRunwaysByAirport) loadOurAirportsRunwaysIndex();

  const TYPES_OK = new Set(['large_airport', 'medium_airport', 'small_airport', 'heliport']);
  const text = fs.readFileSync(jsonlPath, 'utf-8');
  const lines = text.split('\n');
  const list = [];
  const rawIdx = new Map();
  for (const line of lines) {
    if (!line) continue;
    let a;
    try { a = JSON.parse(line); } catch (_) { continue; }
    // On indexe TOUS les types par ident pour la modale (heliports / seaplane / closed inclus)
    if (a.ident) rawIdx.set(String(a.ident).toUpperCase(), a);
    if (!TYPES_OK.has(a.type)) continue;
    const lat = parseFloat(a.latitude_deg);
    const lon = parseFloat(a.longitude_deg);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    const identUp = (a.ident || '').toUpperCase();
    const runways = _oaRunwaysByAirport ? _oaRunwaysByAirport.get(identUp) : null;
    const runway = _oaMainRunway(runways);

    // Code affichable, par ordre de priorité :
    //   icao_code (LFPG, KJFK…)
    //   gps_code  (codes GPS, parfois utilisés)
    //   local_code (codes FAA US, codes ULM FR type LFXXXX)
    //   ident     (dernier recours : FR-XXXX, US-XXXX…)
    const displayCode =
      (a.icao_code  && a.icao_code.trim())  ||
      (a.gps_code   && a.gps_code.trim())   ||
      (a.local_code && a.local_code.trim()) ||
      a.ident || '';

    list.push({
      ident: a.ident,
      icao: a.icao_code || '',
      iata: a.iata_code || '',
      gps: a.gps_code || '',
      local: a.local_code || '',
      code: displayCode,
      name: a.name || a.ident,
      country: a.iso_country || '',
      lat, lon,
      type: a.type,
      runway: runway ? {
        name: runway.le_ident + (runway.he_ident ? '/' + runway.he_ident : ''),
        headingDegT: runway.headingDegT,
        length_ft: runway.length_ft,
      } : null,
    });
  }
  _oaAirportsList = list;
  _oaAirportsRawByIdent = rawIdx;
  console.log('[OurAirports] Liste chargée pour la carte :', list.length, 'aéroports');
  return true;
}

// ============================================================
// BASE AÉROPORTS MSFS (airports-msfs.jsonl)
// ------------------------------------------------------------
// Si ce fichier est présent, il REMPLACE entièrement les aéroports
// OurAirports. On construit en UNE seule passe TOUS les index aéroports
// (recherche, carte, runways, fréquences) depuis les enregistrements
// imbriqués (runways[], frequencies[]). Les commentaires n'existent pas
// dans cette base (Map vide). Les navaids restent gérés par OurAirports.
// ============================================================
function msfsAirportsAvailable() {
  const { ourAirportsDir } = getNavXpressDirs();
  return fs.existsSync(path.join(ourAirportsDir, MSFS_AIRPORTS_FILE));
}

function buildFromMsfs() {
  const { ourAirportsDir } = getNavXpressDirs();
  const p = path.join(ourAirportsDir, MSFS_AIRPORTS_FILE);
  const text = fs.readFileSync(p, 'utf-8');
  const lines = text.split('\n');

  const TYPES_OK = new Set(['large_airport', 'medium_airport', 'small_airport', 'heliport']);
  const index = new Map();      // recherche : tous codes -> objet
  const list = [];              // carte : large/medium/small
  const rawIdx = new Map();     // ident -> objet complet (tous types)
  const runwaysIdx = new Map(); // ident -> [pistes normalisées]
  const freqIdx = new Map();    // ident -> [fréquences]

  for (const line of lines) {
    if (!line) continue;
    let a;
    try { a = JSON.parse(line); } catch (_) { continue; }
    if (a.__meta) continue; // ligne d'en-tête (date d'extraction, etc.)

    // Index de recherche sur tous les codes (premier arrivé gagne)
    const keys = [a.ident, a.icao_code, a.gps_code, a.iata_code, a.local_code];
    for (const k of keys) {
      if (!k) continue;
      const up = String(k).toUpperCase();
      if (!index.has(up)) index.set(up, a);
    }

    const identUp = (a.ident || '').toUpperCase();
    if (a.ident) rawIdx.set(identUp, a);

    // Pistes : normaliser vers la forme attendue par les handlers/_oaMainRunway
    const rws = Array.isArray(a.runways) ? a.runways.map((r) => ({
      le_ident: r.le_ident || '',
      he_ident: r.he_ident || '',
      headingDegT: Number.isFinite(r.headingDegT) ? r.headingDegT : null,
      length_ft: Number(r.length_ft) || 0,
      width_ft: Number(r.width_ft) || 0,
      surface: r.surface || '',
      lighted: r.lighted === true || r.lighted === 1 || r.lighted === '1',
      closed: r.closed === true || r.closed === 1 || r.closed === '1',
    })) : [];
    if (a.ident) runwaysIdx.set(identUp, rws);

    // Fréquences
    const fqs = Array.isArray(a.frequencies) ? a.frequencies.map((f) => ({
      type: f.type || '',
      description: f.description || '',
      frequency_mhz: f.frequency_mhz != null ? f.frequency_mhz : '',
    })) : [];
    if (a.ident) freqIdx.set(identUp, fqs);

    // Liste carte : uniquement large/medium/small avec position valide
    if (!TYPES_OK.has(a.type)) continue;
    const lat = parseFloat(a.latitude_deg);
    const lon = parseFloat(a.longitude_deg);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    // Filtre décors/POI : MSFS expose des points de repère (stades, ponts,
    // monuments, forts…) comme « airports » sans aucune piste ni hélipad.
    // deriveType les classe en small_airport par défaut. On les masque de la
    // carte tant qu'ils n'ont ni piste ni hélipad (NRD50/NRD51, etc.).
    const nbHelipads = Array.isArray(a.helipads) ? a.helipads.length : 0;
    if (rws.length === 0 && nbHelipads === 0) continue;

    const runway = _oaMainRunway(rws);
    const displayCode =
      (a.icao_code  && String(a.icao_code).trim())  ||
      (a.gps_code   && String(a.gps_code).trim())   ||
      (a.local_code && String(a.local_code).trim()) ||
      a.ident || '';

    list.push({
      ident: a.ident,
      icao: a.icao_code || '',
      iata: a.iata_code || '',
      gps: a.gps_code || '',
      local: a.local_code || '',
      code: displayCode,
      name: a.name || a.ident,
      country: a.iso_country || '',
      lat, lon,
      type: a.type,
      runway: runway ? {
        name: runway.le_ident + (runway.he_ident ? '/' + runway.he_ident : ''),
        headingDegT: runway.headingDegT,
        length_ft: runway.length_ft,
      } : null,
    });
  }

  _oaAirportsIndex = index;
  _oaAirportsList = list;
  _oaAirportsRawByIdent = rawIdx;
  _oaRunwaysByAirport = runwaysIdx;
  _oaFrequenciesByAirport = freqIdx;
  _oaCommentsByAirport = new Map(); // pas de commentaires dans la base MSFS
  _msfsActive = true;
  console.log('[MSFS] Base aéroports chargée :', list.length, 'sur carte /', rawIdx.size, 'au total');
}

// Construit (une fois) tous les index aéroports depuis la base MSFS si elle
// existe. Renvoie true si la base MSFS est active (les loaders OurAirports
// doivent alors court-circuiter). Renvoie false sinon (fallback OurAirports).
function ensureAirportsLoaded() {
  if (!msfsAirportsAvailable()) return false;
  if (_msfsActive && _oaAirportsIndex && _oaAirportsList && _oaAirportsRawByIdent
      && _oaRunwaysByAirport && _oaFrequenciesByAirport && _oaCommentsByAirport) {
    return true;
  }
  buildFromMsfs();
  return true;
}

// 6. Vérifier si des fichiers OurAirports sont déjà présents (.jsonl ou .json)
ipcMain.handle('ourairports-existe', async () => {
  try {
    ensureNavXpressDirs();
    const { ourAirportsDir } = getNavXpressDirs();
    return OURAIRPORTS_FILES.some(f =>
      fs.existsSync(path.join(ourAirportsDir, f.name + '.jsonl')) ||
      fs.existsSync(path.join(ourAirportsDir, f.name + '.json'))
    );
  } catch (err) {
    return false;
  }
});

// 7. Importer les données OurAirports : télécharge les CSV, les convertit au
//    format JSONL (un objet JSON par ligne) UTF-8 et les écrit dans
//    Documents/NavXpressVFR/ourairports data/
ipcMain.handle('importer-ourairports', async (event) => {
  ensureNavXpressDirs();
  const { ourAirportsDir } = getNavXpressDirs();
  const wc = event.sender;
  invalidateOurAirportsIndex();

  const total = OURAIRPORTS_FILES.length;
  const results = [];

  wc.send('ourairports-progress', {
    type: 'start',
    total,
    files: OURAIRPORTS_FILES.map(f => f.name),
  });

  for (let i = 0; i < OURAIRPORTS_FILES.length; i++) {
    const f = OURAIRPORTS_FILES[i];
    wc.send('ourairports-progress', {
      type: 'file-start',
      index: i,
      name: f.name,
    });
    try {
      const csv = await httpsGetFollow(f.url);
      const rows = parseCSV(csv);
      const outPath = path.join(ourAirportsDir, f.name + '.jsonl');
      // Format NDJSON / JSONL : un objet par ligne (lisible et streamable)
      const lines = new Array(rows.length);
      for (let r = 0; r < rows.length; r++) lines[r] = JSON.stringify(rows[r]);
      fs.writeFileSync(outPath, lines.join('\n') + '\n', 'utf-8');
      // Supprimer l'éventuel ancien .json (format tableau) devenu obsolète
      const legacyPath = path.join(ourAirportsDir, f.name + '.json');
      if (fs.existsSync(legacyPath)) {
        try { fs.unlinkSync(legacyPath); } catch (_) { /* silencieux */ }
      }
      results.push({ name: f.name, ok: true, count: rows.length });
      wc.send('ourairports-progress', {
        type: 'file-done',
        index: i,
        name: f.name,
        count: rows.length,
      });
    } catch (err) {
      console.error('[OurAirports] Erreur sur', f.name, ':', err);
      results.push({ name: f.name, ok: false, error: err.message });
      wc.send('ourairports-progress', {
        type: 'file-error',
        index: i,
        name: f.name,
        error: err.message,
      });
    }
  }

  wc.send('ourairports-progress', {
    type: 'done',
    results,
    dir: ourAirportsDir,
  });

  return { ok: true, dir: ourAirportsDir, results };
});

// 8. Recherche d'un aéroport par code dans la base OurAirports locale
ipcMain.handle('rechercher-aeroport-oa', async (event, code) => {
  if (!code) return { found: false, reason: 'empty' };
  const up = String(code).trim().toUpperCase();
  if (!up) return { found: false, reason: 'empty' };

  if (_oaAirportsIndex === null) {
    const ok = loadOurAirportsIndex();
    if (!ok) return { found: false, reason: 'no-data' };
  }

  const airport = _oaAirportsIndex.get(up);
  if (!airport) return { found: false, reason: 'not-found' };

  const lat = parseFloat(airport.latitude_deg);
  const lon = parseFloat(airport.longitude_deg);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return { found: false, reason: 'no-coords' };
  }

  return {
    found: true,
    name: airport.name || up,
    ident: airport.ident,
    icao: airport.icao_code,
    iata: airport.iata_code,
    type: airport.type,
    country: airport.iso_country,
    lat,
    lon,
  };
});

// 8bis. Recherche multi-sources (airports + navaids) par code exact (case-insensitive).
//    Retourne TOUTES les correspondances avec : kind, code, type, country, lat, lon, name, id.
ipcMain.handle('chercher-correspondances', async (event, code) => {
  if (!code) return { ok: false, reason: 'empty' };
  const up = String(code).trim().toUpperCase();
  if (!up) return { ok: false, reason: 'empty' };

  // S'assurer que les indexes sont chargés
  if (!_oaAirportsList) loadOurAirportsListForMap();
  if (!_oaNavaidsList) loadOurAirportsNavaidsList();

  if (!_oaAirportsList && !_oaNavaidsList) return { ok: false, reason: 'no-data' };

  const matches = [];

  // --- Recherche dans les aéroports ---
  //   Champs cherchés : ident, icao, gps, local (PAS iata — trop de collisions
  //   avec des codes locaux nationaux à 3 lettres)
  if (_oaAirportsList) {
    for (const a of _oaAirportsList) {
      const codes = [a.ident, a.icao, a.gps, a.local];
      let matched = false;
      for (const c of codes) {
        if (c && String(c).toUpperCase() === up) { matched = true; break; }
      }
      if (!matched) continue;
      matches.push({
        kind: 'airport',
        // Code "représentatif" à afficher dans la liste
        code: a.code || a.ident,
        type: a.type,
        country: a.country,
        name: a.name,
        lat: a.lat,
        lon: a.lon,
        ident: a.ident,
      });
    }
  }

  // --- Recherche dans les navaids ---
  if (_oaNavaidsList) {
    for (const n of _oaNavaidsList) {
      if (!n.ident) continue;
      if (String(n.ident).toUpperCase() !== up) continue;
      matches.push({
        kind: 'navaid',
        code: n.ident,
        type: n.type,
        country: n.country,
        name: n.name,
        lat: n.lat,
        lon: n.lon,
        id: n.id,
      });
    }
  }

  return { ok: true, matches };
});

// 9bis. Retourne les détails complets d'un aéroport : airport + runways + frequencies + comments
ipcMain.handle('details-aeroport', async (event, ident) => {
  if (!ident) return { ok: false, reason: 'no-ident' };
  const up = String(ident).toUpperCase();

  // Assurer le chargement des index
  if (!_oaAirportsRawByIdent) loadOurAirportsListForMap();
  if (!_oaRunwaysByAirport) loadOurAirportsRunwaysIndex();
  if (!_oaFrequenciesByAirport) loadOurAirportsFrequenciesIndex();
  if (!_oaCommentsByAirport) loadOurAirportsCommentsIndex();

  const airport = _oaAirportsRawByIdent ? _oaAirportsRawByIdent.get(up) : null;
  if (!airport) return { ok: false, reason: 'not-found' };

  const runways = (_oaRunwaysByAirport && _oaRunwaysByAirport.get(up)) || [];
  const frequencies = (_oaFrequenciesByAirport && _oaFrequenciesByAirport.get(up)) || [];
  const comments = (_oaCommentsByAirport && _oaCommentsByAirport.get(up)) || [];
  // Hélipads : rangés directement dans l'enregistrement (base MSFS). Absents
  // d'OurAirports → tableau vide par défaut.
  const helipads = Array.isArray(airport.helipads) ? airport.helipads : [];

  // Trier les commentaires du plus récent au plus ancien
  comments.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  return { ok: true, airport, runways, frequencies, comments, helipads };
});

// 9. Renvoie tous les aéroports (large/medium/small) dans une bounding box.
//    bbox = { south, west, north, east } en degrés décimaux.
ipcMain.handle('aeroports-bbox', async (event, bbox) => {
  if (!bbox) return { ok: false, reason: 'no-bbox' };
  if (!_oaAirportsList) {
    const ok = loadOurAirportsListForMap();
    if (!ok) return { ok: false, reason: 'no-data' };
  }
  const { south, west, north, east } = bbox;
  const crossDateline = west > east; // bbox traverse l'antiméridien
  const out = [];
  for (const a of _oaAirportsList) {
    if (a.lat < south || a.lat > north) continue;
    if (crossDateline) {
      if (a.lon < west && a.lon > east) continue;
    } else {
      if (a.lon < west || a.lon > east) continue;
    }
    out.push(a);
  }
  return { ok: true, airports: out };
});

// 10. Renvoie tous les navaids dans une bounding box.
ipcMain.handle('navaids-bbox', async (event, bbox) => {
  if (!bbox) return { ok: false, reason: 'no-bbox' };
  if (!_oaNavaidsList) {
    const ok = loadOurAirportsNavaidsList();
    if (!ok) return { ok: false, reason: 'no-data' };
  }
  const { south, west, north, east } = bbox;
  const crossDateline = west > east;
  const out = [];
  for (const n of _oaNavaidsList) {
    if (n.lat < south || n.lat > north) continue;
    if (crossDateline) {
      if (n.lon < west && n.lon > east) continue;
    } else {
      if (n.lon < west || n.lon > east) continue;
    }
    out.push(n);
  }
  return { ok: true, navaids: out };
});

// 11. Retourne les détails complets d'un navaid (par son id)
ipcMain.handle('details-navaid', async (event, id) => {
  if (!id) return { ok: false, reason: 'no-id' };
  if (!_oaNavaidsByIdent) loadOurAirportsNavaidsList();
  const navaid = _oaNavaidsByIdent ? _oaNavaidsByIdent.get(String(id)) : null;
  if (!navaid) return { ok: false, reason: 'not-found' };
  return { ok: true, navaid };
});

// ============================================================
// SIMCONNECT (MSFS) — connexion + lecture du vent
// ============================================================
let _scHandle = null;        // handle SimConnect courant
let _scConnecting = false;   // évite les connexions concurrentes

const SC_WIND_DEF_ID = 1;
const SC_WIND_REQ_ID = 1;
const SC_POS_DEF_ID  = 2;
const SC_POS_REQ_ID  = 2;

function broadcastSimStatus(payload) {
  // Émet un statut sur toutes les fenêtres ouvertes
  BrowserWindow.getAllWindows().forEach(w => {
    try { w.webContents.send('simconnect-status', payload); } catch (_) {}
  });
}

function broadcastDonneesVol(payload) {
  BrowserWindow.getAllWindows().forEach(w => {
    try { w.webContents.send('donnees-vol', payload); } catch (_) {}
  });
}

function broadcastPosition(payload) {
  BrowserWindow.getAllWindows().forEach(w => {
    try { w.webContents.send('donnees-position', payload); } catch (_) {}
  });
}

async function simConnectFermer() {
  if (_scHandle) {
    try { _scHandle.close(); } catch (_) {}
    _scHandle = null;
  }
}

ipcMain.handle('simconnect-connecter', async () => {
  if (_scHandle) return { ok: true, alreadyConnected: true };
  if (_scConnecting) return { ok: false, error: 'connect-in-progress' };

  _scConnecting = true;
  broadcastSimStatus({ state: 'connecting' });

  try {
    const { recvOpen, handle } = await scOpen('NavXpressVFR', SCProtocol.FSX_SP2);
    _scHandle = handle;
    _scConnecting = false;

    console.log('[SimConnect] Connecté à', recvOpen.applicationName);
    broadcastSimStatus({
      state: 'connected',
      app: recvOpen.applicationName,
    });

    // --- Définition des variables vent ---
    handle.addToDataDefinition(
      SC_WIND_DEF_ID,
      'AMBIENT WIND DIRECTION',
      'degrees',
      SCDataType.FLOAT64
    );
    handle.addToDataDefinition(
      SC_WIND_DEF_ID,
      'AMBIENT WIND VELOCITY',
      'knots',
      SCDataType.FLOAT64
    );

    // Souscription : 1 update toutes les 30 secondes (le vent évolue lentement)
    handle.requestDataOnSimObject(
      SC_WIND_REQ_ID,
      SC_WIND_DEF_ID,
      SCConst.OBJECT_ID_USER,
      SCPeriod.SECOND,
      0,   // flags
      0,   // origin (commence immédiatement)
      29   // interval : 29 secondes sautées → 1 update toutes les 30 s
    );

    // --- Définition des variables position ---
    handle.addToDataDefinition(
      SC_POS_DEF_ID,
      'PLANE LATITUDE',
      'degrees',
      SCDataType.FLOAT64
    );
    handle.addToDataDefinition(
      SC_POS_DEF_ID,
      'PLANE LONGITUDE',
      'degrees',
      SCDataType.FLOAT64
    );
    // Altitude AGL (pieds) — utilisée par l'avertissement audio « < 500 ft AGL ».
    // PLANE ALT ABOVE GROUND donne directement l'AGL natif MSFS (relief inclus),
    // plus précis que MSL - elevation GTOPO pour cet usage.
    handle.addToDataDefinition(
      SC_POS_DEF_ID,
      'PLANE ALT ABOVE GROUND',
      'feet',
      SCDataType.FLOAT64
    );

    // Souscription : 1 update toutes les 5 secondes pour la position
    handle.requestDataOnSimObject(
      SC_POS_REQ_ID,
      SC_POS_DEF_ID,
      SCConst.OBJECT_ID_USER,
      SCPeriod.SECOND,
      0,   // flags
      0,   // origin
      4    // interval : 4 secondes sautées → 1 update toutes les 5 s
    );

    handle.on('simObjectData', (data) => {
      try {
        if (data.requestID === SC_WIND_REQ_ID) {
          const dir = data.data.readFloat64();
          const vit = data.data.readFloat64();
          broadcastDonneesVol({ windDir: dir, windSpeed: vit });
        } else if (data.requestID === SC_POS_REQ_ID) {
          const lat = data.data.readFloat64();
          const lon = data.data.readFloat64();
          const altAgl = data.data.readFloat64();
          broadcastPosition({ lat, lon, altAgl });
        }
      } catch (err) {
        console.warn('[SimConnect] Lecture données KO:', err);
      }
    });

    handle.on('exception', (ex) => {
      console.warn('[SimConnect] Exception simulator:', ex);
    });

    handle.on('quit', () => {
      console.log('[SimConnect] Le simulateur a quitté.');
      _scHandle = null;
      broadcastSimStatus({ state: 'disconnected', reason: 'sim-quit' });
    });

    handle.on('close', () => {
      console.log('[SimConnect] Connexion fermée.');
      _scHandle = null;
      broadcastSimStatus({ state: 'disconnected', reason: 'closed' });
    });

    handle.on('error', (err) => {
      console.error('[SimConnect] Erreur :', err);
      _scHandle = null;
      broadcastSimStatus({ state: 'disconnected', reason: 'error', error: err && err.message });
    });

    return { ok: true, app: recvOpen.applicationName };
  } catch (err) {
    _scConnecting = false;
    _scHandle = null;
    console.error('[SimConnect] Échec connexion:', err);
    broadcastSimStatus({
      state: 'disconnected',
      reason: 'connect-failed',
      error: err && err.message,
    });
    return { ok: false, error: err && err.message };
  }
});

ipcMain.handle('simconnect-deconnecter', async () => {
  await simConnectFermer();
  broadcastSimStatus({ state: 'disconnected', reason: 'user' });
  return { ok: true };
});

ipcMain.handle('simconnect-etat', async () => {
  if (_scHandle) return { state: 'connected' };
  if (_scConnecting) return { state: 'connecting' };
  return { state: 'disconnected' };
});

// --- Vérifie que MSFS 2024 est lancé (pour l'extraction des aéroports) ---
// On ouvre une connexion SimConnect SunRise (protocole MSFS 2024) dédiée et
// éphémère, avec un timeout court : si elle réussit, le simulateur tourne.
// Cette connexion est indépendante du handle FSX_SP2 (_scHandle) utilisé pour
// le vent/la position, et on la ferme immédiatement après la vérification.
ipcMain.handle('msfs-verifier-lancement', async () => {
  return await new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const done = (result) => {
      if (settled) return;
      settled = true;
      if (timer) { clearTimeout(timer); timer = null; }
      if (result.running) console.log('[MSFS] Vérification lancement : OK (' + result.app + ')');
      else console.log('[MSFS] Vérification lancement : non détecté (' + result.error + ')');
      resolve(result);
    };

    // Garde-fou : autodetectServerAddress() peut rejeter sans émettre 'error'
    // (la promesse interne n'a pas de .catch), auquel cas open() ne se résout
    // jamais. Ce timeout couvre ce cas.
    timer = setTimeout(() => done({ running: false, error: 'timeout (aucune réponse du simulateur en 8 s)' }), 8000);

    let openP;
    try {
      openP = scOpen('NavXpressVFR-Check', SCProtocol.SunRise);
    } catch (err) {
      done({ running: false, error: 'scOpen a échoué : ' + (err && err.message) });
      return;
    }
    openP.then((res) => {
      try { res.handle.close(); } catch (_) {}
      const appName = (res.recvOpen && res.recvOpen.applicationName) || 'MSFS';
      done({ running: true, app: appName });
    }).catch((err) => {
      done({ running: false, error: (err && err.message) || 'connexion refusée' });
    });
  });
});

// --- Extraction in-app de la base d'aéroports MSFS 2024 ---
// Ouvre sa propre connexion SunRise (dédiée), énumère puis lit en détail tous
// les aéroports, écrit Documents/NavXpressVFR/ourairports data/airports-msfs.jsonl,
// et relaie la progression au renderer via 'msfs-extract-progress'. Une fois le
// fichier écrit, on invalide les index pour que les loaders se reconstruisent
// depuis la base MSFS fraîche.
let _msfsExtractRunning = false;
ipcMain.handle('extraire-aeroports-msfs', async (event, options) => {
  if (_msfsExtractRunning) {
    return { ok: false, error: 'Une extraction est déjà en cours.' };
  }
  _msfsExtractRunning = true;
  const wc = event.sender;
  ensureNavXpressDirs();
  const { ourAirportsDir } = getNavXpressDirs();
  const limit = options && Number.isFinite(options.limit) ? options.limit : 0;

  const sendProgress = (p) => {
    if (wc && !wc.isDestroyed()) wc.send('msfs-extract-progress', p);
  };

  try {
    const summary = await runMsfsExtraction({
      outDir: ourAirportsDir,
      window: 100,
      limit,
      appName: 'NavXpressVFR-Extract',
      onProgress: sendProgress,
    });

    // Le fichier a été écrit : on force la reconstruction des index aéroports
    // (la prochaine requête repartira de airports-msfs.jsonl).
    if (summary.file) {
      invalidateOurAirportsIndex();
      console.log('[MSFS] Extraction terminée :', summary.written, 'aéroports →', summary.file);
    } else {
      console.log('[MSFS] Extraction terminée sans fichier (', summary.reason, ')');
    }
    return { ok: true, summary };
  } catch (err) {
    console.error('[MSFS] Extraction échouée :', err && err.message);
    return { ok: false, error: (err && err.message) || 'extraction échouée' };
  } finally {
    _msfsExtractRunning = false;
  }
});

// --- ENREGISTREMENT DE L'APP ---
app.whenReady().then(() => {
  // Création des dossiers de travail au 1er lancement (Documents/NavXpressVFR + sous-dossiers)
  try {
    ensureNavXpressDirs();
    console.log('[NavXpress] Dossiers vérifiés/créés :', getNavXpressDirs().root);
  } catch (err) {
    console.error('[NavXpress] Impossible de créer les dossiers :', err);
  }

  // Intercepte les requêtes vers les tuiles OpenAIP pour injecter la clé API
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['https://*.api.tiles.openaip.net/*'] },
    (details, callback) => {
      try {
        const filePath = getApiKeyPath();
        if (fs.existsSync(filePath)) {
          const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
          if (data.apiKey) {
            details.requestHeaders['x-openaip-api-key'] = data.apiKey;
          }
        }
      } catch (e) { /* silencieux */ }
      callback({ requestHeaders: details.requestHeaders });
    }
  );

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  simConnectFermer();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  simConnectFermer();
});
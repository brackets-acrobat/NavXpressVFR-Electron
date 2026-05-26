const { app, BrowserWindow, ipcMain, dialog, session } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const geomagnetism = require('geomagnetism'); // Le NOUVEAU module magnétique fiable
const {
  open: scOpen,
  Protocol: SCProtocol,
  SimConnectDataType: SCDataType,
  SimConnectPeriod: SCPeriod,
  SimConnectConstants: SCConst,
} = require('node-simconnect');

// --- CHEMINS DE STOCKAGE ---
function getNavXpressDirs() {
  const docs = app.getPath('documents');
  const root         = path.join(docs, 'NavXpressVFR');
  const apiDir       = path.join(root, 'API');
  const fpDir        = path.join(root, 'Flight plans');
  const ourAirportsDir = path.join(root, 'ourairports data');
  return { root, apiDir, fpDir, ourAirportsDir };
}

function getApiKeyPath() {
  return path.join(getNavXpressDirs().apiDir, 'openaip.json');
}

function ensureNavXpressDirs() {
  const { root, apiDir, fpDir, ourAirportsDir } = getNavXpressDirs();
  [root, apiDir, fpDir, ourAirportsDir].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });
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
  mainWindow.webContents.openDevTools();
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

// 2. Écouteur pour Ouvrir un fichier .lnmpln
ipcMain.handle('ouvrir-dialogue-lnm', async () => {
  const result = await dialog.showOpenDialog({
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
  const result = await dialog.showSaveDialog({
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
ipcMain.handle('ouvrir-navxpv', async () => {
  ensureNavXpressDirs();
  const { fpDir } = getNavXpressDirs();
  const result = await dialog.showOpenDialog({
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

function loadOurAirportsIndex() {
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
  if (_oaAirportsList) return true;
  const { ourAirportsDir } = getNavXpressDirs();
  const jsonlPath = path.join(ourAirportsDir, 'airports.jsonl');
  if (!fs.existsSync(jsonlPath)) {
    _oaAirportsList = null;
    return false;
  }
  if (!_oaRunwaysByAirport) loadOurAirportsRunwaysIndex();

  const TYPES_OK = new Set(['large_airport', 'medium_airport', 'small_airport']);
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
      gps: a.gps_code || '',
      local: a.local_code || '',
      code: displayCode,
      name: a.name || a.ident,
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

  // Trier les commentaires du plus récent au plus ancien
  comments.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  return { ok: true, airport, runways, frequencies, comments };
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

    handle.on('simObjectData', (data) => {
      if (data.requestID !== SC_WIND_REQ_ID) return;
      try {
        const dir = data.data.readFloat64();
        const vit = data.data.readFloat64();
        broadcastDonneesVol({
          windDir: dir,
          windSpeed: vit,
        });
      } catch (err) {
        console.warn('[SimConnect] Lecture vent KO:', err);
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
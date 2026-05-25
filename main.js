const { app, BrowserWindow, ipcMain, dialog, session } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const geomagnetism = require('geomagnetism'); // Le NOUVEAU module magnétique fiable

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
    width: 1250,
    height: 850,
    minWidth: 1000,
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

// 3. Écouteur pour Sauvegarder un fichier
ipcMain.handle('sauvegarder-dialogue', async (event, planDonnees) => {
  const result = await dialog.showSaveDialog({
    title: "Sauvegarder le plan de vol",
    defaultPath: "flightplan.lnmpln",
    filters: [{ name: 'Fichiers Little Navmap', extensions: ['lnmpln'] }]
  });

  if (result.canceled || !result.filePath) return false;

  try {
    fs.writeFileSync(result.filePath, planDonnees, 'utf-8');
    return true;
  } catch (err) {
    console.error("Erreur d'écriture du fichier:", err);
    return false;
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

// --- ENREGISTREMENT DE L'APP ---
app.whenReady().then(() => {
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
  if (process.platform !== 'darwin') app.quit();
});
const { app, BrowserWindow, ipcMain, dialog, session } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const geomagnetism = require('geomagnetism'); // Le NOUVEAU module magnétique fiable

// --- CHEMINS DE STOCKAGE ---
function getNavXpressDirs() {
  const docs = app.getPath('documents');
  const root    = path.join(docs, 'NavXpressVFR');
  const apiDir  = path.join(root, 'API');
  const fpDir   = path.join(root, 'Flight plans');
  return { root, apiDir, fpDir };
}

function getApiKeyPath() {
  return path.join(getNavXpressDirs().apiDir, 'openaip.json');
}

function ensureNavXpressDirs() {
  const { root, apiDir, fpDir } = getNavXpressDirs();
  [root, apiDir, fpDir].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });
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
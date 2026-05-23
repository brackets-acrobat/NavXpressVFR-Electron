const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const geomagnetism = require('geomagnetism'); // Le NOUVEAU module magnétique fiable

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1250,
    height: 850,
    minWidth: 1000,
    minHeight: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
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

// --- ENREGISTREMENT DE L'APP ---
app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
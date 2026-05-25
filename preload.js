const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    calculerDeclinaison: (lat, lon, alt) => ipcRenderer.invoke('calculer-declinaison', { lat, lon, alt }),
    onStatusSimConnect: (callback) => ipcRenderer.on('simconnect-status', (event, status) => callback(status)),
    onDonneesVol: (callback) => ipcRenderer.on('donnees-vol', (event, data) => callback(data)),

    // NOUVELLES FONCTIONS DE FICHIERS
    ouvrirLNM: () => ipcRenderer.invoke('ouvrir-dialogue-lnm'),
    sauvegarderPlan: (data) => ipcRenderer.invoke('sauvegarder-dialogue', data),

    // GESTION CLÉ OpenAIP
    lireCleOpenAIP: () => ipcRenderer.invoke('lire-cle-openaip'),
    sauvegarderCleOpenAIP: (key) => ipcRenderer.invoke('sauvegarder-cle-openaip', key),

    // IMPORT DONNÉES OurAirports
    ourAirportsExiste: () => ipcRenderer.invoke('ourairports-existe'),
    importerOurAirports: () => ipcRenderer.invoke('importer-ourairports'),
    onOurAirportsProgress: (callback) => {
        const listener = (_event, data) => callback(data);
        ipcRenderer.on('ourairports-progress', listener);
        return () => ipcRenderer.removeListener('ourairports-progress', listener);
    },

    // RECHERCHE AÉROPORT (base OurAirports locale)
    rechercherAeroportOA: (code) => ipcRenderer.invoke('rechercher-aeroport-oa', code)
});
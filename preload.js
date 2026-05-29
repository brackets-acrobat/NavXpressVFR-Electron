const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    calculerDeclinaison: (lat, lon, alt) => ipcRenderer.invoke('calculer-declinaison', { lat, lon, alt }),
    onStatusSimConnect: (callback) => ipcRenderer.on('simconnect-status', (event, status) => callback(status)),
    onDonneesVol: (callback) => ipcRenderer.on('donnees-vol', (event, data) => callback(data)),
    onDonneesPosition: (callback) => ipcRenderer.on('donnees-position', (event, data) => callback(data)),

    // CONNEXION SIMCONNECT (MSFS)
    simConnectConnecter: () => ipcRenderer.invoke('simconnect-connecter'),
    simConnectDeconnecter: () => ipcRenderer.invoke('simconnect-deconnecter'),
    simConnectEtat: () => ipcRenderer.invoke('simconnect-etat'),

    // FICHIERS — Plan de vol Little Navmap (import uniquement)
    ouvrirLNM: () => ipcRenderer.invoke('ouvrir-dialogue-lnm'),

    // FICHIERS — Plan de vol natif NavXpressVFR (.navxpv)
    sauvegarderNavXpv: (planData) => ipcRenderer.invoke('sauvegarder-navxpv', planData),
    ouvrirNavXpv: () => ipcRenderer.invoke('ouvrir-navxpv'),

    // GESTION CLÉ OpenAIP
    lireCleOpenAIP: () => ipcRenderer.invoke('lire-cle-openaip'),
    sauvegarderCleOpenAIP: (key) => ipcRenderer.invoke('sauvegarder-cle-openaip', key),

    // EXTRACTION AÉROPORTS MSFS 2024
    msfsVerifierLancement: () => ipcRenderer.invoke('msfs-verifier-lancement'),
    msfsExtraireAeroports: (options) => ipcRenderer.invoke('extraire-aeroports-msfs', options),
    onMsfsExtractProgress: (callback) => {
        const listener = (_event, data) => callback(data);
        ipcRenderer.on('msfs-extract-progress', listener);
        return () => ipcRenderer.removeListener('msfs-extract-progress', listener);
    },

    // IMPORT DONNÉES OurAirports
    ourAirportsExiste: () => ipcRenderer.invoke('ourairports-existe'),
    importerOurAirports: () => ipcRenderer.invoke('importer-ourairports'),
    onOurAirportsProgress: (callback) => {
        const listener = (_event, data) => callback(data);
        ipcRenderer.on('ourairports-progress', listener);
        return () => ipcRenderer.removeListener('ourairports-progress', listener);
    },

    // RECHERCHE AÉROPORT (base OurAirports locale)
    rechercherAeroportOA: (code) => ipcRenderer.invoke('rechercher-aeroport-oa', code),

    // RECHERCHE MULTI (airports + navaids), retourne toutes les correspondances
    chercherCorrespondances: (code) => ipcRenderer.invoke('chercher-correspondances', code),

    // AÉROPORTS DANS UNE BOUNDING BOX (pour affichage sur la carte)
    aeroportsDansBbox: (bbox) => ipcRenderer.invoke('aeroports-bbox', bbox),

    // DÉTAILS COMPLETS d'un aéroport (airport + runways + frequencies + comments)
    detailsAeroport: (ident) => ipcRenderer.invoke('details-aeroport', ident),

    // NAVAIDS dans la bbox + détails par id
    navaidsDansBbox: (bbox) => ipcRenderer.invoke('navaids-bbox', bbox),
    detailsNavaid: (id) => ipcRenderer.invoke('details-navaid', id)
});
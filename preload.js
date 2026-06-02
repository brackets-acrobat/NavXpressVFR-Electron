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

    // PROFIL VERTICAL — relief GLOBE échantillonné le long du plan de vol
    profilVertical: (payload) => ipcRenderer.invoke('profil-vertical', payload),

    // IMPORT DONNÉES D'ÉLÉVATION (dataset GLOBE all10g.zip)
    elevationExiste: () => ipcRenderer.invoke('elevation-existe'),
    importerElevation: () => ipcRenderer.invoke('importer-elevation'),
    onElevationProgress: (callback) => {
        const listener = (_event, data) => callback(data);
        ipcRenderer.on('elevation-progress', listener);
        return () => ipcRenderer.removeListener('elevation-progress', listener);
    },

    // GESTION CLÉ OpenAIP
    lireCleOpenAIP: () => ipcRenderer.invoke('lire-cle-openaip'),
    sauvegarderCleOpenAIP: (key) => ipcRenderer.invoke('sauvegarder-cle-openaip', key),

    // OPTIONS UTILISATEUR (toggles persistants)
    lireOptions: () => ipcRenderer.invoke('lire-options'),
    sauvegarderOptions: (options) => ipcRenderer.invoke('sauvegarder-options', options),

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

    // RECHERCHE MODALE (bouton loupe carte)
    // payload = { entity: 'airport'|'navaid', field: 'name'|'icao'|'ident', query: string }
    rechercheModale: (payload) => ipcRenderer.invoke('recherche-modale', payload),

    // AÉROPORTS DANS UNE BOUNDING BOX (pour affichage sur la carte)
    aeroportsDansBbox: (bbox) => ipcRenderer.invoke('aeroports-bbox', bbox),

    // DÉTAILS COMPLETS d'un aéroport (airport + runways + frequencies + comments)
    detailsAeroport: (ident) => ipcRenderer.invoke('details-aeroport', ident),

    // NAVAIDS dans la bbox + détails par id
    navaidsDansBbox: (bbox) => ipcRenderer.invoke('navaids-bbox', bbox),
    detailsNavaid: (id) => ipcRenderer.invoke('details-navaid', id),

    // LOGBOOK (carnet de vol automatisé + analyseur d'atterrissage)
    // Renderer → main : poussent l'état nécessaire au moteur côté main process.
    logbookSetEnabled: (enabled) => ipcRenderer.invoke('logbook-set-enabled', !!enabled),
    logbookSetFlightPlan: (plan) => ipcRenderer.invoke('logbook-set-flightplan', plan),
    logbookRecordDirectTo: (dt) => ipcRenderer.invoke('logbook-direct-to', dt),
    logbookHistorique: () => ipcRenderer.invoke('logbook-historique'),
    // Réponse à la modale « Le vol est-il terminé ? » (true = Oui → écriture).
    // `precision` (optionnel) = score d'évaluation de précision à stocker dans la fiche.
    logbookEndResponse: (confirmed, precision) =>
        ipcRenderer.invoke('logbook-end-response', !!confirmed, precision),
    // Main → renderer : événements de la machine à états et résultats de calcul.
    onLogbookState: (callback) => {
        const listener = (_event, data) => callback(data);
        ipcRenderer.on('logbook-state', listener);
        return () => ipcRenderer.removeListener('logbook-state', listener);
    },
    onLandingResult: (callback) => {
        const listener = (_event, data) => callback(data);
        ipcRenderer.on('landing-result', listener);
        return () => ipcRenderer.removeListener('landing-result', listener);
    },
    onLogbookFlightSaved: (callback) => {
        const listener = (_event, data) => callback(data);
        ipcRenderer.on('logbook-flight-saved', listener);
        return () => ipcRenderer.removeListener('logbook-flight-saved', listener);
    },
    // Demande de confirmation de fin de vol (≥2 conditions réunies).
    onLogbookConfirmEnd: (callback) => {
        const listener = (_event, data) => callback(data);
        ipcRenderer.on('logbook-confirm-end', listener);
        return () => ipcRenderer.removeListener('logbook-confirm-end', listener);
    },
    // Annulation de la demande (avion reparti) → fermer la modale.
    onLogbookConfirmCancel: (callback) => {
        const listener = (_event, data) => callback(data);
        ipcRenderer.on('logbook-confirm-cancel', listener);
        return () => ipcRenderer.removeListener('logbook-confirm-cancel', listener);
    },
});
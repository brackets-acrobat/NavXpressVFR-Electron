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

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    // Version du logiciel (app.getVersion côté main) — affichée dans le header.
    // Via IPC car le preload est sandboxé : un require('./package.json') y est
    // interdit et ferait planter tout le preload (donc window.api entier).
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),

    calculerDeclinaison: (lat, lon, alt) => ipcRenderer.invoke('calculer-declinaison', { lat, lon, alt }),
    onStatusSimConnect: (callback) => ipcRenderer.on('simconnect-status', (event, status) => callback(status)),
    onDonneesVol: (callback) => ipcRenderer.on('donnees-vol', (event, data) => callback(data)),
    onDonneesPosition: (callback) => ipcRenderer.on('donnees-position', (event, data) => callback(data)),
    // Horloges du simulateur (UTC + locale), poussées 1×/seconde.
    onSimTime: (callback) => {
        const listener = (_event, data) => callback(data);
        ipcRenderer.on('sim-time', listener);
        return () => ipcRenderer.removeListener('sim-time', listener);
    },
    // État de pause du simulateur (Pause_EX1) : { flags } (bitfield).
    onSimPause: (callback) => {
        const listener = (_event, data) => callback(data);
        ipcRenderer.on('sim-pause', listener);
        return () => ipcRenderer.removeListener('sim-pause', listener);
    },
    // État « en vol » (airborne) — indépendant du carnet de vol. Sert à
    // verrouiller le toggle « Navigation en mode difficile » dès le décollage.
    onFlightAirborne: (callback) => {
        const listener = (_event, data) => callback(data);
        ipcRenderer.on('flight-airborne', listener);
        return () => ipcRenderer.removeListener('flight-airborne', listener);
    },

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

    // EXTRACTION NAVAIDS MSFS 2024 (VOR/NDB via SimConnect)
    msfsExtraireNavaids: () => ipcRenderer.invoke('extraire-navaids-msfs'),
    onMsfsNavaidsProgress: (callback) => {
        const listener = (_event, data) => callback(data);
        ipcRenderer.on('msfs-navaids-progress', listener);
        return () => ipcRenderer.removeListener('msfs-navaids-progress', listener);
    },

    // MISES À JOUR AUTOMATIQUES (electron-updater)
    // Main → renderer : étapes du cycle de mise à jour (bannière features/updater.js).
    onUpdateAvailable: (callback) => {
        const listener = (_event, data) => callback(data);
        ipcRenderer.on('update-available', listener);
        return () => ipcRenderer.removeListener('update-available', listener);
    },
    onUpdateProgress: (callback) => {
        const listener = (_event, data) => callback(data);
        ipcRenderer.on('update-progress', listener);
        return () => ipcRenderer.removeListener('update-progress', listener);
    },
    onUpdateDownloaded: (callback) => {
        const listener = (_event, data) => callback(data);
        ipcRenderer.on('update-downloaded', listener);
        return () => ipcRenderer.removeListener('update-downloaded', listener);
    },
    onUpdateError: (callback) => {
        const listener = (_event, data) => callback(data);
        ipcRenderer.on('update-error', listener);
        return () => ipcRenderer.removeListener('update-error', listener);
    },
    // Renderer → main : « Redémarrer et installer ».
    installUpdate: () => ipcRenderer.invoke('update-install'),

    // RECHERCHE AÉROPORT (base OurAirports locale)
    rechercherAeroportOA: (code) => ipcRenderer.invoke('rechercher-aeroport-oa', code),

    // RECHERCHE MULTI (airports + navaids), retourne toutes les correspondances
    chercherCorrespondances: (code) => ipcRenderer.invoke('chercher-correspondances', code),

    // RECHERCHE MODALE (bouton loupe carte)
    // payload = { entity: 'airport'|'navaid', field: 'name'|'icao'|'ident', query: string }
    rechercheModale: (payload) => ipcRenderer.invoke('recherche-modale', payload),

    // AÉROPORTS DANS UNE BOUNDING BOX (pour affichage sur la carte)
    aeroportsDansBbox: (bbox) => ipcRenderer.invoke('aeroports-bbox', bbox),

    // AÉROPORTS LES PLUS PROCHES (atterrissage d'urgence) — { lat, lon, limit }
    // → liste triée par distance, chacun avec la longueur de piste max (length_ft).
    aeroportsProches: (payload) => ipcRenderer.invoke('aeroports-proches', payload),

    // DÉTAILS COMPLETS d'un aéroport (airport + runways + frequencies + comments)
    detailsAeroport: (ident) => ipcRenderer.invoke('details-aeroport', ident),

    // NAVAIDS dans la bbox + détails par id
    navaidsDansBbox: (bbox) => ipcRenderer.invoke('navaids-bbox', bbox),
    detailsNavaid: (id) => ipcRenderer.invoke('details-navaid', id),

    // MÉTÉO METAR (aviationweather.gov) — { icao, lat, lon } → METAR brut
    // de l'aéroport ou de la station émettrice la plus proche.
    metarAeroport: (payload) => ipcRenderer.invoke('metar-aeroport', payload),
    // RECHERCHE METAR par code OACI (bouton 🔍 METAR) → distingue
    // disponible / aucun relevé / aucun service METAR.
    metarRecherche: (icao) => ipcRenderer.invoke('metar-recherche', icao),

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
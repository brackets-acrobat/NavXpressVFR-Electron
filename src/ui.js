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

// ============================================================
// NavXpressVFR — ui.js  (version bilingue FR/EN)
// ORCHESTRATEUR : appelle les init*() des modules dans l'ordre.
// Toute la logique vit dans src/js/ (état/helpers) et src/js/features/
// (une fonctionnalité = un fichier). Voir l'ordre des <script> dans index.html.
// L'ordre des appels ci-dessous est significatif (notamment initFuel avant
// initDirectTo : chaîne de décorateurs sur mettreAJourLogDeNav).
// ============================================================

document.addEventListener('DOMContentLoaded', async () => {
  console.log("UI NavXpressVFR chargée et prête.");

  // Version du logiciel affichée à droite de la bannière (format « v 1.4.5 »).
  const versionEl = document.getElementById('app-version');
  if (versionEl && window.api && window.api.getAppVersion) {
    window.api.getAppVersion()
      .then(v => { if (v) versionEl.textContent = `v ${v}`; })
      .catch(() => {});
  }

  await chargerCleOpenAIP();

  // Charge window.appOptions depuis disque (defaults appliqués par options.js).
  // DOIT être awaité avant initAglWarning() — celui-ci lit aglWarningEnabled.
  await chargerOptions();

  initOpenAIP();

  initImports();

  initTimers();

  // --- Initialisation du système i18n ---
  initI18n();

  initI18nToggle();

  initMap();

  initReset();

  initLegModals();

  initFlightPlanIO();

  // Bouton « Copier les points tournants » à côté du titre du log de nav.
  initCopyWaypoints();

  initValidation();
  initSim();

  // Vitesse sol (GS) à gauche de la rose des vents : s'abonne à onDonneesPosition,
  // rafraîchit l'affichage toutes les 10 s.
  initGroundSpeed();

  // Horloges du simulateur (UTC + locale) dans le header : s'abonne à onSimTime.
  initSimClock();

  // Avertissement audio « < 500 ft AGL » : s'abonne à onDonneesPosition.
  // Indépendant des autres features (pas d'UI, pas de carte).
  initAglWarning();

  initFuel();

  initTank();

  initConversions();

  // Bouton Options du header + modale (vide pour l'instant).
  initOptions();

  // Bouton Carnet de vol (à droite de la boîte chronomètre).
  initLogbook();

  initDirectTo();

  // Atterrissage d'urgence : bouton rouge + modale 3 aéroports les plus
  // proches. Doit suivre initDirectTo (utilise window.activerDirectToUrgence).
  initEmergency();

  // initMapMeasure expose window.demarrerMesure / effacerMesure / aUneMesure
  // (utilisées par les items du menu contextuel).
  initMapMeasure();

  // initMapMarkers expose window.demanderAjoutRepere / chargerReperesVisuels /
  // effacerTousReperesVisuels (menu contextuel + flightplan-io + reset).
  initMapMarkers();

  // Points remarquables OSM (Overpass) : expose window.chargerPOIRoute /
  // chargerPOISnapshot / serialiserPOI / effacerTousPOI / setPoiThemeEnabled
  // (menu Calques + flightplan-io + reset). Doit être appelé APRÈS initMap
  // (couches Leaflet + dropdown Calques) — il régénère ce dropdown au besoin.
  initPoiOverpass();

  // Cercle d'incertitude : bouton flottant carte (3 NM gris anthracite, 5 s).
  // Doit être appelé APRÈS initMap (le bouton est un contrôle Leaflet).
  initUncertaintyCircle();

  // Filtre « Taille d'aéroport » : bouton déroulant carte (glissière longueur de
  // piste min). Ajouté APRÈS le cercle d'incertitude pour apparaître à sa GAUCHE
  // (corner topright en row-reverse). Défini par initMap (closure carte).
  if (typeof window._initAirportSizeFilter === 'function') window._initAirportSizeFilter();

  // Cercle de portée : clic droit carte → modale rayon NM → cercle + point
  // central magenta. Expose window.ouvrirModaleCerclePortee (menu contextuel) et
  // window.effacerTousCerclesPortee (reset). Doit suivre initMap.
  initRangeCircle();

  // Tour de piste : clic droit sur un aéroport → modale (piste/sens/longueurs/
  // altitude) → tracé magenta + caps des branches. Expose
  // window.demanderTourDePiste (menu contextuel) et window.effacerTousToursDePiste
  // (reset). Doit suivre initMap.
  initTrafficPattern();

  // Annonces vocales du tour de piste (étape 2 : "vent arrière"). S'abonne à
  // onDonneesPosition et lit le global `toursDePiste`. Doit suivre initTrafficPattern.
  initTrafficPatternVoice();

  // Bouton « Rechercher » en bas à gauche de la carte. Doit être appelé
  // APRÈS initMap (contrôle Leaflet) — utilise window.api.rechercheModale.
  initMapSearch();

  // "Coordonnées du point" : expose window.ouvrirModaleCoordsPoint (utilisé par
  // le menu contextuel) et window.rafraichirBoutonsCollage (boutons Coller des
  // modales Insérer / Éditer le leg). Doit être appelé AVANT initMapContextMenu.
  initMapCoords();

  // Doit être appelé APRÈS initMap (carte présente), initDirectTo (expose
  // window.demanderDirectToPoint), initMapMeasure (fonctions de mesure),
  // initMapMarkers (window.demanderAjoutRepere) et initMapCoords
  // (window.ouvrirModaleCoordsPoint) — toutes utilisées par le menu.
  initMapContextMenu();

  // Flanquement VOR : expose window.ouvrirModaleFlanquement (appelé par le menu
  // contextuel sur clic droit d'un VOR), chargerFlanquements / effacerTous
  // (flightplan-io + reset). Doit être appelé APRÈS initMap (carte présente).
  initFlanquement();

  initWaypointModals();

  // Pont carnet de vol : décore mettreAJourLogDeNav (doit donc être appelé
  // APRÈS initDirectTo qui pose lui aussi un décorateur — chaîne préservée),
  // écoute les events 'logbook-direct-to', pousse logbookEnabled à main.
  // Lit window.appOptions (chargerOptions() awaité plus haut) au démarrage.
  initLogbookBridge();

  // Évaluation de précision du vol : s'abonne à onDonneesPosition / onLandingResult /
  // onLogbookState et expose window.precision.finalize (appelé par logbook.js à la
  // confirmation de fin de vol). Sous-fonction du carnet de vol (logbook ON requis).
  // Lit window.appOptions.precisionEnabled au décollage.
  initPrecision();

  // Boîte METAR (départ / arrivée) à côté du chronomètre : décore
  // mettreAJourLogDeNav pour re-récupérer les METAR quand le départ/arrivée
  // du plan change, et câble le bouton œil → modale METAR décodé.
  // Doit être appelé APRÈS initI18n (utilise t() / currentLang).
  initMetar();

  // Bannière de mise à jour automatique (electron-updater). S'abonne aux
  // événements update-* ; n'affiche rien tant qu'aucune MAJ n'est détectée.
  // Doit être appelé APRÈS initI18n (utilise t()).
  initUpdater();

});

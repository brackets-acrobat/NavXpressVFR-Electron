# Crédits et attributions

NavXpressVFR est distribué sous licence **GPL-3.0-or-later** (voir `LICENSE`).

## Little Navmap / atools — Alexander Barthel (albar965)

L'extraction des **navaids depuis MSFS 2024** (`extract-navaids-msfs.js`) s'inspire
directement de la méthode du projet **atools** / **Little Navmap** d'Alexander Barthel :
- traversance du réseau d'airways via l'API SimConnect Facility Data ;
- chargement des « navaids déconnectés » à partir d'une liste de référence.

Le fichier **`bundled-data/navaids-seed.csv.gz`** est le fichier
**`resources/navdata/navaids24.csv.gz`** du dépôt
[albar965/atools](https://github.com/albar965/atools) (licence **GPL-3.0**).

- atools : https://github.com/albar965/atools
- Little Navmap : https://github.com/albar965/littlenavmap

### Note sur les données de navigation
Le fichier seed contient une **liste d'identifiants** de navaids (ident, région, type).
Ces identifiants sont susceptibles d'être **dérivés de données Navigraph**. NavXpressVFR
ne les utilise que comme **liste d'amorçage** pour interroger la base **locale de
l'utilisateur (MSFS 2024)** ; les données finales (position, fréquence, portée…)
proviennent du simulateur de l'utilisateur, pas de ce fichier.

## Bibliothèques

- [node-simconnect](https://github.com/EvenAR/node-simconnect) — accès SimConnect (MIT)
- Electron, et les dépendances listées dans `package.json`.

## Données cartographiques

- Fonds de carte : OpenStreetMap, OpenTopoMap, CARTO, Esri (voir attributions in-app).
- Espaces aériens : OpenAIP.

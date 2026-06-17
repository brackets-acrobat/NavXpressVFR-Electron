const { downloadArtifact } = require('@electron/get');
const extract = require('extract-zip');
const path = require('path');
const fs = require('fs-extra');

async function main() {
  try {
    console.log("1. Téléchargement du binaire Electron officiel pour Windows x64...");
    const zipPath = await downloadArtifact({
      version: '30.0.0', // La version définie dans ton package.json
      platform: 'win32',
      arch: 'x64',
      artifactName: 'electron'
    });

    console.log(`Fichier ZIP récupéré dans le cache : ${zipPath}`);
    
    const targetDir = path.join(__dirname, 'node_modules', 'electron', 'dist');
    console.log(`2. Nettoyage du dossier cible : ${targetDir}`);
    await fs.emptyDir(targetDir);

    console.log("3. Extraction du binaire en cours...");
    await extract(zipPath, { dir: targetDir });

    // Création du fichier path.txt requis par la librairie
    const pathTxt = path.join(__dirname, 'node_modules', 'electron', 'path.txt');
    await fs.writeFile(pathTxt, 'electron.exe');

    console.log("Electron a été installé manuellement avec succès !");
  } catch (err) {
    console.error("Erreur lors de l'installation forcée :", err);
  }
}

main();
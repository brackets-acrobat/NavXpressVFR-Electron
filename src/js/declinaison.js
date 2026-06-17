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
// NavXpressVFR — declinaison.js
// Déclinaison magnétique (calcul + affichage)  (extrait de ui.js — Phase 1)
// ============================================================

// -------------------------------------------------------
// Calcul de la déclinaison magnétique au centroïde
// -------------------------------------------------------
async function calculerDeclinaisonCentroide() {
  if (flightPlan.length === 0) {
    declinaisonMoyenneGlobale = 0.0;
    actualiserAffichageDeclinaison();
    return;
  }

  let sommeLat = 0;
  let sommeLon = 0;
  flightPlan.forEach(p => { sommeLat += p.lat; sommeLon += p.lon; });

  const latCentroide = sommeLat / flightPlan.length;
  const lonCentroide = sommeLon / flightPlan.length;

  try {
    console.log(`Calcul de la déclinaison au centroïde : Lat ${latCentroide.toFixed(4)} / Lon ${lonCentroide.toFixed(4)}`);
    const resDecl = await window.api.calculerDeclinaison(latCentroide, lonCentroide, 3000);

    if (resDecl && resDecl.valeur) {
      let valDecl = parseFloat(resDecl.valeur);
      if (resDecl.direction === "O" || resDecl.direction === "W") {
        valDecl = -valDecl;
      }
      declinaisonMoyenneGlobale = valDecl;
      console.log(`Déclinaison magnétique moyenne : ${declinaisonMoyenneGlobale.toFixed(2)}°`);
    } else {
      console.warn("Résultat déclinaison invalide, repli sur 0.0°");
      declinaisonMoyenneGlobale = 0.0;
    }
  } catch (err) {
    console.error("Erreur déclinaison centroïde :", err);
    declinaisonMoyenneGlobale = 0.0;
  }

  actualiserAffichageDeclinaison();
}


// -------------------------------------------------------
// Affichage de la déclinaison dans le titre
// -------------------------------------------------------
function actualiserAffichageDeclinaison() {
  const dirStr = declinaisonMoyenneGlobale >= 0 ? t('declEast') : t('declWest');
  const absVal = Math.abs(declinaisonMoyenneGlobale).toFixed(1);

  // Injection dans le champ dédié de la config vol
  const inputDecl = document.getElementById('input-decl-mag');
  if (inputDecl) {
    inputDecl.value = `${absVal}° ${dirStr}`;
  }
}


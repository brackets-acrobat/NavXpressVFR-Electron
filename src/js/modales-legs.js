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
// NavXpressVFR — modales-legs.js
// Modales confirmation / édition / suppression de leg  (extrait de ui.js — Phase 1)
// ============================================================

// -------------------------------------------------------
// Modale de confirmation (scission ou déplacement)
// insertLeg   : index du leg scindé (scission), ou null si déplacement
// moveIndex   : index dans flightPlan du point déplacé, ou null si scission
// -------------------------------------------------------
let _confirmCallback = null;

function ouvrirModaleConfirmation(latlng, insertLeg, moveIndex) {
  const overlay = document.getElementById('wp-confirm-overlay');
  const titleEl = document.getElementById('wp-confirm-title');
  const nameInput = document.getElementById('wp-confirm-name');
  const latEl = document.getElementById('wp-confirm-lat');
  const lonEl = document.getElementById('wp-confirm-lon');
  const errEl = document.getElementById('wp-confirm-error');

  // Titre selon le contexte
  if (moveIndex !== null) {
    titleEl.textContent = currentLang === 'fr'
      ? `Déplacer ${flightPlan[moveIndex].name}`
      : `Move ${flightPlan[moveIndex].name}`;
    nameInput.value = flightPlan[moveIndex].name;
  } else {
    titleEl.textContent = currentLang === 'fr' ? 'Nouveau point de report' : 'New waypoint';
    nameInput.value = prochainNomWP();
  }

  latEl.value = latlng.lat.toFixed(6);
  lonEl.value = wrapLon(latlng.lng).toFixed(6);
  errEl.textContent = '';

  overlay.classList.add('visible');
  setTimeout(() => nameInput.focus(), 50);

  // Stocker le callback selon le mode
  _confirmCallback = async () => {
    const name = nameInput.value.trim();
    if (!name) {
      errEl.textContent = currentLang === 'fr' ? 'Veuillez renseigner un identifiant.' : 'Please enter an identifier.';
      return;
    }

    overlay.classList.remove('visible');

    if (moveIndex !== null) {
      // Déplacement : mise à jour des coordonnées du point existant.
      // wrapLon : le drag a pu se faire dans un repère déroulé (antiméridien) →
      // on re-normalise la longitude stockée dans [-180, 180].
      flightPlan[moveIndex].lat = latlng.lat;
      flightPlan[moveIndex].lon = wrapLon(latlng.lng);
      flightPlan[moveIndex].name = name;
      flightPlan[moveIndex].ident = name;
    } else {
      // Scission : insertion du nouveau point dans le plan
      const nouveauPoint = { name, ident: name, lat: latlng.lat, lon: wrapLon(latlng.lng) };
      flightPlan.splice(insertLeg, 0, nouveauPoint);
      const altVoisin = legAltitudes[insertLeg] ?? ALT_DEFAULT;
      legAltitudes.splice(insertLeg, 0, altVoisin);
      if (activeLegIndex >= insertLeg) activeLegIndex++;
    }

    // Nettoyer le marqueur temporaire si présent
    if (marqueurTemporaire) {
      map.removeLayer(marqueurTemporaire);
      marqueurTemporaire = null;
    }

    // Redessiner carte complète
    marqueursCarte.forEach(m => map.removeLayer(m));
    marqueursCarte = [];
    supprimerSegmentsCarte();
    await calculerDeclinaisonCentroide();
    flightPlan.forEach((p, idx) => tracerPointVisuel(p, idx));
    redessinerSegments();
    const bounds = L.latLngBounds(flightPlanDisplayLatLngs());
    map.fitBounds(bounds, { padding: [50, 50] });
    mettreAJourLogDeNav();
  };
}


// -------------------------------------------------------
// Modale édition leg (scope global — appelée depuis mettreAJourLogDeNav)
// -------------------------------------------------------
function ouvrirModaleEditLeg(legIndex) {
  const ptA = flightPlan[legIndex - 1];
  const ptB = flightPlan[legIndex];

  // Nettoyer les listes de résultats de recherche + invalider toute
  // requête IPC encore en cours (anti-race condition)
  ['search-results-edit-dep', 'search-results-edit-arr'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el._searchReqId = (el._searchReqId || 0) + 1;
      el.innerHTML = '';
      el.classList.remove('visible');
    }
  });
  ['search-status-edit-dep', 'search-status-edit-arr'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.textContent = ''; el.className = 'search-status'; }
  });
  // Défensif : s'assurer que les inputs ne portent pas readonly/disabled
  ['edit-leg-dep-name', 'edit-leg-arr-name'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.removeAttribute('readonly');
    el.removeAttribute('disabled');
  });

  // Remplir le sous-titre
  document.getElementById('edit-leg-subtitle').textContent =
    TRANSLATIONS[currentLang].editLegSubtitle(legIndex);

  // Helper : valeur absolue + direction radio
  function fillCoord(latId, latRadioName, lonId, lonRadioName, pt) {
    document.getElementById(latId).value = Math.abs(pt.lat).toFixed(6);
    document.getElementById(lonId).value = Math.abs(pt.lon).toFixed(6);
    document.querySelectorAll(`input[name="${latRadioName}"]`).forEach(r => {
      r.checked = (r.value === (pt.lat >= 0 ? 'N' : 'S'));
    });
    document.querySelectorAll(`input[name="${lonRadioName}"]`).forEach(r => {
      r.checked = (r.value === (pt.lon >= 0 ? 'E' : 'W'));
    });
  }

  document.getElementById('edit-leg-dep-name').value = ptA.name;
  fillCoord('edit-leg-dep-lat', 'edit-dep-lat-dir', 'edit-leg-dep-lon', 'edit-dep-lon-dir', ptA);

  document.getElementById('edit-leg-arr-name').value = ptB.name;
  fillCoord('edit-leg-arr-lat', 'edit-arr-lat-dir', 'edit-leg-arr-lon', 'edit-arr-lon-dir', ptB);

  // État courant du flag "tour de piste" : préservé si l'utilisateur ne re-cherche pas
  document.getElementById('edit-leg-dep-name').dataset.pattern = ptA.pattern ? 'true' : '';
  document.getElementById('edit-leg-arr-name').dataset.pattern = ptB.pattern ? 'true' : '';

  // Afficher ou cacher la rangée checkbox "Tour de piste prévu" pour chaque côté
  ['dep', 'arr'].forEach(side => {
    const wp = side === 'dep' ? ptA : ptB;
    const row = document.getElementById(`edit-leg-${side}-pattern-row`);
    const cb = document.getElementById(`edit-leg-${side}-pattern-cb`);
    if (!row || !cb) return;
    if (wp.pattern) {
      row.style.display = 'block';
      cb.checked = true;
    } else {
      row.style.display = 'none';
      cb.checked = false;
    }
  });

  // Aéroports fixes (départ du leg 1, arrivée du dernier leg) : édition COMPLÈTE
  // autorisée (nom + coordonnées), comme un point tournant. On force seulement
  // l'affichage permanent de la case "tour de piste" pour pouvoir ajouter/retirer
  // un toucher sans relancer une recherche. Les modifs du départ / de l'arrivée
  // sont répercutées sur les champs ICAO de la boîte Informations à la validation.
  function _toucherAeroportToujoursVisible(side, isAirport, wp) {
    if (!isAirport) return;
    const patternRow = document.getElementById(`edit-leg-${side}-pattern-row`);
    const patternCb = document.getElementById(`edit-leg-${side}-pattern-cb`);
    if (patternRow) patternRow.style.display = 'block';
    if (patternCb) patternCb.checked = !!wp.pattern;
  }
  _toucherAeroportToujoursVisible('dep', legIndex === 1, ptA);
  _toucherAeroportToujoursVisible('arr', legIndex === flightPlan.length - 1, ptB);

  document.getElementById('edit-leg-error').textContent = '';

  // Affiche/cache les boutons "Coller les coordonnées de la carte" (départ +
  // arrivée) selon qu'une copie est disponible en mémoire (coordsCopiees).
  if (typeof window.rafraichirBoutonsCollage === 'function') window.rafraichirBoutonsCollage();

  // Stocker l'index courant pour la validation
  window._editLegIndex = legIndex;
  document.getElementById('edit-leg-overlay').style.display = 'flex';
  // Focus le premier côté éditable (le départ du leg 1 est verrouillé → on vise
  // l'arrivée). On ne focus pas un champ en lecture seule.
  setTimeout(() => {
    const depEl = document.getElementById('edit-leg-dep-name');
    const arrEl = document.getElementById('edit-leg-arr-name');
    const el = (depEl && !depEl.hasAttribute('readonly')) ? depEl
      : (arrEl && !arrEl.hasAttribute('readonly')) ? arrEl
      : null;
    if (el) { el.focus(); el.select(); }
  }, 50);
}

// -------------------------------------------------------
// Modale suppression leg (scope global — appelée depuis mettreAJourLogDeNav)
// -------------------------------------------------------
window._deleteLegCallback = null;

function ouvrirModaleDeleteLeg(legIndex) {
  const ptA = flightPlan[legIndex - 1];
  const ptB = flightPlan[legIndex];
  const msg = TRANSLATIONS[currentLang].deleteLegMsg(ptA.name, ptB.name);
  document.getElementById('confirm-delete-msg').textContent = msg;
  window._deleteLegCallback = () => {
    flightPlan.splice(legIndex, 1);
    legAltitudes.splice(legIndex, 1);
    if (activeLegIndex > flightPlan.length - 1) activeLegIndex = Math.max(1, flightPlan.length - 1);
    marqueursCarte.forEach(m => map.removeLayer(m));
    marqueursCarte = [];
    supprimerSegmentsCarte();
    flightPlan.forEach((p, idx) => tracerPointVisuel(p, idx));
    redessinerSegments();
    if (flightPlan.length > 1) {
      const bounds = L.latLngBounds(flightPlanDisplayLatLngs());
      map.fitBounds(bounds, { padding: [50, 50], animate: false });
    }
    mettreAJourLogDeNav();
  };
  document.getElementById('confirm-delete-overlay').style.display = 'flex';
}


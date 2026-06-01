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

  document.getElementById('edit-leg-error').textContent = '';

  // Stocker l'index courant pour la validation
  window._editLegIndex = legIndex;
  document.getElementById('edit-leg-overlay').style.display = 'flex';
  // Focus l'input Départ (sélectionne le contenu pour faciliter le remplacement)
  setTimeout(() => {
    const el = document.getElementById('edit-leg-dep-name');
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


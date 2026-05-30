// ============================================================
// NavXpressVFR — map-markers.js
// Repères visuels sur la carte (clic droit → "Ajouter un repère visuel").
//
// Un repère = cercle jaune (Ø ~6px) à contour rouge 2px, posé librement.
// Création via une modale (nom + description), clic sur le repère pour
// rouvrir une modale d'info avec suppression (confirmée).
// Persistés dans le plan .navxpv (cf. flightplan-io.js, tableau global
// `reperesVisuels` défini dans globals.js).
//
// Ponts exposés (utilisés par le menu contextuel + flightplan-io + reset) :
//   window.demanderAjoutRepere(latlng)   — ouvre la modale de création
//   window.chargerReperesVisuels(arr)     — vide puis recrée depuis un snapshot
//   window.effacerTousReperesVisuels()    — retire tous les repères de la carte
// ============================================================

function initMapMarkers() {
  if (typeof map === 'undefined' || !map) return;

  // --- Réfs modale de création ---
  const addOverlay = document.getElementById('repere-add-overlay');
  const addName = document.getElementById('repere-add-name');
  const addDesc = document.getElementById('repere-add-desc');
  const addError = document.getElementById('repere-add-error');
  const btnAddCancel = document.getElementById('btn-repere-add-cancel');
  const btnAddValidate = document.getElementById('btn-repere-add-validate');

  // --- Réfs modale d'info / suppression ---
  const infoOverlay = document.getElementById('repere-info-overlay');
  const infoName = document.getElementById('repere-info-name');
  const infoDesc = document.getElementById('repere-info-desc');
  const btnInfoClose = document.getElementById('btn-repere-info-close');
  const btnInfoDelete = document.getElementById('btn-repere-info-delete');

  // --- Réfs modale de confirmation suppression ---
  const delOverlay = document.getElementById('repere-delete-confirm-overlay');
  const btnDelNo = document.getElementById('btn-repere-delete-no');
  const btnDelYes = document.getElementById('btn-repere-delete-yes');

  let _pendingLatLng = null;   // position du futur repère pendant la saisie
  let _repereCourant = null;   // repère affiché dans la modale d'info

  // -------------------------------------------------------
  // Dessin d'un repère : cercle jaune contour rouge + clic → info
  // -------------------------------------------------------
  function _dessinerRepere(repere) {
    if (typeof L === 'undefined') return;
    const marqueur = L.circleMarker([repere.lat, repere.lon], {
      radius: 5,            // Ø ~10px
      color: '#e53935',     // contour rouge
      weight: 2,            // épaisseur contour 2px
      fillColor: '#ffeb3b', // remplissage jaune
      fillOpacity: 1,
      opacity: 1,
      className: 'repere-visuel-marker',
      interactive: true,
    }).addTo(map);
    if (repere.name) {
      marqueur.bindTooltip(repere.name, { direction: 'top', offset: [0, -4] });
    }
    marqueur.on('click', (e) => {
      if (e && e.originalEvent) L.DomEvent.stopPropagation(e);
      _ouvrirInfo(repere);
    });
    repere.marker = marqueur;
  }

  // -------------------------------------------------------
  // Modale de création
  // -------------------------------------------------------
  function _ouvrirAjout(latlng) {
    if (!addOverlay || !latlng) return;
    _pendingLatLng = latlng;
    if (addName) addName.value = '';
    if (addDesc) addDesc.value = '';
    if (addError) addError.textContent = '';
    addOverlay.classList.add('visible');
    if (addName) setTimeout(() => addName.focus(), 30);
  }
  function _fermerAjout() {
    if (addOverlay) addOverlay.classList.remove('visible');
    _pendingLatLng = null;
  }
  function _validerAjout() {
    const name = (addName ? addName.value : '').trim();
    const description = (addDesc ? addDesc.value : '').trim();
    if (!name) {
      if (addError) addError.textContent = t('repereNameRequired');
      if (addName) addName.focus();
      return;
    }
    if (!_pendingLatLng) { _fermerAjout(); return; }
    const repere = {
      name,
      description,
      lat: _pendingLatLng.lat,
      lon: _pendingLatLng.lng !== undefined ? _pendingLatLng.lng : _pendingLatLng.lon,
      marker: null,
    };
    reperesVisuels.push(repere);
    _dessinerRepere(repere);
    _fermerAjout();
  }

  if (btnAddCancel) btnAddCancel.addEventListener('click', _fermerAjout);
  if (btnAddValidate) btnAddValidate.addEventListener('click', _validerAjout);
  if (addOverlay) {
    addOverlay.addEventListener('click', e => { if (e.target === addOverlay) _fermerAjout(); });
  }
  if (addName) {
    addName.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); _validerAjout(); }
    });
  }

  // -------------------------------------------------------
  // Modale d'info / suppression
  // -------------------------------------------------------
  function _ouvrirInfo(repere) {
    if (!infoOverlay || !repere) return;
    _repereCourant = repere;
    if (infoName) infoName.textContent = repere.name || '';
    if (infoDesc) infoDesc.textContent = repere.description || '';
    infoOverlay.classList.add('visible');
  }
  function _fermerInfo() {
    if (infoOverlay) infoOverlay.classList.remove('visible');
    _repereCourant = null;
  }
  if (btnInfoClose) btnInfoClose.addEventListener('click', _fermerInfo);
  if (infoOverlay) {
    infoOverlay.addEventListener('click', e => { if (e.target === infoOverlay) _fermerInfo(); });
  }

  // -------------------------------------------------------
  // Suppression d'un repère (avec confirmation)
  // -------------------------------------------------------
  function _supprimerRepere(repere) {
    if (!repere) return;
    if (repere.marker && typeof map !== 'undefined' && map) {
      try { map.removeLayer(repere.marker); } catch (_) { }
    }
    const idx = reperesVisuels.indexOf(repere);
    if (idx !== -1) reperesVisuels.splice(idx, 1);
  }

  function _ouvrirConfirmSuppr() {
    if (!delOverlay) {            // pas de modale → suppression directe (sécurité)
      _supprimerRepere(_repereCourant);
      _fermerInfo();
      return;
    }
    delOverlay.classList.add('visible');   // confirm par-dessus l'info (déclarée après dans le DOM)
  }
  function _fermerConfirm() {
    if (delOverlay) delOverlay.classList.remove('visible');
  }
  if (btnInfoDelete) btnInfoDelete.addEventListener('click', _ouvrirConfirmSuppr);
  if (btnDelNo) btnDelNo.addEventListener('click', _fermerConfirm);
  if (btnDelYes) {
    btnDelYes.addEventListener('click', () => {
      _supprimerRepere(_repereCourant);
      _fermerConfirm();
      _fermerInfo();
    });
  }
  if (delOverlay) {
    delOverlay.addEventListener('click', e => { if (e.target === delOverlay) _fermerConfirm(); });
  }

  // Échap : ferme la modale ouverte la plus "haute" (confirm > info > ajout)
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (delOverlay && delOverlay.classList.contains('visible')) { _fermerConfirm(); return; }
    if (infoOverlay && infoOverlay.classList.contains('visible')) { _fermerInfo(); return; }
    if (addOverlay && addOverlay.classList.contains('visible')) { _fermerAjout(); }
  });

  // -------------------------------------------------------
  // API publique (ponts window)
  // -------------------------------------------------------
  function effacerTousReperesVisuels() {
    reperesVisuels.forEach(r => {
      if (r.marker && typeof map !== 'undefined' && map) {
        try { map.removeLayer(r.marker); } catch (_) { }
      }
    });
    reperesVisuels = [];
  }

  function chargerReperesVisuels(arr) {
    effacerTousReperesVisuels();
    if (!Array.isArray(arr)) return;
    arr.forEach(item => {
      if (!item || typeof item.lat !== 'number' || typeof item.lon !== 'number') return;
      const repere = {
        name: item.name || '',
        description: item.description || '',
        lat: item.lat,
        lon: item.lon,
        marker: null,
      };
      reperesVisuels.push(repere);
      _dessinerRepere(repere);
    });
  }

  window.demanderAjoutRepere = (latlng) => _ouvrirAjout(latlng);
  window.chargerReperesVisuels = chargerReperesVisuels;
  window.effacerTousReperesVisuels = effacerTousReperesVisuels;
}

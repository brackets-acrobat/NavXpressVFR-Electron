// ============================================================
// NavXpressVFR — recherche.js
// Recherche aéroport / multi + modale tour de piste  (extrait de ui.js — Phase 1)
// ============================================================

// -------------------------------------------------------
// Modale "Tour de piste / Toucher prévu ?" — simple Y/N
// Renvoie une Promise<boolean>
// -------------------------------------------------------
function askPatternModal(airportCode) {
  return new Promise(resolve => {
    const overlay = document.getElementById('ask-pattern-overlay');
    const codeEl = document.getElementById('ask-pattern-code');
    const btnYes = document.getElementById('btn-ask-pattern-yes');
    const btnNo = document.getElementById('btn-ask-pattern-no');
    if (!overlay || !codeEl || !btnYes || !btnNo) return resolve(false);

    codeEl.textContent = airportCode || '';

    let done = false;
    function cleanup() {
      done = true;
      overlay.classList.remove('visible');
      btnYes.removeEventListener('click', onYes);
      btnNo.removeEventListener('click', onNo);
      overlay.removeEventListener('click', onBg);
      document.removeEventListener('keydown', onKey);
    }
    function onYes() { if (done) return; cleanup(); resolve(true); }
    function onNo()  { if (done) return; cleanup(); resolve(false); }
    function onBg(e) { if (e.target === overlay) onNo(); }
    function onKey(e) { if (e.key === 'Escape') onNo(); }

    btnYes.addEventListener('click', onYes);
    btnNo.addEventListener('click', onNo);
    overlay.addEventListener('click', onBg);
    document.addEventListener('keydown', onKey);

    overlay.classList.add('visible');
  });
}

// -------------------------------------------------------
// Recherche aéroport — utilise la base OurAirports locale
// (utilisée par toutes les modales)
// -------------------------------------------------------
// latRadioName / lonRadioName (optionnels) : noms EXPLICITES des groupes de
// radios N/S et E/W à synchroniser avec le signe des coordonnées. À fournir
// quand les radios ne sont pas dans le même conteneur direct que les inputs
// (ex. modale « Créer un plan » : input dans .input-group, radios dans un div
// frère .cf-radio-group → l'auto-détection par closest() échoue et le signe
// Ouest/Sud était perdu). Sans ces paramètres, on retombe sur l'auto-détection.
async function rechercherAeroport(icao, statusEl, latEl, lonEl, nameEl, latRadioName, lonRadioName) {
  const code = icao.trim().toUpperCase();
  if (!code) return;

  statusEl.className = 'search-status';
  statusEl.textContent = t('searchSearching');
  // Réinitialise le flag tour de piste à chaque nouvelle recherche
  if (nameEl) nameEl.dataset.pattern = '';

  try {
    const res = await window.api.rechercherAeroportOA(code);

    if (!res || !res.found) {
      statusEl.className = 'search-status error';
      if (res && res.reason === 'no-data') {
        statusEl.textContent = t('oaDataMissing');
      } else if (res && res.reason === 'no-coords') {
        statusEl.textContent = t('searchCoordsNotFound');
      } else {
        statusEl.textContent = t('searchNotFound');
      }
      return;
    }

    const { lat, lon, name } = res;

    // Injection des coordonnées (valeur absolue — les radios N/S/E/W gèrent le signe)
    latEl.value = Math.abs(lat).toFixed(6);
    lonEl.value = Math.abs(lon).toFixed(6);

    // Noms des groupes de radios N/S et E/W : explicites si fournis par
    // l'appelant, sinon auto-détection depuis le conteneur du champ (fragile —
    // échoue si le radio est dans un div frère, cf. en-tête de la fonction).
    const latRN = latRadioName || latEl.closest('form, div')
      ?.querySelector('input[type="radio"][value="N"], input[type="radio"][value="S"]')
      ?.name;
    const lonRN = lonRadioName || lonEl.closest('form, div')
      ?.querySelector('input[type="radio"][value="E"], input[type="radio"][value="W"]')
      ?.name;

    if (latRN) {
      const latDir = lat >= 0 ? 'N' : 'S';
      const el = document.querySelector(`input[name="${latRN}"][value="${latDir}"]`);
      if (el) el.checked = true;
    }
    if (lonRN) {
      const lonDir = lon >= 0 ? 'E' : 'W';
      const el = document.querySelector(`input[name="${lonRN}"][value="${lonDir}"]`);
      if (el) el.checked = true;
    }

    statusEl.className = 'search-status ok';
    statusEl.textContent = name || code;

    // Si on a un nameEl associé, demander "Tour de piste / Toucher ?"
    // (rechercherAeroport renvoie uniquement des aéroports, donc on demande
    // toujours quand un résultat est trouvé)
    if (nameEl) {
      const yes = await askPatternModal(name || code);
      if (yes) nameEl.dataset.pattern = 'true';
    }
  } catch (err) {
    statusEl.className = 'search-status error';
    statusEl.textContent = t('searchNetworkError');
    console.error('OurAirports search error:', err);
  }
}

// -------------------------------------------------------
// Recherche MULTI (airports + navaids) avec liste de résultats à radios
// + bouton "Sélectionner". Utilisée par "Insérer point tournant" et
// "Éditer leg" (Départ / Arrivée).
// -------------------------------------------------------
async function rechercherMulti(opts) {
  const {
    code,            // string saisi par l'utilisateur
    statusEl,        // élément où afficher le statut de recherche
    resultsEl,       // container <div> où injecter la liste de radios
    latEl, lonEl,    // inputs cible (où injecter les coordonnées sélectionnées)
    latRadioName,    // name des radios N/S
    lonRadioName,    // name des radios E/W
    nameEl,          // (optionnel) input "Nom/Ident" à mettre à jour à la sélection
  } = opts;

  const up = (code || '').trim().toUpperCase();
  if (!up) return;

  statusEl.className = 'search-status';
  statusEl.textContent = t('searchSearching');
  // Cacher la liste précédente
  resultsEl.innerHTML = '';
  resultsEl.classList.remove('visible');

  // Anti-race : on attache un identifiant unique sur le container ; quand le
  // résultat IPC revient, si l'identifiant a changé (= nouvelle recherche ou
  // réouverture de modale entre-temps), on abandonne ce résultat.
  const reqId = (resultsEl._searchReqId || 0) + 1;
  resultsEl._searchReqId = reqId;

  let res;
  try {
    res = await window.api.chercherCorrespondances(up);
  } catch (err) {
    if (resultsEl._searchReqId !== reqId) return;
    statusEl.className = 'search-status error';
    statusEl.textContent = t('searchNetworkError');
    return;
  }
  // Réponse tardive (modale fermée ou rouverte entre-temps) → ignorer
  if (resultsEl._searchReqId !== reqId) return;
  if (!res || !res.ok) {
    statusEl.className = 'search-status error';
    statusEl.textContent = (res && res.reason === 'no-data') ? t('oaDataMissing') : t('searchNotFound');
    return;
  }
  if (!res.matches || res.matches.length === 0) {
    statusEl.className = 'search-status error';
    statusEl.textContent = t('searchNotFound');
    return;
  }

  // Statut OK
  statusEl.className = 'search-status ok';
  statusEl.textContent = currentLang === 'fr'
    ? `${res.matches.length} résultat${res.matches.length > 1 ? 's' : ''}`
    : `${res.matches.length} result${res.matches.length > 1 ? 's' : ''}`;

  // Construire la liste avec radios
  const groupName = 'wp-search-' + Math.random().toString(36).slice(2, 9);
  resultsEl.innerHTML = '';
  res.matches.forEach((m, idx) => {
    const item = document.createElement('label');
    item.className = 'wp-result-item';
    const typeLabel = m.kind === 'airport' ? formatAirportType(m.type) : m.type;
    item.innerHTML = `
      <input type="radio" name="${groupName}" value="${idx}">
      <span class="wp-result-code">${escapeHtml(m.code)}</span>
      <span class="wp-result-type">${escapeHtml(typeLabel)}</span>
      <span class="wp-result-country">${escapeHtml(m.country || '—')}</span>
      <span class="wp-result-name">${escapeHtml(m.name || '')}</span>
    `;
    resultsEl.appendChild(item);
  });

  // Zone d'action avec bouton Sélectionner
  const actions = document.createElement('div');
  actions.className = 'wp-results-action';
  const btnSelect = document.createElement('button');
  btnSelect.className = 'btn-wp-select';
  btnSelect.textContent = t('btnSelectChoice');
  btnSelect.disabled = true;
  actions.appendChild(btnSelect);
  resultsEl.appendChild(actions);

  resultsEl.classList.add('visible');

  // Activer le bouton dès qu'un radio est coché
  resultsEl.querySelectorAll('input[type="radio"]').forEach(r => {
    r.addEventListener('change', () => { btnSelect.disabled = false; });
  });

  btnSelect.addEventListener('click', async () => {
    const checked = resultsEl.querySelector('input[type="radio"]:checked');
    if (!checked) return;
    const match = res.matches[parseInt(checked.value, 10)];
    if (!match) return;
    // Injection coordonnées
    latEl.value = Math.abs(match.lat).toFixed(6);
    lonEl.value = Math.abs(match.lon).toFixed(6);
    if (latRadioName) {
      const dir = match.lat >= 0 ? 'N' : 'S';
      const el = document.querySelector(`input[name="${latRadioName}"][value="${dir}"]`);
      if (el) el.checked = true;
    }
    if (lonRadioName) {
      const dir = match.lon >= 0 ? 'E' : 'W';
      const el = document.querySelector(`input[name="${lonRadioName}"][value="${dir}"]`);
      if (el) el.checked = true;
    }
    if (nameEl) {
      nameEl.value = match.code;
    }
    statusEl.className = 'search-status ok';
    statusEl.textContent = match.name || match.code;
    resultsEl.innerHTML = '';
    resultsEl.classList.remove('visible');

    // Question "Tour de piste prévu ?" — uniquement si activé par le caller
    // ET si le match est bien un aéroport
    if (opts.askPatternOnAirport && nameEl) {
      nameEl.dataset.pattern = ''; // reset par défaut
      if (match.kind === 'airport') {
        const yes = await askPatternModal(match.code);
        if (yes) nameEl.dataset.pattern = 'true';
      }
      // Notifier le caller pour qu'il puisse synchroniser son UI (checkbox)
      if (typeof opts.onPatternSet === 'function') {
        opts.onPatternSet(nameEl.dataset.pattern === 'true');
      }
    }
  });
}

// -------------------------------------------------------
// Calcule le prochain nom WP disponible (WP1, WP2, ...)
// -------------------------------------------------------
function prochainNomWP() {
  const nums = flightPlan
    .map(p => p.name)
    .filter(n => /^WP\d+$/i.test(n))
    .map(n => parseInt(n.replace(/^WP/i, ''), 10));
  const max = nums.length > 0 ? Math.max(...nums) : 0;
  return `WP${max + 1}`;
}


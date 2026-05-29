// ============================================================
// NavXpressVFR — info-modals.js
// Modales d'information aéroport / navaid (clic marqueur)  (extrait de ui.js — Phase 1)
// ============================================================

// -------------------------------------------------------
// Modale Détails d'un aéroport (clic sur un marqueur de la carte)
// -------------------------------------------------------

async function ouvrirInfoAeroport(ident) {
  if (!ident) return;
  const overlay = document.getElementById('airport-info-overlay');
  const codeEl = document.getElementById('airport-info-code');
  const nameEl = document.getElementById('airport-info-name');
  const typeEl = document.getElementById('airport-info-type');
  const genEl = document.getElementById('airport-info-general');
  const rwyEl = document.getElementById('airport-info-runways');
  const heliEl = document.getElementById('airport-info-helipads');
  const heliSection = document.getElementById('airport-info-helipads-section');
  const freqEl = document.getElementById('airport-info-frequencies');
  const cmtEl = document.getElementById('airport-info-comments');
  if (!overlay) return;

  // Loading state
  codeEl.textContent = '…';
  nameEl.textContent = currentLang === 'fr' ? 'Chargement…' : 'Loading…';
  typeEl.textContent = '';
  genEl.innerHTML = '<div class="ap-info-empty">…</div>';
  rwyEl.innerHTML = '';
  if (heliEl) heliEl.innerHTML = '';
  if (heliSection) heliSection.style.display = 'none';
  freqEl.innerHTML = '';
  cmtEl.innerHTML = '';
  overlay.classList.add('visible');

  let res;
  try {
    res = await window.api.detailsAeroport(ident);
  } catch (err) {
    nameEl.textContent = 'Error: ' + err.message;
    return;
  }
  if (!res || !res.ok) {
    nameEl.textContent = currentLang === 'fr'
      ? `Aéroport introuvable (${ident})`
      : `Airport not found (${ident})`;
    return;
  }

  const a = res.airport;
  // Code à afficher (mêmes règles que côté carte)
  const code = (a.icao_code && a.icao_code.trim())
    || (a.gps_code && a.gps_code.trim())
    || (a.local_code && a.local_code.trim())
    || a.ident || '';
  codeEl.textContent = code;
  nameEl.textContent = a.name || a.ident;
  typeEl.textContent = formatAirportType(a.type);

  // --- Général ---
  const lat = parseFloat(a.latitude_deg);
  const lon = parseFloat(a.longitude_deg);
  const elev = a.elevation_ft;

  // ICAO affiché : si le champ icao_code est vide MAIS que le code résolu
  // est composé de 4 lettres uniquement (ex: LFNN dans gps_code, Narbonne),
  // on l'utilise comme ICAO. Les codes du type 2 lettres + 4 chiffres
  // (ex: LF1923 ULM) ne matchent pas ce filtre — comportement inchangé.
  let icaoAffiche = (a.icao_code && a.icao_code.trim()) || '';
  if (!icaoAffiche && /^[A-Za-z]{4}$/.test(code)) {
    icaoAffiche = code;
  }

  const rowsGen = [
    [currentLang === 'fr' ? 'ICAO' : 'ICAO', escapeHtml(icaoAffiche || '—')],
    ['Ident', escapeHtml(a.ident || '—')],
    [currentLang === 'fr' ? 'Région' : 'Region', escapeHtml(a.iso_region || '—')],
    ['Lat', Number.isFinite(lat) ? lat.toFixed(6) + '°' : '—'],
    ['Lon', Number.isFinite(lon) ? lon.toFixed(6) + '°' : '—'],
    [currentLang === 'fr' ? 'Élévation' : 'Elevation', elev ? `${elev} ft` : '—'],
    [currentLang === 'fr' ? 'Vol commercial' : 'Scheduled service',
    a.scheduled_service === 'yes' ? (currentLang === 'fr' ? 'Oui' : 'Yes') : (currentLang === 'fr' ? 'Non' : 'No')],
  ];
  if (a.home_link) rowsGen.push(['Web', `<a class="ap-info-link" href="${escapeHtml(a.home_link)}" target="_blank" rel="noopener">${escapeHtml(a.home_link)}</a>`]);
  if (a.wikipedia_link) rowsGen.push(['Wikipedia', `<a class="ap-info-link" href="${escapeHtml(a.wikipedia_link)}" target="_blank" rel="noopener">${escapeHtml(a.wikipedia_link)}</a>`]);
  if (a.keywords) rowsGen.push([currentLang === 'fr' ? 'Mots-clés' : 'Keywords', escapeHtml(a.keywords)]);
  genEl.innerHTML = buildKVTable(rowsGen);

  // --- Pistes ---
  if (!res.runways || res.runways.length === 0) {
    rwyEl.innerHTML = `<div class="ap-info-empty">${currentLang === 'fr' ? 'Aucune piste référencée' : 'No runway data'}</div>`;
  } else {
    const head = currentLang === 'fr'
      ? '<tr><th>Désignation</th><th>Long.</th><th>Larg.</th><th>Surface</th><th>Cap (°vrai)</th><th>Bal.</th><th>État</th></tr>'
      : '<tr><th>Designation</th><th>Length</th><th>Width</th><th>Surface</th><th>Hdg (°true)</th><th>Lit</th><th>Status</th></tr>';
    const rows = res.runways.map(r => {
      const name = r.le_ident + (r.he_ident ? '/' + r.he_ident : '');
      // Cap vrai des DEUX extrémités : le cap fourni (le_) + son opposé (+180°)
      let heading = '—';
      if (Number.isFinite(r.headingDegT)) {
        const h1 = ((Math.round(r.headingDegT) % 360) + 360) % 360;
        const h2 = (h1 + 180) % 360;
        heading = String(h1).padStart(3, '0') + '° / ' + String(h2).padStart(3, '0') + '°';
      }
      const len = r.length_ft ? `${r.length_ft} ft` : '—';
      const wid = r.width_ft ? `${r.width_ft} ft` : '—';
      const status = r.closed
        ? `<span style="color:#ff5252;">${currentLang === 'fr' ? 'Fermée' : 'Closed'}</span>`
        : `<span style="color:#00e676;">${currentLang === 'fr' ? 'Active' : 'Active'}</span>`;
      const lit = r.lighted ? (currentLang === 'fr' ? 'Oui' : 'Yes') : (currentLang === 'fr' ? 'Non' : 'No');
      return `<tr><td>${escapeHtml(name)}</td><td>${len}</td><td>${wid}</td><td>${escapeHtml(r.surface || '—')}</td><td>${heading}</td><td>${lit}</td><td>${status}</td></tr>`;
    }).join('');
    rwyEl.innerHTML = `<table class="ap-info-table"><thead>${head}</thead><tbody>${rows}</tbody></table>`;
  }

  // --- Hélipads --- (section masquée s'il n'y en a aucun)
  const helipads = Array.isArray(res.helipads) ? res.helipads : [];
  if (heliSection && heliEl) {
    if (helipads.length === 0) {
      heliSection.style.display = 'none';
      heliEl.innerHTML = '';
    } else {
      heliSection.style.display = '';
      const hHead = currentLang === 'fr'
        ? '<tr><th>#</th><th>Long.</th><th>Larg.</th><th>Surface</th><th>Cap (°vrai)</th><th>Élév.</th></tr>'
        : '<tr><th>#</th><th>Length</th><th>Width</th><th>Surface</th><th>Hdg (°true)</th><th>Elev.</th></tr>';
      const hRows = helipads.map((h, i) => {
        let heading = '—';
        if (Number.isFinite(h.headingDegT)) {
          const hh = ((Math.round(h.headingDegT) % 360) + 360) % 360;
          heading = String(hh).padStart(3, '0') + '°';
        }
        const len = h.length_ft ? `${h.length_ft} ft` : '—';
        const wid = h.width_ft ? `${h.width_ft} ft` : '—';
        const elev = Number.isFinite(h.elevation_ft) ? `${h.elevation_ft} ft` : '—';
        return `<tr><td>H${i + 1}</td><td>${len}</td><td>${wid}</td><td>${escapeHtml(h.surface || '—')}</td><td>${heading}</td><td>${elev}</td></tr>`;
      }).join('');
      heliEl.innerHTML = `<table class="ap-info-table"><thead>${hHead}</thead><tbody>${hRows}</tbody></table>`;
    }
  }

  // --- Fréquences ---
  if (!res.frequencies || res.frequencies.length === 0) {
    freqEl.innerHTML = `<div class="ap-info-empty">${currentLang === 'fr' ? 'Aucune fréquence référencée' : 'No frequency data'}</div>`;
  } else {
    const head = currentLang === 'fr'
      ? '<tr><th>Type</th><th>Description</th><th>MHz</th></tr>'
      : '<tr><th>Type</th><th>Description</th><th>MHz</th></tr>';
    const rows = res.frequencies.map(f =>
      `<tr><td>${escapeHtml(f.type)}</td><td>${escapeHtml(f.description)}</td><td>${escapeHtml(f.frequency_mhz)}</td></tr>`
    ).join('');
    freqEl.innerHTML = `<table class="ap-info-table"><thead>${head}</thead><tbody>${rows}</tbody></table>`;
  }

  // --- Commentaires ---
  if (!res.comments || res.comments.length === 0) {
    cmtEl.innerHTML = `<div class="ap-info-empty">${currentLang === 'fr' ? 'Aucun commentaire' : 'No comments'}</div>`;
  } else {
    cmtEl.innerHTML = res.comments.map(c => `
      <div class="ap-info-comment">
        <div class="ap-info-comment-head">
          <span class="ap-info-comment-author">${escapeHtml(c.author || '?')}</span>
          <span>${escapeHtml(c.date || '')}</span>
        </div>
        ${c.subject ? `<div class="ap-info-comment-subject">${escapeHtml(c.subject)}</div>` : ''}
        <div class="ap-info-comment-body">${escapeHtml(c.body || '')}</div>
      </div>
    `).join('');
  }
}

function fermerInfoAeroport() {
  const overlay = document.getElementById('airport-info-overlay');
  if (overlay) overlay.classList.remove('visible');
}

// -------------------------------------------------------
// Modale Détails d'un navaid (clic sur un marqueur)
// -------------------------------------------------------
function formatNavaidFreqGlobal(type, freqKhz) {
  const v = parseFloat(freqKhz);
  if (!v || !Number.isFinite(v) || v <= 0) return '—';
  if (type === 'NDB' || type === 'NDB-DME') return Math.round(v) + ' kHz';
  return (v / 1000).toFixed(2) + ' MHz';
}

async function ouvrirInfoNavaid(id) {
  if (!id) return;
  const overlay = document.getElementById('navaid-info-overlay');
  const identEl = document.getElementById('navaid-info-ident');
  const nameEl = document.getElementById('navaid-info-name');
  const typeEl = document.getElementById('navaid-info-type');
  const tableEl = document.getElementById('navaid-info-table');
  if (!overlay) return;

  identEl.textContent = '…';
  nameEl.textContent = currentLang === 'fr' ? 'Chargement…' : 'Loading…';
  typeEl.textContent = '';
  tableEl.innerHTML = '';
  overlay.classList.add('visible');

  let res;
  try { res = await window.api.detailsNavaid(id); }
  catch (err) {
    nameEl.textContent = 'Error: ' + err.message;
    return;
  }
  if (!res || !res.ok) {
    nameEl.textContent = currentLang === 'fr' ? 'Navaid introuvable' : 'Navaid not found';
    return;
  }

  const n = res.navaid;
  identEl.textContent = n.ident || '—';
  nameEl.textContent = n.name || '—';
  typeEl.textContent = n.type || '';

  const lat = parseFloat(n.latitude_deg);
  const lon = parseFloat(n.longitude_deg);

  const rows = [
    [currentLang === 'fr' ? 'Nom' : 'Name', escapeHtml(n.name || '—')],
    ['Ident', escapeHtml(n.ident || '—')],
    [currentLang === 'fr' ? 'Type' : 'Type', escapeHtml(n.type || '—')],
    [currentLang === 'fr' ? 'Fréquence' : 'Frequency', escapeHtml(formatNavaidFreqGlobal(n.type, n.frequency_khz))],
    [currentLang === 'fr' ? 'Pays' : 'Country', escapeHtml(n.iso_country || '—')],
    ['Latitude', Number.isFinite(lat) ? lat.toFixed(6) + '°' : '—'],
    ['Longitude', Number.isFinite(lon) ? lon.toFixed(6) + '°' : '—'],
    [currentLang === 'fr' ? 'Élévation' : 'Elevation', n.elevation_ft ? `${n.elevation_ft} ft` : '—'],
  ];
  tableEl.innerHTML = buildKVTable(rows);
}

function fermerInfoNavaid() {
  const overlay = document.getElementById('navaid-info-overlay');
  if (overlay) overlay.classList.remove('visible');
}

// Câblages globaux (boutons fermeture / overlay)
document.addEventListener('DOMContentLoaded', () => {
  // Modale aéroport
  const overlayAp = document.getElementById('airport-info-overlay');
  const btnCloseAp = document.getElementById('btn-airport-info-close');
  if (btnCloseAp) btnCloseAp.addEventListener('click', fermerInfoAeroport);
  if (overlayAp) {
    overlayAp.addEventListener('click', (e) => {
      if (e.target === overlayAp) fermerInfoAeroport();
    });
  }
  // Modale navaid
  const overlayNv = document.getElementById('navaid-info-overlay');
  const btnCloseNv = document.getElementById('btn-navaid-info-close');
  if (btnCloseNv) btnCloseNv.addEventListener('click', fermerInfoNavaid);
  if (overlayNv) {
    overlayNv.addEventListener('click', (e) => {
      if (e.target === overlayNv) fermerInfoNavaid();
    });
  }
  // Escape ferme les deux
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (overlayAp && overlayAp.classList.contains('visible')) fermerInfoAeroport();
    if (overlayNv && overlayNv.classList.contains('visible')) fermerInfoNavaid();
  });
});

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
  const diagEl = document.getElementById('airport-info-diagram');
  const diagColLeft = document.getElementById('airport-info-col-left');
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
  if (diagEl) diagEl.innerHTML = '';
  if (diagColLeft) diagColLeft.hidden = true;
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

  // --- Schéma des pistes (tracé géométrique depuis les seuils) ---
  if (diagEl && diagColLeft) {
    const svg = buildRunwayDiagram(res.runways, res.helipads);
    if (svg) {
      diagEl.innerHTML = svg;
      diagColLeft.hidden = false;
    } else {
      diagEl.innerHTML = '';
      diagColLeft.hidden = true;
    }
  }

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

// -------------------------------------------------------
// Schéma des pistes — SVG vectoriel à l'échelle, à partir des
// seuils géométriques (le_/he_latitude_deg) fournis par MSFS.
// Les pistes parallèles ont des coordonnées distinctes → pas de
// superposition. Projection équirectangulaire locale (échelle
// uniforme = angles préservés), nord en haut.
// -------------------------------------------------------
// Couleur/rendu d'une piste selon sa surface (label MSFS).
// paved=true → revêtue (axe + piano keys) ; sinon surface naturelle.
function rwySurfaceStyle(label) {
  const s = String(label || '').toLowerCase();
  if (/grass/.test(s)) return { fill: '#34663a', edge: '#5c8a5f', paved: false }; // herbe (short grass/grass) = vert
  if (/dirt|gravel|sand|shale|coral|turf|earth|mud/.test(s)) return { fill: '#6e5436', edge: '#9a7b50', paved: false }; // terre (dirt/gravel/sand/coral/shale/hard turf) = marron
  if (/water/.test(s)) return { fill: '#2970ff', edge: '#7da6ff', paved: false }; // eau = bleu
  if (/snow|ice/.test(s)) return { fill: '#22b8cc', edge: '#8fe6f2', paved: false }; // neige/glace = cyan
  if (!s || /unknown/.test(s)) return { fill: '#8a8f98', edge: '#c2c6cc', paved: false }; // surface inconnue = gris moyen
  // Par défaut : dur (concrete, asphalt, bitumin., tarmac, macadam, brick,
  // oil treated…) → gris bitume.
  return { fill: '#41464f', edge: '#cfd4db', paved: true };
}

function buildRunwayDiagram(runways, helipads) {
  const W = 360, H = 360, PAD = 30;
  const rwys = Array.isArray(runways) ? runways : [];
  const helis = Array.isArray(helipads) ? helipads : [];

  // Pistes exploitables : deux seuils géolocalisés.
  const usable = rwys.filter(r =>
    Number.isFinite(r.le_latitude_deg) && Number.isFinite(r.le_longitude_deg) &&
    Number.isFinite(r.he_latitude_deg) && Number.isFinite(r.he_longitude_deg));
  const heliPts = helis.filter(h =>
    Number.isFinite(h.latitude_deg) && Number.isFinite(h.longitude_deg));

  if (usable.length === 0 && heliPts.length === 0) return null;

  // Référence de projection = barycentre de tous les points.
  const all = [];
  usable.forEach(r => {
    all.push([r.le_latitude_deg, r.le_longitude_deg]);
    all.push([r.he_latitude_deg, r.he_longitude_deg]);
  });
  heliPts.forEach(h => all.push([h.latitude_deg, h.longitude_deg]));
  const lat0 = all.reduce((s, p) => s + p[0], 0) / all.length;
  const lon0 = all.reduce((s, p) => s + p[1], 0) / all.length;
  const cosL = Math.cos(lat0 * Math.PI / 180);
  const M_PER_DEG = 111320;
  const toM = (lat, lon) => ({ x: (lon - lon0) * M_PER_DEG * cosL, y: (lat - lat0) * M_PER_DEG });

  // Bornes en mètres.
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  const acc = (m) => { if (m.x < xmin) xmin = m.x; if (m.x > xmax) xmax = m.x; if (m.y < ymin) ymin = m.y; if (m.y > ymax) ymax = m.y; };
  const segs = usable.map(r => {
    const le = toM(r.le_latitude_deg, r.le_longitude_deg);
    const he = toM(r.he_latitude_deg, r.he_longitude_deg);
    acc(le); acc(he);
    return { le, he, r };
  });
  const hPts = heliPts.map(h => { const m = toM(h.latitude_deg, h.longitude_deg); acc(m); return { m, h }; });

  const drawW = W - 2 * PAD, drawH = H - 2 * PAD;
  const spanX = xmax - xmin, spanY = ymax - ymin;
  const sX = spanX > 1 ? drawW / spanX : Infinity;
  const sY = spanY > 1 ? drawH / spanY : Infinity;
  let scale = Math.min(sX, sY);
  if (!Number.isFinite(scale) || scale <= 0) scale = 0.05; // cas dégénéré (1 point)
  const contentW = spanX * scale, contentH = spanY * scale;
  const offX = PAD + (drawW - contentW) / 2;
  const offY = PAD + (drawH - contentH) / 2;
  const px = (m) => offX + (m.x - xmin) * scale;          // x écran
  const py = (m) => offY + (ymax - m.y) * scale;          // y écran (nord en haut)

  const parts = [];

  // Géométrie écran de chaque piste (axe + perpendiculaire unitaires).
  const drawn = segs.map(({ le, he, r }) => {
    const A = { x: px(le), y: py(le) };
    const B = { x: px(he), y: py(he) };
    let ax = B.x - A.x, ay = B.y - A.y;
    const len = Math.hypot(ax, ay) || 1;
    ax /= len; ay /= len;                 // axe unitaire
    const nx = -ay, ny = ax;              // perpendiculaire unitaire
    const mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
    const ang = Math.atan2(ay, ax);
    return { A, B, ax, ay, nx, ny, len, mid, ang, r };
  });

  // Largeur DESSINÉE : stylisée (lisible, pas à l'échelle réelle de la largeur)
  // mais plafonnée à ~78 % du plus petit écart perpendiculaire entre pistes
  // quasi-parallèles → elles ne fusionnent jamais visuellement.
  let maxW = 16;
  for (let i = 0; i < drawn.length; i++) {
    for (let j = i + 1; j < drawn.length; j++) {
      let da = Math.abs(drawn[i].ang - drawn[j].ang) % Math.PI;
      if (da > Math.PI / 2) da = Math.PI - da;     // 0 = parallèle
      if (da < 0.35) {                              // < ~20° → quasi-parallèles
        const dxm = drawn[j].mid.x - drawn[i].mid.x, dym = drawn[j].mid.y - drawn[i].mid.y;
        const perp = Math.abs(dxm * drawn[i].nx + dym * drawn[i].ny);
        if (perp > 0.5) maxW = Math.min(maxW, perp * 0.78);
      }
    }
  }
  maxW = Math.max(4, maxW);

  // Pistes : rectangle coloré selon la surface + marquages (revêtues : axe +
  // piano keys ; non revêtues : herbe/terre sans marquage).
  drawn.forEach(({ A, B, ax, ay, nx, ny, len, r }) => {
    const wM = (Number(r.width_ft) || 0) * 0.3048;
    // Largeur INDÉPENDANTE du zoom (sinon les pistes longues = traits plats),
    // légèrement proportionnelle à la largeur réelle, puis plafonnée anti-fusion.
    let wPx = wM > 0 ? wM / 4.2 : 11;
    wPx = Math.min(Math.max(8, Math.min(wPx, 14)), maxW);
    const hw = wPx / 2;
    const surf = rwySurfaceStyle(r.surface);
    const corners = [
      [A.x + nx * hw, A.y + ny * hw],
      [B.x + nx * hw, B.y + ny * hw],
      [B.x - nx * hw, B.y - ny * hw],
      [A.x - nx * hw, A.y - ny * hw],
    ].map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
    parts.push(`<polygon points="${corners}" fill="${surf.fill}" stroke="${surf.edge}" stroke-width="1" stroke-linejoin="round"/>`);

    const inset = Math.min(hw + 3, len * 0.16);
    if (surf.paved && wPx >= 6 && len > 26) {
      // Axe central pointillé blanc
      const sx = A.x + ax * inset, sy = A.y + ay * inset;
      const ex = B.x - ax * inset, ey = B.y - ay * inset;
      parts.push(`<line x1="${sx.toFixed(1)}" y1="${sy.toFixed(1)}" x2="${ex.toFixed(1)}" y2="${ey.toFixed(1)}" stroke="#eef0f3" stroke-width="1" stroke-dasharray="5 5" opacity="0.8"/>`);
      // Piano keys (marquage de seuil) aux deux extrémités
      const usableW = wPx * 0.78;
      const n = Math.max(4, Math.min(10, Math.round(usableW / 2.2)));
      const spacing = usableW / n;
      const sw = Math.max(0.8, spacing * 0.5);
      const keyLen = Math.min(len * 0.14, 13);
      const keyGap = Math.min(hw * 0.5, 3);
      [[A, ax, ay], [B, -ax, -ay]].forEach(([P, dx, dy]) => {
        const startx = P.x + dx * keyGap, starty = P.y + dy * keyGap;
        for (let i = 0; i < n; i++) {
          const t = -usableW / 2 + spacing * (i + 0.5);
          const x1 = startx + nx * t, y1 = starty + ny * t;
          const x2 = x1 + dx * keyLen, y2 = y1 + dy * keyLen;
          parts.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#eef0f3" stroke-width="${sw.toFixed(2)}" stroke-linecap="butt"/>`);
        }
      });
    } else if (!surf.paved && wPx >= 6 && len > 26) {
      // Surfaces naturelles : léger axe pour la lisibilité, sans marquage blanc.
      const sx = A.x + ax * inset, sy = A.y + ay * inset;
      const ex = B.x - ax * inset, ey = B.y - ay * inset;
      parts.push(`<line x1="${sx.toFixed(1)}" y1="${sy.toFixed(1)}" x2="${ex.toFixed(1)}" y2="${ey.toFixed(1)}" stroke="${surf.edge}" stroke-width="1" stroke-dasharray="3 6" opacity="0.55"/>`);
    }
  });

  // Hélipads : petit losange/carré + H.
  hPts.forEach(({ m, h }) => {
    const cx = px(m), cy = py(m), s = 6;
    parts.push(`<rect x="${(cx - s).toFixed(1)}" y="${(cy - s).toFixed(1)}" width="${(2 * s).toFixed(1)}" height="${(2 * s).toFixed(1)}" rx="1.5" fill="#1f2a3a" stroke="#5aa6ff" stroke-width="1.2"/>`);
    parts.push(`<text x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" fill="#8fc0ff" font-size="8" font-weight="700" text-anchor="middle" dominant-baseline="central">H</text>`);
  });

  // Étiquettes QFU aux deux extrémités (décalées vers l'extérieur de l'axe).
  const label = (m, other, txt) => {
    const x = px(m), y = py(m), ox = px(other), oy = py(other);
    let dx = x - ox, dy = y - oy;
    const d = Math.hypot(dx, dy) || 1;
    dx /= d; dy /= d;
    const lx = x + dx * 13, ly = y + dy * 13;
    return `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" fill="#eef0f3" font-size="10" font-weight="600" text-anchor="middle" dominant-baseline="central" paint-order="stroke" stroke="#10131a" stroke-width="2.5">${escapeHtml(txt)}</text>`;
  };
  segs.forEach(({ le, he, r }) => {
    if (r.le_ident) parts.push(label(le, he, r.le_ident));
    if (r.he_ident) parts.push(label(he, le, r.he_ident));
  });

  // Rose des vents (nord en haut).
  const nx = W - 16, ny = 18;
  parts.push(`<line x1="${nx}" y1="${ny + 10}" x2="${nx}" y2="${ny - 8}" stroke="#5aa6ff" stroke-width="1.4"/>`);
  parts.push(`<path d="M ${nx} ${ny - 11} L ${nx - 3.5} ${ny - 5} L ${nx + 3.5} ${ny - 5} Z" fill="#5aa6ff"/>`);
  parts.push(`<text x="${nx}" y="${ny + 19}" fill="#8fb4e8" font-size="8" font-weight="700" text-anchor="middle">N</text>`);

  return `<svg viewBox="0 0 ${W} ${H}" class="ap-rwy-diagram" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Runway layout">${parts.join('')}</svg>`;
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
    [currentLang === 'fr' ? 'Portée' : 'Range', Number.isFinite(parseFloat(n.range_nm)) ? `${parseFloat(n.range_nm)} NM` : '—'],
    [currentLang === 'fr' ? 'Région' : 'Region', escapeHtml(n.iso_region || '—')],
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

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
// NavXpressVFR — profil-vertical.js
// Profil vertical (relief GLOBE + altitude prévue)  (extrait de ui.js — Phase 1)
// DOIT être chargé APRÈS nav-log.js (IIFE qui enveloppe mettreAJourLogDeNav au parsing).
// ============================================================

// -------------------------------------------------------
// Profil vertical : relief GLOBE + altitude prévue le long du plan de vol
// -------------------------------------------------------
let _lastProfilVertical = null; // dernier résultat (pour re-rendu au resize)
let _vpRender = null;           // géométrie du dernier rendu (pour le survol relief)
let _vpSig = null;              // signature plan+altitudes du dernier calcul (anti-recalcul)

async function mettreAJourProfilVertical() {
  const host = document.getElementById('vertical-profile-graph');
  if (!host) return;

  if (!Array.isArray(flightPlan) || flightPlan.length < 2) {
    _lastProfilVertical = null;
    _vpSig = null;
    host.innerHTML = `<div class="vp-empty">${escapeHtml(t('vertProfileEmpty'))}</div>`;
    return;
  }

  // Anti-recalcul : tant que le plan et les altitudes n'ont pas changé, on
  // re-rend depuis le cache (couvre les changements de langue / leg actif sans
  // ré-échantillonner le relief, couloir inclus).
  const sig = JSON.stringify({
    w: flightPlan.map(p => [p.lat, p.lon, p.name]),
    a: legAltitudes.map(a => (a === undefined ? null : a)),
  });
  if (sig === _vpSig && _lastProfilVertical) {
    _renderProfilInto(host, _lastProfilVertical);
    return;
  }

  let res;
  try {
    res = await window.api.profilVertical({
      waypoints: flightPlan.map(p => ({ lat: p.lat, lon: p.lon, name: p.name })),
      legAltitudes: legAltitudes.map(a => (a === undefined ? null : a)),
    });
  } catch (e) {
    return;
  }

  if (!res || !res.ok || !Array.isArray(res.dist) || res.dist.length < 2) {
    _lastProfilVertical = null;
    _vpSig = null;
    host.innerHTML = `<div class="vp-empty">${escapeHtml(t('vertProfileNoData'))}</div>`;
    return;
  }

  _lastProfilVertical = res;
  _vpSig = sig;
  _renderProfilInto(host, res);
}

// Rend le résumé (sommet route + marge mini) puis le SVG dans le hôte, et
// (ré)attache le survol du relief. Centralisé car appelé au rafraîchissement,
// au resize et au re-rendu depuis le cache (innerHTML écrase le tooltip).
function _renderProfilInto(host, res) {
  host.innerHTML = renderProfileSummary(res) + renderProfileSVG(res);
  _attachProfileHover(host);
}

// Bandeau texte au-dessus du graphe : point culminant de la route (relief couloir)
// et marge mini réelle au-dessus du relief ; classe « alerte » si un leg passe
// sous son altitude de sécurité.
function renderProfileSummary(res) {
  const s = res && res.summary;
  if (!s) return '';
  let txt = `${t('vertProfileSummit')} ${s.summitFt} ft`;
  if (s.minMargin) txt += ` · ${t('vertProfileMinMargin')} ${s.minMargin.clearanceFt} ft`;
  const cls = s.anyBreach ? 'vp-summary vp-summary-warn' : 'vp-summary';
  return `<div class="${cls}">${escapeHtml(txt)}${s.anyBreach ? ' ⚠' : ''}</div>`;
}

// Construit le SVG du profil (terrain rempli + altitude prévue + noms waypoints).
function renderProfileSVG(res) {
  const host = document.getElementById('vertical-profile-graph');
  const W = Math.max(320, (host && host.clientWidth) || 600);
  const H = 168;
  const m = { l: 46, r: 12, t: 12, b: 28 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;

  const dist = res.dist, terr = res.terrain, plan = res.planned;
  const totalNM = res.totalNM || dist[dist.length - 1] || 1;

  let yMax = 0;
  for (const v of terr) if (v > yMax) yMax = v;
  for (const v of plan) if (v > yMax) yMax = v;
  if (Array.isArray(res.legs)) for (const lg of res.legs) if (lg.safeAltFt > yMax) yMax = lg.safeAltFt;
  yMax = Math.max(1000, yMax * 1.12);
  yMax = Math.ceil(yMax / 500) * 500;

  const X = d => m.l + (d / totalNM) * iw;
  const Y = ft => m.t + ih - (Math.max(0, ft) / yMax) * ih;

  // Géométrie mémorisée pour les tooltips au survol (relief « sol » + alt. sécu/leg).
  _vpRender = { W, H, m, iw, ih, yMax, totalNM, dist, terr, legs: res.legs };

  // Aire du relief (du sol jusqu'à la courbe terrain)
  let area = `M ${X(dist[0]).toFixed(1)} ${Y(0).toFixed(1)}`;
  for (let i = 0; i < dist.length; i++) area += ` L ${X(dist[i]).toFixed(1)} ${Y(terr[i]).toFixed(1)}`;
  area += ` L ${X(dist[dist.length - 1]).toFixed(1)} ${Y(0).toFixed(1)} Z`;

  // Ligne sommet du relief
  let tline = '';
  for (let i = 0; i < dist.length; i++) tline += (i ? ' L ' : 'M ') + X(dist[i]).toFixed(1) + ' ' + Y(terr[i]).toFixed(1);

  // Ligne altitude prévue (en escalier par leg)
  let pline = '';
  for (let i = 0; i < dist.length; i++) pline += (i ? ' L ' : 'M ') + X(dist[i]).toFixed(1) + ' ' + Y(plan[i]).toFixed(1);

  // Altitude mini de sécurité par leg + alerte (alt. prévue sous la sécurité).
  // Ligne horizontale rouge par leg ; bande rouge translucide là où l'altitude
  // prévue passe sous cette ligne.
  let safeLines = '', breachBands = '';
  if (Array.isArray(res.legs)) {
    for (const lg of res.legs) {
      const x0 = X(lg.dStart), x1 = X(lg.dEnd), ys = Y(lg.safeAltFt);
      if (lg.breach) {
        const yp = Y(lg.plannedFt);
        breachBands += `<rect x="${x0.toFixed(1)}" y="${ys.toFixed(1)}" width="${(x1 - x0).toFixed(1)}" `
          + `height="${Math.max(0, yp - ys).toFixed(1)}" fill="#e53935" fill-opacity="0.22"/>`;
      }
      const col = lg.breach ? '#ff5252' : '#e53935';
      safeLines += `<line x1="${x0.toFixed(1)}" y1="${ys.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${ys.toFixed(1)}" `
        + `stroke="${col}" stroke-width="1.6"/>`;
    }
  }

  // Grille + libellés d'altitude (ft)
  let grid = '', ylabels = '';
  for (const yt of [0, yMax / 2, yMax]) {
    const yy = Y(yt).toFixed(1);
    grid += `<line x1="${m.l}" y1="${yy}" x2="${W - m.r}" y2="${yy}" stroke="#333" stroke-width="1"/>`;
    ylabels += `<text x="${m.l - 4}" y="${(Y(yt) + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="#999">${Math.round(yt)}</text>`;
  }

  // Marqueurs + noms des waypoints sur l'axe des distances
  let wpLines = '', wpLabels = '';
  const wps = res.waypoints || [];
  for (let i = 0; i < wps.length; i++) {
    const x = X(wps[i].d).toFixed(1);
    wpLines += `<line x1="${x}" y1="${m.t}" x2="${x}" y2="${m.t + ih}" stroke="#555" stroke-width="1" stroke-dasharray="2,3"/>`;
    const anchor = i === 0 ? 'start' : (i === wps.length - 1 ? 'end' : 'middle');
    const name = (wps[i].name || '').slice(0, 8);
    wpLabels += `<text x="${x}" y="${H - 14}" text-anchor="${anchor}" font-size="9" fill="#bbb">${escapeHtml(name)}</text>`;
  }

  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" xmlns="http://www.w3.org/2000/svg" `
    + `style="background:#141414;border:1px solid #2d2d2d;border-radius:4px">`
    + grid
    + breachBands
    + `<path d="${area}" fill="#3f5230" fill-opacity="0.85"/>`
    + `<path d="${tline}" fill="none" stroke="#7d9b53" stroke-width="1.2"/>`
    + wpLines
    + `<path d="${pline}" fill="none" stroke="#ffb300" stroke-width="1.6" stroke-dasharray="6,3"/>`
    + safeLines
    + grid_legend(W, m)
    + ylabels
    + wpLabels
    + `<text x="${m.l}" y="${m.t - 3}" font-size="9" fill="#777">ft</text>`
    + `</svg>`;
}

// Petite légende en haut à droite du graphe (relief / altitude prévue / sécurité).
function grid_legend(W, m) {
  const lx = W - m.r - 230;
  const y = m.t + 6;
  return `<line x1="${lx}" y1="${y}" x2="${lx + 14}" y2="${y}" stroke="#7d9b53" stroke-width="2"/>`
    + `<text x="${lx + 18}" y="${y + 3}" font-size="9" fill="#999">${escapeHtml(t('vertProfileTerrain'))}</text>`
    + `<line x1="${lx + 70}" y1="${y}" x2="${lx + 84}" y2="${y}" stroke="#ffb300" stroke-width="2" stroke-dasharray="5,3"/>`
    + `<text x="${lx + 88}" y="${y + 3}" font-size="9" fill="#999">${escapeHtml(t('vertProfilePlanned'))}</text>`
    + `<line x1="${lx + 150}" y1="${y}" x2="${lx + 164}" y2="${y}" stroke="#e53935" stroke-width="2"/>`
    + `<text x="${lx + 168}" y="${y + 3}" font-size="9" fill="#999">${escapeHtml(t('vertProfileSafe'))}</text>`;
}

// Altitude du relief (ft) interpolée linéairement à la distance d (NM), à partir
// des points (dist[], terr[]) du dernier rendu.
function _terrainAtDist(d) {
  if (!_vpRender) return null;
  const { dist, terr } = _vpRender;
  if (!dist || !terr || dist.length === 0) return null;
  const n = dist.length;
  if (d <= dist[0]) return terr[0];
  if (d >= dist[n - 1]) return terr[n - 1];
  for (let i = 1; i < n; i++) {
    if (d <= dist[i]) {
      const span = (dist[i] - dist[i - 1]) || 1;
      const f = (d - dist[i - 1]) / span;
      return terr[i - 1] + (terr[i] - terr[i - 1]) * f;
    }
  }
  return terr[n - 1];
}

// Leg sous la distance d (NM) au dernier rendu (pour le tooltip alt. de sécurité).
function _legAtDist(d) {
  if (!_vpRender || !Array.isArray(_vpRender.legs)) return null;
  const legs = _vpRender.legs;
  for (const lg of legs) if (d >= lg.dStart && d <= lg.dEnd) return lg;
  return legs.length ? legs[legs.length - 1] : null; // arrondis en bout de route
}

// (Ré)attache le tooltip de survol : altitude de sécurité du leg survolé (+ « sol »
// quand le curseur est sur la zone verte du relief).
function _attachProfileHover(host) {
  if (!host || !_vpRender) return;
  const svg = host.querySelector('svg');
  if (!svg) return;

  host.style.position = 'relative';

  // Tooltip recréé à chaque rendu (innerHTML a écrasé l'éventuel précédent).
  const tip = document.createElement('div');
  tip.className = 'vp-terrain-tooltip';
  tip.style.cssText = 'position:absolute;display:none;pointer-events:none;z-index:5;'
    + 'background:#1a1a1a;border:1px solid #555;color:#ddd;font-size:11px;line-height:1.35;'
    + 'padding:3px 7px;border-radius:4px;white-space:nowrap;transform:translate(-50%,-130%);';
  host.appendChild(tip);

  const { W, H, m, iw, ih, yMax, totalNM } = _vpRender;
  const Yof = ft => m.t + ih - (Math.max(0, ft) / yMax) * ih;

  function onMove(ev) {
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    // Coordonnées dans le repère du viewBox (W×H)
    const sx = (ev.clientX - rect.left) * (W / rect.width);
    const sy = (ev.clientY - rect.top) * (H / rect.height);
    const bottomY = m.t + ih;
    // Hors de la zone de tracé → rien.
    if (sx < m.l || sx > W - m.r || sy < m.t || sy > bottomY + 1) { tip.style.display = 'none'; return; }

    let d = ((sx - m.l) / iw) * totalNM;
    if (d < 0) d = 0; else if (d > totalNM) d = totalNM;

    // Ligne 1 : altitude de sécurité du leg survolé (rouge).
    const lg = _legAtDist(d);
    let html = '';
    if (lg) html += `<span style="color:#ff7b72">${escapeHtml(t('vertProfileSafeFull'))} : ${lg.safeAltFt} ft</span>`;

    // Ligne 2 : altitude prévue, seulement à proximité de la ligne pointillée du leg.
    if (lg && Math.abs(sy - Yof(lg.plannedFt)) <= 4) {
      html += `${html ? '<br>' : ''}<span style="color:#ffb300">${escapeHtml(t('vertProfilePlannedFull'))} : ${lg.plannedFt} ft</span>`;
    }

    // Ligne 3 : altitude sol, seulement quand le curseur est sur la zone verte.
    const elev = _terrainAtDist(d);
    if (elev != null) {
      const terrainTopY = Yof(elev);
      if (sy >= terrainTopY - 1) {
        html += `${html ? '<br>' : ''}<span style="color:#cfe0b4">${escapeHtml(t('vertProfileGround'))} ${Math.round(elev)} ft</span>`;
      }
    }

    if (!html) { tip.style.display = 'none'; return; }
    tip.innerHTML = html;
    tip.style.left = ((sx / W) * rect.width) + 'px';
    tip.style.top = ((sy / H) * rect.height) + 'px';
    tip.style.display = 'block';
  }
  function onLeave() { tip.style.display = 'none'; }

  svg.addEventListener('mousemove', onMove);
  svg.addEventListener('mouseleave', onLeave);
}

// Re-rendu (depuis le cache) quand la largeur de la fenêtre change
let _vpResizeTO = null;
window.addEventListener('resize', () => {
  clearTimeout(_vpResizeTO);
  _vpResizeTO = setTimeout(() => {
    const host = document.getElementById('vertical-profile-graph');
    if (host && _lastProfilVertical) _renderProfilInto(host, _lastProfilVertical);
  }, 200);
});

// Recalcule le profil après chaque rafraîchissement du log de nav
// (couvre aussi les retours anticipés : plan vide ou point unique).
(function () {
  const _origMajLogForProfile = mettreAJourLogDeNav;
  mettreAJourLogDeNav = function () {
    const r = _origMajLogForProfile.apply(this, arguments);
    if (typeof mettreAJourProfilVertical === 'function') mettreAJourProfilVertical();
    return r;
  };
})();

// Bouton Afficher / Masquer le bandeau profil vertical
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('btn-profil-toggle');
  const section = document.getElementById('vertical-profile-section');
  if (!btn || !section) return;
  btn.addEventListener('click', () => {
    const isHidden = section.style.display === 'none';
    if (isHidden) {
      section.style.display = '';
      btn.classList.add('active');
      // Re-rendu : la largeur était nulle tant que le bandeau était masqué
      if (typeof mettreAJourProfilVertical === 'function') mettreAJourProfilVertical();
    } else {
      section.style.display = 'none';
      btn.classList.remove('active');
    }
  });
});

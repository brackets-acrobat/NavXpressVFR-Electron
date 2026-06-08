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

async function mettreAJourProfilVertical() {
  const host = document.getElementById('vertical-profile-graph');
  if (!host) return;

  if (!Array.isArray(flightPlan) || flightPlan.length < 2) {
    _lastProfilVertical = null;
    host.innerHTML = `<div class="vp-empty">${escapeHtml(t('vertProfileEmpty'))}</div>`;
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
    host.innerHTML = `<div class="vp-empty">${escapeHtml(t('vertProfileNoData'))}</div>`;
    return;
  }

  _lastProfilVertical = res;
  host.innerHTML = renderProfileSVG(res);
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
  yMax = Math.max(1000, yMax * 1.12);
  yMax = Math.ceil(yMax / 500) * 500;

  const X = d => m.l + (d / totalNM) * iw;
  const Y = ft => m.t + ih - (Math.max(0, ft) / yMax) * ih;

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
    + `<path d="${area}" fill="#3f5230" fill-opacity="0.85"/>`
    + `<path d="${tline}" fill="none" stroke="#7d9b53" stroke-width="1.2"/>`
    + wpLines
    + `<path d="${pline}" fill="none" stroke="#ffb300" stroke-width="1.6" stroke-dasharray="6,3"/>`
    + grid_legend(W, m)
    + ylabels
    + wpLabels
    + `<text x="${m.l}" y="${m.t - 3}" font-size="9" fill="#777">ft</text>`
    + `</svg>`;
}

// Petite légende en haut à droite du graphe (relief / altitude prévue).
function grid_legend(W, m) {
  const lx = W - m.r - 150;
  const y = m.t + 6;
  return `<line x1="${lx}" y1="${y}" x2="${lx + 14}" y2="${y}" stroke="#7d9b53" stroke-width="2"/>`
    + `<text x="${lx + 18}" y="${y + 3}" font-size="9" fill="#999">${escapeHtml(t('vertProfileTerrain'))}</text>`
    + `<line x1="${lx + 70}" y1="${y}" x2="${lx + 84}" y2="${y}" stroke="#ffb300" stroke-width="2" stroke-dasharray="5,3"/>`
    + `<text x="${lx + 88}" y="${y + 3}" font-size="9" fill="#999">${escapeHtml(t('vertProfilePlanned'))}</text>`;
}

// Re-rendu (depuis le cache) quand la largeur de la fenêtre change
let _vpResizeTO = null;
window.addEventListener('resize', () => {
  clearTimeout(_vpResizeTO);
  _vpResizeTO = setTimeout(() => {
    const host = document.getElementById('vertical-profile-graph');
    if (host && _lastProfilVertical) host.innerHTML = renderProfileSVG(_lastProfilVertical);
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

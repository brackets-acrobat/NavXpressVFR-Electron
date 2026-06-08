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
// NavXpressVFR — nav-log.js
// Tableau de navigation (legs)  (extrait de ui.js — Phase 1)
// DOIT être chargé AVANT profil-vertical.js (décorateur de mettreAJourLogDeNav).
// ============================================================

// -------------------------------------------------------
// Redessine le tableau de navigation (legs)
// -------------------------------------------------------
function mettreAJourLogDeNav() {
  const tbody = document.getElementById('nav-log-body');
  if (!tbody) return;

  // Icône « Copier les points tournants » : visible seulement s'il existe au
  // moins un point tournant (plan de > 2 points : départ et arrivée exclus).
  const btnCopyWp = document.getElementById('btn-copy-waypoints');
  if (btnCopyWp) btnCopyWp.style.display = (flightPlan.length > 2) ? '' : 'none';

  // Ligne « totaux » (distance + durée) sous le tableau : masquée tant qu'il n'y
  // a pas au moins un leg (≥ 2 points).
  const totalsBox = document.getElementById('nav-log-totals');
  if (totalsBox) totalsBox.style.display = (flightPlan.length >= 2) ? '' : 'none';

  tbody.innerHTML = '';

  if (flightPlan.length === 0) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="12">${t('emptyPlan')}</td></tr>`;
    return;
  }

  const vp = parseFloat(document.getElementById('input-vp').value) || 90;
  const dirVent = parseFloat(document.getElementById('input-wind-dir').value) || 0;
  const vitVent = parseFloat(document.getElementById('input-wind-speed').value) || 0;

  // Cas : un seul point (départ uniquement)
  // Helper : nom du waypoint avec indicateur "Tour de piste" si applicable
  function _renderWpName(wp) {
    const name = escapeHtml(wp.name || '');
    if (wp.pattern) {
      return `${name} <span class="pattern-indicator" title="${escapeHtml(t('patternTooltip'))}"></span>`;
    }
    return name;
  }

  if (flightPlan.length === 1) {
    tbody.innerHTML = `
      <tr>
        <td>-</td>
        <td>${t('departure')}</td>
        <td>${_renderWpName(flightPlan[0])}</td>
        <td>-</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td>
        <td><input type="checkbox" disabled></td>
      </tr>`;
    return;
  }

  // Accumulateurs pour les totaux (distance + durée) affichés sous le tableau
  let sumDistanceNM = 0;
  let sumDurationSec = 0;

  // Boucle sur les legs
  for (let i = 1; i < flightPlan.length; i++) {
    const ptA = flightPlan[i - 1];
    const ptB = flightPlan[i];

    // 1. Distance (Haversine → NM)
    const R = 3440.065;
    const dLat = ((ptB.lat - ptA.lat) * Math.PI) / 180;
    const dLon = ((ptB.lon - ptA.lon) * Math.PI) / 180;
    const lat1Rad = (ptA.lat * Math.PI) / 180;
    const lat2Rad = (ptB.lat * Math.PI) / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1Rad) * Math.cos(lat2Rad);
    const distanceNM = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    // 2. Route vraie (Rv)
    const y = Math.sin(dLon) * Math.cos(lat2Rad);
    const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);
    let rvDeg = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;

    // 3. Triangle des vitesses (dérive + GS)
    const alphaRad = ((dirVent - rvDeg) * Math.PI) / 180;
    let deriveDeg = 0;
    if (vp > 0) {
      const sinX = (vitVent * Math.sin(alphaRad)) / vp;
      if (Math.abs(sinX) <= 1) deriveDeg = (Math.asin(sinX) * 180) / Math.PI;
    }
    const deriveRad = (deriveDeg * Math.PI) / 180;
    let gs = vp * Math.cos(deriveRad) - vitVent * Math.cos(alphaRad);
    if (gs < 0) gs = 0;

    // 4. Durée
    let tempsFormate = "--:--";
    if (gs > 0) {
      const totalSec = Math.round((distanceNM / gs) * 3600);
      const mm = Math.floor(totalSec / 60).toString().padStart(2, '0');
      const ss = (totalSec % 60).toString().padStart(2, '0');
      tempsFormate = `${mm}:${ss}`;
    }

    // Cumul de la distance pour le total
    sumDistanceNM += distanceNM;

    // Cumul de la durée TOTALE sans vent : basée uniquement sur la Vp
    // (le vent n'intervient pas, contrairement à la durée par leg ci-dessus).
    if (vp > 0) sumDurationSec += Math.round((distanceNM / vp) * 3600);

    // 5. Cap magnétique
    const capMagDeg = (rvDeg + deriveDeg - declinaisonMoyenneGlobale + 360) % 360;

    // 6. Détermination de l'état du leg
    const isDone = i < activeLegIndex;   // legs au-dessus du leg actif = terminés
    const isActive = i === activeLegIndex; // leg actif courant

    // 6b. Altitude du leg
    const altLeg = legAltitudes[i] ?? ALT_DEFAULT;

    // 7. Injection dans le tableau
    const row = document.createElement('tr');
    row.dataset.legIndex = i;

    // Construire le HTML d'abord
    row.innerHTML = `
      <td><b>${i}</b></td>
      <td>${_renderWpName(ptA)}</td>
      <td></td>
      <td>${_renderWpName(ptB)}</td>
      <td><span class="alt-val">${altLeg}</span> <button class="btn-edit-alt" onclick="window.ouvrirModaleAltitude(${i})" title="${currentLang === 'fr' ? 'Modifier l\'altitude' : 'Edit altitude'}">✏️</button></td>
      <td>${distanceNM.toFixed(1)}</td>
      <td>${Math.round(rvDeg).toString().padStart(3, '0')}°</td>
      <td>${Math.round(capMagDeg).toString().padStart(3, '0')}°</td>
      <td>${Math.round(gs)}</td>
      <td>${tempsFormate}</td>
      <td></td>
      <td></td>
    `;

    // Appliquer le style sur chaque td APRÈS innerHTML pour surpasser td { color } de styles.css
    if (isDone) {
      row.querySelectorAll('td').forEach(td => td.style.color = '#5d5d5d');
    } else if (isActive) {
      row.style.backgroundColor = '#4088DC';
      row.style.fontWeight = 'bold';
      row.querySelectorAll('td').forEach(td => td.style.color = '#ffff00');
    }

    // Bouton + dans la 3ème cellule (entre Depuis et Vers)
    const btnPlus = document.createElement('button');
    btnPlus.className = 'btn-insert-wp';
    btnPlus.textContent = '+';
    btnPlus.title = currentLang === 'fr' ? 'Insérer un point tournant' : 'Insert a waypoint';
    btnPlus.addEventListener('click', () => {
      // i = numéro du leg (1-based), l'insertion se fait à l'index i dans flightPlan
      // (entre flightPlan[i-1] et flightPlan[i])
      insertLegIndex = i;
      const nomWP = prochainNomWP();
      const icaoEl = document.getElementById('insert-wp-icao');
      icaoEl.value = nomWP;
      icaoEl.dataset.pattern = ''; // reset du flag tour de piste à chaque ouverture
      document.getElementById('insert-wp-lat').value = '';
      document.getElementById('insert-wp-lon').value = '';
      document.getElementById('insert-wp-error').textContent = '';
      document.getElementById('search-status-wp').textContent = '';
      document.getElementById('search-status-wp').className = 'search-status';
      const resWp = document.getElementById('search-results-wp');
      if (resWp) { resWp.innerHTML = ''; resWp.classList.remove('visible'); }
      const subtitle = document.getElementById('insert-wp-subtitle');
      subtitle.textContent = currentLang === 'fr'
        ? `Insertion entre ${ptA.name} et ${ptB.name}`
        : `Inserting between ${ptA.name} and ${ptB.name}`;
      // Affiche/cache le bouton "Coller les coordonnées de la carte" selon
      // qu'une copie est disponible en mémoire (coordsCopiees).
      if (typeof window.rafraichirBoutonsCollage === 'function') window.rafraichirBoutonsCollage();
      document.getElementById('insert-wp-overlay').classList.add('visible');
    });
    row.querySelectorAll('td')[2].appendChild(btnPlus);

    // Créer et insérer la checkbox
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = isDone;
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        activeLegIndex = i + 1;
      } else {
        activeLegIndex = i;
      }
      mettreAJourLogDeNav();
    });
    row.querySelector('td:nth-last-child(2)').appendChild(checkbox);

    // Bouton éditer leg — désactivé si le leg touche un aéroport fixe (1er ou dernier point)
    const toucheAeroport = (i === 1) || (i === flightPlan.length - 1);
    const btnEdit = document.createElement('button');
    btnEdit.className = 'btn-edit-leg';
    btnEdit.textContent = '✏️';
    btnEdit.title = currentLang === 'fr' ? 'Éditer ce leg' : 'Edit this leg';
    btnEdit.disabled = toucheAeroport;
    btnEdit.addEventListener('click', () => ouvrirModaleEditLeg(i));
    row.querySelector('td:last-child').appendChild(btnEdit);

    // Bouton supprimer leg — désactivé s'il ne reste que 2 points
    const canDelete = flightPlan.length > 2;
    const btnDelete = document.createElement('button');
    btnDelete.className = 'btn-delete-leg';
    btnDelete.textContent = '🗑️';
    btnDelete.title = currentLang === 'fr' ? 'Supprimer ce leg' : 'Delete this leg';
    btnDelete.disabled = !canDelete;
    btnDelete.addEventListener('click', () => ouvrirModaleDeleteLeg(i));
    row.querySelector('td:last-child').appendChild(btnDelete);

    tbody.appendChild(row);
  }

  // Mise à jour des totaux (distance + durée) sous le tableau, en temps réel.
  const elTotalDist = document.getElementById('nav-log-total-distance');
  const elTotalDur = document.getElementById('nav-log-total-duration');
  if (elTotalDist) elTotalDist.textContent = `${sumDistanceNM.toFixed(1)} nm`;
  if (elTotalDur) {
    const hh = Math.floor(sumDurationSec / 3600).toString().padStart(2, '0');
    const mm = Math.floor((sumDurationSec % 3600) / 60).toString().padStart(2, '0');
    const ss = (sumDurationSec % 60).toString().padStart(2, '0');
    elTotalDur.textContent = `${hh}:${mm}:${ss}`;
  }

  // Refléter l'état des legs (fait/actif/à faire) sur les segments de la carte
  if (typeof redessinerSegments === 'function') redessinerSegments();
}

// -------------------------------------------------------
// Bouton « Copier les points tournants » (à côté du titre du log de nav).
// Copie dans le presse-papier les noms des points tournants en MAJUSCULES,
// séparés par un espace — départ et arrivée (1er / dernier point) exclus.
// -------------------------------------------------------
function initCopyWaypoints() {
  const btn = document.getElementById('btn-copy-waypoints');
  if (!btn) return;
  btn.addEventListener('click', () => {
    if (!Array.isArray(flightPlan) || flightPlan.length <= 2) return;
    // Retire les accents/diacritiques (É→E, À→A, Ç→C…) pour compatibilité max :
    // décomposition NFD puis suppression des marques diacritiques combinantes.
    const _sansAccents = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
    const noms = flightPlan.slice(1, -1)
      .map(wp => _sansAccents(((wp && (wp.name || wp.ident)) || '').trim()).toUpperCase())
      .filter(Boolean);
    if (noms.length === 0) return;
    const txt = noms.join(' ');
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).catch(() => { });
      }
    } catch (_) { /* ignore */ }

    // Retour visuel : ✓ pendant ~1,2 s puis retour à l'icône.
    if (btn._copyTimer) clearTimeout(btn._copyTimer);
    btn.textContent = '✓';
    btn.classList.add('copied');
    btn._copyTimer = setTimeout(() => {
      btn.textContent = '📋';
      btn.classList.remove('copied');
      btn._copyTimer = null;
    }, 1200);
  });
}


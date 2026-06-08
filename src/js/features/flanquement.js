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
// NavXpressVFR — flanquement.js
// Flanquement VOR : trace un radial depuis une station VOR vers un point du
// plan de vol (point tournant) ou un repère visuel, avec une étiquette
// « R-090° / 12.3 NM » (radial MAGNÉTIQUE = QDR depuis la station + distance).
//
// Déclenchement : clic droit sur un VOR (map.js) → menu contextuel
// (map-context-menu.js) → item "Flanquement VOR" → window.ouvrirModaleFlanquement.
// L'utilisateur choisit une cible (bouton radio) dans la modale, valide, et le
// tracé apparaît. Plusieurs flanquements peuvent coexister ; chacun s'efface en
// cliquant dessus (confirmation).
//
// Persistés dans le plan .navxpv (cf. flightplan-io.js) : seules l'identité de
// la station + la géométrie sont sérialisées ; radial/distance sont recalculés
// au chargement (la déclinaison magnétique peut avoir changé). Tableau global
// `flanquements` défini dans globals.js.
//
// Ponts exposés :
//   window.ouvrirModaleFlanquement(navaid) — ouvre la modale de sélection
//   window.chargerFlanquements(arr)         — vide puis recrée depuis un snapshot
//   window.effacerTousFlanquements()        — retire tous les tracés de la carte
// ============================================================

function initFlanquement() {
  if (typeof map === 'undefined' || !map) return;

  // --- Réfs modale de sélection de cible ---
  const overlay = document.getElementById('flanquement-overlay');
  const vorIdentEl = document.getElementById('flanquement-vor-ident');
  const listEl = document.getElementById('flanquement-list');
  const emptyEl = document.getElementById('flanquement-empty');
  const errEl = document.getElementById('flanquement-error');
  const btnCancel = document.getElementById('btn-flanquement-cancel');
  const btnValidate = document.getElementById('btn-flanquement-validate');

  // --- Réfs modale de confirmation de suppression ---
  const delOverlay = document.getElementById('flanquement-delete-overlay');
  const delTextEl = document.getElementById('flanquement-delete-text');
  const btnDelNo = document.getElementById('btn-flanquement-delete-no');
  const btnDelYes = document.getElementById('btn-flanquement-delete-yes');

  let _pendingNavaid = null;   // VOR cliqué, en attente de choix de cible
  let _cibles = [];            // cibles affichées dans la modale (ordre = value radio)
  let _flanqASupprimer = null; // flanquement affiché dans la confirmation de suppression

  // -------------------------------------------------------
  // Géométrie (copiée localement, cf. map-measure.js)
  // -------------------------------------------------------
  function _distanceNM(lat1, lon1, lat2, lon2) {
    const R_NM = 3440.065;
    const toRad = d => d * Math.PI / 180;
    const φ1 = toRad(lat1);
    const φ2 = toRad(lat2);
    const Δφ = toRad(lat2 - lat1);
    const Δλ = toRad(lon2 - lon1);
    const a = Math.sin(Δφ / 2) ** 2
      + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R_NM * c;
  }

  // Relèvement initial grand-cercle (true bearing) DEPUIS la station vers la
  // cible, en degrés [0..360[.
  function _trueBearingDeg(lat1, lon1, lat2, lon2) {
    const toRad = d => d * Math.PI / 180;
    const toDeg = r => r * 180 / Math.PI;
    const φ1 = toRad(lat1);
    const φ2 = toRad(lat2);
    const Δλ = toRad(lon2 - lon1);
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2)
      - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  }

  // Radial affiché : entier dans [1..360] (un radial 000 se note 360).
  function _formatRadial(r) {
    const v = Math.round(r) % 360;
    return String(v === 0 ? 360 : v).padStart(3, '0');
  }

  // Portée pratique du VOR (alignée sur Little Navmap / volume de service basse
  // altitude) : 25 NM pour un VOR Terminal, 40 NM sinon. OurAirports ne contient
  // pas la « figure of merit » fine (High 130 NM), donc on s'en tient au volume
  // utile en VFR. usageType vient des détails du navaid (cf. _ouvrir).
  function _rangeForUsage(usageType) {
    return (usageType === 'TERMINAL') ? 25 : 40;
  }

  // -------------------------------------------------------
  // Création d'une entrée flanquement (calcule radial magnétique + distance)
  // rangeNM optionnel : si absent, dérivé de navaid.usageType (défaut 40).
  // -------------------------------------------------------
  function _creerFlanquement(navaid, cible, rangeNM) {
    const trueDeg = _trueBearingDeg(navaid.lat, navaid.lon, cible.lat, cible.lon);
    // Radial magnétique = relèvement vrai − déclinaison (Est positif).
    const radialMag = ((trueDeg - (declinaisonMoyenneGlobale || 0)) % 360 + 360) % 360;
    const distNM = _distanceNM(navaid.lat, navaid.lon, cible.lat, cible.lon);
    const range = (typeof rangeNM === 'number') ? rangeNM : _rangeForUsage(navaid.usageType);
    return {
      vorIdent: navaid.ident || '',
      vorLat: navaid.lat,
      vorLon: navaid.lon,
      targetName: cible.name || '',
      targetKind: cible.kind || 'waypoint',
      lat: cible.lat,
      lon: cible.lon,
      radialMag,
      distNM,
      rangeNM: range,
      line: null,
      label: null,
    };
  }

  // -------------------------------------------------------
  // Tracé d'un flanquement : ligne VOR→cible + étiquette « R-090° / 12.3 NM »
  // -------------------------------------------------------
  function _tracerFlanquement(f) {
    if (typeof L === 'undefined' || !f) return;

    // Longitude d'affichage de la cible « déroulée » par rapport au VOR, pour
    // franchir proprement l'antiméridien (la donnée stockée n'est pas modifiée).
    let tLon = f.lon;
    while (tLon - f.vorLon > 180) tLon -= 360;
    while (tLon - f.vorLon < -180) tLon += 360;

    const pVor = L.latLng(f.vorLat, f.vorLon);
    const pCible = L.latLng(f.lat, tLon);

    const line = L.polyline([pVor, pCible], {
      color: '#ff00cc',           // magenta vif, distinct des segments de route
      weight: 2,
      opacity: 0.9,
      dashArray: '6 5',
      className: 'flanquement-line',
      interactive: true,
    }).addTo(map);
    line.on('mouseover', () => { line.setStyle({ weight: 4 }); map.getContainer().style.cursor = 'pointer'; });
    line.on('mouseout', () => { line.setStyle({ weight: 2 }); map.getContainer().style.cursor = ''; });
    line.on('click', (e) => {
      if (e && e.originalEvent) L.DomEvent.stopPropagation(e);
      _ouvrirConfirmSuppr(f);
    });
    f.line = line;

    // Étiquette au milieu du tracé, orientée selon la ligne (cf. map-measure.js).
    const midLat = (pVor.lat + pCible.lat) / 2;
    const midLng = (pVor.lng + pCible.lng) / 2;
    const p1 = map.latLngToContainerPoint(pVor);
    const p2 = map.latLngToContainerPoint(pCible);
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    let angleDeg = Math.atan2(dy, dx) * 180 / Math.PI;
    if (angleDeg > 90) angleDeg -= 180;
    else if (angleDeg < -90) angleDeg += 180;

    // Décalage perpendiculaire vers le haut de l'écran (texte au-dessus du trait).
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    let perpX = -dy / len;
    let perpY = dx / len;
    if (perpY > 0) { perpX = -perpX; perpY = -perpY; }
    const OFFSET_PX = 12;
    const offX = perpX * OFFSET_PX;
    const offY = perpY * OFFSET_PX;
    const transform = `translate(${offX}px,${offY}px) translate(-50%,-50%) rotate(${angleDeg}deg)`;

    let text = `R-${_formatRadial(f.radialMag)}° / ${f.distNM.toFixed(1)} nm`;
    // Mention de portée si la cible dépasse le volume de service du VOR.
    if (Number.isFinite(f.rangeNM) && f.distNM > f.rangeNM) {
      text += ` (>${f.rangeNM}nm)`;
    }
    const label = L.marker([midLat, midLng], {
      icon: L.divIcon({
        className: 'flanquement-label',
        html: `<div class="flanquement-label-inner" style="transform:${transform}">${escapeHtml(text)}</div>`,
        iconSize: null,
        iconAnchor: [0, 0],
      }),
      interactive: false,
      keyboard: false,
    }).addTo(map);
    f.label = label;
  }

  function _retirerTrace(f) {
    if (!f) return;
    if (f.line) { try { map.removeLayer(f.line); } catch (_) { } f.line = null; }
    if (f.label) { try { map.removeLayer(f.label); } catch (_) { } f.label = null; }
  }

  // -------------------------------------------------------
  // Modale de sélection de cible
  // -------------------------------------------------------
  // Collecte les cibles possibles : tous les points du plan de vol, puis les
  // repères visuels.
  function _collecterCibles() {
    const out = [];
    if (Array.isArray(flightPlan)) {
      flightPlan.forEach((wp, i) => {
        if (!wp || typeof wp.lat !== 'number' || typeof wp.lon !== 'number') return;
        out.push({
          kind: 'waypoint',
          name: wp.name || wp.ident || ('WP' + i),
          lat: wp.lat,
          lon: wp.lon,
        });
      });
    }
    if (Array.isArray(reperesVisuels)) {
      reperesVisuels.forEach(r => {
        if (!r || typeof r.lat !== 'number' || typeof r.lon !== 'number') return;
        out.push({
          kind: 'repere',
          name: r.name || t('flanquementUnnamedRepere'),
          lat: r.lat,
          lon: r.lon,
        });
      });
    }
    return out;
  }

  function _construireListe() {
    listEl.innerHTML = '';
    let lastKind = null;
    _cibles.forEach((c, idx) => {
      // Séparateur de groupe (waypoints / repères)
      if (c.kind !== lastKind) {
        const head = document.createElement('div');
        head.className = 'flanquement-group-head';
        head.textContent = c.kind === 'repere'
          ? t('flanquementGroupReperes')
          : t('flanquementGroupWaypoints');
        listEl.appendChild(head);
        lastKind = c.kind;
      }
      const label = document.createElement('label');
      label.className = 'dt-wp-item';
      label.innerHTML = `
        <input type="radio" name="flanquement-cible" value="${idx}">
        <span class="dt-wp-index">${c.kind === 'repere' ? '◆' : '▲'}</span>
        <span class="dt-wp-name">${escapeHtml(c.name)}</span>`;
      listEl.appendChild(label);
    });
  }

  function _ouvrir(navaid) {
    if (!overlay || !navaid) return;
    _pendingNavaid = navaid;
    if (vorIdentEl) vorIdentEl.textContent = navaid.ident || '—';
    if (errEl) errEl.textContent = '';

    // Le navaid issu de la bbox carte ne porte pas usageType (→ portée). On le
    // récupère via le handler détails existant, en arrière-plan : le résultat est
    // mémorisé sur l'objet avant que l'utilisateur ne clique « Tracer » (défaut
    // 40 NM si la réponse n'est pas encore là).
    if (navaid.usageType === undefined && navaid.id != null
      && window.api && typeof window.api.detailsNavaid === 'function') {
      window.api.detailsNavaid(navaid.id)
        .then(res => {
          if (res && res.ok && res.navaid) navaid.usageType = res.navaid.usageType || '';
        })
        .catch(() => { });
    }

    _cibles = _collecterCibles();
    if (_cibles.length === 0) {
      if (listEl) listEl.innerHTML = '';
      if (emptyEl) emptyEl.style.display = '';
      if (btnValidate) btnValidate.disabled = true;
    } else {
      if (emptyEl) emptyEl.style.display = 'none';
      if (btnValidate) btnValidate.disabled = false;
      _construireListe();
    }
    overlay.classList.add('visible');
  }

  function _fermer() {
    if (overlay) overlay.classList.remove('visible');
    _pendingNavaid = null;
    _cibles = [];
  }

  function _valider() {
    if (!_pendingNavaid) { _fermer(); return; }
    const sel = listEl ? listEl.querySelector('input[name="flanquement-cible"]:checked') : null;
    if (!sel) {
      if (errEl) errEl.textContent = t('flanquementSelectRequired');
      return;
    }
    const cible = _cibles[parseInt(sel.value, 10)];
    if (!cible) { _fermer(); return; }
    const f = _creerFlanquement(_pendingNavaid, cible);
    flanquements.push(f);
    _tracerFlanquement(f);
    _fermer();
  }

  if (btnCancel) btnCancel.addEventListener('click', _fermer);
  if (btnValidate) btnValidate.addEventListener('click', _valider);
  if (overlay) {
    overlay.addEventListener('click', e => { if (e.target === overlay) _fermer(); });
  }

  // -------------------------------------------------------
  // Suppression d'un flanquement (avec confirmation)
  // -------------------------------------------------------
  function _ouvrirConfirmSuppr(f) {
    _flanqASupprimer = f;
    if (!delOverlay) {   // pas de modale → suppression directe (sécurité)
      _supprimer(f);
      return;
    }
    if (delTextEl && f) {
      delTextEl.textContent = t('flanquementDeleteText')
        .replace('{vor}', f.vorIdent || '?')
        .replace('{target}', f.targetName || '?');
    }
    delOverlay.classList.add('visible');
  }
  function _fermerConfirm() {
    if (delOverlay) delOverlay.classList.remove('visible');
    _flanqASupprimer = null;
  }
  function _supprimer(f) {
    if (!f) return;
    _retirerTrace(f);
    const idx = flanquements.indexOf(f);
    if (idx !== -1) flanquements.splice(idx, 1);
  }
  if (btnDelNo) btnDelNo.addEventListener('click', _fermerConfirm);
  if (btnDelYes) {
    btnDelYes.addEventListener('click', () => {
      _supprimer(_flanqASupprimer);
      _fermerConfirm();
    });
  }
  if (delOverlay) {
    delOverlay.addEventListener('click', e => { if (e.target === delOverlay) _fermerConfirm(); });
  }

  // Échap : ferme la confirmation puis la modale de sélection.
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (delOverlay && delOverlay.classList.contains('visible')) { _fermerConfirm(); return; }
    if (overlay && overlay.classList.contains('visible')) { _fermer(); }
  });

  // -------------------------------------------------------
  // API publique (ponts window)
  // -------------------------------------------------------
  function effacerTousFlanquements() {
    flanquements.forEach(f => _retirerTrace(f));
    flanquements = [];
  }

  function chargerFlanquements(arr) {
    effacerTousFlanquements();
    if (!Array.isArray(arr)) return;
    arr.forEach(item => {
      if (!item
        || typeof item.lat !== 'number' || typeof item.lon !== 'number'
        || typeof item.vorLat !== 'number' || typeof item.vorLon !== 'number') return;
      const navaid = { ident: item.vorIdent || '', lat: item.vorLat, lon: item.vorLon };
      const cible = {
        kind: item.targetKind || 'waypoint',
        name: item.targetName || '',
        lat: item.lat,
        lon: item.lon,
      };
      // Portée : réutilise la valeur sauvegardée (défaut 40 NM si absente, ex.
      // anciens plans). On recalcule radial/distance (déclinaison/géométrie).
      const rangeNM = (typeof item.rangeNM === 'number') ? item.rangeNM : 40;
      const f = _creerFlanquement(navaid, cible, rangeNM);
      flanquements.push(f);
      _tracerFlanquement(f);
    });
  }

  window.ouvrirModaleFlanquement = (navaid) => _ouvrir(navaid);
  window.chargerFlanquements = chargerFlanquements;
  window.effacerTousFlanquements = effacerTousFlanquements;
}

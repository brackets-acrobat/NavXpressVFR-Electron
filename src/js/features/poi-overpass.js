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
// NavXpressVFR — poi-overpass.js
// Points remarquables OpenStreetMap le long de la route (Overpass API).
//
// Déclenchement MANUEL (bouton dans le dropdown « Calques »). On interroge
// l'API Overpass sur la bbox de la route élargie, puis on filtre côté client
// pour ne garder que les objets à ≤ 5 NM de la polyligne du plan de vol.
// Possible directement depuis le renderer car webSecurity est désactivé
// (cf. main.js) → pas de blocage CORS, pas d'IPC.
//
// Rendu : même cercle que le repère visuel manuel (jaune / contour rouge)
// + un petit POINT NOIR central pour les distinguer. Tooltip au survol =
// nom (si connu) + type (château, viaduc, barrage…). Quatre couches par
// thème (Eau / Énergie / Transport / Patrimoine), persistées dans options.json.
//
// Cache « par plan » : les POI chargés sont sérialisés dans le .navxpv (cf.
// flightplan-io.js) → reconsultables hors-ligne sans nouvelle requête.
//
// Ponts exposés (menu Calques + flightplan-io + reset + i18n-toggle) :
//   window.chargerPOIRoute()        — bouton : requête Overpass + tracé
//   window.chargerPOISnapshot(arr)  — recrée depuis un snapshot .navxpv
//   window.serialiserPOI()          — snapshot pour la sauvegarde .navxpv
//   window.effacerTousPOI()         — retire tous les POI de la carte
//   window.setPoiThemeEnabled(theme, on)  — affiche/masque un thème (+persiste)
//   window.getPoiThemeStates()      — { eau, energie, transport, patrimoine }
//   window._refreshPoiTooltips()    — régénère les tooltips (changement langue)
// ============================================================

const POI_CORRIDOR_NM = 7.5;        // demi-largeur du couloir (défaut)
const POI_BBOX_MARGIN_NM = 9;       // marge bbox (un peu > couloir, filtré ensuite)
// Couloir plus serré pour certains types très denses (châteaux d'eau).
const POI_CORRIDOR_OVERRIDE = { poiTypeWaterTower: 3 };
// Plusieurs miroirs Overpass : l'instance principale est souvent saturée
// (429 / 504). On essaie les suivantes en cas d'échec.
const POI_OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
// Seuils de surface (anti-saturation) calculés sur la bounding box de l'objet.
const POI_AREA_MIN_M2 = { water: 50000, quarry: 50000 }; // 5 ha / 5 ha
// Regroupement par proximité : certains objets sont mappés en grappes (sorties
// d'un même échangeur, éoliennes d'un parc, cheminées d'un site). On les
// fusionne en un seul marqueur placé sur l'élément le plus central de la
// grappe. `count:true` → on indique le nombre d'éléments dans le tooltip.
const POI_CLUSTER = {
  poiTypeJunction: { radiusNM: 1.5, count: false },
  poiTypeWindTurbine: { radiusNM: 2, count: true },
  poiTypeChimney: { radiusNM: 2, count: true },
  poiTypeDam: { radiusNM: 1.5, count: false },
};
const POI_THEMES = ['eau', 'energie', 'transport', 'patrimoine'];

function initPoiOverpass() {
  if (typeof map === 'undefined' || !map) return;
  if (typeof L === 'undefined') return;

  // Une couche Leaflet par thème (ajoutée/retirée de la carte selon le toggle).
  const _groups = {
    eau: L.layerGroup(),
    energie: L.layerGroup(),
    transport: L.layerGroup(),
    patrimoine: L.layerGroup(),
  };

  // État des toggles, restauré depuis options.json (défaut : visible).
  const _opt = window.appOptions || {};
  const _enabled = {
    eau: _opt.poiThemeEau !== false,
    energie: _opt.poiThemeEnergie !== false,
    transport: _opt.poiThemeTransport !== false,
    patrimoine: _opt.poiThemePatrimoine !== false,
  };
  POI_THEMES.forEach(th => { if (_enabled[th]) _groups[th].addTo(map); });

  let _loading = false;

  // -------------------------------------------------------
  // Géométrie : distance d'un point à la polyligne du plan (NM)
  // Approximation équirectangulaire locale (suffisante à l'échelle d'un couloir).
  // -------------------------------------------------------
  function _distPtSegNM(plat, plon, alat, alon, blat, blon) {
    const lat0 = (alat + blat) / 2;
    const k = Math.cos(lat0 * Math.PI / 180);
    const ax = 0, ay = 0;
    const bx = (blon - alon) * 60 * k, by = (blat - alat) * 60;
    const px = (plon - alon) * 60 * k, py = (plat - alat) * 60;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let tt = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    if (tt < 0) tt = 0; else if (tt > 1) tt = 1;
    const cx = ax + tt * dx, cy = ay + tt * dy;
    return Math.hypot(px - cx, py - cy);
  }

  function _distToRouteNM(lat, lon) {
    if (!Array.isArray(flightPlan) || flightPlan.length === 0) return Infinity;
    if (flightPlan.length === 1) {
      const p = flightPlan[0];
      return _distPtSegNM(lat, lon, p.lat, p.lon, p.lat, p.lon);
    }
    let best = Infinity;
    for (let i = 1; i < flightPlan.length; i++) {
      const a = flightPlan[i - 1], b = flightPlan[i];
      const d = _distPtSegNM(lat, lon, a.lat, a.lon, b.lat, b.lon);
      if (d < best) best = d;
    }
    return best;
  }

  function _routeBbox() {
    let s = 90, n = -90, w = 180, e = -180;
    for (const p of flightPlan) {
      if (p.lat < s) s = p.lat;
      if (p.lat > n) n = p.lat;
      if (p.lon < w) w = p.lon;
      if (p.lon > e) e = p.lon;
    }
    const meanLat = (s + n) / 2;
    const dLat = POI_BBOX_MARGIN_NM / 60;
    const dLon = POI_BBOX_MARGIN_NM / (60 * Math.max(0.1, Math.cos(meanLat * Math.PI / 180)));
    return { s: s - dLat, w: w - dLon, n: n + dLat, e: e + dLon };
  }

  // Surface approximative (m²) à partir de la bounding box Overpass (`out bb`).
  // Sur-estime légèrement (rectangle englobant), suffisant comme filtre.
  function _bboxAreaM2(bounds) {
    if (!bounds) return NaN;
    const midLat = (bounds.minlat + bounds.maxlat) / 2;
    const hM = (bounds.maxlat - bounds.minlat) * 111320;
    const wM = (bounds.maxlon - bounds.minlon) * 111320 * Math.cos(midLat * Math.PI / 180);
    return Math.abs(hM * wM);
  }

  // Distance point↔point (NM), approximation équirectangulaire locale.
  function _ptDistNM(lat1, lon1, lat2, lon2) {
    const k = Math.cos((lat1 + lat2) / 2 * Math.PI / 180);
    const dx = (lon2 - lon1) * 60 * k, dy = (lat2 - lat1) * 60;
    return Math.hypot(dx, dy);
  }

  // Regroupe une liste de points (mêmes tags) en grappes par proximité
  // (single-pass autour d'un germe). Retourne un tableau de grappes (chaque
  // grappe = sous-tableau des points membres).
  function _clusterByRadius(pts, radiusNM) {
    const clusters = [];
    const used = new Array(pts.length).fill(false);
    for (let i = 0; i < pts.length; i++) {
      if (used[i]) continue;
      const members = [pts[i]];
      used[i] = true;
      for (let j = i + 1; j < pts.length; j++) {
        if (used[j]) continue;
        if (_ptDistNM(pts[i].lat, pts[i].lon, pts[j].lat, pts[j].lon) <= radiusNM) {
          members.push(pts[j]);
          used[j] = true;
        }
      }
      clusters.push(members);
    }
    return clusters;
  }

  // Élément le plus central d'une grappe (le plus proche du barycentre).
  function _centralMember(members) {
    if (members.length === 1) return members[0];
    let cLat = 0, cLon = 0;
    for (const m of members) { cLat += m.lat; cLon += m.lon; }
    cLat /= members.length; cLon /= members.length;
    let best = members[0], bestD = Infinity;
    for (const m of members) {
      const d = _ptDistNM(cLat, cLon, m.lat, m.lon);
      if (d < bestD) { bestD = d; best = m; }
    }
    return best;
  }

  // -------------------------------------------------------
  // Hauteur d'un objet (m) à partir des tags OSM, ou NaN si absente.
  // -------------------------------------------------------
  function _height(tags) {
    const raw = tags.height || tags['tower:height'] || tags.est_height;
    if (!raw) return NaN;
    return parseFloat(String(raw).replace(',', '.'));
  }

  // -------------------------------------------------------
  // Classement d'un objet OSM → { theme, typeKey } ou null (ignoré).
  // Applique aussi les seuils de hauteur (anti-saturation) sur les
  // catégories bruyantes (éoliennes, antennes, cheminées).
  // -------------------------------------------------------
  function _classify(tags) {
    if (!tags) return null;

    // --- Eau ---
    if (tags.waterway === 'dam') return { theme: 'eau', typeKey: 'poiTypeDam' };
    if (tags.man_made === 'lighthouse') return { theme: 'eau', typeKey: 'poiTypeLighthouse' };
    if (tags.waterway === 'river') return { theme: 'eau', typeKey: 'poiTypeRiver' };
    if (tags.natural === 'water') {
      const w = tags.water;
      if (w === 'reservoir' || w === 'basin') return { theme: 'eau', typeKey: 'poiTypeReservoir' };
      if (w === 'river' || w === 'stream' || w === 'canal') return null; // pas un plan d'eau
      return { theme: 'eau', typeKey: 'poiTypeLake' };
    }

    // --- Énergie ---
    if (tags.man_made === 'cooling_tower') return { theme: 'energie', typeKey: 'poiTypeCoolingTower' };
    if (tags.man_made === 'chimney') {
      const h = _height(tags);
      if (Number.isFinite(h) && h < 50) return null; // petite cheminée → bruit
      return { theme: 'energie', typeKey: 'poiTypeChimney' };
    }
    if (tags.power === 'plant') {
      // Les parcs éoliens sont représentés par leurs éoliennes (regroupées) →
      // on ignore le polygone du parc pour éviter le doublon.
      if (/wind/.test(tags['plant:source'] || '')) return null;
      return { theme: 'energie', typeKey: 'poiTypePowerPlant' };
    }
    if (tags.power === 'generator' && /wind/.test(tags['generator:source'] || '')) {
      // Pas de filtre de hauteur : le regroupement par proximité (2 NM) suffit
      // à éviter la saturation, et une éolienne isolée reste un repère.
      return { theme: 'energie', typeKey: 'poiTypeWindTurbine' };
    }

    // --- Transport ---
    if (tags.highway === 'motorway_junction') {
      // Exclure les aires de repos / de service (faux échangeurs).
      if (/\baire\b/i.test(tags.name || '')) return null;
      return { theme: 'transport', typeKey: 'poiTypeJunction' };
    }
    if (tags.bridge === 'viaduct' || tags.man_made === 'bridge') return { theme: 'transport', typeKey: 'poiTypeViaduct' };

    // --- Patrimoine / repères ---
    if (tags.man_made === 'water_tower') return { theme: 'patrimoine', typeKey: 'poiTypeWaterTower' };
    if (tags.landuse === 'quarry') return { theme: 'patrimoine', typeKey: 'poiTypeQuarry' };
    if (tags.historic === 'castle') return { theme: 'patrimoine', typeKey: 'poiTypeCastle' };
    if (tags.historic === 'fort') return { theme: 'patrimoine', typeKey: 'poiTypeFort' };
    if (tags.man_made === 'mast' || tags.man_made === 'tower' || tags.man_made === 'antenna') {
      const h = _height(tags);
      if (!Number.isFinite(h) || h < 50) return null; // garder uniquement les grands pylônes
      return { theme: 'patrimoine', typeKey: 'poiTypeAntenna' };
    }

    return null;
  }

  // -------------------------------------------------------
  // Construction de la requête Overpass (bbox globale + statements filtrés
  // côté serveur quand c'est possible — surfaces de lacs/carrières).
  // -------------------------------------------------------
  function _buildQuery(bb) {
    const bbox = `${bb.s},${bb.w},${bb.n},${bb.e}`;
    // L'instance publique n'expose pas la fonction area() → le filtrage de
    // surface (lacs / carrières) est fait côté client via la bounding box
    // demandée par `out ... bb`.
    return `[out:json][timeout:90][bbox:${bbox}];
(
  way["natural"="water"];
  relation["natural"="water"];
  nwr["waterway"="dam"];
  nwr["man_made"="lighthouse"];
  relation["waterway"="river"]["name"];
  nwr["power"="plant"];
  node["power"="generator"]["generator:source"="wind"];
  nwr["man_made"="cooling_tower"];
  nwr["man_made"="chimney"];
  nwr["man_made"="water_tower"];
  way["landuse"="quarry"];
  relation["landuse"="quarry"];
  node["highway"="motorway_junction"]["name"];
  way["bridge"="viaduct"];
  nwr["historic"="castle"];
  nwr["historic"="fort"];
  node["man_made"="mast"]["tower:type"="communication"];
  node["man_made"="tower"]["tower:type"="communication"];
  node["man_made"="antenna"];
);
out center bb tags qt;`;
  }

  // -------------------------------------------------------
  // Tracé d'un POI : cercle (idem repère manuel) + point noir central.
  // -------------------------------------------------------
  function _tooltipHtml(poi) {
    let typeLabel = t(poi.typeKey);
    // Grappes (éoliennes / cheminées) : on indique le nombre d'éléments.
    if (poi.count && poi.count > 1) typeLabel += ' (×' + poi.count + ')';
    if (poi.name) {
      return `<div class="repere-tooltip-name">${escapeHtml(poi.name)}</div>` +
        `<div class="repere-tooltip-desc">${escapeHtml(typeLabel)}</div>`;
    }
    // Sans nom : le type devient la ligne principale.
    return `<div class="repere-tooltip-name">${escapeHtml(typeLabel)}</div>`;
  }

  function _dessinerPOI(poi) {
    const grp = _groups[poi.theme];
    if (!grp) return;
    const outer = L.circleMarker([poi.lat, poi.lon], {
      radius: 5,
      color: '#e53935',     // contour rouge (idem repère manuel)
      weight: 2,
      fillColor: '#ffeb3b', // remplissage jaune
      fillOpacity: 1,
      opacity: 1,
      className: 'poi-marker',
      interactive: true,
    });
    const dot = L.circleMarker([poi.lat, poi.lon], {
      radius: 1.6,          // petit point noir central distinctif
      color: '#000',
      weight: 0,
      fillColor: '#000',
      fillOpacity: 1,
      opacity: 1,
      interactive: false,
    });
    outer.bindTooltip(_tooltipHtml(poi), {
      direction: 'top',
      offset: [0, -8],
      className: 'repere-tooltip poi-tooltip',
      opacity: 1,
      sticky: false,
    });
    outer.addTo(grp);
    dot.addTo(grp);
    poi._outer = outer;
    poi._dot = dot;
  }

  function _redessinerTout() {
    POI_THEMES.forEach(th => _groups[th].clearLayers());
    for (const poi of poisRemarquables) _dessinerPOI(poi);
  }

  // -------------------------------------------------------
  // Bouton « Charger » : requête Overpass + filtrage + tracé
  // -------------------------------------------------------
  async function chargerPOIRoute() {
    if (_loading) return;
    if (!Array.isArray(flightPlan) || flightPlan.length < 2) {
      showToast(t('poiNeedPlan'), 'error');
      return;
    }
    _loading = true;
    showToast(t('poiLoading'), 'info', 4000);

    const query = _buildQuery(_routeBbox());
    const body = 'data=' + encodeURIComponent(query);
    let json = null;
    for (const url of POI_OVERPASS_URLS) {
      try {
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body,
        });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        json = await resp.json();
        break; // succès → on arrête de parcourir les miroirs
      } catch (err) {
        console.warn('[POI] Échec Overpass', url, ':', err);
      }
    }
    if (!json) {
      showToast(t('poiError'), 'error', 4000);
      _loading = false;
      return;
    }

    const elements = (json && json.elements) || [];

    // 1) Objets bruts retenus (classés + surface + couloir), groupés par type.
    const parType = {};
    for (const el of elements) {
      const lat = el.lat != null ? el.lat : (el.center && el.center.lat);
      const lon = el.lon != null ? el.lon : (el.center && el.center.lon);
      if (typeof lat !== 'number' || typeof lon !== 'number') continue;
      const cls = _classify(el.tags);
      if (!cls) continue;
      // Filtrage de surface (anti-saturation) sur lacs/réservoirs/carrières.
      if (cls.typeKey === 'poiTypeLake' || cls.typeKey === 'poiTypeReservoir') {
        if (_bboxAreaM2(el.bounds) < POI_AREA_MIN_M2.water) continue;
      } else if (cls.typeKey === 'poiTypeQuarry') {
        if (_bboxAreaM2(el.bounds) < POI_AREA_MIN_M2.quarry) continue;
      }
      const corr = POI_CORRIDOR_OVERRIDE[cls.typeKey] || POI_CORRIDOR_NM;
      if (_distToRouteNM(lat, lon) > corr) continue;
      (parType[cls.typeKey] || (parType[cls.typeKey] = [])).push({
        lat, lon,
        name: (el.tags && el.tags.name) || '',
        theme: cls.theme,
        typeKey: cls.typeKey,
      });
    }

    // 2) Regroupement par proximité (échangeurs/éoliennes/cheminées/péages) ou
    //    simple dédup (~11 m) pour les autres types (nwr peut renvoyer node+way).
    const nouveaux = [];
    for (const typeKey of Object.keys(parType)) {
      const pts = parType[typeKey];
      const cfg = POI_CLUSTER[typeKey];
      if (cfg) {
        for (const members of _clusterByRadius(pts, cfg.radiusNM)) {
          const rep = _centralMember(members);
          const name = (members.find(m => m.name) || {}).name || '';
          const poi = { lat: rep.lat, lon: rep.lon, name, theme: rep.theme, typeKey };
          if (cfg.count && members.length > 1) poi.count = members.length;
          nouveaux.push(poi);
        }
      } else {
        const seen = new Set();
        for (const p of pts) {
          const k = p.lat.toFixed(4) + ',' + p.lon.toFixed(4);
          if (seen.has(k)) continue;
          seen.add(k);
          nouveaux.push(p);
        }
      }
    }

    // Remplace le lot précédent
    effacerTousPOI();
    poisRemarquables = nouveaux;
    _redessinerTout();

    _loading = false;
    const n = nouveaux.length;
    if (n === 0) showToast(t('poiLoadedNone'), 'info');
    else showToast(n + ' ' + t('poiLoadedSome'), 'success');
  }

  // -------------------------------------------------------
  // API publique (ponts window)
  // -------------------------------------------------------
  function effacerTousPOI() {
    POI_THEMES.forEach(th => _groups[th].clearLayers());
    poisRemarquables.forEach(p => { p._outer = null; p._dot = null; });
    poisRemarquables = [];
  }

  function chargerPOISnapshot(arr) {
    effacerTousPOI();
    if (!Array.isArray(arr)) return;
    arr.forEach(item => {
      if (!item || typeof item.lat !== 'number' || typeof item.lon !== 'number') return;
      if (!_groups[item.theme]) return;
      const poi = {
        lat: item.lat,
        lon: item.lon,
        name: item.name || '',
        theme: item.theme,
        typeKey: item.typeKey || 'poiTypeOther',
      };
      if (item.count && item.count > 1) poi.count = item.count;
      poisRemarquables.push(poi);
    });
    _redessinerTout();
  }

  function serialiserPOI() {
    return poisRemarquables.map(p => {
      const o = {
        lat: p.lat,
        lon: p.lon,
        name: p.name || '',
        theme: p.theme,
        typeKey: p.typeKey,
      };
      if (p.count && p.count > 1) o.count = p.count;
      return o;
    });
  }

  function setPoiThemeEnabled(theme, on) {
    if (!_groups[theme]) return;
    _enabled[theme] = !!on;
    if (on) { if (!map.hasLayer(_groups[theme])) _groups[theme].addTo(map); }
    else { if (map.hasLayer(_groups[theme])) map.removeLayer(_groups[theme]); }
    const optKey = 'poiTheme' + theme.charAt(0).toUpperCase() + theme.slice(1);
    if (typeof setAppOption === 'function') setAppOption(optKey, !!on);
  }

  function getPoiThemeStates() {
    return {
      eau: _enabled.eau,
      energie: _enabled.energie,
      transport: _enabled.transport,
      patrimoine: _enabled.patrimoine,
    };
  }

  function _refreshPoiTooltips() {
    for (const poi of poisRemarquables) {
      if (poi._outer) poi._outer.setTooltipContent(_tooltipHtml(poi));
    }
  }

  window.chargerPOIRoute = chargerPOIRoute;
  window.chargerPOISnapshot = chargerPOISnapshot;
  window.serialiserPOI = serialiserPOI;
  window.effacerTousPOI = effacerTousPOI;
  window.setPoiThemeEnabled = setPoiThemeEnabled;
  window.getPoiThemeStates = getPoiThemeStates;
  window._refreshPoiTooltips = _refreshPoiTooltips;

  // Le dropdown « Calques » a pu être construit avant ce module : on le
  // régénère pour qu'il intègre la section « Points remarquables ».
  if (typeof window._refreshLayersDropdown === 'function') window._refreshLayersDropdown();
}

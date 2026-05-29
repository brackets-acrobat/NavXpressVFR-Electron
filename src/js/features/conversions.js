// ============================================================
// NavXpressVFR — conversions.js
// Conversions d'unités — bouton + modale
// Extrait de ui.js (Phase 2 — Lot A). Appelé par l'orchestrateur ui.js.
// ============================================================

function initConversions() {
  // ============================================================
  // CONVERSIONS D'UNITÉS — bouton + modale
  // ============================================================
  const btnConversions = document.getElementById('btn-conversions');
  const convOverlay = document.getElementById('conversions-overlay');

  // Helpers : filtre le texte saisi pour n'autoriser que les chiffres,
  // un point décimal et un signe moins. Accepte aussi la virgule (convertie).
  function _convCleanInput(el) {
    const before = el.value;
    let v = before.replace(/,/g, '.').replace(/[^0-9.\-]/g, '');
    // Au plus un point et un signe moins en début
    const firstDot = v.indexOf('.');
    if (firstDot !== -1) {
      v = v.slice(0, firstDot + 1) + v.slice(firstDot + 1).replace(/\./g, '');
    }
    if (v.lastIndexOf('-') > 0) v = v.replace(/-/g, '');
    if (v !== before) el.value = v;
  }
  // Formate un nombre en supprimant les zéros de fin inutiles (max N décimales)
  function _convFmt(num, decimals = 3) {
    if (!isFinite(num)) return '';
    return parseFloat(num.toFixed(decimals)).toString();
  }

  // Lien bidirectionnel entre deux inputs (paire simple)
  function linkPair(idA, idB, aToB, bToA, decimals = 2) {
    const a = document.getElementById(idA);
    const b = document.getElementById(idB);
    if (!a || !b) return;
    a.addEventListener('input', () => {
      _convCleanInput(a);
      const v = parseFloat(a.value);
      b.value = isFinite(v) ? _convFmt(aToB(v), decimals) : '';
    });
    b.addEventListener('input', () => {
      _convCleanInput(b);
      const v = parseFloat(b.value);
      a.value = isFinite(v) ? _convFmt(bToA(v), decimals) : '';
    });
  }

  // Lien à 3 unités (vitesse : kt, km/h, mph) via une base commune (kt)
  function linkTripletSpeed() {
    const items = [
      { id: 'conv-kt', toKt: v => v, fromKt: v => v },
      { id: 'conv-kmh', toKt: v => v / 1.852, fromKt: v => v * 1.852 },
      { id: 'conv-mph', toKt: v => v / 1.150779, fromKt: v => v * 1.150779 },
    ];
    items.forEach(src => {
      const el = document.getElementById(src.id);
      if (!el) return;
      el.addEventListener('input', () => {
        _convCleanInput(el);
        const v = parseFloat(el.value);
        if (!isFinite(v)) {
          items.forEach(o => {
            if (o.id !== src.id) document.getElementById(o.id).value = '';
          });
          return;
        }
        const ktVal = src.toKt(v);
        items.forEach(o => {
          if (o.id === src.id) return;
          document.getElementById(o.id).value = _convFmt(o.fromKt(ktVal), 2);
        });
      });
    });
  }

  // Câblages des paires
  // Distance NM ↔ km : 1 NM = 1.852 km
  linkPair('conv-nm', 'conv-km', v => v * 1.852, v => v / 1.852, 3);
  // Distance ft ↔ m : 1 ft = 0.3048 m
  linkPair('conv-ft', 'conv-m', v => v * 0.3048, v => v / 0.3048, 2);
  // Vitesse triplet
  linkTripletSpeed();
  // Température °C ↔ °F
  linkPair('conv-c', 'conv-f', v => v * 9 / 5 + 32, v => (v - 32) * 5 / 9, 1);
  // Pression hPa ↔ inHg : 1 inHg = 33.8639 hPa
  linkPair('conv-hpa', 'conv-inhg', v => v / 33.8639, v => v * 33.8639, 3);
  // Poids kg ↔ lb : 1 kg = 2.20462 lb
  linkPair('conv-kg', 'conv-lb', v => v * 2.20462, v => v / 2.20462, 3);
  // Volume US gal ↔ L : 1 US gal = 3.785411784 L
  linkPair('conv-usgal', 'conv-l', v => v * 3.785411784, v => v / 3.785411784, 3);

  // Ouverture / fermeture de la modale
  function _ouvrirConversions() {
    if (!convOverlay) return;
    convOverlay.classList.add('visible');
    setTimeout(() => {
      const first = document.getElementById('conv-nm');
      if (first) { first.focus(); first.select(); }
    }, 50);
  }
  function _fermerConversions() {
    if (convOverlay) convOverlay.classList.remove('visible');
    // Vider tous les champs de conversion
    convOverlay?.querySelectorAll('.conv-input').forEach(el => { el.value = ''; });
  }
  if (btnConversions) btnConversions.addEventListener('click', _ouvrirConversions);
  if (convOverlay) {
    convOverlay.addEventListener('click', e => {
      if (e.target === convOverlay) _fermerConversions();
    });
  }
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && convOverlay && convOverlay.classList.contains('visible')) {
      _fermerConversions();
    }
  });
}

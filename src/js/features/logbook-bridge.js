// ============================================================
// NavXpressVFR — logbook-bridge.js
// Pont entre l'état renderer (flightPlan global + événements Direct To)
// et le moteur carnet de vol côté main process.
//
// Le moteur (main process) a besoin :
//   - du plan de vol courant (window.flightPlan) à tout moment pour pouvoir
//     en figer un snapshot au décollage
//   - de chaque Direct To activé pour les enregistrer dans le vol courant
//
// Stratégies utilisées ici :
//   - Plan : décorateur sur mettreAJourLogDeNav() (= signal unique
//     « le plan a peut-être changé », appelé après chaque mutation :
//     création, import, reset, édition, validation). Debounce 200 ms
//     pour éviter le spam sur les modifs rafale.
//   - Direct To : on écoute le CustomEvent 'logbook-direct-to' dispatché
//     depuis direct-to.js à chaque activation (plan / airport / point).
//   - Toggle Options : écoute de 'app-option-changed' pour pousser
//     logbookEnabled vers main dès que l'utilisateur bascule.
//
// initLogbookBridge() est appelée par l'orchestrateur ui.js.
// ============================================================

function initLogbookBridge() {
  if (!window.api) return;

  // --- 1) Plan de vol : pousse après mettreAJourLogDeNav() ------------
  // mettreAJourLogDeNav existe dans le scope global (déclaré en var). On
  // décore la fonction comme le fait déjà direct-to.js pour son propre
  // hook — c'est la chaîne de décorateurs documentée dans la mémoire
  // [[refactor_ui_modularization]].
  let _pushTimer = null;
  function _planifierPushPlan() {
    if (_pushTimer) clearTimeout(_pushTimer);
    _pushTimer = setTimeout(() => {
      _pushTimer = null;
      if (typeof window.api.logbookSetFlightPlan !== 'function') return;
      const plan = Array.isArray(flightPlan) ? flightPlan : [];
      // On ne pousse que les champs utiles au logbook — pas la geometry
      // Leaflet ou les marqueurs qui pourraient s'y trouver attachés.
      const slim = plan.map(wp => ({
        name: wp && wp.name ? wp.name : '',
        ident: wp && wp.ident ? wp.ident : '',
        lat: wp ? wp.lat : null,
        lon: wp ? wp.lon : null,
        pattern: !!(wp && wp.pattern),
      }));
      window.api.logbookSetFlightPlan(slim).catch(err => {
        console.warn('[Logbook bridge] Push plan KO :', err);
      });
    }, 200);
  }

  if (typeof mettreAJourLogDeNav === 'function') {
    const _origMaj = mettreAJourLogDeNav;
    // eslint-disable-next-line no-global-assign
    mettreAJourLogDeNav = function () {
      const r = _origMaj.apply(this, arguments);
      _planifierPushPlan();
      return r;
    };
  }
  // Push initial : si un plan est déjà chargé (ex. ouverture .navxpv
  // avant l'init), on l'envoie tout de suite.
  _planifierPushPlan();

  // --- 2) Direct To : écoute des événements émis par direct-to.js ----
  document.addEventListener('logbook-direct-to', (e) => {
    if (typeof window.api.logbookRecordDirectTo !== 'function') return;
    const dt = e && e.detail;
    if (!dt || !dt.kind) return;
    window.api.logbookRecordDirectTo(dt).catch(err => {
      console.warn('[Logbook bridge] Push DT KO :', err);
    });
  });

  // --- 3) Toggle Options : pousse l'état initial + chaque changement -
  function _pushEnabled() {
    if (typeof window.api.logbookSetEnabled !== 'function') return;
    const enabled = !!(window.appOptions && window.appOptions.logbookEnabled);
    window.api.logbookSetEnabled(enabled).catch(err => {
      console.warn('[Logbook bridge] Push toggle KO :', err);
    });
  }
  // Au démarrage : window.appOptions est déjà chargé (chargerOptions()
  // est awaité avant les init* — cf. ui.js).
  _pushEnabled();
  document.addEventListener('app-option-changed', (e) => {
    if (e && e.detail && e.detail.key === 'logbookEnabled') _pushEnabled();
  });
}

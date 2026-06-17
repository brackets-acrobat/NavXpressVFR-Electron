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
// NavXpressVFR — imports.js
// Imports OurAirports / élévation / MSFS (+ applyI18nIn partagé)
// Extrait de ui.js (Phase 2 — Lot A). Appelé par l'orchestrateur ui.js.
// ============================================================

function initImports() {
  // applyI18nIn partagé (utilisé aussi par les imports élévation et aéroports MSFS).
  function applyI18nIn(el) {
    if (!el) return;
    el.querySelectorAll('[data-i18n]').forEach(n => {
      n.textContent = t(n.getAttribute('data-i18n'));
    });
  }

  // --- Bouton + Modales : Import Navaids MSFS 2024 (VOR/NDB via SimConnect) ---
  // Même flux que l'import aéroports : vérifier MSFS lancé → extraction (traversance
  // airways) → modale de progression. Produit navaids.jsonl.
  const btnImportNavaids = document.getElementById('btn-import-navaids');
  const navaidsConfirmOverlay = document.getElementById('navaids-confirm-overlay');
  const btnNavaidsConfirmCancel = document.getElementById('btn-navaids-confirm-cancel');
  const btnNavaidsConfirmOk = document.getElementById('btn-navaids-confirm-ok');
  const navaidsCheckStatus = document.getElementById('navaids-check-status');
  const navaidsProgressOverlay = document.getElementById('navaids-progress-overlay');
  const navaidsProgressPhase = document.getElementById('navaids-progress-phase');
  const navaidsProgressBarFill = document.getElementById('navaids-progress-bar-fill');
  const navaidsProgressCount = document.getElementById('navaids-progress-count');
  const navaidsProgressStats = document.getElementById('navaids-progress-stats');
  const navaidsProgressSummary = document.getElementById('navaids-progress-summary');
  const btnNavaidsProgressClose = document.getElementById('btn-navaids-progress-close');

  let _navaidsChecking = false;
  let _navaidsExtracting = false;
  let _navaidsUnsubProgress = null;

  function openNavaidsConfirm() {
    applyI18nIn(navaidsConfirmOverlay);
    if (navaidsCheckStatus) { navaidsCheckStatus.innerHTML = ''; navaidsCheckStatus.style.color = '#aaa'; }
    if (btnNavaidsConfirmOk) btnNavaidsConfirmOk.disabled = false;
    if (btnNavaidsConfirmCancel) btnNavaidsConfirmCancel.disabled = false;
    navaidsConfirmOverlay.classList.add('visible');
  }
  function closeNavaidsConfirm() {
    if (_navaidsChecking) return;
    navaidsConfirmOverlay.classList.remove('visible');
  }

  function openNavaidsProgress() {
    if (!navaidsProgressOverlay) return;
    applyI18nIn(navaidsProgressOverlay);
    if (navaidsProgressBarFill) navaidsProgressBarFill.style.width = '0%';
    if (navaidsProgressCount) navaidsProgressCount.textContent = '0 / 0';
    if (navaidsProgressStats) navaidsProgressStats.textContent = '';
    if (navaidsProgressSummary) { navaidsProgressSummary.innerHTML = ''; navaidsProgressSummary.style.color = '#888'; }
    if (navaidsProgressPhase) { navaidsProgressPhase.style.color = '#aaa'; navaidsProgressPhase.textContent = t('msfsPhaseConnecting'); }
    if (btnNavaidsProgressClose) btnNavaidsProgressClose.disabled = true;
    navaidsProgressOverlay.classList.add('visible');
  }
  function closeNavaidsProgress() {
    if (_navaidsExtracting) return;
    if (navaidsProgressOverlay) navaidsProgressOverlay.classList.remove('visible');
  }

  function handleNavaidsProgress(p) {
    if (!p) return;
    const setBar = (pct) => { if (navaidsProgressBarFill) navaidsProgressBarFill.style.width = Math.max(0, Math.min(100, pct)) + '%'; };
    if (p.phase === 'connect' || p.phase === 'connected') {
      if (navaidsProgressPhase) navaidsProgressPhase.textContent = t('msfsPhaseConnecting');
    } else if (p.phase === 'enumerate') {
      if (navaidsProgressPhase) navaidsProgressPhase.textContent = t('navaidsPhaseEnumerate')(p.enumerated);
      if (p.total) setBar(Math.round((p.packet / p.total) * 100));
      if (navaidsProgressCount) navaidsProgressCount.textContent = String(p.enumerated);
    } else if (p.phase === 'seed' || p.phase === 'bfs' || p.phase === 'vor' || p.phase === 'ndb' || p.phase === 'disco') {
      const label = { seed: 'navaidsPhaseSeed', bfs: 'navaidsPhaseBfs', vor: 'navaidsPhaseVor', ndb: 'navaidsPhaseNdb', disco: 'navaidsPhaseDisco' }[p.phase];
      if (navaidsProgressPhase) navaidsProgressPhase.textContent = t(label);
      if (p.target > 0) setBar(Math.round((p.treated / p.target) * 100));
      if (navaidsProgressCount) navaidsProgressCount.textContent = `${p.treated} / ${p.target}`;
      if (navaidsProgressStats) navaidsProgressStats.textContent = t('navaidsProgressStats')(p.navaids || 0, p.seeds || 0);
    } else if (p.phase === 'done') {
      setBar(100);
    }
  }

  async function startNavaidsExtraction() {
    if (_navaidsExtracting) return;
    _navaidsChecking = false;
    if (navaidsConfirmOverlay) navaidsConfirmOverlay.classList.remove('visible');
    openNavaidsProgress();

    _navaidsExtracting = true;
    if (_navaidsUnsubProgress) { try { _navaidsUnsubProgress(); } catch (_) {} _navaidsUnsubProgress = null; }
    if (window.api.onMsfsNavaidsProgress) _navaidsUnsubProgress = window.api.onMsfsNavaidsProgress(handleNavaidsProgress);

    let result;
    try {
      result = await window.api.msfsExtraireNavaids();
    } catch (err) {
      result = { ok: false, error: (err && err.message) || String(err) };
    }

    _navaidsExtracting = false;
    if (_navaidsUnsubProgress) { try { _navaidsUnsubProgress(); } catch (_) {} _navaidsUnsubProgress = null; }
    if (btnNavaidsProgressClose) btnNavaidsProgressClose.disabled = false;

    if (result && result.ok && result.summary && result.summary.file) {
      if (navaidsProgressSummary) {
        navaidsProgressSummary.style.color = '#00e676';
        navaidsProgressSummary.innerHTML = t('navaidsExtractDone')(result.summary.navaids);
      }
    } else if (result && result.ok && result.summary) {
      if (navaidsProgressSummary) {
        navaidsProgressSummary.style.color = '#ffb300';
        navaidsProgressSummary.innerHTML = t('navaidsExtractEmpty');
      }
    } else {
      if (navaidsProgressSummary) {
        navaidsProgressSummary.style.color = '#ff5252';
        navaidsProgressSummary.innerHTML = t('navaidsExtractError')((result && result.error) || '?');
      }
    }
  }

  if (btnImportNavaids) btnImportNavaids.addEventListener('click', openNavaidsConfirm);
  if (btnNavaidsConfirmCancel) btnNavaidsConfirmCancel.addEventListener('click', closeNavaidsConfirm);
  if (navaidsConfirmOverlay) {
    navaidsConfirmOverlay.addEventListener('click', (e) => { if (e.target === navaidsConfirmOverlay) closeNavaidsConfirm(); });
  }
  if (btnNavaidsConfirmOk) {
    btnNavaidsConfirmOk.addEventListener('click', async () => {
      if (_navaidsChecking) return;
      _navaidsChecking = true;
      btnNavaidsConfirmOk.disabled = true;
      if (btnNavaidsConfirmCancel) btnNavaidsConfirmCancel.disabled = true;
      if (navaidsCheckStatus) { navaidsCheckStatus.style.color = '#00bcd4'; navaidsCheckStatus.innerHTML = t('msfsCheckChecking'); }

      let res = { running: false };
      try { res = await window.api.msfsVerifierLancement(); }
      catch (err) { res = { running: false, error: (err && err.message) || String(err) }; }

      _navaidsChecking = false;
      btnNavaidsConfirmOk.disabled = false;
      if (btnNavaidsConfirmCancel) btnNavaidsConfirmCancel.disabled = false;

      if (res && res.running) {
        if (navaidsCheckStatus) { navaidsCheckStatus.style.color = '#00e676'; navaidsCheckStatus.innerHTML = t('msfsCheckRunning')(res.app || 'MSFS'); }
        startNavaidsExtraction();
      } else {
        if (navaidsCheckStatus) { navaidsCheckStatus.style.color = '#ff5252'; navaidsCheckStatus.innerHTML = t('msfsCheckNotRunning'); }
      }
    });
  }
  if (btnNavaidsProgressClose) btnNavaidsProgressClose.addEventListener('click', closeNavaidsProgress);
  if (navaidsProgressOverlay) {
    navaidsProgressOverlay.addEventListener('click', (e) => { if (e.target === navaidsProgressOverlay) closeNavaidsProgress(); });
  }

  // --- Bouton + Modales : Import données d'élévation (GLOBE all10g.zip) ---
  const btnImportElev = document.getElementById('btn-import-elevation');
  const elevConfirmOverlay = document.getElementById('elev-confirm-overlay');
  const btnElevConfirmCancel = document.getElementById('btn-elev-confirm-cancel');
  const btnElevConfirmOk = document.getElementById('btn-elev-confirm-ok');
  const elevProgressOverlay = document.getElementById('elev-progress-overlay');
  const elevProgressPhase = document.getElementById('elev-progress-phase');
  const elevProgressBarFill = document.getElementById('elev-progress-bar-fill');
  const elevProgressSize = document.getElementById('elev-progress-size');
  const elevProgressSummary = document.getElementById('elev-progress-summary');
  const btnElevProgressClose = document.getElementById('btn-elev-progress-close');

  let _elevImportInProgress = false;
  let _elevProgressUnsub = null;

  function fmtMo(bytes) {
    return (bytes / (1024 * 1024)).toFixed(1) + ' Mo';
  }

  async function lancerImportElevation() {
    if (_elevImportInProgress) return;
    _elevImportInProgress = true;

    // Réinitialiser la modale de progression
    applyI18nIn(elevProgressOverlay);
    elevProgressPhase.textContent = t('elevPhaseStarting');
    elevProgressPhase.style.color = '#aaa';
    elevProgressBarFill.style.width = '0%';
    elevProgressBarFill.style.background = '#00bcd4';
    elevProgressSize.textContent = '—';
    elevProgressSummary.innerHTML = '';
    elevProgressSummary.style.color = '#888';
    btnElevProgressClose.disabled = true;
    elevProgressOverlay.classList.add('visible');

    // S'abonner aux events de progression
    if (_elevProgressUnsub) { try { _elevProgressUnsub(); } catch (_) { } }
    _elevProgressUnsub = window.api.onElevationProgress((data) => {
      if (data.type === 'start') {
        elevProgressPhase.textContent = t('elevPhaseStarting');
        elevProgressBarFill.style.width = '0%';
      } else if (data.type === 'download') {
        elevProgressPhase.textContent = t('elevPhaseDownloading');
        if (data.total) {
          const pct = Math.round((data.received / data.total) * 100);
          elevProgressBarFill.style.width = pct + '%';
          elevProgressSize.textContent = `${fmtMo(data.received)} / ${fmtMo(data.total)} (${pct}%)`;
        } else {
          elevProgressBarFill.style.width = '100%';
          elevProgressSize.textContent = fmtMo(data.received);
        }
      } else if (data.type === 'extract') {
        elevProgressPhase.textContent = t('elevPhaseExtracting');
        elevProgressBarFill.style.width = '100%';
        elevProgressSize.textContent = '';
      } else if (data.type === 'flatten') {
        elevProgressPhase.textContent = t('elevPhaseFlattening');
        elevProgressBarFill.style.width = '100%';
      } else if (data.type === 'done') {
        elevProgressPhase.textContent = '';
        elevProgressBarFill.style.width = '100%';
        elevProgressBarFill.style.background = data.ok ? '#00e676' : '#ffb300';
        elevProgressSummary.style.color = data.ok ? '#00e676' : '#ffb300';
        elevProgressSummary.innerHTML =
          `<div>${t('elevProgressDone')}</div>` +
          `<div style="margin-top:4px; color:#888; font-size:11px; white-space:pre-wrap;">${t('elevProgressDoneDir')(data.dir)}</div>`;
        btnElevProgressClose.disabled = false;
      } else if (data.type === 'error') {
        elevProgressPhase.textContent = '';
        elevProgressBarFill.style.background = '#ff5252';
        elevProgressSummary.style.color = '#ff5252';
        elevProgressSummary.innerHTML = t('elevProgressError') + ' — ' + (data.error || '');
        btnElevProgressClose.disabled = false;
      }
    });

    try {
      await window.api.importerElevation();
    } catch (err) {
      console.error('Import élévation échec:', err);
      elevProgressSummary.style.color = '#ff5252';
      elevProgressSummary.innerHTML = '<i class="ph-light ph-x-circle" aria-hidden="true"></i> ' + err.message;
      btnElevProgressClose.disabled = false;
    } finally {
      _elevImportInProgress = false;
    }
  }

  if (btnImportElev) {
    btnImportElev.addEventListener('click', async () => {
      let existe = false;
      try { existe = await window.api.elevationExiste(); } catch (_) { }
      if (existe) {
        applyI18nIn(elevConfirmOverlay);
        elevConfirmOverlay.classList.add('visible');
      } else {
        await lancerImportElevation();
      }
    });
  }

  if (btnElevConfirmCancel) {
    btnElevConfirmCancel.addEventListener('click', () => elevConfirmOverlay.classList.remove('visible'));
  }
  if (elevConfirmOverlay) {
    elevConfirmOverlay.addEventListener('click', (e) => {
      if (e.target === elevConfirmOverlay) elevConfirmOverlay.classList.remove('visible');
    });
  }
  if (btnElevConfirmOk) {
    btnElevConfirmOk.addEventListener('click', async () => {
      elevConfirmOverlay.classList.remove('visible');
      await lancerImportElevation();
    });
  }

  if (btnElevProgressClose) {
    btnElevProgressClose.addEventListener('click', () => {
      if (!btnElevProgressClose.disabled) elevProgressOverlay.classList.remove('visible');
    });
  }
  if (elevProgressOverlay) {
    elevProgressOverlay.addEventListener('click', (e) => {
      if (e.target === elevProgressOverlay && !btnElevProgressClose.disabled) {
        elevProgressOverlay.classList.remove('visible');
      }
    });
  }

  // --- Bouton + Modale : Import Aéroports MSFS 2024 ---
  const btnImportMsfs = document.getElementById('btn-import-msfs');
  const msfsConfirmOverlay = document.getElementById('msfs-confirm-overlay');
  const btnMsfsConfirmCancel = document.getElementById('btn-msfs-confirm-cancel');
  const btnMsfsConfirmOk = document.getElementById('btn-msfs-confirm-ok');
  const msfsCheckStatus = document.getElementById('msfs-check-status');

  let _msfsChecking = false;

  function openMsfsConfirm() {
    applyI18nIn(msfsConfirmOverlay);
    if (msfsCheckStatus) { msfsCheckStatus.innerHTML = ''; msfsCheckStatus.style.color = '#aaa'; }
    if (btnMsfsConfirmOk) btnMsfsConfirmOk.disabled = false;
    if (btnMsfsConfirmCancel) btnMsfsConfirmCancel.disabled = false;
    msfsConfirmOverlay.classList.add('visible');
  }
  function closeMsfsConfirm() {
    if (_msfsChecking) return; // ne pas fermer pendant la vérification
    msfsConfirmOverlay.classList.remove('visible');
  }

  if (btnImportMsfs) {
    btnImportMsfs.addEventListener('click', openMsfsConfirm);
  }
  if (btnMsfsConfirmCancel) {
    btnMsfsConfirmCancel.addEventListener('click', closeMsfsConfirm);
  }
  if (msfsConfirmOverlay) {
    msfsConfirmOverlay.addEventListener('click', (e) => {
      if (e.target === msfsConfirmOverlay) closeMsfsConfirm();
    });
  }
  if (btnMsfsConfirmOk) {
    btnMsfsConfirmOk.addEventListener('click', async () => {
      if (_msfsChecking) return;
      _msfsChecking = true;
      btnMsfsConfirmOk.disabled = true;
      if (btnMsfsConfirmCancel) btnMsfsConfirmCancel.disabled = true;
      if (msfsCheckStatus) {
        msfsCheckStatus.style.color = '#00bcd4';
        msfsCheckStatus.innerHTML = t('msfsCheckChecking');
      }

      let res = { running: false };
      try {
        res = await window.api.msfsVerifierLancement();
      } catch (err) {
        res = { running: false, error: (err && err.message) || String(err) };
      }

      _msfsChecking = false;
      btnMsfsConfirmOk.disabled = false;
      if (btnMsfsConfirmCancel) btnMsfsConfirmCancel.disabled = false;

      if (res && res.running) {
        if (msfsCheckStatus) {
          msfsCheckStatus.style.color = '#00e676';
          msfsCheckStatus.innerHTML = t('msfsCheckRunning')(res.app || 'MSFS');
        }
        // MSFS détecté : on enchaîne sur l'extraction in-app + modale de progression.
        startMsfsExtraction();
      } else {
        if (msfsCheckStatus) {
          msfsCheckStatus.style.color = '#ff5252';
          msfsCheckStatus.innerHTML = t('msfsCheckNotRunning');
        }
      }
    });
  }

  // --- Modale progression : extraction des aéroports MSFS 2024 ---
  const msfsProgressOverlay = document.getElementById('msfs-progress-overlay');
  const msfsProgressPhase = document.getElementById('msfs-progress-phase');
  const msfsProgressBarFill = document.getElementById('msfs-progress-bar-fill');
  const msfsProgressCount = document.getElementById('msfs-progress-count');
  const msfsProgressStatsEl = document.getElementById('msfs-progress-stats');
  const msfsProgressSummary = document.getElementById('msfs-progress-summary');
  const btnMsfsProgressClose = document.getElementById('btn-msfs-progress-close');

  let _msfsExtracting = false;
  let _msfsUnsubProgress = null;

  function fmtMsDuration(ms) {
    const s = Math.max(0, Math.round((ms || 0) / 1000));
    const m = Math.floor(s / 60);
    return `${m}m${String(s % 60).padStart(2, '0')}s`;
  }

  function openMsfsProgress() {
    if (!msfsProgressOverlay) return;
    applyI18nIn(msfsProgressOverlay);
    if (msfsProgressBarFill) msfsProgressBarFill.style.width = '0%';
    if (msfsProgressCount) msfsProgressCount.textContent = '0 / 0';
    if (msfsProgressStatsEl) msfsProgressStatsEl.textContent = '';
    if (msfsProgressSummary) { msfsProgressSummary.innerHTML = ''; msfsProgressSummary.style.color = '#888'; }
    if (msfsProgressPhase) { msfsProgressPhase.style.color = '#aaa'; msfsProgressPhase.textContent = t('msfsPhaseConnecting'); }
    if (btnMsfsProgressClose) btnMsfsProgressClose.disabled = true;
    msfsProgressOverlay.classList.add('visible');
  }
  function closeMsfsProgress() {
    if (_msfsExtracting) return; // pas de fermeture pendant l'extraction
    if (msfsProgressOverlay) msfsProgressOverlay.classList.remove('visible');
  }

  function handleMsfsProgress(p) {
    if (!p) return;
    if (p.phase === 'connect' || p.phase === 'connected') {
      if (msfsProgressPhase) msfsProgressPhase.textContent = t('msfsPhaseConnecting');
    } else if (p.phase === 'enumerate') {
      if (msfsProgressPhase) msfsProgressPhase.textContent = t('msfsPhaseEnumerate')(p.enumerated);
      if (msfsProgressBarFill && p.totalPackets) {
        const pct = Math.min(100, Math.round((p.packet / p.totalPackets) * 100));
        msfsProgressBarFill.style.width = pct + '%';
      }
      if (msfsProgressCount) msfsProgressCount.textContent = String(p.enumerated);
    } else if (p.phase === 'detail') {
      if (msfsProgressPhase) msfsProgressPhase.textContent = p.retry ? t('msfsPhaseRetry') : t('msfsPhaseDetail');
      const pct = p.target > 0 ? Math.min(100, Math.round((p.treated / p.target) * 100)) : 0;
      if (msfsProgressBarFill) msfsProgressBarFill.style.width = pct + '%';
      if (msfsProgressCount) msfsProgressCount.textContent = `${p.treated} / ${p.target}`;
      if (msfsProgressStatsEl) {
        const rate = Math.round(p.ratePerSec || 0);
        msfsProgressStatsEl.textContent =
          t('msfsProgressStats')(rate, fmtMsDuration(p.etaMs)) + '  ·  ' + t('msfsProgressOkFailed')(p.ok, p.failed);
      }
    } else if (p.phase === 'done') {
      if (msfsProgressBarFill) msfsProgressBarFill.style.width = '100%';
      if (msfsProgressCount) msfsProgressCount.textContent = `${p.written} / ${p.enumerated}`;
    }
  }

  async function startMsfsExtraction() {
    if (_msfsExtracting) return;
    // Ferme la confirmation, ouvre la progression.
    _msfsChecking = false;
    if (msfsConfirmOverlay) msfsConfirmOverlay.classList.remove('visible');
    openMsfsProgress();

    _msfsExtracting = true;
    if (_msfsUnsubProgress) { try { _msfsUnsubProgress(); } catch (_) {} _msfsUnsubProgress = null; }
    if (window.api.onMsfsExtractProgress) _msfsUnsubProgress = window.api.onMsfsExtractProgress(handleMsfsProgress);

    let result;
    try {
      result = await window.api.msfsExtraireAeroports({ limit: 0 });
    } catch (err) {
      result = { ok: false, error: (err && err.message) || String(err) };
    }

    _msfsExtracting = false;
    if (_msfsUnsubProgress) { try { _msfsUnsubProgress(); } catch (_) {} _msfsUnsubProgress = null; }
    if (btnMsfsProgressClose) btnMsfsProgressClose.disabled = false;

    if (result && result.ok && result.summary && result.summary.file) {
      if (msfsProgressSummary) {
        msfsProgressSummary.style.color = '#00e676';
        msfsProgressSummary.innerHTML = t('msfsExtractDone')(result.summary.written);
      }
    } else if (result && result.ok && result.summary) {
      if (msfsProgressSummary) {
        msfsProgressSummary.style.color = '#ffb300';
        msfsProgressSummary.innerHTML = t('msfsExtractEmpty');
      }
    } else {
      if (msfsProgressSummary) {
        msfsProgressSummary.style.color = '#ff5252';
        msfsProgressSummary.innerHTML = t('msfsExtractError')((result && result.error) || '?');
      }
    }
  }

  if (btnMsfsProgressClose) {
    btnMsfsProgressClose.addEventListener('click', closeMsfsProgress);
  }
  if (msfsProgressOverlay) {
    msfsProgressOverlay.addEventListener('click', (e) => {
      if (e.target === msfsProgressOverlay) closeMsfsProgress();
    });
  }
}

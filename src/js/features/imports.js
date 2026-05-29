// ============================================================
// NavXpressVFR — imports.js
// Imports OurAirports / élévation / MSFS (+ applyI18nIn partagé)
// Extrait de ui.js (Phase 2 — Lot A). Appelé par l'orchestrateur ui.js.
// ============================================================

function initImports() {
  // --- Bouton + Modales : Import OurAirports ---
  const btnImportOA = document.getElementById('btn-import-ourairports');
  const oaConfirmOverlay = document.getElementById('oa-confirm-overlay');
  const btnOaConfirmCancel = document.getElementById('btn-oa-confirm-cancel');
  const btnOaConfirmOk = document.getElementById('btn-oa-confirm-ok');
  const oaProgressOverlay = document.getElementById('oa-progress-overlay');
  const oaProgressList = document.getElementById('oa-progress-list');
  const oaProgressBarFill = document.getElementById('oa-progress-bar-fill');
  const oaProgressCount = document.getElementById('oa-progress-count');
  const oaProgressSummary = document.getElementById('oa-progress-summary');
  const btnOaProgressClose = document.getElementById('btn-oa-progress-close');

  let _oaImportInProgress = false;
  let _oaProgressUnsub = null;

  function applyI18nIn(el) {
    if (!el) return;
    el.querySelectorAll('[data-i18n]').forEach(n => {
      n.textContent = t(n.getAttribute('data-i18n'));
    });
  }

  async function lancerImportOurAirports() {
    if (_oaImportInProgress) return;
    _oaImportInProgress = true;

    // Réinitialiser la modale de progression
    applyI18nIn(oaProgressOverlay);
    oaProgressList.innerHTML = '';
    oaProgressBarFill.style.width = '0%';
    oaProgressCount.textContent = '0 / 0';
    oaProgressSummary.textContent = '';
    oaProgressSummary.style.color = '#888';
    btnOaProgressClose.disabled = true;
    oaProgressOverlay.classList.add('visible');

    // Map name -> <li> pour mise à jour rapide
    const itemByName = new Map();
    let totalFiles = 0;
    let doneCount = 0;

    // S'abonner aux events de progression
    if (_oaProgressUnsub) { try { _oaProgressUnsub(); } catch (_) { } }
    _oaProgressUnsub = window.api.onOurAirportsProgress((data) => {
      if (data.type === 'start') {
        totalFiles = data.total;
        doneCount = 0;
        oaProgressCount.textContent = `0 / ${totalFiles}`;
        oaProgressList.innerHTML = '';
        itemByName.clear();
        data.files.forEach(name => {
          const li = document.createElement('li');
          li.style.padding = '4px 8px';
          li.style.color = '#888';
          li.textContent = `⏸️ ${name}`;
          oaProgressList.appendChild(li);
          itemByName.set(name, li);
        });
      } else if (data.type === 'file-start') {
        const li = itemByName.get(data.name);
        if (li) {
          li.style.color = '#00bcd4';
          li.textContent = t('oaProgressDownloading')(data.name);
        }
      } else if (data.type === 'file-done') {
        const li = itemByName.get(data.name);
        if (li) {
          li.style.color = '#00e676';
          li.textContent = t('oaProgressFileOk')(data.name, data.count);
        }
        doneCount++;
        oaProgressCount.textContent = `${doneCount} / ${totalFiles}`;
        oaProgressBarFill.style.width = Math.round((doneCount / totalFiles) * 100) + '%';
      } else if (data.type === 'file-error') {
        const li = itemByName.get(data.name);
        if (li) {
          li.style.color = '#ff5252';
          li.textContent = t('oaProgressFileError')(data.name) + ' — ' + data.error;
        }
        doneCount++;
        oaProgressCount.textContent = `${doneCount} / ${totalFiles}`;
        oaProgressBarFill.style.width = Math.round((doneCount / totalFiles) * 100) + '%';
      } else if (data.type === 'done') {
        const okCount = data.results.filter(r => r.ok).length;
        const allOk = okCount === data.results.length;
        oaProgressSummary.style.color = allOk ? '#00e676' : '#ffb300';
        oaProgressSummary.innerHTML =
          `<div>${t('oaProgressDone')(okCount, data.results.length)}</div>` +
          `<div style="margin-top:4px; color:#888; font-size:11px; white-space:pre-wrap;">${t('oaProgressDoneDir')(data.dir)}</div>`;
        btnOaProgressClose.disabled = false;
      }
    });

    try {
      await window.api.importerOurAirports();
    } catch (err) {
      console.error('Import OurAirports échec:', err);
      oaProgressSummary.style.color = '#ff5252';
      oaProgressSummary.textContent = '❌ ' + err.message;
      btnOaProgressClose.disabled = false;
    } finally {
      _oaImportInProgress = false;
    }
  }

  if (btnImportOA) {
    btnImportOA.addEventListener('click', async () => {
      let existe = false;
      try { existe = await window.api.ourAirportsExiste(); } catch (_) { }
      if (existe) {
        applyI18nIn(oaConfirmOverlay);
        oaConfirmOverlay.classList.add('visible');
      } else {
        await lancerImportOurAirports();
      }
    });
  }

  if (btnOaConfirmCancel) {
    btnOaConfirmCancel.addEventListener('click', () => oaConfirmOverlay.classList.remove('visible'));
  }
  if (oaConfirmOverlay) {
    oaConfirmOverlay.addEventListener('click', (e) => {
      if (e.target === oaConfirmOverlay) oaConfirmOverlay.classList.remove('visible');
    });
  }
  if (btnOaConfirmOk) {
    btnOaConfirmOk.addEventListener('click', async () => {
      oaConfirmOverlay.classList.remove('visible');
      await lancerImportOurAirports();
    });
  }

  if (btnOaProgressClose) {
    btnOaProgressClose.addEventListener('click', () => {
      if (!btnOaProgressClose.disabled) oaProgressOverlay.classList.remove('visible');
    });
  }
  if (oaProgressOverlay) {
    oaProgressOverlay.addEventListener('click', (e) => {
      if (e.target === oaProgressOverlay && !btnOaProgressClose.disabled) {
        oaProgressOverlay.classList.remove('visible');
      }
    });
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
    elevProgressSummary.textContent = '';
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
        elevProgressSummary.textContent = t('elevProgressError') + ' — ' + (data.error || '');
        btnElevProgressClose.disabled = false;
      }
    });

    try {
      await window.api.importerElevation();
    } catch (err) {
      console.error('Import élévation échec:', err);
      elevProgressSummary.style.color = '#ff5252';
      elevProgressSummary.textContent = '❌ ' + err.message;
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
    if (msfsCheckStatus) { msfsCheckStatus.textContent = ''; msfsCheckStatus.style.color = '#aaa'; }
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
        msfsCheckStatus.textContent = t('msfsCheckChecking');
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
          msfsCheckStatus.textContent = t('msfsCheckRunning')(res.app || 'MSFS');
        }
        // MSFS détecté : on enchaîne sur l'extraction in-app + modale de progression.
        startMsfsExtraction();
      } else {
        if (msfsCheckStatus) {
          msfsCheckStatus.style.color = '#ff5252';
          msfsCheckStatus.textContent = t('msfsCheckNotRunning');
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
    if (msfsProgressSummary) { msfsProgressSummary.textContent = ''; msfsProgressSummary.style.color = '#888'; }
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
        msfsProgressSummary.textContent = t('msfsExtractDone')(result.summary.written);
      }
    } else if (result && result.ok && result.summary) {
      if (msfsProgressSummary) {
        msfsProgressSummary.style.color = '#ffb300';
        msfsProgressSummary.textContent = t('msfsExtractEmpty');
      }
    } else {
      if (msfsProgressSummary) {
        msfsProgressSummary.style.color = '#ff5252';
        msfsProgressSummary.textContent = t('msfsExtractError')((result && result.error) || '?');
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

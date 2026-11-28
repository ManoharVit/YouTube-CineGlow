// Stats for Nerds overlay HUD for CineGlow Pro
// Author: Giri Manohar Vemula (https://www.linkedin.com/in/manoharv511)
(() => {
  'use strict';

  let settings = { statsEnabled: false, enableInPiP: false };
  let hostEl = null;
  let shadowRoot = null;
  let overlayEl = null;
  let video = null;
  let updateInterval = 0;
  let isGraphCollapsed = true;

  let refs = {};
  let nerdStats = null;

  // Stats State
  let lastTime = 0;
  let lastPresentedFrames = 0;
  let lastGlowRenders = 0;
  let lastVideoFps = 0;
  let lastGlowFps = 0;
  let rvfcId = 0;
  let rvfcFrames = 0;
  const useRvfc = 'requestVideoFrameCallback' in HTMLVideoElement.prototype;

  let videoFrameTimes = [];
  let frameTimes = [];
  let rafLoopId = 0;
  let probeRafId = 0;
  let lastSeenRenderCount = -1;
  let displayFrames = 0;
  let lastDisplayFrames = 0;
  let lastDisplayFps = 0;
  let isKilled = false;

  const handleStatsMessage = (event) => {
    if (event.source !== window || event.origin !== window.location.origin || event.data?.type !== 'CINEGLOW_STATS_NERDS_RESPONSE') return;
    nerdStats = event.data.stats || null;
  };
  window.addEventListener('message', handleStatsMessage);

  // Measure true monitor refresh rate via a lightweight 5-frame rAF burst when graph is collapsed
  function probeDisplayRefreshRate() {
    if (isKilled || document.hidden || !isGraphCollapsed || probeRafId) return;
    let count = 0;
    let firstTs = 0;
    const step = (ts) => {
      probeRafId = 0;
      if (isKilled || document.hidden) return;
      if (count === 0) {
        firstTs = ts;
      }
      count++;
      if (count <= 5) {
        probeRafId = requestAnimationFrame(step);
      } else {
        const elapsed = ts - firstTs;
        if (elapsed > 0) {
          lastDisplayFps = (5 * 1000) / elapsed;
        }
      }
    };
    probeRafId = requestAnimationFrame(step);
  }

  function onRvfc(now, metadata) {
    if (!updateInterval || document.hidden) return;
    rvfcFrames++;

    if (!isGraphCollapsed) {
      videoFrameTimes.push({
        decode: metadata.presentationTime,
        present: metadata.presentationTime,
        compose: performance.now(),
        receive: now,
        display: metadata.expectedDisplayTime
      });

      if (videoFrameTimes.length > 120) {
        const dropped = videoFrameTimes.shift();
        frameTimes.push({ video: dropped });
        if (frameTimes.length > 120) frameTimes = frameTimes.slice(-120);
      }
    }

    if (video) {
      rvfcId = video.requestVideoFrameCallback(onRvfc);
    }
  }

  function statsLoop(now) {
    if (isKilled || window.CineGlowKilled || !updateInterval || document.hidden || isGraphCollapsed) {
      rafLoopId = 0;
      return;
    }

    if (video && (video.paused || video.ended) && window.CineGlowMetrics && lastSeenRenderCount === window.CineGlowMetrics.renderCount) {
      rafLoopId = 0;
      return;
    }

    if (window.CineGlowPlayer?.isPiP && !settings.enableInPiP) {
      rafLoopId = 0;
      return;
    }

    displayFrames++;

    const metrics = window.CineGlowMetrics;
    const currentRenderCount = metrics ? metrics.renderCount : 0;
    if (metrics && currentRenderCount !== lastSeenRenderCount) {
      lastSeenRenderCount = currentRenderCount;
      const vf = videoFrameTimes[videoFrameTimes.length - 1];

      const ft = {
        video: vf,
        drawStart: metrics.lastDrawStart,
        drawEnd: metrics.lastDrawEnd,
        display: now,
        complete: performance.now()
      };

      if (vf) {
        const idx = videoFrameTimes.indexOf(vf);
        if (idx !== -1) {
          const droppedVideoFrameTimes = videoFrameTimes.splice(0, idx + 1);
          droppedVideoFrameTimes.pop();
          for (const v of droppedVideoFrameTimes) {
            frameTimes.push({ video: v });
          }
        }
      }

      frameTimes.push(ft);
      if (frameTimes.length > 120) frameTimes = frameTimes.slice(-120);
    }

    rafLoopId = requestAnimationFrame(statsLoop);
  }

  function createOverlay() {
    const container = document.body;
    if (!container) return;
    if (overlayEl) {
      if (hostEl && hostEl.parentElement !== container) {
        container.appendChild(hostEl);
      } else if (!hostEl && overlayEl.parentElement !== container) {
        container.appendChild(overlayEl);
      }
      return;
    }

    hostEl = document.createElement('div');
    hostEl.id = 'cineglow-stats-host';
    hostEl.className = 'cineglow-stats-host';
    hostEl.style.position = 'fixed';
    hostEl.style.top = '0';
    hostEl.style.left = '0';
    hostEl.style.width = '100vw';
    hostEl.style.height = '100vh';
    hostEl.style.pointerEvents = 'none';
    hostEl.style.zIndex = '2147483647';

    if (typeof hostEl.attachShadow === 'function') {
      try {
        shadowRoot = hostEl.attachShadow({ mode: 'open' });
      } catch (_) {
        shadowRoot = hostEl;
      }
    } else {
      shadowRoot = hostEl;
    }

    const styleEl = document.createElement('style');
    styleEl.textContent = `
#aura-stats-overlay {
  position: absolute;
  top: 65px;
  right: 20px;
  z-index: 2147483647;
  background: rgba(15, 17, 23, 0.88);
  color: #e2e8f0;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 11px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  pointer-events: auto;
  cursor: grab;
  backdrop-filter: blur(16px) saturate(160%);
  user-select: none;
  min-width: 320px;
  max-width: 380px;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.1);
  transition: opacity 0.2s ease, transform 0.1s ease;
}
#aura-stats-overlay:active { cursor: grabbing; }
.aura-stats-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  padding-bottom: 7px;
  margin-bottom: 8px;
}
.aura-stats-title-wrap { display: flex; align-items: center; gap: 6px; }
.aura-stats-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #38bdf8;
  box-shadow: 0 0 8px #38bdf8;
}
.aura-stats-title {
  font-weight: 700;
  color: #f8fafc;
  font-size: 11px;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
}
.aura-stats-actions { display: flex; align-items: center; gap: 4px; }
.aura-stats-icon-btn {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: #cbd5e1;
  border-radius: 6px;
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}
.aura-stats-icon-btn:hover {
  background: rgba(255, 255, 255, 0.2);
  color: #fff;
  border-color: rgba(255, 255, 255, 0.25);
}
.aura-stats-icon-btn.active {
  background: rgba(56, 189, 248, 0.25);
  color: #38bdf8;
  border-color: rgba(56, 189, 248, 0.4);
}
.aura-stats-close-btn:hover {
  background: rgba(239, 68, 68, 0.8) !important;
  border-color: rgba(239, 68, 68, 0.9) !important;
  color: #fff !important;
}
.aura-stats-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  margin-bottom: 8px;
}
.aura-stat-card {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  padding: 5px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.aura-stat-card.full-width { grid-column: 1 / -1; }
.aura-stat-label {
  font-size: 9px;
  font-weight: 600;
  color: #94a3b8;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
}
.aura-stat-val-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.aura-stat-value {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11.5px;
  font-weight: 700;
  color: #f1f5f9;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.aura-stat-unit { font-size: 10px; color: #94a3b8; font-weight: 500; flex-shrink: 0; }
.aura-stat-subtitle {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 9.5px;
  color: #94a3b8;
  font-weight: 500;
  margin-top: 1px;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.aura-stat-badge {
  display: inline-block;
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  flex-shrink: 0;
}
.aura-badge-green { background: rgba(34, 197, 94, 0.2); color: #4ade80; border: 1px solid rgba(34, 197, 94, 0.3); }
.aura-badge-amber { background: rgba(245, 158, 11, 0.2); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); }
.aura-badge-blue { background: rgba(56, 189, 248, 0.2); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3); }
.aura-badge-red { background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); }
.aura-badge-purple { background: rgba(168, 85, 247, 0.2); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.3); }
.aura-stats-graph-section { display: flex; flex-direction: column; gap: 4px; transition: all 0.2s ease; }
.aura-stats-graph-section.collapsed { display: none !important; }
.aura-stats-graph-container {
  position: relative;
  width: 100%;
  height: 120px;
  background: rgba(0, 0, 0, 0.4);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  overflow: hidden;
}
#aura-stats-canvas { width: 100%; height: 100%; display: block; }
.aura-stats-legend {
  position: absolute;
  right: 4px;
  top: 4px;
  bottom: 4px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  font-size: 9px;
  color: #94a3b8;
  pointer-events: none;
  font-family: ui-monospace, SFMono-Regular, monospace;
  text-shadow: 0 1px 2px #000;
}
`;
    shadowRoot.appendChild(styleEl);

    overlayEl = document.createElement('div');
    overlayEl.id = 'aura-stats-overlay';

    const header = document.createElement('div');
    header.className = 'aura-stats-header';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'aura-stats-title-wrap';

    const dot = document.createElement('span');
    dot.className = 'aura-stats-dot';

    const title = document.createElement('span');
    title.className = 'aura-stats-title';
    title.textContent = 'CineGlow HUD';

    titleWrap.appendChild(dot);
    titleWrap.appendChild(title);

    const actions = document.createElement('div');
    actions.className = 'aura-stats-actions';

    const graphToggleBtn = document.createElement('button');
    graphToggleBtn.className = `aura-stats-icon-btn aura-stats-graph-toggle${isGraphCollapsed ? '' : ' active'}`;
    graphToggleBtn.title = 'Toggle Frametimes Graph';
    const graphSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    graphSvg.setAttribute('width', '12');
    graphSvg.setAttribute('height', '12');
    graphSvg.setAttribute('viewBox', '0 0 24 24');
    graphSvg.setAttribute('fill', 'none');
    graphSvg.setAttribute('stroke', 'currentColor');
    graphSvg.setAttribute('stroke-width', '2.2');
    graphSvg.setAttribute('stroke-linecap', 'round');
    graphSvg.setAttribute('stroke-linejoin', 'round');
    const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    polyline.setAttribute('points', '22 12 18 12 15 21 9 3 6 12 2 12');
    graphSvg.appendChild(polyline);
    graphToggleBtn.appendChild(graphSvg);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'aura-stats-icon-btn aura-stats-close-btn';
    closeBtn.title = 'Close HUD';
    const closeSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    closeSvg.setAttribute('width', '12');
    closeSvg.setAttribute('height', '12');
    closeSvg.setAttribute('viewBox', '0 0 24 24');
    closeSvg.setAttribute('fill', 'none');
    closeSvg.setAttribute('stroke', 'currentColor');
    closeSvg.setAttribute('stroke-width', '2.4');
    closeSvg.setAttribute('stroke-linecap', 'round');
    closeSvg.setAttribute('stroke-linejoin', 'round');
    const lineOne = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    lineOne.setAttribute('x1', '18');
    lineOne.setAttribute('y1', '6');
    lineOne.setAttribute('x2', '6');
    lineOne.setAttribute('y2', '18');
    const lineTwo = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    lineTwo.setAttribute('x1', '6');
    lineTwo.setAttribute('y1', '6');
    lineTwo.setAttribute('x2', '18');
    lineTwo.setAttribute('y2', '18');
    closeSvg.appendChild(lineOne);
    closeSvg.appendChild(lineTwo);
    closeBtn.appendChild(closeSvg);

    actions.appendChild(graphToggleBtn);
    actions.appendChild(closeBtn);

    header.appendChild(titleWrap);
    header.appendChild(actions);

    const grid = document.createElement('div');
    grid.className = 'aura-stats-grid';

    const createCard = (label, valClass = '', isFullWidth = false) => {
      const card = document.createElement('div');
      card.className = `aura-stat-card${isFullWidth ? ' full-width' : ''}`;

      const lbl = document.createElement('span');
      lbl.className = 'aura-stat-label';
      lbl.textContent = label;

      const row = document.createElement('div');
      row.className = 'aura-stat-val-row';

      const val = document.createElement('span');
      val.className = `aura-stat-value ${valClass}`.trim();
      val.textContent = '--';

      row.appendChild(val);
      card.appendChild(lbl);
      card.appendChild(row);

      return { card, row, val };
    };

    const cVideo = createCard('Video FPS');
    refs.videoVal = cVideo.val;
    refs.videoUnit = document.createElement('span');
    refs.videoUnit.className = 'aura-stat-unit';
    refs.videoUnit.textContent = '(0.0ms)';
    cVideo.row.appendChild(refs.videoUnit);
    grid.appendChild(cVideo.card);

    const cDisplay = createCard('Display');
    refs.displayVal = cDisplay.val;
    refs.displayUnit = document.createElement('span');
    refs.displayUnit.className = 'aura-stat-unit';
    refs.displayUnit.textContent = '(0.0ms)';
    cDisplay.row.appendChild(refs.displayUnit);
    grid.appendChild(cDisplay.card);

    const cRes = createCard('Resolution');
    refs.resVal = cRes.val;
    refs.resBadge = document.createElement('span');
    refs.resBadge.className = 'aura-stat-badge aura-badge-blue';
    refs.resBadge.textContent = 'HD';
    cRes.row.appendChild(refs.resBadge);
    grid.appendChild(cRes.card);

    const cVideoBitrate = createCard('Video Bitrate');
    refs.videoBitrateVal = cVideoBitrate.val;
    refs.videoBitrateBadge = document.createElement('span');
    refs.videoBitrateBadge.className = 'aura-stat-badge aura-badge-purple';
    refs.videoBitrateBadge.textContent = 'STREAM';
    cVideoBitrate.row.appendChild(refs.videoBitrateBadge);
    grid.appendChild(cVideoBitrate.card);

    const cNetSpeed = createCard('Net Speed');
    refs.netSpeedVal = cNetSpeed.val;
    refs.netSpeedBadge = document.createElement('span');
    refs.netSpeedBadge.className = 'aura-stat-badge aura-badge-green';
    refs.netSpeedBadge.textContent = 'FAST';
    cNetSpeed.row.appendChild(refs.netSpeedBadge);
    grid.appendChild(cNetSpeed.card);

    const cBuffer = createCard('Buffer Health');
    refs.bufferVal = cBuffer.val;
    refs.bufferBadge = document.createElement('span');
    refs.bufferBadge.className = 'aura-stat-badge aura-badge-green';
    refs.bufferBadge.textContent = 'HEALTHY';
    cBuffer.row.appendChild(refs.bufferBadge);
    grid.appendChild(cBuffer.card);

    const cCodec = createCard('Codec & Audio');
    refs.codecVal = cCodec.val;
    refs.audioBadge = document.createElement('span');
    refs.audioBadge.className = 'aura-stat-badge aura-badge-blue';
    refs.audioBadge.textContent = 'Opus';
    cCodec.row.appendChild(refs.audioBadge);
    refs.audioSubtitle = document.createElement('div');
    refs.audioSubtitle.className = 'aura-stat-subtitle';
    refs.audioSubtitle.textContent = 'Stereo • 48 kHz';
    cCodec.card.appendChild(refs.audioSubtitle);
    grid.appendChild(cCodec.card);

    const cColor = createCard('Color Depth & Range');
    refs.colorVal = cColor.val;
    refs.hdrBadge = document.createElement('span');
    refs.hdrBadge.className = 'aura-stat-badge aura-badge-blue';
    refs.hdrBadge.textContent = 'SDR';
    cColor.row.appendChild(refs.hdrBadge);
    refs.colorSubtitle = document.createElement('div');
    refs.colorSubtitle.className = 'aura-stat-subtitle';
    refs.colorSubtitle.textContent = '8-bit • Limited (TV)';
    cColor.card.appendChild(refs.colorSubtitle);
    grid.appendChild(cColor.card);

    const cDrop = createCard('Dropped Frames');
    refs.dropVal = cDrop.val;
    refs.dropBadge = document.createElement('span');
    refs.dropBadge.className = 'aura-stat-badge aura-badge-green';
    refs.dropBadge.textContent = '0.0%';
    cDrop.row.appendChild(refs.dropBadge);
    grid.appendChild(cDrop.card);

    const cAmbient = createCard('Ambient Glow');
    refs.ambientVal = cAmbient.val;
    refs.ambientUnit = document.createElement('span');
    refs.ambientUnit.className = 'aura-stat-unit';
    refs.ambientUnit.textContent = '(0.0ms)';
    cAmbient.row.appendChild(refs.ambientUnit);
    grid.appendChild(cAmbient.card);

    const graphSection = document.createElement('div');
    graphSection.className = `aura-stats-graph-section${isGraphCollapsed ? ' collapsed' : ''}`;

    const graphContainer = document.createElement('div');
    graphContainer.className = 'aura-stats-graph-container';

    refs.canvas = document.createElement('canvas');
    refs.canvas.id = 'aura-stats-canvas';
    refs.canvas.width = 336;
    refs.canvas.height = 120;
    graphContainer.appendChild(refs.canvas);

    const legend = document.createElement('div');
    legend.className = 'aura-stats-legend';

    refs.max = document.createElement('div');
    refs.max.id = 'aura-stat-max';
    refs.max.textContent = '0.0ms';
    legend.appendChild(refs.max);

    const spacer = document.createElement('div');
    spacer.style.flex = '1';
    legend.appendChild(spacer);

    refs.min = document.createElement('div');
    refs.min.id = 'aura-stat-min';
    refs.min.textContent = '0.0ms';
    legend.appendChild(refs.min);

    graphContainer.appendChild(legend);
    graphSection.appendChild(graphContainer);

    graphToggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      isGraphCollapsed = !isGraphCollapsed;
      chrome.storage?.local?.set({ cineglow_hud_graph_collapsed: isGraphCollapsed }).catch(() => {});
      graphSection.classList.toggle('collapsed', isGraphCollapsed);
      graphToggleBtn.classList.toggle('active', !isGraphCollapsed);
      if (!isGraphCollapsed) {
        if (!rafLoopId && updateInterval && !document.hidden) {
          rafLoopId = requestAnimationFrame(statsLoop);
        }
        drawFrametimesCanvas();
      } else {
        probeDisplayRefreshRate();
      }
    });
    graphToggleBtn.addEventListener('mousedown', (e) => e.stopPropagation());

    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      settings.statsEnabled = false;
      chrome.storage?.sync?.set({ statsEnabled: false }).catch(() => {});
      applyState();
    });
    closeBtn.addEventListener('mousedown', (e) => e.stopPropagation());

    overlayEl.appendChild(header);
    overlayEl.appendChild(grid);
    overlayEl.appendChild(graphSection);

    if (shadowRoot && shadowRoot !== hostEl) {
      shadowRoot.appendChild(overlayEl);
      container.appendChild(hostEl);
    } else {
      container.appendChild(overlayEl);
    }

    makeDraggable(overlayEl);

    window.addEventListener('resize', clampOverlayPosition, { passive: true });
    dragCleanups.push(() => {
      window.removeEventListener('resize', clampOverlayPosition);
    });
  }

  function clampOverlayPosition() {
    if (!overlayEl || !overlayEl.isConnected || !overlayEl.style.left || overlayEl.offsetWidth === 0) return;

    const pWidth = window.innerWidth;
    const pHeight = window.innerHeight;
    const currentLeft = overlayEl.offsetLeft;
    const currentTop = overlayEl.offsetTop;

    const maxLeft = Math.max(0, pWidth - overlayEl.offsetWidth);
    const maxTop = Math.max(0, pHeight - overlayEl.offsetHeight);

    overlayEl.style.left = `${Math.max(0, Math.min(currentLeft, maxLeft))}px`;
    overlayEl.style.top = `${Math.max(0, Math.min(currentTop, maxTop))}px`;
    overlayEl.style.right = 'auto';
    overlayEl.style.bottom = 'auto';
  }

  function removeOverlay() {
    if (overlayEl) {
      dragCleanups.forEach((c) => c());
      dragCleanups = [];
      overlayEl.remove();
      overlayEl = null;
      refs = {};
    }
    if (hostEl) {
      hostEl.remove();
      hostEl = null;
    }
    shadowRoot = null;
  }

  function resetStats() {
    lastTime = performance.now();
    lastPresentedFrames = 0;
    rvfcFrames = 0;
    displayFrames = 0;
    lastDisplayFrames = 0;
    lastGlowRenders = window.CineGlowMetrics ? window.CineGlowMetrics.renderCount : 0;
    lastVideoFps = 0;
    lastGlowFps = 0;
    lastDisplayFps = 0;
    videoFrameTimes = [];
    frameTimes = [];
    nerdStats = null;
    if (video && typeof video.getVideoPlaybackQuality === 'function') {
      const q = video.getVideoPlaybackQuality();
      lastPresentedFrames = q.totalVideoFrames - q.droppedVideoFrames;
    }
  }

  function startMonitoring() {
    if (isKilled || window.CineGlowKilled) return;
    if (updateInterval) clearInterval(updateInterval);
    if (rafLoopId) cancelAnimationFrame(rafLoopId);
    if (probeRafId) cancelAnimationFrame(probeRafId);

    resetStats();
    if (useRvfc && video && !document.hidden) {
      if (rvfcId) video.cancelVideoFrameCallback(rvfcId);
      rvfcId = video.requestVideoFrameCallback(onRvfc);
    }
    if (!isGraphCollapsed && !document.hidden) {
      rafLoopId = requestAnimationFrame(statsLoop);
    } else {
      probeDisplayRefreshRate();
    }
    updateInterval = setInterval(updateStats, 1000);
    updateStats();
  }

  function stopMonitoring() {
    if (updateInterval) {
      clearInterval(updateInterval);
      updateInterval = 0;
    }
    if (rvfcId && video) {
      video.cancelVideoFrameCallback(rvfcId);
      rvfcId = 0;
    }
    if (rafLoopId) {
      cancelAnimationFrame(rafLoopId);
      rafLoopId = 0;
    }
    if (probeRafId) {
      cancelAnimationFrame(probeRafId);
      probeRafId = 0;
    }
  }

  const handleVisibilityChange = () => {
    if (isKilled || !settings.statsEnabled || !updateInterval) return;
    if (!document.hidden) {
      lastTime = performance.now();
      rvfcFrames = 0;
      displayFrames = 0;
      lastDisplayFrames = 0;
      if (useRvfc && video && !rvfcId) {
        rvfcId = video.requestVideoFrameCallback(onRvfc);
      }
      if (!isGraphCollapsed && !rafLoopId) {
        rafLoopId = requestAnimationFrame(statsLoop);
      } else if (isGraphCollapsed) {
        probeDisplayRefreshRate();
      }
      updateStats();
    }
  };
  document.addEventListener('visibilitychange', handleVisibilityChange);

  function updateStats() {
    if (isKilled || window.CineGlowKilled) return;
    if (!settings.statsEnabled || !overlayEl || document.hidden) return;

    const container = document.body;
    if (!container) return;
    if (hostEl && (hostEl.parentElement !== container || !document.contains(hostEl))) {
      container.appendChild(hostEl);
    } else if (!hostEl && (overlayEl.parentElement !== container || !document.contains(overlayEl))) {
      container.appendChild(overlayEl);
    }

    try {
      window.postMessage({ type: 'CINEGLOW_GET_STATS_NERDS' }, window.location.origin);
    } catch (_) {}

    const now = performance.now();
    const dt = (now - lastTime) / 1000;
    if (dt <= 0) return;

    let vW = 0, vH = 0;
    let buffering = false;
    let playing = false;
    let droppedFrames = 0;
    let totalFrames = 0;

    if (video) {
      vW = video.videoWidth;
      vH = video.videoHeight;
      buffering = video.readyState < 3;
      playing = !video.paused && !video.ended;

      if (typeof video.getVideoPlaybackQuality === 'function') {
        const q = video.getVideoPlaybackQuality();
        droppedFrames = q.droppedVideoFrames;
        totalFrames = q.totalVideoFrames;
      }

      if (useRvfc) {
        if (playing && !buffering) {
          lastVideoFps = rvfcFrames / dt;
        } else if (!playing) {
          lastVideoFps = 0;
        }
        rvfcFrames = 0;
      } else if (typeof video.getVideoPlaybackQuality === 'function') {
        const q = video.getVideoPlaybackQuality();
        const currentPresented = q.totalVideoFrames - q.droppedVideoFrames;
        if (currentPresented < lastPresentedFrames) {
          lastVideoFps = 0;
        } else if (playing && !buffering) {
          lastVideoFps = (currentPresented - lastPresentedFrames) / dt;
        } else if (!playing) {
          lastVideoFps = 0;
        }
        lastPresentedFrames = currentPresented;
      }
    }

    const shouldAnimate = playing && !buffering && !(window.CineGlowPlayer?.isPiP && !settings.enableInPiP);
    if (shouldAnimate && !isGraphCollapsed) {
      if (!rafLoopId && updateInterval) rafLoopId = requestAnimationFrame(statsLoop);
      lastDisplayFps = (displayFrames - lastDisplayFrames) / dt;
    } else if (isGraphCollapsed) {
      probeDisplayRefreshRate();
    } else {
      lastDisplayFps = 0;
    }
    lastDisplayFrames = displayFrames;

    let glowDrawTime = '0.0';
    if (window.CineGlowMetrics) {
      const currentRenders = window.CineGlowMetrics.renderCount;
      if (playing && !buffering) {
        lastGlowFps = (currentRenders - lastGlowRenders) / dt;
      } else if (!playing) {
        lastGlowFps = 0;
      }
      lastGlowRenders = currentRenders;
      glowDrawTime = window.CineGlowMetrics.lastDrawTime > 0 ? window.CineGlowMetrics.lastDrawTime.toFixed(1) : '0.0';
    }

    lastTime = now;

    const displayMs = lastDisplayFps ? (1000 / lastDisplayFps).toFixed(1) : '0.0';
    const videoMs = lastVideoFps ? (1000 / lastVideoFps).toFixed(1) : '0.0';

    if (refs.videoVal) refs.videoVal.textContent = lastVideoFps.toFixed(2);
    if (refs.videoUnit) refs.videoUnit.textContent = `(${videoMs}ms)`;

    if (refs.displayVal) refs.displayVal.textContent = `${lastDisplayFps.toFixed(2)} Hz`;
    if (refs.displayUnit) refs.displayUnit.textContent = `(${displayMs}ms)`;

    if (refs.resVal) {
      refs.resVal.textContent = (vW && vH) ? `${vW}×${vH}` : '--';
    }
    if (refs.resBadge) {
      let badgeText = 'SD';
      let badgeClass = 'aura-badge-blue';
      if (vH >= 2160) {
        badgeText = '4K';
        badgeClass = 'aura-badge-amber';
      } else if (vH >= 1440) {
        badgeText = '1440p';
        badgeClass = 'aura-badge-blue';
      } else if (vH >= 1080) {
        badgeText = '1080p';
        badgeClass = 'aura-badge-blue';
      } else if (vH >= 720) {
        badgeText = '720p';
        badgeClass = 'aura-badge-blue';
      } else if (!vH) {
        badgeText = '--';
      }
      refs.resBadge.textContent = badgeText;
      refs.resBadge.className = `aura-stat-badge ${badgeClass}`;
    }

    let vidBitrateStr = '--';
    let vidBitrateBadge = 'STREAM';
    let vidBitrateClass = 'aura-badge-purple';

    const vBitrate = nerdStats ? (nerdStats.videoBitrate || nerdStats.averageBitrate) : null;
    if (vBitrate && !isNaN(Number(vBitrate))) {
      const bps = Number(vBitrate);
      vidBitrateStr = bps >= 1000000
        ? `${(bps / 1000000).toFixed(2)} Mbps`
        : `${Math.round(bps / 1000)} Kbps`;

      if (nerdStats.formatQuality) {
        vidBitrateBadge = nerdStats.formatQuality;
      } else if (bps >= 15000000) {
        vidBitrateBadge = 'ULTRA';
      } else if (bps >= 4000000) {
        vidBitrateBadge = 'HIGH';
      } else {
        vidBitrateBadge = 'STD';
      }
      vidBitrateClass = bps >= 10000000 ? 'aura-badge-purple' : (bps >= 3000000 ? 'aura-badge-blue' : 'aura-badge-green');
    }
    if (refs.videoBitrateVal) refs.videoBitrateVal.textContent = vidBitrateStr;
    if (refs.videoBitrateBadge) {
      refs.videoBitrateBadge.textContent = vidBitrateBadge;
      refs.videoBitrateBadge.className = `aura-stat-badge ${vidBitrateClass}`;
    }

    let speedStr = '--';
    let speedBadge = 'NET';
    let speedClass = 'aura-badge-blue';

    const bwRaw = nerdStats ? (nerdStats.bandwidth_kbps || nerdStats.bandwidth || nerdStats.connection_speed) : null;
    if (bwRaw) {
      const kbps = typeof bwRaw === 'number' ? bwRaw : parseFloat(String(bwRaw).replace(/[^0-9.]/g, ''));
      if (!isNaN(kbps) && kbps > 0) {
        speedStr = kbps >= 1000 ? `${(kbps / 1000).toFixed(1)} Mbps` : `${Math.round(kbps)} Kbps`;
        if (kbps >= 50000) {
          speedBadge = 'ULTRA';
          speedClass = 'aura-badge-purple';
        } else if (kbps >= 15000) {
          speedBadge = 'FAST';
          speedClass = 'aura-badge-green';
        } else if (kbps >= 4000) {
          speedBadge = 'GOOD';
          speedClass = 'aura-badge-blue';
        } else {
          speedBadge = 'LOW';
          speedClass = 'aura-badge-amber';
        }
      }
    }
    if (refs.netSpeedVal) refs.netSpeedVal.textContent = speedStr;
    if (refs.netSpeedBadge) {
      refs.netSpeedBadge.textContent = speedBadge;
      refs.netSpeedBadge.className = `aura-stat-badge ${speedClass}`;
    }

    let videoCodec = 'AVC';
    let audioCodec = 'AAC';
    let audioSubtitle = 'Stereo • 48 kHz';
    if (nerdStats?.codecs) {
      const parts = String(nerdStats.codecs).toLowerCase().split('/');
      const vPart = parts[0] || '';
      const aPart = parts[1] || '';

      if (vPart.includes('av01') || vPart.includes('av1')) {
        videoCodec = 'AV1';
      } else if (vPart.includes('vp09') || vPart.includes('vp9')) {
        videoCodec = 'VP9';
      } else if (vPart.includes('avc') || vPart.includes('h264')) {
        videoCodec = 'AVC';
      }

      if (aPart.includes('opus')) {
        audioCodec = 'Opus';
        audioSubtitle = 'Stereo • 48 kHz';
      } else if (aPart.includes('mp4a') || aPart.includes('aac')) {
        audioCodec = 'AAC';
        audioSubtitle = 'Stereo • 44.1 kHz';
      } else if (aPart.includes('vorbis')) {
        audioCodec = 'Vorbis';
        audioSubtitle = 'Stereo • 48 kHz';
      }

      if (String(nerdStats.codecs).includes('surround') || String(nerdStats.codecs).includes('5.1')) {
        audioSubtitle = '5.1 Surround';
      }
    }
    if (refs.codecVal) refs.codecVal.textContent = videoCodec;
    if (refs.audioBadge) {
      refs.audioBadge.textContent = audioCodec;
      refs.audioBadge.className = 'aura-stat-badge aura-badge-blue';
    }
    if (refs.audioSubtitle) {
      refs.audioSubtitle.textContent = audioSubtitle;
    }

    let colorSpace = 'BT.709';
    let colorDepth = '8-bit';
    let colorRange = 'Limited (TV)';
    let colorBadge = 'SDR';
    let colorClass = 'aura-badge-blue';

    const rawColor = nerdStats?.color ? String(nerdStats.color).toLowerCase() : '';
    const rawCodecs = nerdStats?.codecs ? String(nerdStats.codecs).toLowerCase() : '';
    const colorInfo = nerdStats?.colorInfo || null;

    if (rawColor.includes('bt2020') || (colorInfo && String(colorInfo.primaries).includes('BT2020'))) {
      colorSpace = 'BT.2020';
    } else if (rawColor.includes('dci-p3') || rawColor.includes('p3')) {
      colorSpace = 'DCI-P3';
    } else if (rawColor.includes('srgb')) {
      colorSpace = 'sRGB';
    } else if (rawColor.includes('bt709') || rawColor.includes('709') || (colorInfo && String(colorInfo.primaries).includes('BT709'))) {
      colorSpace = 'BT.709';
    }

    if (rawColor.includes('2084') || rawColor.includes('pq') || (colorInfo && String(colorInfo.transferCharacteristics).includes('SMPTE2084'))) {
      colorBadge = 'HDR10';
      colorClass = 'aura-badge-amber';
    } else if (rawColor.includes('arib') || rawColor.includes('hlg') || (colorInfo && String(colorInfo.transferCharacteristics).includes('ARIB'))) {
      colorBadge = 'HLG';
      colorClass = 'aura-badge-amber';
    } else if (rawColor.includes('bt2020') || rawCodecs.includes('vp09.02') || rawCodecs.includes('.10')) {
      colorBadge = 'HDR';
      colorClass = 'aura-badge-amber';
    }

    if (rawColor.includes('12-bit') || rawCodecs.includes('vp09.03')) {
      colorDepth = '12-bit';
    } else if (rawColor.includes('10-bit') || rawCodecs.includes('vp09.02') || rawCodecs.includes('.10') || colorBadge.startsWith('HDR') || colorBadge === 'HLG') {
      colorDepth = '10-bit';
    }

    colorRange = (rawColor.includes('full') || colorSpace === 'sRGB') ? 'Full (PC)' : 'Limited (TV)';

    if (refs.colorVal) refs.colorVal.textContent = colorSpace;
    if (refs.hdrBadge) {
      refs.hdrBadge.textContent = colorBadge;
      refs.hdrBadge.className = `aura-stat-badge ${colorClass}`;
    }
    if (refs.colorSubtitle) {
      refs.colorSubtitle.textContent = `${colorDepth} • ${colorRange}`;
    }

    let bufferAhead = 0;
    if (video?.buffered?.length > 0) {
      const cur = video.currentTime;
      for (let i = 0; i < video.buffered.length; i++) {
        if (cur >= video.buffered.start(i) && cur <= video.buffered.end(i)) {
          bufferAhead = Math.max(0, video.buffered.end(i) - cur);
          break;
        }
      }
    }
    if (!bufferAhead && nerdStats) {
      const bRaw = nerdStats.buffer_health_seconds || nerdStats.buffer_health;
      if (bRaw) {
        const b = parseFloat(String(bRaw).replace(/[^0-9.]/g, ''));
        if (!isNaN(b)) bufferAhead = b;
      }
    }

    let bufferBadge = 'HEALTHY';
    let bufferClass = 'aura-badge-green';
    if (bufferAhead >= 15) {
      bufferBadge = 'HEALTHY';
      bufferClass = 'aura-badge-green';
    } else if (bufferAhead >= 6) {
      bufferBadge = 'GOOD';
      bufferClass = 'aura-badge-blue';
    } else if (bufferAhead > 1) {
      bufferBadge = 'LOW';
      bufferClass = 'aura-badge-amber';
    } else {
      bufferBadge = video?.paused ? 'PAUSED' : 'STALL';
      bufferClass = 'aura-badge-red';
    }

    if (refs.bufferVal) refs.bufferVal.textContent = `${bufferAhead.toFixed(1)}s`;
    if (refs.bufferBadge) {
      refs.bufferBadge.textContent = bufferBadge;
      refs.bufferBadge.className = `aura-stat-badge ${bufferClass}`;
    }

    if (refs.dropVal) refs.dropVal.textContent = String(droppedFrames);
    if (refs.dropBadge) {
      const dropPct = totalFrames > 0 ? ((droppedFrames / totalFrames) * 100).toFixed(1) : '0.0';
      refs.dropBadge.textContent = `${dropPct}%`;
      let dropClass = 'aura-badge-green';
      const pctNum = parseFloat(dropPct);
      if (pctNum > 2.0) dropClass = 'aura-badge-red';
      else if (pctNum > 0.5) dropClass = 'aura-badge-amber';
      refs.dropBadge.className = `aura-stat-badge ${dropClass}`;
    }

    if (refs.ambientVal) refs.ambientVal.textContent = `${lastGlowFps.toFixed(1)} fps`;
    if (refs.ambientUnit) refs.ambientUnit.textContent = `(${glowDrawTime}ms)`;

    if (!isGraphCollapsed) {
      drawFrametimesCanvas();
    }
  }

  function drawFrametimesCanvas() {
    if (isGraphCollapsed || !refs.canvas || frameTimes.length === 0) return;
    const ctx = refs.canvas.getContext('2d', { alpha: true });
    if (!ctx) return;
    const width = 336;
    const height = 120;
    const xSize = 2.5;

    ctx.clearRect(0, 0, width, height);

    const displayFrameDuration = lastDisplayFps ? 1000 / Math.max(24, lastDisplayFps) : 1000 / 60;

    const offsettedFrameTimes = frameTimes.map((ft, i) => {
      const offset = ft.video?.display ?? (ft.video?.compose ? ft.video.compose + displayFrameDuration : ft.display);
      return {
        video: ft.video ? {
          decode: ft.video.decode - offset,
          present: ft.video.present - offset,
          compose: ft.video.compose - offset,
          receive: ft.video.receive - offset,
          display: ft.video.display - offset
        } : undefined,
        drawStart: ft.drawStart - offset,
        drawEnd: ft.drawEnd - offset,
        display: ft.display - offset,
        complete: ft.complete - offset,
        nextCompose: (i < frameTimes.length - 1 && frameTimes[i + 1].video) ? frameTimes[i + 1].video.compose - offset : undefined,
        nextDisplay: (i < frameTimes.length - 1 && frameTimes[i + 1].video) ? frameTimes[i + 1].video.display - offset : undefined
      };
    });

    const frameDurations = offsettedFrameTimes.map((ft) => ({
      decodeToPresent: ft.video ? [ft.video.decode, ft.video.present - ft.video.decode] : [],
      composeToReceive: ft.video ? [ft.video.compose, ft.video.receive - ft.video.compose] : [],
      presentToCompose: ft.video ? [ft.video.present, Math.max(0, ft.video.compose - ft.video.present)] : [],
      receiveToDrawStart: ft.video ? [ft.video.receive, ft.drawStart - ft.video.receive] : [],
      drawStartTodrawEnd: [ft.drawStart, ft.drawEnd - ft.drawStart],
      drawEndToDisplay: [ft.drawEnd, ft.display - ft.drawEnd],
      videoDisplay: ft.video ? ft.video.display : undefined,
      isDrawnBeforeVideoDisplay: ft.video && (!isFinite(ft.video.display) || ft.drawEnd <= ft.video.display),
      nextCompose: ft.nextCompose,
      nextDisplay: ft.nextDisplay,
      isDrawn: isFinite(ft.drawEnd)
    }));

    const averageMinTimes = offsettedFrameTimes
      .map((ft) => ft.video ? Math.min(Number.isFinite(ft.video.decode) ? ft.video.decode : Infinity, Number.isFinite(ft.video.compose) ? ft.video.compose : Infinity) : ft.drawStart)
      .filter(isFinite)
      .sort((a, b) => a - b);

    let min = 0, max = 0;
    if (averageMinTimes.length > 0) {
      const minPercentile90Length = Math.max(1, Math.floor(averageMinTimes.length * 0.9));
      const averageMinTimesPercentile90 = averageMinTimes.slice(-minPercentile90Length);
      min = Math.round(Math.min(...averageMinTimesPercentile90) / displayFrameDuration) * displayFrameDuration;
    }

    const averageMaxTimes = offsettedFrameTimes
      .map((ft) => Math.max(ft.video?.display ?? -999, Number.isFinite(ft.drawEnd) ? ft.drawEnd : -999, Number.isFinite(ft.nextCompose) ? ft.nextCompose : -999, Number.isFinite(ft.nextDisplay) ? ft.nextDisplay : -999))
      .filter(isFinite)
      .sort((a, b) => a - b);

    if (averageMaxTimes.length > 0) {
      const maxPercentile90Length = Math.max(1, Math.floor(averageMaxTimes.length * 0.9));
      const averageMaxTimesPercentile90 = averageMaxTimes.slice(0, maxPercentile90Length);
      max = Math.round(Math.max(...averageMaxTimesPercentile90) / displayFrameDuration) * displayFrameDuration;
    }

    if (refs.max) refs.max.textContent = `${max.toFixed(1)}ms`;
    if (refs.min) refs.min.textContent = `${min.toFixed(1)}ms`;

    const range = Math.max(1, max - min + displayFrameDuration);
    const yScale = height / range;
    const yLine = 1 / yScale;
    const offset = min - displayFrameDuration / 2;

    const frameRects = frameDurations.map((fd) => {
      const rects = [];
      if (!fd.isDrawn) rects.push(['#800', xSize, min - displayFrameDuration / 2, range]);
      if (fd.decodeToPresent.length) rects.push(['#06f', xSize, fd.decodeToPresent[0], fd.decodeToPresent[1]]);
      if (fd.composeToReceive.length) rects.push(['#666', 1, fd.composeToReceive[0], fd.composeToReceive[1]]);
      if (fd.presentToCompose.length) rects.push(['#f80', 1, fd.presentToCompose[0], fd.presentToCompose[1]]);
      rects.push(['#a0b', 1, fd.drawEndToDisplay[0], fd.drawEndToDisplay[1]]);
      if (fd.receiveToDrawStart.length) rects.push([fd.isDrawnBeforeVideoDisplay ? '#0b0' : '#db0', xSize, fd.receiveToDrawStart[0], fd.receiveToDrawStart[1]]);
      rects.push([fd.isDrawnBeforeVideoDisplay ? '#0f0' : '#ff0', xSize, fd.drawStartTodrawEnd[0], fd.drawStartTodrawEnd[1]]);

      if (isFinite(fd.nextCompose)) rects.push(['#666', 1, fd.nextCompose, yLine]);
      if (isFinite(fd.nextDisplay)) rects.push(['#fff', 1, fd.nextDisplay, yLine]);
      if (isFinite(fd.videoDisplay)) rects.push(['#0f0', 1, fd.videoDisplay, yLine]);

      return rects;
    });

    for (let i = 0; i < frameRects.length; i++) {
      const rectLines = frameRects[i];
      const x = i * xSize;
      for (const [color, xFrameSize, y, ySize] of rectLines) {
        if (isNaN(y) || isNaN(ySize) || ySize === 0) continue;
        ctx.fillStyle = color;
        ctx.fillRect(x + Math.floor((xSize - xFrameSize) / 2), Math.round((y - offset) * yScale), xFrameSize, Math.max(1, Math.round(ySize * yScale)));
      }
    }
  }

  let dragCleanups = [];

  function makeDraggable(el) {
    let isDragging = false;
    let startX, startY, initialX, initialY;

    const onMouseMove = (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      el.style.left = `${initialX + dx}px`;
      el.style.top = `${initialY + dy}px`;
      el.style.right = 'auto';
      el.style.bottom = 'auto';
    };

    const onMouseUp = () => {
      isDragging = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      clampOverlayPosition();
    };

    const onMouseDown = (e) => {
      if (e.target.closest('.aura-stats-actions') || e.target.closest('button')) return;
      e.stopPropagation();
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;

      if (!el.style.left) {
        el.style.left = `${el.offsetLeft}px`;
        el.style.top = `${el.offsetTop}px`;
        el.style.right = 'auto';
        el.style.bottom = 'auto';
      }

      initialX = el.offsetLeft;
      initialY = el.offsetTop;

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    };

    el.addEventListener('mousedown', onMouseDown);
    el.addEventListener('click', (e) => e.stopPropagation());
    el.addEventListener('dblclick', (e) => e.stopPropagation());

    dragCleanups.push(() => {
      if (isDragging) onMouseUp();
    });
  }

  function applyState() {
    if (isKilled || window.CineGlowKilled) return;
    const isWatchPage = window.CineGlowPlayer?.isWatchPage;
    if (settings.statsEnabled && isWatchPage) {
      createOverlay();
      if (video && !updateInterval) startMonitoring();
    } else {
      removeOverlay();
      stopMonitoring();
    }
  }

  const handleStorageChange = (changes, area) => {
    if (isKilled || window.CineGlowKilled) return;
    if (area === 'sync') {
      if ('statsEnabled' in changes) {
        settings.statsEnabled = changes.statsEnabled.newValue;
        applyState();
      }
      if ('enableInPiP' in changes) {
        settings.enableInPiP = changes.enableInPiP.newValue;
      }
    }
  };
  chrome.storage?.onChanged?.addListener(handleStorageChange);

  function teardownKillSwitch() {
    if (isKilled) return;
    isKilled = true;
    settings.statsEnabled = false;
    window.CineGlowKilled = true;

    chrome.storage?.onChanged?.removeListener(handleStorageChange);
    window.removeEventListener('message', handleStatsMessage);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    stopMonitoring();
    document.getElementById('cineglow-stats-host')?.remove();
    document.getElementById('aura-stats-overlay')?.remove();
    document.getElementById('cineglow-stats-overlay')?.remove();
    removeOverlay();

    video = null;
    videoFrameTimes = [];
    frameTimes = [];
    nerdStats = null;
  }

  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage?.addListener) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === 'AURA_EMERGENCY_KILL_SWITCH') {
        teardownKillSwitch();
        if (!window._cineglowKillEventFired) {
          window._cineglowKillEventFired = true;
          window.dispatchEvent(new CustomEvent('cineglow:kill-switch', { detail: message }));
        }
        if (typeof sendResponse === 'function') {
          sendResponse({ success: true, script: 'stats-overlay.js' });
        }
      }
    });
  }

  window.addEventListener('cineglow:kill-switch', () => {
    teardownKillSwitch();
  }, { once: true });

  window.CineGlowStatsTeardown = teardownKillSwitch;

  if (window.CineGlowPlayer) {
    if (window.CineGlowPlayer.isWatchPage && window.CineGlowPlayer.video) {
      video = window.CineGlowPlayer.video;
      applyState();
    }

    window.CineGlowPlayer.addEventListener('state-change', (e) => {
      if (isKilled) return;
      const state = e.detail;
      if (!state.isWatchPage) {
        stopMonitoring();
        video = null;
        applyState();
        return;
      }

      if (video !== state.video) {
        stopMonitoring();
        video = state.video;
        applyState();
      } else {
        applyState();
        if (settings.statsEnabled) updateStats();
      }
    });
  }

  async function loadSettings() {
    if (isKilled || window.CineGlowKilled) return;
    try {
      const [stored, localStored] = await Promise.all([
        chrome.storage?.sync?.get(['statsEnabled', 'enableInPiP']) || Promise.resolve({}),
        chrome.storage?.local?.get(['cineglow_hud_graph_collapsed']).catch(() => ({})) || Promise.resolve({})
      ]);
      settings.statsEnabled = !!stored.statsEnabled;
      settings.enableInPiP = !!stored.enableInPiP;
      if (typeof localStored?.cineglow_hud_graph_collapsed === 'boolean') {
        isGraphCollapsed = localStored.cineglow_hud_graph_collapsed;
      }
      applyState();
    } catch (err) {
      console.warn('[Aura] Could not load stats settings:', err);
    }
  }

  loadSettings();
})();

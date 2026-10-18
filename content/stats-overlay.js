(() => {
  'use strict';

  let settings = { statsEnabled: false, enableInPiP: false };
  let overlayEl = null;
  let video = null;
  let updateInterval = 0;
  
  let isGraphCollapsed = true;
  try {
    const saved = localStorage.getItem('cineglow_hud_graph_collapsed');
    if (saved !== null) {
      isGraphCollapsed = saved === 'true';
    }
  } catch (e) {}

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
  let useRvfc = 'requestVideoFrameCallback' in HTMLVideoElement.prototype;

  let videoFrameTimes = [];
  let frameTimes = [];
  let rafLoopId = 0;
  let lastSeenRenderCount = -1;
  let displayFrames = 0;
  let lastDisplayFrames = 0;
  let lastDisplayFps = 0;

  // Listen for Stats for Nerds response from MAIN world
  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || event.data.type !== 'CINEGLOW_STATS_NERDS_RESPONSE') return;
    nerdStats = event.data.stats || null;
  });

  function onRvfc(now, metadata) {
    if (!updateInterval) return;
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
    if (!updateInterval) return;
    
    // Stop the rAF loop if the video is paused/ended and CineGlow rendering has settled.
    if (video && (video.paused || video.ended) && window.CineGlowMetrics && lastSeenRenderCount === window.CineGlowMetrics.renderCount) {
      rafLoopId = 0;
      return;
    }

    // Stop if we shouldn't draw in PiP
    if (window.CineGlowPlayer && window.CineGlowPlayer.isPiP && !settings.enableInPiP) {
      rafLoopId = 0;
      return;
    }
    
    displayFrames++;
    
    if (!isGraphCollapsed) {
      let currentRenderCount = window.CineGlowMetrics ? window.CineGlowMetrics.renderCount : 0;
      if (currentRenderCount !== lastSeenRenderCount) {
        lastSeenRenderCount = currentRenderCount;
        const vf = videoFrameTimes[videoFrameTimes.length - 1];
        
        let ft = {
          video: vf,
          drawStart: window.CineGlowMetrics.lastDrawStart,
          drawEnd: window.CineGlowMetrics.lastDrawEnd,
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
    }

    rafLoopId = requestAnimationFrame(statsLoop);
  }

  function createOverlay() {
    const container = document.body;
    if (overlayEl) {
      if (overlayEl.parentElement !== container) {
        container.appendChild(overlayEl);
      }
      return;
    }
    overlayEl = document.createElement('div');
    overlayEl.id = 'aura-stats-overlay';
    
    // 1. Header
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

    // Graph toggle button (Trusted Types safe)
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

    // Close button (Trusted Types safe)
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
    const l1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    l1.setAttribute('x1', '18'); l1.setAttribute('y1', '6'); l1.setAttribute('x2', '6'); l1.setAttribute('y2', '18');
    const l2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    l2.setAttribute('x1', '6'); l2.setAttribute('y1', '6'); l2.setAttribute('x2', '18'); l2.setAttribute('y2', '18');
    closeSvg.appendChild(l1);
    closeSvg.appendChild(l2);
    closeBtn.appendChild(closeSvg);

    actions.appendChild(graphToggleBtn);
    actions.appendChild(closeBtn);

    header.appendChild(titleWrap);
    header.appendChild(actions);

    // 2. Telemetry Grid (6 Cards)
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

    // Card 1: Video FPS
    const cVideo = createCard('Video FPS');
    refs.videoVal = cVideo.val;
    refs.videoUnit = document.createElement('span');
    refs.videoUnit.className = 'aura-stat-unit';
    refs.videoUnit.textContent = '(0.0ms)';
    cVideo.row.appendChild(refs.videoUnit);
    grid.appendChild(cVideo.card);

    // Card 2: Display Refresh
    const cDisplay = createCard('Display');
    refs.displayVal = cDisplay.val;
    refs.displayUnit = document.createElement('span');
    refs.displayUnit.className = 'aura-stat-unit';
    refs.displayUnit.textContent = '(0.0ms)';
    cDisplay.row.appendChild(refs.displayUnit);
    grid.appendChild(cDisplay.card);

    // Card 3: Resolution & Aspect
    const cRes = createCard('Resolution');
    refs.resVal = cRes.val;
    refs.resBadge = document.createElement('span');
    refs.resBadge.className = 'aura-stat-badge aura-badge-blue';
    refs.resBadge.textContent = 'HD';
    cRes.row.appendChild(refs.resBadge);
    grid.appendChild(cRes.card);

    // Card 4: Video Bitrate (Encoded Stream Rate)
    const cVideoBitrate = createCard('Video Bitrate');
    refs.videoBitrateVal = cVideoBitrate.val;
    refs.videoBitrateBadge = document.createElement('span');
    refs.videoBitrateBadge.className = 'aura-stat-badge aura-badge-purple';
    refs.videoBitrateBadge.textContent = 'STREAM';
    cVideoBitrate.row.appendChild(refs.videoBitrateBadge);
    grid.appendChild(cVideoBitrate.card);

    // Card 5: Net Speed / Connection Bandwidth
    const cNetSpeed = createCard('Net Speed');
    refs.netSpeedVal = cNetSpeed.val;
    refs.netSpeedBadge = document.createElement('span');
    refs.netSpeedBadge.className = 'aura-stat-badge aura-badge-green';
    refs.netSpeedBadge.textContent = 'FAST';
    cNetSpeed.row.appendChild(refs.netSpeedBadge);
    grid.appendChild(cNetSpeed.card);

    // Card 6: Buffer Health
    const cBuffer = createCard('Buffer Health');
    refs.bufferVal = cBuffer.val;
    refs.bufferBadge = document.createElement('span');
    refs.bufferBadge.className = 'aura-stat-badge aura-badge-green';
    refs.bufferBadge.textContent = 'HEALTHY';
    cBuffer.row.appendChild(refs.bufferBadge);
    grid.appendChild(cBuffer.card);

    // Card 7: Codec & Audio
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

    // Card 8: Color Depth & Range
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

    // Card 9: Dropped Frames
    const cDrop = createCard('Dropped Frames');
    refs.dropVal = cDrop.val;
    refs.dropBadge = document.createElement('span');
    refs.dropBadge.className = 'aura-stat-badge aura-badge-green';
    refs.dropBadge.textContent = '0.0%';
    cDrop.row.appendChild(refs.dropBadge);
    grid.appendChild(cDrop.card);

    // Card 10: Ambient Glow Engine
    const cAmbient = createCard('Ambient Glow');
    refs.ambientVal = cAmbient.val;
    refs.ambientUnit = document.createElement('span');
    refs.ambientUnit.className = 'aura-stat-unit';
    refs.ambientUnit.textContent = '(0.0ms)';
    cAmbient.row.appendChild(refs.ambientUnit);
    grid.appendChild(cAmbient.card);

    // 3. Collapsible Frametimes Graph Section
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

    // Event Listeners for Header Actions
    graphToggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      isGraphCollapsed = !isGraphCollapsed;
      try {
        localStorage.setItem('cineglow_hud_graph_collapsed', String(isGraphCollapsed));
      } catch (err) {}
      graphSection.classList.toggle('collapsed', isGraphCollapsed);
      graphToggleBtn.classList.toggle('active', !isGraphCollapsed);
      if (!isGraphCollapsed) {
        drawFrametimesCanvas();
      }
    });
    graphToggleBtn.addEventListener('mousedown', e => e.stopPropagation());

    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      settings.statsEnabled = false;
      try {
        chrome.storage.sync.set({ statsEnabled: false });
      } catch (err) {}
      applyState();
    });
    closeBtn.addEventListener('mousedown', e => e.stopPropagation());

    // Assemble Overlay
    overlayEl.appendChild(header);
    overlayEl.appendChild(grid);
    overlayEl.appendChild(graphSection);
    
    container.appendChild(overlayEl);

    makeDraggable(overlayEl);
    
    window.addEventListener('resize', clampOverlayPosition, { passive: true });
    dragCleanups.push(() => {
      window.removeEventListener('resize', clampOverlayPosition);
    });
  }

  function clampOverlayPosition() {
    if (!overlayEl) return;
    const parent = overlayEl.parentElement;
    if (!parent) return;
    
    const pWidth = parent === document.body ? window.innerWidth : parent.clientWidth;
    const pHeight = parent === document.body ? window.innerHeight : parent.clientHeight;
    
    let currentLeft = overlayEl.offsetLeft;
    let currentTop = overlayEl.offsetTop;
    
    if (!overlayEl.style.left) {
      const rect = overlayEl.getBoundingClientRect();
      const parentRect = parent.getBoundingClientRect();
      currentLeft = rect.left - parentRect.left;
      currentTop = rect.top - parentRect.top;
    }
    
    const maxLeft = Math.max(0, pWidth - overlayEl.offsetWidth);
    const maxTop = Math.max(0, pHeight - overlayEl.offsetHeight);
    
    const newLeft = Math.max(0, Math.min(currentLeft, maxLeft));
    const newTop = Math.max(0, Math.min(currentTop, maxTop));
    
    if (currentLeft !== newLeft || currentTop !== newTop || !overlayEl.style.left) {
      overlayEl.style.left = `${newLeft}px`;
      overlayEl.style.top = `${newTop}px`;
      overlayEl.style.right = 'auto';
      overlayEl.style.bottom = 'auto';
    }
  }

  function removeOverlay() {
    if (overlayEl) {
      if (typeof dragCleanups !== 'undefined') {
        dragCleanups.forEach(c => c());
        dragCleanups = [];
      }
      overlayEl.remove();
      overlayEl = null;
      refs = {};
    }
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
    if (updateInterval) clearInterval(updateInterval);
    if (rafLoopId) cancelAnimationFrame(rafLoopId);
    
    resetStats();
    if (useRvfc && video) {
      if (rvfcId) video.cancelVideoFrameCallback(rvfcId);
      rvfcId = video.requestVideoFrameCallback(onRvfc);
    }
    rafLoopId = requestAnimationFrame(statsLoop);
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
  }

  function updateStats() {
    if (!settings.statsEnabled || !overlayEl) return;
    
    // Ensure overlay is still in the DOM (YouTube SPA navigation can detach it)
    const container = document.body;
    if (overlayEl.parentElement !== container || !document.contains(overlayEl)) {
      container.appendChild(overlayEl);
    }

    // Request fresh Stats for Nerds (codecs, color, format) from MAIN world
    try {
      window.postMessage({ type: 'CINEGLOW_GET_STATS_NERDS' }, '*');
    } catch (e) {}

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
    
    const shouldAnimate = playing && !buffering && !(window.CineGlowPlayer && window.CineGlowPlayer.isPiP && !settings.enableInPiP);
    if (shouldAnimate) {
      if (!rafLoopId && updateInterval) rafLoopId = requestAnimationFrame(statsLoop);
      lastDisplayFps = (displayFrames - lastDisplayFrames) / dt;
    } else if (!playing) {
      lastDisplayFps = 0;
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

    // 1. Video FPS
    if (refs.videoVal) refs.videoVal.textContent = lastVideoFps.toFixed(2);
    if (refs.videoUnit) refs.videoUnit.textContent = `(${videoMs}ms)`;

    // 2. Display
    if (refs.displayVal) refs.displayVal.textContent = `${lastDisplayFps.toFixed(2)} Hz`;
    if (refs.displayUnit) refs.displayUnit.textContent = `(${displayMs}ms)`;

    // 3. Resolution & Quality Badge
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

    // 4. Video Bitrate (Encoded Stream Quality)
    let vidBitrateStr = '--';
    let vidBitrateBadge = 'STREAM';
    let vidBitrateClass = 'aura-badge-purple';

    const vBitrate = nerdStats ? (nerdStats.videoBitrate || nerdStats.averageBitrate) : null;
    if (vBitrate && !isNaN(Number(vBitrate))) {
      const bps = Number(vBitrate);
      if (bps >= 1000000) {
        vidBitrateStr = `${(bps / 1000000).toFixed(2)} Mbps`;
      } else {
        vidBitrateStr = `${Math.round(bps / 1000)} Kbps`;
      }

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

    // 5. Net Speed / Bandwidth
    let speedStr = '--';
    let speedBadge = 'NET';
    let speedClass = 'aura-badge-blue';

    const bwRaw = nerdStats ? (nerdStats.bandwidth_kbps || nerdStats.bandwidth || nerdStats.connection_speed) : null;
    if (bwRaw) {
      const kbps = typeof bwRaw === 'number' ? bwRaw : parseFloat(String(bwRaw).replace(/[^0-9.]/g, ''));
      if (!isNaN(kbps) && kbps > 0) {
        if (kbps >= 1000) {
          speedStr = `${(kbps / 1000).toFixed(1)} Mbps`;
        } else {
          speedStr = `${Math.round(kbps)} Kbps`;
        }
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

    // 7. Codec & Audio
    let videoCodec = 'AVC';
    let audioCodec = 'AAC';
    let audioSubtitle = 'Stereo • 48 kHz';
    if (nerdStats && nerdStats.codecs) {
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

    // 8. Color Depth & Range
    let colorSpace = 'BT.709';
    let colorDepth = '8-bit';
    let colorRange = 'Limited (TV)';
    let colorBadge = 'SDR';
    let colorClass = 'aura-badge-blue';

    const rawColor = nerdStats && nerdStats.color ? String(nerdStats.color).toLowerCase() : '';
    const rawCodecs = nerdStats && nerdStats.codecs ? String(nerdStats.codecs).toLowerCase() : '';
    const colorInfo = nerdStats && nerdStats.colorInfo ? nerdStats.colorInfo : null;

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
    } else {
      colorBadge = 'SDR';
      colorClass = 'aura-badge-blue';
    }

    if (rawColor.includes('12-bit') || rawCodecs.includes('vp09.03')) {
      colorDepth = '12-bit';
    } else if (rawColor.includes('10-bit') || rawCodecs.includes('vp09.02') || rawCodecs.includes('.10') || colorBadge.startsWith('HDR') || colorBadge === 'HLG') {
      colorDepth = '10-bit';
    } else {
      colorDepth = '8-bit';
    }

    if (rawColor.includes('full') || colorSpace === 'sRGB') {
      colorRange = 'Full (PC)';
    } else {
      colorRange = 'Limited (TV)';
    }

    if (refs.colorVal) refs.colorVal.textContent = colorSpace;
    if (refs.hdrBadge) {
      refs.hdrBadge.textContent = colorBadge;
      refs.hdrBadge.className = `aura-stat-badge ${colorClass}`;
    }
    if (refs.colorSubtitle) {
      refs.colorSubtitle.textContent = `${colorDepth} • ${colorRange}`;
    }

    // 7. Buffer Health
    let bufferAhead = 0;
    if (video && video.buffered && video.buffered.length > 0) {
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
      bufferBadge = (video && video.paused) ? 'PAUSED' : 'STALL';
      bufferClass = 'aura-badge-red';
    }

    if (refs.bufferVal) refs.bufferVal.textContent = `${bufferAhead.toFixed(1)}s`;
    if (refs.bufferBadge) {
      refs.bufferBadge.textContent = bufferBadge;
      refs.bufferBadge.className = `aura-stat-badge ${bufferClass}`;
    }

    // 8. Dropped Frames & Rate
    if (refs.dropVal) {
      refs.dropVal.textContent = String(droppedFrames);
    }
    if (refs.dropBadge) {
      const dropPct = totalFrames > 0 ? ((droppedFrames / totalFrames) * 100).toFixed(1) : '0.0';
      refs.dropBadge.textContent = `${dropPct}%`;
      let dropClass = 'aura-badge-green';
      const pctNum = parseFloat(dropPct);
      if (pctNum > 2.0) {
        dropClass = 'aura-badge-red';
      } else if (pctNum > 0.5) {
        dropClass = 'aura-badge-amber';
      }
      refs.dropBadge.className = `aura-stat-badge ${dropClass}`;
    }

    // 10. Ambient Glow Engine
    if (refs.ambientVal) {
      refs.ambientVal.textContent = `${lastGlowFps.toFixed(1)} fps`;
    }
    if (refs.ambientUnit) {
      refs.ambientUnit.textContent = `(${glowDrawTime}ms)`;
    }

    if (!isGraphCollapsed) {
      drawFrametimesCanvas();
    }
  }

  function drawFrametimesCanvas() {
    if (isGraphCollapsed || !refs.canvas || frameTimes.length === 0) return;
    const ctx = refs.canvas.getContext('2d', { alpha: true });
    const width = 336;
    const height = 120;
    const xSize = 2.5;
    
    ctx.clearRect(0, 0, width, height);
    
    const displayFrameDuration = lastDisplayFps ? 1000 / Math.max(24, lastDisplayFps) : 1000 / 60;
    
    const offsettedFrameTimes = frameTimes.map((ft, i) => {
      const offset = (ft.video && ft.video.display) ? ft.video.display : ((ft.video && ft.video.compose) ? ft.video.compose + displayFrameDuration : ft.display);
      return {
        video: ft.video ? {
          decode: ft.video.decode - offset,
          present: ft.video.present - offset,
          compose: ft.video.compose - offset,
          receive: ft.video.receive - offset,
          display: ft.video.display - offset,
        } : undefined,
        drawStart: ft.drawStart - offset,
        drawEnd: ft.drawEnd - offset,
        display: ft.display - offset,
        complete: ft.complete - offset,
        nextCompose: (i < frameTimes.length - 1 && frameTimes[i+1].video) ? frameTimes[i+1].video.compose - offset : undefined,
        nextDisplay: (i < frameTimes.length - 1 && frameTimes[i+1].video) ? frameTimes[i+1].video.display - offset : undefined,
      };
    });

    const frameDurations = offsettedFrameTimes.map(ft => ({
      decodeToPresent: ft.video ? [ft.video.decode, ft.video.present - ft.video.decode] : [],
      composeToReceive: ft.video ? [ft.video.compose, ft.video.receive - ft.video.compose] : [],
      presentToCompose: ft.video ? [ft.video.present, Math.max(0, ft.video.compose - ft.video.present)] : [],
      receiveToDrawStart: ft.video ? [ft.video.receive, ft.drawStart - ft.video.receive] : [],
      drawStartTodrawEnd: [ft.drawStart, ft.drawEnd - ft.drawStart],
      drawEndToDisplay: [ft.drawEnd, ft.display - ft.drawEnd],
      videoDisplay: ft.video ? ft.video.display : undefined,
      isDrawnBeforeVideoDisplay: ft.video && (!isFinite(ft.video.display) || ft.drawEnd <= ft.video.display),
      nextCompose: ft.nextCompose,
      isDrawnBeforeNextCompose: !isFinite(ft.nextCompose) || ft.drawEnd <= ft.nextCompose,
      nextDisplay: ft.nextDisplay,
      isDrawnBeforeNextDisplay: !isFinite(ft.nextDisplay) || ft.drawEnd <= ft.nextDisplay,
      isDrawn: isFinite(ft.drawEnd)
    }));

    let averageMinTimes = offsettedFrameTimes.map(ft => ft.video ? Math.min(ft.video.decode || Infinity, ft.video.compose || Infinity) : ft.drawStart).filter(isFinite).sort((a,b)=>a-b);
    let min = 0, max = 0;
    if (averageMinTimes.length > 0) {
      const minPercentile90Length = Math.max(1, Math.floor(averageMinTimes.length * 0.9));
      const averageMinTimesPercentile90 = averageMinTimes.slice(-minPercentile90Length);
      min = Math.round(Math.min(...averageMinTimesPercentile90) / displayFrameDuration) * displayFrameDuration;
    }
    
    let averageMaxTimes = offsettedFrameTimes.map(ft => Math.max(ft.video ? (ft.video.display || -999) : -999, ft.drawEnd || -999, ft.nextCompose || -999, ft.nextDisplay || -999)).filter(isFinite).sort((a,b)=>a-b);
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

    const frameRects = frameDurations.map((fd, i) => {
      let rects = [];
      if (!fd.isDrawn) {
        rects.push(['#800', xSize, min - displayFrameDuration / 2, range]);
      }
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
        ctx.fillRect(x + Math.floor((xSize - xFrameSize)/2), Math.round((y - offset) * yScale), xFrameSize, Math.max(1, Math.round(ySize * yScale)));
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
      // Don't drag if clicking buttons or actions
      if (e.target.closest('.aura-stats-actions') || e.target.closest('button')) {
        return;
      }
      e.stopPropagation();
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      
      if (!el.style.left) {
        clampOverlayPosition();
      }
      
      initialX = el.offsetLeft;
      initialY = el.offsetTop;
      
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    };

    el.addEventListener('mousedown', onMouseDown);
    el.addEventListener('click', e => e.stopPropagation());
    el.addEventListener('dblclick', e => e.stopPropagation());
    
    dragCleanups.push(() => {
      if (isDragging) onMouseUp();
    });
  }

  function applyState() {
    const isWatchPage = window.CineGlowPlayer && window.CineGlowPlayer.isWatchPage;
    if (settings.statsEnabled && isWatchPage) {
      createOverlay();
      if (video && !updateInterval) startMonitoring();
    } else {
      removeOverlay();
      stopMonitoring();
    }
  }

  if (window.CineGlowPlayer) {
    if (window.CineGlowPlayer.isWatchPage && window.CineGlowPlayer.video) {
      video = window.CineGlowPlayer.video;
      applyState();
    }
    
    window.CineGlowPlayer.addEventListener('state-change', (e) => {
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
    try {
      const stored = await chrome.storage.sync.get(['statsEnabled', 'enableInPiP']);
      settings.statsEnabled = !!stored.statsEnabled;
      settings.enableInPiP = !!stored.enableInPiP;
      applyState();
    } catch (err) {
      console.warn('[Aura] Could not load stats settings:', err);
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync') {
      if ('statsEnabled' in changes) {
        settings.statsEnabled = changes.statsEnabled.newValue;
        applyState();
      }
      if ('enableInPiP' in changes) {
        settings.enableInPiP = changes.enableInPiP.newValue;
      }
    }
  });

  loadSettings();
})();

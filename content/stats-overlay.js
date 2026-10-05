(() => {
  'use strict';

  let settings = { statsEnabled: false };
  let overlayEl = null;
  let video = null;
  let updateInterval = 0;
  
  let refs = {};

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

  function onRvfc(now, metadata) {
    if (!updateInterval) return;
    rvfcFrames++;
    
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

    if (video) {
      rvfcId = video.requestVideoFrameCallback(onRvfc);
    }
  }

  function statsLoop(now) {
    if (!updateInterval) return;
    displayFrames++;
    
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
          for (const video of droppedVideoFrameTimes) {
            frameTimes.push({ video });
          }
        }
      }
      
      frameTimes.push(ft);
      if (frameTimes.length > 120) frameTimes = frameTimes.slice(-120);
    }
    rafLoopId = requestAnimationFrame(statsLoop);
  }

  function createOverlay() {
    const container = (window.CineGlowPlayer && window.CineGlowPlayer.player) ? window.CineGlowPlayer.player : document.body;
    if (overlayEl) {
      if (overlayEl.parentElement !== container) {
        container.appendChild(overlayEl);
      }
      return;
    }
    overlayEl = document.createElement('div');
    overlayEl.id = 'aura-stats-overlay';
    
    overlayEl.innerHTML = `
      <div class="aura-stats-header">CineGlow Telemetry</div>
      <div class="aura-stats-list">
        <div id="aura-stat-display">DISPLAY: 0</div>
        <div id="aura-stat-video">VIDEO: 0</div>
        <div id="aura-stat-vdropped">VIDEO DROPPED: 0</div>
        <div id="aura-stat-ambient">AMBIENT: 0</div>
        <div id="aura-stat-vbuffer">VIDEO BUFFER: ?x?</div>
        <div id="aura-stat-abuffer">AMBIENT BUFFER: ?x?</div>
      </div>
      <div class="aura-stats-graph-container">
        <canvas id="aura-stats-canvas" width="360" height="270"></canvas>
        <div class="aura-stats-legend">
          <div id="aura-stat-max">0.0ms</div>
          <div style="flex: 1"></div>
          <div id="aura-stat-min">0.0ms</div>
        </div>
      </div>
    `;
    container.appendChild(overlayEl);
    
    refs.display = overlayEl.querySelector('#aura-stat-display');
    refs.video = overlayEl.querySelector('#aura-stat-video');
    refs.vdropped = overlayEl.querySelector('#aura-stat-vdropped');
    refs.ambient = overlayEl.querySelector('#aura-stat-ambient');
    refs.vbuffer = overlayEl.querySelector('#aura-stat-vbuffer');
    refs.abuffer = overlayEl.querySelector('#aura-stat-abuffer');
    refs.canvas = overlayEl.querySelector('#aura-stats-canvas');
    refs.max = overlayEl.querySelector('#aura-stat-max');
    refs.min = overlayEl.querySelector('#aura-stat-min');

    makeDraggable(overlayEl);
    
    window.addEventListener('resize', clampOverlayPosition, { passive: true });
    dragCleanups.push(() => {
      window.removeEventListener('resize', clampOverlayPosition);
    });
  }

  function clampOverlayPosition() {
    if (!overlayEl) return;
    const rect = overlayEl.getBoundingClientRect();
    const parentRect = overlayEl.parentElement ? overlayEl.parentElement.getBoundingClientRect() : {left: 0, top: 0};
    
    const currentLeft = rect.left - parentRect.left;
    const currentTop = rect.top - parentRect.top;
    
    const minLeft = -parentRect.left;
    const minTop = -parentRect.top;
    const maxLeft = window.innerWidth - parentRect.left - rect.width;
    const maxTop = window.innerHeight - parentRect.top - rect.height;
    
    const newLeft = Math.max(minLeft, Math.min(currentLeft, maxLeft));
    const newTop = Math.max(minTop, Math.min(currentTop, maxTop));
    
    if (currentLeft !== newLeft || currentTop !== newTop) {
      overlayEl.style.left = `${newLeft}px`;
      overlayEl.style.top = `${newTop}px`;
      overlayEl.style.right = 'auto';
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
    
    const now = performance.now();
    const dt = (now - lastTime) / 1000;
    
    if (dt <= 0) return;

    let vW = 0, vH = 0;
    let buffering = false;
    let playing = false;
    let droppedFrames = 0;

    if (video) {
      vW = video.videoWidth;
      vH = video.videoHeight;
      buffering = video.readyState < 3;
      playing = !video.paused && !video.ended;
      
      if (typeof video.getVideoPlaybackQuality === 'function') {
        const q = video.getVideoPlaybackQuality();
        droppedFrames = q.droppedVideoFrames;
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
    
    if (playing && !buffering) {
      lastDisplayFps = (displayFrames - lastDisplayFrames) / dt;
    } else if (!playing) {
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
    const glowMs = lastGlowFps ? (1000 / lastGlowFps).toFixed(1) : '0.0';

    if (refs.display) refs.display.textContent = `DISPLAY: ${lastDisplayFps.toFixed(2)} (${displayMs}ms)`;
    if (refs.video) refs.video.textContent = `VIDEO: ${lastVideoFps.toFixed(2)} (${videoMs}ms)`;
    if (refs.vdropped) {
      refs.vdropped.textContent = `VIDEO DROPPED: ${droppedFrames}`;
      refs.vdropped.style.color = droppedFrames > 0 ? '#ff3' : '#7f7';
    }
    if (refs.ambient) refs.ambient.textContent = `AMBIENT: ${lastGlowFps.toFixed(2)} (${glowMs}ms)`;
    
    if (refs.vbuffer) refs.vbuffer.textContent = `VIDEO BUFFER: ${vW}x${vH}`;
    
    // We assume 64x36 for the ambient buffer size for now, as that's what content.js uses
    const aw = 64, ah = 36;
    if (refs.abuffer) refs.abuffer.textContent = `AMBIENT BUFFER: ${aw}x${ah}  [ draw: ${glowDrawTime}ms ]`;
    
    drawFrametimesCanvas();
  }

  function drawFrametimesCanvas() {
    if (!refs.canvas || frameTimes.length === 0) return;
    const ctx = refs.canvas.getContext('2d', { alpha: true });
    const width = 360;
    const height = 270;
    const xSize = 3;
    
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
    };

    const onMouseUp = () => {
      isDragging = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    const onMouseDown = (e) => {
      e.stopPropagation();
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = el.getBoundingClientRect();
      const parentRect = el.parentElement ? el.parentElement.getBoundingClientRect() : {left: 0, top: 0};
      initialX = rect.left - parentRect.left;
      initialY = rect.top - parentRect.top;
      
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
    }
    
    window.CineGlowPlayer.addEventListener('state-change', (e) => {
      const state = e.detail;
      if (!state.isWatchPage) {
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
      const stored = await chrome.storage.sync.get(['statsEnabled']);
      settings.statsEnabled = !!stored.statsEnabled;
      applyState();
    } catch (err) {
      console.warn('[Aura] Could not load stats settings:', err);
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && 'statsEnabled' in changes) {
      settings.statsEnabled = changes.statsEnabled.newValue;
      applyState();
    }
  });

  loadSettings();
})();

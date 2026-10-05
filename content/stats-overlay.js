(() => {
  'use strict';

  let settings = { statsEnabled: false };
  let overlayEl = null;
  let video = null;
  let updateInterval = 0;

  // Stats State
  let lastTime = 0;
  let lastPresentedFrames = 0;
  let lastGlowRenders = 0;
  let lastVideoFps = 0;
  let lastGlowFps = 0;
  
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
    container.appendChild(overlayEl);
    makeDraggable(overlayEl);
  }

  function removeOverlay() {
    if (overlayEl) {
      overlayEl.remove();
      overlayEl = null;
    }
  }

  function resetStats() {
    lastTime = performance.now();
    lastPresentedFrames = 0;
    lastGlowRenders = window.CineGlowMetrics ? window.CineGlowMetrics.renderCount : 0;
    lastVideoFps = 0;
    lastGlowFps = 0;
    if (video && typeof video.getVideoPlaybackQuality === 'function') {
      const q = video.getVideoPlaybackQuality();
      lastPresentedFrames = q.totalVideoFrames - q.droppedVideoFrames;
    }
  }

  function startMonitoring() {
    if (updateInterval) clearInterval(updateInterval);
    resetStats();
    updateInterval = setInterval(updateStats, 1000);
    updateStats(); // Initial immediate update
  }

  function stopMonitoring() {
    if (updateInterval) {
      clearInterval(updateInterval);
      updateInterval = 0;
    }
  }

  function updateStats() {
    if (!settings.statsEnabled || !overlayEl) return;
    
    const now = performance.now();
    const dt = (now - lastTime) / 1000;
    
    if (dt <= 0) return;

    let vW = 0, vH = 0, currRes = 'Unknown';
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
        const currentPresented = totalFrames - droppedFrames;
        
        // Only update FPS if playing, otherwise it falls to 0
        if (playing && !buffering) {
          lastVideoFps = Math.round((currentPresented - lastPresentedFrames) / dt);
        } else if (!playing) {
          lastVideoFps = 0;
        }
        
        lastPresentedFrames = currentPresented;
      }
    }
    
    if (window.CineGlowMetrics) {
      const currentRenders = window.CineGlowMetrics.renderCount;
      if (playing && !buffering) {
        lastGlowFps = Math.round((currentRenders - lastGlowRenders) / dt);
      } else if (!playing) {
        lastGlowFps = 0;
      }
      lastGlowRenders = currentRenders;
    }

    lastTime = now;

    // Determine current resolution from quality setting in YouTube player if possible
    const player = window.CineGlowPlayer ? window.CineGlowPlayer.player : null;
    if (player && typeof player.getPlaybackQuality === 'function') {
      const q = player.getPlaybackQuality();
      currRes = q === 'highres' || q === 'hd2160' ? '4K' : 
                q === 'hd1440' ? '1440p' : 
                q === 'hd1080' ? '1080p' : 
                q === 'hd720' ? '720p' : q;
    } else {
      currRes = vH ? `${vH}p` : 'Unknown';
    }
    
    const glowDrawTime = window.CineGlowMetrics && window.CineGlowMetrics.lastDrawTime > 0 
      ? window.CineGlowMetrics.lastDrawTime.toFixed(1) + 'ms' 
      : 'N/A';
      
    const dropRate = totalFrames > 0 ? ((droppedFrames / totalFrames) * 100).toFixed(1) : '0.0';

    overlayEl.innerHTML = `
      <div class="aura-stats-header">CineGlow Telemetry</div>
      <div class="aura-stats-grid">
        <span>Video FPS:</span> <span>${lastVideoFps}</span>
        <span>Video Frames:</span> <span>${totalFrames} (Drop: ${droppedFrames} / ${dropRate}%)</span>
        <span>Resolution:</span> <span>${currRes} (${vW}x${vH})</span>
        <span>State:</span> <span>${playing ? 'Playing' : 'Paused'}${buffering ? ' (Buffering)' : ''}</span>
        <span>CineGlow FPS:</span> <span>${lastGlowFps}</span>
        <span>CineGlow Draw:</span> <span>${glowDrawTime}</span>
      </div>
    `;
  }

  // Handle Dragging
  function makeDraggable(el) {
    let isDragging = false;
    let startX, startY, initialX, initialY;

    const onMouseMove = (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      el.style.left = \`\${initialX + dx}px\`;
      el.style.top = \`\${initialY + dy}px\`;
      el.style.right = 'auto'; // Disable right positioning so left/top take over
    };

    const onMouseUp = () => {
      isDragging = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    const onMouseDown = (e) => {
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = el.getBoundingClientRect();
      const parentRect = el.parentElement ? el.parentElement.getBoundingClientRect() : {left: 0, top: 0};
      // Calculate relative to the parent because of position: absolute
      initialX = rect.left - parentRect.left;
      initialY = rect.top - parentRect.top;
      e.preventDefault();
      
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    };

    el.addEventListener('mousedown', onMouseDown);
  }

  function applyState() {
    if (settings.statsEnabled) {
      createOverlay();
      if (video) startMonitoring();
    } else {
      removeOverlay();
      stopMonitoring();
    }
  }

  // Hook into the centralized lifecycle
  if (window.CineGlowPlayer) {
    window.CineGlowPlayer.addEventListener('state-change', (e) => {
      const state = e.detail;
      // Only watch page is supported
      if (!state.isWatchPage) {
        if (overlayEl) {
           removeOverlay();
           stopMonitoring();
        }
        return;
      }
      
      if (video !== state.video) {
        stopMonitoring();
        video = state.video;
        if (settings.statsEnabled && video) {
          startMonitoring();
        }
      } else if (settings.statsEnabled) {
        // Force an immediate update on state changes (e.g. fullscreen/miniplayer)
        updateStats();
      }
    });
  }

  // Load settings
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

/*
 * Aura – Ambient Light for YouTube (content script)
 *
 * How it works:
 *  1. Each frame, the current video frame is drawn into a tiny canvas (64x36).
 *  2. That canvas is stretched (bilinear-smoothed) to be larger than the video,
 *     then blurred and saturated using CSS filters.
 *  3. The canvas sits behind the page (z-index -1) and is positioned to stay
 *     centered on the video, producing a glow around it.
 */
(() => {
  'use strict';

  const ROOT_CLASS = 'aura-active';
  const CANVAS_ID = 'aura-ambient-canvas';
  const SAMPLE_W = 64;
  const SAMPLE_H = 36;
  const SETTLE_FRAMES = 30;     // Extra draws after the video stops, so smoothing converges
  
  window.CineGlowMetrics = {
    renderCount: 0,
    lastDrawTime: 0,
    lastDrawStart: 0,
    lastDrawEnd: 0
  };

  let settings = { ...AURA_DEFAULTS };
  let video = null;

  let rafId = 0;
  let isActive = false;
  let lastDrawAt = 0;
  let lastVideoTime = -1;
  let settleFrames = 0;
  let forceFullDraw = true;
  let lastLayoutKey = '';
  let videoObserver = null;

  // ---------- Canvas setup ----------

  const canvas = document.createElement('canvas');
  canvas.id = CANVAS_ID;
  canvas.width = SAMPLE_W;
  canvas.height = SAMPLE_H;
  canvas.setAttribute('aria-hidden', 'true');
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'low';

  function ensureCanvasMounted() {
    if (!canvas.isConnected && document.body) {
      document.body.prepend(canvas);
    }
  }

  function applyVisualSettings() {
    document.documentElement.style.setProperty('--aura-opacity', String(settings.opacity / 100));
    document.documentElement.style.setProperty('--aura-fade', `${settings.fadeInDuration}s`);
    
    canvas.style.filter =
      `blur(${settings.blur}px) ` +
      `saturate(${settings.saturation / 100}) ` +
      `contrast(${settings.contrast / 100}) ` +
      `brightness(${settings.brightness / 100})`;
    lastLayoutKey = ''; // Spread may have changed; force a re-layout.
    document.documentElement.classList.toggle('aura-hide-scrollbar', settings.hideScrollbar);
    document.documentElement.classList.toggle('aura-hide-theater', settings.hideInTheater);
    document.documentElement.classList.toggle('aura-watch-page', window.CineGlowPlayer ? window.CineGlowPlayer.isWatchPage : location.pathname === '/watch');
    document.documentElement.classList.toggle('aura-adblock', settings.adblockEnabled);
    document.documentElement.classList.toggle('aura-lights-out', settings.lightsOut);
    document.documentElement.classList.toggle('aura-ultrawide-zoom', settings.ultrawideZoom);
    
    updatePlayingState();

    const currentVideo = video || (window.CineGlowPlayer ? window.CineGlowPlayer.video : null);
    if (currentVideo) {
      if (settings.videoBrightness === 100 && settings.videoContrast === 100 && settings.videoSepia === 0) {
        currentVideo.style.filter = '';
      } else {
        currentVideo.style.filter = `brightness(${settings.videoBrightness / 100}) contrast(${settings.videoContrast / 100}) sepia(${settings.videoSepia / 100})`;
      }
    }
  }

  // ---------- Video discovery & playback state ----------

  function updatePlayingState() {
    const currentVideo = video || (window.CineGlowPlayer ? window.CineGlowPlayer.video : null);
    const isPlaying = currentVideo ? (!currentVideo.paused && !currentVideo.ended) : false;
    document.documentElement.classList.toggle('aura-playing', isPlaying);
  }

  function onVideoReset() {
    forceFullDraw = true;
    settleFrames = SETTLE_FRAMES;
    wake();
  }

  let videoId = null;

  let isPiP = false;

  function handlePlayerState(state) {
    if (!state) return;
    document.documentElement.classList.toggle('aura-watch-page', state.isWatchPage);
    isPiP = state.isPiP;
    
    if (state.video !== video || state.videoId !== videoId) {
      if (video) {
        for (const type of ['seeked', 'loadeddata', 'emptied']) {
          video.removeEventListener(type, onVideoReset);
        }
        for (const type of ['play', 'playing', 'pause', 'waiting', 'ended']) {
          video.removeEventListener(type, onVideoReset);
          video.removeEventListener(type, updatePlayingState);
        }
        if (videoObserver) {
          videoObserver.disconnect();
          videoObserver = null;
        }
      }
      video = state.video;
      videoId = state.videoId;
      if (video) {
        applyVisualSettings();
        for (const type of ['seeked', 'loadeddata', 'emptied']) {
          video.addEventListener(type, onVideoReset, { passive: true });
        }
        for (const type of ['play', 'playing', 'pause', 'waiting', 'ended']) {
          video.addEventListener(type, onVideoReset, { passive: true });
          video.addEventListener(type, updatePlayingState, { passive: true });
        }
        updatePlayingState();
        
        videoObserver = new ResizeObserver(() => {
          lastLayoutKey = '';
          wake();
        });
        videoObserver.observe(video);
      }
      onVideoReset();
    }
    updatePlayingState();
    wake();
  }

  window.CineGlowPlayer.addEventListener('state-change', (e) => {
    handlePlayerState(e.detail);
  });

  if (window.CineGlowPlayer) {
    handlePlayerState(window.CineGlowPlayer);
  }

  function shouldBeActive() {
    if (!settings.enabled) return false;
    const state = window.CineGlowPlayer;
    if (!state.isWatchPage) return false;
    if (state.isFullscreen) return false;
    if (state.isMiniplayer) return false;
    if (isPiP && !settings.enableInPiP) return false;
    return true;
  }

  // ---------- Activation ----------

  function activate() {
    if (isActive) return;
    isActive = true;
    ensureCanvasMounted();
    document.documentElement.classList.add(ROOT_CLASS);
    forceFullDraw = true;
  }

  function deactivate() {
    if (!isActive) return;
    isActive = false;
    document.documentElement.classList.remove(ROOT_CLASS);
    lastLayoutKey = '';
  }

  let currentLayoutX = 0;
  let currentLayoutY = 0;

  // ---------- Per-frame work ----------

  function layout(rect) {
    const scale = settings.spread / 100;
    const w = rect.width * scale;
    const h = rect.height * scale;
    const x = rect.left - (w - rect.width) / 2;
    const y = rect.top - (h - rect.height) / 2;
    currentLayoutX = x;
    currentLayoutY = y;

    const topClip = settings.glowTop ? -h : (h - rect.height) / 2;
    const rightClip = settings.glowRight ? -w : (w - rect.width) / 2;
    const bottomClip = settings.glowBottom ? -h : (h - rect.height) / 2;
    const leftClip = settings.glowLeft ? -w : (w - rect.width) / 2;

    const key = `${x.toFixed(1)}|${y.toFixed(1)}|${w.toFixed(1)}|${h.toFixed(1)}|${topClip.toFixed(1)}|${rightClip.toFixed(1)}|${bottomClip.toFixed(1)}|${leftClip.toFixed(1)}`;
    if (key === lastLayoutKey) return;
    lastLayoutKey = key;

    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    canvas.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    canvas.style.clipPath = `inset(${topClip}px ${rightClip}px ${bottomClip}px ${leftClip}px)`;
  }

  function draw(v, now) {
    if (v.readyState < 2 /* HAVE_CURRENT_DATA */) return true; // keep polling
    if (now - lastDrawAt < 1000 / settings.fps) return true; // keep polling

    const t = v.currentTime;
    if (t !== lastVideoTime) {
      settleFrames = SETTLE_FRAMES;
    } else if (!forceFullDraw && settleFrames <= 0) {
      return false; // Paused and fully converged: nothing to do, stop polling.
    }

    lastDrawAt = now;
    lastVideoTime = t;
    settleFrames--;

    // Blend the new frame over the previous one for smoother color transitions.
    const smoothing = forceFullDraw ? 0 : settings.smoothness / 100;
    ctx.globalAlpha = 1 - smoothing * 0.9;
    forceFullDraw = false;

    try {
      const t0 = performance.now();
      if (window.CineGlowCrop) {
        const c = window.CineGlowCrop;
        ctx.drawImage(
          v,
          v.videoWidth * c.left,
          v.videoHeight * c.top,
          v.videoWidth * (1 - c.left - c.right),
          v.videoHeight * (1 - c.top - c.bottom),
          0, 0, SAMPLE_W, SAMPLE_H
        );
      } else {
        ctx.drawImage(v, 0, 0, SAMPLE_W, SAMPLE_H);
      }
      const t1 = performance.now();
      
      window.CineGlowMetrics.lastDrawStart = t0;
      window.CineGlowMetrics.lastDrawEnd = t1;
      window.CineGlowMetrics.lastDrawTime = t1 - t0;
      window.CineGlowMetrics.renderCount++;
    } catch (err) {
      // e.g. a cross-origin/tainted source; skip this frame rather than break the loop.
      console.debug('[Aura] drawImage failed:', err);
    }
    
    // Beat Sync (Audio-Reactive Glow)
    if (settings.audioReactive && window.CineGlowAudioAnalyser && window.CineGlowAudioDataArray && !v.paused) {
      const analyser = window.CineGlowAudioAnalyser;
      const dataArray = window.CineGlowAudioDataArray;
      analyser.getByteFrequencyData(dataArray);
      
      let bass = 0;
      const bassBins = 8; // Broader sub-bass range
      for (let i = 0; i < bassBins; i++) {
        bass += dataArray[i];
      }
      bass = (bass / bassBins) / 255; // 0 to 1
      
      // Drastically amplify the effect so it's impossible to miss
      // Use an exponential curve so quiet parts don't throb, but heavy bass explodes
      const enhancedBass = Math.pow(bass, 1.5);
      
      const beatScale = 1 + (enhancedBass * 0.4); // up to 1.4x size
      const beatOpacity = (settings.opacity / 100) * (1 + enhancedBass * 1.5); // up to 2.5x brighter
      
      canvas.style.transform = `translate3d(${currentLayoutX}px, ${currentLayoutY}px, 0) scale(${beatScale})`;
      canvas.style.opacity = Math.min(1, beatOpacity);
      canvas.dataset.beat = '1';
    } else if (canvas.dataset.beat === '1') {
      canvas.style.transform = `translate3d(${currentLayoutX}px, ${currentLayoutY}px, 0)`;
      canvas.style.opacity = ''; // revert to CSS variable
      canvas.dataset.beat = '0';
    }
    
    return true; // continue polling
  }

  function tick() {
    rafId = 0;

    const v = shouldBeActive() ? window.CineGlowPlayer.video : null;
    let rect = v ? v.getBoundingClientRect() : null;

    if (!rect || rect.width < 2 || rect.height < 2) {
      deactivate();
      return;
    }

    if (window.CineGlowCrop) {
      const c = window.CineGlowCrop;
      rect = {
        top: rect.top + rect.height * c.top,
        bottom: rect.bottom - rect.height * c.bottom,
        left: rect.left + rect.width * c.left,
        right: rect.right - rect.width * c.right,
        width: rect.width * (1 - c.left - c.right),
        height: rect.height * (1 - c.top - c.bottom)
      };
    }

    activate();
    layout(rect);
    const keepRunning = draw(v, performance.now());
    if (keepRunning) {
      schedule();
    }
  }

  function schedule() {
    if (rafId) return;
    rafId = requestAnimationFrame(tick);
  }

  /** Re-check immediately (e.g. after a YouTube SPA navigation). */
  function wake() {
    schedule();
  }

  // ---------- Settings ----------

  async function loadSettings() {
    try {
      const stored = await chrome.storage.sync.get(AURA_DEFAULTS);
      settings = { ...AURA_DEFAULTS, ...stored };
    } catch (err) {
      console.warn('[Aura] Could not load settings, using defaults:', err);
    }
    applyVisualSettings();
    wake();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    for (const [key, { newValue }] of Object.entries(changes)) {
      if (key in AURA_DEFAULTS) {
        settings[key] = newValue ?? AURA_DEFAULTS[key];
      }
    }
    applyVisualSettings();
    forceFullDraw = true;
    wake();
  });

  // ---------- YouTube SPA / page events ----------

  document.addEventListener('visibilitychange', wake);
  window.addEventListener('resize', () => { lastLayoutKey = ''; }, { passive: true });

  loadSettings();
})();

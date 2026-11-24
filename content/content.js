/*
 * Aura – Ambient Light for YouTube (content script)
 *
 * How it works:
 *  1. Each frame, the current video frame is drawn into a downsampled canvas (128x72, or 640x360 for ScreenX).
 *  2. That canvas is stretched (bilinear-smoothed) to be larger than the video,
 *     then blurred and saturated using CSS filters (or 4-sided extruded in ScreenX mode).
 *  3. The canvas sits behind the page (z-index -1) and is positioned to stay
 *     centered on the video, producing a glow around it.
 *
 * Author: Giri Manohar Vemula (https://www.linkedin.com/in/manoharv511)
 */
(() => {
  'use strict';

  if (typeof window !== 'undefined' && window.CineGlowKilled) return;

  const ROOT_CLASS = 'aura-active';
  const CANVAS_ID = 'aura-ambient-canvas';
  const SAMPLE_W = 128;
  const SAMPLE_H = 72;
  const SCREENX_W = 640;
  const SCREENX_H = 360;
  const SETTLE_FRAMES = 30;     // Extra draws after the video stops, so smoothing converges
  const SAFE_DEFAULTS = typeof AURA_DEFAULTS !== 'undefined' ? AURA_DEFAULTS : {};

  window.CineGlowMetrics = {
    renderCount: 0,
    lastDrawTime: 0,
    lastDrawStart: 0,
    lastDrawEnd: 0
  };

  let settings = { ...SAFE_DEFAULTS };
  let video = null;

  let rafId = 0;
  let isActive = false;
  let lastDrawAt = 0;
  let lastVideoTime = -1;
  let settleFrames = 0;
  let forceFullDraw = true;
  let lastLayoutKey = '';
  let videoObserver = null;
  let isKilled = false;
  let isAdBlockPolicyDisabled = false;
  let hasLoadedPolicy = !(typeof chrome !== 'undefined' && chrome.storage?.managed);
  let taintFailures = 0;
  let isTaintedVideo = false;
  let taintedSrc = '';

  function numOr(val, fallback) {
    const parsed = (val === '' || val === null || val === undefined) ? NaN : Number(val);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function getCanvasScale() {
    const spread = numOr(settings.spread, 150);
    // Offset by +50 so 100% spread extends 50% beyond the video frame (1.5x scale), clamped >= 1.1
    return Math.max(1.1, (spread + 50) / 100);
  }

  function syncCodecPolicyToPage() {
    if (typeof document === 'undefined' || !document.documentElement) return;
    const root = document.documentElement;
    if (isKilled || window.CineGlowKilled) {
      if (root.hasAttribute('data-cineglow-codecs')) {
        root.setAttribute('data-cineglow-codecs', 'killed');
        window.dispatchEvent(new CustomEvent('cineglow:codec-policy'));
        root.removeAttribute('data-cineglow-codecs');
      }
      return;
    }

    const host = (typeof location !== 'undefined' && location.hostname) ? location.hostname.toLowerCase() : '';
    const isYouTube = host === 'youtube.com' || host.endsWith('.youtube.com');
    if (!isYouTube) return;

    root.setAttribute('data-cineglow-codecs', JSON.stringify({
      blockAV1: Boolean(settings.blockAV1),
      blockVP9: Boolean(settings.blockVP9),
      block60fps: Boolean(settings.block60fps)
    }));
    window.dispatchEvent(new CustomEvent('cineglow:codec-policy'));
  }

  // ---------- Canvas setup ----------
  const canvas = document.createElement('canvas');
  canvas.id = CANVAS_ID;
  canvas.width = SAMPLE_W;
  canvas.height = SAMPLE_H;
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.pointerEvents = 'none';
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'low';

  function ensureCanvasMounted() {
    if (isKilled || window.CineGlowKilled) return;
    if (!canvas.isConnected && document.body) {
      document.body.prepend(canvas);
    }
  }

  function applyVisualSettings() {
    if (isKilled || window.CineGlowKilled) return;
    if (document.documentElement?.style?.setProperty) {
      document.documentElement.style.setProperty('--aura-opacity', String(numOr(settings.opacity, 75) / 100));
      document.documentElement.style.setProperty('--aura-fade', `${numOr(settings.fadeInDuration, 1)}s`);
    }

    const targetW = settings.screenXMode ? SCREENX_W : SAMPLE_W;
    const targetH = settings.screenXMode ? SCREENX_H : SAMPLE_H;
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = settings.screenXMode ? 'high' : 'low';
      forceFullDraw = true;
    }

    const effectiveBlur = settings.screenXMode ? 0 : settings.blur;
    canvas.style.filter =
      `blur(${numOr(effectiveBlur, 40)}px) ` +
      `saturate(${numOr(settings.saturation, 110) / 100}) ` +
      `contrast(${numOr(settings.contrast, 100) / 100}) ` +
      `brightness(${numOr(settings.brightness, 100) / 100})`;
    lastLayoutKey = '';

    const isWatch = window.CineGlowPlayer ? window.CineGlowPlayer.isWatchPage : location.pathname === '/watch';
    const allowAdblock = hasLoadedPolicy &&
      Boolean(settings.adblockEnabled) &&
      !isAdBlockPolicyDisabled &&
      !window.CineGlowAdBlock?.isAdBlockPolicyDisabled?.();

    document.documentElement.classList.toggle('aura-watch-page', Boolean(isWatch));
    document.documentElement.classList.toggle('aura-hide-scrollbar', Boolean(settings.hideScrollbar));
    document.documentElement.classList.toggle('aura-hide-theater', Boolean(settings.hideInTheater));
    document.documentElement.classList.toggle('aura-adblock', allowAdblock);
    document.documentElement.classList.toggle('aura-lights-out', Boolean(isWatch && settings.lightsOut));
    document.documentElement.classList.toggle('aura-ultrawide-zoom', Boolean(settings.ultrawideZoom));
    document.documentElement.classList.toggle('aura-screenx-mode', Boolean(settings.screenXMode));

    updatePlayingState();

    const currentVideo = video || window.CineGlowPlayer?.video;
    const isAd = Boolean(window.CineGlowPlayer?.isAdShowing);
    if (currentVideo) {
      const vb = numOr(settings.videoBrightness, 100);
      const vc = numOr(settings.videoContrast, 100);
      const vs = numOr(settings.videoSepia, 0);
      if (isAd || (vb === 100 && vc === 100 && vs === 0)) {
        currentVideo.style.filter = '';
      } else {
        currentVideo.style.filter = `brightness(${vb / 100}) contrast(${vc / 100}) sepia(${vs / 100})`;
      }
    }
  }

  function updatePlayingState() {
    const currentVideo = video || window.CineGlowPlayer?.video;
    const isPlaying = currentVideo ? (!currentVideo.paused && !currentVideo.ended) : false;
    document.documentElement.classList.toggle('aura-playing', isPlaying);
  }

  function onVideoReset(e) {
    if (isTaintedVideo && e && (e.type === 'emptied' || e.type === 'loadeddata')) {
      const curSrc = video?.currentSrc || video?.src || '';
      if (curSrc && curSrc !== taintedSrc) {
        taintFailures = 0;
        isTaintedVideo = false;
        taintedSrc = '';
      }
    }
    if (isTaintedVideo) return;
    forceFullDraw = true;
    settleFrames = SETTLE_FRAMES;
    wake();
  }

  let videoId = null;
  let isPiP = false;

  function handlePlayerState(state) {
    if (isKilled || window.CineGlowKilled || !state) return;
    document.documentElement.classList.toggle('aura-watch-page', Boolean(state.isWatchPage));
    isPiP = state.isPiP;

    if (state.video !== video || state.videoId !== videoId) {
      taintFailures = 0;
      isTaintedVideo = false;
      taintedSrc = '';
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
        ensureCanvasMounted();
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
    } else {
      applyVisualSettings();
    }
    wake();
  }

  const onPlayerStateChange = (e) => {
    if (isKilled || window.CineGlowKilled) return;
    handlePlayerState(e.detail);
  };

  if (window.CineGlowPlayer) {
    window.CineGlowPlayer.addEventListener('state-change', onPlayerStateChange);
    handlePlayerState(window.CineGlowPlayer);
  }

  function shouldBeActive() {
    if (!settings.enabled || document.hidden || isTaintedVideo) return false;
    const state = window.CineGlowPlayer;
    if (!state || !state.isWatchPage) return false;
    if (state.isFullscreen || state.isMiniplayer) return false;
    if (isPiP && !settings.enableInPiP) return false;
    return true;
  }

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
    canvas.style.opacity = '';
    canvas.dataset.beat = '0';
    lastLayoutKey = '';
  }

  let currentLayoutX = 0;
  let currentLayoutY = 0;

  function layout(rect) {
    const scale = getCanvasScale();
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

    const key = `${x.toFixed(1)}|${y.toFixed(1)}|${w.toFixed(1)}|${h.toFixed(1)}|${topClip.toFixed(1)}|${rightClip.toFixed(1)}|${bottomClip.toFixed(1)}|${leftClip.toFixed(1)}|${settings.screenXMode ? 1 : 0}`;
    if (key === lastLayoutKey) return;
    lastLayoutKey = key;

    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    canvas.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    canvas.style.clipPath = `inset(${topClip}px ${rightClip}px ${bottomClip}px ${leftClip}px)`;
  }

  function drawScreenXFrame(v, c) {
    const W = canvas.width;
    const H = canvas.height;
    const vw = v.videoWidth;
    const vh = v.videoHeight;
    let sx = 0, sy = 0, sw = vw, sh = vh;
    if (c && (1 - c.left - c.right) > 0.05 && (1 - c.top - c.bottom) > 0.05) {
      sx = vw * c.left;
      sy = vh * c.top;
      sw = vw * (1 - c.left - c.right);
      sh = vh * (1 - c.top - c.bottom);
    }

    const scale = getCanvasScale();
    const cx = Math.round(W * (scale - 1) / (2 * scale));
    const cw = Math.round(W / scale);
    const cy = Math.round(H * (scale - 1) / (2 * scale));
    const ch = Math.round(H / scale);
    const rightX = cx + cw;
    const rightW = W - rightX;
    const bottomY = cy + ch;
    const bottomH = H - bottomY;

    const edgeW = Math.max(2, Math.min(sw, sw * (cx / cw)));
    const edgeH = Math.max(2, Math.min(sh, sh * (cy / ch)));

    // Center video
    ctx.drawImage(v, sx, sy, sw, sh, cx, cy, cw, ch);

    // Left Wing (extruded leftward seamlessly from x = cx to x = 0)
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(-1, 1);
    ctx.drawImage(v, sx, sy, edgeW, sh, 0, 0, cx, ch);
    ctx.restore();

    // Right Wing (extruded rightward seamlessly from x = rightX to x = W)
    ctx.save();
    ctx.translate(rightX, cy);
    ctx.scale(-1, 1);
    ctx.drawImage(v, sx + sw - edgeW, sy, edgeW, sh, -rightW, 0, rightW, ch);
    ctx.restore();

    // Top Wing (extruded upward seamlessly from y = cy to y = 0)
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, -1);
    ctx.drawImage(v, sx, sy, sw, edgeH, 0, 0, cw, cy);
    ctx.restore();

    // Bottom Wing (extruded downward seamlessly from y = bottomY to y = H)
    ctx.save();
    ctx.translate(cx, bottomY);
    ctx.scale(1, -1);
    ctx.drawImage(v, sx, sy + sh - edgeH, sw, edgeH, 0, -bottomH, cw, bottomH);
    ctx.restore();

    // 4 Corners (extruded diagonally seamlessly)
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(-1, -1);
    ctx.drawImage(v, sx, sy, edgeW, edgeH, 0, 0, cx, cy);
    ctx.restore();

    ctx.save();
    ctx.translate(rightX, cy);
    ctx.scale(-1, -1);
    ctx.drawImage(v, sx + sw - edgeW, sy, edgeW, edgeH, -rightW, 0, rightW, cy);
    ctx.restore();

    ctx.save();
    ctx.translate(cx, bottomY);
    ctx.scale(-1, -1);
    ctx.drawImage(v, sx, sy + sh - edgeH, edgeW, edgeH, 0, -bottomH, cx, bottomH);
    ctx.restore();

    ctx.save();
    ctx.translate(rightX, bottomY);
    ctx.scale(-1, -1);
    ctx.drawImage(v, sx + sw - edgeW, sy + sh - edgeH, edgeW, edgeH, -rightW, -bottomH, rightW, bottomH);
    ctx.restore();
  }

  function draw(v, now) {
    if (v.readyState < 2 || v.videoWidth < 2 || v.videoHeight < 2) return true;

    const t = v.currentTime;
    if (t !== lastVideoTime) {
      settleFrames = SETTLE_FRAMES;
    } else if (!forceFullDraw && settleFrames <= 0) {
      return false;
    }

    lastDrawAt = now;
    lastVideoTime = t;
    settleFrames--;

    const smoothing = (settings.screenXMode || forceFullDraw) ? 0 : numOr(settings.smoothness, 60) / 100;
    ctx.globalAlpha = 1 - smoothing * 0.9;
    forceFullDraw = false;

    try {
      const t0 = performance.now();
      const c = window.CineGlowCrop;
      if (settings.screenXMode) {
        drawScreenXFrame(v, c);
      } else if (c && (1 - c.left - c.right) > 0.05 && (1 - c.top - c.bottom) > 0.05) {
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
      taintFailures = 0;

      window.CineGlowMetrics.lastDrawStart = t0;
      window.CineGlowMetrics.lastDrawEnd = t1;
      window.CineGlowMetrics.lastDrawTime = t1 - t0;
      window.CineGlowMetrics.renderCount++;
    } catch (err) {
      taintFailures++;
      if (taintFailures >= 3) {
        isTaintedVideo = true;
        taintedSrc = v.currentSrc || v.src || '';
        deactivate();
        return false;
      }
      const errName = err?.name || '';
      const errMsg = String(err?.message || '');
      if (errName === 'SecurityError' || /tainted|cross-origin|security/i.test(errMsg)) {
        return true;
      }
    }

    if (settings.audioReactive && window.CineGlowAudioAnalyser && window.CineGlowAudioDataArray && !v.paused) {
      const analyser = window.CineGlowAudioAnalyser;
      const dataArray = window.CineGlowAudioDataArray;
      analyser.getByteFrequencyData(dataArray);

      let bass = 0;
      const bassBins = 8;
      for (let i = 0; i < bassBins; i++) {
        bass += dataArray[i];
      }
      bass = (bass / bassBins) / 255;

      const enhancedBass = Math.pow(bass, 1.5);
      const baseOpacity = numOr(settings.opacity, 75) / 100;
      if (settings.screenXMode) {
        // ScreenX relies on 1:1 edge alignment; pulse subtle opacity only without scaling canvas geometry
        const pulseOpacity = baseOpacity * (1 + enhancedBass * 0.35);
        canvas.style.transform = `translate3d(${currentLayoutX}px, ${currentLayoutY}px, 0)`;
        canvas.style.opacity = Math.min(1, pulseOpacity);
      } else {
        const beatScale = 1 + (enhancedBass * 0.4);
        const beatOpacity = baseOpacity * (1 + enhancedBass * 1.5);
        canvas.style.transform = `translate3d(${currentLayoutX}px, ${currentLayoutY}px, 0) scale(${beatScale})`;
        canvas.style.opacity = Math.min(1, beatOpacity);
      }
      canvas.dataset.beat = '1';
    } else if (canvas.dataset.beat === '1') {
      canvas.style.transform = `translate3d(${currentLayoutX}px, ${currentLayoutY}px, 0)`;
      canvas.style.opacity = '';
      canvas.dataset.beat = '0';
    }

    return true;
  }

  function tick(now) {
    rafId = 0;
    if (isKilled || window.CineGlowKilled) return;

    const v = shouldBeActive() ? window.CineGlowPlayer.video : null;
    if (!v) {
      deactivate();
      return;
    }

    const minInterval = 1000 / Math.max(1, numOr(settings.fps, 30));
    if (!forceFullDraw && lastLayoutKey !== '' && (now - lastDrawAt < minInterval)) {
      schedule();
      return;
    }

    let rect = v.getBoundingClientRect();
    if (!rect || rect.width < 2 || rect.height < 2) {
      deactivate();
      return;
    }

    // Account for object-fit: contain letterboxing/pillarboxing on non-16:9 videos inside player box
    if (v.videoWidth > 1 && v.videoHeight > 1) {
      const objectFit = typeof window.getComputedStyle === 'function'
        ? (window.getComputedStyle(v)?.objectFit || 'contain')
        : 'contain';
      if (objectFit === 'contain' || objectFit === 'scale-down' || objectFit === '') {
        const videoAR = v.videoWidth / v.videoHeight;
        const rectAR = rect.width / rect.height;
        if (Math.abs(videoAR - rectAR) > 0.01) {
          if (videoAR > rectAR) {
            const renderedH = rect.width / videoAR;
            const padY = (rect.height - renderedH) / 2;
            rect = {
              left: rect.left,
              right: rect.right,
              width: rect.width,
              top: rect.top + padY,
              bottom: rect.top + padY + renderedH,
              height: renderedH
            };
          } else {
            const renderedW = rect.height * videoAR;
            const padX = (rect.width - renderedW) / 2;
            rect = {
              top: rect.top,
              bottom: rect.bottom,
              height: rect.height,
              left: rect.left + padX,
              right: rect.left + padX + renderedW,
              width: renderedW
            };
          }
        }
      }
    }

    // Clamp scaled video bounds to visible player container when ultrawideZoom crops overflow
    if (settings.ultrawideZoom && typeof v.closest === 'function') {
      const container = v.closest('#movie_player, .html5-video-container');
      const cRect = container?.getBoundingClientRect?.();
      if (cRect && cRect.width >= 2 && cRect.height >= 2) {
        const left = Math.max(rect.left, cRect.left);
        const top = Math.max(rect.top, cRect.top);
        const right = Math.min(rect.right, cRect.right);
        const bottom = Math.min(rect.bottom, cRect.bottom);
        if (right - left >= 2 && bottom - top >= 2) {
          rect = { left, top, right, bottom, width: right - left, height: bottom - top };
        }
      }
    }

    const c = window.CineGlowCrop;
    if (c && (1 - c.left - c.right) > 0.05 && (1 - c.top - c.bottom) > 0.05) {
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
    const keepRunning = draw(v, now);
    if (keepRunning) {
      schedule();
    }
  }

  function schedule() {
    if (isKilled || window.CineGlowKilled || rafId) return;
    rafId = requestAnimationFrame(tick);
  }

  function wake() {
    if (isKilled || window.CineGlowKilled) return;
    schedule();
  }

  const handleViewportChange = () => {
    lastLayoutKey = '';
    wake();
  };

  // ---------- Settings ----------
  async function loadSettings() {
    if (isKilled || window.CineGlowKilled) return;
    try {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        const [local, managed, stored] = await Promise.all([
          chrome.storage.local?.get(['auraKillSwitchActive']).catch(() => ({})),
          chrome.storage.managed?.get(['KillSwitch', 'DisableAdBlock']).catch(() => ({})),
          chrome.storage.sync?.get(SAFE_DEFAULTS).catch(() => ({}))
        ]);
        if (isKilled || window.CineGlowKilled) return;
        if (local?.auraKillSwitchActive || managed?.KillSwitch) {
          teardownKillSwitch();
          return;
        }
        isAdBlockPolicyDisabled = managed?.DisableAdBlock === true;
        hasLoadedPolicy = true;
        settings = { ...SAFE_DEFAULTS, ...stored };
      } else {
        hasLoadedPolicy = true;
      }
    } catch (err) {
      hasLoadedPolicy = true;
      console.warn('[Aura] Could not load settings, using defaults:', err);
    }
    if (isKilled || window.CineGlowKilled) return;
    applyVisualSettings();
    syncCodecPolicyToPage();
    wake();
  }

  const handleStorageChange = (changes, area) => {
    if (isKilled || window.CineGlowKilled) return;
    if (area === 'managed') {
      if (changes.KillSwitch?.newValue === true) {
        teardownKillSwitch();
        return;
      }
      if ('DisableAdBlock' in changes) {
        isAdBlockPolicyDisabled = changes.DisableAdBlock.newValue === true;
        applyVisualSettings();
        return;
      }
      return;
    }
    if (area === 'local' && changes.auraKillSwitchActive?.newValue === true) {
      teardownKillSwitch();
      return;
    }
    if (area !== 'sync') return;
    for (const [key, { newValue }] of Object.entries(changes)) {
      if (key in SAFE_DEFAULTS) {
        settings[key] = newValue ?? SAFE_DEFAULTS[key];
      }
    }
    applyVisualSettings();
    syncCodecPolicyToPage();
    forceFullDraw = true;
    wake();
  };
  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged?.addListener) {
    chrome.storage.onChanged.addListener(handleStorageChange);
  }

  // ---------- Clean Theater Mode: Top Search Bar Hover-to-Reveal ----------
  let theaterHoverTimer = null;

  function isSearchFocused() {
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName?.toLowerCase();
    return (
      el.id === 'search' ||
      el.closest?.('#masthead-container, ytd-masthead, #search-form') ||
      (tag === 'input' && el.getAttribute('name') === 'search_query')
    );
  }

  function handleTheaterHover(e) {
    if (isKilled || !settings.hideInTheater) return;
    const isWatch = window.CineGlowPlayer ? window.CineGlowPlayer.isWatchPage : location.pathname === '/watch';
    const isTheater = window.CineGlowPlayer ? window.CineGlowPlayer.isTheater : false;
    if (!isWatch || !isTheater) {
      document.documentElement.classList.remove('aura-theater-reveal-top');
      return;
    }

    if (e.clientY <= 64) {
      clearTimeout(theaterHoverTimer);
      document.documentElement.classList.add('aura-theater-reveal-top');
    } else if (e.clientY > 80 && !isSearchFocused()) {
      clearTimeout(theaterHoverTimer);
      theaterHoverTimer = setTimeout(() => {
        if (!isSearchFocused()) {
          document.documentElement.classList.remove('aura-theater-reveal-top');
        }
      }, 1200);
    }
  }

  window.addEventListener('mousemove', handleTheaterHover, { passive: true });

  const onUnhandledRejection = (event) => {
    if (event?.reason && String(event.reason.message || event.reason).includes('Extension context invalidated')) {
      try { event.preventDefault(); } catch (_) {}
    }
  };
  const onWindowError = (event) => {
    if (event?.message && String(event.message).includes('Extension context invalidated')) {
      try { event.preventDefault(); } catch (_) {}
    }
  };
  const onKillSwitchEvent = () => {
    if (typeof window !== 'undefined') {
      window._cineglowKillEventFired = true;
    }
    teardownKillSwitch();
  };

  // ---------- Emergency Kill-Switch Teardown ----------
  function teardownKillSwitch() {
    if (isKilled) return;
    isKilled = true;
    isActive = false;
    window.CineGlowKilled = true;
    clearTimeout(theaterHoverTimer);
    try { chrome.storage?.onChanged?.removeListener(handleStorageChange); } catch (_) {}
    window.CineGlowPlayer?.removeEventListener?.('state-change', onPlayerStateChange);
    window.removeEventListener('mousemove', handleTheaterHover);
    window.removeEventListener('resize', handleViewportChange);
    window.removeEventListener('scroll', handleViewportChange);
    window.removeEventListener('unhandledrejection', onUnhandledRejection);
    window.removeEventListener('error', onWindowError);

    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }

    if (videoObserver) {
      videoObserver.disconnect();
      videoObserver = null;
    }

    document.getElementById(CANVAS_ID)?.remove();
    canvas?.remove();

    syncCodecPolicyToPage();

    if (document.documentElement) {
      document.documentElement.classList.remove(
        ROOT_CLASS,
        'aura-active',
        'aura-playing',
        'aura-watch-page',
        'aura-adblock',
        'aura-lights-out',
        'aura-ultrawide-zoom',
        'aura-screenx-mode',
        'aura-hide-scrollbar',
        'aura-hide-theater',
        'aura-theater-reveal-top'
      );
      document.documentElement.style?.removeProperty('--aura-opacity');
      document.documentElement.style?.removeProperty('--aura-fade');
    }

    const currentVideo = video || window.CineGlowPlayer?.video;
    if (currentVideo) {
      currentVideo.style.filter = '';
      for (const type of ['seeked', 'loadeddata', 'emptied', 'play', 'playing', 'pause', 'waiting', 'ended']) {
        currentVideo.removeEventListener(type, onVideoReset);
        currentVideo.removeEventListener(type, updatePlayingState);
      }
    }
    video = null;

    document.removeEventListener('visibilitychange', wake);

    if (window.CineGlowMetrics) {
      window.CineGlowMetrics.renderCount = 0;
    }

    if (!window._cineglowKillEventFired) {
      window._cineglowKillEventFired = true;
      window.dispatchEvent(new CustomEvent('cineglow:kill-switch'));
    }
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
          sendResponse({ success: true, script: 'content.js' });
        }
      }
    });
  }

  window.addEventListener('cineglow:kill-switch', onKillSwitchEvent, { once: true });

  window.CineGlowTeardown = teardownKillSwitch;

  document.addEventListener('visibilitychange', wake);
  window.addEventListener('resize', handleViewportChange, { passive: true });
  window.addEventListener('scroll', handleViewportChange, { passive: true });
  window.addEventListener('unhandledrejection', onUnhandledRejection);
  window.addEventListener('error', onWindowError);

  loadSettings();
})();

/*
 * Aura – Ambient Light for YouTube (content script)
 *
 * How it works:
 *  1. Each frame, the current video frame is drawn into a tiny canvas (64x36).
 *  2. That canvas is stretched (bilinear-smoothed) to be larger than the video,
 *     then blurred/saturated with CSS filters on the GPU.
 *  3. The canvas sits behind the page (z-index -1) and is positioned to stay
 *     centered on the video, producing a glow around it.
 */
(() => {
  'use strict';

  const ROOT_CLASS = 'aura-active';
  const CANVAS_ID = 'aura-ambient-canvas';
  const SAMPLE_W = 64;
  const SAMPLE_H = 36;
  const IDLE_POLL_MS = 500;     // How often to re-check when the glow is inactive
  const SETTLE_FRAMES = 30;     // Extra draws after the video stops, so smoothing converges

  let settings = { ...AURA_DEFAULTS };
  let video = null;
  const listenedVideos = new WeakSet();

  let rafId = 0;
  let idleTimer = 0;
  let isActive = false;
  let lastDrawAt = 0;
  let lastVideoTime = -1;
  let settleFrames = 0;
  let forceFullDraw = true;
  let lastLayoutKey = '';

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
    canvas.style.opacity = String(settings.opacity / 100);
    canvas.style.filter =
      `blur(${settings.blur}px) ` +
      `saturate(${settings.saturation / 100}) ` +
      `brightness(${settings.brightness / 100})`;
    lastLayoutKey = ''; // Spread may have changed; force a re-layout.
  }

  // ---------- Video discovery ----------

  function onVideoReset() {
    forceFullDraw = true;
    settleFrames = SETTLE_FRAMES;
    wake();
  }

  function findVideo() {
    if (video && video.isConnected) return video;
    video =
      document.querySelector('#movie_player video.html5-main-video') ||
      document.querySelector('video.html5-main-video');
    if (video && !listenedVideos.has(video)) {
      listenedVideos.add(video);
      for (const type of ['seeked', 'loadeddata', 'emptied', 'play']) {
        video.addEventListener(type, onVideoReset, { passive: true });
      }
    }
    return video;
  }

  function shouldBeActive() {
    if (!settings.enabled) return false;
    if (location.pathname !== '/watch') return false;
    if (document.fullscreenElement) return false;
    const app = document.querySelector('ytd-app');
    if (app && app.hasAttribute('miniplayer-is-active')) return false;
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

  // ---------- Per-frame work ----------

  function layout(rect) {
    const scale = settings.spread / 100;
    const w = rect.width * scale;
    const h = rect.height * scale;
    const x = rect.left - (w - rect.width) / 2;
    const y = rect.top - (h - rect.height) / 2;

    const key = `${x.toFixed(1)}|${y.toFixed(1)}|${w.toFixed(1)}|${h.toFixed(1)}`;
    if (key === lastLayoutKey) return;
    lastLayoutKey = key;

    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    canvas.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  }

  function draw(v, now) {
    if (v.readyState < 2 /* HAVE_CURRENT_DATA */) return;
    if (now - lastDrawAt < 1000 / settings.fps) return;

    const t = v.currentTime;
    if (t !== lastVideoTime) {
      settleFrames = SETTLE_FRAMES;
    } else if (!forceFullDraw && settleFrames <= 0) {
      return; // Paused and fully converged: nothing to do.
    }

    lastDrawAt = now;
    lastVideoTime = t;
    settleFrames--;

    // Blend the new frame over the previous one for smoother color transitions.
    const smoothing = forceFullDraw ? 0 : settings.smoothness / 100;
    ctx.globalAlpha = 1 - smoothing * 0.9;
    forceFullDraw = false;

    try {
      ctx.drawImage(v, 0, 0, SAMPLE_W, SAMPLE_H);
    } catch (err) {
      // e.g. a cross-origin/tainted source; skip this frame rather than break the loop.
      console.debug('[Aura] drawImage failed:', err);
    }
  }

  function tick() {
    rafId = 0;

    const v = shouldBeActive() ? findVideo() : null;
    const rect = v ? v.getBoundingClientRect() : null;

    if (!rect || rect.width < 2 || rect.height < 2) {
      deactivate();
      idleTimer = setTimeout(() => {
        idleTimer = 0;
        schedule();
      }, IDLE_POLL_MS);
      return;
    }

    activate();
    layout(rect);
    draw(v, performance.now());
    schedule();
  }

  function schedule() {
    if (rafId || idleTimer) return;
    rafId = requestAnimationFrame(tick);
  }

  /** Re-check immediately (e.g. after a YouTube SPA navigation). */
  function wake() {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = 0;
    }
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

  document.addEventListener('yt-navigate-finish', wake);
  document.addEventListener('fullscreenchange', wake);
  document.addEventListener('visibilitychange', wake);
  window.addEventListener('resize', () => { lastLayoutKey = ''; }, { passive: true });

  loadSettings();
})();

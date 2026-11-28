// test/defaults-and-settings.test.js
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('Settings Schema & Configuration Integrity', () => {
  function loadDefaults() {
    const code = fs.readFileSync(path.join(__dirname, '../shared/defaults.js'), 'utf8');
    const fn = new Function(`'use strict'; ${code}; return AURA_DEFAULTS;`);
    return fn();
  }

  function extractPopupPresets() {
    const code = fs.readFileSync(path.join(__dirname, '../popup/popup.js'), 'utf8');
    const dummyDoc = {
      getElementById: () => null,
      querySelectorAll: () => []
    };
    const fn = new Function('document', `
      ${code.substring(0, code.indexOf('function updateActiveGlowPresetPill'))};
      return { EQ_PRESETS, GLOW_PRESETS };
    `);
    return fn(dummyDoc);
  }

  test('AURA_DEFAULTS is frozen and immutable', () => {
    const defaults = loadDefaults();
    assert.ok(Object.isFrozen(defaults), 'AURA_DEFAULTS must be Object.freeze-d');
    assert.throws(() => {
      'use strict';
      defaults.enabled = false;
    }, TypeError);
  });

  test('AURA_DEFAULTS contains all expected keys with correct types and default values', () => {
    const d = loadDefaults();

    // Master
    assert.strictEqual(typeof d.enabled, 'boolean');
    assert.strictEqual(d.enabled, true);

    // Glow properties (shifted balanced defaults)
    assert.strictEqual(d.opacity, 90);
    assert.strictEqual(d.spread, 200);
    assert.strictEqual(d.blur, 40);
    assert.strictEqual(d.saturation, 130);
    assert.strictEqual(d.contrast, 110);
    assert.strictEqual(d.brightness, 105);
    assert.strictEqual(d.smoothness, 50);
    assert.strictEqual(d.fadeInDuration, 1);
    assert.strictEqual(d.fps, 30);
    assert.strictEqual(d.glowTop, true);
    assert.strictEqual(d.glowRight, true);
    assert.strictEqual(d.glowBottom, true);
    assert.strictEqual(d.glowLeft, true);
    assert.strictEqual(d.screenXMode, true);

    // Audio properties
    assert.strictEqual(d.audioNormalizer, true);
    assert.strictEqual(d.audioBoost, 100);
    assert.strictEqual(d.bassBoost, 0);
    assert.strictEqual(d.vocalBoost, 0);
    assert.strictEqual(d.eq60, 0);
    assert.strictEqual(d.eq250, 0);
    assert.strictEqual(d.eq1000, 0);
    assert.strictEqual(d.eq4000, 0);
    assert.strictEqual(d.eq12000, 0);
    assert.strictEqual(d.eqPreset, 'flat');
    assert.strictEqual(d.audioReactive, true);

    // Video / Display properties
    assert.strictEqual(d.qualityEnabled, true);
    assert.strictEqual(d.preferredQuality, 'hd1080');
    assert.strictEqual(d.preferredSpeed, 1.0);
    assert.strictEqual(d.removeBlackBars, true);
    assert.strictEqual(d.ultrawideZoom, false);
    assert.strictEqual(d.lightsOut, false);
    assert.strictEqual(d.lightsOutOpacity, 95);
    assert.strictEqual(d.videoBrightness, 100);
    assert.strictEqual(d.videoContrast, 100);
    assert.strictEqual(d.videoSepia, 0);

    // Tools & Enhancements
    assert.strictEqual(d.adblockEnabled, true);
    assert.strictEqual(d.statsEnabled, false);
    assert.strictEqual(d.abLoopEnabled, false);
    assert.strictEqual(d.abLoopAutoClear, false);
    assert.strictEqual(d.returnDislikes, false);
    assert.strictEqual(d.restoreAnnotations, false);
    assert.strictEqual(d.hideShorts, false);
    assert.strictEqual(d.hideEndCards, true);
    assert.strictEqual(d.autoPauseMode, 'off');
    assert.strictEqual(d.recordFormat, 'mkv');
    assert.strictEqual(d.recordFps, 30);
  });

  test('Glow values respect logical bounds and calibrated defaults', () => {
    const d = loadDefaults();
    assert.ok(d.opacity >= 0 && d.opacity <= 100, 'Opacity must be in 0-100%');
    assert.ok(d.spread >= 100 && d.spread <= 400, 'Spread must be between 100% and 400%');
    assert.ok(d.blur >= 5 && d.blur <= 100, 'Blur must be between 5px and 100px');
    assert.ok(d.saturation >= 50 && d.saturation <= 250, 'Saturation must be in 50-250%');
    assert.ok(d.fadeInDuration >= 0 && d.fadeInDuration <= 5, 'Fade duration must be between 0s and 5s');
  });

  test('GLOW_PRESETS balanced profile strictly matches default glow settings', () => {
    const defaults = loadDefaults();
    const { GLOW_PRESETS } = extractPopupPresets();

    assert.ok(GLOW_PRESETS.subtle, 'Subtle preset must exist');
    assert.ok(GLOW_PRESETS.balanced, 'Balanced preset must exist');
    assert.ok(GLOW_PRESETS.vivid, 'Vivid preset must exist');

    const b = GLOW_PRESETS.balanced;
    assert.strictEqual(b.opacity, defaults.opacity);
    assert.strictEqual(b.spread, defaults.spread);
    assert.strictEqual(b.smoothness, defaults.smoothness);
    assert.strictEqual(b.blur, defaults.blur);
    assert.strictEqual(b.saturation, defaults.saturation);
    assert.strictEqual(b.contrast, defaults.contrast);
    assert.strictEqual(b.brightness, defaults.brightness);
  });

  test('EQ_PRESETS defines valid 5-band gain profiles within +/- 12 dB limits', () => {
    const { EQ_PRESETS } = extractPopupPresets();
    const requiredProfiles = ['flat', 'bass', 'vocal', 'rock', 'pop', 'electro'];
    const bands = ['eq60', 'eq250', 'eq1000', 'eq4000', 'eq12000'];

    for (const profile of requiredProfiles) {
      assert.ok(EQ_PRESETS[profile], `Preset ${profile} must be defined`);
      for (const band of bands) {
        const gain = EQ_PRESETS[profile][band];
        assert.strictEqual(typeof gain, 'number', `${profile}.${band} must be a number`);
        assert.ok(gain >= -12 && gain <= 12, `${profile}.${band} (${gain}) must be within [-12, +12] dB`);
      }
    }
  });

  test('popup reset cancels queued pending writes and does not overwrite defaults (Finding 4)', async () => {
    const { setupMockEnvironment } = require('./helpers/mock-dom');
    const env = setupMockEnvironment();
    const origWindow = globalThis.window;
    const origDoc = globalThis.document;
    const origChrome = globalThis.chrome;

    globalThis.window = env.window;
    globalThis.document = env.document;
    globalThis.chrome = env.chrome;

    // Load defaults into global scope
    const defaultsCode = fs.readFileSync(path.join(__dirname, '../shared/defaults.js'), 'utf8');
    new Function('globalThis', `${defaultsCode}; globalThis.AURA_DEFAULTS = AURA_DEFAULTS;`)(globalThis);

    // Create required DOM elements for popup.js initialization
    const ids = [
      'enabled', 'adblockEnabled', 'audioNormalizer', 'audioBoost', 'audioBoostVal',
      'bassBoost', 'bassBoostVal', 'vocalBoost', 'vocalBoostVal',
      'eq60', 'eq60Val', 'eq250', 'eq250Val', 'eq1000', 'eq1000Val',
      'eq4000', 'eq4000Val', 'eq12000', 'eq12000Val', 'eqReset',
      'qualityEnabled', 'statsEnabled', 'adblockCount', 'preferredQuality',
      'blockAV1', 'blockVP9', 'block60fps', 'hideScrollbar', 'hideInTheater',
      'enableInPiP', 'removeBlackBars', 'audioReactive', 'lightsOut', 'ultrawideZoom',
      'glowTop', 'glowRight', 'glowBottom', 'glowLeft', 'fps',
      'preferredSpeed', 'preferredSpeedVal', 'autoPauseMode', 'returnDislikes',
      'hideShorts', 'restoreAnnotations', 'hideEndCards', 'controls', 'reset',
      'masterStatusTag', 'glowReset', 'videoReset', 'audioReset', 'toolsReset',
      'opacity', 'blur', 'spread', 'saturation', 'contrast', 'brightness',
      'smoothness', 'fadeInDuration', 'videoBrightness', 'videoContrast', 'videoSepia'
    ];
    for (const id of ids) {
      env.elements.set(id, env.document.createElement('div'));
      env.elements.set(`#${id}`, env.elements.get(id));
    }
    const versionPill = env.document.createElement('span');
    versionPill.textContent = 'v0.0.0';
    env.elements.set('.header-version-pill', versionPill);

    try {
      const popupCode = fs.readFileSync(path.join(__dirname, '../popup/popup.js'), 'utf8');
      new Function(popupCode)();

      // Wait a microtask for async init() to complete
      await new Promise(r => setTimeout(r, 10));
      assert.strictEqual(versionPill.textContent, 'v2.3.0', 'Popup version pill must dynamically derive version from extension manifest');

      const popup = globalThis.window.CineGlowPopup;
      assert.ok(popup, 'CineGlowPopup must be exposed');

      // 1. User rapidly drags slider, queueing a pending save
      popup.queueSave('opacity', 20);
      assert.strictEqual(popup.pending.opacity, 20, 'Opacity change should be queued in pending');

      // 2. User immediately clicks Reset Lighting
      await popup.resetSectionKeys(['opacity', 'spread', 'blur']);

      // 3. Verify pending write was cancelled
      assert.strictEqual(popup.pending.opacity, undefined, 'Pending write for opacity must be cancelled by section reset');

      // 4. Wait for throttle window to elapse and verify storage was NOT overwritten with 20
      await new Promise(r => setTimeout(r, 600));
      const stored = await env.chrome.storage.sync.get('opacity');
      assert.strictEqual(stored.opacity, 90, 'Storage must retain reset default (90), not overwritten by queued slider write');

      // 5. Test selective reset: queue glow (opacity) and audio (bassBoost) writes
      popup.queueSave('opacity', 30);
      popup.queueSave('bassBoost', 12);
      assert.strictEqual(popup.pending.opacity, 30);
      assert.strictEqual(popup.pending.bassBoost, 12);

      // Section reset on glow keys should only cancel glow keys
      await popup.resetSectionKeys(['opacity', 'spread', 'blur']);
      assert.strictEqual(popup.pending.opacity, undefined, 'Glow key must be purged');
      assert.strictEqual(popup.pending.bassBoost, 12, 'Audio key should remain queued');

      // 6. Test master reset (cancelPendingWrites with no args) purges all keys
      popup.cancelPendingWrites();
      assert.strictEqual(Object.keys(popup.pending).length, 0, 'Master cancel must purge all pending writes');
    } finally {
      globalThis.window = origWindow;
      globalThis.document = origDoc;
      globalThis.chrome = origChrome;
    }
  });

  test('youtube-quality.js defaults qualityEnabled to true on fresh install (Finding 5)', async () => {
    const { setupMockEnvironment } = require('./helpers/mock-dom');
    const env = setupMockEnvironment();
    const origWindow = globalThis.window;
    const origDoc = globalThis.document;
    const origChrome = globalThis.chrome;

    globalThis.window = env.window;
    globalThis.document = env.document;
    globalThis.chrome = env.chrome;

    // Load defaults first
    const defaultsCode = fs.readFileSync(path.join(__dirname, '../shared/defaults.js'), 'utf8');
    new Function('globalThis', `${defaultsCode}; globalThis.AURA_DEFAULTS = AURA_DEFAULTS;`)(globalThis);

    try {
      const qualityCode = fs.readFileSync(path.join(__dirname, '../content/youtube-quality.js'), 'utf8');
      new Function(qualityCode)();

      const quality = globalThis.window.CineGlowQuality;
      assert.ok(quality, 'CineGlowQuality must be exposed');

      // Initially enabled matching shared default
      assert.strictEqual(quality.settings.qualityEnabled, true, 'Default qualityEnabled must be true before storage read');

      // After loadSettings with empty storage (fresh install), remains true
      await quality.loadSettings();
      assert.strictEqual(quality.settings.qualityEnabled, true, 'qualityEnabled must remain true on fresh install when sync storage is empty');
      assert.strictEqual(quality.settings.preferredQuality, 'hd1080');
    } finally {
      globalThis.window = origWindow;
      globalThis.document = origDoc;
      globalThis.chrome = origChrome;
    }
  });

  test('enforces enterprise managed policies (storage.managed) over user preferences in popup initialization', async () => {
    const { setupMockEnvironment } = require('./helpers/mock-dom');
    const env = setupMockEnvironment();
    const origWindow = globalThis.window;
    const origDoc = globalThis.document;
    const origChrome = globalThis.chrome;

    globalThis.window = env.window;
    globalThis.document = env.document;
    globalThis.chrome = env.chrome;

    // Load defaults
    const defaultsCode = fs.readFileSync(path.join(__dirname, '../shared/defaults.js'), 'utf8');
    new Function('globalThis', `${defaultsCode}; globalThis.AURA_DEFAULTS = AURA_DEFAULTS;`)(globalThis);

    // Setup managed policy overrides
    env.chrome.storage.managed._data = {
      DisableAdBlock: true,
      DisableThirdPartyAPIs: true,
      ForceDefaultQuality: 'hd720'
    };

    // User sync preferences try to enable adblock and 4k quality
    env.chrome.storage.sync._data = {
      adblockEnabled: true,
      preferredQuality: 'hd2160',
      returnDislikes: true
    };

    const ids = [
      'enabled', 'adblockEnabled', 'audioNormalizer', 'audioBoost', 'audioBoostVal',
      'bassBoost', 'bassBoostVal', 'vocalBoost', 'vocalBoostVal',
      'eq60', 'eq60Val', 'eq250', 'eq250Val', 'eq1000', 'eq1000Val',
      'eq4000', 'eq4000Val', 'eq12000', 'eq12000Val', 'eqReset',
      'qualityEnabled', 'statsEnabled', 'adblockCount', 'preferredQuality',
      'blockAV1', 'blockVP9', 'block60fps', 'hideScrollbar', 'hideInTheater',
      'enableInPiP', 'removeBlackBars', 'audioReactive', 'lightsOut', 'ultrawideZoom',
      'glowTop', 'glowRight', 'glowBottom', 'glowLeft', 'fps',
      'preferredSpeed', 'preferredSpeedVal', 'autoPauseMode', 'returnDislikes',
      'hideShorts', 'restoreAnnotations', 'hideEndCards', 'controls', 'reset',
      'masterStatusTag', 'glowReset', 'videoReset', 'audioReset', 'toolsReset',
      'opacity', 'blur', 'spread', 'saturation', 'contrast', 'brightness',
      'smoothness', 'fadeInDuration', 'videoBrightness', 'videoContrast', 'videoSepia'
    ];
    for (const id of ids) {
      env.elements.set(id, env.document.createElement('div'));
      env.elements.set(`#${id}`, env.elements.get(id));
    }

    try {
      const popupCode = fs.readFileSync(path.join(__dirname, '../popup/popup.js'), 'utf8');
      new Function(popupCode)();

      // Wait microtask for async init() to complete
      await new Promise(r => setTimeout(r, 10));

      const adblockEl = env.elements.get('adblockEnabled');
      assert.strictEqual(adblockEl.disabled, true, 'Enterprise policy must disable adblock switch');
      assert.strictEqual(adblockEl.title, 'Managed by organization policy');

      const prefQualityEl = env.elements.get('preferredQuality');
      assert.strictEqual(prefQualityEl.disabled, true, 'Enterprise policy must lock preferred quality');

      const dislikesEl = env.elements.get('returnDislikes');
      assert.strictEqual(dislikesEl.disabled, true, 'Enterprise policy must lock third-party dislike integration');
    } finally {
      globalThis.window = origWindow;
      globalThis.document = origDoc;
      globalThis.chrome = origChrome;
    }
  });

  test('ScreenX Frame Extension toggle is present in popup and content scripts support 4-sided edge extrusion', () => {
    const popupHtml = fs.readFileSync(path.join(__dirname, '../popup/popup.html'), 'utf8');
    const popupJs = fs.readFileSync(path.join(__dirname, '../popup/popup.js'), 'utf8');
    const contentJs = fs.readFileSync(path.join(__dirname, '../content/content.js'), 'utf8');
    const contentCss = fs.readFileSync(path.join(__dirname, '../content/content.css'), 'utf8');

    // Popup UI & Binding
    assert.ok(popupHtml.includes('id="screenXMode"'), 'popup.html must contain screenXMode toggle');
    assert.ok(popupJs.includes('screenXModeEl'), 'popup.js must bind screenXMode element');
    assert.ok(popupJs.includes('GLOW_KEYS') && popupJs.includes("'screenXMode'"), 'GLOW_KEYS must include screenXMode');

    // Content Script 4-Sided Frame Extension (ScreenX)
    assert.ok(contentJs.includes('drawScreenXFrame'), 'content.js must define drawScreenXFrame');
    assert.ok(contentJs.includes('aura-screenx-mode'), 'content.js must toggle aura-screenx-mode class');
    assert.ok(contentCss.includes('.aura-screenx-mode'), 'content.css must define .aura-screenx-mode styling');
    assert.ok(contentCss.includes('image-rendering: auto'), 'content.css must enable smooth image rendering for ScreenX');
    assert.ok(contentJs.includes('SCREENX_W') && contentJs.includes('SCREENX_H'), 'content.js must define high-definition ScreenX dimensions');
    assert.ok(contentJs.includes('SCREENX_PROFILE') && contentJs.includes('const effectiveBlur = settings.screenXMode ? SCREENX_PROFILE.blur : settings.blur;'), 'ScreenX mode must enforce fixed ScreenX profile irrespective of preset');
    assert.ok(contentJs.includes('settings.screenXMode ? SCREENX_W : SAMPLE_W'), 'ScreenX mode must dynamically scale canvas resolution');
    assert.ok(contentJs.includes('settings.screenXMode || forceFullDraw'), 'ScreenX mode must bypass temporal smoothing to prevent motion ghosting');
  });

  test('sampleEdgeColors uses a dedicated willReadFrequently offscreen context instead of reading back display canvas', async () => {
    const { setupMockEnvironment, MockElement, MockVideoElement } = require('./helpers/mock-dom');
    const env = setupMockEnvironment();
    const origWindow = globalThis.window;
    const origDoc = globalThis.document;
    const origChrome = globalThis.chrome;
    const origResizeObserver = globalThis.ResizeObserver;
    const origCineGlowPlayer = globalThis.window?.CineGlowPlayer;

    const video = new MockVideoElement();
    video.readyState = 4;
    video.paused = false;
    video.videoWidth = 1280;
    video.videoHeight = 720;
    video.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1280, height: 720, right: 1280, bottom: 720 });
    env.document.body.prepend = (el) => env.document.body.appendChild(el);
    env.document.visibilityState = 'visible';

    globalThis.window = env.window;
    globalThis.document = env.document;
    globalThis.chrome = env.chrome;
    globalThis.ResizeObserver = env.window.ResizeObserver;
    env.window.CineGlowPlayer = {
      isWatchPage: true,
      isTheater: false,
      isPiP: false,
      video,
      videoId: 'edge123',
      addEventListener: () => {},
      removeEventListener: () => {}
    };

    const readbackContexts = [];
    const createElementOrig = env.document.createElement.bind(env.document);
    env.document.createElement = (tag) => {
      const el = createElementOrig(tag);
      if (tag === 'canvas') {
        el.getContext = (_type, opts) => {
          return {
            drawImage: () => {},
            fillRect: () => {},
            clearRect: () => {},
            getImageData: (_x, _y, w, h) => {
              readbackContexts.push({ id: el.id || 'offscreen', opts });
              const data = new Uint8ClampedArray(w * h * 4);
              data.fill(180);
              return { data };
            }
          };
        };
      }
      return el;
    };

    try {
      const defaultsCode = fs.readFileSync(path.join(__dirname, '../shared/defaults.js'), 'utf8');
      new Function('globalThis', `${defaultsCode}; globalThis.AURA_DEFAULTS = AURA_DEFAULTS;`)(globalThis);
      const contentJs = fs.readFileSync(path.join(__dirname, '../content/content.js'), 'utf8');
      new Function(contentJs)();
      await new Promise(r => setTimeout(r, 40));

      let response = null;
      for (const listener of env.chrome.runtime.onMessage._listeners) {
        listener({ type: 'AURA_GET_EDGE_COLORS' }, {}, (res) => { response = res; });
      }

      assert.strictEqual(readbackContexts.length, 1, 'Expected a single getImageData readback');
      assert.strictEqual(readbackContexts[0].id, 'offscreen', 'Main display canvas must never run getImageData');
      assert.strictEqual(readbackContexts[0].opts?.willReadFrequently, true, 'Readback context must set willReadFrequently: true');
      assert.strictEqual(response?.active, true);
      assert.deepStrictEqual(response?.colors?.top, [180, 180, 180]);
    } finally {
      for (const listener of [...env.chrome.runtime.onMessage._listeners]) {
        listener({ type: 'AURA_EMERGENCY_KILL_SWITCH' }, {}, () => {});
      }
      delete globalThis.AURA_DEFAULTS;
      delete globalThis.window.CineGlowKilled;
      env.window.CineGlowPlayer = origCineGlowPlayer;
      globalThis.ResizeObserver = origResizeObserver;
      globalThis.window = origWindow;
      globalThis.document = origDoc;
      globalThis.chrome = origChrome;
    }
  });
});

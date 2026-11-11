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

    // Glow properties
    assert.strictEqual(d.opacity, 75);
    assert.strictEqual(d.spread, 150);
    assert.strictEqual(d.blur, 40);
    assert.strictEqual(d.saturation, 110);
    assert.strictEqual(d.contrast, 100);
    assert.strictEqual(d.brightness, 100);
    assert.strictEqual(d.smoothness, 60);
    assert.strictEqual(d.fadeInDuration, 1);
    assert.strictEqual(d.fps, 30);
    assert.strictEqual(d.glowTop, true);
    assert.strictEqual(d.glowRight, true);
    assert.strictEqual(d.glowBottom, true);
    assert.strictEqual(d.glowLeft, true);

    // Audio properties
    assert.strictEqual(d.audioNormalizer, false);
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
    assert.strictEqual(d.videoBrightness, 100);
    assert.strictEqual(d.videoContrast, 100);
    assert.strictEqual(d.videoSepia, 0);

    // Tools & Enhancements
    assert.strictEqual(d.adblockEnabled, true);
    assert.strictEqual(d.statsEnabled, false);
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
      assert.strictEqual(stored.opacity, 75, 'Storage must retain reset default (75), not overwritten by queued slider write');

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
});

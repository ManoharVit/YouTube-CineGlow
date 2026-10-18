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
});

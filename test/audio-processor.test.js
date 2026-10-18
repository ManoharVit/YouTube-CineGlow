// test/audio-processor.test.js
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setupMockEnvironment, MockVideoElement } = require('./helpers/mock-dom');

describe('Web Audio DSP Graph & Normalization Pipeline', () => {
  let env;
  let originalWindow;
  let originalDocument;
  let originalChrome;

  beforeEach(() => {
    env = setupMockEnvironment('https://www.youtube.com/watch?v=audioTest123');
    originalWindow = globalThis.window;
    originalDocument = globalThis.document;
    originalChrome = globalThis.chrome;

    globalThis.window = env.window;
    globalThis.document = env.document;
    globalThis.chrome = env.chrome;

    // Set up a mock CineGlowPlayer on window
    globalThis.window.CineGlowPlayer = new (class extends EventTarget {
      constructor() {
        super();
        this.video = null;
      }
    })();
  });

  afterEach(() => {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
    globalThis.chrome = originalChrome;
  });

  function loadAudioProcessor() {
    const code = fs.readFileSync(path.join(__dirname, '../content/audio-processor.js'), 'utf8');
    const fn = new Function(code);
    fn();
  }

  test('constructs Web Audio graph upon video attachment', async () => {
    const video = new MockVideoElement();
    loadAudioProcessor();

    // Attach video via CineGlowPlayer state-change
    globalThis.window.CineGlowPlayer.video = video;
    globalThis.window.CineGlowPlayer.dispatchEvent(new CustomEvent('state-change'));

    assert.ok(globalThis.window.CineGlowAudioCtx, 'AudioContext should be created and exposed');
    assert.ok(globalThis.window.CineGlowAudioAnalyser, 'AnalyserNode should be exposed for beat sync');
    assert.ok(globalThis.window.CineGlowAudioGainNode, 'GainNode should be exposed');
    assert.strictEqual(video.cineGlowAudioAttached, true);
  });

  test('DynamicsCompressorNode is configured with studio normalization parameters', () => {
    const video = new MockVideoElement();
    loadAudioProcessor();

    globalThis.window.CineGlowPlayer.video = video;
    globalThis.window.CineGlowPlayer.dispatchEvent(new CustomEvent('state-change'));

    const ctx = globalThis.window.CineGlowAudioCtx;
    assert.ok(ctx.compressorNodes.length >= 2, 'Should create normalizer compressor and brickwall limiter');

    const normalizerComp = ctx.compressorNodes[0];
    assert.strictEqual(normalizerComp.threshold.value, -24, 'Threshold must be -24 dB');
    assert.strictEqual(normalizerComp.knee.value, 30, 'Knee must be 30 dB');
    assert.strictEqual(normalizerComp.ratio.value, 12, 'Ratio must be 12:1');
    assert.strictEqual(normalizerComp.attack.value, 0.003, 'Attack must be 3ms');
    assert.strictEqual(normalizerComp.release.value, 0.25, 'Release must be 250ms');

    const limiterComp = ctx.compressorNodes[1];
    assert.strictEqual(limiterComp.threshold.value, -1.0, 'Limiter threshold must be -1.0 dB');
    assert.strictEqual(limiterComp.ratio.value, 20, 'Limiter ratio must be 20:1');
  });

  test('crossfades dry and wet gains when audioNormalizer setting changes', () => {
    const video = new MockVideoElement();
    loadAudioProcessor();

    globalThis.window.CineGlowPlayer.video = video;
    globalThis.window.CineGlowPlayer.dispatchEvent(new CustomEvent('state-change'));

    const ctx = globalThis.window.CineGlowAudioCtx;
    // In audio-processor:
    // gainNodes[0] is normalizerGain (dry)
    // gainNodes[1] is compressedGain (wet)
    // gainNodes[2] is master gainNode
    const normalizerDry = ctx.gainNodes[0];
    const compressedWet = ctx.gainNodes[1];

    // Default setting: audioNormalizer is false -> dry=1, wet=0
    assert.strictEqual(normalizerDry.gain.value, 1);
    assert.strictEqual(compressedWet.gain.value, 0);

    // Toggle normalizer ON
    for (const listener of env.chrome.storage.onChanged._listeners) {
      listener({ audioNormalizer: { newValue: true } }, 'sync');
    }

    assert.strictEqual(normalizerDry.gain.value, 0, 'Dry gain should fade to 0 when normalizer is ON');
    assert.strictEqual(compressedWet.gain.value, 1, 'Wet gain should fade to 1 when normalizer is ON');

    // Toggle normalizer OFF
    for (const listener of env.chrome.storage.onChanged._listeners) {
      listener({ audioNormalizer: { newValue: false } }, 'sync');
    }

    assert.strictEqual(normalizerDry.gain.value, 1, 'Dry gain should return to 1 when normalizer is OFF');
    assert.strictEqual(compressedWet.gain.value, 0, 'Wet gain should return to 0 when normalizer is OFF');
  });

  test('configures dedicated Bass and Vocal biquad filters with proper frequency and clamping', () => {
    const video = new MockVideoElement();
    loadAudioProcessor();

    globalThis.window.CineGlowPlayer.video = video;
    globalThis.window.CineGlowPlayer.dispatchEvent(new CustomEvent('state-change'));

    const ctx = globalThis.window.CineGlowAudioCtx;
    // filterNodes[0] is bassFilter (80Hz lowshelf)
    // filterNodes[1] is vocalFilter (2500Hz peaking, Q=1.2)
    const bassFilter = ctx.filterNodes[0];
    const vocalFilter = ctx.filterNodes[1];

    assert.strictEqual(bassFilter.type, 'lowshelf');
    assert.strictEqual(bassFilter.frequency.value, 80);

    assert.strictEqual(vocalFilter.type, 'peaking');
    assert.strictEqual(vocalFilter.frequency.value, 2500);
    assert.strictEqual(vocalFilter.Q.value, 1.2);

    // Test boost adjustments with upper clamping bounds
    for (const listener of env.chrome.storage.onChanged._listeners) {
      listener({
        bassBoost: { newValue: 20 },  // exceeds 15 dB limit
        vocalBoost: { newValue: 18 }  // exceeds 12 dB limit
      }, 'sync');
    }

    assert.strictEqual(bassFilter.gain.value, 15, 'Bass boost must be clamped to +15 dB maximum');
    assert.strictEqual(vocalFilter.gain.value, 12, 'Vocal boost must be clamped to +12 dB maximum');
  });

  test('configures 5-Band Equalizer frequencies and handles decibel changes', () => {
    const video = new MockVideoElement();
    loadAudioProcessor();

    globalThis.window.CineGlowPlayer.video = video;
    globalThis.window.CineGlowPlayer.dispatchEvent(new CustomEvent('state-change'));

    const ctx = globalThis.window.CineGlowAudioCtx;
    // filterNodes[2..6] are 60Hz, 250Hz, 1000Hz, 4000Hz, 12000Hz
    const eq60 = ctx.filterNodes[2];
    const eq250 = ctx.filterNodes[3];
    const eq1000 = ctx.filterNodes[4];
    const eq4000 = ctx.filterNodes[5];
    const eq12000 = ctx.filterNodes[6];

    assert.strictEqual(eq60.frequency.value, 60);
    assert.strictEqual(eq60.type, 'lowshelf');

    assert.strictEqual(eq250.frequency.value, 250);
    assert.strictEqual(eq250.type, 'peaking');

    assert.strictEqual(eq1000.frequency.value, 1000);
    assert.strictEqual(eq1000.type, 'peaking');

    assert.strictEqual(eq4000.frequency.value, 4000);
    assert.strictEqual(eq4000.type, 'peaking');

    assert.strictEqual(eq12000.frequency.value, 12000);
    assert.strictEqual(eq12000.type, 'highshelf');

    // Apply custom rock curve (+4, +2, -1, +3, +4)
    for (const listener of env.chrome.storage.onChanged._listeners) {
      listener({
        eq60: { newValue: 4 },
        eq250: { newValue: 2 },
        eq1000: { newValue: -1 },
        eq4000: { newValue: 3 },
        eq12000: { newValue: 4 }
      }, 'sync');
    }

    assert.strictEqual(eq60.gain.value, 4);
    assert.strictEqual(eq250.gain.value, 2);
    assert.strictEqual(eq1000.gain.value, -1);
    assert.strictEqual(eq4000.gain.value, 3);
    assert.strictEqual(eq12000.gain.value, 4);
  });

  test('resumes suspended AudioContext on user interaction to comply with autoplay policy', () => {
    const video = new MockVideoElement();
    loadAudioProcessor();

    globalThis.window.CineGlowPlayer.video = video;
    globalThis.window.CineGlowPlayer.dispatchEvent(new CustomEvent('state-change'));

    const ctx = globalThis.window.CineGlowAudioCtx;
    ctx.state = 'suspended';

    // Simulate play event
    video.dispatchEvent(new Event('play'));
    assert.strictEqual(ctx.state, 'running', 'AudioContext must resume on play event');
  });
});

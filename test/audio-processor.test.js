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
    delete globalThis.AURA_DEFAULTS;
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

  test('FP-6.1: only instantiates AudioContext and mediaElementSource when at least one audio DSP feature is enabled', async () => {
    const video = new MockVideoElement();
    loadAudioProcessor();

    // 1. When all DSP features are disabled (default), AudioContext must NOT be instantiated
    globalThis.window.CineGlowPlayer.video = video;
    globalThis.window.CineGlowPlayer.dispatchEvent(new CustomEvent('state-change'));

    assert.ok(!globalThis.window.CineGlowAudioCtx, 'AudioContext should not be instantiated when DSP is disabled');
    assert.ok(!globalThis.window.CineGlowAudioAnalyser);
    assert.ok(!video.cineGlowAudioAttached);

    // 2. When at least one DSP feature is enabled (e.g. bassBoost: 5), AudioContext is instantiated
    for (const listener of env.chrome.storage.onChanged._listeners) {
      listener({ bassBoost: { newValue: 5 } }, 'sync');
    }

    assert.ok(globalThis.window.CineGlowAudioCtx, 'AudioContext should be created and exposed when DSP is enabled');
    assert.ok(globalThis.window.CineGlowAudioAnalyser, 'AnalyserNode should be exposed for beat sync');
    assert.ok(globalThis.window.CineGlowAudioGainNode, 'GainNode should be exposed');
    assert.strictEqual(video.cineGlowAudioAttached, true);
  });

  test('DynamicsCompressorNode is configured with studio normalization parameters', () => {
    globalThis.AURA_DEFAULTS = { bassBoost: 1 };
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
    globalThis.AURA_DEFAULTS = { bassBoost: 1 };
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
    globalThis.AURA_DEFAULTS = { bassBoost: 1 };
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
    globalThis.AURA_DEFAULTS = { bassBoost: 1 };
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
    globalThis.AURA_DEFAULTS = { bassBoost: 1 };
    const video = new MockVideoElement();
    loadAudioProcessor();

    globalThis.window.CineGlowPlayer.video = video;
    globalThis.window.CineGlowPlayer.dispatchEvent(new CustomEvent('state-change'));

    const ctx = globalThis.window.CineGlowAudioCtx;

    // 1. Simulate play event
    ctx.state = 'suspended';
    video.dispatchEvent(new Event('play'));
    assert.strictEqual(ctx.state, 'running', 'AudioContext must resume on play event');

    // 2. Simulate playing event
    ctx.state = 'suspended';
    video.dispatchEvent(new Event('playing'));
    assert.strictEqual(ctx.state, 'running', 'AudioContext must resume on playing event');

    // 3. Simulate volumechange event
    ctx.state = 'suspended';
    video.dispatchEvent(new Event('volumechange'));
    assert.strictEqual(ctx.state, 'running', 'AudioContext must resume on volumechange event');

    // 4. Simulate window pointerdown event
    ctx.state = 'suspended';
    globalThis.window.dispatchEvent(new Event('pointerdown'));
    assert.strictEqual(ctx.state, 'running', 'AudioContext must resume on window pointerdown event');

    // 5. Simulate window click event
    ctx.state = 'suspended';
    globalThis.window.dispatchEvent(new Event('click'));
    assert.strictEqual(ctx.state, 'running', 'AudioContext must resume on window click event');
  });

  test('FP-6.4: computeEffectiveGain preserves master volume gain without broadband headroom attenuation under high EQ and bass boost', () => {
    loadAudioProcessor();
    const computeGain = globalThis.window.CineGlowAudioComputeEffectiveGain;
    assert.ok(typeof computeGain === 'function', 'computeEffectiveGain should be exposed for testing');

    // Default settings: 100% volume, 0 dB boost
    const defaultGain = computeGain();
    assert.strictEqual(defaultGain, 1.0, 'Default effective gain at 100% volume without EQ boost should be 1.0');

    // Apply high EQ boost (+15 dB bass + +12 dB vocal) at 100% volume
    for (const listener of env.chrome.storage.onChanged._listeners) {
      listener({
        audioBoost: { newValue: 100 },
        bassBoost: { newValue: 15 },
        vocalBoost: { newValue: 12 }
      }, 'sync');
    }

    const gainAt100WithBoost = computeGain();
    assert.strictEqual(gainAt100WithBoost, 1.0, `Effective gain at 100% volume with +27 dB boost must remain 1.0 (un-attenuated), got ${gainAt100WithBoost}`);

    // Apply high EQ boost at 300% volume
    for (const listener of env.chrome.storage.onChanged._listeners) {
      listener({
        audioBoost: { newValue: 300 },
        bassBoost: { newValue: 15 },
        vocalBoost: { newValue: 12 }
      }, 'sync');
    }

    const gainAt300WithBoost = computeGain();
    assert.strictEqual(gainAt300WithBoost, 3.0, `Effective gain at 300% volume with +27 dB boost must remain 3.0 (un-attenuated), got ${gainAt300WithBoost}`);
  });

  test('retains and reconnects existing source node when switching video A -> B -> A', () => {
    globalThis.AURA_DEFAULTS = { bassBoost: 1 };
    const videoA = new MockVideoElement();
    const videoB = new MockVideoElement();
    loadAudioProcessor();

    // 1. Attach Video A
    globalThis.window.CineGlowPlayer.video = videoA;
    globalThis.window.CineGlowPlayer.dispatchEvent(new CustomEvent('state-change'));

    const sourceA = globalThis.window.CineGlowAudioGetActiveSource();
    assert.ok(sourceA, 'Source for Video A should be active');
    assert.strictEqual(videoA.cineGlowAudioAttached, true);
    assert.strictEqual(sourceA.mediaElement, videoA);
    assert.ok(sourceA.connections.length > 0, 'Source A must be connected');

    // 2. Switch to Video B
    globalThis.window.CineGlowPlayer.video = videoB;
    globalThis.window.CineGlowPlayer.dispatchEvent(new CustomEvent('state-change'));

    const sourceB = globalThis.window.CineGlowAudioGetActiveSource();
    assert.ok(sourceB, 'Source for Video B should be active');
    assert.notStrictEqual(sourceB, sourceA, 'Video B should have a distinct source node');
    assert.strictEqual(videoB.cineGlowAudioAttached, true);
    assert.strictEqual(sourceB.mediaElement, videoB);
    assert.strictEqual(sourceA.connections.length, 0, 'Source A must be disconnected when Video B is active');

    // 3. Return to Video A (previously skipped reconnection because videoA.cineGlowAudioAttached was true)
    globalThis.window.CineGlowPlayer.video = videoA;
    globalThis.window.CineGlowPlayer.dispatchEvent(new CustomEvent('state-change'));

    const activeSource = globalThis.window.CineGlowAudioGetActiveSource();
    assert.strictEqual(activeSource, sourceA, 'Must reuse Video A existing source node');
    assert.strictEqual(sourceB.connections.length, 0, 'Source B must be disconnected');
    assert.ok(sourceA.connections.length > 0, 'Source A must be reconnected to the DSP graph');
  });

  test('disconnects active audio source when video element is unmounted (player video becomes null)', () => {
    globalThis.AURA_DEFAULTS = { bassBoost: 1 };
    const video = new MockVideoElement();
    loadAudioProcessor();

    // Attach video
    globalThis.window.CineGlowPlayer.video = video;
    globalThis.window.CineGlowPlayer.dispatchEvent(new CustomEvent('state-change'));

    const source = globalThis.window.CineGlowAudioGetActiveSource();
    assert.ok(source, 'Source should be active');
    assert.ok(source.connections.length > 0, 'Source must be connected');

    // Video unmounted (e.g. user navigated to YouTube home page)
    globalThis.window.CineGlowPlayer.video = null;
    globalThis.window.CineGlowPlayer.dispatchEvent(new CustomEvent('state-change'));

    const activeSourceAfter = globalThis.window.CineGlowAudioGetActiveSource();
    assert.strictEqual(activeSourceAfter, null, 'Active source must be cleared');
    assert.strictEqual(source.connections.length, 0, 'Source must be disconnected when video is unmounted');
  });

  test('FP-6.2: adds makeup gain node (+8 dB to +10 dB) on compressor wet path to eliminate normalizer volume drop', () => {
    globalThis.AURA_DEFAULTS = { audioNormalizer: true };
    const video = new MockVideoElement();
    loadAudioProcessor();

    globalThis.window.CineGlowPlayer.video = video;
    globalThis.window.CineGlowPlayer.dispatchEvent(new CustomEvent('state-change'));

    const ctx = globalThis.window.CineGlowAudioCtx;
    assert.ok(ctx, 'AudioContext must be created');

    const makeupGain = globalThis.window.CineGlowAudioGetMakeupGainNode();
    assert.ok(makeupGain, 'Makeup gain node must exist');
    const expectedGain = Math.pow(10, 9.0 / 20);
    assert.ok(Math.abs(makeupGain.gain.value - expectedGain) < 0.01, `Makeup gain should be ~${expectedGain}, got ${makeupGain.gain.value}`);
    assert.ok(makeupGain.gain.value >= Math.pow(10, 8.0 / 20), 'Makeup gain must be at least +8 dB');
    assert.ok(makeupGain.gain.value <= Math.pow(10, 10.0 / 20), 'Makeup gain must not exceed +10 dB');
  });

  test('FP-6.3: teardownKillSwitch bypasses DSP without calling audioCtx.close(), connecting source to destination', () => {
    globalThis.AURA_DEFAULTS = { audioNormalizer: true, audioBoost: 120 };
    const video = new MockVideoElement();
    loadAudioProcessor();

    globalThis.window.CineGlowPlayer.video = video;
    globalThis.window.CineGlowPlayer.dispatchEvent(new CustomEvent('state-change'));

    const ctx = globalThis.window.CineGlowAudioCtx;
    const source = globalThis.window.CineGlowAudioGetActiveSource();
    assert.ok(ctx && source);

    const dryGain = ctx.gainNodes[0];
    const wetGain = ctx.gainNodes[1];

    // Trigger teardown
    globalThis.window.CineGlowAudioTeardown();

    // 1. AudioContext must NOT be closed under W3C spec (FP-6.3)
    assert.strictEqual(ctx.state, 'running', 'AudioContext must not be closed upon kill switch');

    // 2. DSP must be bypassed: source connected directly to destination
    assert.ok(source.connections.includes(ctx.destination), 'Source must connect directly to destination on kill switch');

    // 3. Gains set: wetGain to 0, dryGain to 1
    assert.strictEqual(wetGain.gain.value, 0, 'wetGain must be 0');
    assert.strictEqual(dryGain.gain.value, 1, 'dryGain must be 1');

    // 4. Global window hooks cleared
    assert.strictEqual(globalThis.window.CineGlowAudioCtx, null);
    assert.strictEqual(globalThis.window.CineGlowAudioAnalyser, null);
  });

  function selectVideo(video) {
    window.CineGlowPlayer.video = video;
    window.CineGlowPlayer.dispatchEvent(new CustomEvent('state-change'));
  }

  function setBassBoost(value) {
    for (const listener of env.chrome.storage.onChanged._listeners) {
      listener({ bassBoost: { newValue: value } }, 'sync');
    }
  }

  test('disabling the last audio effect immediately bypasses DSP and re-enabling reconnects it', async () => {
    loadAudioProcessor();
    await Promise.resolve();
    const video = new MockVideoElement();
    selectVideo(video);
    setBassBoost(5);
    const source = window.CineGlowAudioGetActiveSource();
    const ctx = window.CineGlowAudioCtx;

    setBassBoost(0);
    assert.ok(source.connections.length === 1 && source.connections[0] === ctx.destination, 'Disabling DSP must bypass it without waiting for a player event');

    selectVideo(video);
    setBassBoost(5);
    assert.strictEqual(window.CineGlowAudioGetActiveSource(), source, 'Re-enabling must reuse the existing media source');
    assert.ok(!source.connections.includes(ctx.destination), 'Re-enabling must remove the direct bypass');
    assert.ok(source.connections.includes(ctx.gainNodes[0]), 'Re-enabling must reconnect the dry DSP input');
    assert.ok(source.connections.includes(ctx.compressorNodes[0]), 'Re-enabling must reconnect the wet DSP input');
  });

  test('disabled DSP reconnects the correct existing source when returning to an earlier video', async () => {
    loadAudioProcessor();
    await Promise.resolve();
    const videoA = new MockVideoElement();
    const videoB = new MockVideoElement();
    selectVideo(videoA);
    setBassBoost(5);
    const sourceA = window.CineGlowAudioGetActiveSource();
    const ctx = window.CineGlowAudioCtx;
    selectVideo(videoB);
    const sourceB = window.CineGlowAudioGetActiveSource();

    setBassBoost(0);
    selectVideo(videoA);
    assert.ok(window.CineGlowAudioGetActiveSource() === sourceA, 'Returning to A must select A’s source');
    assert.ok(sourceA.connections.length === 1 && sourceA.connections[0] === ctx.destination, 'A must remain audible with DSP disabled');
    assert.deepStrictEqual(sourceB.connections, [], 'The inactive B source must be disconnected');
  });

  test('a new video remains native while DSP is disabled and receives its own source on re-enable', async () => {
    loadAudioProcessor();
    await Promise.resolve();
    const videoA = new MockVideoElement();
    const videoB = new MockVideoElement();
    selectVideo(videoA);
    setBassBoost(5);
    const sourceA = window.CineGlowAudioGetActiveSource();

    setBassBoost(0);
    selectVideo(videoB);
    assert.ok(window.CineGlowAudioGetActiveSource() === null, 'The new video must not inherit A’s source');
    assert.strictEqual(window.CineGlowAudioGetVideoSource(videoB), undefined, 'Disabled DSP must not capture an untouched video');
    assert.deepStrictEqual(sourceA.connections, []);

    setBassBoost(5);
    const sourceB = window.CineGlowAudioGetActiveSource();
    assert.ok(sourceB, 'Re-enabling must create B’s source');
    assert.strictEqual(sourceB.mediaElement, videoB);
    assert.notStrictEqual(sourceB, sourceA);
    assert.ok(sourceB.connections.length > 0);
  });

});

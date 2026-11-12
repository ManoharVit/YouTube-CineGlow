// test/lights-out.test.js
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setupMockEnvironment, MockVideoElement, MockElement } = require('./helpers/mock-dom');

describe('Cinema Lights Out & Ambient Focus Dimmer', () => {
  let env;
  let originalWindow;
  let originalDocument;
  let originalChrome;

  beforeEach(() => {
    env = setupMockEnvironment('https://www.youtube.com/watch?v=lightsOutVid');
    originalWindow = globalThis.window;
    originalDocument = globalThis.document;
    originalChrome = globalThis.chrome;

    globalThis.window = env.window;
    globalThis.document = env.document;
    globalThis.chrome = env.chrome;
    globalThis.window.chrome = env.chrome;

    // Mock CineGlowPlayer
    const video = new MockVideoElement();
    const player = new MockElement('div', { id: 'movie_player' });
    globalThis.window.CineGlowPlayer = new (class extends EventTarget {
      constructor() {
        super();
        this.isWatchPage = true;
        this.videoId = 'lightsOutVid';
        this.video = video;
        this.player = player;
      }
    })();

    // Load defaults
    const defaultsCode = fs.readFileSync(path.join(__dirname, '../shared/defaults.js'), 'utf8');
    const fnDef = new Function(`'use strict'; ${defaultsCode}; return AURA_DEFAULTS;`);
    globalThis.AURA_DEFAULTS = fnDef();
    globalThis.window.AURA_DEFAULTS = globalThis.AURA_DEFAULTS;
  });

  afterEach(() => {
    if (globalThis.window?.CineGlowLightsOut?.teardown) {
      globalThis.window.CineGlowLightsOut.teardown();
    }
    delete globalThis.AURA_DEFAULTS;
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
    globalThis.chrome = originalChrome;
  });

  function loadLightsOutScript() {
    const code = fs.readFileSync(path.join(__dirname, '../content/lights-out.js'), 'utf8');
    const fn = new Function(code);
    fn();
    return globalThis.window.CineGlowLightsOut;
  }

  test('initializes cleanly without dimming when lightsOut is disabled by default', () => {
    const lo = loadLightsOutScript();
    assert.ok(lo, 'CineGlowLightsOut API must be mounted');
    assert.strictEqual(lo.getState().enabled, false);
    assert.strictEqual(globalThis.document.documentElement.classList.contains('aura-lights-out'), false);
    assert.strictEqual(globalThis.document.documentElement.classList.contains('aura-lights-out-active'), false);
  });

  test('enabling lightsOut sets aura-lights-out class and activates on video play', () => {
    const lo = loadLightsOutScript();
    const video = globalThis.window.CineGlowPlayer.video;

    lo.toggle();
    assert.strictEqual(lo.getState().enabled, true);
    assert.strictEqual(globalThis.document.documentElement.classList.contains('aura-lights-out'), true);
    // Video is paused initially, so not yet active
    assert.strictEqual(globalThis.document.documentElement.classList.contains('aura-lights-out-active'), false);

    // Simulate play
    video.paused = false;
    video.dispatchEvent(new Event('play'));

    assert.strictEqual(globalThis.document.documentElement.classList.contains('aura-lights-out-active'), true);
    assert.strictEqual(globalThis.document.documentElement.style.getPropertyValue('--cineglow-dim-opacity'), '0.15');

    // Simulate pause
    video.paused = true;
    video.dispatchEvent(new Event('pause'));
    assert.strictEqual(globalThis.document.documentElement.classList.contains('aura-lights-out-active'), false);
  });

  test('dynamically updates CSS custom property based on setOpacity', () => {
    const lo = loadLightsOutScript();
    const video = globalThis.window.CineGlowPlayer.video;

    lo.toggle();
    video.paused = false;
    video.dispatchEvent(new Event('play'));

    lo.setOpacity(90);
    assert.strictEqual(globalThis.document.documentElement.style.getPropertyValue('--cineglow-dim-opacity'), '0.1');

    lo.setOpacity(100);
    assert.strictEqual(globalThis.document.documentElement.style.getPropertyValue('--cineglow-dim-opacity'), '0');

    lo.setOpacity(50);
    assert.strictEqual(globalThis.document.documentElement.style.getPropertyValue('--cineglow-dim-opacity'), '0.5');
  });

  test('Shift+D hotkey toggles lights out and ignores editable inputs', () => {
    const lo = loadLightsOutScript();
    assert.strictEqual(lo.getState().enabled, false);

    // Dispatch Shift+D
    let prevented = false;
    const keyEvent = {
      key: 'D',
      shiftKey: true,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      preventDefault: () => { prevented = true; }
    };
    globalThis.window.dispatchEvent(Object.assign(new Event('keydown'), keyEvent));
    assert.strictEqual(prevented, true);
    assert.strictEqual(lo.getState().enabled, true);

    // Focus input element
    const inputEl = new MockElement('input');
    globalThis.document.activeElement = inputEl;

    prevented = false;
    globalThis.window.dispatchEvent(Object.assign(new Event('keydown'), keyEvent));
    assert.strictEqual(prevented, false, 'Must not toggle when input element is focused');
    assert.strictEqual(lo.getState().enabled, true);

    globalThis.document.activeElement = null;
  });

  test('emergency kill-switch cleans up DOM classes and disarms listeners', () => {
    const lo = loadLightsOutScript();
    const video = globalThis.window.CineGlowPlayer.video;

    lo.toggle();
    video.paused = false;
    video.dispatchEvent(new Event('play'));
    assert.strictEqual(globalThis.document.documentElement.classList.contains('aura-lights-out-active'), true);

    // Trigger kill-switch event
    globalThis.window.dispatchEvent(new Event('cineglow:kill-switch'));

    assert.strictEqual(globalThis.document.documentElement.classList.contains('aura-lights-out'), false);
    assert.strictEqual(globalThis.document.documentElement.classList.contains('aura-lights-out-active'), false);

    // Subsequent toggles do nothing
    lo.toggle();
    assert.strictEqual(globalThis.document.documentElement.classList.contains('aura-lights-out'), false);
  });
});

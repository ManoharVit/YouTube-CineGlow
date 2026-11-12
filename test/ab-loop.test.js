// test/ab-loop.test.js
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setupMockEnvironment, MockVideoElement, MockElement } = require('./helpers/mock-dom');

describe('Interactive A-B Section Looper', () => {
  let env;
  let originalWindow;
  let originalDocument;
  let originalChrome;

  beforeEach(() => {
    env = setupMockEnvironment('https://www.youtube.com/watch?v=abLoopVid123');
    originalWindow = globalThis.window;
    originalDocument = globalThis.document;
    originalChrome = globalThis.chrome;

    globalThis.window = env.window;
    globalThis.document = env.document;
    globalThis.chrome = env.chrome;
    globalThis.window.chrome = env.chrome;

    // Create video and player elements
    const video = new MockVideoElement();
    video.duration = 100;
    video.currentTime = 0;

    const player = new MockElement('div', { id: 'movie_player' });
    const progressBar = new MockElement('div', { className: 'ytp-progress-bar' });
    player.appendChild(progressBar);

    // Mock CineGlowPlayer
    globalThis.window.CineGlowPlayer = new (class extends EventTarget {
      constructor() {
        super();
        this.isWatchPage = true;
        this.videoId = 'abLoopVid123';
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
    if (globalThis.window?.CineGlowABLoop?.teardown) {
      globalThis.window.CineGlowABLoop.teardown();
    }
    delete globalThis.AURA_DEFAULTS;
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
    globalThis.chrome = originalChrome;
  });

  function loadABLoopScript() {
    const code = fs.readFileSync(path.join(__dirname, '../content/ab-loop.js'), 'utf8');
    const fn = new Function(code);
    fn();
    return globalThis.window.CineGlowABLoop;
  }

  test('initializes with null loop points and inactive state', () => {
    const ab = loadABLoopScript();
    assert.ok(ab, 'CineGlowABLoop API must be exposed on window');
    const state = ab.getState();
    assert.strictEqual(state.pointA, null);
    assert.strictEqual(state.pointB, null);
    assert.strictEqual(state.isLooping, false);
    assert.strictEqual(state.loopCount, 0);
  });

  test('sets Point A and Point B, activating the loop and HUD', () => {
    const ab = loadABLoopScript();
    const video = globalThis.window.CineGlowPlayer.video;

    // Set A at 15s
    ab.setPointA(15);
    let state = ab.getState();
    assert.strictEqual(state.pointA, 15);
    assert.strictEqual(state.pointB, null);
    assert.strictEqual(state.isLooping, false);

    const host = globalThis.document.getElementById('cineglow-ab-host');
    assert.ok(host, 'HUD host container must be created');

    // Set B at 45s
    ab.setPointB(45);
    state = ab.getState();
    assert.strictEqual(state.pointA, 15);
    assert.strictEqual(state.pointB, 45);
    assert.strictEqual(state.isLooping, true);

    const hudEl = host.shadowRoot ? host.shadowRoot.children[0] : host.children[0];
    const timesEl = hudEl ? hudEl.children.find(c => c.id === 'abTimes') : null;
    assert.ok(timesEl && timesEl.textContent.includes('A: 0:15 | B: 0:45'), 'HUD must format and display timestamps');
  });

  test('seeks video to Point A and increments counter when reaching Point B', () => {
    const ab = loadABLoopScript();
    const video = globalThis.window.CineGlowPlayer.video;

    ab.setPointA(10);
    ab.setPointB(20);

    video.currentTime = 15;
    video.dispatchEvent(new Event('timeupdate'));
    assert.strictEqual(ab.getState().loopCount, 0);
    assert.strictEqual(video.currentTime, 15);

    // Reach Point B
    video.currentTime = 20.1;
    video.dispatchEvent(new Event('timeupdate'));

    assert.strictEqual(video.currentTime, 10, 'Must seek back to Point A');
    assert.strictEqual(ab.getState().loopCount, 1, 'Loop count must increment');

    // Loop again
    video.currentTime = 20.5;
    video.dispatchEvent(new Event('timeupdate'));
    assert.strictEqual(video.currentTime, 10);
    assert.strictEqual(ab.getState().loopCount, 2);
  });

  test('toggleLoop toggles looping state and resetLoop clears points', () => {
    const ab = loadABLoopScript();
    ab.setPointA(5);
    ab.setPointB(15);
    assert.strictEqual(ab.getState().isLooping, true);

    ab.toggleLoop();
    assert.strictEqual(ab.getState().isLooping, false);

    ab.toggleLoop();
    assert.strictEqual(ab.getState().isLooping, true);

    ab.resetLoop();
    const state = ab.getState();
    assert.strictEqual(state.pointA, null);
    assert.strictEqual(state.pointB, null);
    assert.strictEqual(state.isLooping, false);
    assert.strictEqual(state.loopCount, 0);
  });

  test('keyboard shortcuts [, ], and \\ set loop points and toggle loop', () => {
    const ab = loadABLoopScript();
    const video = globalThis.window.CineGlowPlayer.video;
    video.currentTime = 30;

    // Press '['
    let prevented = false;
    globalThis.window.dispatchEvent(Object.assign(new Event('keydown'), {
      key: '[',
      preventDefault: () => { prevented = true; }
    }));
    assert.strictEqual(prevented, true);
    assert.strictEqual(ab.getState().pointA, 30);

    // Advance time and press ']'
    video.currentTime = 60;
    prevented = false;
    globalThis.window.dispatchEvent(Object.assign(new Event('keydown'), {
      key: ']',
      preventDefault: () => { prevented = true; }
    }));
    assert.strictEqual(prevented, true);
    assert.strictEqual(ab.getState().pointB, 60);
    assert.strictEqual(ab.getState().isLooping, true);

    // Press '\'
    prevented = false;
    globalThis.window.dispatchEvent(Object.assign(new Event('keydown'), {
      key: '\\',
      preventDefault: () => { prevented = true; }
    }));
    assert.strictEqual(prevented, true);
    assert.strictEqual(ab.getState().isLooping, false);
  });

  test('emergency kill-switch dismantles A-B HUD and disarms timeupdate listener', () => {
    const ab = loadABLoopScript();
    const video = globalThis.window.CineGlowPlayer.video;

    ab.setPointA(10);
    ab.setPointB(20);
    assert.ok(globalThis.document.getElementById('cineglow-ab-host'));

    // Trigger kill-switch
    globalThis.window.dispatchEvent(new Event('cineglow:kill-switch'));

    assert.strictEqual(globalThis.document.getElementById('cineglow-ab-host'), null);

    // Video timeupdate after kill does not seek
    video.currentTime = 25;
    video.dispatchEvent(new Event('timeupdate'));
    assert.strictEqual(video.currentTime, 25);
  });
});

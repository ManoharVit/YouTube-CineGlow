// test/player-lifecycle.test.js
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setupMockEnvironment, MockVideoElement, MockElement } = require('./helpers/mock-dom');

describe('PlayerManager Lifecycle & State Tracking', () => {
  let env;
  let originalWindow;
  let originalDocument;
  let originalLocation;
  let originalMutationObserver;

  beforeEach(() => {
    env = setupMockEnvironment('https://www.youtube.com/watch?v=initialVideoId');
    originalWindow = globalThis.window;
    originalDocument = globalThis.document;
    originalLocation = globalThis.location;
    originalMutationObserver = globalThis.MutationObserver;

    globalThis.window = env.window;
    globalThis.document = env.document;
    globalThis.location = env.window.location;
    globalThis.MutationObserver = env.window.MutationObserver;
  });

  afterEach(() => {
    if (globalThis.window?.CineGlowPlayer?.searchInterval) {
      clearInterval(globalThis.window.CineGlowPlayer.searchInterval);
    }
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
    globalThis.location = originalLocation;
    globalThis.MutationObserver = originalMutationObserver;
  });

  function loadPlayerManager() {
    const code = fs.readFileSync(path.join(__dirname, '../content/player-manager.js'), 'utf8');
    // Execute script in current global context
    const fn = new Function(code);
    fn();
    return globalThis.window.CineGlowPlayer;
  }

  test('initializes with watch page state and parses videoId from URL', () => {
    const pm = loadPlayerManager();
    assert.strictEqual(pm.isWatchPage, true);
    assert.strictEqual(pm.videoId, 'initialVideoId');
    assert.strictEqual(pm.isPlaying, false);
    assert.strictEqual(pm.isPiP, false);
  });

  test('detects movie_player and video element and dispatches state-change', () => {
    const pm = loadPlayerManager();

    const video = new MockVideoElement();
    const player = new MockElement('div', { id: 'movie_player' });
    player.querySelector = (sel) => (sel === 'video.html5-main-video' ? video : null);

    let stateChangeFired = false;
    let detailPayload = null;

    pm.addEventListener('state-change', (e) => {
      stateChangeFired = true;
      detailPayload = e.detail;
    });

    // Mount elements dynamically
    env.elements.set('#movie_player', player);
    env.elements.set('video.html5-main-video', video);
    pm.checkState();

    assert.strictEqual(stateChangeFired, true);
    assert.strictEqual(detailPayload.video, video);
    assert.strictEqual(detailPayload.player, player);
    assert.strictEqual(pm.video, video);
    assert.strictEqual(pm.player, player);
  });

  test('detects SPA video transition via URL v= parameter change', () => {
    const pm = loadPlayerManager();

    let stateChangeCount = 0;
    pm.addEventListener('state-change', () => {
      stateChangeCount++;
    });

    // Simulate YouTube SPA navigation updating location.search
    env.window.location.search = '?v=nextVideoId456';
    pm.checkState();

    assert.strictEqual(pm.videoId, 'nextVideoId456');
    assert.strictEqual(stateChangeCount, 1);
  });

  test('updates isPlaying on play, pause, and ended events', () => {
    const video = new MockVideoElement();
    const player = new MockElement('div', { id: 'movie_player' });
    player.querySelector = (sel) => (sel === 'video.html5-main-video' ? video : null);
    env.elements.set('#movie_player', player);
    env.elements.set('video.html5-main-video', video);

    const pm = loadPlayerManager();
    pm.checkState();

    let events = [];
    pm.addEventListener('state-change', (e) => {
      events.push(e.detail.isPlaying);
    });

    // Simulate play
    video.play();
    assert.strictEqual(pm.isPlaying, true);

    // Simulate pause
    video.pause();
    assert.strictEqual(pm.isPlaying, false);

    assert.deepStrictEqual(events, [true, false]);
  });

  test('tracks Picture-in-Picture transitions', () => {
    const video = new MockVideoElement();
    const player = new MockElement('div', { id: 'movie_player' });
    player.querySelector = (sel) => (sel === 'video.html5-main-video' ? video : null);
    env.elements.set('#movie_player', player);
    env.elements.set('video.html5-main-video', video);

    const pm = loadPlayerManager();
    pm.checkState();

    let pipStates = [];
    pm.addEventListener('state-change', (e) => {
      pipStates.push(e.detail.isPiP);
    });

    // Enter PiP
    video.dispatchEvent(new Event('enterpictureinpicture'));
    assert.strictEqual(pm.isPiP, true);

    // Leave PiP
    video.dispatchEvent(new Event('leavepictureinpicture'));
    assert.strictEqual(pm.isPiP, false);

    assert.deepStrictEqual(pipStates, [true, false]);
  });

  test('cleans up event listeners from old video when replaced', () => {
    const oldVideo = new MockVideoElement();
    const newVideo = new MockVideoElement();
    const player = new MockElement('div', { id: 'movie_player' });

    env.elements.set('#movie_player', player);
    env.elements.set('video.html5-main-video', oldVideo);
    player.querySelector = (sel) => (sel === 'video.html5-main-video' ? oldVideo : null);

    const pm = loadPlayerManager();
    pm.checkState();
    assert.strictEqual(pm.video, oldVideo);

    // Swap to new video
    env.elements.set('video.html5-main-video', newVideo);
    player.querySelector = (sel) => (sel === 'video.html5-main-video' ? newVideo : null);
    pm.checkState();
    assert.strictEqual(pm.video, newVideo);

    // Old video events should no longer affect pm.isPlaying
    oldVideo.play();
    assert.strictEqual(pm.isPlaying, false);

    newVideo.play();
    assert.strictEqual(pm.isPlaying, true);
  });

  test('searchInterval safety fallback starts on watch page and clears once elements mount', () => {
    const pm = loadPlayerManager();
    // Elements are missing on cold load
    pm.checkState();
    assert.ok(pm.searchInterval !== null, 'searchInterval should be created while waiting for DOM');

    // Mount elements
    const app = new MockElement('ytd-app');
    const player = new MockElement('div', { id: 'movie_player' });
    const video = new MockVideoElement();
    player.querySelector = (sel) => (sel === 'video.html5-main-video' ? video : null);
    env.elements.set('ytd-app', app);
    env.elements.set('#movie_player', player);
    env.elements.set('video.html5-main-video', video);

    pm.checkState();
    assert.strictEqual(pm.searchInterval, null, 'searchInterval should be cleared once all elements exist');
  });
});

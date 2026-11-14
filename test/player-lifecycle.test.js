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

  test('accurately identifies ad-showing state and ignores static player containers', () => {
    const pm = loadPlayerManager();
    const player = new MockElement('div', { id: 'movie_player' });
    const video = new MockVideoElement();
    player.querySelector = (sel) => (sel === 'video.html5-main-video' ? video : null);

    env.elements.set('#movie_player', player);
    env.elements.set('video.html5-main-video', video);

    // Initial normal playback without ad classes
    pm.checkState();
    assert.strictEqual(pm.isAdShowing, false, 'Should be false when no ad classes are on movie_player');

    // Simulate ad starting
    player.classList.add('ad-showing');
    pm.checkState();
    assert.strictEqual(pm.isAdShowing, true, 'Should be true when ad-showing class is present');

    // Simulate ad ending
    player.classList.remove('ad-showing');
    pm.checkState();
    assert.strictEqual(pm.isAdShowing, false, 'Should revert to false once ad finishes');
  });

  test('detects theater mode on both ytd-watch-flexy and ytd-watch-grid', () => {
    const pm = loadPlayerManager();
    const watchGrid = new MockElement('ytd-watch-grid');
    env.elements.set('ytd-watch-grid', watchGrid);

    pm.checkState();
    assert.strictEqual(pm.isTheater, false);

    // Set theater attribute
    watchGrid.setAttribute('theater', '');
    pm.checkState();
    assert.strictEqual(pm.isTheater, true);
    assert.strictEqual(globalThis.document.documentElement.classList.contains('aura-in-theater'), true);
    assert.strictEqual(globalThis.document.documentElement.getAttribute('data-cineglow-theater'), 'true');

    // Remove theater attribute
    watchGrid.removeAttribute('theater');
    pm.checkState();
    assert.strictEqual(pm.isTheater, false);
    assert.strictEqual(globalThis.document.documentElement.classList.contains('aura-in-theater'), false);
    assert.strictEqual(globalThis.document.documentElement.hasAttribute('data-cineglow-theater'), false);
  });

  test('FP-3.1 to FP-3.4: theater detection excludes full-bleed, tooltips, columns heuristic, and guards input on t/T hotkey', () => {
    const pm = loadPlayerManager();
    const watchFlexy = new MockElement('ytd-watch-flexy');
    const player = new MockElement('div', { id: 'movie_player' });
    const sizeBtn = new MockElement('button', { class: 'ytp-size-button' });
    const columns = new MockElement('div', { id: 'columns' });

    env.elements.set('ytd-watch-flexy', watchFlexy);
    env.elements.set('#movie_player', player);

    // 1. FP-3.2: Full-bleed container or attribute does NOT trigger theater mode
    watchFlexy.setAttribute('full-bleed-player', '');
    watchFlexy.setAttribute('full-bleed', '');
    env.elements.set('#full-bleed-container #movie_player', player);
    pm.checkState();
    assert.strictEqual(pm.isTheater, false, 'full-bleed container/attribute must not trigger theater mode');
    watchFlexy.removeAttribute('full-bleed-player');
    watchFlexy.removeAttribute('full-bleed');
    env.elements.delete('#full-bleed-container #movie_player');

    // Genuine theater container DOES trigger theater mode
    env.elements.set('#player-theater-container #movie_player, [id*="theater-container"] #movie_player', player);
    pm.checkState();
    assert.strictEqual(pm.isTheater, true, 'theater container must trigger theater mode');
    env.elements.delete('#player-theater-container #movie_player, [id*="theater-container"] #movie_player');
    pm.checkState();
    assert.strictEqual(pm.isTheater, false);

    // 2. FP-3.3: Size button tooltip indicating default view/exit theater does NOT trigger theater mode
    sizeBtn.setAttribute('title', 'Default view (t)');
    env.elements.set('.ytp-size-button', sizeBtn);
    pm.checkState();
    assert.strictEqual(pm.isTheater, false, 'tooltip heuristic must not trigger theater mode');
    env.elements.delete('.ytp-size-button');

    // 3. FP-3.1: Structural column exclusion check (player outside #columns) does NOT trigger theater mode
    columns.contains = (el) => el !== player;
    env.elements.set('#columns', columns);
    pm.checkState();
    assert.strictEqual(pm.isTheater, false, 'player outside columns during SPA render must not trigger theater mode');

    // 4. FP-3.4: 't'/'T' keydown listener ignores keydown events when focus is on input/textarea/editable/searchbox
    let checkStateCalls = 0;
    const origCheckState = pm.checkState.bind(pm);
    pm.checkState = () => {
      checkStateCalls++;
      return origCheckState();
    };

    // Focused on input: should return early without scheduling checkState timers
    const inputEl = new MockElement('input');
    const inputEvent = new Event('keydown');
    inputEvent.key = 't';
    Object.defineProperty(inputEvent, 'target', { value: inputEl });
    globalThis.document.dispatchEvent(inputEvent);
    assert.strictEqual(checkStateCalls, 0, 't keydown on input must not trigger checkState timers');

    // Focused inside comment box: should return early
    const commentBox = new MockElement('ytd-commentbox');
    const innerCommentEl = new MockElement('div');
    commentBox.appendChild(innerCommentEl);
    const commentEvent = new Event('keydown');
    commentEvent.key = 'T';
    Object.defineProperty(commentEvent, 'target', { value: innerCommentEl });
    globalThis.document.dispatchEvent(commentEvent);
    assert.strictEqual(checkStateCalls, 0, 'T keydown inside ytd-commentbox must not trigger checkState timers');
  });
});

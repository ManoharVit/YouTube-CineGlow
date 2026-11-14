// test/speed-persistence.test.js
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setupMockEnvironment, MockVideoElement, MockElement } = require('./helpers/mock-dom');

describe('Speed Button & Playback Speed Persistence Across Navigation', () => {
  let env;
  let originalWindow;
  let originalDocument;
  let originalChrome;
  let video;
  let player;

  beforeEach(() => {
    env = setupMockEnvironment('https://www.youtube.com/watch?v=vid123');
    originalWindow = globalThis.window;
    originalDocument = globalThis.document;
    originalChrome = globalThis.chrome;

    globalThis.window = env.window;
    globalThis.document = env.document;
    globalThis.chrome = env.chrome;
    globalThis.window.chrome = env.chrome;

    video = new MockVideoElement();
    video.playbackRate = 1.0;
    video.defaultPlaybackRate = 1.0;

    player = new MockElement('div', { id: 'movie_player' });
    player.appendChild(video);
    player.setPlaybackRate = (rate) => {
      video.playbackRate = rate;
    };

    env.elements.set('#movie_player', player);
    env.elements.set('video.html5-main-video', video);
    env.elements.set('video', video);

    globalThis.window.CineGlowPlayer = new (class extends EventTarget {
      constructor() {
        super();
        this.isWatchPage = true;
        this.videoId = 'vid123';
        this.video = video;
        this.player = player;
      }
    })();

    const defaultsCode = fs.readFileSync(path.join(__dirname, '../shared/defaults.js'), 'utf8');
    const fnDef = new Function(`'use strict'; ${defaultsCode}; return AURA_DEFAULTS;`);
    globalThis.AURA_DEFAULTS = fnDef();
    globalThis.window.AURA_DEFAULTS = globalThis.AURA_DEFAULTS;
  });

  afterEach(() => {
    if (globalThis.window?.CineGlowSpeedTeardown) {
      globalThis.window.CineGlowSpeedTeardown();
    }
    delete globalThis.AURA_DEFAULTS;
    delete globalThis.window.CineGlowSpeed;
    delete globalThis.window.CineGlowSpeedTeardown;
    delete globalThis.window.CineGlowPlayer;
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
    globalThis.chrome = originalChrome;
  });

  function loadSpeedButton() {
    const code = fs.readFileSync(path.join(__dirname, '../content/speed-button.js'), 'utf8');
    const fn = new Function(code);
    fn();
  }

  test('setting speed to 5.0x updates video.playbackRate, preferredSpeed, and saves to storage', async () => {
    loadSpeedButton();
    await new Promise(r => setTimeout(r, 10));

    const speedApi = globalThis.window.CineGlowSpeed;
    assert.ok(speedApi, 'CineGlowSpeed must be exposed');

    speedApi.setPlaybackSpeed(5.0);
    assert.strictEqual(video.playbackRate, 5.0, 'video.playbackRate must be 5.0');
    assert.strictEqual(speedApi.currentSpeed, 5.0, 'currentSpeed must be 5.0');
    assert.strictEqual(speedApi.preferredSpeed, 5.0, 'preferredSpeed must be 5.0');

    // Verify storage persistence
    const stored = await env.chrome.storage.sync.get('preferredSpeed');
    assert.strictEqual(stored.preferredSpeed, 5.0, 'preferredSpeed must be persisted in chrome.storage.sync');
  });

  test('persists 5.0x speed when navigating to a new video and YouTube resets playbackRate to 1.0', async () => {
    loadSpeedButton();
    await new Promise(r => setTimeout(r, 10));

    const speedApi = globalThis.window.CineGlowSpeed;
    speedApi.setPlaybackSpeed(5.0);
    assert.strictEqual(video.playbackRate, 5.0);

    // Simulate YouTube navigating to a new video in SPA
    globalThis.window.CineGlowPlayer.videoId = 'vid456';
    globalThis.window.CineGlowPlayer.dispatchEvent(
      new CustomEvent('state-change', { detail: globalThis.window.CineGlowPlayer })
    );

    // YouTube internal player resets video.playbackRate = 1.0 on media mount
    video.playbackRate = 1.0;
    video.dispatchEvent(new Event('ratechange'));

    // CineGlow must prevent 1.0 from clobbering preferredSpeed and restore 5.0x
    assert.strictEqual(speedApi.preferredSpeed, 5.0, 'preferredSpeed must remain 5.0 and NOT be clobbered by 1.0 reset');
    
    // Simulate loadedmetadata and canplay events from the new video
    video.dispatchEvent(new Event('loadedmetadata'));
    video.dispatchEvent(new Event('canplay'));
    video.dispatchEvent(new Event('playing'));

    assert.strictEqual(video.playbackRate, 5.0, 'video.playbackRate must be restored to 5.0 on the new video');
  });

  test('re-applies 5.0x on yt-navigate-finish event without resetting to 1.0', async () => {
    loadSpeedButton();
    await new Promise(r => setTimeout(r, 10));

    const speedApi = globalThis.window.CineGlowSpeed;
    speedApi.setPlaybackSpeed(5.0);

    // YouTube fires ratechange 1.0 followed by yt-navigate-finish
    video.playbackRate = 1.0;
    video.dispatchEvent(new Event('ratechange'));
    env.document.dispatchEvent(new Event('yt-navigate-finish'));

    assert.strictEqual(speedApi.preferredSpeed, 5.0, 'preferredSpeed must remain 5.0');
    assert.strictEqual(video.playbackRate, 5.0, 'video.playbackRate must remain 5.0');
  });

  test('ad acceleration to 16.0x does not clobber 5.0x preferred speed', async () => {
    loadSpeedButton();
    await new Promise(r => setTimeout(r, 10));

    const speedApi = globalThis.window.CineGlowSpeed;
    speedApi.setPlaybackSpeed(5.0);

    // Ad blocker speeds up video to 16x
    video.playbackRate = 16.0;
    video.dispatchEvent(new Event('ratechange'));

    assert.strictEqual(speedApi.preferredSpeed, 5.0, 'preferredSpeed must ignore 16x ad fast-forward');
    assert.strictEqual(speedApi.currentSpeed, 5.0, 'currentSpeed must remain 5.0');
  });

  test('explicit reset to 1.0x updates preferredSpeed and persists to storage', async () => {
    loadSpeedButton();
    await new Promise(r => setTimeout(r, 10));

    const speedApi = globalThis.window.CineGlowSpeed;
    speedApi.setPlaybackSpeed(5.0);
    assert.strictEqual(speedApi.preferredSpeed, 5.0);

    // User explicitly resets speed to 1.0
    speedApi.setPlaybackSpeed(1.0);
    assert.strictEqual(speedApi.preferredSpeed, 1.0, 'preferredSpeed must be 1.0 after explicit reset');
    assert.strictEqual(speedApi.currentSpeed, 1.0, 'currentSpeed must be 1.0');
    assert.strictEqual(video.playbackRate, 1.0, 'video.playbackRate must be 1.0');

    const stored = await env.chrome.storage.sync.get('preferredSpeed');
    assert.strictEqual(stored.preferredSpeed, 1.0, 'preferredSpeed 1.0 must be saved to storage');
  });

  test('emergency kill-switch cleans up listeners and disarms speed enforcement', async () => {
    loadSpeedButton();
    await new Promise(r => setTimeout(r, 10));

    const speedApi = globalThis.window.CineGlowSpeed;
    speedApi.setPlaybackSpeed(5.0);

    // Trigger kill-switch
    speedApi.teardownKillSwitch();

    // Verify rate changes after kill switch do not trigger enforcement
    video.playbackRate = 1.0;
    video.dispatchEvent(new Event('ratechange'));
    assert.strictEqual(video.playbackRate, 1.0, 'video.playbackRate must remain untouched after teardown');
  });

  test('new video element mounted on navigation inherits 5.0x speed via document capture', async () => {
    loadSpeedButton();
    await new Promise(r => setTimeout(r, 10));

    const speedApi = globalThis.window.CineGlowSpeed;
    speedApi.setPlaybackSpeed(5.0);

    // Simulate YouTube replacing the <video> element with a new element for the new video
    const newVideo = new MockVideoElement();
    newVideo.playbackRate = 1.0;
    newVideo.defaultPlaybackRate = 1.0;
    player.innerHTML = '';
    player.appendChild(newVideo);
    env.elements.set('video.html5-main-video', newVideo);
    env.elements.set('video', newVideo);

    // Document capture handles loadedmetadata on the new element
    newVideo.dispatchEvent(new Event('loadedmetadata'));
    newVideo.dispatchEvent(new Event('playing'));

    assert.strictEqual(newVideo.playbackRate, 5.0, 'new video element must be set to 5.0x');
    assert.strictEqual(newVideo.defaultPlaybackRate, 5.0, 'new video defaultPlaybackRate must be 5.0x');
  });

  test('context invalidation during teardown or event handling never throws unhandled exception', async () => {
    loadSpeedButton();
    await new Promise(r => setTimeout(r, 10));

    const speedApi = globalThis.window.CineGlowSpeed;
    speedApi.setPlaybackSpeed(5.0);

    // Invalidate context (simulate chrome://extensions reload)
    delete globalThis.chrome.runtime.id;
    globalThis.chrome.runtime.getManifest = () => {
      throw new Error('Extension context invalidated.');
    };
    globalThis.chrome.storage.sync.get = () => {
      throw new Error('Extension context invalidated.');
    };
    globalThis.chrome.storage.sync.set = () => {
      throw new Error('Extension context invalidated.');
    };

    // Trigger navigation / media events in invalidated context
    assert.doesNotThrow(() => {
      video.dispatchEvent(new Event('ratechange'));
      env.document.dispatchEvent(new Event('yt-navigate-finish'));
      globalThis.window.CineGlowPlayer.dispatchEvent(
        new CustomEvent('state-change', { detail: globalThis.window.CineGlowPlayer })
      );
      speedApi.teardownKillSwitch();
    }, 'Must not throw Extension context invalidated');
  });

  test('accepts user speed change from YouTube native settings menu without forcing old rate', async () => {
    loadSpeedButton();
    await new Promise(r => setTimeout(r, 10));

    const speedApi = globalThis.window.CineGlowSpeed;
    speedApi.setPlaybackSpeed(1.0);

    // User chooses 1.5x in YouTube native settings menu (fires ratechange on video)
    video.playbackRate = 1.5;
    video.dispatchEvent(new Event('ratechange'));

    assert.strictEqual(speedApi.currentSpeed, 1.5, 'currentSpeed must synchronize to native 1.5x');
    assert.strictEqual(speedApi.preferredSpeed, 1.5, 'preferredSpeed must accept native 1.5x');
    assert.strictEqual(video.playbackRate, 1.5, 'video.playbackRate must remain 1.5x');
  });

  test('YouTube native Hold to 2x gesture does not get clobbered by speed controller', async () => {
    loadSpeedButton();
    await new Promise(r => setTimeout(r, 10));

    const speedApi = globalThis.window.CineGlowSpeed;
    speedApi.setPlaybackSpeed(1.25);

    // User presses and holds pointer on video for Hold to 2x
    globalThis.window.dispatchEvent(new Event('pointerdown'));
    video.playbackRate = 2.0;
    video.dispatchEvent(new Event('ratechange'));

    // Should NOT override to 1.25 during pointerdown
    assert.strictEqual(video.playbackRate, 2.0, 'video.playbackRate must remain 2.0 during Hold to 2x');
    assert.strictEqual(speedApi.preferredSpeed, 1.25, 'preferredSpeed must preserve underlying 1.25x');

    // User releases pointer
    globalThis.window.dispatchEvent(new Event('pointerup'));
  });

  test('disarms playbackRate storm during initial chunk buffer loading (readyState < 2)', async () => {
    loadSpeedButton();
    await new Promise(r => setTimeout(r, 10));

    const speedApi = globalThis.window.CineGlowSpeed;
    speedApi.setPlaybackSpeed(3.0);
    await new Promise(r => setTimeout(r, 90));

    // Simulate new video loading at 0:00 with readyState = 1 (HAVE_METADATA)
    const bufferingVideo = new MockVideoElement();
    bufferingVideo.readyState = 1;
    bufferingVideo.playbackRate = 1.0;
    bufferingVideo.defaultPlaybackRate = 1.0;
    player.innerHTML = '';
    player.appendChild(bufferingVideo);
    env.elements.set('video.html5-main-video', bufferingVideo);
    env.elements.set('video', bufferingVideo);

    // YouTube resets playbackRate to 1.0 at 0:00 while loading
    bufferingVideo.dispatchEvent(new Event('ratechange'));

    // Should set defaultPlaybackRate without immediately clobbering playbackRate to prevent MSE buffer stalls
    assert.strictEqual(bufferingVideo.defaultPlaybackRate, 3.0, 'defaultPlaybackRate should be updated to 3.0');
    assert.strictEqual(bufferingVideo.playbackRate, 1.0, 'playbackRate must not storm during readyState < 2');

    // When buffer arrives (readyState >= 2) and canplay fires:
    bufferingVideo.readyState = 4;
    bufferingVideo.dispatchEvent(new Event('canplay'));

    assert.strictEqual(bufferingVideo.playbackRate, 3.0, 'playbackRate is safely applied once readyState >= 2');
  });

  test('accepts user speed change to 1.0x during active video playback without forcing old rate', async () => {
    loadSpeedButton();
    await new Promise(r => setTimeout(r, 10));

    const speedApi = globalThis.window.CineGlowSpeed;
    speedApi.setPlaybackSpeed(2.0);
    assert.strictEqual(speedApi.preferredSpeed, 2.0);
    await new Promise(r => setTimeout(r, 90));

    // Simulate active playback: video has played 15s and last navigation was 10s ago
    video.currentTime = 15.0;
    speedApi.lastNavigatedTime = Date.now() - 10000;

    // User chooses 1.0x in YouTube native menu or controls during active playback
    video.playbackRate = 1.0;
    video.dispatchEvent(new Event('ratechange'));

    assert.strictEqual(speedApi.currentSpeed, 1.0, 'currentSpeed must synchronize to 1.0x during active playback');
    assert.strictEqual(speedApi.preferredSpeed, 1.0, 'preferredSpeed must accept 1.0x during active playback');
    assert.strictEqual(video.playbackRate, 1.0, 'video.playbackRate must remain 1.0x');

    const stored = await env.chrome.storage.sync.get('preferredSpeed');
    assert.strictEqual(stored.preferredSpeed, 1.0, 'preferredSpeed 1.0 must be persisted to storage');
  });

  test('clicking speed button toggles multi-scale menu and stops event propagation to player', async () => {
    loadSpeedButton();
    await new Promise(r => setTimeout(r, 25));

    const btn = player.querySelector('.cineglow-speed-button');
    assert.ok(btn, 'Speed button must be mounted inside player toolbar');

    // Track player pointerdown / mousedown events to verify isolation
    let playerPointerDownFired = false;
    let playerMouseDownFired = false;
    player.addEventListener('pointerdown', () => { playerPointerDownFired = true; });
    player.addEventListener('mousedown', () => { playerMouseDownFired = true; });

    // Pointer down and mouse down on button must be stopped
    btn.dispatchEvent(new Event('pointerdown'));
    btn.dispatchEvent(new Event('mousedown'));
    assert.strictEqual(playerPointerDownFired, false, 'pointerdown on speed button must not bubble to player');
    assert.strictEqual(playerMouseDownFired, false, 'mousedown on speed button must not bubble to player');

    // First click: opens menu
    btn.dispatchEvent(new Event('click'));
    const menu = player.querySelector('.cineglow-speed-menu');
    assert.ok(menu, 'Speed menu must open on click');

    // Pointer down on menu must not bubble to player
    menu.dispatchEvent(new Event('pointerdown'));
    assert.strictEqual(playerPointerDownFired, false, 'pointerdown on menu must not bubble to player');

    // Second click on button: closes menu
    btn.dispatchEvent(new Event('click'));
    const closedMenu = player.querySelector('.cineglow-speed-menu');
    assert.strictEqual(closedMenu, null, 'Speed menu must close on second click (toggle)');
  });

  test('speed menu stays open on internal clicks and closes on outside click', async () => {
    loadSpeedButton();
    await new Promise(r => setTimeout(r, 25));

    const btn = player.querySelector('.cineglow-speed-button');
    btn.dispatchEvent(new Event('click'));

    let menu = player.querySelector('.cineglow-speed-menu');
    assert.ok(menu, 'Speed menu must open on click');

    // Wait for outside-click listener to attach
    await new Promise(r => setTimeout(r, 10));

    // Clicking inside menu must NOT close it
    const pill = menu.querySelector('.cineglow-preset-pill');
    if (pill) {
      pill.dispatchEvent(new Event('click'));
    }
    menu = player.querySelector('.cineglow-speed-menu');
    assert.ok(menu, 'Speed menu must remain open when clicking internal elements');

    // Clicking outside on document must close it
    const outsideEl = new MockElement('div');
    player.appendChild(outsideEl);
    const outsideClickEvent = new Event('click');
    outsideEl.dispatchEvent(outsideClickEvent);

    menu = player.querySelector('.cineglow-speed-menu');
    assert.strictEqual(menu, null, 'Speed menu must close on outside click');
  });

  test('double clicking speed button immediately resets playback speed to 1.0x without closing menu', async () => {
    loadSpeedButton();
    await new Promise(r => setTimeout(r, 25));

    const speedApi = globalThis.window.CineGlowSpeed;
    speedApi.setPlaybackSpeed(2.5);
    assert.strictEqual(speedApi.preferredSpeed, 2.5);
    await new Promise(r => setTimeout(r, 90));

    const btn = player.querySelector('.cineglow-speed-button');
    assert.ok(btn, 'Speed button must be mounted');

    // Open menu first
    btn.dispatchEvent(new Event('click'));
    let menu = player.querySelector('.cineglow-speed-menu');
    assert.ok(menu, 'Speed menu must open on click');

    // Double click button
    btn.dispatchEvent(new Event('dblclick'));

    assert.strictEqual(speedApi.currentSpeed, 1.0, 'currentSpeed must be 1.0 after double click');
    assert.strictEqual(speedApi.preferredSpeed, 1.0, 'preferredSpeed must be 1.0 after double click');
    assert.strictEqual(video.playbackRate, 1.0, 'video.playbackRate must be 1.0 after double click');

    // Menu should still be open
    menu = player.querySelector('.cineglow-speed-menu');
    assert.ok(menu, 'Speed menu must stay open after double click reset');

    const stored = await env.chrome.storage.sync.get('preferredSpeed');
    assert.strictEqual(stored.preferredSpeed, 1.0, 'preferredSpeed 1.0 must be persisted to storage');
  });

  test('dragging slider updates playback speed and labels without resetting active slider value', async () => {
    loadSpeedButton();
    await new Promise(r => setTimeout(r, 25));

    const speedApi = globalThis.window.CineGlowSpeed;
    const btn = player.querySelector('.cineglow-speed-button');
    btn.dispatchEvent(new Event('click'));

    const menu = player.querySelector('.cineglow-speed-menu');
    assert.ok(menu, 'Speed menu must be open');

    const s1 = menu.querySelector('.cineglow-scale1-slider');
    assert.ok(s1, 'Scale 1 slider must exist');

    // Simulate user dragging slider to 1.75
    s1.value = 1.75;
    s1.dispatchEvent(new Event('input'));

    assert.strictEqual(video.playbackRate, 1.75, 'video.playbackRate must update to 1.75');
    assert.strictEqual(speedApi.preferredSpeed, 1.75, 'preferredSpeed must update to 1.75');
    assert.strictEqual(s1.value, 1.75, 'active slider value must not be forcibly overwritten');

    const valDisplay = menu.querySelector('.cineglow-speed-current-val');
    assert.strictEqual(valDisplay.textContent, '1.75×', 'Current speed readout must display 1.75×');
  });

  test('post-ad reset guard preserves preferred speed when mid-roll ad concludes at 1.0x', async () => {
    loadSpeedButton();
    await new Promise(r => setTimeout(r, 15));

    const speedApi = globalThis.window.CineGlowSpeed;
    speedApi.setPlaybackSpeed(2.5);
    assert.strictEqual(speedApi.preferredSpeed, 2.5);
    await new Promise(r => setTimeout(r, 90));

    // Simulate mid-roll playback (30s in, navigated 25s ago)
    video.currentTime = 30.0;
    speedApi.lastNavigatedTime = Date.now() - 25000;

    // Mid-roll ad plays (accelerated or active)
    video.playbackRate = 16.0;
    video.dispatchEvent(new Event('ratechange'));
    assert.strictEqual(speedApi.preferredSpeed, 2.5);

    // Mid-roll ad concludes and native player resets rate to 1.0 within 1500ms of ad
    video.playbackRate = 1.0;
    video.dispatchEvent(new Event('ratechange'));

    // Post-ad reset guard must NOT treat this as manual user reset to 1.0x
    assert.strictEqual(speedApi.preferredSpeed, 2.5, 'preferredSpeed must remain 2.5 after mid-roll ad conclusion');
    assert.strictEqual(video.playbackRate, 2.5, 'playbackRate must be re-applied to 2.5x');
  });
});

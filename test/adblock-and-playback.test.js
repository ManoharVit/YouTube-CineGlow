// test/adblock-and-playback.test.js
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setupMockEnvironment, MockVideoElement, MockElement } = require('./helpers/mock-dom');

describe('AdBlock Rules & Video Playback Integrity', () => {
  let env;
  let originalWindow;
  let originalDocument;
  let originalChrome;

  beforeEach(() => {
    env = setupMockEnvironment('https://www.youtube.com/watch?v=videoTest123');
    originalWindow = globalThis.window;
    originalDocument = globalThis.document;
    originalChrome = globalThis.chrome;

    globalThis.window = env.window;
    globalThis.document = env.document;
    globalThis.location = env.window.location;
    globalThis.chrome = env.chrome;
  });

  afterEach(() => {
    if (globalThis.window?.CineGlowAdBlock?.cleanup) {
      globalThis.window.CineGlowAdBlock.cleanup();
    }
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
    globalThis.chrome = originalChrome;
  });

  test('rules/adblock.json conforms to DNR schema and never blocks YouTube canary pings', () => {
    const raw = fs.readFileSync(path.join(__dirname, '../rules/adblock.json'), 'utf8');
    const rules = JSON.parse(raw);

    assert.ok(Array.isArray(rules), 'Rules must be an array');
    assert.ok(rules.length > 0, 'Rules must not be empty');

    const blockedUrls = rules.map(r => r.condition?.urlFilter || '');
    assert.strictEqual(
      blockedUrls.some(u => u.includes('youtube.com/api/stats/ads')),
      false,
      'rules/adblock.json must NOT block youtube.com/api/stats/ads as this triggers YouTube anti-adblock lockdown'
    );

    // Ensure all third-party ad network rules exclude youtube.com as initiator domain
    for (const rule of rules) {
      assert.strictEqual(rule.action.type, 'block');
      assert.ok(rule.condition.resourceTypes && rule.condition.resourceTypes.length > 0);
      assert.ok(
        Array.isArray(rule.condition.excludedInitiatorDomains) &&
        rule.condition.excludedInitiatorDomains.includes('youtube.com'),
        `Rule ${rule.id} (${rule.condition.urlFilter}) must exclude youtube.com from initiatorDomains to prevent ERR_BLOCKED_BY_CLIENT`
      );
    }
  });

  test('normal video is not treated as an ad and playback is never interrupted or jumped', async () => {
    const player = new MockElement('div', { id: 'movie_player' });
    const video = new MockVideoElement();
    video.currentTime = 12.5;
    video.duration = 600.0;
    video.playbackRate = 1.0;
    video.muted = false;

    // Simulate standard YouTube DOM structure where static containers exist
    const adModule = new MockElement('div', { className: 'video-ads ytp-ad-module' });
    const emptySlot = new MockElement('div', { className: 'ytp-ad-skip-button-slot' });
    adModule.appendChild(emptySlot);
    player.appendChild(adModule);
    player.appendChild(video);

    env.elements.set('#movie_player', player);
    env.elements.set('video.html5-main-video', video);
    env.elements.set('video', video);

    // Load youtube-ads.js
    const code = fs.readFileSync(path.join(__dirname, '../content/youtube-ads.js'), 'utf8');
    const fn = new Function(code);
    fn();
    await new Promise(r => setTimeout(r, 10));

    const adBlock = globalThis.window.CineGlowAdBlock;
    assert.ok(adBlock, 'CineGlowAdBlock should be exposed');

    // Check ad active state
    assert.strictEqual(adBlock.isAdActive(), false, 'Static placeholders must not be flagged as active ads');

    // Run skip check
    adBlock.skipVideoAds();

    // Verify video was untouched
    assert.strictEqual(video.currentTime, 12.5, 'Normal video currentTime must not be changed');
    assert.strictEqual(video.playbackRate, 1.0, 'Normal video playbackRate must remain 1.0');
    assert.strictEqual(video.muted, false, 'Normal video must not be muted');
  });

  test('fast-forwards and mutes confirmed ads and restores normal playback when ad ends', async () => {
    const player = new MockElement('div', { id: 'movie_player' });
    const video = new MockVideoElement();
    video.currentTime = 2.0;
    video.duration = 15.0;
    video.playbackRate = 1.25; // User had custom speed
    video.muted = false;

    player.appendChild(video);
    env.elements.set('#movie_player', player);
    env.elements.set('video.html5-main-video', video);
    env.elements.set('video', video);

    const code = fs.readFileSync(path.join(__dirname, '../content/youtube-ads.js'), 'utf8');
    const fn = new Function(code);
    fn();
    await new Promise(r => setTimeout(r, 10));

    const adBlock = globalThis.window.CineGlowAdBlock;

    // Simulate in-stream ad starting
    player.classList.add('ad-showing');
    assert.strictEqual(adBlock.isAdActive(), true);

    adBlock.skipVideoAds();

    // Ad should be muted, sped up to 16.0, and fast-forwarded to duration
    assert.strictEqual(video.muted, true, 'Ad must be muted');
    assert.strictEqual(video.playbackRate, 16.0, 'Ad must be accelerated to 16x');
    assert.strictEqual(video.currentTime, 15.0, 'Ad must be skipped to duration');

    // Simulate ad finishing
    player.classList.remove('ad-showing');
    assert.strictEqual(adBlock.isAdActive(), false);

    // Check state update after ad
    adBlock.checkAdState();

    // Sound and original speed should be restored
    assert.strictEqual(video.muted, false, 'Audio must be unmuted after ad');
    assert.strictEqual(video.playbackRate, 1.25, 'Original playback speed must be restored');
  });

  test('clicks visible skip buttons when ad skip button becomes available', async () => {
    const player = new MockElement('div', { id: 'movie_player' });
    player.classList.add('ad-showing');
    const video = new MockVideoElement();
    video.duration = 30.0;
    player.appendChild(video);

    const skipBtn = new MockElement('button', { className: 'ytp-ad-skip-button-modern' });
    let clicked = false;
    skipBtn.click = () => { clicked = true; };
    skipBtn.offsetParent = player; // Mock visibility

    env.elements.set('#movie_player', player);
    env.elements.set('video.html5-main-video', video);
    env.elements.set('video', video);
    env.elements.set('.ytp-ad-skip-button-modern', skipBtn);

    const code = fs.readFileSync(path.join(__dirname, '../content/youtube-ads.js'), 'utf8');
    const fn = new Function(code);
    fn();
    await new Promise(r => setTimeout(r, 10));

    const adBlock = globalThis.window.CineGlowAdBlock;
    adBlock.skipVideoAds();

    assert.strictEqual(clicked, true, 'Visible skip button must be clicked');
  });

  test('dismissEnforcementModal removes anti-adblock modal and calls playVideo', async () => {
    let playVideoCalled = false;
    let videoPlayCalled = false;

    const player = new MockElement('div', { id: 'movie_player' });
    player.playVideo = () => { playVideoCalled = true; };

    const video = new MockVideoElement();
    video.paused = true;
    video.play = async () => { videoPlayCalled = true; };

    const modal = new MockElement('ytd-enforcement-message-view-model');
    let removed = false;
    modal.remove = () => { removed = true; };

    env.elements.set('#movie_player', player);
    env.elements.set('video.html5-main-video', video);
    env.elements.set('video', video);
    env.elements.set('ytd-enforcement-message-view-model', modal);

    const code = fs.readFileSync(path.join(__dirname, '../content/youtube-ads.js'), 'utf8');
    const fn = new Function(code);
    fn();
    await new Promise(r => setTimeout(r, 10));

    const adBlock = globalThis.window.CineGlowAdBlock;
    adBlock.dismissEnforcementModal();

    assert.strictEqual(removed, true, 'Enforcement modal must be removed');
    assert.strictEqual(playVideoCalled, true, 'moviePlayer.playVideo must be called');
    assert.strictEqual(videoPlayCalled, true, 'video.play must be called');
  });
});

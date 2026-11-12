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

  test('rules/adblock.json conforms to DNR schema and blocks ad tracking endpoints aggressively', () => {
    const raw = fs.readFileSync(path.join(__dirname, '../rules/adblock.json'), 'utf8');
    const rules = JSON.parse(raw);

    assert.ok(Array.isArray(rules), 'Rules must be an array');
    assert.ok(rules.length > 0, 'Rules must not be empty');

    // Verify ad tracking endpoints ARE blocked (aggressive Brave-style blocking)
    const blockedUrls = rules.map(r => r.condition?.urlFilter || '');
    assert.strictEqual(
      blockedUrls.some(u => u.includes('doubleclick.net')),
      true,
      'rules/adblock.json must block doubleclick.net'
    );
    assert.strictEqual(
      blockedUrls.some(u => u.includes('googlesyndication.com')),
      true,
      'rules/adblock.json must block googlesyndication.com'
    );

    // Verify all rules have valid structure
    for (const rule of rules) {
      assert.strictEqual(rule.action.type, 'block');
      assert.ok(rule.condition.resourceTypes && rule.condition.resourceTypes.length > 0,
        `Rule ${rule.id} (${rule.condition.urlFilter}) must specify resourceTypes`);
      assert.ok(typeof rule.id === 'number', `Rule must have numeric id`);
      assert.ok(typeof rule.condition.urlFilter === 'string', `Rule ${rule.id} must have urlFilter string`);
    }
  });

  test('manifest.json adheres to Phase 1 permission lockdown and origin-level host scoping', () => {
    const rawManifest = fs.readFileSync(path.join(__dirname, '../manifest.json'), 'utf8');
    const manifest = JSON.parse(rawManifest);

    const perms = manifest.permissions || [];
    const hostPerms = manifest.host_permissions || [];

    // Verify forbidden high-risk permissions
    assert.strictEqual(perms.includes('<all_urls>'), false, '<all_urls> must not be declared in permissions');
    assert.strictEqual(perms.includes('tabs'), false, 'tabs permission must not be declared');
    assert.strictEqual(perms.includes('webRequest'), false, 'webRequest must not be declared');

    // Verify host permission isolation
    assert.strictEqual(hostPerms.includes('<all_urls>'), false, '<all_urls> must not be in host_permissions');
    assert.strictEqual(hostPerms.includes('https://storage.googleapis.com/*'), false, 'Global GCS wildcard must be replaced by virtual-hosted bucket');
    assert.ok(
      hostPerms.includes('https://biggest_bucket.storage.googleapis.com/*'),
      'Virtual-hosted bucket origin must be explicitly pinned'
    );
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

  test('preserves user muted state when video was muted before ad started (BUG-1 fix)', async () => {
    const player = new MockElement('div', { id: 'movie_player' });
    const video = new MockVideoElement();
    video.currentTime = 5.0;
    video.duration = 15.0;
    video.playbackRate = 1.0;
    video.muted = true; // User intentionally muted video

    player.appendChild(video);
    env.elements.set('#movie_player', player);
    env.elements.set('video.html5-main-video', video);
    env.elements.set('video', video);

    const code = fs.readFileSync(path.join(__dirname, '../content/youtube-ads.js'), 'utf8');
    const fn = new Function(code);
    fn();
    await new Promise(r => setTimeout(r, 10));

    const adBlock = globalThis.window.CineGlowAdBlock;

    // Simulate ad starting
    player.classList.add('ad-showing');
    adBlock.skipVideoAds();
    assert.strictEqual(video.muted, true, 'Video must remain muted during ad');

    // Simulate ad finishing
    player.classList.remove('ad-showing');
    adBlock.checkAdState();

    // Crucial check: Video must STILL be muted because user muted it initially!
    assert.strictEqual(video.muted, true, 'Initially muted video must not be forcibly unmuted after ad');
  });

  test('re-attaches listener and mutes new video element if replaced during ad (BUG-2 fix)', async () => {
    const player = new MockElement('div', { id: 'movie_player' });
    const video1 = new MockVideoElement();
    video1.muted = false;
    player.appendChild(video1);

    env.elements.set('#movie_player', player);
    env.elements.set('video.html5-main-video', video1);
    env.elements.set('video', video1);

    const code = fs.readFileSync(path.join(__dirname, '../content/youtube-ads.js'), 'utf8');
    const fn = new Function(code);
    fn();
    await new Promise(r => setTimeout(r, 10));

    const adBlock = globalThis.window.CineGlowAdBlock;

    // Ad starts on video1
    player.classList.add('ad-showing');
    adBlock.skipVideoAds();
    assert.strictEqual(video1.muted, true);

    // Swap to video2 mid-ad (YouTube player element recreation)
    const video2 = new MockVideoElement();
    video2.muted = false;
    env.elements.set('video.html5-main-video', video2);
    env.elements.set('video', video2);

    adBlock.checkAdState();
    assert.strictEqual(video2.muted, true, 'Replacement video element must be muted while ad is showing');
  });

  test('does not unmute a replacement video element when ad ends if replacement was not muted by controller', async () => {
    const player = new MockElement('div', { id: 'movie_player' });
    const video1 = new MockVideoElement();
    video1.muted = false; // video1 was originally unmuted
    player.appendChild(video1);

    env.elements.set('#movie_player', player);
    env.elements.set('video.html5-main-video', video1);
    env.elements.set('video', video1);

    const code = fs.readFileSync(path.join(__dirname, '../content/youtube-ads.js'), 'utf8');
    const fn = new Function(code);
    fn();
    await new Promise(r => setTimeout(r, 10));

    const adBlock = globalThis.window.CineGlowAdBlock;

    // Ad starts and controller mutes video1
    player.classList.add('ad-showing');
    adBlock.skipVideoAds();
    assert.strictEqual(video1.muted, true, 'video1 must be muted by adblock');

    // Video 2 replaces Video 1 right as ad finishes, and Video 2 is muted
    const video2 = new MockVideoElement();
    video2.muted = true; // New video was mounted in muted state
    env.elements.set('video.html5-main-video', video2);
    env.elements.set('video', video2);

    // Ad ends
    player.classList.remove('ad-showing');
    adBlock.checkAdState();

    // Verify video2 is NOT unmuted by stale video1 state
    assert.strictEqual(video2.muted, true, 'Replacement video element must not be unmuted by controller using stale element state');
  });

  test('disabling AdBlock mid-ad restores modified playback state (muted and 16x speed)', async () => {
    const player = new MockElement('div', { id: 'movie_player' });
    const video = new MockVideoElement();
    video.muted = false;
    video.playbackRate = 1.0;
    player.appendChild(video);

    env.elements.set('#movie_player', player);
    env.elements.set('video.html5-main-video', video);
    env.elements.set('video', video);

    const code = fs.readFileSync(path.join(__dirname, '../content/youtube-ads.js'), 'utf8');
    const fn = new Function(code);
    fn();
    await new Promise(r => setTimeout(r, 10));

    const adBlock = globalThis.window.CineGlowAdBlock;

    // Ad starts and fast-forwards/mutes playback
    player.classList.add('ad-showing');
    adBlock.skipVideoAds();
    assert.strictEqual(video.muted, true, 'Video must be muted during ad');
    assert.strictEqual(video.playbackRate, 16.0, 'Video playbackRate must be 16x during ad');

    // User disables AdBlock mid-ad via storage sync toggle
    for (const listener of env.chrome.storage.onChanged._listeners) {
      listener({ adblockEnabled: { newValue: false } }, 'sync');
    }

    assert.strictEqual(video.muted, false, 'Playback mute must be restored when adblock is disabled mid-ad');
    assert.strictEqual(video.playbackRate, 1.0, 'Playback rate must be restored from 16x back to 1.0 when adblock is disabled mid-ad');
  });

  test('disabling AdBlock mid-ad preserves user muted state if video was muted before ad started', async () => {
    const player = new MockElement('div', { id: 'movie_player' });
    const video = new MockVideoElement();
    video.muted = true; // User intentionally muted video prior to ad
    video.playbackRate = 1.25;
    player.appendChild(video);

    env.elements.set('#movie_player', player);
    env.elements.set('video.html5-main-video', video);
    env.elements.set('video', video);

    const code = fs.readFileSync(path.join(__dirname, '../content/youtube-ads.js'), 'utf8');
    const fn = new Function(code);
    fn();
    await new Promise(r => setTimeout(r, 10));

    const adBlock = globalThis.window.CineGlowAdBlock;

    // Ad starts
    player.classList.add('ad-showing');
    adBlock.skipVideoAds();
    assert.strictEqual(video.muted, true);
    assert.strictEqual(video.playbackRate, 16.0);

    // User disables AdBlock mid-ad
    for (const listener of env.chrome.storage.onChanged._listeners) {
      listener({ adblockEnabled: { newValue: false } }, 'sync');
    }

    assert.strictEqual(video.muted, true, 'User mute preference must be preserved when adblock is disabled mid-ad');
    assert.strictEqual(video.playbackRate, 1.25, 'Playback rate must be restored back to pre-ad rate (1.25)');
  });

  test('disabling AdBlock during normal video playback does not alter playback rate or mute state', async () => {
    const player = new MockElement('div', { id: 'movie_player' });
    const video = new MockVideoElement();
    video.muted = false;
    video.playbackRate = 1.75; // Custom user speed
    player.appendChild(video);

    env.elements.set('#movie_player', player);
    env.elements.set('video.html5-main-video', video);
    env.elements.set('video', video);

    const code = fs.readFileSync(path.join(__dirname, '../content/youtube-ads.js'), 'utf8');
    new Function(code)();
    await new Promise(r => setTimeout(r, 10));

    // User disables AdBlock while watching normal content
    for (const listener of env.chrome.storage.onChanged._listeners) {
      listener({ adblockEnabled: { newValue: false } }, 'sync');
    }

    assert.strictEqual(video.playbackRate, 1.75, 'Normal playback rate (1.75x) must not be overwritten');
    assert.strictEqual(video.muted, false, 'Unmuted normal video must not be changed');
  });

  test('AD_CSS and content.css contain companion, sidebar, engagement panel, and info card selectors', () => {
    const adsJs = fs.readFileSync(path.join(__dirname, '../content/youtube-ads.js'), 'utf8');
    const contentCss = fs.readFileSync(path.join(__dirname, '../content/content.css'), 'utf8');

    for (const sel of [
      'ytd-companion-slot-renderer',
      '#secondary #companion',
      '[target-id="engagement-panel-ads"]',
      'ytd-ad-slot-renderer',
      'ytd-action-companion-ad-renderer',
      '.ytp-cards-button',
      '.ytp-cards-button-icon',
      '.ytp-cards-teaser'
    ]) {
      assert.ok(adsJs.includes(sel), `youtube-ads.js must include ${sel} in cosmetic ad suppression rules`);
      assert.ok(contentCss.includes(sel), `content.css must include ${sel} in static stylesheet`);
    }
  });

  test('main-world.js prunes adPlacements and playerAds from payload like Brave/uBlock', () => {
    const mainWorldCode = fs.readFileSync(path.join(__dirname, '../content/main-world.js'), 'utf8');
    assert.ok(mainWorldCode.includes('adPlacements'), 'main-world.js must neutralize adPlacements');
    assert.ok(mainWorldCode.includes('playerAds'), 'main-world.js must neutralize playerAds');
    assert.ok(mainWorldCode.includes('adSlots'), 'main-world.js must neutralize adSlots');
  });

  test('main-world.js neutralizes ad_break and provides continuous unproxied skipAd execution', () => {
    const mainWorldCode = fs.readFileSync(path.join(__dirname, '../content/main-world.js'), 'utf8');
    assert.ok(mainWorldCode.includes('/youtubei/v1/player/ad_break'), 'main-world.js must intercept ad_break endpoint');
    assert.ok(mainWorldCode.includes('player.skipAd()'), 'main-world.js must invoke unproxied player.skipAd');
    assert.ok(mainWorldCode.includes('CINEGLOW_FORCE_SKIP_AD'), 'main-world.js must listen for force skip messages');
    assert.ok(mainWorldCode.includes('mainWorldAdInterval'), 'main-world.js must run active interval loop');
  });
});

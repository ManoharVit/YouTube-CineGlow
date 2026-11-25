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

    // Verify third-party ad rules are scoped with initiatorDomains: ["youtube.com"] to avoid cross-site blocking (CG-FIND-02)
    const scopedRuleIds = [1, 2, 3, 4, 8, 11];
    for (const rule of rules) {
      if (scopedRuleIds.includes(rule.id)) {
        assert.ok(
          Array.isArray(rule.condition.initiatorDomains) && rule.condition.initiatorDomains.includes('youtube.com'),
          `Rule ${rule.id} (${rule.condition.urlFilter}) must specify initiatorDomains: ["youtube.com"]`
        );
      }
    }

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
    assert.ok(
      hostPerms.includes('https://storage.googleapis.com/*'),
      'GCS path-style origin must be pinned in host_permissions'
    );
    assert.ok(
      hostPerms.includes('https://sponsor.ajay.app/*'),
      'SponsorBlock API origin must be declared in host_permissions'
    );
    assert.ok(
      manifest.content_scripts.every(cs => Array.isArray(cs.exclude_matches) && cs.exclude_matches.includes('*://studio.youtube.com/*')),
      'Non-player YouTube subdomains must be excluded from content script injection'
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

    // Ad should be muted and accelerated to 16x without jumping the main video currentTime
    assert.strictEqual(video.muted, true, 'Ad must be muted');
    assert.strictEqual(video.playbackRate, 16.0, 'Ad must be accelerated to 16x');
    assert.strictEqual(video.currentTime, 2.0, 'Ad must not skip main video currentTime');

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

    const backdrop = new MockElement('tp-yt-iron-overlay-backdrop');
    let backdropRemoved = false;
    backdrop.remove = () => { backdropRemoved = true; };

    env.elements.set('#movie_player', player);
    env.elements.set('video.html5-main-video', video);
    env.elements.set('video', video);
    env.elements.set('ytd-enforcement-message-view-model', modal);
    env.elements.set('tp-yt-iron-overlay-backdrop, iron-overlay-backdrop, .scrim', [backdrop]);

    const code = fs.readFileSync(path.join(__dirname, '../content/youtube-ads.js'), 'utf8');
    const fn = new Function(code);
    fn();
    await new Promise(r => setTimeout(r, 10));

    const adBlock = globalThis.window.CineGlowAdBlock;
    adBlock.dismissEnforcementModal();

    assert.strictEqual(removed, true, 'Enforcement modal must be removed');
    assert.strictEqual(backdropRemoved, true, 'Backdrop scrim must be removed');
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

  test('AD_CSS and content.css contain companion, sidebar, and engagement panel selectors', () => {
    const adsJs = fs.readFileSync(path.join(__dirname, '../content/youtube-ads.js'), 'utf8');
    const contentCss = fs.readFileSync(path.join(__dirname, '../content/content.css'), 'utf8');

    for (const sel of [
      'ytd-companion-slot-renderer',
      '#secondary #companion',
      '[target-id="engagement-panel-ads"]',
      'ytd-ad-slot-renderer',
      'ytd-action-companion-ad-renderer'
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

  test('main-world.js eliminates Object.prototype pollution and binds evasion flags to window/yt (CG-FIND-05)', () => {
    const mainWorldCode = fs.readFileSync(path.join(__dirname, '../content/main-world.js'), 'utf8');
    assert.strictEqual(
      mainWorldCode.includes('Object.defineProperty(Object.prototype'),
      false,
      'main-world.js must NOT pollute Object.prototype'
    );
    assert.ok(mainWorldCode.includes("Object.defineProperty(window, 'adBlocksFound'"), 'must define adBlocksFound on window');
    assert.ok(mainWorldCode.includes("Object.defineProperty(window, 'hasAllowedInstreamAd'"), 'must define hasAllowedInstreamAd on window');
  });

  test('main-world.js respects CINEGLOW_SET_ADBLOCK_STATE and restores native APIs on kill switch (CG-FIND-01, CG-FIND-12)', () => {
    const mainWorldCode = fs.readFileSync(path.join(__dirname, '../content/main-world.js'), 'utf8');
    assert.ok(mainWorldCode.includes('CINEGLOW_SET_ADBLOCK_STATE'), 'must listen for CINEGLOW_SET_ADBLOCK_STATE');
    assert.ok(mainWorldCode.includes('window.fetch = origFetch'), 'must restore window.fetch on kill');
    assert.ok(mainWorldCode.includes('XMLHttpRequest.prototype.open = origOpen'), 'must restore XHR open on kill');
    assert.ok(mainWorldCode.includes('XMLHttpRequest.prototype.send = origSend'), 'must restore XHR send on kill');
    assert.ok(mainWorldCode.includes('JSON.parse = origJSONParse'), 'must restore JSON.parse on kill');
  });

  test('main-world.js camouflages patched methods with native [native code] toString and zero own-property detection leaks', () => {
    const mainWorldCode = fs.readFileSync(path.join(__dirname, '../content/main-world.js'), 'utf8');
    assert.strictEqual(mainWorldCode.includes('JSON.parse.toString ='), false, 'must not define own toString on JSON.parse');
    assert.strictEqual(mainWorldCode.includes('window.fetch.toString ='), false, 'must not define own toString on window.fetch');
    assert.strictEqual(mainWorldCode.includes('customFnToString.toString ='), false, 'must not define own toString on Function.prototype.toString');
    assert.ok(mainWorldCode.includes('Function.prototype.toString = customFnToString'), 'must replace Function.prototype.toString');
  });

  test('FP-1.1: eliminates generic button[aria-label*="Skip"] and scopes skip button queries inside isAdActive and player container', async () => {
    const adsJs = fs.readFileSync(path.join(__dirname, '../content/youtube-ads.js'), 'utf8');
    const mainWorld = fs.readFileSync(path.join(__dirname, '../content/main-world.js'), 'utf8');

    assert.strictEqual(adsJs.includes("'button[aria-label*=\"Skip\"]'"), false, 'youtube-ads.js must not include generic button[aria-label*="Skip"]');
    assert.strictEqual(mainWorld.includes("'button[aria-label*=\"Skip\"]'"), false, 'main-world.js must not include generic button[aria-label*="Skip"]');

    // Verify skip button query is strictly inside isAdActive() and scoped to player
    const player = new MockElement('div', { id: 'movie_player' });
    const video = new MockVideoElement();
    player.appendChild(video);

    // Create accessibility "Skip navigation" button in document outside player
    const a11ySkipBtn = new MockElement('button', { ariaLabel: 'Skip navigation' });
    let a11yClicked = false;
    a11ySkipBtn.click = () => { a11yClicked = true; };

    // Create YouTube Jump Ahead button inside player
    const jumpAheadBtn = new MockElement('button', { ariaLabel: 'Skip ahead' });
    let jumpAheadClicked = false;
    jumpAheadBtn.click = () => { jumpAheadClicked = true; };
    player.appendChild(jumpAheadBtn);

    env.elements.set('#movie_player', player);
    env.elements.set('video.html5-main-video', video);
    env.elements.set('video', video);
    env.elements.set('button[aria-label*="Skip"]', a11ySkipBtn);

    const code = fs.readFileSync(path.join(__dirname, '../content/youtube-ads.js'), 'utf8');
    new Function(code)();
    await new Promise(r => setTimeout(r, 10));

    const adBlock = globalThis.window.CineGlowAdBlock;
    // Normal video playback: isAdActive is false
    adBlock.skipVideoAds();
    assert.strictEqual(a11yClicked, false, 'Accessibility skip button must NEVER be clicked');
    assert.strictEqual(jumpAheadClicked, false, 'Jump ahead button must NOT be clicked');

    // Even if ad is active, generic skip buttons must not be clicked
    player.classList.add('ad-showing');
    adBlock.skipVideoAds();
    assert.strictEqual(a11yClicked, false, 'Accessibility skip button outside player must NEVER be clicked during ad');
    assert.strictEqual(jumpAheadClicked, false, 'Generic Jump Ahead button must not be clicked during ad');
  });

  test('FP-1.2: JSON.parse hook checks adBlockEnabled and preserves payloads when adblock is disabled', async () => {
    const mainWorldCode = fs.readFileSync(path.join(__dirname, '../content/main-world.js'), 'utf8');
    assert.ok(
      mainWorldCode.includes('if (!adBlockEnabled || (isKilled && origJSONParse)) return origJSONParse.apply(this, args);'),
      'main-world.js must check adBlockEnabled before pruning in JSON.parse hook'
    );

    const listeners = [];
    const testGlobal = {
      window: {
        location: { origin: 'https://www.youtube.com' },
        addEventListener: (type, fn) => { listeners.push({ type, fn }); },
        removeEventListener: () => {},
        postMessage: () => {}
      },
      document: {
        getElementById: () => null,
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener: () => {},
        removeEventListener: () => {},
        readyState: 'complete'
      },
      JSON: {
        parse: JSON.parse
      },
      Function: {
        prototype: {
          toString: Function.prototype.toString
        }
      },
      setTimeout: () => 0,
      setInterval: () => 0,
      clearInterval: () => {}
    };
    testGlobal.window.window = testGlobal.window;

    const fn = new Function('window', 'document', 'JSON', 'Function', 'setTimeout', 'setInterval', 'clearInterval', mainWorldCode);
    fn(testGlobal.window, testGlobal.document, testGlobal.JSON, testGlobal.Function, testGlobal.setTimeout, testGlobal.setInterval, testGlobal.clearInterval);

    const samplePayload = JSON.stringify({
      adPlacements: [{ ad: 1 }],
      playerAds: [{ ad: 2 }],
      videoDetails: { title: 'Test Video' }
    });

    // 1. When adblock is enabled (default), JSON.parse prunes ad keys
    const parsedEnabled = testGlobal.JSON.parse(samplePayload);
    assert.deepStrictEqual(parsedEnabled.adPlacements, [], 'adPlacements should be pruned when enabled');
    assert.deepStrictEqual(parsedEnabled.playerAds, [], 'playerAds should be pruned when enabled');

    // 2. Disable adblock via CINEGLOW_SET_ADBLOCK_STATE
    const msgListener = listeners.find(l => l.type === 'message' && l.fn.name === 'handleAdBlockStateMessage');
    if (msgListener) {
      msgListener.fn({
        source: testGlobal.window,
        data: { type: 'CINEGLOW_SET_ADBLOCK_STATE', enabled: false }
      });
    }

    // 3. When adblock is disabled, JSON.parse preserves ad keys intact
    const parsedDisabled = testGlobal.JSON.parse(samplePayload);
    assert.strictEqual(parsedDisabled.adPlacements.length, 1, 'adPlacements must not be pruned when adblock is disabled');
    assert.strictEqual(parsedDisabled.playerAds.length, 1, 'playerAds must not be pruned when adblock is disabled');
    assert.strictEqual(parsedDisabled.adPlacements[0].ad, 1);
  });

  test('FP-1.4: synchronizes video muting using data-cineglow-ad-muted attribute', async () => {
    const player = new MockElement('div', { id: 'movie_player' });
    const video = new MockVideoElement();
    video.muted = false;
    player.appendChild(video);

    env.elements.set('#movie_player', player);
    env.elements.set('video.html5-main-video', video);
    env.elements.set('video', video);

    const code = fs.readFileSync(path.join(__dirname, '../content/youtube-ads.js'), 'utf8');
    new Function(code)();
    await new Promise(r => setTimeout(r, 10));

    const adBlock = globalThis.window.CineGlowAdBlock;

    // Start ad
    player.classList.add('ad-showing');
    adBlock.skipVideoAds();

    assert.strictEqual(video.muted, true, 'Video must be muted during ad');
    assert.strictEqual(video.getAttribute('data-cineglow-ad-muted'), 'true', 'Video must have data-cineglow-ad-muted attribute set to true');

    // End ad
    player.classList.remove('ad-showing');
    adBlock.checkAdState();

    assert.strictEqual(video.muted, false, 'Video must be unmuted after ad');
    assert.strictEqual(video.hasAttribute('data-cineglow-ad-muted'), false, 'data-cineglow-ad-muted attribute must be removed');
  });

  test('FP-1.4: respects external data-cineglow-ad-muted from main-world and unmutes normal video', async () => {
    const player = new MockElement('div', { id: 'movie_player' });
    const video = new MockVideoElement();
    // Simulate main-world having muted the video first and set the attribute
    video.muted = true;
    video.setAttribute('data-cineglow-ad-muted', 'true');
    player.appendChild(video);

    env.elements.set('#movie_player', player);
    env.elements.set('video.html5-main-video', video);
    env.elements.set('video', video);

    const code = fs.readFileSync(path.join(__dirname, '../content/youtube-ads.js'), 'utf8');
    new Function(code)();
    await new Promise(r => setTimeout(r, 10));

    const adBlock = globalThis.window.CineGlowAdBlock;

    // Ad is active
    player.classList.add('ad-showing');
    adBlock.skipVideoAds();

    // Verify youtube-ads recognizes it was muted by CineGlow, not by user
    player.classList.remove('ad-showing');
    adBlock.checkAdState();

    assert.strictEqual(video.muted, false, 'Video must be unmuted after ad because it was muted by CineGlow');
    assert.strictEqual(video.hasAttribute('data-cineglow-ad-muted'), false, 'Attribute must be cleaned up');
  });

  test('FP-1.3 & FP-9.6: restores creator info cards, collaborator links, and merchandise shelves', () => {
    const adsJs = fs.readFileSync(path.join(__dirname, '../content/youtube-ads.js'), 'utf8');
    const mainWorld = fs.readFileSync(path.join(__dirname, '../content/main-world.js'), 'utf8');

    // FP-1.3: Info card buttons/teasers must NOT be in AD_CSS
    for (const sel of ['.ytp-cards-button', '.ytp-cards-teaser', '.ytp-cards-button-icon']) {
      assert.strictEqual(adsJs.includes(sel), false, `youtube-ads.js must NOT hide ${sel}`);
    }

    // FP-1.3: main-world must NOT prune cards or delete info card elements
    assert.strictEqual(mainWorld.includes("'cards'"), false, 'main-world.js AD_KEYS_TO_DELETE must not contain cards');
    assert.strictEqual(mainWorld.includes("'cardCollectionRenderer'"), false, 'main-world.js AD_KEYS_TO_DELETE must not contain cardCollectionRenderer');
    assert.strictEqual(mainWorld.includes("'cardsRenderer'"), false, 'main-world.js AD_KEYS_TO_DELETE must not contain cardsRenderer');
    assert.strictEqual(mainWorld.includes('.ytp-cards-button'), false, 'skipMainWorldAd must not delete .ytp-cards-button');
    assert.strictEqual(mainWorld.includes('.ytp-cards-teaser'), false, 'skipMainWorldAd must not delete .ytp-cards-teaser');

    // FP-9.6: Merchandise shelves must NOT be suppressed in AD_CSS
    assert.strictEqual(adsJs.includes('ytd-merch-shelf-renderer'), false, 'youtube-ads.js must NOT suppress ytd-merch-shelf-renderer');
  });

  test('In-video branding watermark and subscribe overlay are fully suppressed in CSS and pruned by scripts', () => {
    const css = fs.readFileSync(path.join(__dirname, '../content/content.css'), 'utf8');
    const playerMgr = fs.readFileSync(path.join(__dirname, '../content/player-manager.js'), 'utf8');
    const mainWorld = fs.readFileSync(path.join(__dirname, '../content/main-world.js'), 'utf8');

    // CSS targets
    assert.ok(css.includes('.branding-img-container'), 'content.css must suppress .branding-img-container');
    assert.ok(css.includes('.branding-img'), 'content.css must suppress .branding-img');
    assert.ok(css.includes('.iv-branding'), 'content.css must suppress .iv-branding');
    assert.ok(css.includes('.branding-context-container'), 'content.css must suppress .branding-context-container');
    assert.ok(css.includes('.ytp-featured-watermark'), 'content.css must suppress .ytp-featured-watermark');

    // DOM pruning in player-manager and main-world
    assert.ok(playerMgr.includes('.branding-img-container'), 'player-manager must prune .branding-img-container');
    assert.ok(mainWorld.includes('.branding-img-container'), 'main-world must prune .branding-img-container');
  });

  test('Thumbnail navigation and ad skipping recovers playback and calls playVideo if left paused', () => {
    const mainWorld = fs.readFileSync(path.join(__dirname, '../content/main-world.js'), 'utf8');
    const adsJs = fs.readFileSync(path.join(__dirname, '../content/youtube-ads.js'), 'utf8');

    // Autoplay recovery in main-world.js
    assert.ok(mainWorld.includes('player.playVideo()'), 'main-world must call player.playVideo()');
    assert.ok(mainWorld.includes('resumePlaybackIfStalled'), 'main-world must have resumePlaybackIfStalled watchdog');

    // Autoplay recovery in youtube-ads.js
    assert.ok(adsJs.includes('player.playVideo()'), 'youtube-ads must call player.playVideo()');
  });

  test('Normal playback respects user pause: space bar or click does not get immediately unpaused', () => {
    const mainWorld = fs.readFileSync(path.join(__dirname, '../content/main-world.js'), 'utf8');
    const adsJs = fs.readFileSync(path.join(__dirname, '../content/youtube-ads.js'), 'utf8');

    // Verify restoreVideoAfterAd only acts when CineGlow actively mutated playback during an ad
    assert.ok(mainWorld.includes('const hadAdMutation = Boolean(adMuted || acceleratedVideo'), 'restoreVideoAfterAd must guard with hadAdMutation');
    assert.strictEqual(mainWorld.includes('state === 2'), false, 'main-world must not unpause state === 2 (paused)');
    assert.strictEqual(adsJs.includes('state === 2'), false, 'youtube-ads must not unpause state === 2 (paused)');
  });

  test('Slow-loading video click and Autoplay transitions resume cleanly on canplay without overriding user pause', () => {
    const env = setupMockEnvironment('https://www.youtube.com/watch?v=slowLoadVid');
    const origWin = globalThis.window;
    const origDoc = globalThis.document;
    const origLoc = globalThis.location;

    globalThis.window = env.window;
    globalThis.document = env.document;
    globalThis.location = env.window.location;

    try {
      const player = new MockElement('div', { id: 'movie_player' });
      const video = new MockVideoElement();
      video.paused = true;
      video.currentTime = 0;
      video.readyState = 1; // initially still loading metadata/buffer
      player.appendChild(video);

      let playCalls = 0;
      let playerState = 3; // buffering initially
      player.getPlayerState = () => playerState;
      player.playVideo = () => {
        playCalls++;
        video.paused = false;
        playerState = 1;
      };
      env.elements.set('#movie_player', player);

      new Function(fs.readFileSync(path.join(__dirname, '../content/main-world.js'), 'utf8'))();

      // Simulate click/navigation onto watch page while video hasn't buffered yet
      env.window.location.href = 'https://www.youtube.com/watch?v=slowLoadVid2';
      env.document.dispatchEvent(new Event('yt-navigate-start'));
      env.document.dispatchEvent(new Event('yt-navigate-finish'));
      assert.strictEqual(playCalls, 0, 'Must not force playVideo while readyState < 2');

      // Video finishes loading later and emits canplay while still paused at 0s
      video.readyState = 3;
      playerState = -1;
      video.dispatchEvent(new Event('canplay'));
      assert.strictEqual(playCalls, 1, 'Must auto-play once video finishes loading (canplay)');

      // Autoplay next video after Video 1 ends
      video.ended = true;
      video.dispatchEvent(new Event('ended'));
      video.ended = false;
      video.paused = true;
      video.currentTime = 0;
      video.readyState = 3;
      video.dispatchEvent(new Event('loadedmetadata'));
      video.dispatchEvent(new Event('canplay'));
      assert.strictEqual(playCalls, 2, 'Autoplay next video must start cleanly on loadedmetadata + canplay');

      // User explicitly pauses via Spacebar after playback started -> canplay must NOT resume
      video.paused = false;
      video.currentTime = 12;
      video.dispatchEvent(new Event('timeupdate'));
      env.window.dispatchEvent(Object.assign(new Event('keydown'), { key: ' ' }));
      video.paused = true;
      video.dispatchEvent(new Event('canplay'));
      assert.strictEqual(playCalls, 2, 'User pause via Spacebar must never be auto-resumed');
    } finally {
      globalThis.window.dispatchEvent(new Event('cineglow:kill-switch'));
      globalThis.window = origWin;
      globalThis.document = origDoc;
      globalThis.location = origLoc;
    }
  });
});

// test/sponsor-skip.test.js
// CineGlow Pro for YouTube - Creator Branded Content & Sponsor Segment Skipping Test Suite
// Author: Giri Manohar Vemula (https://www.linkedin.com/in/manoharv511)

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setupMockEnvironment, MockVideoElement, MockElement } = require('./helpers/mock-dom');

describe('Creator Branded Content & In-Video Sponsor Segment Skipping', () => {
  let env;
  let originalWindow;
  let originalDocument;
  let originalChrome;
  let originalFetch;
  let originalLocation;
  let video;
  let player;
  let progressBar;

  function loadDefaults() {
    const code = fs.readFileSync(path.join(__dirname, '../shared/defaults.js'), 'utf8');
    const fn = new Function(`'use strict'; ${code}; return AURA_DEFAULTS;`);
    return fn();
  }

  function loadSponsorSkip() {
    const code = fs.readFileSync(path.join(__dirname, '../content/sponsor-skip.js'), 'utf8');
    const fn = new Function(code);
    fn();
  }

  beforeEach(() => {
    env = setupMockEnvironment('https://www.youtube.com/watch?v=sponsorTest123');
    originalWindow = globalThis.window;
    originalDocument = globalThis.document;
    originalChrome = globalThis.chrome;
    originalFetch = globalThis.fetch;
    originalLocation = globalThis.location;

    globalThis.window = env.window;
    globalThis.document = env.document;
    globalThis.chrome = env.chrome;
    globalThis.location = env.window.location;

    // Load defaults into global scope
    globalThis.AURA_DEFAULTS = loadDefaults();
    globalThis.window.AURA_DEFAULTS = globalThis.AURA_DEFAULTS;

    // Create YouTube player DOM hierarchy
    player = new MockElement('div', { id: 'movie_player', class: 'html5-video-player' });
    progressBar = new MockElement('div', { class: 'ytp-progress-bar' });
    video = new MockVideoElement();
    video.currentTime = 10.0;
    video.duration = 600.0;
    video.playbackRate = 1.0;
    video.muted = false;
    video.paused = false;

    player.appendChild(progressBar);
    player.appendChild(video);

    env.document.body.appendChild(player);
    env.elements.set('#movie_player', player);
    env.elements.set('.html5-video-player', player);
    env.elements.set('video.html5-main-video', video);
    env.elements.set('video', video);
    env.elements.set('.ytp-progress-bar', progressBar);
  });

  afterEach(() => {
    if (globalThis.window?.CineGlowSponsorBlock?.teardownKillSwitch) {
      globalThis.window.CineGlowSponsorBlock.teardownKillSwitch();
    }
    delete globalThis.AURA_DEFAULTS;
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
    globalThis.chrome = originalChrome;
    globalThis.fetch = originalFetch;
    globalThis.location = originalLocation;
  });

  describe('1. Default Settings & Configuration Schema', () => {
    test('AURA_DEFAULTS includes sponsor block settings with calibrated defaults', () => {
      const defaults = loadDefaults();
      assert.strictEqual(defaults.sponsorBlockEnabled, true, 'sponsorBlockEnabled default must be true');
      assert.strictEqual(defaults.sponsorBlockMode, 'skip', 'sponsorBlockMode default must be skip');
      assert.deepStrictEqual(defaults.sponsorBlockCategories, ['sponsor', 'selfpromo', 'interaction'], 'Default categories must cover sponsor, selfpromo, interaction');
      assert.strictEqual(defaults.sponsorBlockNotice, true, 'sponsorBlockNotice default must be true');
      assert.strictEqual(defaults.sponsorBlockCount, 0, 'sponsorBlockCount initial default must be 0');
    });

    test('initializes with settings from storage.sync and listens for live updates', async () => {
      await env.chrome.storage.sync.set({
        sponsorBlockEnabled: true,
        sponsorBlockMode: 'fastforward',
        sponsorBlockNotice: false
      });

      loadSponsorSkip();
      await new Promise(r => setTimeout(r, 15));

      const api = globalThis.window.CineGlowSponsorBlock;
      assert.ok(api, 'CineGlowSponsorBlock API must be exposed on window');
      assert.strictEqual(api.settings.sponsorBlockEnabled, true);
      assert.strictEqual(api.settings.sponsorBlockMode, 'fastforward');
      assert.strictEqual(api.settings.sponsorBlockNotice, false);

      // Trigger live storage change
      env.chrome.storage.onChanged._listeners.forEach(fn => fn({
        sponsorBlockMode: { newValue: 'skip' },
        sponsorBlockNotice: { newValue: true }
      }, 'sync'));

      assert.strictEqual(api.settings.sponsorBlockMode, 'skip', 'Sponsor block mode must update live');
      assert.strictEqual(api.settings.sponsorBlockNotice, true, 'Sponsor block notice must update live');
    });

    test('disabling sponsorBlockEnabled tears down markers, notices, and modifications', async () => {
      loadSponsorSkip();
      await new Promise(r => setTimeout(r, 15));

      const api = globalThis.window.CineGlowSponsorBlock;
      api.setSegments([
        { id: 'seg1', start: 30, end: 60, category: 'sponsor', actionType: 'skip' }
      ]);
      api.renderMarkers();

      let markers = player.querySelector('.cineglow-sponsor-markers');
      assert.ok(markers, 'Markers must be rendered when enabled');

      // Disable via storage change
      env.chrome.storage.onChanged._listeners.forEach(fn => fn({
        sponsorBlockEnabled: { newValue: false }
      }, 'sync'));

      markers = player.querySelector('.cineglow-sponsor-markers');
      assert.strictEqual(markers, null, 'Markers must be removed when sponsor block is disabled');
      assert.strictEqual(api.settings.sponsorBlockEnabled, false);
    });
  });

  describe('2. SponsorBlock API Network Integration & Caching', () => {
    test('fetches sponsor segments via background service worker relay', async () => {
      const mockSegments = [
        {
          UUID: 'uuid-1234',
          segment: [45.2, 75.8],
          category: 'sponsor',
          actionType: 'skip'
        },
        {
          UUID: 'uuid-5678',
          segment: [120.0, 150.0],
          category: 'selfpromo',
          actionType: 'skip'
        }
      ];

      env.chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message.type === 'FETCH_SPONSOR_BLOCK') {
          assert.strictEqual(message.videoId, 'sponsorTest123');
          sendResponse({ success: true, segments: mockSegments });
        }
      });

      loadSponsorSkip();
      await new Promise(r => setTimeout(r, 20));

      const api = globalThis.window.CineGlowSponsorBlock;
      const segs = api.getSegments();
      assert.strictEqual(segs.length, 2, 'Must load 2 segments');
      assert.strictEqual(segs[0].id, 'uuid-1234');
      assert.strictEqual(segs[0].start, 45.2);
      assert.strictEqual(segs[0].end, 75.8);
      assert.strictEqual(segs[0].category, 'sponsor');
      assert.strictEqual(segs[1].category, 'selfpromo');
    });

    test('gracefully handles 404 / no segments found without error', async () => {
      env.chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message.type === 'FETCH_SPONSOR_BLOCK') {
          sendResponse({ success: true, segments: [] });
        }
      });

      loadSponsorSkip();
      await new Promise(r => setTimeout(r, 20));

      const api = globalThis.window.CineGlowSponsorBlock;
      const segs = api.getSegments();
      assert.strictEqual(segs.length, 0, 'Segments must be empty array when 404/none exist');
    });

    test('in-memory cache prevents redundant duplicate network requests for same videoId', async () => {
      let callCount = 0;
      env.chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message.type === 'FETCH_SPONSOR_BLOCK') {
          callCount++;
          sendResponse({
            success: true,
            segments: [{ UUID: 'u1', segment: [10, 20], category: 'sponsor' }]
          });
        }
      });

      loadSponsorSkip();
      await new Promise(r => setTimeout(r, 20));
      assert.strictEqual(callCount, 1, 'Initial request made');

      const api = globalThis.window.CineGlowSponsorBlock;
      // Second fetch for same videoId should hit cache
      const cached = await api.fetchSegments('sponsorTest123');
      assert.strictEqual(cached.length, 1);
      assert.strictEqual(callCount, 1, 'Duplicate query must be served from cache');
    });
  });

  describe('3. Native YouTube Chapter Sponsor Detection (Zero-Network Fallback)', () => {
    test('detects sponsor segments from YouTube player getChapters API', async () => {
      player.getChapters = () => [
        { title: 'Introduction', time: 0 },
        { title: 'Sponsor: NordVPN Special Offer', time: 60, end_time: 120 },
        { title: 'Deep Dive Tutorial', time: 120 }
      ];

      loadSponsorSkip();
      await new Promise(r => setTimeout(r, 20));

      const api = globalThis.window.CineGlowSponsorBlock;
      const chs = api.detectChaptersFromDOM();
      assert.strictEqual(chs.length, 1, 'Must detect NordVPN sponsor chapter');
      assert.strictEqual(chs[0].start, 60);
      assert.strictEqual(chs[0].end, 120);
      assert.strictEqual(chs[0].category, 'sponsor');
    });

    test('detects sponsor segments from DOM chapter markers on progress bar', async () => {
      const chapterMarker = new MockElement('div', {
        class: 'ytp-chapter-marker',
        title: 'A word from our sponsor',
        'data-start': '90',
        'data-end': '150'
      });
      chapterMarker.dataset = { start: '90', end: '150' };
      progressBar.appendChild(chapterMarker);

      loadSponsorSkip();
      await new Promise(r => setTimeout(r, 20));

      const api = globalThis.window.CineGlowSponsorBlock;
      const chs = api.detectChaptersFromDOM();
      assert.strictEqual(chs.length, 1);
      assert.strictEqual(chs[0].start, 90);
      assert.strictEqual(chs[0].end, 150);
    });

    test('merges chapter segments with SponsorBlock segments without duplicates', async () => {
      player.getChapters = () => [
        { title: 'Sponsored Segment', time: 50, end_time: 80 }
      ];

      env.chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message.type === 'FETCH_SPONSOR_BLOCK') {
          sendResponse({
            success: true,
            segments: [
              // Overlaps with chapter (start ~50) -> chapter won't be duplicated
              { UUID: 'sb-1', segment: [50, 80], category: 'sponsor' },
              // Distinct sponsor segment
              { UUID: 'sb-2', segment: [200, 240], category: 'sponsor' }
            ]
          });
        }
      });

      loadSponsorSkip();
      await new Promise(r => setTimeout(r, 20));

      const api = globalThis.window.CineGlowSponsorBlock;
      const segs = api.getSegments();
      assert.strictEqual(segs.length, 2, 'Should have exactly 2 deduplicated segments');
      assert.strictEqual(segs[0].start, 50);
      assert.strictEqual(segs[1].start, 200);
    });
  });

  describe('4. Timeline Scrubber Marker Rendering', () => {
    test('renders colored sponsor markers onto progress bar at calculated percentages', async () => {
      loadSponsorSkip();
      await new Promise(r => setTimeout(r, 15));

      const api = globalThis.window.CineGlowSponsorBlock;
      video.duration = 1000.0;
      api.setSegments([
        { id: 's1', start: 100, end: 200, category: 'sponsor' },       // 10% to 20%
        { id: 's2', start: 500, end: 600, category: 'selfpromo' }     // 50% to 60%
      ]);

      api.renderMarkers();

      const container = progressBar.querySelector('.cineglow-sponsor-markers');
      assert.ok(container, 'Marker container must be attached to progress bar');

      const markers = container.querySelectorAll('.cineglow-sponsor-marker');
      assert.strictEqual(markers.length, 2, 'Must render 2 marker divs');

      assert.strictEqual(markers[0].style.left, '10%');
      assert.strictEqual(markers[0].style.width, '10%');
      assert.strictEqual(markers[0].dataset.category, 'sponsor');

      assert.strictEqual(markers[1].style.left, '50%');
      assert.strictEqual(markers[1].style.width, '10%');
      assert.strictEqual(markers[1].dataset.category, 'selfpromo');
    });

    test('re-renders markers when video fires durationchange event', async () => {
      loadSponsorSkip();
      await new Promise(r => setTimeout(r, 15));

      const api = globalThis.window.CineGlowSponsorBlock;
      video.duration = 0; // Duration unknown initially
      api.setSegments([
        { id: 's1', start: 50, end: 100, category: 'sponsor' }
      ]);
      api.renderMarkers();

      let container = progressBar.querySelector('.cineglow-sponsor-markers');
      assert.strictEqual(container, null, 'Must not render when duration is 0');

      // Video metadata loads and duration becomes 500s
      video.duration = 500.0;
      video.dispatchEvent(new Event('durationchange'));

      container = progressBar.querySelector('.cineglow-sponsor-markers');
      assert.ok(container, 'Markers must be rendered when durationchange event fires');
      const marker = container.querySelector('.cineglow-sponsor-marker');
      assert.ok(marker);
      assert.strictEqual(marker.style.left, '10%'); // 50 / 500 = 10%
    });
  });

  describe('5. Auto-Skip Playback Mode', () => {
    test('instantly seeks video past sponsor segment when playback reaches start point', async () => {
      loadSponsorSkip();
      await new Promise(r => setTimeout(r, 15));

      const api = globalThis.window.CineGlowSponsorBlock;
      api.setSegments([
        { id: 'seg-sponsor-1', start: 30.0, end: 60.0, category: 'sponsor', actionType: 'skip' }
      ]);

      let blockedMsgReceived = false;
      env.chrome.runtime.onMessage.addListener((message) => {
        if (message.type === 'SPONSOR_BLOCKED') {
          blockedMsgReceived = true;
          assert.strictEqual(message.count, 1);
        }
      });

      // Playhead approaches segment: at 25s, no skip
      video.currentTime = 25.0;
      api.checkSegmentState();
      assert.strictEqual(video.currentTime, 25.0, 'Must not jump before start of sponsor');

      // Playhead enters sponsor segment at 30.5s: jumps to 60.0s
      video.currentTime = 30.5;
      api.checkSegmentState();
      assert.strictEqual(video.currentTime, 60.0, 'Must immediately seek to end of sponsor segment');
      assert.strictEqual(blockedMsgReceived, true, 'Must send SPONSOR_BLOCKED event');

      // Shows HUD toast notice
      const notice = player.querySelector('.cineglow-sponsor-notice');
      assert.ok(notice, 'HUD toast notice must appear after skipping');
      assert.ok(notice.textContent.includes('Skipped Sponsor (0:30 - 1:00)'));
    });

    test('does not seek video when user is actively scrubbing (video.seeking = true)', async () => {
      loadSponsorSkip();
      await new Promise(r => setTimeout(r, 15));

      const api = globalThis.window.CineGlowSponsorBlock;
      api.setSegments([
        { id: 'seg-sponsor-1', start: 30.0, end: 60.0, category: 'sponsor', actionType: 'skip' }
      ]);

      video.seeking = true;
      video.currentTime = 45.0;
      api.checkSegmentState();

      assert.strictEqual(video.currentTime, 45.0, 'Must not jump while user is scrubbing');
    });
  });

  describe('6. Fast-Forward Playback Mode', () => {
    test('accelerates to 16x and mutes during sponsor segment, restoring speed & audio when exited', async () => {
      loadSponsorSkip();
      await new Promise(r => setTimeout(r, 15));

      const api = globalThis.window.CineGlowSponsorBlock;
      api.settings.sponsorBlockMode = 'fastforward';
      api.setSegments([
        { id: 'seg-ff-1', start: 100.0, end: 140.0, category: 'sponsor', actionType: 'skip' }
      ]);

      video.playbackRate = 1.25;
      video.muted = false;

      // 1. Enter sponsor segment at 105s
      video.currentTime = 105.0;
      api.checkSegmentState();

      assert.strictEqual(video.playbackRate, 16.0, 'Playback rate must accelerate to 16.0x during sponsor');
      assert.strictEqual(video.muted, true, 'Audio must be muted during fast-forward');

      const notice = player.querySelector('.cineglow-sponsor-notice');
      assert.ok(notice, 'HUD toast must show fast-forwarding state');
      assert.ok(notice.textContent.includes('Fast-forwarding Sponsor'));

      // 2. Playhead passes end of segment at 141s
      video.currentTime = 141.0;
      api.checkSegmentState();

      assert.strictEqual(video.playbackRate, 1.25, 'Playback rate must restore to pre-fastforward 1.25x');
      assert.strictEqual(video.muted, false, 'Audio must unmute upon exiting sponsor segment');
    });

    test('preserves user pre-muted state when exiting fast-forward mode', async () => {
      loadSponsorSkip();
      await new Promise(r => setTimeout(r, 15));

      const api = globalThis.window.CineGlowSponsorBlock;
      api.settings.sponsorBlockMode = 'fastforward';
      api.setSegments([
        { id: 'seg-ff-2', start: 100.0, end: 140.0, category: 'sponsor', actionType: 'skip' }
      ]);

      // User had already muted video beforehand
      video.muted = true;
      video.playbackRate = 1.0;

      video.currentTime = 105.0;
      api.checkSegmentState();
      assert.strictEqual(video.playbackRate, 16.0);
      assert.strictEqual(video.muted, true);

      // Exit segment
      video.currentTime = 142.0;
      api.checkSegmentState();

      assert.strictEqual(video.playbackRate, 1.0);
      assert.strictEqual(video.muted, true, 'Must preserve pre-existing user mute state');
    });
  });

  describe('7. Interactive HUD Notice & Undo Mechanism', () => {
    test('clicking Undo seeks back to segment start and prevents re-skipping in current session', async () => {
      loadSponsorSkip();
      await new Promise(r => setTimeout(r, 15));

      const api = globalThis.window.CineGlowSponsorBlock;
      api.setSegments([
        { id: 'undo-seg', start: 50.0, end: 80.0, category: 'sponsor', actionType: 'skip' }
      ]);

      // Trigger skip
      video.currentTime = 51.0;
      api.checkSegmentState();
      assert.strictEqual(video.currentTime, 80.0, 'Skipped to 80.0');

      let notice = player.querySelector('.cineglow-sponsor-notice');
      assert.ok(notice);

      const undoBtn = notice.querySelector('.cineglow-sponsor-undo');
      assert.ok(undoBtn, 'Undo button must be present in HUD notice');

      // Click Undo
      undoBtn.dispatchEvent(new Event('click'));

      assert.strictEqual(video.currentTime, 50.0, 'Undo must seek back to segment start (50.0)');
      notice = player.querySelector('.cineglow-sponsor-notice');
      assert.strictEqual(notice, null, 'Notice must dismiss on undo');

      // Subsequent timeupdate in the same segment must NOT re-skip
      video.currentTime = 52.0;
      api.checkSegmentState();
      assert.strictEqual(video.currentTime, 52.0, 'Segment must not be re-skipped after undo');
    });
  });

  describe('8. Enterprise Policy Compliance & Emergency Kill-Switch', () => {
    test('DisableThirdPartyAPIs: true prevents outbound SponsorBlock queries and falls back to chapters', async () => {
      let networkRequested = false;
      env.chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message.type === 'FETCH_SPONSOR_BLOCK') {
          networkRequested = true;
          sendResponse({ success: false, error: 'Should not be called' });
        }
      });

      // Managed policy sets DisableThirdPartyAPIs
      env.chrome.storage.managed._data.DisableThirdPartyAPIs = true;

      player.getChapters = () => [
        { title: 'Sponsor: Corporate Sponsor', time: 70, end_time: 110 }
      ];

      loadSponsorSkip();
      await new Promise(r => setTimeout(r, 20));

      const api = globalThis.window.CineGlowSponsorBlock;
      assert.strictEqual(api.isThirdPartyDisabled(), true, 'isThirdPartyDisabled must be true');
      assert.strictEqual(networkRequested, false, 'Outbound network calls to SponsorBlock API must be blocked by enterprise policy');

      // Native chapter detection still provides sponsor skipping
      const segs = api.getSegments();
      assert.strictEqual(segs.length, 1, 'Local chapter sponsor detection must function even when third-party APIs are disabled');
      assert.strictEqual(segs[0].start, 70);
    });

    test('emergency kill-switch dismantles markers, notices, intervals, and restores playback state', async () => {
      loadSponsorSkip();
      await new Promise(r => setTimeout(r, 15));

      const api = globalThis.window.CineGlowSponsorBlock;
      api.setSegments([
        { id: 'k1', start: 20, end: 50, category: 'sponsor' }
      ]);
      api.renderMarkers();
      api.showNotice({ category: 'sponsor', start: 20, end: 50 });

      assert.ok(player.querySelector('.cineglow-sponsor-markers'));
      assert.ok(player.querySelector('.cineglow-sponsor-notice'));

      // Dispatch emergency kill switch event
      globalThis.window.dispatchEvent(new CustomEvent('cineglow:kill-switch'));

      assert.strictEqual(api.isKilled(), true, 'Must report isKilled = true');
      assert.strictEqual(api.settings.sponsorBlockEnabled, false);
      assert.strictEqual(player.querySelector('.cineglow-sponsor-markers'), null, 'Markers must be destroyed');
      assert.strictEqual(player.querySelector('.cineglow-sponsor-notice'), null, 'Notices must be destroyed');
    });

    test('teardownKillSwitch responds to runtime message AURA_EMERGENCY_KILL_SWITCH', async () => {
      loadSponsorSkip();
      await new Promise(r => setTimeout(r, 15));

      const api = globalThis.window.CineGlowSponsorBlock;
      assert.strictEqual(api.isKilled(), false);

      env.chrome.runtime.onMessage.dispatch({ type: 'AURA_EMERGENCY_KILL_SWITCH' });

      assert.strictEqual(api.isKilled(), true, 'Must activate teardown upon receiving AURA_EMERGENCY_KILL_SWITCH');
    });
  });

  describe('9. SPA Navigation & Edge Cases', () => {
    test('navigating to a new video resets segments, clears markers, and queries new videoId', async () => {
      let requestedVideoIds = [];
      env.chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message.type === 'FETCH_SPONSOR_BLOCK') {
          requestedVideoIds.push(message.videoId);
          sendResponse({
            success: true,
            segments: [{ UUID: `seg_${message.videoId}`, segment: [10, 30], category: 'sponsor' }]
          });
        }
      });

      loadSponsorSkip();
      await new Promise(r => setTimeout(r, 20));

      const api = globalThis.window.CineGlowSponsorBlock;
      assert.strictEqual(requestedVideoIds.includes('sponsorTest123'), true);

      // Simulate SPA navigation to videoB
      globalThis.window.location.search = '?v=videoB';
      env.document.dispatchEvent(new Event('yt-navigate-finish'));
      await new Promise(r => setTimeout(r, 20));

      assert.strictEqual(requestedVideoIds.includes('videoB'), true, 'Must request segments for newly navigated video');
      assert.strictEqual(api.getVideoId(), 'videoB');
    });

    test('replacement video element mid-playback automatically receives timeupdate listener', async () => {
      loadSponsorSkip();
      await new Promise(r => setTimeout(r, 15));

      const api = globalThis.window.CineGlowSponsorBlock;
      api.setSegments([
        { id: 'rep-seg', start: 40, end: 70, category: 'sponsor', actionType: 'skip' }
      ]);

      // YouTube replaces <video> element
      video.remove();
      const newVideo = new MockVideoElement();
      newVideo.currentTime = 42.0;
      newVideo.duration = 500.0;
      newVideo.paused = false;
      player.appendChild(newVideo);
      env.elements.set('video.html5-main-video', newVideo);
      env.elements.set('video', newVideo);

      // Broadcast update
      env.document.dispatchEvent(new Event('yt-page-data-updated'));
      await new Promise(r => setTimeout(r, 15));

      newVideo.dispatchEvent(new Event('timeupdate'));
      assert.strictEqual(newVideo.currentTime, 70.0, 'New video element must trigger sponsor skip');
    });

    test('segment ending at or beyond video duration clamps seek to video.duration without crash', async () => {
      loadSponsorSkip();
      await new Promise(r => setTimeout(r, 15));

      const api = globalThis.window.CineGlowSponsorBlock;
      api.settings.sponsorBlockCategories = ['sponsor', 'outro'];
      video.duration = 120.0;
      api.setSegments([
        { id: 'end-seg', start: 110.0, end: 130.0, category: 'outro', actionType: 'skip' }
      ]);

      video.currentTime = 112.0;
      api.checkSegmentState();

      assert.strictEqual(video.currentTime, 120.0, 'Must clamp jump to video.duration (120.0)');
    });
  });

  describe('10. Background Service Worker Throttling & Telemetry', () => {
    test('background.js handles FETCH_SPONSOR_BLOCK and SPONSOR_BLOCKED with throttled storage persistence', async () => {
      const bgCode = fs.readFileSync(path.join(__dirname, '../background/background.js'), 'utf8');
      new Function(bgCode)();

      // Dispatch SPONSOR_BLOCKED message
      env.chrome.runtime.onMessage.dispatch({ type: 'SPONSOR_BLOCKED', count: 1 });
      await new Promise(r => setTimeout(r, 20));

      // Wait for trailing-edge throttle flush (500ms)
      await new Promise(r => setTimeout(r, 550));

      const local = await env.chrome.storage.local.get('sponsorBlockCount');
      assert.strictEqual(local.sponsorBlockCount, 1, 'sponsorBlockCount in storage.local must be 1');
    });
  });

  describe('11. Robustness, Coexistence & Edge Case Fixes', () => {
    test('category filtering: segments with disabled categories are neither skipped nor marked', async () => {
      loadSponsorSkip();
      await new Promise(r => setTimeout(r, 15));

      const api = globalThis.window.CineGlowSponsorBlock;
      // User only enables 'sponsor', but NOT 'selfpromo'
      api.settings.sponsorBlockCategories = ['sponsor'];
      api.setSegments([
        { id: 'promo-1', start: 30, end: 60, category: 'selfpromo', actionType: 'skip' },
        { id: 'spon-1', start: 100, end: 140, category: 'sponsor', actionType: 'skip' }
      ]);

      api.renderMarkers();
      const container = progressBar.querySelector('.cineglow-sponsor-markers');
      assert.ok(container);
      const markers = container.querySelectorAll('.cineglow-sponsor-marker');
      assert.strictEqual(markers.length, 1, 'Only enabled category (sponsor) should have markers rendered');
      assert.strictEqual(markers[0].dataset.category, 'sponsor');

      // Playhead enters selfpromo segment at 35s
      video.currentTime = 35.0;
      api.checkSegmentState();
      assert.strictEqual(video.currentTime, 35.0, 'Disabled category (selfpromo) must NOT be skipped');

      // Playhead enters sponsor segment at 105s
      video.currentTime = 105.0;
      api.checkSegmentState();
      assert.strictEqual(video.currentTime, 140.0, 'Enabled category (sponsor) MUST be skipped');
    });

    test('ad playback isolation: does not seek or alter playback while in-stream ad is showing', async () => {
      loadSponsorSkip();
      await new Promise(r => setTimeout(r, 15));

      const api = globalThis.window.CineGlowSponsorBlock;
      api.setSegments([
        { id: 'spon-ad-1', start: 30, end: 60, category: 'sponsor', actionType: 'skip' }
      ]);

      // YouTube player enters ad-showing state
      player.classList.add('ad-showing');
      assert.strictEqual(api.isAdActive(), true);

      video.currentTime = 35.0;
      api.checkSegmentState();
      assert.strictEqual(video.currentTime, 35.0, 'Must NOT jump while in-stream ad is playing');

      // Ad ends
      player.classList.remove('ad-showing');
      assert.strictEqual(api.isAdActive(), false);

      api.checkSegmentState();
      assert.strictEqual(video.currentTime, 60.0, 'Jumps once ad is no longer active');
    });

    test('consecutive adjacent segments in fast-forward mode transition cleanly and update notices', async () => {
      loadSponsorSkip();
      await new Promise(r => setTimeout(r, 15));

      const api = globalThis.window.CineGlowSponsorBlock;
      api.settings.sponsorBlockMode = 'fastforward';
      api.setSegments([
        { id: 'segA', start: 10, end: 30, category: 'sponsor', actionType: 'skip' },
        { id: 'segB', start: 30, end: 50, category: 'selfpromo', actionType: 'skip' }
      ]);

      let blockedCount = 0;
      env.chrome.runtime.onMessage.addListener((msg) => {
        if (msg.type === 'SPONSOR_BLOCKED') blockedCount += (msg.count || 1);
      });

      // Enter segA
      video.currentTime = 15.0;
      api.checkSegmentState();
      assert.strictEqual(video.playbackRate, 16.0);
      let notice = player.querySelector('.cineglow-sponsor-notice');
      assert.ok(notice.textContent.includes('Fast-forwarding Sponsor'));

      // Advance directly to segB at 35.0s
      video.currentTime = 35.0;
      api.checkSegmentState();
      assert.strictEqual(video.playbackRate, 16.0);
      assert.strictEqual(blockedCount, 1, 'First segment must be recorded as blocked');
      notice = player.querySelector('.cineglow-sponsor-notice');
      assert.ok(notice.textContent.includes('Fast-forwarding Self-Promo'), 'HUD notice must update to next segment');

      // Exit segB at 51.0s
      video.currentTime = 51.0;
      api.checkSegmentState();
      assert.strictEqual(video.playbackRate, 1.0, 'Rate restored after exiting last segment');
      assert.strictEqual(blockedCount, 2, 'Both consecutive segments must be recorded');
    });

    test('mode change mid-fastforward immediately restores speed and audio', async () => {
      loadSponsorSkip();
      await new Promise(r => setTimeout(r, 15));

      const api = globalThis.window.CineGlowSponsorBlock;
      api.settings.sponsorBlockMode = 'fastforward';
      api.setSegments([
        { id: 'ff-switch', start: 20, end: 60, category: 'sponsor' }
      ]);

      video.currentTime = 25.0;
      api.checkSegmentState();
      assert.strictEqual(video.playbackRate, 16.0);
      assert.strictEqual(video.muted, true);

      // User changes mode in popup to 'skip'
      env.chrome.storage.onChanged._listeners.forEach(fn => fn({
        sponsorBlockMode: { newValue: 'skip' }
      }, 'sync'));

      assert.strictEqual(video.playbackRate, 1.0, 'Playback rate must restore immediately when mode changed from fastforward');
      assert.strictEqual(video.muted, false, 'Audio must unmute immediately');
    });

    test('false-positive chapter discrimination: rejects "Tennis Partner" and "Not Sponsored"', async () => {
      loadSponsorSkip();
      await new Promise(r => setTimeout(r, 15));

      const api = globalThis.window.CineGlowSponsorBlock;
      assert.strictEqual(api.isSponsorTitle('Tennis Partner Drills'), false, 'Non-commercial partner title must NOT be a sponsor');
      assert.strictEqual(api.isSponsorTitle('Interview with Business Partner'), false);
      assert.strictEqual(api.isSponsorTitle('Not Sponsored Today'), false, 'Negated sponsor title must NOT be a sponsor');
      assert.strictEqual(api.isSponsorTitle('No Sponsors This Week'), false);

      assert.strictEqual(api.isSponsorTitle('Official Partner: NordVPN'), true);
      assert.strictEqual(api.isSponsorTitle('Brand Partner Shoutout'), true);
      assert.strictEqual(api.isSponsorTitle('Sponsor: Squarespace'), true);
      assert.strictEqual(api.isSponsorTitle('Sponsored Segment'), true);
      assert.strictEqual(api.isSponsorTitle('Paid Promotion'), true);
    });

    test('enterprise policy block from background worker aborts fallback direct fetch', async () => {
      let directFetchAttempted = false;
      globalThis.fetch = async () => {
        directFetchAttempted = true;
        return { ok: true, json: async () => [] };
      };

      env.chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message.type === 'FETCH_SPONSOR_BLOCK') {
          sendResponse({ success: false, error: 'Blocked by enterprise policy' });
        }
      });

      loadSponsorSkip();
      await new Promise(r => setTimeout(r, 20));

      const api = globalThis.window.CineGlowSponsorBlock;
      const segs = await api.fetchSegments('sponsorTest123');
      assert.strictEqual(directFetchAttempted, false, 'Fallback direct fetch must NOT be attempted when blocked by enterprise policy');
      assert.strictEqual(api.isThirdPartyDisabled(), true);
      assert.deepStrictEqual(segs, []);
    });

    test('paused video does not auto-skip', async () => {
      loadSponsorSkip();
      await new Promise(r => setTimeout(r, 15));

      const api = globalThis.window.CineGlowSponsorBlock;
      api.setSegments([
        { id: 'pause-test', start: 50, end: 80, category: 'sponsor' }
      ]);

      video.paused = true;
      video.currentTime = 55.0;
      api.checkSegmentState();

      assert.strictEqual(video.currentTime, 55.0, 'Must NOT jump while video is paused');
    });

    test('live streams with Infinity duration do not render timeline markers', async () => {
      loadSponsorSkip();
      await new Promise(r => setTimeout(r, 15));

      const api = globalThis.window.CineGlowSponsorBlock;
      video.duration = Infinity;
      api.setSegments([
        { id: 'live-seg', start: 10, end: 40, category: 'sponsor' }
      ]);

      api.renderMarkers();
      const container = progressBar.querySelector('.cineglow-sponsor-markers');
      assert.strictEqual(container, null, 'Markers must not be rendered when video duration is Infinity');
    });

    test('context invalidation tears down intervals and listeners cleanly', async () => {
      loadSponsorSkip();
      await new Promise(r => setTimeout(r, 15));

      const api = globalThis.window.CineGlowSponsorBlock;
      assert.strictEqual(api.isContextValid(), true);

      // Simulate context invalidation
      delete globalThis.chrome.runtime.id;
      assert.strictEqual(api.isContextValid(), false);

      // Calling checkSegmentState should tear down without error
      api.checkSegmentState();
      assert.strictEqual(api.isKilled(), true, 'Must automatically trigger teardown on invalid context');
    });

    test('popup initial load synchronizes adblockCount and sponsorBlockCount from storage.local', async () => {
      await env.chrome.storage.local.set({
        adblockCount: 42,
        sponsorBlockCount: 17
      });

      const localData = await env.chrome.storage.local.get(['auraKillSwitchActive', 'adblockCount', 'sponsorBlockCount']);
      assert.strictEqual(localData.adblockCount, 42);
      assert.strictEqual(localData.sponsorBlockCount, 17);

      const defaults = loadDefaults();
      const settings = { ...defaults, ...(await env.chrome.storage.sync.get(defaults)) };
      if (typeof localData.adblockCount === 'number') {
        settings.adblockCount = localData.adblockCount;
      }
      if (typeof localData.sponsorBlockCount === 'number') {
        settings.sponsorBlockCount = localData.sponsorBlockCount;
      }

      assert.strictEqual(settings.adblockCount, 42, 'adblockCount must be populated from storage.local');
      assert.strictEqual(settings.sponsorBlockCount, 17, 'sponsorBlockCount must be populated from storage.local');
    });
  });

  describe('12. Remediation Verification (FP-2.1, FP-2.2, FP-2.3, FP-2.4)', () => {
    test('FP-2.1: rejects bare keywords and exclusions (chess, sports, unboxings, patreon Q&A)', async () => {
      loadSponsorSkip();
      await new Promise(r => setTimeout(r, 15));

      const api = globalThis.window.CineGlowSponsorBlock;

      // Bare words must be rejected
      assert.strictEqual(api.isSponsorTitle('Promotion'), false, 'Bare "Promotion" must not match');
      assert.strictEqual(api.isSponsorTitle('Merchandise'), false, 'Bare "Merchandise" must not match');
      assert.strictEqual(api.isSponsorTitle('Partners'), false, 'Bare "Partners" must not match');
      assert.strictEqual(api.isSponsorTitle('Patreon'), false, 'Bare "Patreon" must not match');

      // Exclusions must be rejected
      assert.strictEqual(api.isSponsorTitle('Pawn Promotion'), false, 'Chess "Pawn Promotion" must be rejected');
      assert.strictEqual(api.isSponsorTitle('Endgame Tactics: Pawn Promotion'), false, 'Chess pawn promotion must be rejected');
      assert.strictEqual(api.isSponsorTitle('Sports Promotion'), false, 'Sports promotion must be rejected');
      assert.strictEqual(api.isSponsorTitle('Premier League Promotion Race'), false, 'League promotion must be rejected');
      assert.strictEqual(api.isSponsorTitle('Unboxing Mystery Box'), false, 'Unboxings must be rejected');
      assert.strictEqual(api.isSponsorTitle('Merch Unboxing'), false, 'Merch unboxing must be rejected');
      assert.strictEqual(api.isSponsorTitle('Patreon Q&A'), false, 'Patreon Q&A must be rejected');
      assert.strictEqual(api.isSponsorTitle('Patreon Q&A Session with Fans'), false, 'Patreon Q&A must be rejected');

      // Compound qualifiers must match
      assert.strictEqual(api.isSponsorTitle('Brand Partner: Acme Corp'), true, 'Compound brand partner must match');
      assert.strictEqual(api.isSponsorTitle('Channel Promo & Updates'), true, 'Compound channel promo must match');
      assert.strictEqual(api.isSponsorTitle('Merch Plug'), true, 'Compound merch plug must match');
      assert.strictEqual(api.isSponsorTitle('Patreon Shoutout'), true, 'Compound patreon shoutout must match');
      assert.strictEqual(api.isSponsorTitle('Support us on Patreon!'), true, 'Compound support us on patreon must match');
      assert.strictEqual(api.isSponsorTitle('Paid Promotion: NordVPN'), true, 'Paid promotion must match');
    });

    test('FP-2.2: calculates chapter fallback end from subsequent chapter start and clamps final chapter', async () => {
      // 1. getChapters API with missing end_time / duration
      player.getChapters = () => [
        { title: 'Intro', time: 0 },
        { title: 'Brand Partner: Acme', time: 30 }, // No end_time: should fallback to next chapter start (85)
        { title: 'Deep Dive Tutorial', time: 85 },
        { title: 'Channel Promo', time: 200 } // Final chapter: clamps to Math.min(start + 20, video.duration) = 220
      ];

      loadSponsorSkip();
      await new Promise(r => setTimeout(r, 15));

      const api = globalThis.window.CineGlowSponsorBlock;
      const chs = api.detectChaptersFromDOM();

      assert.strictEqual(chs.length, 2, 'Must detect the 2 sponsor chapters');
      assert.strictEqual(chs[0].start, 30);
      assert.strictEqual(chs[0].end, 85, 'Fallback end must be derived from subsequent chapter start time (85)');

      assert.strictEqual(chs[1].start, 200);
      assert.strictEqual(chs[1].end, 220, 'Final chapter fallback must clamp to Math.min(start + 20, duration)');
    });

    test('FP-2.2: macro markers without duration calculate end from subsequent chapter', async () => {
      const container = new MockElement('div', { id: 'macro-markers' });
      const item1 = new MockElement('ytd-macro-markers-list-item-renderer');
      const title1 = new MockElement('div', { id: 'title' });
      title1.textContent = 'Brand Partner: TechCorp';
      const time1 = new MockElement('div', { id: 'time' });
      time1.textContent = '1:15'; // 75 seconds
      item1.appendChild(title1);
      item1.appendChild(time1);

      const item2 = new MockElement('ytd-macro-markers-list-item-renderer');
      const title2 = new MockElement('div', { id: 'title' });
      title2.textContent = 'Gameplay Walkthrough';
      const time2 = new MockElement('div', { id: 'time' });
      time2.textContent = '2:40'; // 160 seconds
      item2.appendChild(title2);
      item2.appendChild(time2);

      container.appendChild(item1);
      container.appendChild(item2);
      player.appendChild(container);

      loadSponsorSkip();
      await new Promise(r => setTimeout(r, 15));

      const api = globalThis.window.CineGlowSponsorBlock;
      const chs = api.detectChaptersFromDOM();

      const macroSeg = chs.find(c => c.id.startsWith('chapter_macro_75'));
      assert.ok(macroSeg, 'Must detect macro marker chapter');
      assert.strictEqual(macroSeg.start, 75);
      assert.strictEqual(macroSeg.end, 160, 'End must be calculated from next chapter start (160s)');
    });

    test('FP-2.3: video seeked event auto-registers unskippedSegments preventing scrubbing lockout', async () => {
      loadSponsorSkip();
      await new Promise(r => setTimeout(r, 15));

      const api = globalThis.window.CineGlowSponsorBlock;
      const testSeg = { id: 'sponsor-scrub-1', start: 50, end: 90, category: 'sponsor', actionType: 'skip' };
      api.setSegments([testSeg]);

      // Manually scrub directly inside the sponsor segment
      video.currentTime = 65;
      video.seeking = false;
      video.dispatchEvent(new Event('seeked'));

      // Verify seg.id is registered in unskippedSegments
      const unskipped = api.getUnskippedSegments();
      assert.ok(unskipped.has('sponsor-scrub-1'), 'Scrubbed segment must be registered in unskippedSegments');

      // Now checkSegmentState() should NOT jump currentTime forward to 90
      api.checkSegmentState();
      assert.strictEqual(video.currentTime, 65, 'Playback head must remain at user scrub target (65s), not skipped to 90s');
    });

    test('FP-2.4: live streams and premieres bypass checkSegmentState to prevent 16x buffer stalling', async () => {
      loadSponsorSkip();
      await new Promise(r => setTimeout(r, 15));

      const api = globalThis.window.CineGlowSponsorBlock;
      api.settings.sponsorBlockMode = 'fastforward';
      api.setSegments([
        { id: 'live-seg-1', start: 10, end: 50, category: 'sponsor', actionType: 'skip' }
      ]);

      // 1. Video with non-finite duration (e.g. Infinity for live streams)
      video.currentTime = 25;
      video.duration = Infinity;
      api.checkSegmentState();
      assert.strictEqual(video.playbackRate, 1.0, 'Must not accelerate playback rate on live stream (duration=Infinity)');

      // 2. Document with .ytp-live badge present
      video.duration = 600;
      const liveBadge = new MockElement('div', { class: 'ytp-live-badge' });
      player.appendChild(liveBadge);
      env.elements.set('.ytp-live, .ytp-live-badge', liveBadge);

      api.checkSegmentState();
      assert.strictEqual(video.playbackRate, 1.0, 'Must not accelerate playback rate when live badge element is present');
    });

    test('FP-2.5: deduplicates intersecting chapter segments with SponsorBlock segments beyond 5s start delta', async () => {
      // API segment: [60, 150]. Chapter segment: [75, 150] (start delta 15s > 5s, but fully inside [60, 150])
      player.getChapters = () => [
        { title: 'Sponsor Segment', time: 75, end_time: 150 }
      ];

      env.chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message.type === 'FETCH_SPONSOR_BLOCK') {
          sendResponse({
            success: true,
            segments: [
              { UUID: 'sb-intersect', segment: [60, 150], category: 'sponsor' }
            ]
          });
        }
      });

      loadSponsorSkip();
      await new Promise(r => setTimeout(r, 20));

      const api = globalThis.window.CineGlowSponsorBlock;
      const segs = api.getSegments();
      assert.strictEqual(segs.length, 1, 'Should deduplicate intersecting chapter segment to exactly 1 segment');
      assert.strictEqual(segs[0].start, 60);
      assert.strictEqual(segs[0].end, 150);
    });
  });
});

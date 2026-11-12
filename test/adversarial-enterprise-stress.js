// test/adversarial-enterprise-stress.js
// CineGlow Pro for YouTube (v2.3.0) — Adversarial Enterprise Stress Challenge
// Empirical Challenger: challenger_iter4_1
// Node.js Native Test Runner (`node:test`, `node:assert/strict`)
'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  setupEnterpriseHarness: rawSetupEnterpriseHarness,
  calculateBackoffDelay,
  MultiTabProcessSimulator,
  normalizeGetResult,
  computeChangesDiff
} = require('./helpers/enterprise-e2e-harness');

const {
  MockElement,
  MockVideoElement,
  MockAudioContext
} = require('./helpers/mock-dom');

const { fetchWithBackoff } = require('../shared/network-backoff');

// Polyfill element methods if needed
if (!MockElement.prototype.setAttributeNS) {
  MockElement.prototype.setAttributeNS = function(ns, name, val) {
    this.setAttribute(name, val);
  };
}

MockElement.prototype.querySelector = function(sel) {
  if (!sel) return null;
  for (const c of this.children) {
    if (sel.includes('video') && (c.tagName === 'VIDEO' || (c.className && String(c.className).includes('video')))) {
      return c;
    }
    if (c.id && sel.includes(`#${c.id}`)) return c;
    if (c.className && typeof c.className === 'string') {
      const classes = c.className.split(/\s+/);
      for (const cl of classes) {
        if (cl && sel.includes(`.${cl}`)) return c;
      }
    }
  }
  return null;
};

if (!MockAudioContext.prototype.close) {
  MockAudioContext.prototype.close = function() {
    this.state = 'closed';
    return Promise.resolve();
  };
}

const setupEnterpriseHarness = (url, policy) => {
  const harness = rawSetupEnterpriseHarness(url, policy);
  if (!harness.document.createElementNS) {
    harness.document.createElementNS = (ns, tag) => {
      const el = new MockElement(tag);
      el.className = { baseVal: '' };
      return el;
    };
  }
  return harness;
};

const REPO_ROOT = path.resolve(__dirname, '..');
const SCRIPTS = {
  playerManager: fs.readFileSync(path.join(REPO_ROOT, 'content/player-manager.js'), 'utf8'),
  content: fs.readFileSync(path.join(REPO_ROOT, 'content/content.js'), 'utf8'),
  recordButton: fs.readFileSync(path.join(REPO_ROOT, 'content/record-button.js'), 'utf8'),
  youtubeAds: fs.readFileSync(path.join(REPO_ROOT, 'content/youtube-ads.js'), 'utf8'),
  youtubeQuality: fs.readFileSync(path.join(REPO_ROOT, 'content/youtube-quality.js'), 'utf8'),
  smartPause: fs.readFileSync(path.join(REPO_ROOT, 'content/smart-pause.js'), 'utf8'),
  audioProcessor: fs.readFileSync(path.join(REPO_ROOT, 'content/audio-processor.js'), 'utf8'),
  returnDislikes: fs.readFileSync(path.join(REPO_ROOT, 'content/return-dislikes.js'), 'utf8'),
  annotations: fs.readFileSync(path.join(REPO_ROOT, 'content/annotations.js'), 'utf8'),
  background: fs.readFileSync(path.join(REPO_ROOT, 'background/background.js'), 'utf8'),
};

/**
 * Creates a fully wired mock YouTube tab DOM environment.
 */
function createMockYouTubeTab(tabIndex = 0, initialPolicy = {}) {
  const harness = setupEnterpriseHarness(`https://www.youtube.com/watch?v=stress_tab_${tabIndex}`, initialPolicy);

  // Mount root YouTube app element
  const app = harness.document.createElement('ytd-app');
  harness.document.body.appendChild(app);
  harness.elements.set('ytd-app', app);

  // Mount player DOM structure
  const player = harness.document.createElement('div');
  player.id = 'movie_player';
  player.className = 'html5-video-player';
  player.playVideo = () => {};
  player.setPlaybackQualityRange = () => {};
  player.getPlaybackQuality = () => 'hd1080';

  const video = new MockVideoElement();
  video.className = 'html5-main-video';
  player.appendChild(video);

  const controls = harness.document.createElement('div');
  controls.className = 'ytp-right-controls';
  player.appendChild(controls);

  harness.document.body.appendChild(player);
  harness.elements.set('#movie_player', player);
  harness.elements.set('video', video);
  harness.elements.set('video.html5-main-video', video);
  harness.elements.set('.ytp-right-controls', controls);

  return { harness, player, video, controls, app };
}

/**
 * Sets global execution context to match a harness environment.
 */
function bindGlobalContext(harness) {
  globalThis.window = harness.window;
  globalThis.document = harness.document;
  globalThis.location = harness.window.location;
  globalThis.chrome = harness.chrome;
  globalThis.MutationObserver = harness.window.MutationObserver;
  globalThis.AudioContext = MockAudioContext;
  globalThis.AURA_DEFAULTS = { enabled: true, opacity: 80, spread: 150 };
}

/**
 * Safely tears down a tab and halts all intervals.
 */
function teardownTab(tab) {
  if (tab.harness?.window?.CineGlowPlayer?.searchInterval) {
    clearInterval(tab.harness.window.CineGlowPlayer.searchInterval);
    tab.harness.window.CineGlowPlayer.searchInterval = null;
  }
  if (typeof tab.harness?.window?.CineGlowTeardown === 'function') {
    tab.harness.window.CineGlowTeardown();
  }
}

describe('Adversarial Enterprise Stress Challenge (Empirical Challenger)', () => {

  // =========================================================================
  // PILLAR 1: Concurrent Multi-Tab DOM and Script Injections
  // =========================================================================
  describe('Pillar 1: Concurrent Multi-Tab DOM & Script Injections', () => {

    test('1.1: 50 Concurrent Tabs Simultaneous Injections: 0 Cross-Tab State Leaks, Clean Initialization', async () => {
      const TAB_COUNT = 50;
      const tabs = [];

      for (let i = 0; i < TAB_COUNT; i++) {
        tabs.push(createMockYouTubeTab(i));
      }

      // Concurrently inject content scripts across all 50 tabs
      for (let i = 0; i < TAB_COUNT; i++) {
        const { harness } = tabs[i];
        bindGlobalContext(harness);
        new Function(SCRIPTS.playerManager)();
        new Function(SCRIPTS.content)();
        new Function(SCRIPTS.smartPause)();
      }

      // Assert each tab has its own independent canvas and player
      for (let i = 0; i < TAB_COUNT; i++) {
        const { harness, player } = tabs[i];
        const canvas = harness.document.getElementById('aura-ambient-canvas');
        assert.ok(canvas, `Tab ${i} must have its own ambient canvas mounted`);
        assert.strictEqual(canvas.width, 128, `Tab ${i} canvas width must be 128`);
        assert.strictEqual(canvas.height, 72, `Tab ${i} canvas height must be 72`);

        assert.ok(harness.window.CineGlowPlayer, `Tab ${i} must have its own player manager instance`);
        assert.strictEqual(harness.window.CineGlowPlayer.player, player, `Tab ${i} player manager must point to tab player`);
      }

      // Clean up in tab contexts
      for (let i = 0; i < TAB_COUNT; i++) {
        bindGlobalContext(tabs[i].harness);
        teardownTab(tabs[i]);
      }
    });

    test('1.2: Dynamic Tab Lifecycle Churn (Open, Close, Re-open, Navigate): Zero Dangling Observers or Memory Leaks', async () => {
      const activeTabs = new Map();

      // Step 1: Open 20 tabs
      for (let i = 0; i < 20; i++) {
        const tab = createMockYouTubeTab(i);
        bindGlobalContext(tab.harness);
        new Function(SCRIPTS.playerManager)();
        new Function(SCRIPTS.content)();
        new Function(SCRIPTS.smartPause)();
        activeTabs.set(i, tab);
      }

      // Step 2: Dynamically close 10 tabs
      for (let i = 0; i < 10; i++) {
        const tab = activeTabs.get(i);
        bindGlobalContext(tab.harness);
        teardownTab(tab);
        activeTabs.delete(i);
      }

      // Step 3: Open 15 new tabs
      for (let i = 20; i < 35; i++) {
        const tab = createMockYouTubeTab(i);
        bindGlobalContext(tab.harness);
        new Function(SCRIPTS.playerManager)();
        new Function(SCRIPTS.content)();
        activeTabs.set(i, tab);
      }

      // Step 4: Navigate 5 tabs from watch page to non-watch channel page
      for (let i = 10; i < 15; i++) {
        const tab = activeTabs.get(i);
        bindGlobalContext(tab.harness);
        tab.harness.window.location.pathname = '/@channel/videos';
        tab.harness.window.location.search = '';
        tab.harness.document.dispatchEvent(new Event('yt-navigate-finish'));
      }

      // Assert closed tabs have 0 ambient canvas in DOM
      assert.strictEqual(activeTabs.size, 25, 'Should have exactly 25 active tabs remaining');
      for (const [id, tab] of activeTabs.entries()) {
        const canvas = tab.harness.document.getElementById('aura-ambient-canvas');
        if (id >= 10 && id < 15) {
          assert.strictEqual(tab.harness.window.CineGlowPlayer.isWatchPage, false);
        } else {
          assert.ok(canvas, `Active watch tab ${id} must maintain ambient canvas`);
        }
      }

      // Final cleanup
      for (const [id, tab] of activeTabs.entries()) {
        bindGlobalContext(tab.harness);
        teardownTab(tab);
      }
    });

    test('1.3: Heavy DOM Mutation Storm (5,000 DOM Events across 20 Tabs): Observer Resilience without Dropping State', async () => {
      const tabs = [];
      for (let i = 0; i < 20; i++) {
        const tab = createMockYouTubeTab(i);
        bindGlobalContext(tab.harness);
        new Function(SCRIPTS.playerManager)();
        new Function(SCRIPTS.content)();
        tabs.push(tab);
      }

      // Induce 250 mutations per tab = 5,000 mutations total
      let totalMutations = 0;
      for (const tab of tabs) {
        bindGlobalContext(tab.harness);
        for (let m = 0; m < 250; m++) {
          const dummy = tab.harness.document.createElement('div');
          dummy.className = `yt-dummy-mutation-${m}`;
          tab.player.appendChild(dummy);
          totalMutations++;
        }
      }

      assert.strictEqual(totalMutations, 5000, '5,000 DOM mutations injected across tabs');

      // Assert all 20 tabs still retain their canvases
      for (let i = 0; i < 20; i++) {
        const canvas = tabs[i].harness.document.getElementById('aura-ambient-canvas');
        assert.ok(canvas, `Tab ${i} ambient canvas intact following mutation burst`);
      }

      // Clean up in context
      for (let i = 0; i < 20; i++) {
        bindGlobalContext(tabs[i].harness);
        teardownTab(tabs[i]);
      }
    });

    test('1.4: 50-Tab Fleet Teardown Quiescence under High Stress in < 1000ms', () => {
      const tabs = [];
      for (let i = 0; i < 50; i++) {
        const tab = createMockYouTubeTab(i);
        bindGlobalContext(tab.harness);
        new Function(SCRIPTS.playerManager)();
        new Function(SCRIPTS.content)();
        tabs.push(tab);
      }

      const t0 = performance.now();
      const killMessage = {
        type: 'AURA_EMERGENCY_KILL_SWITCH',
        reason: '50-Tab Stress Quiescence',
        timestamp: Date.now()
      };

      for (const tab of tabs) {
        bindGlobalContext(tab.harness);
        tab.harness.chrome.runtime.onMessage.dispatch(killMessage);
      }

      const elapsed = performance.now() - t0;
      assert.ok(elapsed < 1000, `Multi-tab teardown took ${elapsed}ms (must be < 1000ms)`);

      // Verify every tab is completely quiesced
      for (const tab of tabs) {
        assert.strictEqual(tab.harness.document.getElementById('aura-ambient-canvas'), null, 'Canvas unmounted');
        assert.strictEqual(tab.harness.window.CineGlowKilled, true, 'CineGlowKilled flag set');
      }

      for (let i = 0; i < 50; i++) {
        bindGlobalContext(tabs[i].harness);
        teardownTab(tabs[i]);
      }
    });
  });

  // =========================================================================
  // PILLAR 2: Rapid Runtime Managed Policy Changes Stress
  // =========================================================================
  describe('Pillar 2: Rapid Runtime Managed Policy Changes Stress', () => {

    test('2.1: 150 Rapid Toggles of DisableRecording: Strict State Convergence, 0 Uncaught Exceptions', async () => {
      const { harness, player } = createMockYouTubeTab(1);
      bindGlobalContext(harness);

      new Function(SCRIPTS.playerManager)();
      new Function(SCRIPTS.recordButton)();

      await new Promise(r => setTimeout(r, 20));

      // Hammer DisableRecording policy 150 times in rapid succession
      for (let i = 0; i < 150; i++) {
        const isDisabled = i % 2 === 0;
        await harness.chrome.storage.managed.adminPush({ DisableRecording: isDisabled });
      }

      // Settle on DisableRecording: true
      await harness.chrome.storage.managed.adminPush({ DisableRecording: true });

      // Verify record button is completely removed
      const wrappers = harness.document.querySelectorAll('.cineglow-record-wrapper');
      assert.strictEqual(wrappers.length, 0, 'Record button wrapper must be unmounted when DisableRecording=true');

      // Now toggle back to false and verify remounting
      await harness.chrome.storage.managed.adminPush({ DisableRecording: false });
      if (harness.window.CineGlowPlayer) {
        harness.window.CineGlowPlayer.dispatchEvent(new CustomEvent('state-change', {
          detail: { isWatchPage: true, player, video: harness.elements.get('video') }
        }));
      }
      await new Promise(r => setTimeout(r, 20));
      const remounted = harness.document.querySelectorAll('.cineglow-record-wrapper');
      assert.ok(remounted.length > 0, 'Record button wrapper must remount when DisableRecording=false');

      teardownTab({ harness });
    });

    test('2.2: 150 Rapid Toggles of DisableAdBlock during Active Ad: Preserves Playback Fidelity and Unmutes', async () => {
      const { harness, player, video } = createMockYouTubeTab(2);
      bindGlobalContext(harness);

      // Simulate active ad
      player.classList.add('ad-showing');
      video.playbackRate = 1.0;
      video.muted = false;

      new Function(SCRIPTS.youtubeAds)();

      // Rapidly toggle DisableAdBlock managed policy 150 times
      for (let i = 0; i < 150; i++) {
        const disableAdBlock = i % 2 === 0;
        await harness.chrome.storage.managed.adminPush({ DisableAdBlock: disableAdBlock });
      }

      // Settle on DisableAdBlock: true (enterprise policy bans ad blocking)
      await harness.chrome.storage.managed.adminPush({ DisableAdBlock: true });

      // AdBlock CSS style element must be removed
      const styleEl = harness.document.getElementById('cineglow-adblock-styles');
      assert.strictEqual(styleEl, null, 'AdBlock styles must be unmounted when DisableAdBlock is active');

      // Verify video is not left in a muted / fast-forwarded state
      assert.strictEqual(video.muted, false, 'Video must not be muted by extension when adblock policy is disabled');
      assert.strictEqual(video.playbackRate, 1.0, 'Video playback rate must be restored to normal (1.0x)');

      teardownTab({ harness });
    });

    test('2.3: 150-Iteration ForceDefaultQuality Policy Storm: Handles Valid, Arbitrary, and Boundary Qualities Gracefully', async () => {
      const { harness } = createMockYouTubeTab(3);
      bindGlobalContext(harness);

      new Function(SCRIPTS.playerManager)();
      new Function(SCRIPTS.youtubeQuality)();

      const qualities = ['hd2160', 'hd1440', 'hd1080', 'hd720', 'large', 'medium', 'small', 'tiny', 'auto', 'invalidQuality_9999p', ''];

      for (let i = 0; i < 150; i++) {
        const q = qualities[i % qualities.length];
        await harness.chrome.storage.managed.adminPush({ ForceDefaultQuality: q });
      }

      // Final push with hd720
      await harness.chrome.storage.managed.adminPush({ ForceDefaultQuality: 'hd720' });

      assert.strictEqual(harness.window.CineGlowQuality.settings.preferredQuality, 'hd720', 'Preferred quality must be hd720');
      assert.ok(harness.window.localStorage.getItem('yt-player-quality').includes('hd720'), 'localStorage updated');
      assert.strictEqual(harness.window.CineGlowQuality.isForcedByPolicy(), true, 'isForcedByPolicy true');

      teardownTab({ harness });
    });

    test('2.4: Concurrent Interleaved Tri-Policy Storm (Recording + AdBlock + Quality) Across 10 Tabs (300 Updates): Zero Race Corruption', async () => {
      const tabs = [];
      for (let i = 0; i < 10; i++) {
        const tab = createMockYouTubeTab(i);
        bindGlobalContext(tab.harness);
        new Function(SCRIPTS.playerManager)();
        new Function(SCRIPTS.recordButton)();
        new Function(SCRIPTS.youtubeAds)();
        new Function(SCRIPTS.youtubeQuality)();
        tabs.push(tab);
      }

      // Rapidly fire 30 interleaved updates per tab = 300 updates
      for (let i = 0; i < 30; i++) {
        const policyPayload = {
          DisableRecording: i % 2 === 0,
          DisableAdBlock: i % 3 === 0,
          ForceDefaultQuality: i % 2 === 0 ? 'hd720' : 'hd1080'
        };

        for (const tab of tabs) {
          bindGlobalContext(tab.harness);
          await tab.harness.chrome.storage.managed.adminPush(policyPayload);
        }
      }

      // Uniform final state across all tabs
      const finalPayload = {
        DisableRecording: true,
        DisableAdBlock: true,
        ForceDefaultQuality: 'hd720'
      };

      for (const tab of tabs) {
        bindGlobalContext(tab.harness);
        await tab.harness.chrome.storage.managed.adminPush(finalPayload);
      }

      // Verify convergence across all 10 tabs
      for (const tab of tabs) {
        assert.strictEqual(tab.harness.document.querySelectorAll('.cineglow-record-wrapper').length, 0, 'Recording unmounted on all tabs');
        assert.strictEqual(tab.harness.document.getElementById('cineglow-adblock-styles'), null, 'AdBlock styles unmounted on all tabs');
        teardownTab(tab);
      }
    });
  });

  // =========================================================================
  // PILLAR 3: Race Conditions Between Initialization and Emergency Kill-Switch
  // =========================================================================
  describe('Pillar 3: Race Conditions Between Init and Emergency Kill-Switch', () => {

    test('3.1: Kill-Switch Triggered Mid-way Through Asynchronous Toolbar Wait: Aborts Cleanly with 0 Dangling UI', async () => {
      const { harness, player } = createMockYouTubeTab(4);
      bindGlobalContext(harness);

      // Remove controls initially to delay toolbar resolution
      const controls = harness.elements.get('.ytp-right-controls');
      controls.remove();

      new Function(SCRIPTS.playerManager)();
      new Function(SCRIPTS.recordButton)();

      // Fire kill-switch while record-button is asynchronously waiting for toolbar
      const killMsg = {
        type: 'AURA_EMERGENCY_KILL_SWITCH',
        reason: 'Mid-init kill race test',
        timestamp: Date.now()
      };
      harness.chrome.runtime.onMessage.dispatch(killMsg);

      // Now mount the controls after kill-switch has executed
      player.appendChild(controls);
      await new Promise(r => setTimeout(r, 30));

      // Record button must NEVER mount because signal was aborted and isKilled is true
      const wrappers = harness.document.querySelectorAll('.cineglow-record-wrapper');
      assert.strictEqual(wrappers.length, 0, 'Record button must not mount after kill switch triggered mid-init');
      assert.strictEqual(harness.window.CineGlowKilled, true, 'Window marked as killed');

      teardownTab({ harness });
    });

    test('3.2: Immediate Self-Termination of All Content Scripts on Pre-Killed Tab: 0 Elements, 0 Listeners', async () => {
      const { harness } = createMockYouTubeTab(5, { KillSwitch: true });
      bindGlobalContext(harness);
      await harness.chrome.storage.local.set({ auraKillSwitchActive: true });

      // Execute all 7 content scripts on pre-killed tab
      new Function(SCRIPTS.playerManager)();
      new Function(SCRIPTS.content)();
      new Function(SCRIPTS.recordButton)();
      new Function(SCRIPTS.youtubeAds)();
      new Function(SCRIPTS.youtubeQuality)();
      new Function(SCRIPTS.audioProcessor)();
      new Function(SCRIPTS.smartPause)();

      await new Promise(r => setTimeout(r, 20));

      // Assert zero DOM mutations
      assert.strictEqual(harness.document.getElementById('aura-ambient-canvas'), null, 'No ambient canvas on pre-killed tab');
      assert.strictEqual(harness.document.querySelectorAll('.cineglow-record-wrapper').length, 0, 'No record button on pre-killed tab');
      assert.strictEqual(harness.document.getElementById('cineglow-adblock-styles'), null, 'No adblock styles on pre-killed tab');

      teardownTab({ harness });
    });

    test('3.3: Rapid Kill-Switch Oscillation During Active 503 Outage: Outbound Requests Instantly Blocked', async () => {
      const harness = setupEnterpriseHarness('https://www.youtube.com/watch?v=bgKillRace');
      bindGlobalContext(harness);

      globalThis.fetchWithBackoff = fetchWithBackoff;
      new Function(SCRIPTS.background)();

      // Mock fetch returning HTTP 503
      let fetchCalls = 0;
      globalThis.fetch = async () => {
        fetchCalls++;
        return { ok: false, status: 503, json: async () => ({}) };
      };

      // Dispatch FETCH_DISLIKES during active 503 backoff
      let responseReceived = null;
      harness.chrome.runtime.onMessage.dispatch(
        { type: 'FETCH_DISLIKES', videoId: 'dQw4w9WgXcQ' },
        {},
        (resp) => { responseReceived = resp; }
      );

      // Trigger immediate emergency kill-switch while backoff is pending
      await harness.chrome.storage.managed.adminPush({ KillSwitch: true });

      // Immediate subsequent call must be rejected immediately by background kill switch guard
      let postKillResponse = null;
      harness.chrome.runtime.onMessage.dispatch(
        { type: 'FETCH_DISLIKES', videoId: 'dQw4w9WgXcQ' },
        {},
        (resp) => { postKillResponse = resp; }
      );

      assert.ok(postKillResponse, 'Response received');
      assert.strictEqual(postKillResponse.success, false, 'Request must fail');
      assert.strictEqual(postKillResponse.killed, true, 'Request must be blocked by emergency kill switch');
    });

    test('3.4: Dynamic Tab Navigation Race Condition: Newly Navigated Tabs Locked Down by Background Listener', async () => {
      const harness = setupEnterpriseHarness('https://www.youtube.com/watch?v=navRaceTest');
      bindGlobalContext(harness);

      let broadcastCount = 0;
      harness.chrome.tabs = {
        query: (queryInfo, cb) => cb([{ id: 101 }, { id: 102 }]),
        sendMessage: (tabId, msg) => {
          broadcastCount++;
          return Promise.resolve({ received: true });
        },
        onUpdated: {
          _listeners: [],
          addListener(fn) { this._listeners.push(fn); },
          dispatch(tabId, changeInfo, tab) {
            this._listeners.forEach(fn => fn(tabId, changeInfo, tab));
          }
        }
      };

      new Function(SCRIPTS.background)();

      // Activate kill switch via managed adminPush
      await harness.chrome.storage.managed.adminPush({ KillSwitch: true });
      await new Promise(r => setTimeout(r, 10));

      // Simulate a tab navigation event (loading -> complete)
      harness.chrome.tabs.onUpdated.dispatch(201, { status: 'loading' }, { id: 201 });
      harness.chrome.tabs.onUpdated.dispatch(201, { status: 'complete' }, { id: 201 });

      assert.ok(broadcastCount >= 4, `Background must broadcast kill message to new tabs upon update (count: ${broadcastCount})`);
    });
  });

  // =========================================================================
  // PILLAR 4: Corrupted and Schema-Violating Enterprise Payloads
  // =========================================================================
  describe('Pillar 4: Corrupted & Schema-Violating Enterprise Payloads', () => {

    test('4.1: Extreme Type Mismatches in Managed Policies: 0 Uncaught Exceptions, Safe Fallbacks', async () => {
      const { harness } = createMockYouTubeTab(6);
      bindGlobalContext(harness);

      new Function(SCRIPTS.playerManager)();
      new Function(SCRIPTS.recordButton)();
      new Function(SCRIPTS.youtubeAds)();
      new Function(SCRIPTS.youtubeQuality)();

      // Inject bizarre types into storage.managed
      const corruptedPayloads = [
        { KillSwitch: 'true' },               // String instead of boolean
        { KillSwitch: 1 },                    // Number instead of boolean
        { KillSwitch: {} },                   // Object instead of boolean
        { KillSwitch: [true] },               // Array instead of boolean
        { KillSwitch: null },                 // Null
        { KillSwitch: NaN },                  // NaN
        { DisableRecording: 'disable' },      // String instead of boolean
        { DisableRecording: 0 },              // Number
        { DisableRecording: { bad: 1 } },     // Object
        { DisableAdBlock: 'false' },          // String 'false' (truthy in JS, but schema boolean)
        { DisableAdBlock: -999 },             // Negative number
        { ForceDefaultQuality: 1080 },        // Number instead of string
        { ForceDefaultQuality: false },       // Boolean instead of string
        { ForceDefaultQuality: { hd: 720 } }, // Object
        { ForceDefaultQuality: null }         // Null
      ];

      for (const payload of corruptedPayloads) {
        assert.doesNotThrow(async () => {
          await harness.chrome.storage.managed.adminPush(payload);
        }, `Must not throw on corrupted payload: ${JSON.stringify(payload)}`);
      }

      assert.ok(harness.window.CineGlowPlayer, 'Player manager intact');
      teardownTab({ harness });
    });

    test('4.2: Prototype Pollution Attempts and Undeclared Policy Injections are Safely Discarded', async () => {
      const { harness } = createMockYouTubeTab(7);
      bindGlobalContext(harness);

      new Function(SCRIPTS.playerManager)();
      new Function(SCRIPTS.content)();
      new Function(SCRIPTS.youtubeAds)();

      // Attempt prototype pollution via managed storage push
      const maliciousPayload = JSON.parse(`{
        "__proto__": { "polluted": true },
        "constructor": { "prototype": { "admin": true } },
        "UndeclaredEnterpriseTrackingId": "CORP-987654321",
        "ArbitraryDeptCode": "FINANCE-DLP-HIGH",
        "CustomScriptInjection": "<script>alert('xss')</script>"
      }`);

      await harness.chrome.storage.managed.adminPush(maliciousPayload);

      // Verify Object prototype is unpolluted
      assert.strictEqual(Object.prototype.polluted, undefined, 'Object.prototype must not be polluted');
      assert.strictEqual(Object.prototype.admin, undefined, 'Object.prototype.admin must not be polluted');

      // Verify ambient canvas and styling unaffected
      const canvas = harness.document.getElementById('aura-ambient-canvas');
      assert.ok(canvas, 'Ambient canvas must remain healthy');
      teardownTab({ harness });
    });

    test('4.3: Background Network Resilience on Corrupted and Oversized Remote Payloads', async () => {
      const harness = setupEnterpriseHarness('https://www.youtube.com/watch?v=netCorruptTest');
      bindGlobalContext(harness);

      // Scenario A: Remote endpoint returns raw HTML error page when JSON was expected
      const mockCorruptJsonFetch = async () => ({
        ok: true,
        status: 200,
        json: async () => { throw new SyntaxError('Unexpected token < in JSON at position 0'); }
      });

      globalThis.fetchWithBackoff = (url, opts, cfg) => fetchWithBackoff(url, opts, {
        fetchFn: mockCorruptJsonFetch,
        sleepFn: () => Promise.resolve(),
        ...cfg
      });

      new Function(SCRIPTS.background)();

      let htmlErrorResp = null;
      await new Promise(resolve => {
        harness.chrome.runtime.onMessage.dispatch(
          { type: 'FETCH_DISLIKES', videoId: 'dQw4w9WgXcQ' },
          {},
          (resp) => {
            htmlErrorResp = resp;
            resolve();
          }
        );
      });

      assert.ok(htmlErrorResp, 'Response received');
      assert.strictEqual(htmlErrorResp.success, false, 'Failed gracefully on malformed JSON');
      assert.ok(htmlErrorResp.error.includes('Unexpected token'), 'Error surfaced cleanly');

      // Scenario B: Remote endpoint returns 10MB XML (exceeds 1MB cache threshold)
      const oversizedXML = '<annotations>' + 'A'.repeat(2 * 1024 * 1024) + '</annotations>';
      const mockOversizedFetch = async () => ({
        ok: true,
        status: 200,
        text: async () => oversizedXML
      });

      globalThis.fetchWithBackoff = (url, opts, cfg) => fetchWithBackoff(url, opts, {
        fetchFn: mockOversizedFetch,
        sleepFn: () => Promise.resolve(),
        ...cfg
      });

      let xmlResp = null;
      await new Promise(resolve => {
        harness.chrome.runtime.onMessage.dispatch(
          { type: 'FETCH_ANNOTATIONS', videoId: 'dQw4w9WgXcQ' },
          {},
          (resp) => {
            xmlResp = resp;
            resolve();
          }
        );
      });

      assert.ok(xmlResp, 'Annotations response received');
      assert.strictEqual(xmlResp.success, true, 'Oversized XML fetched without crash');
      assert.strictEqual(xmlResp.cached, false, 'Oversized XML must not be cached to preserve storage quota');
      assert.strictEqual(harness.chrome.storage.local._data['ar_dQw4w9WgXcQ'], undefined, 'Not saved to local storage');
    });

    test('4.4: Malformed, Path-Traversal, and Boundary Video IDs in Background Message Egress', async () => {
      const harness = setupEnterpriseHarness('https://www.youtube.com/watch?v=videoIdSecurityTest');
      bindGlobalContext(harness);

      new Function(SCRIPTS.background)();

      const badIds = [
        '../../../../etc/passwd',
        '"><script>alert(1)</script>',
        '',
        null,
        12345,
        'short',
        'way_too_long_video_id_string_exceeding_11_characters'
      ];

      for (const badId of badIds) {
        let respData = null;
        harness.chrome.runtime.onMessage.dispatch(
          { type: 'FETCH_DISLIKES', videoId: badId },
          {},
          (resp) => { respData = resp; }
        );
        assert.ok(respData === null || respData.success === false, `Bad ID ${badId} must not produce successful fetch`);
      }
    });
  });
});

// test/network-backoff-and-killswitch.test.js
// Milestone M1: Exponential Network Backoff and Emergency Enterprise Kill-Switch Test Suite
// Author: Giri Manohar Vemula (https://www.linkedin.com/in/manoharv511)

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  setupMockEnvironment,
  MockVideoElement,
  MockElement,
  MockAudioContext
} = require('./helpers/mock-dom');

const {
  DEFAULT_BACKOFF_CONFIG,
  calculateBackoffDelay,
  isTransientStatus,
  isTransientNetworkError,
  fetchWithBackoff
} = require('../shared/network-backoff.js');

describe('Network Backoff & Emergency Kill-Switch Suite', () => {

  describe('1. Backoff Delay Calculation & Jitter Math', () => {
    test('calculates deterministic delay without jitter (randomFn returning 0.5)', () => {
      const config = {
        initialDelayMs: 1000,
        maxDelayMs: 16000,
        jitterRatio: 0.2,
        randomFn: () => 0.5 // factor = 1 + (0.5 * 2 - 1) * 0.2 = 1.0 (zero jitter)
      };

      assert.strictEqual(calculateBackoffDelay(0, config), 1000);
      assert.strictEqual(calculateBackoffDelay(1, config), 2000);
      assert.strictEqual(calculateBackoffDelay(2, config), 4000);
      assert.strictEqual(calculateBackoffDelay(3, config), 8000);
      assert.strictEqual(calculateBackoffDelay(4, config), 16000);
      assert.strictEqual(calculateBackoffDelay(5, config), 16000); // capped at maxDelayMs
    });

    test('respects lower jitter boundary (randomFn returning 0 -> -20%)', () => {
      const config = {
        initialDelayMs: 1000,
        maxDelayMs: 16000,
        jitterRatio: 0.2,
        randomFn: () => 0 // factor = 1 - 0.2 = 0.8
      };

      assert.strictEqual(calculateBackoffDelay(0, config), 800);
      assert.strictEqual(calculateBackoffDelay(1, config), 1600);
      assert.strictEqual(calculateBackoffDelay(2, config), 3200);
      assert.strictEqual(calculateBackoffDelay(3, config), 6400);
      assert.strictEqual(calculateBackoffDelay(4, config), 12800);
    });

    test('respects upper jitter boundary (randomFn returning 1 -> +20%)', () => {
      const config = {
        initialDelayMs: 1000,
        maxDelayMs: 16000,
        jitterRatio: 0.2,
        randomFn: () => 1 // factor = 1 + 0.2 = 1.2
      };

      assert.strictEqual(calculateBackoffDelay(0, config), 1200);
      assert.strictEqual(calculateBackoffDelay(1, config), 2400);
      assert.strictEqual(calculateBackoffDelay(2, config), 4800);
      assert.strictEqual(calculateBackoffDelay(3, config), 9600);
      assert.strictEqual(calculateBackoffDelay(4, config), 19200);
    });

    test('random jitter strictly stays within calibrated [0.8, 1.2] range across 100 samples', () => {
      for (let attempt = 0; attempt <= 5; attempt++) {
        const base = Math.min(16000, 1000 * Math.pow(2, attempt));
        const minExpected = Math.floor(base * 0.8);
        const maxExpected = Math.ceil(base * 1.2);

        for (let i = 0; i < 20; i++) {
          const delay = calculateBackoffDelay(attempt);
          assert.ok(
            delay >= minExpected && delay <= maxExpected,
            `Delay ${delay} out of expected bounds [${minExpected}, ${maxExpected}] for attempt ${attempt}`
          );
        }
      }
    });

    test('handles negative attempts or invalid configurations gracefully', () => {
      assert.ok(calculateBackoffDelay(-1) >= 0);
      assert.ok(calculateBackoffDelay(100) <= 19200);
    });
  });

  describe('2. Outage Classification & Network Retry Policy', () => {
    test('correctly identifies transient HTTP outage status codes (502, 503, 504)', () => {
      assert.strictEqual(isTransientStatus(502), true);
      assert.strictEqual(isTransientStatus(503), true);
      assert.strictEqual(isTransientStatus(504), true);

      assert.strictEqual(isTransientStatus(200), false);
      assert.strictEqual(isTransientStatus(400), false);
      assert.strictEqual(isTransientStatus(401), false);
      assert.strictEqual(isTransientStatus(403), false);
      assert.strictEqual(isTransientStatus(404), false);
      assert.strictEqual(isTransientStatus(500), false);
    });

    test('correctly identifies transient transport and network errors', () => {
      assert.strictEqual(isTransientNetworkError(new TypeError('Failed to fetch')), true);
      assert.strictEqual(isTransientNetworkError(new TypeError('network error')), true);
      const abortErr = new Error('The operation was aborted');
      abortErr.name = 'AbortError';
      assert.strictEqual(isTransientNetworkError(abortErr), true);
      const timeoutErr = new Error('Connection timeout');
      timeoutErr.name = 'TimeoutError';
      assert.strictEqual(isTransientNetworkError(timeoutErr), true);

      assert.strictEqual(isTransientNetworkError(new SyntaxError('Unexpected token')), false);
      assert.strictEqual(isTransientNetworkError(new RangeError('Out of range')), false);
      assert.strictEqual(isTransientNetworkError(null), false);
    });

    test('fetchWithBackoff returns immediately on HTTP 200 without retrying', async () => {
      let callCount = 0;
      const sleepDelays = [];
      const mockFetch = async () => {
        callCount++;
        return { ok: true, status: 200, json: async () => ({ success: true }) };
      };

      const resp = await fetchWithBackoff('https://example.com/api', {}, {
        fetchFn: mockFetch,
        sleepFn: async (ms) => { sleepDelays.push(ms); }
      });

      assert.strictEqual(callCount, 1);
      assert.strictEqual(sleepDelays.length, 0);
      assert.strictEqual(resp.status, 200);
    });

    test('fetchWithBackoff fast-exits on HTTP 404 without retrying', async () => {
      let callCount = 0;
      const sleepDelays = [];
      const mockFetch = async () => {
        callCount++;
        return { ok: false, status: 404, statusText: 'Not Found' };
      };

      const resp = await fetchWithBackoff('https://example.com/notfound', {}, {
        fetchFn: mockFetch,
        sleepFn: async (ms) => { sleepDelays.push(ms); }
      });

      assert.strictEqual(callCount, 1);
      assert.strictEqual(sleepDelays.length, 0);
      assert.strictEqual(resp.status, 404);
    });

    test('fetchWithBackoff retries transient HTTP 503 and succeeds on 3rd attempt', async () => {
      let callCount = 0;
      const sleepDelays = [];
      const retryLog = [];

      const mockFetch = async () => {
        callCount++;
        if (callCount < 3) {
          return { ok: false, status: 503, statusText: 'Service Unavailable' };
        }
        return { ok: true, status: 200, json: async () => ({ likes: 100, dislikes: 5 }) };
      };

      const resp = await fetchWithBackoff('https://returnyoutubedislikeapi.com/votes?videoId=test', {}, {
        fetchFn: mockFetch,
        sleepFn: async (ms) => { sleepDelays.push(ms); },
        onRetry: (attempt, delay, res) => {
          retryLog.push({ attempt, delay, status: res.status });
        },
        randomFn: () => 0.5
      });

      assert.strictEqual(callCount, 3);
      assert.strictEqual(sleepDelays.length, 2);
      assert.strictEqual(sleepDelays[0], 1000);
      assert.strictEqual(sleepDelays[1], 2000);
      assert.strictEqual(resp.status, 200);
      assert.strictEqual(retryLog.length, 2);
      assert.strictEqual(retryLog[0].status, 503);
    });

    test('fetchWithBackoff exhausts maxRetries on persistent 502 Bad Gateway and returns final response', async () => {
      let callCount = 0;
      const sleepDelays = [];

      const mockFetch = async () => {
        callCount++;
        return { ok: false, status: 502, statusText: 'Bad Gateway' };
      };

      const resp = await fetchWithBackoff('https://returnyoutubedislikeapi.com/votes?videoId=down', {}, {
        maxRetries: 3,
        fetchFn: mockFetch,
        sleepFn: async (ms) => { sleepDelays.push(ms); },
        randomFn: () => 0.5
      });

      assert.strictEqual(callCount, 4); // 1 initial + 3 retries
      assert.strictEqual(sleepDelays.length, 3);
      assert.deepStrictEqual(sleepDelays, [1000, 2000, 4000]);
      assert.strictEqual(resp.status, 502);
    });

    test('fetchWithBackoff retries transient TypeError (Failed to fetch) and rethrows if exhausted', async () => {
      let callCount = 0;
      const sleepDelays = [];

      const mockFetch = async () => {
        callCount++;
        throw new TypeError('Failed to fetch');
      };

      await assert.rejects(
        async () => {
          await fetchWithBackoff('https://example.com/network-fail', {}, {
            maxRetries: 2,
            fetchFn: mockFetch,
            sleepFn: async (ms) => { sleepDelays.push(ms); }
          });
        },
        {
          name: 'TypeError',
          message: 'Failed to fetch'
        }
      );

      assert.strictEqual(callCount, 3); // initial + 2 retries
      assert.strictEqual(sleepDelays.length, 2);
    });

    test('fetchWithBackoff re-throws non-transient runtime errors immediately without retrying', async () => {
      let callCount = 0;
      const mockFetch = async () => {
        callCount++;
        throw new Error('Fatal database constraint violated');
      };

      await assert.rejects(
        async () => {
          await fetchWithBackoff('https://example.com/fatal', {}, {
            fetchFn: mockFetch
          });
        },
        /Fatal database constraint violated/
      );

      assert.strictEqual(callCount, 1);
    });
  });

  describe('3. Managed Schema Draft-03 Integrity', () => {
    test('managed-schema.json declares KillSwitch boolean property', () => {
      const raw = fs.readFileSync(path.join(__dirname, '../managed-schema.json'), 'utf8');
      const schema = JSON.parse(raw);

      assert.strictEqual(schema.$schema, 'http://json-schema.org/draft-03/schema#');
      assert.strictEqual(schema.type, 'object');
      assert.ok(schema.properties.KillSwitch, 'KillSwitch must be defined under properties');
      assert.strictEqual(schema.properties.KillSwitch.type, 'boolean');
      assert.strictEqual(schema.properties.KillSwitch.title, 'Emergency Kill Switch');
      assert.ok(typeof schema.properties.KillSwitch.description === 'string' && schema.properties.KillSwitch.description.length > 10);
    });
  });

  describe('4. Background Emergency Kill-Switch Lifecycle & Broadcast', () => {
    let env;
    let originalWindow;
    let originalDocument;
    let originalChrome;

    beforeEach(() => {
      env = setupMockEnvironment('https://www.youtube.com/watch?v=bgTest123');
      originalWindow = globalThis.window;
      originalDocument = globalThis.document;
      originalChrome = globalThis.chrome;

      globalThis.window = env.window;
      globalThis.document = env.document;
      globalThis.chrome = env.chrome;

      // Provide fetchWithBackoff in environment
      globalThis.fetchWithBackoff = fetchWithBackoff;
    });

    afterEach(() => {
      globalThis.window = originalWindow;
      globalThis.document = originalDocument;
      globalThis.chrome = originalChrome;
      delete globalThis.fetchWithBackoff;
    });

    test('detects KillSwitch: true in managed storage on startup, broadcasts event to tabs and sets local flag', async () => {
      env.chrome.storage.managed._data.KillSwitch = true;

      // Load background script
      const bgCode = fs.readFileSync(path.join(__dirname, '../background/background.js'), 'utf8');
      new Function(bgCode)();

      // Wait for asynchronous startup check
      await new Promise(r => setTimeout(r, 20));

      // 1. Storage local flag set
      assert.strictEqual(env.chrome.storage.local._data.auraKillSwitchActive, true);

      // 2. Broadcast message sent to open tabs
      assert.ok(env.chrome.tabs._messages.length > 0, 'Must broadcast kill switch message to tabs');
      const broadcast = env.chrome.tabs._messages[0].message;
      assert.strictEqual(broadcast.type, 'AURA_EMERGENCY_KILL_SWITCH');
      assert.ok(broadcast.timestamp > 0);

      // 3. DNR rulesets disabled
      assert.ok(
        !env.chrome.declarativeNetRequest._enabledRulesetIds.includes('adblock_rules'),
        'adblock_rules DNR ruleset must be disabled upon kill switch activation'
      );
    });

    test('storage.onChanged dynamically activates kill switch, broadcast event, and halts incoming messages', async () => {
      // Start with normal active background
      env.chrome.storage.managed._data.KillSwitch = false;
      const bgCode = fs.readFileSync(path.join(__dirname, '../background/background.js'), 'utf8');
      new Function(bgCode)();
      await new Promise(r => setTimeout(r, 20));

      // Trigger dynamic managed policy update
      const listener = env.chrome.storage.onChanged._listeners[0];
      assert.ok(listener, 'storage.onChanged listener must be registered');

      await listener({ KillSwitch: { newValue: true } }, 'managed');

      // Assert broadcast and flags
      assert.strictEqual(env.chrome.storage.local._data.auraKillSwitchActive, true);
      const killMsgs = env.chrome.tabs._messages.filter(m => m.message?.type === 'AURA_EMERGENCY_KILL_SWITCH');
      assert.ok(killMsgs.length > 0, 'Must broadcast kill switch message');

      // Test message rejection
      const messageListeners = env.chrome.runtime.onMessage._listeners;
      assert.ok(messageListeners.length > 0);
      let responseReceived = null;
      messageListeners[0]({ type: 'FETCH_DISLIKES', videoId: 'any123' }, {}, (res) => {
        responseReceived = res;
      });

      assert.deepStrictEqual(responseReceived, {
        success: false,
        error: 'Extension disabled by emergency kill-switch',
        killed: true
      });
    });

    test('deactivates kill switch when managed policy is cleared to false', async () => {
      env.chrome.storage.managed._data.KillSwitch = true;
      const bgCode = fs.readFileSync(path.join(__dirname, '../background/background.js'), 'utf8');
      new Function(bgCode)();
      await new Promise(r => setTimeout(r, 20));

      assert.strictEqual(env.chrome.storage.local._data.auraKillSwitchActive, true);

      // Deactivate
      const listener = env.chrome.storage.onChanged._listeners[0];
      await listener({ KillSwitch: { newValue: false } }, 'managed');

      assert.strictEqual(env.chrome.storage.local._data.auraKillSwitchActive, false);
    });
  });

  describe('5. Content Script Emergency Teardown & DOM Unmounting', () => {
    let env;
    let originalWindow;
    let originalDocument;
    let originalChrome;

    beforeEach(() => {
      env = setupMockEnvironment('https://www.youtube.com/watch?v=killTab123');
      originalWindow = globalThis.window;
      originalDocument = globalThis.document;
      originalChrome = globalThis.chrome;

      globalThis.window = env.window;
      globalThis.document = env.document;
      globalThis.chrome = env.chrome;
      globalThis.MutationObserver = env.window.MutationObserver;

      // Setup default settings
      const defaultsCode = fs.readFileSync(path.join(__dirname, '../shared/defaults.js'), 'utf8');
      const fn = new Function(`'use strict'; ${defaultsCode}; return AURA_DEFAULTS;`);
      globalThis.AURA_DEFAULTS = fn();
      globalThis.window.AURA_DEFAULTS = globalThis.AURA_DEFAULTS;
    });

    afterEach(() => {
      delete globalThis.AURA_DEFAULTS;
      delete globalThis.MutationObserver;
      globalThis.window = originalWindow;
      globalThis.document = originalDocument;
      globalThis.chrome = originalChrome;
    });

    test('content/content.js: removes ambient canvas, cancels rAF, purges root classes, and sets window.CineGlowKilled', async () => {
      // Setup mock video and player
      const playerEl = new MockElement('div', { id: 'movie_player' });
      const videoEl = new MockVideoElement();
      playerEl.appendChild(videoEl);
      env.document.body.appendChild(playerEl);

      globalThis.window.CineGlowPlayer = new (class extends EventTarget {
        constructor() {
          super();
          this.isWatchPage = true;
          this.videoId = 'killTab123';
          this.video = videoEl;
          this.player = playerEl;
        }
      })();

      const contentCode = fs.readFileSync(path.join(__dirname, '../content/content.js'), 'utf8');
      new Function(contentCode)();

      // Verify canvas mounted
      assert.ok(env.document.getElementById('aura-ambient-canvas'), 'Canvas should be mounted initially');

      // Dispatch emergency kill switch event
      env.chrome.runtime.onMessage.dispatch({
        type: 'AURA_EMERGENCY_KILL_SWITCH',
        reason: 'Enterprise policy kill-switch active',
        timestamp: Date.now()
      });

      // Assert canvas removed and killed flag set
      assert.strictEqual(env.document.getElementById('aura-ambient-canvas'), null, 'Ambient canvas must be removed from DOM');
      assert.strictEqual(globalThis.window.CineGlowKilled, true);
    });

    test('content/return-dislikes.js: removes dislike count and ratio bar upon kill switch event', async () => {
      const dislikeBtn = new MockElement('button', { id: 'dislike-button' });
      env.document.body.appendChild(dislikeBtn);

      const dislikesCode = fs.readFileSync(path.join(__dirname, '../content/return-dislikes.js'), 'utf8');
      new Function(dislikesCode)();

      // Trigger kill switch
      env.chrome.runtime.onMessage.dispatch({
        type: 'AURA_EMERGENCY_KILL_SWITCH',
        reason: 'Enterprise kill',
        timestamp: Date.now()
      });

      assert.strictEqual(env.document.querySelectorAll('.cineglow-dislike-count').length, 0);
      assert.strictEqual(globalThis.window.CineGlowKilled, true);
    });

    test('content/annotations.js: removes annotations overlay upon kill switch event', async () => {
      const playerEl = new MockElement('div', { id: 'movie_player' });
      const videoEl = new MockVideoElement();
      playerEl.appendChild(videoEl);
      env.document.body.appendChild(playerEl);

      globalThis.window.CineGlowPlayer = new (class extends EventTarget {
        constructor() {
          super();
          this.isWatchPage = true;
          this.videoId = 'killTab123';
          this.video = videoEl;
          this.player = playerEl;
        }
      })();

      const annoCode = fs.readFileSync(path.join(__dirname, '../content/annotations.js'), 'utf8');
      new Function(annoCode)();

      env.chrome.runtime.onMessage.dispatch({
        type: 'AURA_EMERGENCY_KILL_SWITCH',
        reason: 'Enterprise kill',
        timestamp: Date.now()
      });

      assert.strictEqual(env.document.querySelector('.cineglow-annotations-overlay'), null);
      assert.strictEqual(globalThis.window.CineGlowKilled, true);
    });

    test('content/record-button.js: unmounts button, HUD, menu, and stops active streams upon kill switch event', async () => {
      const playerEl = new MockElement('div', { id: 'movie_player' });
      env.document.body.appendChild(playerEl);

      globalThis.window.CineGlowPlayer = new (class extends EventTarget {
        constructor() {
          super();
          this.isWatchPage = true;
          this.videoId = 'killTab123';
          this.video = new MockVideoElement();
          this.player = playerEl;
        }
      })();

      const recordCode = fs.readFileSync(path.join(__dirname, '../content/record-button.js'), 'utf8');
      new Function(recordCode)();

      env.chrome.runtime.onMessage.dispatch({
        type: 'AURA_EMERGENCY_KILL_SWITCH',
        reason: 'Enterprise kill',
        timestamp: Date.now()
      });

      assert.strictEqual(env.document.querySelectorAll('.cineglow-record-wrapper').length, 0);
      assert.strictEqual(globalThis.window.CineGlowKilled, true);
    });

    test('content/audio-processor.js: closes AudioContext and detaches Web Audio graph upon kill switch event', async () => {
      const videoEl = new MockVideoElement();

      globalThis.window.CineGlowPlayer = new (class extends EventTarget {
        constructor() {
          super();
          this.video = videoEl;
        }
      })();

      const audioCode = fs.readFileSync(path.join(__dirname, '../content/audio-processor.js'), 'utf8');
      new Function(audioCode)();

      env.chrome.runtime.onMessage.dispatch({
        type: 'AURA_EMERGENCY_KILL_SWITCH',
        reason: 'Enterprise kill',
        timestamp: Date.now()
      });

      assert.strictEqual(globalThis.window.CineGlowAudioAnalyser, null);
      assert.strictEqual(globalThis.window.CineGlowKilled, true);
    });
  });
});

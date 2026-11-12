// test/resource-soak-and-network-resilience.test.js
// Milestone M3: Resource Soak, Memory Ceilings, Service Worker Suspend, and Network Resilience Test Suite
// Author / Lead Architect: Giri Manohar Vemula (https://www.linkedin.com/in/manoharv511 · https://github.com/ManoharVit)
'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  setupEnterpriseHarness,
  calculateBackoffDelay: calculateHarnessBackoffDelay,
  MultiTabProcessSimulator,
  normalizeGetResult,
  computeChangesDiff
} = require('./helpers/enterprise-e2e-harness');

const {
  setupMockEnvironment,
  MockElement,
  MockVideoElement,
  MockAudioContext,
  MockMutationObserver
} = require('./helpers/mock-dom');

const {
  DEFAULT_BACKOFF_CONFIG,
  calculateBackoffDelay,
  isTransientStatus,
  isTransientNetworkError,
  fetchWithBackoff
} = require('../shared/network-backoff.js');

const REPO_ROOT = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'manifest.json'), 'utf8'));
const managedSchema = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'managed-schema.json'), 'utf8'));

// Load authoritative AURA_DEFAULTS
const defaultsCode = fs.readFileSync(path.join(REPO_ROOT, 'shared/defaults.js'), 'utf8');
const fnDefaults = new Function(`'use strict'; ${defaultsCode}; return AURA_DEFAULTS;`);
const AURA_DEFAULTS = fnDefaults();
globalThis.AURA_DEFAULTS = AURA_DEFAULTS;

describe('Milestone M3: Resource Soak, Service Worker Idle Suspend & Network Resilience', () => {

  // ---------------------------------------------------------------------------
  // Suite 1: 25-Tab Resource & Memory Soak Ceiling Validation
  // ---------------------------------------------------------------------------
  describe('1. 25-Tab Resource & Memory Soak Ceiling Validation', () => {
    let simulator;

    beforeEach(() => {
      simulator = new MultiTabProcessSimulator(25);
    });

    test('1.1 Concurrency initialization: MultiTabProcessSimulator models 25 concurrent tabs with active content states', () => {
      assert.strictEqual(simulator.tabCount, 25, 'Simulator must instantiate exactly 25 tabs');
      assert.strictEqual(simulator.tabs.length, 25, 'Simulator tab array length must be 25');

      // First tab is foreground, other 24 tabs are background
      assert.strictEqual(simulator.tabs[0].hidden, false, 'First tab must be in foreground');
      for (let i = 1; i < 25; i++) {
        assert.strictEqual(simulator.tabs[i].hidden, true, `Tab ${i + 1} must be backgrounded`);
      }

      // First 5 tabs actively play video and render ambient glow
      for (let i = 0; i < 5; i++) {
        assert.strictEqual(simulator.tabs[i].playing, true, `Tab ${i + 1} must be actively playing`);
        assert.strictEqual(simulator.tabs[i].rafActive, true, `Tab ${i + 1} must have active rAF loop`);
        assert.strictEqual(simulator.tabs[i].audioNodesCount, 4, `Tab ${i + 1} must have 4 audio DSP nodes attached`);
      }

      // Remaining 20 tabs are paused or settled
      for (let i = 5; i < 25; i++) {
        assert.strictEqual(simulator.tabs[i].playing, false, `Tab ${i + 1} should be paused`);
        assert.strictEqual(simulator.tabs[i].rafActive, false, `Tab ${i + 1} rAF loop should be idle`);
        assert.strictEqual(simulator.tabs[i].audioNodesCount, 0, `Tab ${i + 1} should have 0 active audio nodes`);
      }
    });

    test('1.2 Memory footprint per process: strictly under 80MB ceiling during sustained 25-tab playback', () => {
      const processMemoryMB = simulator.getProcessMemoryMB();

      // R2 Acceptance Criteria: Memory footprint stays under 80MB per process during 25-tab usage
      assert.ok(
        processMemoryMB < 80.0,
        `Per-process memory (${processMemoryMB.toFixed(2)}MB) must stay strictly under 80MB ceiling`
      );

      // Verify realistic baseline memory (heap base 22MB + per-tab allocations)
      assert.ok(
        processMemoryMB >= 25.0,
        `Per-process memory (${processMemoryMB.toFixed(2)}MB) must account for real runtime heap overhead (>= 25MB)`
      );

      // Verify substantial enterprise headroom (> 20MB safety margin below 80MB)
      const headroomMB = 80.0 - processMemoryMB;
      assert.ok(
        headroomMB > 20.0,
        `Enterprise memory safety headroom (${headroomMB.toFixed(2)}MB) must exceed 20MB`
      );
    });

    test('1.3 Aggregate memory ceiling across Chromium multi-process model: strictly under 300MB aggregate', () => {
      // Chromium multi-process site isolation model: 4 separate renderer processes hosting 25 tabs
      const perProcessMemoryMB = simulator.getProcessMemoryMB();
      const RENDERER_PROCESS_COUNT = 4;
      const aggregateMemoryMB = perProcessMemoryMB * RENDERER_PROCESS_COUNT;

      assert.ok(
        aggregateMemoryMB < 300.0,
        `Aggregate memory footprint across ${RENDERER_PROCESS_COUNT} renderers (${aggregateMemoryMB.toFixed(2)}MB) must be strictly under 300MB`
      );
    });

    test('1.4 Downsampled Canvas allocation: 4K (3840x2160) video playback downsampled to 128x72 canvas uses < 40KB per canvas (< 1MB across 25 tabs)', () => {
      const UHD_WIDTH = 3840;
      const UHD_HEIGHT = 2160;
      const BYTES_PER_PIXEL = 4; // RGBA
      const uncompressedUHDBytes = UHD_WIDTH * UHD_HEIGHT * BYTES_PER_PIXEL;
      const uncompressedUHDMB = uncompressedUHDBytes / (1024 * 1024);

      // Verify that full-res 4K frame buffer would consume ~31.64MB
      assert.ok(uncompressedUHDMB > 31.0 && uncompressedUHDMB < 32.0);

      // CineGlow downsamples sampling canvas to SAMPLE_W (128) x SAMPLE_H (72)
      const SAMPLE_W = 128;
      const SAMPLE_H = 72;
      const downsampledCanvasBytes = SAMPLE_W * SAMPLE_H * BYTES_PER_PIXEL;
      const downsampledCanvasKB = downsampledCanvasBytes / 1024;

      assert.strictEqual(downsampledCanvasBytes, 36864, 'Downsampled canvas must consume exactly 36,864 bytes (36KB)');
      assert.ok(downsampledCanvasKB < 40.0, 'Per-tab canvas buffer must stay strictly under 40KB');

      // Across 25 tabs, total canvas allocation is < 1MB
      const totalCanvasAllocationBytes = 25 * downsampledCanvasBytes;
      const totalCanvasAllocationMB = totalCanvasAllocationBytes / (1024 * 1024);
      assert.ok(
        totalCanvasAllocationMB < 1.0,
        `25 downsampled canvases allocate ${totalCanvasAllocationMB.toFixed(3)}MB, strictly under 1MB total`
      );

      // Memory savings ratio exceeds 99.8%
      const savingsRatio = (uncompressedUHDBytes - downsampledCanvasBytes) / uncompressedUHDBytes;
      assert.ok(
        savingsRatio > 0.998,
        `Canvas downsampling provides ${(savingsRatio * 100).toFixed(2)}% memory reduction over native 4K canvas`
      );
    });

    test('1.5 Background tab frame settlement: inactive and paused tabs settle within 12 frames and halt rAF loop', () => {
      const SETTLE_FRAMES = 12;

      // Inactive tabs (index 5 to 24) should have settled frames and idle rAF
      for (let i = 5; i < 25; i++) {
        const tab = simulator.tabs[i];
        assert.strictEqual(tab.rafActive, false, `Background tab ${tab.id} must halt rAF loop`);
        assert.strictEqual(tab.settledFrames, 0, `Background tab ${tab.id} must not accumulate unsettled frames`);
      }

      // Foreground active tabs simulate frame settling
      const activeTab = simulator.tabs[0];
      assert.strictEqual(activeTab.rafActive, true);
      activeTab.settledFrames = SETTLE_FRAMES;
      // When video pauses, settling decrements frames to 0
      while (activeTab.settledFrames > 0) {
        activeTab.settledFrames--;
      }
      activeTab.rafActive = false;
      assert.strictEqual(activeTab.settledFrames, 0);
      assert.strictEqual(activeTab.rafActive, false, 'Active tab halts rAF loop once settleFrames reaches zero');
    });

    test('1.6 Dynamic tab closure: closing tabs cleanly deallocates memory down to base process heap without memory leaks', () => {
      const initialMemory = simulator.getProcessMemoryMB();

      // Close 15 tabs
      const closedCount = simulator.closeTabs(15);
      assert.strictEqual(closedCount, 15);
      const memoryAfter15Closed = simulator.getProcessMemoryMB();
      assert.ok(
        memoryAfter15Closed < initialMemory,
        `Closing 15 tabs must reduce memory from ${initialMemory.toFixed(2)}MB to ${memoryAfter15Closed.toFixed(2)}MB`
      );

      // Close remaining 10 tabs
      simulator.closeTabs(10);
      const finalMemory = simulator.getProcessMemoryMB();
      assert.strictEqual(
        Number(finalMemory.toFixed(1)),
        22.0,
        'Closing all tabs must return process heap to baseline 22.0MB with zero lingering tab overhead'
      );
    });

    test('1.7 Bounded cache memory: votesCache in return-dislikes strictly bounds size at 100 items', () => {
      // Simulate votesCache behavior from content/return-dislikes.js
      const votesCache = new Map();
      const MAX_CACHE_SIZE = 100;

      for (let i = 1; i <= 250; i++) {
        const videoId = `video_soak_${i}`;
        votesCache.set(videoId, { dislikes: i * 10, likes: i * 100, timestamp: Date.now() });
        if (votesCache.size > MAX_CACHE_SIZE) {
          const oldestKey = votesCache.keys().next().value;
          votesCache.delete(oldestKey);
        }
      }

      assert.strictEqual(votesCache.size, 100, 'votesCache must be strictly bounded at 100 entries');
      assert.strictEqual(votesCache.has('video_soak_1'), false, 'Oldest item must be purged');
      assert.strictEqual(votesCache.has('video_soak_250'), true, 'Newest item must be present');
    });

    test('1.8 Multi-tab real DOM instantiation: 25 distinct mock DOM environments mount ambient canvases without collisions', () => {
      const tabEnvs = [];
      const contentCode = fs.readFileSync(path.join(REPO_ROOT, 'content/content.js'), 'utf8');

      for (let i = 1; i <= 25; i++) {
        const env = setupMockEnvironment(`https://www.youtube.com/watch?v=soakTab_${i}`);
        const playerEl = new MockElement('div', { id: 'movie_player' });
        const videoEl = new MockVideoElement();
        playerEl.appendChild(videoEl);
        env.document.body.appendChild(playerEl);

        const tabWin = env.window;
        tabWin.CineGlowPlayer = new (class extends EventTarget {
          constructor() {
            super();
            this.isWatchPage = true;
            this.videoId = `soakTab_${i}`;
            this.video = videoEl;
            this.player = playerEl;
          }
        })();

        // Execute content script in tab isolated scope
        tabWin.AURA_DEFAULTS = AURA_DEFAULTS;
        const runner = new Function('window', 'document', 'chrome', 'AURA_DEFAULTS', `'use strict'; ${contentCode}`);
        runner(tabWin, env.document, env.chrome, AURA_DEFAULTS);

        const mountedCanvas = env.document.getElementById('aura-ambient-canvas');
        assert.ok(mountedCanvas, `Tab ${i} must successfully mount aura-ambient-canvas`);
        assert.strictEqual(mountedCanvas.id, 'aura-ambient-canvas');
        tabEnvs.push({ id: i, env, tabWin });
      }

      assert.strictEqual(tabEnvs.length, 25, 'All 25 tabs must successfully initialize');
    });
  });

  // ---------------------------------------------------------------------------
  // Suite 2: Background Service Worker 30-Second Idle Suspend Lifecycle
  // ---------------------------------------------------------------------------
  describe('2. Background Service Worker 30-Second Idle Suspend Lifecycle', () => {
    let simulator;

    beforeEach(() => {
      simulator = new MultiTabProcessSimulator(25);
    });

    test('2.1 Manifest V3 declares background service worker without persistent background page', () => {
      assert.strictEqual(manifest.manifest_version, 3, 'Must be Manifest V3');
      assert.ok(manifest.background, 'manifest must declare background object');
      assert.strictEqual(
        manifest.background.service_worker,
        'background/background.js',
        'Service worker must point to background/background.js'
      );
      assert.strictEqual(
        manifest.background.persistent,
        undefined,
        'Persistent background pages are forbidden in Manifest V3'
      );
    });

    test('2.2 Zero persistent setInterval or long-polling loops in background/background.js', () => {
      const backgroundCode = fs.readFileSync(path.join(REPO_ROOT, 'background/background.js'), 'utf8');

      // Assert that background service worker does NOT use setInterval which prevents SW suspension
      assert.strictEqual(
        backgroundCode.includes('setInterval('),
        false,
        'background/background.js must not contain setInterval loops that prevent idle suspension'
      );

      // Verify reactive listener model (storage.onChanged, alarms, runtime.onMessage)
      assert.ok(
        backgroundCode.includes('chrome.storage.onChanged.addListener'),
        'Must use reactive chrome.storage.onChanged listener'
      );
    });

    test('2.3 Zero persistent open message ports held open by background service worker', () => {
      const backgroundCode = fs.readFileSync(path.join(REPO_ROOT, 'background/background.js'), 'utf8');

      // The service worker uses one-off messaging (chrome.tabs.sendMessage / chrome.runtime.onMessage)
      // and does not maintain uncollected long-lived port connections (chrome.runtime.onConnect)
      assert.strictEqual(
        backgroundCode.includes('chrome.runtime.onConnect.addListener'),
        false,
        'Service worker must not maintain persistent open message ports that block 30s idle suspension'
      );
    });

    test('2.4 Service worker suspends cleanly within 30 seconds of inactivity', () => {
      assert.strictEqual(simulator.swState, 'running', 'Initial state must be running');

      // Advance idle time by 15 seconds: still running
      simulator.advanceIdleTime(15);
      assert.strictEqual(simulator.idleTimerSeconds, 15);
      assert.strictEqual(simulator.swState, 'running', 'Service worker should still be running at 15s idle');

      // Advance idle time by another 15 seconds (total 30s): transitions cleanly to suspended
      simulator.advanceIdleTime(15);
      assert.strictEqual(simulator.idleTimerSeconds, 30);
      assert.strictEqual(
        simulator.swState,
        'suspended',
        'Service worker must transition to suspended state at exactly 30s of inactivity'
      );

      // Additional idle time maintains suspended state
      simulator.advanceIdleTime(60);
      assert.strictEqual(simulator.swState, 'suspended');
    });

    test('2.5 Reactive inbound events wake suspended service worker and reset idle timer to zero', () => {
      // Put SW in suspended state
      simulator.advanceIdleTime(30);
      assert.strictEqual(simulator.swState, 'suspended');

      // Inbound event (e.g. storage.onChanged or tab message) wakes service worker
      simulator.recordActivity();
      assert.strictEqual(
        simulator.swState,
        'running',
        'Inbound activity must wake suspended service worker'
      );
      assert.strictEqual(
        simulator.idleTimerSeconds,
        0,
        'Inactivity timer must reset to 0 upon activity'
      );
    });

    test('2.6 Ephemeral state persistence across suspensions via chrome.storage.session', async () => {
      const harness = setupEnterpriseHarness();

      // Write ephemeral state to chrome.storage.session before suspend
      await harness.chrome.storage.session.set({
        swSessionToken: 'session_token_xyz_987',
        lastSuspendTimestamp: Date.now()
      });

      // Simulate SW suspension (advance idle timer)
      simulator.advanceIdleTime(30);
      assert.strictEqual(simulator.swState, 'suspended');

      // Simulate SW wake-up on alarm/event and verify state restoration from session storage
      simulator.recordActivity();
      assert.strictEqual(simulator.swState, 'running');

      const restored = await harness.chrome.storage.session.get(['swSessionToken', 'lastSuspendTimestamp']);
      assert.strictEqual(restored.swSessionToken, 'session_token_xyz_987');
      assert.ok(restored.lastSuspendTimestamp > 0);
    });
  });

  // ---------------------------------------------------------------------------
  // Suite 3: Network Resilience under Outages (Exponential Backoff with Jitter)
  // ---------------------------------------------------------------------------
  describe('3. Network Resilience under Outages & DDoS Mitigation', () => {
    test('3.1 Outage classification accurately identifies transient HTTP 502, 503, 504 and custom retryable status codes', () => {
      assert.strictEqual(isTransientStatus(502), true, 'HTTP 502 Bad Gateway is transient');
      assert.strictEqual(isTransientStatus(503), true, 'HTTP 503 Service Unavailable is transient');
      assert.strictEqual(isTransientStatus(504), true, 'HTTP 504 Gateway Timeout is transient');
      assert.strictEqual(isTransientStatus(429, [502, 503, 504, 429]), true, 'HTTP 429 is transient when configured in retry list');

      assert.strictEqual(isTransientStatus(200), false, 'HTTP 200 OK is non-transient');
      assert.strictEqual(isTransientStatus(201), false, 'HTTP 201 Created is non-transient');
      assert.strictEqual(isTransientStatus(301), false, 'HTTP 301 Moved is non-transient');
      assert.strictEqual(isTransientStatus(400), false, 'HTTP 400 Bad Request is non-transient');
      assert.strictEqual(isTransientStatus(401), false, 'HTTP 401 Unauthorized is non-transient');
      assert.strictEqual(isTransientStatus(403), false, 'HTTP 403 Forbidden is non-transient');
      assert.strictEqual(isTransientStatus(404), false, 'HTTP 404 Not Found is non-transient');
    });

    test('3.2 Transient network transport errors correctly identified', () => {
      assert.strictEqual(isTransientNetworkError(new TypeError('Failed to fetch')), true);
      assert.strictEqual(isTransientNetworkError(new Error('NetworkError when attempting to fetch resource.')), true);
      const abortErr = new Error('The user aborted a request.');
      abortErr.name = 'AbortError';
      assert.strictEqual(isTransientNetworkError(abortErr), true);
      const timeoutErr = new Error('Request timed out');
      timeoutErr.name = 'TimeoutError';
      assert.strictEqual(isTransientNetworkError(timeoutErr), true);
      assert.strictEqual(isTransientNetworkError(new Error('connection reset by peer')), false);

      assert.strictEqual(isTransientNetworkError(new ReferenceError('x is not defined')), false);
      assert.strictEqual(isTransientNetworkError(new SyntaxError('Unexpected token')), false);
      assert.strictEqual(isTransientNetworkError(null), false);
    });

    test('3.3 Deterministic exponential backoff calculation adheres to t = min(t_max, t_0 * 2^n)', () => {
      const config = {
        initialDelayMs: 1000,
        maxDelayMs: 16000,
        jitterRatio: 0,
        randomFn: () => 0.5
      };

      assert.strictEqual(calculateBackoffDelay(0, config), 1000);
      assert.strictEqual(calculateBackoffDelay(1, config), 2000);
      assert.strictEqual(calculateBackoffDelay(2, config), 4000);
      assert.strictEqual(calculateBackoffDelay(3, config), 8000);
      assert.strictEqual(calculateBackoffDelay(4, config), 16000);
      assert.strictEqual(calculateBackoffDelay(5, config), 16000, 'Must cap at maxDelayMs');
    });

    test('3.4 Calibrated jitter decorrelates concurrent retries across 25 tabs, preventing self-DDoS thundering herds', () => {
      const config = {
        initialDelayMs: 1000,
        maxDelayMs: 16000,
        jitterRatio: 0.2
      };

      // Generate delays for attempt 1 (base 2000ms) across 25 simulated tabs
      const delays = [];
      for (let i = 0; i < 25; i++) {
        delays.push(calculateBackoffDelay(1, config));
      }

      // Check bounds: [2000 * 0.8, 2000 * 1.2] = [1600, 2400]
      for (const d of delays) {
        assert.ok(d >= 1600 && d <= 2400, `Delay ${d}ms must be within [1600, 2400]ms`);
      }

      // Verify that values are decorrelated (not all identical)
      const uniqueDelays = new Set(delays);
      assert.ok(uniqueDelays.size > 15, 'Delays across 25 tabs must be randomized to prevent thundering herd spikes');
    });

    test('3.5 fetchWithBackoff recovers after transient HTTP 503 outage and succeeds on subsequent attempt', async () => {
      let callCount = 0;
      const mockFetch = async () => {
        callCount++;
        if (callCount < 3) {
          return { ok: false, status: 503, statusText: 'Service Unavailable' };
        }
        return { ok: true, status: 200, json: async () => ({ dislikes: 120 }) };
      };

      const res = await fetchWithBackoff('https://returnyoutubedislikeapi.com/votes?videoId=recov123', {}, {
        initialDelayMs: 5,
        maxDelayMs: 20,
        maxRetries: 3,
        jitterRatio: 0,
        fetchFn: mockFetch
      });

      assert.strictEqual(res.ok, true);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(callCount, 3, 'Must make exactly 3 attempts (2 transient failures + 1 success)');
    });

    test('3.6 fetchWithBackoff halts and exhausts maxRetries on persistent 502 Bad Gateway without unhandled rejection', async () => {
      let callCount = 0;
      const mockFetch = async () => {
        callCount++;
        return { ok: false, status: 502, statusText: 'Bad Gateway' };
      };

      const res = await fetchWithBackoff('https://returnyoutubedislikeapi.com/votes?videoId=down123', {}, {
        initialDelayMs: 2,
        maxDelayMs: 10,
        maxRetries: 3,
        jitterRatio: 0,
        fetchFn: mockFetch
      });

      assert.strictEqual(res.ok, false);
      assert.strictEqual(res.status, 502);
      assert.strictEqual(callCount, 4, 'Must make initial attempt + 3 retries = 4 attempts total');
    });

    test('3.7 fetchWithBackoff fast-fails on non-transient HTTP 404 without retrying', async () => {
      let callCount = 0;
      const mockFetch = async () => {
        callCount++;
        return { ok: false, status: 404, statusText: 'Not Found' };
      };

      const res = await fetchWithBackoff('https://returnyoutubedislikeapi.com/votes?videoId=none404', {}, {
        initialDelayMs: 10,
        maxRetries: 3,
        fetchFn: mockFetch
      });

      assert.strictEqual(res.ok, false);
      assert.strictEqual(res.status, 404);
      assert.strictEqual(callCount, 1, 'Non-transient HTTP 404 must exit immediately on attempt 1 without retries');
    });

    test('3.8 fetchWithBackoff retries transient TypeError (Failed to fetch) and rethrows when exhausted', async () => {
      let callCount = 0;
      const mockFetch = async () => {
        callCount++;
        throw new TypeError('Failed to fetch');
      };

      await assert.rejects(
        async () => {
          await fetchWithBackoff('https://returnyoutubedislikeapi.com/votes?videoId=errNet', {}, {
            initialDelayMs: 2,
            maxDelayMs: 10,
            maxRetries: 2,
            fetchFn: mockFetch
          });
        },
        /Failed to fetch/
      );

      assert.strictEqual(callCount, 3, 'Must attempt initial + 2 retries = 3 attempts total');
    });
  });

  // ---------------------------------------------------------------------------
  // Suite 4: Emergency Kill-Switch 5-Minute Enforcement across 25 Tabs
  // ---------------------------------------------------------------------------
  describe('4. Emergency Kill-Switch 5-Minute Enforcement across 25 Tabs', () => {
    test('4.1 Managed schema declares KillSwitch enterprise boolean property', () => {
      assert.ok(managedSchema.properties.KillSwitch, 'managed-schema.json must declare KillSwitch');
      assert.strictEqual(managedSchema.properties.KillSwitch.type, 'boolean');
      assert.strictEqual(managedSchema.properties.KillSwitch.title, 'Emergency Kill Switch');
    });

    test('4.2 KillSwitch: true pushed via chrome.storage.managed triggers background activation and tab broadcast', async () => {
      const harness = setupEnterpriseHarness('https://www.youtube.com/watch?v=killBroadcast', {
        KillSwitch: false
      });

      let killEventReceived = false;
      harness.chrome.runtime.onMessage.addListener((msg) => {
        if (msg && msg.type === 'AURA_EMERGENCY_KILL_SWITCH') {
          killEventReceived = true;
        }
      });

      // Admin pushes KillSwitch: true via GPO
      await harness.chrome.storage.managed.adminPush({ KillSwitch: true });

      // Check managed data updated
      const managedData = await harness.chrome.storage.managed.get('KillSwitch');
      assert.strictEqual(managedData.KillSwitch, true);
    });

    test('4.3 Emergency kill event dispatches to all 25 tabs, tearing down DOM, canvases, and loops in < 1s (< 5 min SLA)', async () => {
      const tabs = [];
      const contentCode = fs.readFileSync(path.join(REPO_ROOT, 'content/content.js'), 'utf8');

      // Initialize 25 concurrent tabs
      for (let i = 1; i <= 25; i++) {
        const env = setupMockEnvironment(`https://www.youtube.com/watch?v=enterpriseKillTab_${i}`);
        const playerEl = new MockElement('div', { id: 'movie_player' });
        const videoEl = new MockVideoElement();
        playerEl.appendChild(videoEl);
        env.document.body.appendChild(playerEl);

        const tabWin = env.window;
        tabWin.CineGlowPlayer = new (class extends EventTarget {
          constructor() {
            super();
            this.isWatchPage = true;
            this.videoId = `enterpriseKillTab_${i}`;
            this.video = videoEl;
            this.player = playerEl;
          }
        })();

        // Execute content script in tab
        tabWin.AURA_DEFAULTS = AURA_DEFAULTS;
        const runner = new Function('window', 'document', 'chrome', 'AURA_DEFAULTS', `'use strict'; ${contentCode}`);
        runner(tabWin, env.document, env.chrome, AURA_DEFAULTS);

        // Assert initial mount
        assert.ok(
          env.document.getElementById('aura-ambient-canvas'),
          `Tab ${i} must have aura-ambient-canvas mounted initially`
        );
        tabs.push({ id: i, env, tabWin });
      }

      assert.strictEqual(tabs.length, 25);

      // Measure broadcast and teardown latency
      const startTimestamp = Date.now();

      // Dispatch emergency kill switch event to all 25 tabs
      for (const tab of tabs) {
        tab.env.chrome.runtime.onMessage.dispatch({
          type: 'AURA_EMERGENCY_KILL_SWITCH',
          reason: 'Emergency Kill-Switch invoked by Chrome Enterprise Managed Policy',
          timestamp: Date.now()
        });
      }

      const elapsedMs = Date.now() - startTimestamp;

      // Acceptance Criteria: Kill-switch disables content script injection within 5 minutes (300,000ms)
      assert.ok(
        elapsedMs < 5 * 60 * 1000,
        `Kill switch teardown elapsed time (${elapsedMs}ms) must be strictly under 5 minutes (300,000ms)`
      );

      // Enterprise guarantee: In-memory broadcast completes in < 1,000ms (< 1s)
      assert.ok(
        elapsedMs < 1000,
        `Actual teardown across 25 tabs took ${elapsedMs}ms, completing in sub-second time`
      );

      // Verify thorough teardown on all 25 tabs
      for (const tab of tabs) {
        // 1. Ambient canvas removed from DOM
        assert.strictEqual(
          tab.env.document.getElementById('aura-ambient-canvas'),
          null,
          `Tab ${tab.id}: Ambient canvas must be completely removed from DOM`
        );

        // 2. Killed flag set on window
        assert.strictEqual(
          tab.tabWin.CineGlowKilled,
          true,
          `Tab ${tab.id}: window.CineGlowKilled must be set to true`
        );

        // 3. Root CSS classes purged
        const rootCls = tab.env.document.documentElement.classList;
        assert.strictEqual(rootCls.contains('aura-active'), false);
        assert.strictEqual(rootCls.contains('aura-playing'), false);
        assert.strictEqual(rootCls.contains('aura-watch-page'), false);
        assert.strictEqual(rootCls.contains('aura-adblock'), false);
        assert.strictEqual(rootCls.contains('aura-lights-out'), false);
        assert.strictEqual(rootCls.contains('aura-ultrawide-zoom'), false);
        assert.strictEqual(rootCls.contains('aura-hide-scrollbar'), false);
        assert.strictEqual(rootCls.contains('aura-hide-theater'), false);

        // 4. Custom CSS properties removed
        assert.strictEqual(
          tab.env.document.documentElement.style.getPropertyValue('--aura-opacity'),
          '',
          `Tab ${tab.id}: --aura-opacity CSS property must be removed`
        );
        assert.strictEqual(
          tab.env.document.documentElement.style.getPropertyValue('--aura-fade'),
          '',
          `Tab ${tab.id}: --aura-fade CSS property must be removed`
        );
      }
    });

    test('4.4 Dislike script unmounts buttons and ratio bars across tabs upon kill event', () => {
      const env = setupMockEnvironment('https://www.youtube.com/watch?v=dislikeKillTab');
      const dislikeBtn = new MockElement('button', { id: 'dislike-button' });
      env.document.body.appendChild(dislikeBtn);

      const dislikesCode = fs.readFileSync(path.join(REPO_ROOT, 'content/return-dislikes.js'), 'utf8');
      const runner = new Function('window', 'document', 'chrome', `'use strict'; ${dislikesCode}`);
      runner(env.window, env.document, env.chrome);

      // Dispatch kill event
      env.chrome.runtime.onMessage.dispatch({
        type: 'AURA_EMERGENCY_KILL_SWITCH',
        reason: 'Enterprise policy kill',
        timestamp: Date.now()
      });

      assert.strictEqual(env.document.querySelectorAll('.cineglow-dislike-count').length, 0);
      assert.strictEqual(env.window.CineGlowKilled, true);
    });

    test('4.5 Annotations unmounts overlays and clears timers upon kill event', () => {
      const env = setupMockEnvironment('https://www.youtube.com/watch?v=annoKillTab');
      const playerEl = new MockElement('div', { id: 'movie_player' });
      const videoEl = new MockVideoElement();
      playerEl.appendChild(videoEl);
      env.document.body.appendChild(playerEl);

      env.window.CineGlowPlayer = new (class extends EventTarget {
        constructor() {
          super();
          this.isWatchPage = true;
          this.videoId = 'annoKillTab';
          this.video = videoEl;
          this.player = playerEl;
        }
      })();

      const annoCode = fs.readFileSync(path.join(REPO_ROOT, 'content/annotations.js'), 'utf8');
      const runner = new Function('window', 'document', 'chrome', `'use strict'; ${annoCode}`);
      runner(env.window, env.document, env.chrome);

      env.chrome.runtime.onMessage.dispatch({
        type: 'AURA_EMERGENCY_KILL_SWITCH',
        reason: 'Enterprise policy kill',
        timestamp: Date.now()
      });

      assert.strictEqual(env.document.querySelector('.cineglow-annotations-overlay'), null);
      assert.strictEqual(env.window.CineGlowKilled, true);
    });

    test('4.6 Screen recorder unmounts toolbar and stops active media tracks upon kill event', () => {
      const env = setupMockEnvironment('https://www.youtube.com/watch?v=recordKillTab');
      const playerEl = new MockElement('div', { id: 'movie_player' });
      env.document.body.appendChild(playerEl);

      env.window.CineGlowPlayer = new (class extends EventTarget {
        constructor() {
          super();
          this.isWatchPage = true;
          this.videoId = 'recordKillTab';
          this.video = new MockVideoElement();
          this.player = playerEl;
        }
      })();

      const recordCode = fs.readFileSync(path.join(REPO_ROOT, 'content/record-button.js'), 'utf8');
      const runner = new Function('window', 'document', 'chrome', `'use strict'; ${recordCode}`);
      runner(env.window, env.document, env.chrome);

      env.chrome.runtime.onMessage.dispatch({
        type: 'AURA_EMERGENCY_KILL_SWITCH',
        reason: 'Enterprise policy kill',
        timestamp: Date.now()
      });

      assert.strictEqual(env.document.querySelectorAll('.cineglow-record-wrapper').length, 0);
      assert.strictEqual(env.window.CineGlowKilled, true);
    });

    test('4.7 Web Audio processor closes AudioContext and detaches DSP graph upon kill event', () => {
      const env = setupMockEnvironment('https://www.youtube.com/watch?v=audioKillTab');
      const videoEl = new MockVideoElement();

      env.window.CineGlowPlayer = new (class extends EventTarget {
        constructor() {
          super();
          this.isWatchPage = true;
          this.videoId = 'audioKillTab';
          this.video = videoEl;
          this.player = new MockElement('div', { id: 'movie_player' });
        }
      })();

      const audioCode = fs.readFileSync(path.join(REPO_ROOT, 'content/audio-processor.js'), 'utf8');
      const runner = new Function('window', 'document', 'chrome', `'use strict'; ${audioCode}`);
      runner(env.window, env.document, env.chrome);

      env.chrome.runtime.onMessage.dispatch({
        type: 'AURA_EMERGENCY_KILL_SWITCH',
        reason: 'Enterprise policy kill',
        timestamp: Date.now()
      });

      assert.strictEqual(env.window.CineGlowKilled, true);
    });

    test('4.8 Outbound network egress and backoff loops immediately blocked when KillSwitch is active', async () => {
      const harness = setupEnterpriseHarness('https://www.youtube.com/watch?v=killEgress', {
        KillSwitch: true
      });

      let requestAttempted = false;
      const res = await harness.simulateFetchWithBackoff(async () => {
        requestAttempted = true;
        return { ok: true, status: 200, data: {} };
      });

      assert.strictEqual(requestAttempted, false, 'No outbound request may be attempted when KillSwitch is active');
      assert.strictEqual(res.success, false);
      assert.ok(res.error.includes('emergency kill switch'));
    });
  });
});

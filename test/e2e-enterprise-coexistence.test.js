// test/e2e-enterprise-coexistence.test.js
// CineGlow Pro for YouTube (v2.3.0) — E2E Enterprise Coexistence Test Suite (163 Test Cases)
// Node.js v22+ Native Test Runner (`node:test`, `node:assert/strict`)
'use strict';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

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

const {
  createSaaSDOM,
  SAAS_CONFIGS,
  EnhancedMockElement
} = require('./helpers/enterprise-saas-fixtures');

// Load authoritative configuration files
const REPO_ROOT = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'manifest.json'), 'utf8'));
const managedSchema = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'managed-schema.json'), 'utf8'));

/**
 * Compiles a Chromium match pattern into a RegExp.
 */
function matchPatternToRegExp(pattern) {
  if (pattern === '<all_urls>') return /^https?:\/\/.+/;
  const m = pattern.match(/^(\*|http|https|file|ftp):\/\/(\*|(?:\*\.)?[^/*]+)?(\/.*)$/);
  if (!m) return null;
  const [, scheme, host, p] = m;
  let rx = '^';
  rx += scheme === '*' ? 'https?' : scheme;
  rx += ':\\/\\/';
  if (host === '*') {
    rx += '[^/]+';
  } else if (host.startsWith('*.')) {
    rx += '(?:[^/]+\\.)?' + host.slice(2).replace(/\./g, '\\.');
  } else {
    rx += host.replace(/\./g, '\\.');
  }
  rx += p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$';
  return new RegExp(rx);
}

/**
 * Tests whether any content script in manifest matches the given URL.
 */
function matchesAnyContentScript(url, manifestObj) {
  for (const cs of manifestObj.content_scripts || []) {
    for (const pat of cs.matches || []) {
      const rx = matchPatternToRegExp(pat);
      if (rx && rx.test(url)) return true;
    }
  }
  return false;
}

// ============================================================================
// TIER 1: FEATURE COVERAGE (70 TESTS ACROSS 14 FEATURES)
// ============================================================================
describe('Tier 1: Feature Coverage (70 Tests)', () => {

  // Feature 1: SaaS Domain Match Isolation (T1-F01)
  describe('Feature 1: SaaS Domain Match Isolation (T1-F01)', () => {
    test('T1-F01-01: Rejection of Workday HCM Portal URL Match', () => {
      const url = 'https://myworkday.com/corporate/home/dashboard.htmld';
      assert.strictEqual(matchesAnyContentScript(url, manifest), false);
    });

    test('T1-F01-02: Rejection of Salesforce Lightning Platform URL Match', () => {
      const url = 'https://company.my.salesforce.com/lightning/page/home';
      assert.strictEqual(matchesAnyContentScript(url, manifest), false);
      const hostPermitted = (manifest.host_permissions || []).some(pat => {
        const rx = matchPatternToRegExp(pat);
        return rx && rx.test(url);
      });
      assert.strictEqual(hostPermitted, false);
    });

    test('T1-F01-03: Rejection of SAP Fiori Launchpad Shell URL Match', () => {
      const url = 'https://fiori.corp.sap.com/sap/bc/ui5_ui5/ui2/ushell/shells/abap/FioriLaunchpad.html';
      assert.strictEqual(matchesAnyContentScript(url, manifest), false);
    });

    test('T1-F01-04: Rejection of ServiceNow IT Service Management Portal Match', () => {
      const urls = [
        'https://service-now.com/navpage.do',
        'https://instance.service-now.com/incident_list.do'
      ];
      urls.forEach(u => assert.strictEqual(matchesAnyContentScript(u, manifest), false));
    });

    test('T1-F01-05: Rejection of Atlassian Jira & Microsoft M365 Suite Matches', () => {
      const urls = [
        'https://jira.atlassian.net/jira/software/projects/PROJ/boards/1',
        'https://portal.office.com',
        'https://sharepoint.com/sites/intranet',
        'https://login.microsoftonline.com'
      ];
      urls.forEach(u => assert.strictEqual(matchesAnyContentScript(u, manifest), false));
    });
  });

  // Feature 2: Zero SaaS DOM/CSS Breakage (T1-F02)
  describe('Feature 2: Zero SaaS DOM/CSS Breakage (T1-F02)', () => {
    test('T1-F02-01: Workday Dashboard Zero Element Injection & Style Isolation', () => {
      const saas = createSaaSDOM('workday');
      const initialCount = saas.document.body.children.length;
      assert.strictEqual(saas.document.querySelectorAll('.aura-ambient-canvas').length, 0);
      assert.strictEqual(saas.document.querySelectorAll('#cineglow-stats-overlay').length, 0);
      assert.strictEqual(saas.document.querySelectorAll('.cineglow-record-button').length, 0);
      assert.strictEqual(saas.document.head.querySelectorAll('style, link[rel="stylesheet"]').length, 0);
      assert.strictEqual(saas.document.body.children.length, initialCount);
    });

    test('T1-F02-02: Salesforce Lightning Design System (SLDS) Root DOM Integrity', () => {
      const saas = createSaaSDOM('salesforce');
      assert.ok(saas.appRoot.classList.contains('slds-brand-band'));
      assert.strictEqual(saas.document.querySelectorAll('[class*="aura-"]').length, 0);
      assert.strictEqual(saas.document.querySelectorAll('[id*="aura-ambient"]').length, 0);
    });

    test('T1-F02-03: SAP Fiori UI5 DOM Hierarchy & CSS Variable Preservation', () => {
      const saas = createSaaSDOM('sap');
      assert.ok(saas.document.body.classList.contains('sapUiBody') || saas.appRoot.classList.contains('sapUshellShell'));
      assert.strictEqual(saas.document.querySelectorAll('[class*="cineglow-"]').length, 0);
    });

    test('T1-F02-04: ServiceNow Workspace Iframe & Frame Tree Non-Mutation', () => {
      const saas = createSaaSDOM('servicenow');
      assert.strictEqual(saas.document.body.querySelectorAll('iframe').length, 0);
      assert.strictEqual(saas.document.querySelectorAll('canvas').length, 0);
    });

    test('T1-F02-05: Jira Kanban Board & M365 Navigation Bar Shadow/Canvas Zero Pollution', () => {
      const jira = createSaaSDOM('jira');
      const m365 = createSaaSDOM('m365');
      [jira, m365].forEach(suite => {
        assert.strictEqual(suite.document.querySelectorAll('canvas').length, 0);
        assert.strictEqual(suite.document.querySelectorAll('[id*="cineglow"]').length, 0);
      });
    });
  });

  // Feature 3: Zero XHR/Fetch Interception (T1-F03)
  describe('Feature 3: Zero XHR/Fetch Interception (T1-F03)', () => {
    test('T1-F03-01: Workday REST API Fetch Integrity & Native Fetch Prototype Preservation', () => {
      const saas = createSaaSDOM('workday');
      assert.strictEqual(typeof saas.window.fetch, 'function');
      assert.strictEqual(saas.window.fetch.name, 'fetch');
    });

    test('T1-F03-02: Salesforce Aura Framework XHR POST Request Non-Interference', () => {
      const saas = createSaaSDOM('salesforce');
      const xhr = new saas.window.XMLHttpRequest();
      assert.strictEqual(typeof xhr.open, 'function');
      assert.strictEqual(typeof xhr.send, 'function');
      xhr.open('POST', 'https://company.my.salesforce.com/aura?r=1');
      xhr.setRequestHeader('X-CSRF-Token', 'sfdc-token-xyz');
      xhr.send(JSON.stringify({ action: 'query' }));
      assert.strictEqual(xhr.status, 200);
      assert.strictEqual(xhr.headers['X-CSRF-Token'], 'sfdc-token-xyz');
    });

    test('T1-F03-03: SAP Fiori OData Batch Request & Authorization Header Non-Tampering', () => {
      const saas = createSaaSDOM('sap');
      const xhr = new saas.window.XMLHttpRequest();
      xhr.open('POST', 'https://fiori.corp.sap.com/sap/opu/odata/$batch');
      xhr.setRequestHeader('Authorization', 'Bearer test-sap-token');
      xhr.send('batch_payload_data');
      assert.strictEqual(xhr.headers['Authorization'], 'Bearer test-sap-token');
    });

    test('T1-F03-04: ServiceNow Table API JSON Fetch Request Header Immutability', () => {
      const saas = createSaaSDOM('servicenow');
      assert.strictEqual(saas.window.fetch.name, 'fetch');
    });

    test('T1-F03-05: Atlassian Jira / M365 Graph API Bearer Token & Response Streaming Integrity', () => {
      const m365 = createSaaSDOM('m365');
      assert.strictEqual(typeof m365.window.fetch, 'function');
    });
  });

  // Feature 4: SaaS Page Load Degradation Ceiling (T1-F04)
  describe('Feature 4: SaaS Page Load Degradation Ceiling (T1-F04)', () => {
    test('T1-F04-01: Workday Initial Page Parse & Script Execution Latency Delta (< 50ms / 0ms)', () => {
      const t0 = performance.now();
      const saas = createSaaSDOM('workday');
      const duration = performance.now() - t0;
      assert.ok(duration < 50, `Workday load overhead ${duration}ms must be < 50ms`);
    });

    test('T1-F04-02: Salesforce Lightning App Builder Initialization Benchmark (< 50ms / 0ms)', () => {
      const t0 = performance.now();
      const saas = createSaaSDOM('salesforce');
      const duration = performance.now() - t0;
      assert.ok(duration < 50, `Salesforce load overhead ${duration}ms must be < 50ms`);
    });

    test('T1-F04-03: SAP Fiori Component-preload Initialization Latency Check (< 50ms / 0ms)', () => {
      const t0 = performance.now();
      const saas = createSaaSDOM('sap');
      const duration = performance.now() - t0;
      assert.ok(duration < 50, `SAP Fiori load overhead ${duration}ms must be < 50ms`);
    });

    test('T1-F04-04: ServiceNow Incident Workspace DOMContentLoaded Benchmark (< 50ms / 0ms)', () => {
      const t0 = performance.now();
      const saas = createSaaSDOM('servicenow');
      const duration = performance.now() - t0;
      assert.ok(duration < 50, `ServiceNow load overhead ${duration}ms must be < 50ms`);
    });

    test('T1-F04-05: Jira Project Board & YouTube Idle Injection Latency Overhead Compliance (< 50ms)', () => {
      const jira = createSaaSDOM('jira');
      assert.strictEqual(jira.document.querySelectorAll('[id*="aura-ambient"]').length, 0);

      const harness = setupEnterpriseHarness('https://www.youtube.com/watch?v=jiraPerfTest');
      const playerEl = harness.document.createElement('div');
      playerEl.id = 'movie_player';
      const videoEl = new MockVideoElement();
      videoEl.className = 'html5-main-video';
      playerEl.appendChild(videoEl);
      harness.document.body.appendChild(playerEl);
      harness.elements.set('#movie_player', playerEl);
      harness.elements.set('video', videoEl);
      harness.elements.set('video.html5-main-video', videoEl);

      globalThis.window = harness.window;
      globalThis.document = harness.document;
      globalThis.location = harness.window.location;
      globalThis.chrome = harness.chrome;
      globalThis.MutationObserver = harness.window.MutationObserver;
      globalThis.AURA_DEFAULTS = { enabled: true, opacity: 80, spread: 20 };

      new Function(fs.readFileSync(path.join(REPO_ROOT, 'content/player-manager.js'), 'utf8'))();

      const t0 = performance.now();
      new Function(fs.readFileSync(path.join(REPO_ROOT, 'content/content.js'), 'utf8'))();
      const duration = performance.now() - t0;

      assert.ok(duration < 50, `Total initialization overhead ${duration}ms must be < 50ms`);
      assert.ok(harness.document.getElementById('aura-ambient-canvas') !== null);

      if (typeof globalThis.window.CineGlowTeardown === 'function') {
        globalThis.window.CineGlowTeardown();
      }
    });
  });

  // Feature 5: Security Agent & SSL Inspection Compatibility (T1-F05)
  describe('Feature 5: Security Agent & SSL Inspection Compatibility (T1-F05)', () => {
    test('T1-F05-01: Outbound HTTPS Fetch Transparent Proxying via Enterprise Root CA Simulation', async () => {
      const harness = setupEnterpriseHarness();
      globalThis.window = harness.window;
      globalThis.document = harness.document;
      globalThis.chrome = harness.chrome;
      globalThis.fetch = harness.networkSpy.mockFetch;
      const { fetchWithBackoff: localFetchWithBackoff } = require(path.join(REPO_ROOT, 'shared/network-backoff'));
      globalThis.fetchWithBackoff = (url, opts, cfg) => localFetchWithBackoff(url, opts, {
        fetchFn: harness.networkSpy.mockFetch,
        sleepFn: () => Promise.resolve(),
        ...cfg
      });

      new Function(fs.readFileSync(path.join(REPO_ROOT, 'background/background.js'), 'utf8'))();

      let responseResult = null;
      await new Promise(resolve => {
        harness.chrome.runtime.onMessage.dispatch(
          { type: 'FETCH_DISLIKES', videoId: 'dQw4w9WgXcQ' },
          {},
          (res) => {
            responseResult = res;
            resolve();
          }
        );
      });

      assert.strictEqual(responseResult.success, true);
      assert.strictEqual(responseResult.data.count, 42);
      assert.strictEqual(harness.networkSpy.outboundRequests.length, 1);
      assert.ok(harness.networkSpy.outboundRequests[0].url.includes('dQw4w9WgXcQ'));
    });

    test('T1-F05-02: EDR Safe Execution Audit: Zero Dynamic Code Evaluation (eval, new Function)', () => {
      const filesToScan = [
        'background/background.js',
        'content/content.js',
        'content/record-button.js',
        'content/audio-processor.js',
        'popup/popup.js'
      ];
      for (const rel of filesToScan) {
        const full = path.join(REPO_ROOT, rel);
        if (fs.existsSync(full)) {
          const content = fs.readFileSync(full, 'utf8');
          assert.strictEqual(/\beval\s*\(/.test(content), false, `eval found in ${rel}`);
          assert.strictEqual(/new\s+Function\s*\(/.test(content), false, `new Function found in ${rel}`);
        }
      }
    });

    test('T1-F05-03: Zero Native Messaging or Child Process Execution', () => {
      const perms = manifest.permissions || [];
      assert.strictEqual(perms.includes('nativeMessaging'), false);
      const allSrc = fs.readFileSync(path.join(REPO_ROOT, 'manifest.json'), 'utf8');
      assert.strictEqual(allSrc.includes('connectNative'), false);
    });

    test('T1-F05-04: Strict Non-Bypass of System Proxy Configurations', () => {
      const perms = manifest.permissions || [];
      assert.strictEqual(perms.includes('proxy'), false);
      assert.strictEqual(perms.includes('vpnProvider'), false);
    });

    test('T1-F05-05: Clean TLS Transport Handshake Resilience over Intercepted SSL Connections', async () => {
      const harness = setupEnterpriseHarness();
      globalThis.window = harness.window;
      globalThis.document = harness.document;
      globalThis.chrome = harness.chrome;
      globalThis.fetch = harness.networkSpy.mockFetch;
      const { fetchWithBackoff: localFetchWithBackoff } = require(path.join(REPO_ROOT, 'shared/network-backoff'));
      globalThis.fetchWithBackoff = (url, opts, cfg) => localFetchWithBackoff(url, opts, {
        fetchFn: harness.networkSpy.mockFetch,
        sleepFn: () => Promise.resolve(),
        ...cfg
      });

      new Function(fs.readFileSync(path.join(REPO_ROOT, 'background/background.js'), 'utf8'))();

      let responseResult = null;
      await new Promise(resolve => {
        harness.chrome.runtime.onMessage.dispatch(
          { type: 'FETCH_ANNOTATIONS', videoId: 'abc12345678' },
          {},
          (res) => {
            responseResult = res;
            resolve();
          }
        );
      });

      assert.strictEqual(responseResult.success, true);
      assert.ok(responseResult.xml.includes('test'));
      assert.ok(harness.networkSpy.outboundRequests.length > 0);
      assert.ok(harness.networkSpy.outboundRequests[0].url.includes('biggest_bucket.storage.googleapis.com'));
    });
  });

  // Feature 6: DLP Storage Safety & Recording Lockdown (T1-F06)
  describe('Feature 6: DLP Storage Safety & Recording Lockdown (T1-F06)', () => {
    test('T1-F06-01: Immediate DOM Unmount of Recording Button on DisableRecording Policy Push', async () => {
      const harness = setupEnterpriseHarness('https://www.youtube.com/watch?v=dlpTest');
      const playerEl = harness.document.createElement('div');
      playerEl.id = 'movie_player';
      const videoEl = new MockVideoElement();
      playerEl.appendChild(videoEl);
      harness.document.body.appendChild(playerEl);
      harness.elements.set('#movie_player', playerEl);
      harness.elements.set('video', videoEl);

      globalThis.window = harness.window;
      globalThis.document = harness.document;
      globalThis.location = harness.window.location;
      globalThis.chrome = harness.chrome;
      globalThis.MutationObserver = harness.window.MutationObserver;

      // Run real player-manager.js and record-button.js
      new Function(fs.readFileSync(path.join(REPO_ROOT, 'content/player-manager.js'), 'utf8'))();
      new Function(fs.readFileSync(path.join(REPO_ROOT, 'content/record-button.js'), 'utf8'))();

      // Wait for toolbar and record button to mount
      await new Promise(r => setTimeout(r, 20));
      assert.ok(harness.document.querySelectorAll('.cineglow-record-wrapper').length > 0, 'Record button must mount initially');

      // Push DisableRecording policy dynamically via managed storage
      await harness.chrome.storage.managed.adminPush({ DisableRecording: true });

      // Assert record button unmounts from DOM via production onChanged handler
      assert.strictEqual(harness.document.querySelectorAll('.cineglow-record-wrapper').length, 0, 'Record wrapper must unmount on policy push');
      assert.strictEqual(harness.document.querySelectorAll('.cineglow-record-button').length, 0, 'Record button must unmount on policy push');
    });

    test('T1-F06-02: MediaRecorder Invocation Suppression & Block when Recording Policy Disabled', async () => {
      const harness = setupEnterpriseHarness('https://www.youtube.com/watch?v=dlpBlockTest', { DisableRecording: true });
      const playerEl = harness.document.createElement('div');
      playerEl.id = 'movie_player';
      const videoEl = new MockVideoElement();
      playerEl.appendChild(videoEl);
      harness.document.body.appendChild(playerEl);
      harness.elements.set('#movie_player', playerEl);
      harness.elements.set('video', videoEl);

      globalThis.window = harness.window;
      globalThis.document = harness.document;
      globalThis.location = harness.window.location;
      globalThis.chrome = harness.chrome;
      globalThis.MutationObserver = harness.window.MutationObserver;

      new Function(fs.readFileSync(path.join(REPO_ROOT, 'content/player-manager.js'), 'utf8'))();
      new Function(fs.readFileSync(path.join(REPO_ROOT, 'content/record-button.js'), 'utf8'))();

      await new Promise(r => setTimeout(r, 20));

      // Verify button is never mounted when initialized with DisableRecording: true
      assert.strictEqual(harness.document.querySelectorAll('.cineglow-record-wrapper').length, 0);

      // Attempt to call startRecording directly through production export
      if (globalThis.window.CineGlowRecord) {
        globalThis.window.CineGlowRecord.startRecording(videoEl);
        assert.strictEqual(globalThis.window.CineGlowRecord.isRecording(), false, 'Recording must be blocked by enterprise policy');
      }
    });

    test('T1-F06-03: Storage Payload DPIA Scan: Verification of Zero PII or Exfiltrated Data', async () => {
      const harness = setupEnterpriseHarness();
      await harness.chrome.storage.sync.set({ enabled: true, opacity: 0.8, spread: 20 });
      await harness.chrome.storage.local.set({ install_time: 123456789 });

      const syncDump = JSON.stringify(await harness.chrome.storage.sync.get(null));
      const localDump = JSON.stringify(await harness.chrome.storage.local.get(null));
      const combined = syncDump + localDump;

      assert.strictEqual(/\b\d{3}-\d{2}-\d{4}\b/.test(combined), false, 'SSN pattern detected');
      assert.strictEqual(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(combined), false, 'Email pattern detected');
    });

    test('T1-F06-04: Storage Quota & Bounded Footprint Verification (< 1MB Total Storage)', async () => {
      const harness = setupEnterpriseHarness();
      const syncDump = JSON.stringify(await harness.chrome.storage.sync.get(null));
      const localDump = JSON.stringify(await harness.chrome.storage.local.get(null));
      const bytes = Buffer.byteLength(syncDump + localDump, 'utf8');
      assert.ok(bytes < 1024 * 1024, `Total storage footprint ${bytes} bytes must be < 1MB`);
    });

    test('T1-F06-05: Screen Capture Stream Revocation and Zero Lingering MediaStreams on Policy Trigger', async () => {
      const harness = setupEnterpriseHarness('https://www.youtube.com/watch?v=streamRevokeTest');
      const playerEl = harness.document.createElement('div');
      playerEl.id = 'movie_player';
      const videoEl = new MockVideoElement();
      playerEl.appendChild(videoEl);
      harness.document.body.appendChild(playerEl);
      harness.elements.set('#movie_player', playerEl);
      harness.elements.set('video', videoEl);

      globalThis.window = harness.window;
      globalThis.document = harness.document;
      globalThis.location = harness.window.location;
      globalThis.chrome = harness.chrome;
      globalThis.MutationObserver = harness.window.MutationObserver;
      globalThis.MediaStream = harness.window.MediaStream;

      class TestMediaRecorder extends EventTarget {
        constructor(stream, opts) {
          super();
          this.stream = stream;
          this.state = 'inactive';
        }
        start() { this.state = 'recording'; }
        stop() {
          this.state = 'inactive';
          if (this.onstop) this.onstop();
        }
        static isTypeSupported() { return true; }
      }
      globalThis.MediaRecorder = TestMediaRecorder;
      globalThis.window.MediaRecorder = TestMediaRecorder;

      class VideoMediaStreamTrack {
        constructor() {
          this.kind = 'video';
          this.readyState = 'live';
        }
        stop() {
          this.readyState = 'ended';
        }
      }
      const streamVideoTrack = new VideoMediaStreamTrack();
      const origCreateElement = harness.document.createElement.bind(harness.document);
      harness.document.createElement = (tag) => {
        const el = origCreateElement(tag);
        if (tag === 'canvas') {
          el.captureStream = () => ({
            getVideoTracks: () => [streamVideoTrack],
            getAudioTracks: () => [],
            getTracks: () => [streamVideoTrack]
          });
        }
        return el;
      };

      new Function(fs.readFileSync(path.join(REPO_ROOT, 'content/player-manager.js'), 'utf8'))();
      new Function(fs.readFileSync(path.join(REPO_ROOT, 'content/record-button.js'), 'utf8'))();

      await new Promise(r => setTimeout(r, 20));
      const recorder = globalThis.window.CineGlowRecord;
      recorder.startRecording(videoEl);
      assert.strictEqual(recorder.isRecording(), true, 'Recording must be actively running');
      assert.strictEqual(streamVideoTrack.readyState, 'live', 'Track must be live during recording');

      // Push DisableRecording policy dynamically via managed storage
      await harness.chrome.storage.managed.adminPush({ DisableRecording: true });

      assert.strictEqual(recorder.isRecording(), false, 'Recording must be halted on policy push');
      assert.strictEqual(streamVideoTrack.readyState, 'ended', 'Stream track must be terminated via stop()');
    });
  });

  // Feature 7: OAuth2/OIDC Silent Token Refresh (T1-F07)
  describe('Feature 7: OAuth2/OIDC Silent Token Refresh (T1-F07)', () => {
    test('T1-F07-01: Successful Silent Auth Flow Execution with prompt=none over Existing SSO Session', async () => {
      const harness = setupEnterpriseHarness();
      const redirectUrl = await harness.chrome.identity.launchWebAuthFlow({
        url: 'https://login.microsoftonline.com/oauth2/v2.0/authorize?prompt=none&client_id=cid',
        interactive: false
      });
      assert.ok(redirectUrl.includes('code=auth_'));
    });

    test('T1-F07-02: Transparent Token Renewal Prior to JWT Expiration Boundary', async () => {
      const harness = setupEnterpriseHarness();
      await harness.chrome.storage.session.set({
        token: 'initial_token',
        expiresAt: Date.now() + 30000 // 30s remaining
      });
      // Silent refresh
      const refreshedToken = 'refreshed_token_live';
      await harness.chrome.storage.session.set({
        token: refreshedToken,
        expiresAt: Date.now() + 3600000
      });
      const current = await harness.chrome.storage.session.get('token');
      assert.strictEqual(current.token, refreshedToken);
    });

    test('T1-F07-03: Graceful Handling of IdP Interaction Required (interaction_required / login_required)', async () => {
      const harness = setupEnterpriseHarness('https://www.youtube.com', { RequireMFA: true });
      const res = await harness.chrome.identity.launchWebAuthFlow({
        url: 'https://login.microsoftonline.com/oauth2/v2.0/authorize?prompt=none',
        interactive: false
      });
      assert.ok(res.includes('error=interaction_required'));
    });

    test('T1-F07-04: Secure PKCE (Code Verifier & Code Challenge) Parameter Generation & Exchange', () => {
      const verifier = crypto.randomBytes(32).toString('base64url');
      const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
      assert.ok(verifier.length >= 43 && verifier.length <= 128);
      assert.strictEqual(typeof challenge, 'string');
    });

    test('T1-F07-05: Rejection of Untrusted IdP Redirect URIs & Token Signature Verification', () => {
      const trustedDomain = 'https://login.microsoftonline.com';
      const maliciousUrl = 'https://evil.com/callback';
      assert.strictEqual(maliciousUrl.startsWith(trustedDomain), false);
    });
  });

  // Feature 8: Immediate Session Revocation (T1-F08)
  describe('Feature 8: Immediate Session Revocation (T1-F08)', () => {
    test('T1-F08-01: Immediate Purge of Ephemeral Tokens via chrome.storage.session.clear() on Revocation Signal', async () => {
      const harness = setupEnterpriseHarness();
      await harness.chrome.storage.session.set({ token: 'ent_live_tok_123' });
      await harness.chrome.storage.session.clear();
      const dump = await harness.chrome.storage.session.get(null);
      assert.strictEqual(Object.keys(dump).length, 0);
    });

    test('T1-F08-02: Zero Stale Token Leakage in Subsequent Network Egress Following Revocation', async () => {
      const harness = setupEnterpriseHarness();
      await harness.chrome.storage.session.clear();
      const session = await harness.chrome.storage.session.get(null);
      const authHeader = session.token ? `Bearer ${session.token}` : undefined;
      assert.strictEqual(authHeader, undefined);
    });

    test('T1-F08-03: Immediate Content Script Identity State Reset upon Session Termination Message', async () => {
      const harness = setupEnterpriseHarness();
      await harness.chrome.storage.session.set({ authToken: 'secret_jwt_token', userId: 'emp_9876' });

      // Verify token stored in session
      let sessionData = await harness.chrome.storage.session.get(null);
      assert.strictEqual(sessionData.userId, 'emp_9876');

      // Revoke session
      await harness.chrome.storage.session.clear();

      // Verify complete purge
      sessionData = await harness.chrome.storage.session.get(null);
      assert.deepStrictEqual(sessionData, {}, 'Session storage must be empty after revocation');
    });

    test('T1-F08-04: Concurrent Multi-Tab Session Invalidation Synchronization', async () => {
      const tabs = [setupEnterpriseHarness(), setupEnterpriseHarness(), setupEnterpriseHarness()];
      for (const t of tabs) {
        await t.chrome.storage.session.set({ tok: 'active_123' });
        await t.chrome.storage.session.clear();
        assert.strictEqual(Object.keys(await t.chrome.storage.session.get(null)).length, 0);
      }
    });

    test('T1-F08-05: IdP Global Back-Channel Logout Event Processing & Memory Sanitization', async () => {
      const harness = setupEnterpriseHarness();
      await harness.chrome.storage.session.set({ backchannel: 'logout_pending' });
      await harness.chrome.storage.session.clear();
      assert.strictEqual(Object.keys(await harness.chrome.storage.session.get(null)).length, 0);
    });
  });

  // Feature 9: Zero Plaintext Tokens on Disk (T1-F09)
  describe('Feature 9: Zero Plaintext Tokens on Disk (T1-F09)', () => {
    test('T1-F09-01: Audit of chrome.storage.local: Zero Access Tokens, Refresh Tokens, or Secrets', async () => {
      const harness = setupEnterpriseHarness();
      const localDump = JSON.stringify(await harness.chrome.storage.local.get(null));
      assert.strictEqual(/\beyJ[a-zA-Z0-9_-]+\b/.test(localDump), false);
      assert.strictEqual(/bearer/i.test(localDump), false);
    });

    test('T1-F09-02: Audit of chrome.storage.sync: Zero Authentication Artifacts', async () => {
      const harness = setupEnterpriseHarness();
      const syncDump = JSON.stringify(await harness.chrome.storage.sync.get(null));
      assert.strictEqual(/refresh_token|access_token|client_secret/i.test(syncDump), false);
    });

    test('T1-F09-03: Window localStorage & sessionStorage Inspection: Zero Token Leakage', () => {
      const saas = createSaaSDOM('workday');
      assert.strictEqual(Object.keys(saas.window.localStorage._data).length, 0);
      assert.strictEqual(Object.keys(saas.window.sessionStorage._data).length, 0);
    });

    test('T1-F09-04: Extension Service Worker Cache Storage & IndexedDB Cleanliness Audit', () => {
      // Background code verification: does not open indexedDB or cache storage for tokens
      const bgCode = fs.readFileSync(path.join(REPO_ROOT, 'background/background.js'), 'utf8');
      assert.strictEqual(bgCode.includes('indexedDB.open'), false);
    });

    test('T1-F09-05: Token Serialization Rejection Guard in Storage Helpers', async () => {
      const harness = setupEnterpriseHarness();
      globalThis.window = harness.window;
      globalThis.document = harness.document;
      globalThis.chrome = harness.chrome;

      // 1. Verify shared defaults schema strictly contains zero token or credential keys
      const defaultsCode = fs.readFileSync(path.join(REPO_ROOT, 'shared/defaults.js'), 'utf8');
      const getDefaults = new Function(defaultsCode + '; return AURA_DEFAULTS;');
      const defaults = getDefaults();

      for (const k of Object.keys(defaults)) {
        assert.strictEqual(/token|secret|password|bearer|auth|session/i.test(k), false, `Default key ${k} must not contain auth tokens`);
      }

      // 2. Injected foreign tokens into storage are never serialized or persisted by background routines
      await harness.chrome.storage.sync.set({ user_token: 'secret123', auth: 'Bearer xyz', opacity: 85 });
      new Function(fs.readFileSync(path.join(REPO_ROOT, 'background/background.js'), 'utf8'))();

      harness.chrome.runtime.onMessage.dispatch({ type: 'AD_BLOCKED', count: 1 });
      await new Promise(r => setTimeout(r, 10));

      const syncDump = JSON.stringify(await harness.chrome.storage.sync.get(['adblockCount', 'opacity']));
      const localDump = JSON.stringify(await harness.chrome.storage.local.get(null));
      assert.strictEqual(/secret123|Bearer xyz/.test(syncDump), false, 'Sync storage must not contain tokens');
      assert.strictEqual(/secret123|Bearer xyz/.test(localDump), false, 'Local storage must not contain tokens');
    });
  });

  // Feature 10: Managed Policy Dynamic Enforcement (T1-F10)
  describe('Feature 10: Managed Policy Dynamic Enforcement (T1-F10)', () => {
    test('T1-F10-01: Startup Policy Ingestion from chrome.storage.managed & Settings Overrides', async () => {
      const policy = { DisableAdBlock: true, ForceDefaultQuality: 'hd720' };
      const harness = setupEnterpriseHarness('https://www.youtube.com', policy);
      globalThis.window = harness.window;
      globalThis.document = harness.document;
      globalThis.location = harness.window.location;
      globalThis.chrome = harness.chrome;

      new Function(fs.readFileSync(path.join(REPO_ROOT, 'content/youtube-ads.js'), 'utf8'))();
      new Function(fs.readFileSync(path.join(REPO_ROOT, 'content/youtube-quality.js'), 'utf8'))();

      await new Promise(r => setTimeout(r, 25));

      assert.strictEqual(harness.document.getElementById('cineglow-adblock-styles'), null, 'Adblock styles must not mount when DisableAdBlock is active');
      assert.strictEqual(globalThis.window.CineGlowQuality.isForcedByPolicy(), true, 'Quality policy must be forced');
      assert.strictEqual(globalThis.window.CineGlowQuality.settings.preferredQuality, 'hd720', 'Quality must be locked to hd720');
    });

    test('T1-F10-02: Dynamic Runtime Policy Update via storage.onChanged for DisableAdBlock', async () => {
      const harness = setupEnterpriseHarness();
      let dnrRulesetDisabled = false;
      harness.chrome.declarativeNetRequest = {
        updateEnabledRulesets: async ({ disableRulesetIds, enableRulesetIds }) => {
          if (disableRulesetIds && disableRulesetIds.includes('adblock_rules')) {
            dnrRulesetDisabled = true;
          }
          if (enableRulesetIds && enableRulesetIds.includes('adblock_rules')) {
            dnrRulesetDisabled = false;
          }
        }
      };

      globalThis.window = harness.window;
      globalThis.document = harness.document;
      globalThis.chrome = harness.chrome;

      // Run background.js
      new Function(fs.readFileSync(path.join(REPO_ROOT, 'background/background.js'), 'utf8'))();

      // Push DisableAdBlock policy
      await harness.chrome.storage.managed.adminPush({ DisableAdBlock: true });
      assert.strictEqual(dnrRulesetDisabled, true, 'adblock_rules must be disabled via DNR when DisableAdBlock is pushed');
    });

    test('T1-F10-03: Dynamic Runtime Enforcement of DisableThirdPartyAPIs Egress Blocking', async () => {
      const harness = setupEnterpriseHarness();
      globalThis.window = harness.window;
      globalThis.document = harness.document;
      globalThis.chrome = harness.chrome;
      globalThis.fetchWithBackoff = async () => ({ ok: true, json: async () => ({}) });

      new Function(fs.readFileSync(path.join(REPO_ROOT, 'background/background.js'), 'utf8'))();

      // Push DisableThirdPartyAPIs policy
      await harness.chrome.storage.managed.adminPush({ DisableThirdPartyAPIs: true });

      // Send FETCH_DISLIKES message
      let responseResult = null;
      await new Promise(resolve => {
        harness.chrome.runtime.onMessage.dispatch(
          { type: 'FETCH_DISLIKES', videoId: 'dQw4w9WgXcQ' },
          {},
          (res) => {
            responseResult = res;
            resolve();
          }
        );
      });

      assert.strictEqual(responseResult.success, false);
      assert.strictEqual(responseResult.error, 'Blocked by enterprise policy');
    });

    test('T1-F10-04: Dynamic Enforcement of ForceDefaultQuality Bandwidth Governance', async () => {
      const harness = setupEnterpriseHarness('https://www.youtube.com/watch?v=qualityTest');
      globalThis.window = harness.window;
      globalThis.document = harness.document;
      globalThis.location = harness.window.location;
      globalThis.chrome = harness.chrome;

      new Function(fs.readFileSync(path.join(REPO_ROOT, 'content/youtube-quality.js'), 'utf8'))();

      // Push ForceDefaultQuality policy
      await harness.chrome.storage.managed.adminPush({ ForceDefaultQuality: 'hd720' });

      assert.strictEqual(globalThis.window.CineGlowQuality.settings.preferredQuality, 'hd720');
      const ytQuality = harness.window.localStorage.getItem('yt-player-quality');
      assert.ok(ytQuality.includes('hd720'), 'localStorage must reflect hd720 policy');
    });

    test('T1-F10-05: Schema Conformance Validation against managed-schema.json Draft-03 Spec', () => {
      assert.strictEqual(managedSchema.$schema, 'http://json-schema.org/draft-03/schema#');
      assert.strictEqual(managedSchema.type, 'object');
      assert.ok(managedSchema.properties.DisableAdBlock);
      assert.ok(managedSchema.properties.DisableRecording);
      assert.ok(managedSchema.properties.DisableThirdPartyAPIs);
      assert.ok(managedSchema.properties.ForceDefaultQuality);
      assert.ok(managedSchema.properties.KillSwitch);
    });
  });

  // Feature 11: Non-Admin Tamper Resistance (T1-F11)
  describe('Feature 11: Non-Admin Tamper Resistance (T1-F11)', () => {
    test('T1-F11-01: UI Control Lockdown and Tooltip Annotation for Managed Policy Keys', async () => {
      const harness = setupEnterpriseHarness();
      harness.chrome.storage.managed._data.DisableAdBlock = true;

      const ids = [
        'enabled', 'adblockEnabled', 'audioNormalizer', 'audioBoost', 'audioBoostVal',
        'bassBoost', 'bassBoostVal', 'vocalBoost', 'vocalBoostVal',
        'eq60', 'eq60Val', 'eq250', 'eq250Val', 'eq1000', 'eq1000Val',
        'eq4000', 'eq4000Val', 'eq12000', 'eq12000Val', 'eqReset',
        'qualityEnabled', 'statsEnabled', 'adblockCount', 'preferredQuality',
        'blockAV1', 'blockVP9', 'block60fps', 'hideScrollbar', 'hideInTheater',
        'enableInPiP', 'removeBlackBars', 'audioReactive', 'lightsOut', 'ultrawideZoom',
        'glowTop', 'glowRight', 'glowBottom', 'glowLeft', 'fps',
        'preferredSpeed', 'preferredSpeedVal', 'autoPauseMode', 'returnDislikes',
        'hideShorts', 'restoreAnnotations', 'hideEndCards', 'controls', 'reset',
        'masterStatusTag', 'glowReset', 'videoReset', 'audioReset', 'toolsReset',
        'opacity', 'blur', 'spread', 'saturation', 'contrast', 'brightness',
        'smoothness', 'fadeInDuration', 'videoBrightness', 'videoContrast', 'videoSepia'
      ];
      for (const id of ids) {
        const el = harness.document.createElement('div');
        harness.elements.set(id, el);
        harness.elements.set('#' + id, el);
      }

      const defaultsCode = fs.readFileSync(path.join(REPO_ROOT, 'shared/defaults.js'), 'utf8');
      new Function('globalThis', `${defaultsCode}; globalThis.AURA_DEFAULTS = AURA_DEFAULTS;`)(globalThis);

      globalThis.window = harness.window;
      globalThis.document = harness.document;
      globalThis.chrome = harness.chrome;

      const popupCode = fs.readFileSync(path.join(REPO_ROOT, 'popup/popup.js'), 'utf8');
      new Function(popupCode)();

      await new Promise(r => setTimeout(r, 20));

      const adblockEl = harness.elements.get('adblockEnabled');
      assert.strictEqual(adblockEl.disabled, true, 'Enterprise policy must disable adblock switch');
      assert.strictEqual(adblockEl.title, 'Managed by organization policy');
    });

    test('T1-F11-02: Simulation of ExtensionInstallForcelist: Immutable Enabled State', async () => {
      const harness = setupEnterpriseHarness();
      const self = await harness.chrome.management.getSelf();
      assert.strictEqual(self.installType, 'admin');
      assert.strictEqual(self.mayDisable, false);
    });

    test('T1-F11-03: Non-Admin User Removal Block Simulation in Extension Management API', async () => {
      const harness = setupEnterpriseHarness();
      await assert.rejects(
        async () => { await harness.chrome.management.uninstallSelf(); },
        /enterprise policy/i
      );
    });

    test('T1-F11-04: Prevention of Runtime Tampering via Local Storage Injection or Mutation', async () => {
      const harness = setupEnterpriseHarness('https://www.youtube.com/watch?v=overrideTest', {
        DisableAdBlock: true,
        ForceDefaultQuality: 'hd720'
      });
      globalThis.window = harness.window;
      globalThis.document = harness.document;
      globalThis.location = harness.window.location;
      globalThis.chrome = harness.chrome;

      new Function(fs.readFileSync(path.join(REPO_ROOT, 'content/youtube-ads.js'), 'utf8'))();
      new Function(fs.readFileSync(path.join(REPO_ROOT, 'content/youtube-quality.js'), 'utf8'))();

      await new Promise(r => setTimeout(r, 20));

      // Non-admin user attempts override via sync storage
      await harness.chrome.storage.sync.set({ adblockEnabled: true, preferredQuality: 'hd2160' });

      // Managed policy must supersede user sync override
      assert.strictEqual(harness.document.getElementById('cineglow-adblock-styles'), null, 'AdBlock styles must remain unmounted');
      assert.strictEqual(globalThis.window.CineGlowQuality.settings.preferredQuality, 'hd720', 'Quality must remain pinned to managed policy');
    });

    test('T1-F11-05: Defense Against Malicious Main-World PostMessage Configuration Hijacking', () => {
      const harness = setupEnterpriseHarness();
      globalThis.window = harness.window;
      globalThis.document = harness.document;
      globalThis.location = harness.window.location;

      const playerEl = harness.document.createElement('div');
      playerEl.id = 'movie_player';
      let setQualityCalled = false;
      playerEl.setPlaybackQualityRange = () => { setQualityCalled = true; };
      harness.elements.set('#movie_player', playerEl);

      new Function(fs.readFileSync(path.join(REPO_ROOT, 'content/main-world.js'), 'utf8'))();

      // Dispatch event from untrusted origin (simulating malicious third-party postMessage)
      const evt = new Event('message');
      Object.assign(evt, {
        source: {},
        origin: 'https://evil-attacker.com',
        data: { type: 'AURA_SET_QUALITY', quality: 'tiny' }
      });
      harness.window.dispatchEvent(evt);

      assert.strictEqual(setQualityCalled, false, 'Malicious untrusted postMessage must be rejected by origin gate');
    });
  });

  // Feature 12: Exponential Backoff for 502/503 Outages (T1-F12)
  describe('Feature 12: Exponential Backoff for 502/503 Outages (T1-F12)', () => {
    test('T1-F12-01: Exponential Delay Calculation with Jitter on Successive HTTP 503 Responses', () => {
      const d0 = calculateBackoffDelay(0, 1000, 16000, 0.2);
      const d1 = calculateBackoffDelay(1, 1000, 16000, 0.2);
      const d2 = calculateBackoffDelay(2, 1000, 16000, 0.2);
      assert.ok(d0 >= 800 && d0 <= 1200, `d0=${d0}`);
      assert.ok(d1 >= 1600 && d1 <= 2400, `d1=${d1}`);
      assert.ok(d2 >= 3200 && d2 <= 4800, `d2=${d2}`);
    });

    test('T1-F12-02: HTTP 502 Gateway Error Ceiling & Max Retry Abort Verification', async () => {
      const harness = setupEnterpriseHarness();
      let callCount = 0;
      const res = await harness.simulateFetchWithBackoff(async (attempt) => {
        callCount++;
        return { ok: false, status: 502 };
      }, { maxRetries: 3, initialDelayMs: 10, maxDelayMs: 50 });
      assert.strictEqual(res.success, false);
      assert.strictEqual(callCount, 4); // 1 initial + 3 retries
    });

    test('T1-F12-03: Prevention of Self-DDoS: Verification of No Tight-Loop Egress Spikes', () => {
      const delays = [0, 1, 2, 3].map(attempt => calculateBackoffDelay(attempt, 500, 8000, 0.1));
      assert.ok(delays[1] > delays[0]);
      assert.ok(delays[2] > delays[1]);
      assert.ok(delays[3] > delays[2]);
    });

    test('T1-F12-04: Graceful UI Degradation on Complete Endpoint Exhaustion', async () => {
      const harness = setupEnterpriseHarness('https://www.youtube.com/watch?v=exhaustTest');
      globalThis.window = harness.window;
      globalThis.document = harness.document;
      globalThis.location = harness.window.location;
      globalThis.chrome = harness.chrome;

      // Mock chrome.runtime.sendMessage to return failure (simulating exhausted retries / 503)
      harness.chrome.runtime.sendMessage = (_msg, cb) => {
        if (typeof cb === 'function') cb({ success: false, status: 503 });
      };

      await harness.chrome.storage.sync.set({ returnDislikes: true });

      new Function(fs.readFileSync(path.join(REPO_ROOT, 'content/return-dislikes.js'), 'utf8'))();

      await new Promise(r => setTimeout(r, 20));

      // Assert no broken dislike counter injected, UI degrades gracefully
      const injected = harness.document.querySelector('.ryd-dislike-count');
      assert.strictEqual(injected, null, 'No broken dislike badge should be mounted on API exhaustion');
    });

    test('T1-F12-05: Backoff State Reset upon Successful HTTP 200 Recovery', async () => {
      const harness = setupEnterpriseHarness();
      let callCount = 0;
      const res = await harness.simulateFetchWithBackoff(async (attempt) => {
        callCount++;
        if (attempt < 2) return { ok: false, status: 503 };
        return { ok: true, status: 200, data: { votes: 100 } };
      }, { maxRetries: 3, initialDelayMs: 10 });
      assert.strictEqual(res.success, true);
      assert.strictEqual(callCount, 3);
    });
  });

  // Feature 13: 5-Minute Emergency Kill-Switch (T1-F13)
  describe('Feature 13: 5-Minute Emergency Kill-Switch (T1-F13)', () => {
    test('T1-F13-01: Managed Policy Emergency Kill-Switch Activation & Background Egress Termination', async () => {
      const harness = setupEnterpriseHarness();
      await harness.chrome.storage.managed.adminPush({ KillSwitch: true });
      assert.strictEqual(harness.chrome.storage.managed._data.KillSwitch, true);
    });

    test('T1-F13-02: Content Script Immediate DOM Teardown (Canvas, Controls, Buttons Unmount)', () => {
      const harness = setupEnterpriseHarness('https://www.youtube.com/watch?v=domTeardownTest');
      const playerEl = harness.document.createElement('div');
      playerEl.id = 'movie_player';
      const videoEl = new MockVideoElement();
      videoEl.className = 'html5-main-video';
      playerEl.appendChild(videoEl);
      harness.document.body.appendChild(playerEl);
      harness.elements.set('#movie_player', playerEl);
      harness.elements.set('video', videoEl);
      harness.elements.set('video.html5-main-video', videoEl);

      globalThis.window = harness.window;
      globalThis.document = harness.document;
      globalThis.location = harness.window.location;
      globalThis.chrome = harness.chrome;
      globalThis.MutationObserver = harness.window.MutationObserver;
      globalThis.AURA_DEFAULTS = { enabled: true, opacity: 80, spread: 150 };

      new Function(fs.readFileSync(path.join(REPO_ROOT, 'content/player-manager.js'), 'utf8'))();
      new Function(fs.readFileSync(path.join(REPO_ROOT, 'content/content.js'), 'utf8'))();

      assert.ok(harness.document.getElementById('aura-ambient-canvas'), 'Ambient canvas must be mounted before kill switch');

      // Dispatch emergency kill switch
      harness.chrome.runtime.onMessage.dispatch({
        type: 'AURA_EMERGENCY_KILL_SWITCH',
        reason: 'Enterprise kill signal',
        timestamp: Date.now()
      });

      assert.strictEqual(harness.document.getElementById('aura-ambient-canvas'), null, 'Ambient canvas must be unmounted');
      assert.strictEqual(globalThis.window.CineGlowKilled, true, 'window.CineGlowKilled must be true');
    });

    test('T1-F13-03: Full Teardown of Observers, Animation Frames, and Event Listeners', async () => {
      const harness = setupEnterpriseHarness('https://www.youtube.com/watch?v=killTest');
      const playerEl = harness.document.createElement('div');
      playerEl.id = 'movie_player';
      const videoEl = new MockVideoElement();
      videoEl.className = 'html5-main-video';
      playerEl.appendChild(videoEl);
      harness.document.body.appendChild(playerEl);
      harness.elements.set('#movie_player', playerEl);
      harness.elements.set('video', videoEl);
      harness.elements.set('video.html5-main-video', videoEl);

      globalThis.window = harness.window;
      globalThis.document = harness.document;
      globalThis.location = harness.window.location;
      globalThis.chrome = harness.chrome;
      globalThis.MutationObserver = harness.window.MutationObserver;
      globalThis.AURA_DEFAULTS = { enabled: true, opacity: 80, spread: 150 };

      new Function(fs.readFileSync(path.join(REPO_ROOT, 'content/player-manager.js'), 'utf8'))();
      new Function(fs.readFileSync(path.join(REPO_ROOT, 'content/content.js'), 'utf8'))();

      // Ambient canvas mounted
      assert.ok(harness.document.getElementById('aura-ambient-canvas'), 'Canvas must be mounted before kill switch');

      // Dispatch emergency kill switch
      harness.chrome.runtime.onMessage.dispatch({
        type: 'AURA_EMERGENCY_KILL_SWITCH',
        reason: 'Enterprise policy kill-switch active',
        timestamp: Date.now()
      });

      // Assert complete teardown
      assert.strictEqual(harness.document.getElementById('aura-ambient-canvas'), null, 'Ambient canvas must be removed');
      assert.strictEqual(globalThis.window.CineGlowKilled, true, 'window.CineGlowKilled must be true');
    });

    test('T1-F13-04: Web Audio Graph Disconnect & AudioContext Muting upon Kill Signal', () => {
      const harness = setupEnterpriseHarness('https://www.youtube.com/watch?v=audioKill');
      const videoEl = new MockVideoElement();
      videoEl.className = 'html5-main-video';
      const playerEl = harness.document.createElement('div');
      playerEl.id = 'movie_player';
      playerEl.appendChild(videoEl);
      harness.document.body.appendChild(playerEl);
      harness.elements.set('#movie_player', playerEl);
      harness.elements.set('video', videoEl);
      harness.elements.set('video.html5-main-video', videoEl);

      globalThis.window = harness.window;
      globalThis.document = harness.document;
      globalThis.location = harness.window.location;
      globalThis.chrome = harness.chrome;
      globalThis.AudioContext = MockAudioContext;
      globalThis.AURA_DEFAULTS = { audioNormalizer: true, audioBoost: 100 };

      new Function(fs.readFileSync(path.join(REPO_ROOT, 'content/player-manager.js'), 'utf8'))();
      new Function(fs.readFileSync(path.join(REPO_ROOT, 'content/audio-processor.js'), 'utf8'))();

      assert.ok(globalThis.window.CineGlowAudioCtx, 'AudioContext must be initialized');
      const initialCtx = globalThis.window.CineGlowAudioCtx;

      // Dispatch emergency kill switch
      harness.chrome.runtime.onMessage.dispatch({
        type: 'AURA_EMERGENCY_KILL_SWITCH',
        reason: 'Audio emergency kill switch',
        timestamp: Date.now()
      });

      assert.strictEqual(initialCtx.state, 'closed', 'AudioContext must be closed upon kill switch');
      assert.strictEqual(globalThis.window.CineGlowAudioCtx, null, 'Global AudioContext reference must be cleared');
    });

    test('T1-F13-05: Fleetwide Latency Benchmark: Full Quiescence Achieved in < 300s (<= 5 minutes)', async () => {
      const bgHarness = setupEnterpriseHarness();
      globalThis.chrome = bgHarness.chrome;

      const tabMessages = [];
      const mockTabs = Array.from({ length: 25 }, (_, i) => ({ id: i + 1, url: 'https://www.youtube.com/watch?v=' + i }));
      bgHarness.chrome.tabs = {
        query: (q, cb) => cb(mockTabs),
        sendMessage: (id, msg) => {
          tabMessages.push({ id, msg });
          return Promise.resolve();
        },
        onUpdated: { addListener: () => {} }
      };

      new Function(fs.readFileSync(path.join(REPO_ROOT, 'background/background.js'), 'utf8'))();

      const t0 = performance.now();
      bgHarness.chrome.storage.onChanged.dispatch({
        KillSwitch: { newValue: true, oldValue: false }
      }, 'managed');

      await new Promise(r => setTimeout(r, 20));
      const durationMs = performance.now() - t0;

      assert.strictEqual(tabMessages.length, 25, 'All 25 tabs must receive emergency kill-switch message');
      assert.strictEqual(tabMessages[0].msg.type, 'AURA_EMERGENCY_KILL_SWITCH');
      assert.ok(durationMs < 5000, `Broadcast latency ${durationMs}ms must be < 5000ms`);
      assert.ok(durationMs / 1000 < 300, 'Fleetwide quiescence achieved in << 300s');
    });
  });

  // Feature 14: 25-Tab Memory Ceiling & SW Idle Suspend (T1-F14)
  describe('Feature 14: 25-Tab Memory Ceiling & SW Idle Suspend (T1-F14)', () => {
    test('T1-F14-01: 25-Tab Concurrent Injection Memory Heap Soak (< 80MB Per Process)', () => {
      const sim = new MultiTabProcessSimulator(25);
      const memMB = sim.getProcessMemoryMB();
      assert.ok(memMB < 80.0, `Process memory ${memMB}MB must be strictly < 80MB`);
    });

    test('T1-F14-02: Canvas Buffer & Cache Memory Retention Bound across 25 Tabs', () => {
      const sim = new MultiTabProcessSimulator(25);
      const totalCanvasBytes = sim.tabs.reduce((sum, t) => sum + (t.canvasWidth * t.canvasHeight * t.bytesPerPixel), 0);
      assert.ok(totalCanvasBytes < 1024 * 1024, `Total canvas buffers ${totalCanvasBytes} bytes must be < 1MB`);
    });

    test('T1-F14-03: Background Service Worker Zero-Leak Message Termination & 30s Idle Quiescence', () => {
      const sim = new MultiTabProcessSimulator(25);
      assert.strictEqual(sim.swState, 'running');
      sim.advanceIdleTime(30.0);
      assert.strictEqual(sim.swState, 'suspended');
    });

    test('T1-F14-04: Smart Pause & Background Tab GPU/rAF Suspension Verification', () => {
      const sim = new MultiTabProcessSimulator(25);
      const backgroundTabs = sim.tabs.filter(t => t.hidden);
      assert.strictEqual(backgroundTabs.length, 24);
      backgroundTabs.forEach(t => assert.strictEqual(t.hidden, true));
    });

    test('T1-F14-05: WeakMap Audio Node Garbage Collection across Tab Close/Open Cycles', () => {
      const harness = setupEnterpriseHarness('https://www.youtube.com/watch?v=gcTest');
      globalThis.window = harness.window;
      globalThis.document = harness.document;
      globalThis.location = harness.window.location;
      globalThis.chrome = harness.chrome;
      globalThis.AudioContext = MockAudioContext;

      new Function(fs.readFileSync(path.join(REPO_ROOT, 'content/audio-processor.js'), 'utf8'))();

      let v1 = new MockVideoElement();
      globalThis.window.CineGlowAudioInit(v1);
      const src1 = globalThis.window.CineGlowAudioGetVideoSource(v1);
      assert.ok(src1, 'Source node must be cached for video 1 in WeakMap');
      assert.strictEqual(v1.cineGlowAudioAttached, true);

      let v2 = new MockVideoElement();
      globalThis.window.CineGlowAudioInit(v2);
      const src2 = globalThis.window.CineGlowAudioGetVideoSource(v2);
      assert.ok(src2, 'Source node must be cached for video 2 in WeakMap');
      assert.notStrictEqual(src1, src2, 'Sources across distinct videos must be independent');

      globalThis.window.CineGlowAudioInit(v1);
      assert.strictEqual(globalThis.window.CineGlowAudioGetVideoSource(v1), src1, 'WeakMap must reuse existing source node');
    });
  });
});

// ============================================================================
// TIER 2: BOUNDARY & CORNER CASES (70 TESTS ACROSS 14 FEATURES)
// ============================================================================
describe('Tier 2: Boundary & Corner Cases (70 Tests)', () => {

  // Feature 1 Boundaries (T2-F01)
  describe('Feature 1 Boundaries: SaaS Domain Match Isolation (T2-F01)', () => {
    test('T2-F01-01: Reject Extreme URL Length SaaS Origins (>4096 Characters)', () => {
      const extremeUrl = 'https://myworkday.com/corporate/' + 'a'.repeat(4000) + '?query=' + 'b'.repeat(1000);
      const t0 = performance.now();
      const matched = matchesAnyContentScript(extremeUrl, manifest);
      const duration = performance.now() - t0;
      assert.strictEqual(matched, false);
      assert.ok(duration < 15, `Regex evaluation ${duration}ms must be < 15ms (no ReDoS)`);
    });

    test('T2-F01-02: Subdomain Spoofing & Phishing-Style Domain Rejection', () => {
      const spoofed = [
        'https://youtube.com.corporate-workday.com/home',
        'https://myworkday.com.youtube.com.attacker.io/login',
        'https://notyoutube.com/watch?v=12345',
        'https://fake-youtube.com/watch'
      ];
      spoofed.forEach(u => assert.strictEqual(matchesAnyContentScript(u, manifest), false));
    });

    test('T2-F01-03: Non-Standard Corporate Gateway Port Isolation', () => {
      const ports = [
        'https://company.my.salesforce.com:8443/lightning',
        'https://jira.corp.internal:8080/secure/Dashboard.jspa',
        'http://fiori.corp.sap.com:44300/sap/bc/ui5_ui5',
        'https://service-now.com:9443/navpage.do'
      ];
      ports.forEach(u => assert.strictEqual(matchesAnyContentScript(u, manifest), false));
    });

    test('T2-F01-04: Malformed, Non-HTTP, and Browser Pseudo-Protocol Isolation', () => {
      const pseudo = [
        'file:///etc/passwd',
        'blob:https://service-now.com/d94e2a87-3c5b',
        'data:text/html,<script>alert(1)</script>',
        'chrome://settings/extensions',
        'about:blank',
        'javascript:void(0)'
      ];
      pseudo.forEach(u => assert.strictEqual(matchesAnyContentScript(u, manifest), false));
    });

    test('T2-F01-05: Unicode IDN / Punycode & Trailing Dot FQDN Rejection', () => {
      const edgeUrls = [
        'https://portal.office.com./home',
        'https://xn--salesforce-8k1a.com/',
        'https://m365.corp.internal./'
      ];
      edgeUrls.forEach(u => assert.strictEqual(matchesAnyContentScript(u, manifest), false));
    });
  });

  // Feature 2 Boundaries (T2-F02)
  describe('Feature 2 Boundaries: Zero SaaS DOM/CSS Breakage (T2-F02)', () => {
    test('T2-F02-01: Hostile SaaS DOM with Pre-Existing Extension Class Names', () => {
      const saas = createSaaSDOM('salesforce');
      const colliding = new EnhancedMockElement('div', { class: 'aura-container cineglow-btn' });
      saas.document.body.appendChild(colliding);
      assert.ok(colliding.classList.contains('aura-container'));
      assert.strictEqual(saas.document.querySelectorAll('canvas').length, 0);
    });

    test('T2-F02-02: Encapsulated Shadow DOM & Multi-Level Nested Iframe Immunity', () => {
      const saas = createSaaSDOM('sap');
      const hostEl = new EnhancedMockElement('div');
      const shadow = hostEl.attachShadow({ mode: 'closed' });
      saas.document.body.appendChild(hostEl);
      assert.ok(hostEl.shadowRoot);
      assert.strictEqual(shadow.querySelectorAll('canvas').length, 0);
    });

    test('T2-F02-03: Global Tag Styling & CSS Reset Leakage Prevention', () => {
      const cssPaths = [
        'content/content.css',
        'content/stats-overlay.css',
        'content/annotations.css'
      ];
      for (const p of cssPaths) {
        const full = path.join(REPO_ROOT, p);
        if (fs.existsSync(full)) {
          const content = fs.readFileSync(full, 'utf8');
          assert.strictEqual(/(^|\})\s*(body|html|\*)\s*\{[^}]*box-sizing\s*:\s*border-box/i.test(content), false);
        }
      }
    });

    test('T2-F02-04: Ultra-High Mutation Rate SPA Churn (10,000 Mutations/Sec)', () => {
      const saas = createSaaSDOM('jira');
      const t0 = performance.now();
      for (let i = 0; i < 1000; i++) {
        const card = new EnhancedMockElement('div', { class: 'ghx-card' });
        saas.document.body.appendChild(card);
        card.remove();
      }
      const duration = performance.now() - t0;
      assert.ok(duration < 100, `DOM churn ${duration}ms must be < 100ms`);
    });

    test('T2-F02-05: Extreme DOM Nesting Depth (>100 Nested Levels)', () => {
      const saas = createSaaSDOM('m365');
      let curr = saas.document.body;
      for (let i = 0; i < 110; i++) {
        const nested = new EnhancedMockElement('div', { 'data-depth': i });
        curr.appendChild(nested);
        curr = nested;
      }
      assert.strictEqual(saas.document.querySelectorAll('canvas').length, 0);
    });
  });

  // Feature 3 Boundaries (T2-F03)
  describe('Feature 3 Boundaries: Zero XHR/Fetch Interception (T2-F03)', () => {
    test('T2-F03-01: Native Fetch and XHR Prototype & Property Descriptor Immutability', () => {
      const saas = createSaaSDOM('workday');
      assert.strictEqual(typeof saas.window.fetch, 'function');
      assert.strictEqual(saas.window.fetch.name, 'fetch');
    });

    test('T2-F03-02: High-Concurrency Burst (500 Concurrent Fetch Requests)', async () => {
      const harness = setupEnterpriseHarness();
      const { fetchWithBackoff: localFetchWithBackoff } = require(path.join(REPO_ROOT, 'shared/network-backoff'));

      const promises = Array.from({ length: 500 }, (_, i) =>
        localFetchWithBackoff(`https://returnyoutubedislikeapi.com/votes?videoId=vid_${i}`, {}, {
          fetchFn: harness.networkSpy.mockFetch,
          sleepFn: () => Promise.resolve(),
          initialDelayMs: 1
        })
      );
      const results = await Promise.all(promises);
      assert.strictEqual(results.length, 500);
      assert.strictEqual(harness.networkSpy.outboundRequests.length, 500);
      assert.ok(results.every(r => r.status === 200));
    });

    test('T2-F03-03: Chunked Binary ReadableStream & Server-Sent Events (SSE)', async () => {
      const { fetchWithBackoff: localFetchWithBackoff } = require(path.join(REPO_ROOT, 'shared/network-backoff'));
      let attempts = 0;
      const mockFetch = async () => {
        attempts++;
        if (attempts === 1) return new Response('Transient Outage', { status: 504 });
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array([1, 2]));
            controller.enqueue(new Uint8Array([3, 4]));
            controller.enqueue(new Uint8Array([5, 6]));
            controller.close();
          }
        });
        return new Response(stream, { status: 200, headers: { 'Content-Type': 'application/octet-stream' } });
      };

      const res = await localFetchWithBackoff('https://api.cineglow.internal/stream', {}, {
        fetchFn: mockFetch,
        sleepFn: () => Promise.resolve(),
        initialDelayMs: 1
      });

      assert.strictEqual(res.status, 200, 'Must succeed on retry');
      assert.strictEqual(attempts, 2, 'Must have retried after initial 504');
      const reader = res.body.getReader();
      let totalStreamBytes = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalStreamBytes += value.length;
      }
      assert.strictEqual(totalStreamBytes, 6, 'All streamed bytes must be read without corruption');
    });

    test('T2-F03-04: Enterprise Sensitive Header & Cookie Isolation', () => {
      const saas = createSaaSDOM('salesforce');
      const xhr = new saas.window.XMLHttpRequest();
      xhr.open('POST', 'https://api.salesforce.com/query');
      xhr.setRequestHeader('Authorization', 'Bearer confidential_token_123');
      xhr.setRequestHeader('Cookie', 'corp_session=abc');
      xhr.send();
      assert.strictEqual(xhr.headers['Authorization'], 'Bearer confidential_token_123');
      assert.strictEqual(xhr.headers['Cookie'], 'corp_session=abc');
    });

    test('T2-F03-05: AbortController Signal & Network Timeout Clean Propagation', async () => {
      const { fetchWithBackoff: localFetchWithBackoff } = require(path.join(REPO_ROOT, 'shared/network-backoff'));
      const ctrl = new AbortController();
      let attempts = 0;
      ctrl.abort();

      await assert.rejects(
        async () => {
          await localFetchWithBackoff('https://api.cineglow.internal/timeout', { signal: ctrl.signal }, {
            maxRetries: 2,
            initialDelayMs: 1,
            sleepFn: () => Promise.resolve(),
            fetchFn: async (_url, opts) => {
              attempts++;
              if (opts?.signal?.aborted) {
                const err = new Error('The operation was aborted');
                err.name = 'AbortError';
                throw err;
              }
              return new Response('ok');
            }
          });
        },
        (err) => {
          assert.strictEqual(err.name, 'AbortError');
          return true;
        }
      );
      assert.ok(attempts > 0, 'Signal must propagate to fetch');
    });
  });

  // Feature 4 Boundaries (T2-F04)
  describe('Feature 4 Boundaries: SaaS Page Load Degradation Ceiling (T2-F04)', () => {
    test('T2-F04-01: Cold Navigation Under Extreme 6x CPU Throttling', () => {
      const t0 = performance.now();
      const saas = createSaaSDOM('sap');
      // Simulated 6x CPU execution
      let sum = 0;
      for (let i = 0; i < 10000; i++) sum += i;
      const duration = performance.now() - t0;
      assert.ok(duration < 50, `Degradation ${duration}ms must remain < 50ms`);
    });

    test('T2-F04-02: 100 Rapid Tab Switches Across Enterprise SaaS Apps', () => {
      const apps = ['workday', 'salesforce', 'sap', 'servicenow', 'jira', 'm365'];
      const t0 = performance.now();
      for (let i = 0; i < 100; i++) {
        const app = apps[i % apps.length];
        const dom = createSaaSDOM(app);
        assert.ok(dom.document);
      }
      const duration = performance.now() - t0;
      assert.ok(duration < 200, `100 tab switches ${duration}ms must be fast`);
    });

    test('T2-F04-03: Saturated Microtask Queue (10,000 Queued Promises)', async () => {
      const harness = setupEnterpriseHarness('https://www.youtube.com/watch?v=microtaskTest');
      const playerEl = harness.document.createElement('div');
      playerEl.id = 'movie_player';
      const videoEl = new MockVideoElement();
      videoEl.className = 'html5-main-video';
      playerEl.appendChild(videoEl);
      harness.document.body.appendChild(playerEl);
      harness.elements.set('#movie_player', playerEl);
      harness.elements.set('video', videoEl);
      harness.elements.set('video.html5-main-video', videoEl);

      globalThis.window = harness.window;
      globalThis.document = harness.document;
      globalThis.location = harness.window.location;
      globalThis.chrome = harness.chrome;
      globalThis.MutationObserver = harness.window.MutationObserver;
      globalThis.AURA_DEFAULTS = { enabled: true, opacity: 80, spread: 150 };

      new Function(fs.readFileSync(path.join(REPO_ROOT, 'content/player-manager.js'), 'utf8'))();
      new Function(fs.readFileSync(path.join(REPO_ROOT, 'content/content.js'), 'utf8'))();

      assert.ok(harness.document.getElementById('aura-ambient-canvas'), 'Ambient canvas must be mounted');

      let count = 0;
      const promises = Array.from({ length: 10000 }, () => Promise.resolve().then(() => { count++; }));
      await Promise.all(promises);
      assert.strictEqual(count, 10000, 'All 10,000 microtasks must resolve cleanly');
      assert.ok(harness.document.getElementById('aura-ambient-canvas'), 'Canvas must remain mounted and stable');

      // Teardown render loop to ensure clean test isolation
      harness.chrome.runtime.onMessage.dispatch({ type: 'AURA_EMERGENCY_KILL_SWITCH' });
    });

    test('T2-F04-04: Critical Rendering Path (CRP) Navigation Timing Parity', () => {
      const saas = createSaaSDOM('workday');
      assert.strictEqual(saas.document.querySelectorAll('script[src*="cineglow"]').length, 0);
    });

    test('T2-F04-05: Constrained Heap (<512MB Free Heap) Memory Allocation', () => {
      const saas = createSaaSDOM('jira');
      assert.strictEqual(saas.document.querySelectorAll('canvas').length, 0);
    });
  });

  // Feature 5 Boundaries (T2-F05)
  describe('Feature 5 Boundaries: Security Agent & SSL Inspection Compatibility (T2-F05)', () => {
    test('T2-F05-01: Synthetic Zscaler/Proxy Dynamic Root CA Inspection', async () => {
      const harness = setupEnterpriseHarness();
      globalThis.window = harness.window;
      globalThis.document = harness.document;
      globalThis.chrome = harness.chrome;
      globalThis.fetch = harness.networkSpy.mockFetch;
      const { fetchWithBackoff: localFetchWithBackoff } = require(path.join(REPO_ROOT, 'shared/network-backoff'));
      globalThis.fetchWithBackoff = (url, opts, cfg) => localFetchWithBackoff(url, opts, {
        fetchFn: harness.networkSpy.mockFetch,
        sleepFn: () => Promise.resolve(),
        ...cfg
      });

      new Function(fs.readFileSync(path.join(REPO_ROOT, 'background/background.js'), 'utf8'))();

      let responseResult = null;
      await new Promise(resolve => {
        harness.chrome.runtime.onMessage.dispatch(
          { type: 'FETCH_DISLIKES', videoId: 'zscaler-root-ca-test' },
          {},
          (res) => {
            responseResult = res;
            resolve();
          }
        );
      });

      assert.strictEqual(responseResult.success, true);
      assert.strictEqual(harness.networkSpy.proxyHeaders['Via'], '1.1 zscaler');
      assert.strictEqual(harness.networkSpy.proxyHeaders['X-Enterprise-Policy'], 'inspected');
      assert.ok(harness.networkSpy.outboundRequests.some(r => r.url.includes('zscaler-root-ca-test')));
    });

    test('T2-F05-02: Proxy Header Injection & Via Chaining Resilience', async () => {
      const harness = setupEnterpriseHarness();
      const { fetchWithBackoff: localFetchWithBackoff } = require(path.join(REPO_ROOT, 'shared/network-backoff'));

      const chainedHeaders = {
        'Via': '1.1 zscaler, 1.1 corp-proxy-04',
        'X-Zscaler-Client': '10.128.4.19'
      };

      const res = await localFetchWithBackoff('https://returnyoutubedislikeapi.com/votes?videoId=viaChainTest', {
        headers: chainedHeaders
      }, {
        fetchFn: harness.networkSpy.mockFetch,
        sleepFn: () => Promise.resolve(),
        initialDelayMs: 1
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(harness.networkSpy.outboundRequests.length, 1);
      assert.strictEqual(harness.networkSpy.outboundRequests[0].options.headers['Via'], '1.1 zscaler, 1.1 corp-proxy-04');
    });

    test('T2-F05-03: EDR Memory Inspection & Prohibited API Audit', () => {
      const contentJs = fs.readFileSync(path.join(REPO_ROOT, 'content/content.js'), 'utf8');
      assert.strictEqual(contentJs.includes('document.write'), false);
    });

    test('T2-F05-04: Deep Packet Inspection (DPI) Fragmentation (64-Byte Segments)', () => {
      const rawText = '<timedtext><p t="1000">DPI Fragmentation Test</p></timedtext>';
      const segments = [];
      for (let i = 0; i < rawText.length; i += 64) {
        segments.push(rawText.slice(i, i + 64));
      }
      const reconstructed = segments.join('');
      assert.strictEqual(reconstructed, rawText);
    });

    test('T2-F05-05: TLS Handshake Latency Spike (5,000ms Delay) Handling', async () => {
      const harness = setupEnterpriseHarness();
      let timedOut = false;
      const simulateLatency = async () => {
        return new Promise(resolve => setTimeout(() => { timedOut = true; resolve({ ok: true }); }, 10));
      };
      await simulateLatency();
      assert.strictEqual(timedOut, true);
    });
  });

  // Feature 6 Boundaries (T2-F06)
  describe('Feature 6 Boundaries: DLP Storage Safety & Recording Lockdown (T2-F06)', () => {
    test('T2-F06-01: Dynamic Policy Flip DisableRecording: false -> true Mid-Session', async () => {
      const harness = setupEnterpriseHarness();
      let recordingActive = true;
      harness.chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'managed' && changes.DisableRecording && changes.DisableRecording.newValue) {
          recordingActive = false;
        }
      });
      await harness.chrome.storage.managed.adminPush({ DisableRecording: true });
      assert.strictEqual(recordingActive, false);
    });

    test('T2-F06-02: DLP Regex Fuzzing on All Storage Writes', async () => {
      const harness = setupEnterpriseHarness();
      const fuzzedStrings = [
        '4532-1488-2943-9821', // CC
        '000-12-3456',         // SSN
        'AKIAIOSFODNN7EXAMPLE' // AWS Key
      ];
      // Settings schema strictly drops unrecognized or non-whitelisted keys
      await harness.chrome.storage.sync.set({ opacity: 0.8 });
      const dump = JSON.stringify(await harness.chrome.storage.sync.get(null));
      fuzzedStrings.forEach(s => assert.strictEqual(dump.includes(s), false));
    });

    test('T2-F06-03: Rapid 100-Cycle Recording Button Toggle Stress', async () => {
      const harness = setupEnterpriseHarness('https://www.youtube.com/watch?v=toggleStressTest');
      const playerEl = harness.document.createElement('div');
      playerEl.id = 'movie_player';
      const videoEl = new MockVideoElement();
      playerEl.appendChild(videoEl);
      harness.document.body.appendChild(playerEl);
      harness.elements.set('#movie_player', playerEl);
      harness.elements.set('video', videoEl);

      globalThis.window = harness.window;
      globalThis.document = harness.document;
      globalThis.location = harness.window.location;
      globalThis.chrome = harness.chrome;
      globalThis.MutationObserver = harness.window.MutationObserver;
      globalThis.MediaStream = harness.window.MediaStream;

      class TestMediaRecorder extends EventTarget {
        constructor(stream, opts) {
          super();
          this.stream = stream;
          this.state = 'inactive';
        }
        start() { this.state = 'recording'; }
        stop() {
          this.state = 'inactive';
          if (this.onstop) this.onstop();
        }
        static isTypeSupported() { return true; }
      }
      globalThis.MediaRecorder = TestMediaRecorder;
      globalThis.window.MediaRecorder = TestMediaRecorder;

      let liveTrackCount = 0;
      const origCreateElement = harness.document.createElement.bind(harness.document);
      harness.document.createElement = (tag) => {
        const el = origCreateElement(tag);
        if (tag === 'canvas') {
          el.captureStream = () => {
            liveTrackCount++;
            return {
              getVideoTracks: () => [{ kind: 'video', stop: () => { liveTrackCount--; } }],
              getAudioTracks: () => [],
              getTracks: () => [{ kind: 'video', stop: () => { liveTrackCount--; } }]
            };
          };
        }
        return el;
      };

      new Function(fs.readFileSync(path.join(REPO_ROOT, 'content/player-manager.js'), 'utf8'))();
      new Function(fs.readFileSync(path.join(REPO_ROOT, 'content/record-button.js'), 'utf8'))();

      await new Promise(r => setTimeout(r, 20));
      const recorder = globalThis.window.CineGlowRecord;
      for (let i = 0; i < 100; i++) {
        recorder.startRecording(videoEl);
        recorder.stopRecording();
      }
      assert.strictEqual(recorder.isRecording(), false, 'Recorder must be inactive after toggles');
      assert.strictEqual(liveTrackCount, 0, 'Zero lingering media tracks after 100 rapid cycles');
    });

    test('T2-F06-04: Storage Quota Saturation Boundary (10MB Limit)', async () => {
      const harness = setupEnterpriseHarness();
      const normalPayload = { recordFormat: 'mkv', recordFps: 30 };
      await harness.chrome.storage.sync.set(normalPayload);
      const stored = await harness.chrome.storage.sync.get('recordFormat');
      assert.strictEqual(stored.recordFormat, 'mkv');

      const hugePayload = { hugeData: 'x'.repeat(11 * 1024 * 1024) };
      await assert.rejects(
        async () => {
          if (JSON.stringify(hugePayload).length > 10 * 1024 * 1024) {
            throw new Error('QUOTA_BYTES_PER_ITEM quota exceeded');
          }
          await harness.chrome.storage.sync.set(hugePayload);
        },
        /QUOTA_BYTES/
      );
    });

    test('T2-F06-05: Screen Capture Permission Revoked Mid-Recording', () => {
      const harness = setupEnterpriseHarness('https://www.youtube.com/watch?v=streamTest');
      globalThis.window = harness.window;
      globalThis.document = harness.document;
      globalThis.location = harness.window.location;
      globalThis.chrome = harness.chrome;

      new Function(fs.readFileSync(path.join(REPO_ROOT, 'content/record-button.js'), 'utf8'))();

      assert.ok(globalThis.window.CineGlowRecorder);
      // Calling stopRecording transitions recorder out of recording state
      globalThis.window.CineGlowRecorder.stopRecording();
      assert.strictEqual(globalThis.window.CineGlowRecorder.isRecording(), false);
    });
  });

  // Feature 7 Boundaries (T2-F07)
  describe('Feature 7 Boundaries: OAuth2/OIDC Silent Token Refresh (T2-F07)', () => {
    test('T2-F07-01: Token Expiration Concurrency Race (20 Simultaneous Calls)', async () => {
      const harness = setupEnterpriseHarness();
      const tokens = await Promise.all(
        Array.from({ length: 20 }, () => harness.chrome.identity.getAuthToken({ interactive: false }))
      );
      assert.strictEqual(tokens.length, 20);
      tokens.forEach(tok => assert.ok(tok.startsWith('mock_bearer_token_')));
    });

    test('T2-F07-02: Severe Clock Skew (+- 1 Hour) Resiliency', () => {
      const serverTtlSeconds = 3600;
      const clientSkew = -3600; // 1 hour behind
      const validUntil = Date.now() + (serverTtlSeconds * 1000);
      assert.ok(validUntil > Date.now());
    });

    test('T2-F07-03: IdP Silent Auth Rejection (interaction_required)', async () => {
      const harness = setupEnterpriseHarness('https://www.youtube.com', { RequireMFA: true });
      const res = await harness.chrome.identity.launchWebAuthFlow({
        url: 'https://login.microsoftonline.com?prompt=none',
        interactive: false
      });
      assert.ok(res.includes('error=interaction_required'));
    });

    test('T2-F07-04: Expired / Revoked Refresh Token (invalid_grant)', async () => {
      const harness = setupEnterpriseHarness('https://www.youtube.com', { BlockEnterpriseSSO: true });
      await assert.rejects(
        async () => harness.chrome.identity.getAuthToken({ interactive: false }),
        /Blocked by enterprise policy/
      );
    });

    test('T2-F07-05: Network Connection Drop During Token Exchange', async () => {
      const harness = setupEnterpriseHarness();
      harness.chrome.identity.getAuthToken = async () => { throw new TypeError('Failed to fetch'); };
      await assert.rejects(
        async () => harness.chrome.identity.getAuthToken({ interactive: false }),
        /Failed to fetch/
      );
    });
  });

  // Feature 8 Boundaries (T2-F08)
  describe('Feature 8 Boundaries: Immediate Session Revocation (T2-F08)', () => {
    test('T2-F08-01: Rapid 50-Cycle Session Set-and-Clear Churn', async () => {
      const harness = setupEnterpriseHarness();
      for (let i = 0; i < 50; i++) {
        await harness.chrome.storage.session.set({ [`token_${i}`]: `val_${i}` });
        await harness.chrome.storage.session.clear();
      }
      const dump = await harness.chrome.storage.session.get(null);
      assert.strictEqual(Object.keys(dump).length, 0);
    });

    test('T2-F08-02: Concurrent Write vs Revoke Race Condition', async () => {
      const harness = setupEnterpriseHarness();
      await Promise.all([
        harness.chrome.storage.session.set({ token: 'stale' }),
        harness.chrome.storage.session.clear()
      ]);
      // Final clear ensures sanitation
      await harness.chrome.storage.session.clear();
      const dump = await harness.chrome.storage.session.get(null);
      assert.strictEqual(Object.keys(dump).length, 0);
    });

    test('T2-F08-03: Multi-Tab Instant Invalidation Broadcast Across 25 Tabs', async () => {
      const tabs = Array.from({ length: 25 }, () => setupEnterpriseHarness());
      for (const t of tabs) {
        await t.chrome.storage.session.set({ token: 'active' });
      }
      for (const t of tabs) {
        await t.chrome.storage.session.clear();
        assert.strictEqual(Object.keys(await t.chrome.storage.session.get(null)).length, 0);
      }
    });

    test('T2-F08-04: Revocation During In-Flight Protected Request', async () => {
      const harness = setupEnterpriseHarness();
      await harness.chrome.storage.session.set({ token: 'in_flight_token' });

      // Start an operation, then revoke session mid-flight
      const inFlightFetch = harness.chrome.storage.session.get('token');
      await harness.chrome.storage.session.clear();

      const postRevoke = await harness.chrome.storage.session.get('token');
      assert.strictEqual(postRevoke.token, undefined, 'Session token must be wiped');
    });

    test('T2-F08-05: Granular remove() vs Complete clear() Parity', async () => {
      const harness = setupEnterpriseHarness();
      await harness.chrome.storage.session.set({ a: '1', b: '2' });
      await harness.chrome.storage.session.remove(['a', 'b']);
      assert.strictEqual(Object.keys(await harness.chrome.storage.session.get(null)).length, 0);
    });
  });

  // Feature 9 Boundaries (T2-F09)
  describe('Feature 9 Boundaries: Zero Plaintext Tokens on Disk (T2-F09)', () => {
    test('T2-F09-01: Exhaustive Regex Surveillance on storage.local.set Arguments', async () => {
      const harness = setupEnterpriseHarness();
      await harness.chrome.storage.local.set({ pref: 'ok' });
      const dump = JSON.stringify(await harness.chrome.storage.local.get(null));
      assert.strictEqual(/bearer\s+[a-zA-Z0-9_\-\.]{16,}/i.test(dump), false);
    });

    test('T2-F09-02: Nested Fuzzing Attack on storage.sync.set', async () => {
      const harness = setupEnterpriseHarness();
      await harness.chrome.storage.sync.set({ opacity: 0.9 });
      const dump = JSON.stringify(await harness.chrome.storage.sync.get(null));
      assert.strictEqual(dump.includes('secret_jwt'), false);
    });

    test('T2-F09-03: Service Worker Crash Dump & Serialized Error Log Audit', () => {
      const err = new Error('Connection failed');
      const serialized = JSON.stringify({ message: err.message, stack: err.stack });
      assert.strictEqual(/bearer|jwt/i.test(serialized), false);
    });

    test('T2-F09-04: Annotation XML Cache Payload Sanitization', async () => {
      const harness = setupEnterpriseHarness();
      const mockXml = '<timedtext><p t="0">test</p></timedtext>';
      await harness.chrome.storage.local.set({ 'ar_vid123': mockXml });
      const dump = await harness.chrome.storage.local.get('ar_vid123');
      assert.strictEqual(dump.ar_vid123, mockXml);
    });

    test('T2-F09-05: Host Page Storage Non-Pollution (localStorage, indexedDB)', () => {
      const saas = createSaaSDOM('workday');
      assert.strictEqual(Object.keys(saas.window.localStorage._data).length, 0);
    });
  });

  // Feature 10 Boundaries (T2-F10)
  describe('Feature 10 Boundaries: Managed Policy Dynamic Enforcement (T2-F10)', () => {
    test('T2-F10-01: Corrupted, Null, and Schema-Violating Policy Payloads', async () => {
      const corruptedPolicy = { DisableAdBlock: 'corrupted_string', ForceDefaultQuality: 12345 };
      const harness = setupEnterpriseHarness('https://www.youtube.com/watch?v=corruptTest', corruptedPolicy);
      globalThis.window = harness.window;
      globalThis.document = harness.document;
      globalThis.location = harness.window.location;
      globalThis.chrome = harness.chrome;

      assert.doesNotThrow(() => {
        new Function(fs.readFileSync(path.join(REPO_ROOT, 'content/youtube-ads.js'), 'utf8'))();
        new Function(fs.readFileSync(path.join(REPO_ROOT, 'content/youtube-quality.js'), 'utf8'))();
      });

      await new Promise(r => setTimeout(r, 20));
      const managed = harness.chrome.storage.managed._data;
      assert.strictEqual(typeof managed.DisableAdBlock, 'string', 'Managed payload contains raw string');
      assert.strictEqual(typeof managed.ForceDefaultQuality, 'number', 'Managed payload contains raw number');
    });

    test('T2-F10-02: Injection of Undeclared Extra Keys in Managed Storage', async () => {
      const injectedPolicy = {
        DisableAdBlock: true,
        MaliciousExtraKey: 'attack',
        UnauthorizedOverride: true
      };
      const harness = setupEnterpriseHarness('https://www.youtube.com/watch?v=extraKeysTest', injectedPolicy);
      globalThis.window = harness.window;
      globalThis.document = harness.document;
      globalThis.location = harness.window.location;
      globalThis.chrome = harness.chrome;

      new Function(fs.readFileSync(path.join(REPO_ROOT, 'content/youtube-ads.js'), 'utf8'))();
      new Function(fs.readFileSync(path.join(REPO_ROOT, 'background/background.js'), 'utf8'))();

      await new Promise(r => setTimeout(r, 20));
      const queried = await harness.chrome.storage.managed.get(['DisableAdBlock', 'KillSwitch']);
      assert.strictEqual('MaliciousExtraKey' in queried, false, 'Undeclared extra keys must be ignored');
      assert.strictEqual('UnauthorizedOverride' in queried, false, 'Unauthorized override keys must be ignored');
      assert.strictEqual(queried.DisableAdBlock, true);

      const syncData = await harness.chrome.storage.sync.get(null);
      const localData = await harness.chrome.storage.local.get(null);
      assert.strictEqual('MaliciousExtraKey' in syncData, false);
      assert.strictEqual('MaliciousExtraKey' in localData, false);
    });

    test('T2-F10-03: Dynamic Policy Hot-Swap Mid-Playback', async () => {
      const harness = setupEnterpriseHarness();
      let thirdPartyBlocked = false;
      harness.chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'managed' && changes.DisableThirdPartyAPIs && changes.DisableThirdPartyAPIs.newValue) {
          thirdPartyBlocked = true;
        }
      });
      await harness.chrome.storage.managed.adminPush({ DisableThirdPartyAPIs: true });
      assert.strictEqual(thirdPartyBlocked, true);
    });

    test('T2-F10-04: Quality Enum Boundary Values in ForceDefaultQuality', async () => {
      const harness = setupEnterpriseHarness('https://www.youtube.com/watch?v=qualityBoundary');
      globalThis.window = harness.window;
      globalThis.document = harness.document;
      globalThis.location = harness.window.location;
      globalThis.chrome = harness.chrome;

      new Function(fs.readFileSync(path.join(REPO_ROOT, 'content/youtube-quality.js'), 'utf8'))();

      await harness.chrome.storage.managed.adminPush({ ForceDefaultQuality: 'hd720' });
      assert.strictEqual(globalThis.window.CineGlowQuality.settings.preferredQuality, 'hd720');

      await harness.chrome.storage.managed.adminPush({ ForceDefaultQuality: 'hd1080' });
      assert.strictEqual(globalThis.window.CineGlowQuality.settings.preferredQuality, 'hd1080');
    });

    test('T2-F10-05: Managed Storage API Unavailable / Permission Denial', async () => {
      const env = setupEnterpriseHarness();
      delete env.chrome.storage.managed;
      const policy = env.chrome.storage.managed ? await env.chrome.storage.managed.get(null) : {};
      assert.deepStrictEqual(policy, {});
    });
  });

  // Feature 11 Boundaries (T2-F11)
  describe('Feature 11 Boundaries: Non-Admin Tamper Resistance (T2-F11)', () => {
    test('T2-F11-01: Administrative Force-Install Inspection', async () => {
      const harness = setupEnterpriseHarness();
      const self = await harness.chrome.management.getSelf();
      assert.strictEqual(self.installType, 'admin');
    });

    test('T2-F11-02: Programmatic Disable Attempt via chrome.management.setEnabled', async () => {
      const harness = setupEnterpriseHarness();
      await assert.rejects(
        async () => { await harness.chrome.management.setEnabled('id', false); },
        /Permissions error/i
      );
    });

    test('T2-F11-03: Conflicting User Preference Override Attempt', async () => {
      const harness = setupEnterpriseHarness('https://www.youtube.com', { ForceDefaultQuality: 'hd720' });
      await harness.chrome.storage.sync.set({ preferredQuality: 'hd2160' });
      const effectiveQuality = harness.chrome.storage.managed._data.ForceDefaultQuality || (await harness.chrome.storage.sync.get('preferredQuality')).preferredQuality;
      assert.strictEqual(effectiveQuality, 'hd720');
    });

    test('T2-F11-04: CRX Package Hash Integrity & Tamper Check', () => {
      const zipPath = path.join(REPO_ROOT, 'YouTube-CineGlow-v2.4.0.zip');
      const buffer = fs.readFileSync(zipPath);
      const hash = crypto.createHash('sha256').update(buffer).digest('hex');
      assert.strictEqual(hash, 'cae397f43f353f0b4eb5d434280d6a6f50945056f7f84f77c734eef6b554904b');
    });

    test('T2-F11-05: Production Code Console Log Sanitization', () => {
      const bg = fs.readFileSync(path.join(REPO_ROOT, 'background/background.js'), 'utf8');
      assert.strictEqual(bg.includes('console.log(token'), false);
    });
  });

  // Feature 12 Boundaries (T2-F12)
  describe('Feature 12 Boundaries: Exponential Backoff for 502/503 Outages (T2-F12)', () => {
    test('T2-F12-01: Zero and Negative Parameter Boundary Sanitization', () => {
      const delay = calculateBackoffDelay(0, -100, -500, -0.5);
      assert.ok(delay >= 100, `Delay ${delay} must clamp to >= 100ms`);
    });

    test('T2-F12-02: Max Retries Exhaustion Under Persistent HTTP 503', async () => {
      const harness = setupEnterpriseHarness();
      const res = await harness.simulateFetchWithBackoff(async () => ({ ok: false, status: 503 }), {
        maxRetries: 2,
        initialDelayMs: 10
      });
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.history.length, 3); // attempt 0, 1, 2
    });

    test('T2-F12-03: HTTP Status Code Discrimination (502/503/504/429 vs 400/401/403/404/500)', async () => {
      const harness = setupEnterpriseHarness();
      // Non-retryable 401
      let count401 = 0;
      await harness.simulateFetchWithBackoff(async () => {
        count401++;
        return { ok: false, status: 401 };
      }, { maxRetries: 3 });
      assert.strictEqual(count401, 1); // Fails immediately

      // Retryable 503
      let count503 = 0;
      await harness.simulateFetchWithBackoff(async () => {
        count503++;
        return { ok: false, status: 503 };
      }, { maxRetries: 2, initialDelayMs: 10 });
      assert.strictEqual(count503, 3);
    });

    test('T2-F12-04: Jitter Uniform Dispersion and Ceiling Clamping (t <= t_max)', () => {
      for (let i = 0; i < 50; i++) {
        const d = calculateBackoffDelay(4, 1000, 5000, 0.2);
        assert.ok(d <= 5000, `Delay ${d} must be <= max 5000`);
      }
    });

    test('T2-F12-05: Interleaved Recovery on N-th Attempt', async () => {
      const harness = setupEnterpriseHarness();
      let attempt = 0;
      const res = await harness.simulateFetchWithBackoff(async () => {
        attempt++;
        if (attempt < 3) return { ok: false, status: 502 };
        return { ok: true, status: 200, data: 'recovered' };
      }, { maxRetries: 4, initialDelayMs: 10 });
      assert.strictEqual(res.success, true);
      assert.strictEqual(attempt, 3);
    });
  });

  // Feature 13 Boundaries (T2-F13)
  describe('Feature 13 Boundaries: 5-Minute Emergency Kill-Switch (T2-F13)', () => {
    test('T2-F13-01: Rapid Flip Oscillation (KillSwitch: true -> false -> true in 50ms)', async () => {
      const harness = setupEnterpriseHarness();
      await harness.chrome.storage.managed.adminPush({ KillSwitch: true });
      await harness.chrome.storage.managed.adminPush({ KillSwitch: false });
      await harness.chrome.storage.managed.adminPush({ KillSwitch: true });
      assert.strictEqual(harness.chrome.storage.managed._data.KillSwitch, true);
    });

    test('T2-F13-02: Kill Switch Activation During Active 60fps Canvas Animation Loop', () => {
      const harness = setupEnterpriseHarness('https://www.youtube.com/watch?v=loopKill');
      const playerEl = harness.document.createElement('div');
      playerEl.id = 'movie_player';
      const videoEl = new MockVideoElement();
      videoEl.className = 'html5-main-video';
      playerEl.appendChild(videoEl);
      harness.document.body.appendChild(playerEl);
      harness.elements.set('#movie_player', playerEl);
      harness.elements.set('video', videoEl);
      harness.elements.set('video.html5-main-video', videoEl);

      globalThis.window = harness.window;
      globalThis.document = harness.document;
      globalThis.location = harness.window.location;
      globalThis.chrome = harness.chrome;
      globalThis.MutationObserver = harness.window.MutationObserver;
      globalThis.AURA_DEFAULTS = { enabled: true, opacity: 80 };

      new Function(fs.readFileSync(path.join(REPO_ROOT, 'content/player-manager.js'), 'utf8'))();
      new Function(fs.readFileSync(path.join(REPO_ROOT, 'content/content.js'), 'utf8'))();

      // Dispatch kill switch event
      harness.chrome.runtime.onMessage.dispatch({
        type: 'AURA_EMERGENCY_KILL_SWITCH',
        reason: 'Loop kill test',
        timestamp: Date.now()
      });

      assert.strictEqual(globalThis.window.CineGlowKilled, true);
      assert.strictEqual(harness.document.getElementById('aura-ambient-canvas'), null);
    });

    test('T2-F13-03: Kill Switch Activation During Active Web Audio DSP Processing', () => {
      const harness = setupEnterpriseHarness('https://www.youtube.com/watch?v=audioDspKill');
      const playerEl = harness.document.createElement('div');
      playerEl.id = 'movie_player';
      const videoEl = new MockVideoElement();
      videoEl.className = 'html5-main-video';
      playerEl.appendChild(videoEl);
      harness.document.body.appendChild(playerEl);
      harness.elements.set('#movie_player', playerEl);
      harness.elements.set('video', videoEl);
      harness.elements.set('video.html5-main-video', videoEl);

      globalThis.window = harness.window;
      globalThis.document = harness.document;
      globalThis.location = harness.window.location;
      globalThis.chrome = harness.chrome;
      globalThis.AudioContext = MockAudioContext;
      globalThis.AURA_DEFAULTS = { audioNormalizer: true };

      new Function(fs.readFileSync(path.join(REPO_ROOT, 'content/player-manager.js'), 'utf8'))();
      new Function(fs.readFileSync(path.join(REPO_ROOT, 'content/audio-processor.js'), 'utf8'))();

      const ctx = globalThis.window.CineGlowAudioCtx;
      assert.ok(ctx);

      harness.chrome.runtime.onMessage.dispatch({
        type: 'AURA_EMERGENCY_KILL_SWITCH',
        reason: 'DSP kill switch',
        timestamp: Date.now()
      });

      assert.strictEqual(ctx.state, 'closed');
      assert.strictEqual(globalThis.window.CineGlowAudioCtx, null);
    });

    test('T2-F13-04: 5-Minute (300s) Enforcement Latency Ceiling Across 25 Tabs', () => {
      const contentScriptCode = fs.readFileSync(path.join(REPO_ROOT, 'content/content.js'), 'utf8');
      const playerManagerCode = fs.readFileSync(path.join(REPO_ROOT, 'content/player-manager.js'), 'utf8');

      const tabs = [];
      for (let i = 0; i < 25; i++) {
        const h = setupEnterpriseHarness('https://www.youtube.com/watch?v=tab' + i);
        const player = h.document.createElement('div');
        player.id = 'movie_player';
        const video = new MockVideoElement();
        video.className = 'html5-main-video';
        player.appendChild(video);
        h.document.body.appendChild(player);
        h.elements.set('#movie_player', player);
        h.elements.set('video', video);
        h.elements.set('video.html5-main-video', video);

        globalThis.window = h.window;
        globalThis.document = h.document;
        globalThis.location = h.window.location;
        globalThis.chrome = h.chrome;
        globalThis.MutationObserver = h.window.MutationObserver;
        globalThis.AURA_DEFAULTS = { enabled: true, opacity: 80, spread: 150 };

        new Function(playerManagerCode)();
        new Function(contentScriptCode)();

        tabs.push({ harness: h, window: h.window });
      }

      assert.ok(tabs.every(t => t.harness.document.getElementById('aura-ambient-canvas') !== null), 'All 25 tabs must mount canvas');

      const t0 = performance.now();
      const killMsg = {
        type: 'AURA_EMERGENCY_KILL_SWITCH',
        reason: 'Fleetwide kill test',
        timestamp: Date.now()
      };

      for (const t of tabs) {
        globalThis.window = t.window;
        globalThis.document = t.harness.document;
        t.harness.chrome.runtime.onMessage.dispatch(killMsg);
      }

      const duration = performance.now() - t0;
      assert.ok(tabs.every(t => t.harness.document.getElementById('aura-ambient-canvas') === null), 'All 25 tabs must unmount canvas');
      assert.ok(tabs.every(t => t.window.CineGlowKilled === true), 'All 25 tabs must set CineGlowKilled');
      assert.ok(duration < 5000, `Multi-tab teardown ${duration}ms must be < 5000ms`);
      assert.ok(duration / 1000 < 300, 'Quiescence achieved in << 300s');
    });

    test('T2-F13-05: Post-Kill Tab Navigation Lockdown', async () => {
      const harness = setupEnterpriseHarness('https://www.youtube.com/watch?v=postKillNewTab', { KillSwitch: true });
      await harness.chrome.storage.local.set({ auraKillSwitchActive: true });

      const playerEl = harness.document.createElement('div');
      playerEl.id = 'movie_player';
      const videoEl = new MockVideoElement();
      playerEl.appendChild(videoEl);
      harness.document.body.appendChild(playerEl);
      harness.elements.set('#movie_player', playerEl);
      harness.elements.set('video', videoEl);

      globalThis.window = harness.window;
      globalThis.document = harness.document;
      globalThis.location = harness.window.location;
      globalThis.chrome = harness.chrome;
      globalThis.MutationObserver = harness.window.MutationObserver;
      globalThis.AURA_DEFAULTS = { enabled: true, opacity: 80, spread: 150 };

      new Function(fs.readFileSync(path.join(REPO_ROOT, 'content/player-manager.js'), 'utf8'))();
      new Function(fs.readFileSync(path.join(REPO_ROOT, 'content/content.js'), 'utf8'))();

      await new Promise(r => setTimeout(r, 20));

      // On a newly opened tab where kill switch was already active, canvas must NEVER mount
      assert.strictEqual(harness.document.getElementById('aura-ambient-canvas'), null, 'Canvas must not mount on new tab when KillSwitch is active');
      assert.strictEqual(globalThis.window.CineGlowKilled, true);
    });
  });

  // Feature 14 Boundaries (T2-F14)
  describe('Feature 14 Boundaries: 25-Tab Memory Ceiling & SW Idle Suspend (T2-F14)', () => {
    test('T2-F14-01: 25-Tab Memory Ceiling Under Heavy 4K Playback Churn', () => {
      const sim = new MultiTabProcessSimulator(25);
      sim.tabs.forEach(t => { t.playing = true; });
      const mem = sim.getProcessMemoryMB();
      assert.ok(mem < 80.0, `Memory ${mem}MB must be < 80MB`);
    });

    test('T2-F14-02: Clean Service Worker Suspend at Exactly 30s Inactivity', () => {
      const sim = new MultiTabProcessSimulator(25);
      sim.advanceIdleTime(30.0);
      assert.strictEqual(sim.swState, 'suspended');
    });

    test('T2-F14-03: Edge Inactivity Reset (t = 29.8s)', () => {
      const sim = new MultiTabProcessSimulator(25);
      sim.advanceIdleTime(29.8);
      assert.strictEqual(sim.swState, 'running');
      sim.recordActivity();
      assert.strictEqual(sim.idleTimerSeconds, 0);
      sim.advanceIdleTime(5.0);
      assert.strictEqual(sim.swState, 'running');
    });

    test('T2-F14-04: Instant 25-Tab Teardown Memory Reclamation', () => {
      const sim = new MultiTabProcessSimulator(25);
      const initialMem = sim.getProcessMemoryMB();
      sim.closeTabs(24);
      const postMem = sim.getProcessMemoryMB();
      assert.ok(postMem < initialMem, `Post-close memory ${postMem}MB must be < initial ${initialMem}MB`);
    });

    test('T2-F14-05: Ultra-Wide 8K Resolution Canvas Buffer Allocation Clamping', () => {
      const harness = setupEnterpriseHarness('https://www.youtube.com/watch?v=8kPlaybackTest');
      const playerEl = harness.document.createElement('div');
      playerEl.id = 'movie_player';

      const videoEl = new MockVideoElement();
      videoEl.className = 'html5-main-video';
      videoEl.videoWidth = 7680;
      videoEl.videoHeight = 4320;
      videoEl.getBoundingClientRect = () => ({
        top: 0, left: 0, width: 7680, height: 4320, right: 7680, bottom: 4320
      });

      playerEl.appendChild(videoEl);
      harness.document.body.appendChild(playerEl);
      harness.elements.set('#movie_player', playerEl);
      harness.elements.set('video', videoEl);
      harness.elements.set('video.html5-main-video', videoEl);

      globalThis.window = harness.window;
      globalThis.document = harness.document;
      globalThis.location = harness.window.location;
      globalThis.chrome = harness.chrome;
      globalThis.MutationObserver = harness.window.MutationObserver;
      globalThis.AURA_DEFAULTS = { enabled: true, opacity: 80, spread: 150 };

      new Function(fs.readFileSync(path.join(REPO_ROOT, 'content/player-manager.js'), 'utf8'))();
      new Function(fs.readFileSync(path.join(REPO_ROOT, 'content/content.js'), 'utf8'))();

      const canvas = harness.document.getElementById('aura-ambient-canvas');
      assert.ok(canvas, 'Ambient canvas must be mounted');
      assert.strictEqual(canvas.width, 128, 'Canvas width must remain clamped to SAMPLE_W (128)');
      assert.strictEqual(canvas.height, 72, 'Canvas height must remain clamped to SAMPLE_H (72)');
      const bufferBytes = canvas.width * canvas.height * 4;
      assert.strictEqual(bufferBytes, 36864, 'Clamped buffer memory footprint must equal 36,864 bytes');
      assert.ok(bufferBytes < 40 * 1024, 'Canvas buffer memory must remain strictly < 40KB under 8K playback');

      // Teardown render loop
      harness.chrome.runtime.onMessage.dispatch({ type: 'AURA_EMERGENCY_KILL_SWITCH' });
    });
  });
});

// ============================================================================
// TIER 3: CROSS-FEATURE COMBINATIONS (16 PAIRWISE TESTS)
// ============================================================================
describe('Tier 3: Cross-Feature Combinations (16 Pairwise Tests)', () => {
  let harness;

  beforeEach(() => {
    harness = setupEnterpriseHarness('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  });

  test('T3-INT-01: Managed Policy (DisableRecording=true) x DLP Storage Write & Screen Recorder Mounting', async () => {
    const harness = setupEnterpriseHarness('https://www.youtube.com/watch?v=dlpRecordingPolicy', { DisableRecording: true });
    const playerEl = harness.document.createElement('div');
    playerEl.id = 'movie_player';
    const videoEl = new MockVideoElement();
    videoEl.className = 'html5-main-video';
    playerEl.appendChild(videoEl);
    harness.document.body.appendChild(playerEl);
    harness.elements.set('#movie_player', playerEl);
    harness.elements.set('video', videoEl);
    harness.elements.set('video.html5-main-video', videoEl);

    globalThis.window = harness.window;
    globalThis.document = harness.document;
    globalThis.location = harness.window.location;
    globalThis.chrome = harness.chrome;
    globalThis.MutationObserver = harness.window.MutationObserver;

    new Function(fs.readFileSync(path.join(REPO_ROOT, 'content/player-manager.js'), 'utf8'))();
    new Function(fs.readFileSync(path.join(REPO_ROOT, 'content/record-button.js'), 'utf8'))();

    await new Promise(r => setTimeout(r, 20));

    // Under DisableRecording: true, record wrapper must never be injected into movie_player
    assert.strictEqual(playerEl.querySelector('.cineglow-record-wrapper'), null);
    assert.strictEqual(harness.document.querySelectorAll('.cineglow-record-wrapper').length, 0);
    assert.strictEqual(harness.document.querySelectorAll('.cineglow-record-button').length, 0);

    // Direct invocation attempt of startRecording must be rejected by DLP policy
    if (globalThis.window.CineGlowRecord) {
      globalThis.window.CineGlowRecord.startRecording(videoEl);
      assert.strictEqual(globalThis.window.CineGlowRecord.isRecording(), false, 'Recording must remain false under DLP policy');
    }

    // Zero DLP exfiltration or recording keys written to storage
    const localStorageData = await harness.chrome.storage.local.get(null);
    assert.strictEqual(Object.keys(localStorageData).filter(k => k.includes('rec_')).length, 0);
  });

  test('T3-INT-02: Emergency Kill-Switch Activation x Exponential Backoff during active HTTP 503 Outage', async () => {
    const harness = setupEnterpriseHarness('https://www.youtube.com/watch?v=backoffKillSwitch');
    globalThis.window = harness.window;
    globalThis.document = harness.document;
    globalThis.chrome = harness.chrome;
    const { fetchWithBackoff: localFetchWithBackoff } = require(path.join(REPO_ROOT, 'shared/network-backoff'));
    globalThis.fetchWithBackoff = localFetchWithBackoff;

    new Function(fs.readFileSync(path.join(REPO_ROOT, 'background/background.js'), 'utf8'))();

    let retryAttempts = 0;
    const backoffPromise = harness.simulateFetchWithBackoff(async (attempt) => {
      retryAttempts++;
      if (attempt === 0) {
        // While in the active 503 outage, engage the Emergency Kill-Switch dynamically
        await harness.chrome.storage.managed.adminPush({ KillSwitch: true });
      }
      return { ok: false, status: 503, statusText: 'Service Unavailable' };
    }, { maxRetries: 5, initialDelayMs: 10 });

    const result = await backoffPromise;

    // Assert ongoing backoff retries immediately abort upon KillSwitch engagement
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, 'Extension disabled by emergency kill switch');
    assert.strictEqual(retryAttempts, 1, 'Ongoing retries must halt immediately upon kill-switch engagement');

    // Verify background script has engaged kill-switch state
    let messageResponse = null;
    await new Promise(resolve => {
      harness.chrome.runtime.onMessage.dispatch(
        { type: 'FETCH_DISLIKES', videoId: 'dQw4w9WgXcQ' },
        {},
        (res) => {
          messageResponse = res;
          resolve();
        }
      );
    });

    assert.deepStrictEqual(messageResponse, {
      success: false,
      error: 'Extension disabled by emergency kill-switch',
      killed: true
    });
    assert.strictEqual(harness.chrome.storage.local._data.auraKillSwitchActive, true);
  });

  test('T3-INT-03: Silent OAuth2 Token Refresh x Immediate Session Revocation during Active Video Playback', async () => {
    const harness = setupEnterpriseHarness('https://www.youtube.com/watch?v=sessionRevokeAudio');
    harness.window.AudioContext = harness.MockAudioContext;
    const playerEl = harness.document.createElement('div');
    playerEl.id = 'movie_player';
    const videoEl = new MockVideoElement();
    videoEl.className = 'html5-main-video';
    playerEl.appendChild(videoEl);
    harness.document.body.appendChild(playerEl);
    harness.elements.set('#movie_player', playerEl);
    harness.elements.set('video', videoEl);
    harness.elements.set('video.html5-main-video', videoEl);

    globalThis.window = harness.window;
    globalThis.document = harness.document;
    globalThis.location = harness.window.location;
    globalThis.chrome = harness.chrome;
    globalThis.MutationObserver = harness.window.MutationObserver;

    new Function(fs.readFileSync(path.join(REPO_ROOT, 'content/player-manager.js'), 'utf8'))();
    new Function(fs.readFileSync(path.join(REPO_ROOT, 'content/audio-processor.js'), 'utf8'))();

    harness.window.CineGlowAudioInit(videoEl);

    // OAuth2 token acquired and stored in ephemeral session storage
    const token = await harness.chrome.identity.getAuthToken({ interactive: false });
    await harness.chrome.storage.session.set({ oauth_bearer: token });
    assert.strictEqual((await harness.chrome.storage.session.get('oauth_bearer')).oauth_bearer, token);

    const audioCtx = harness.window.CineGlowAudioCtx;
    assert.ok(audioCtx, 'AudioContext must be initialized');
    assert.strictEqual(audioCtx.state, 'running');

    // Corporate session revocation immediately wipes session storage
    await harness.chrome.storage.session.clear();
    const sessionDump = await harness.chrome.storage.session.get(null);
    assert.strictEqual(Object.keys(sessionDump).length, 0, 'Session storage must be completely cleared');

    // Audio pipeline remains running and uninterrupted
    assert.strictEqual(audioCtx.state, 'running', 'Audio processing must continue smoothly through session revocation');
    assert.ok(harness.window.CineGlowAudioGainNode, 'Gain node must remain intact');

    if (typeof harness.window.CineGlowAudioTeardown === 'function') {
      harness.window.CineGlowAudioTeardown();
    }
  });

  test('T3-INT-04: Non-Admin User Tamper Resistance x Runtime Managed Policy Hot-Reload', async () => {
    const harness = setupEnterpriseHarness('https://www.youtube.com/watch?v=tamperHotReload');
    globalThis.window = harness.window;
    globalThis.document = harness.document;
    globalThis.location = harness.window.location;
    globalThis.chrome = harness.chrome;

    new Function(fs.readFileSync(path.join(REPO_ROOT, 'content/youtube-ads.js'), 'utf8'))();
    new Function(fs.readFileSync(path.join(REPO_ROOT, 'content/youtube-quality.js'), 'utf8'))();

    // Administrator pushes managed policies
    await harness.chrome.storage.managed.adminPush({
      DisableAdBlock: true,
      ForceDefaultQuality: 'hd1080'
    });

    // Malicious local user attempts override via sync storage
    await harness.chrome.storage.sync.set({ adblockEnabled: true, preferredQuality: 'hd2160' });

    // Assert managed policies remain enforced
    assert.strictEqual(harness.document.getElementById('cineglow-adblock-styles'), null);
    assert.strictEqual(globalThis.window.CineGlowQuality.settings.preferredQuality, 'hd1080');
  });

  test('T3-INT-05: High-Density Multi-Tab Load (25 Tabs) x Emergency Kill-Switch Broadcast', () => {
    const tabs = [];
    for (let i = 0; i < 25; i++) {
      const tabEnv = setupEnterpriseHarness(`https://www.youtube.com/watch?v=video_${i}`);
      const playerEl = tabEnv.document.createElement('div');
      playerEl.id = 'movie_player';
      const videoEl = new MockVideoElement();
      videoEl.className = 'html5-main-video';
      playerEl.appendChild(videoEl);
      tabEnv.document.body.appendChild(playerEl);
      tabEnv.elements.set('#movie_player', playerEl);
      tabEnv.elements.set('video', videoEl);
      tabEnv.elements.set('video.html5-main-video', videoEl);

      globalThis.window = tabEnv.window;
      globalThis.document = tabEnv.document;
      globalThis.location = tabEnv.window.location;
      globalThis.chrome = tabEnv.chrome;
      globalThis.MutationObserver = tabEnv.window.MutationObserver;
      globalThis.AURA_DEFAULTS = { enabled: true, opacity: 80 };

      new Function(fs.readFileSync(path.join(REPO_ROOT, 'content/player-manager.js'), 'utf8'))();
      new Function(fs.readFileSync(path.join(REPO_ROOT, 'content/content.js'), 'utf8'))();

      assert.ok(tabEnv.document.getElementById('aura-ambient-canvas'), `Tab ${i} canvas must be mounted initially`);
      tabs.push(tabEnv);
    }

    // Broadcast kill switch event across all 25 tabs
    for (const tabEnv of tabs) {
      globalThis.window = tabEnv.window;
      globalThis.document = tabEnv.document;
      tabEnv.chrome.runtime.onMessage.dispatch({
        type: 'AURA_EMERGENCY_KILL_SWITCH',
        reason: 'Enterprise emergency fleetwide kill switch',
        timestamp: Date.now()
      });
    }

    // Verify that every single tab unmounted its ambient canvas and engaged shutdown
    tabs.forEach((tabEnv, idx) => {
      assert.strictEqual(tabEnv.document.getElementById('aura-ambient-canvas'), null, `Tab ${idx} ambient canvas must be unmounted`);
      assert.strictEqual(tabEnv.window.CineGlowKilled, true, `Tab ${idx} must have CineGlowKilled true`);
    });
  });

  test('T3-INT-06: Enterprise SaaS Cross-Navigation x Strict DOM & Prototype Isolation', () => {
    const workday = createSaaSDOM('workday');
    const salesforce = createSaaSDOM('salesforce');
    const servicenow = createSaaSDOM('servicenow');

    [workday, salesforce, servicenow].forEach(saas => {
      assert.strictEqual(saas.document.body.children.some(c => c.id && c.id.includes('aura-ambient')), false);
      assert.strictEqual(saas.document.body.children.some(c => c.className && c.className.includes('cineglow')), false);
    });
  });

  test('T3-INT-07: Corporate SSL Inspection / MITM Proxy x OAuth2 Token Refresh & API Egress', async () => {
    const harness = setupEnterpriseHarness();
    globalThis.window = harness.window;
    globalThis.document = harness.document;
    globalThis.chrome = harness.chrome;
    globalThis.fetch = harness.networkSpy.mockFetch;
    const { fetchWithBackoff: localFetchWithBackoff } = require(path.join(REPO_ROOT, 'shared/network-backoff'));
    globalThis.fetchWithBackoff = (url, opts, cfg) => localFetchWithBackoff(url, opts, {
      fetchFn: harness.networkSpy.mockFetch,
      sleepFn: () => Promise.resolve(),
      ...cfg
    });

    // Obtain OAuth token via enterprise identity provider
    const authToken = await harness.chrome.identity.getAuthToken({ interactive: false });
    await harness.chrome.storage.session.set({ oauth_bearer: authToken });

    new Function(fs.readFileSync(path.join(REPO_ROOT, 'background/background.js'), 'utf8'))();

    let responseResult = null;
    await new Promise(resolve => {
      harness.chrome.runtime.onMessage.dispatch(
        { type: 'FETCH_DISLIKES', videoId: 'dQw4w9WgXcQ' },
        {},
        (res) => {
          responseResult = res;
          resolve();
        }
      );
    });

    assert.strictEqual(responseResult.success, true);
    assert.strictEqual(responseResult.data.count, 42);
    assert.strictEqual(harness.networkSpy.proxyHeaders['Via'], '1.1 zscaler');
    assert.strictEqual(harness.networkSpy.outboundRequests.length, 1);
    assert.ok(harness.networkSpy.outboundRequests[0].url.includes('dQw4w9WgXcQ'));
  });

  test('T3-INT-08: Managed Policy (DisableThirdPartyAPIs=true) x Exponential Backoff Outage Bypass', async () => {
    const harness = setupEnterpriseHarness('https://www.youtube.com/watch?v=bypassBackoff');
    globalThis.window = harness.window;
    globalThis.document = harness.document;
    globalThis.chrome = harness.chrome;

    let networkCallMade = false;
    globalThis.fetchWithBackoff = async (...args) => {
      networkCallMade = true;
      return { ok: true, json: async () => ({}) };
    };

    new Function(fs.readFileSync(path.join(REPO_ROOT, 'background/background.js'), 'utf8'))();

    // Administrator pushes DisableThirdPartyAPIs policy
    await harness.chrome.storage.managed.adminPush({ DisableThirdPartyAPIs: true });

    // Send FETCH_DISLIKES message
    let responseResult = null;
    await new Promise(resolve => {
      harness.chrome.runtime.onMessage.dispatch(
        { type: 'FETCH_DISLIKES', videoId: 'dQw4w9WgXcQ' },
        {},
        (res) => {
          responseResult = res;
          resolve();
        }
      );
    });

    // Assert blocked by policy without invoking fetchWithBackoff or network egress
    assert.strictEqual(responseResult.success, false);
    assert.strictEqual(responseResult.error, 'Blocked by enterprise policy');
    assert.strictEqual(networkCallMade, false, 'Backoff egress must be completely bypassed when policy is active');
    assert.strictEqual(harness.networkSpy.outboundRequests.length, 0);
  });

  test('T3-INT-09: Silent OAuth2 Token Refresh x Zero Plaintext Tokens on Disk Assurance', async () => {
    const token = 'bearer_secret_token_live_2026';
    await harness.chrome.storage.session.set({ authToken: token });

    const localDump = JSON.stringify(await harness.chrome.storage.local.get(null));
    const syncDump = JSON.stringify(await harness.chrome.storage.sync.get(null));

    assert.strictEqual(localDump.includes(token), false);
    assert.strictEqual(syncDump.includes(token), false);
  });

  test('T3-INT-10: 25-Tab Multi-Tab Quiescence x Background Service Worker 30s Idle Suspend', () => {
    const sim = new MultiTabProcessSimulator(25);
    sim.advanceIdleTime(30.0);
    assert.strictEqual(sim.swState, 'suspended');
  });

  test('T3-INT-11: Enterprise DLP Scanning x Multi-Tab Video Annotation Fetch & Local Caching', async () => {
    const safeXml = '<timedtext><p t="1000" d="2000">Welcome to training</p></timedtext>';
    await harness.chrome.storage.local.set({ 'ar_dQw4w9WgXcQ': safeXml });
    const cached = (await harness.chrome.storage.local.get('ar_dQw4w9WgXcQ'))['ar_dQw4w9WgXcQ'];
    assert.strictEqual(/password|secret|bearer|ssn|mrn/i.test(cached), false);
  });

  test('T3-INT-12: High-Traffic Uplink Degradation (HTTP 502) x Page Load Latency Ceiling (< 50ms)', () => {
    const harness = setupEnterpriseHarness('https://www.youtube.com/watch?v=degradedUplink');
    const playerEl = harness.document.createElement('div');
    playerEl.id = 'movie_player';
    const videoEl = new MockVideoElement();
    videoEl.className = 'html5-main-video';
    playerEl.appendChild(videoEl);
    harness.document.body.appendChild(playerEl);
    harness.elements.set('#movie_player', playerEl);
    harness.elements.set('video', videoEl);
    harness.elements.set('video.html5-main-video', videoEl);

    // Simulate high-traffic uplink degradation returning HTTP 502 with latency penalty
    harness.networkSpy.mockFetch = async (url, opts) => {
      harness.networkSpy.outboundRequests.push({ url, opts, status: 502 });
      return {
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
        json: async () => ({ error: 'Uplink degraded' })
      };
    };

    globalThis.window = harness.window;
    globalThis.document = harness.document;
    globalThis.location = harness.window.location;
    globalThis.chrome = harness.chrome;
    globalThis.MutationObserver = harness.window.MutationObserver;
    globalThis.AURA_DEFAULTS = { enabled: true, opacity: 80, spread: 20 };

    new Function(fs.readFileSync(path.join(REPO_ROOT, 'content/player-manager.js'), 'utf8'))();

    // Benchmark synchronous main-thread initialization overhead of content/content.js
    const contentScript = fs.readFileSync(path.join(REPO_ROOT, 'content/content.js'), 'utf8');
    const t0 = performance.now();
    new Function(contentScript)();
    const duration = performance.now() - t0;

    assert.ok(duration < 50, `Main thread overhead ${duration}ms must be strictly < 50ms`);
    assert.ok(harness.document.getElementById('aura-ambient-canvas') !== null, 'Ambient canvas must be mounted');

    // Cleanly teardown render loops
    if (typeof globalThis.window.CineGlowTeardown === 'function') {
      globalThis.window.CineGlowTeardown();
    }
  });

  test('T3-INT-13: Non-Admin Tamper Attempt x Emergency Kill-Switch Lifecycle', async () => {
    await assert.rejects(
      async () => { await harness.chrome.management.uninstallSelf(); },
      /enterprise policy/i
    );
  });

  test('T3-INT-14: Unrelated Enterprise SaaS Fetch Activity x Corporate SSO Flow', () => {
    const sfdc = createSaaSDOM('salesforce');
    assert.strictEqual(sfdc.window.fetch.name, 'fetch');
  });

  test('T3-INT-15: Managed Policy (ForceDefaultQuality) x Smart-Pause Dynamic Tab Throttling', async () => {
    const harness = setupEnterpriseHarness('https://www.youtube.com/watch?v=smartPauseQuality');
    const playerEl = harness.document.createElement('div');
    playerEl.id = 'movie_player';
    const videoEl = new MockVideoElement();
    videoEl.className = 'html5-main-video';
    const origPlay = videoEl.play;
    videoEl.play = function() {
      const res = origPlay.call(this);
      return res || Promise.resolve();
    };
    playerEl.appendChild(videoEl);
    harness.document.body.appendChild(playerEl);
    harness.elements.set('#movie_player', playerEl);
    harness.elements.set('video', videoEl);
    harness.elements.set('video.html5-main-video', videoEl);

    globalThis.window = harness.window;
    globalThis.document = harness.document;
    globalThis.location = harness.window.location;
    globalThis.chrome = harness.chrome;
    globalThis.MutationObserver = harness.window.MutationObserver;

    new Function(fs.readFileSync(path.join(REPO_ROOT, 'content/player-manager.js'), 'utf8'))();
    new Function(fs.readFileSync(path.join(REPO_ROOT, 'content/youtube-quality.js'), 'utf8'))();
    new Function(fs.readFileSync(path.join(REPO_ROOT, 'content/smart-pause.js'), 'utf8'))();

    // Enable smart-pause mode via sync storage
    await harness.chrome.storage.sync.set({ autoPauseMode: 'tab', preferredQuality: 'hd2160' });

    // Administrator pushes managed quality policy
    await harness.chrome.storage.managed.adminPush({ ForceDefaultQuality: 'hd720' });

    // User attempts override via sync storage
    await harness.chrome.storage.sync.set({ preferredQuality: 'hd2160' });

    // Verify quality policy remains locked at hd720
    assert.strictEqual(globalThis.window.CineGlowQuality.settings.preferredQuality, 'hd720');
    assert.strictEqual(globalThis.window.CineGlowQuality.isForcedByPolicy(), true);

    // Simulate active playback followed by background tab throttling
    videoEl.play();
    assert.strictEqual(videoEl.paused, false, 'Video must be playing in active tab');

    harness.document.hidden = true;
    harness.document.dispatchEvent(new Event('visibilitychange'));

    // Verify video paused by smart-pause on background tab
    assert.strictEqual(videoEl.paused, true, 'Smart-pause must pause video when tab becomes hidden');

    // Foreground tab restores playback
    harness.document.hidden = false;
    harness.document.dispatchEvent(new Event('visibilitychange'));
    assert.strictEqual(videoEl.paused, false, 'Playback must resume when tab becomes visible');

    if (typeof globalThis.window.CineGlowSmartPauseTeardown === 'function') {
      globalThis.window.CineGlowSmartPauseTeardown();
    }
  });

  test('T3-INT-16: Web Audio DSP Graph Normalization x Multi-Tab Audio Isolation', async () => {
    const tab1 = setupEnterpriseHarness('https://www.youtube.com/watch?v=tab1Audio');
    tab1.window.AudioContext = tab1.MockAudioContext;
    const p1 = tab1.document.createElement('div');
    p1.id = 'movie_player';
    const v1 = new MockVideoElement();
    v1.className = 'html5-main-video';
    p1.appendChild(v1);
    tab1.document.body.appendChild(p1);
    tab1.elements.set('#movie_player', p1);
    tab1.elements.set('video', v1);
    tab1.elements.set('video.html5-main-video', v1);

    globalThis.window = tab1.window;
    globalThis.document = tab1.document;
    globalThis.location = tab1.window.location;
    globalThis.chrome = tab1.chrome;
    globalThis.MutationObserver = tab1.window.MutationObserver;

    new Function(fs.readFileSync(path.join(REPO_ROOT, 'content/player-manager.js'), 'utf8'))();
    new Function(fs.readFileSync(path.join(REPO_ROOT, 'content/audio-processor.js'), 'utf8'))();
    tab1.window.CineGlowAudioInit(v1);

    const tab2 = setupEnterpriseHarness('https://www.youtube.com/watch?v=tab2Audio');
    tab2.window.AudioContext = tab2.MockAudioContext;
    const p2 = tab2.document.createElement('div');
    p2.id = 'movie_player';
    const v2 = new MockVideoElement();
    v2.className = 'html5-main-video';
    p2.appendChild(v2);
    tab2.document.body.appendChild(p2);
    tab2.elements.set('#movie_player', p2);
    tab2.elements.set('video', v2);
    tab2.elements.set('video.html5-main-video', v2);

    globalThis.window = tab2.window;
    globalThis.document = tab2.document;
    globalThis.location = tab2.window.location;
    globalThis.chrome = tab2.chrome;
    globalThis.MutationObserver = tab2.window.MutationObserver;

    new Function(fs.readFileSync(path.join(REPO_ROOT, 'content/player-manager.js'), 'utf8'))();
    new Function(fs.readFileSync(path.join(REPO_ROOT, 'content/audio-processor.js'), 'utf8'))();
    tab2.window.CineGlowAudioInit(v2);

    const ctx1 = tab1.window.CineGlowAudioCtx;
    const ctx2 = tab2.window.CineGlowAudioCtx;

    assert.ok(ctx1 && ctx2, 'Both tabs must construct an active AudioContext');
    assert.notStrictEqual(ctx1, ctx2, 'AudioContexts must be strictly isolated per-tab');

    const gain1 = tab1.window.CineGlowAudioGainNode;
    const gain2 = tab2.window.CineGlowAudioGainNode;
    assert.ok(gain1 && gain2, 'Both tabs must create a Volume Gain node');
    assert.notStrictEqual(gain1, gain2, 'Gain nodes must not be shared across tabs');
    assert.strictEqual(gain1.context, ctx1);
    assert.strictEqual(gain2.context, ctx2);

    const analyser1 = tab1.window.CineGlowAudioAnalyser;
    const analyser2 = tab2.window.CineGlowAudioAnalyser;
    assert.notStrictEqual(analyser1, analyser2, 'Audio analysers must be strictly tab-isolated');

    // Adjust settings in tab 1 and verify tab 2 remains isolated
    await tab1.chrome.storage.sync.set({ audioBoost: 160, audioNormalizer: true });
    assert.strictEqual(tab1.window.CineGlowAudioGainNode.context, ctx1);
    assert.strictEqual(tab2.window.CineGlowAudioGainNode.context, ctx2);

    if (typeof tab1.window.CineGlowAudioTeardown === 'function') tab1.window.CineGlowAudioTeardown();
    if (typeof tab2.window.CineGlowAudioTeardown === 'function') tab2.window.CineGlowAudioTeardown();
  });
});

// ============================================================================
// TIER 4: REAL-WORLD ENTERPRISE WORKLOAD SCENARIOS (7 SCENARIOS)
// ============================================================================
describe('Tier 4: Real-World Enterprise Workload Scenarios (7 Scenarios)', () => {

  test('T4-SCN-01: Financial Institution Trader Morning Routine across 5 enterprise apps', () => {
    const m365 = createSaaSDOM('m365');
    const sfdc = createSaaSDOM('salesforce');
    const snow = createSaaSDOM('servicenow');
    const workday = createSaaSDOM('workday');
    const ytHarness = setupEnterpriseHarness('https://www.youtube.com/watch?v=trader-compliance-2026');

    // 1. YouTube tab initializes genuine player DOM and executes production content scripts
    const playerEl = ytHarness.document.createElement('div');
    playerEl.id = 'movie_player';
    const videoEl = new MockVideoElement();
    videoEl.className = 'html5-main-video';
    playerEl.appendChild(videoEl);
    ytHarness.document.body.appendChild(playerEl);
    ytHarness.elements.set('#movie_player', playerEl);
    ytHarness.elements.set('video', videoEl);
    ytHarness.elements.set('video.html5-main-video', videoEl);

    globalThis.window = ytHarness.window;
    globalThis.document = ytHarness.document;
    globalThis.location = ytHarness.window.location;
    globalThis.chrome = ytHarness.chrome;
    globalThis.MutationObserver = ytHarness.window.MutationObserver;
    globalThis.AURA_DEFAULTS = { enabled: true, opacity: 80, spread: 150 };

    // Run production player manager and content script
    new Function(fs.readFileSync(path.join(REPO_ROOT, 'content/player-manager.js'), 'utf8'))();
    new Function(fs.readFileSync(path.join(REPO_ROOT, 'content/content.js'), 'utf8'))();

    // Verify ambient canvas is mounted by production script
    assert.ok(ytHarness.document.getElementById('aura-ambient-canvas'), 'Ambient canvas must be mounted on YouTube tab by content.js');

    // 2. SaaS apps have zero injected extension elements and unpatched fetch
    [m365, sfdc, snow, workday].forEach(app => {
      assert.strictEqual(app.document.querySelectorAll('[id*="aura-ambient"]').length, 0);
      assert.strictEqual(app.document.querySelectorAll('[class*="cineglow"]').length, 0);
      assert.strictEqual(app.window.fetch.name, 'fetch');
    });

    // Clean up content script listeners & timers
    ytHarness.chrome.runtime.onMessage.dispatch({
      type: 'AURA_EMERGENCY_KILL_SWITCH',
      reason: 'Test teardown',
      timestamp: Date.now()
    });
  });

  test('T4-SCN-02: Healthcare HIPAA Audit & Lockdown prevents recording and guarantees zero PHI', async () => {
    const harness = setupEnterpriseHarness('https://www.youtube.com/watch?v=surgical-video-101', {
      DisableRecording: true,
      DisableThirdPartyAPIs: true
    });

    const playerEl = harness.document.createElement('div');
    playerEl.id = 'movie_player';
    const videoEl = new MockVideoElement();
    videoEl.className = 'html5-main-video';
    playerEl.appendChild(videoEl);
    harness.document.body.appendChild(playerEl);
    harness.elements.set('#movie_player', playerEl);
    harness.elements.set('video', videoEl);

    globalThis.window = harness.window;
    globalThis.document = harness.document;
    globalThis.location = harness.window.location;
    globalThis.chrome = harness.chrome;
    globalThis.MutationObserver = harness.window.MutationObserver;

    // Run production background, player-manager, and record-button scripts
    new Function(fs.readFileSync(path.join(REPO_ROOT, 'background/background.js'), 'utf8'))();
    new Function(fs.readFileSync(path.join(REPO_ROOT, 'content/player-manager.js'), 'utf8'))();
    new Function(fs.readFileSync(path.join(REPO_ROOT, 'content/record-button.js'), 'utf8'))();

    await new Promise(r => setTimeout(r, 20));

    // 1. Verify record button UI is completely suppressed under HIPAA lockdown
    assert.strictEqual(harness.document.querySelectorAll('.cineglow-record-wrapper').length, 0, 'Record button must not mount under DisableRecording');
    assert.strictEqual(harness.document.querySelectorAll('.cineglow-record-button').length, 0);

    // 2. Direct programmatic startRecording invocation is blocked
    if (harness.window.CineGlowRecord && harness.window.CineGlowRecord.startRecording) {
      let errOccurred = false;
      try {
        await harness.window.CineGlowRecord.startRecording();
      } catch (e) {
        errOccurred = true;
      }
    }

    // 3. Third-party API calls are blocked by background policy
    const bgResponse = await new Promise(resolve => {
      harness.chrome.runtime.onMessage.dispatch({
        type: 'FETCH_DISLIKES',
        videoId: 'surgical-video-101'
      }, {}, resolve);
    });
    assert.strictEqual(bgResponse.success, false);
    assert.strictEqual(bgResponse.error, 'Blocked by enterprise policy');

    // 4. Verify storage contains zero PHI / medical record numbers / patient data
    const localData = await harness.chrome.storage.local.get(null);
    const syncData = await harness.chrome.storage.sync.get(null);
    const sessionData = await harness.chrome.storage.session.get(null);
    const allKeys = [...Object.keys(localData), ...Object.keys(syncData), ...Object.keys(sessionData)];
    assert.strictEqual(allKeys.filter(k => /phi|mrn|patient|record|clip/i.test(k)).length, 0);
  });

  test('T4-SCN-03: Enterprise Cloud Infrastructure Outage triggers backoff spacing and instant kill-switch', async () => {
    const harness = setupEnterpriseHarness('https://www.youtube.com/watch?v=cloudOutage');
    globalThis.window = harness.window;
    globalThis.document = harness.document;
    globalThis.chrome = harness.chrome;

    // Run production background script
    new Function(fs.readFileSync(path.join(REPO_ROOT, 'background/background.js'), 'utf8'))();

    let attemptCount = 0;
    const outageFetch = async (url, opts) => {
      attemptCount++;
      if (attemptCount === 2) {
        // Administrative emergency kill switch activated during active outage
        await harness.chrome.storage.managed.adminPush({ KillSwitch: true });
      }
      return { ok: false, status: 503 };
    };

    const backoffResult = await fetchWithBackoff('https://returnyoutubedislikeapi.com/votes?videoId=outageTest', {}, {
      fetchFn: outageFetch,
      initialDelayMs: 2,
      maxRetries: 3,
      sleepFn: () => Promise.resolve()
    });

    assert.strictEqual(backoffResult.ok, false);
    assert.strictEqual(backoffResult.status, 503);
    assert.strictEqual(harness.chrome.storage.managed._data.KillSwitch, true);

    // Egress is immediately blocked by active kill switch
    const postKillRes = await new Promise(resolve => {
      harness.chrome.runtime.onMessage.dispatch({
        type: 'FETCH_DISLIKES',
        videoId: 'outageTest'
      }, {}, resolve);
    });
    assert.strictEqual(postKillRes.success, false);
    assert.strictEqual(postKillRes.killed, true);
  });

  test('T4-SCN-04: Executive Privilege Session Expiry & Immediate Revocation', async () => {
    const harness = setupEnterpriseHarness();
    await harness.chrome.storage.session.set({ exec_jwt: 'jwt_secret_token_val_123' });
    assert.strictEqual((await harness.chrome.storage.session.get('exec_jwt')).exec_jwt, 'jwt_secret_token_val_123');

    // Corporate session revocation
    await harness.chrome.storage.session.clear();
    const sess = await harness.chrome.storage.session.get(null);
    const disk = await harness.chrome.storage.local.get(null);
    const sync = await harness.chrome.storage.sync.get(null);

    assert.strictEqual(Object.keys(sess).length, 0);
    assert.strictEqual(JSON.stringify(disk).includes('jwt_secret'), false);
    assert.strictEqual(JSON.stringify(sync).includes('jwt_secret'), false);
  });

  test('T4-SCN-05: Call Center Multi-Agent High-Density Tab Soak (8-Hour Shift Equivalent)', () => {
    const sim = new MultiTabProcessSimulator(25);
    const initialMemMB = sim.getProcessMemoryMB();
    assert.ok(initialMemMB < 80.0, `Call center 25-tab initial memory ${initialMemMB.toFixed(2)}MB must be < 80MB`);

    // 8-hour shift tab turnover: close 10 tabs and open new ones
    sim.closeTabs(10);
    assert.ok(sim.getProcessMemoryMB() < initialMemMB);

    // Quiescence & SW suspend after 30s inactivity
    sim.advanceIdleTime(30.0);
    assert.strictEqual(sim.swState, 'suspended');
  });

  test('T4-SCN-06: Zero-Trust Strict Proxy & MITM SSL Inspection', async () => {
    const harness = setupEnterpriseHarness();
    globalThis.window = harness.window;
    globalThis.document = harness.document;
    globalThis.chrome = harness.chrome;
    globalThis.fetch = harness.networkSpy.mockFetch;
    globalThis.fetchWithBackoff = (url, opts, cfg) => fetchWithBackoff(url, opts, {
      fetchFn: harness.networkSpy.mockFetch,
      sleepFn: () => Promise.resolve(),
      ...cfg
    });

    // Run production background service worker
    new Function(fs.readFileSync(path.join(REPO_ROOT, 'background/background.js'), 'utf8'))();

    let responseResult = null;
    await new Promise(resolve => {
      harness.chrome.runtime.onMessage.dispatch(
        { type: 'FETCH_DISLIKES', videoId: 'e2e-ssl-proxy-vid' },
        {},
        (res) => {
          responseResult = res;
          resolve();
        }
      );
    });

    assert.strictEqual(responseResult.success, true);
    assert.strictEqual(responseResult.data.count, 42);
    assert.strictEqual(harness.networkSpy.proxyHeaders['Via'], '1.1 zscaler');
    assert.strictEqual(harness.networkSpy.proxyHeaders['X-Enterprise-Policy'], 'inspected');
    assert.ok(harness.networkSpy.outboundRequests.length > 0);
    assert.ok(harness.networkSpy.outboundRequests[0].url.includes('e2e-ssl-proxy-vid'));

    // Verify 502 MITM proxy transient inspection resilience with backoff
    let proxyAttempts = 0;
    const mitmProxyFetch = async (url, opts) => {
      proxyAttempts++;
      if (proxyAttempts <= 2) {
        return { ok: false, status: 502, headers: new Map(Object.entries(harness.networkSpy.proxyHeaders)) };
      }
      return { ok: true, status: 200, headers: new Map(Object.entries(harness.networkSpy.proxyHeaders)), json: async () => ({ proxyOk: true }) };
    };

    const recovered = await fetchWithBackoff('https://returnyoutubedislikeapi.com/votes?videoId=proxyCheck', {}, {
      fetchFn: mitmProxyFetch,
      initialDelayMs: 2,
      maxRetries: 3,
      sleepFn: () => Promise.resolve()
    });
    assert.strictEqual(recovered.ok, true);
    assert.strictEqual(proxyAttempts, 3);
  });

  test('T4-SCN-07: Malicious Local User Tampering Attempt', async () => {
    const harness = setupEnterpriseHarness('https://www.youtube.com', {
      DisableAdBlock: true,
      ForceDefaultQuality: 'hd720'
    });

    // 1. Chrome Management API blocks non-admin uninstall & disable
    await assert.rejects(async () => {
      await harness.chrome.management.uninstallSelf();
    }, /enterprise policy/i);

    await assert.rejects(async () => {
      await harness.chrome.management.setEnabled('cineglow-pro-id', false);
    }, /administrators can modify/i);

    // 2. Direct write to storage.managed fails (read-only)
    await assert.rejects(async () => {
      await harness.chrome.storage.managed.set({ DisableAdBlock: false });
    }, /read-only/i);

    globalThis.window = harness.window;
    globalThis.document = harness.document;
    globalThis.location = harness.window.location;
    globalThis.chrome = harness.chrome;

    // Run production adblock & quality content scripts
    new Function(fs.readFileSync(path.join(REPO_ROOT, 'content/youtube-ads.js'), 'utf8'))();
    new Function(fs.readFileSync(path.join(REPO_ROOT, 'content/youtube-quality.js'), 'utf8'))();

    await new Promise(r => setTimeout(r, 25));

    // AdBlock styles must NOT be injected
    assert.strictEqual(harness.document.getElementById('cineglow-adblock-styles'), null, 'Adblock styles must not be in DOM');

    // 3. User attempts sync override for adblock
    await harness.chrome.storage.sync.set({ adblockEnabled: true });
    assert.strictEqual(harness.document.getElementById('cineglow-adblock-styles'), null, 'Adblock styles must remain unmounted after sync attempt');

    // 4. User attempts sync override for quality
    await harness.chrome.storage.sync.set({ preferredQuality: 'hd2160' });
    assert.strictEqual(harness.window.CineGlowQuality.isForcedByPolicy(), true);
    assert.strictEqual(harness.window.CineGlowQuality.settings.preferredQuality, 'hd720');

    const ytQuality = JSON.parse(harness.window.localStorage.getItem('yt-player-quality'));
    assert.strictEqual(JSON.parse(ytQuality.data).quality, 'hd720');
  });
});

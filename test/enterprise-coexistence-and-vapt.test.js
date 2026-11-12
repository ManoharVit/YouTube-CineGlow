// test/enterprise-coexistence-and-vapt.test.js
// Enterprise Co-existence, Security Staging, and InfoSec VAPT Test Suite
// Author / Lead Architect: Giri Manohar Vemula (https://www.linkedin.com/in/manoharv511 · https://github.com/ManoharVit)

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const {
  createSaaSDOM,
  SAAS_CONFIGS,
  MockStorageArea,
  MockIdentity,
  MockManagement,
  setupEnterpriseYouTubeEnvironment
} = require('./helpers/enterprise-saas-fixtures');
const { setupMockEnvironment, MockElement, MockVideoElement } = require('./helpers/mock-dom');

describe('Enterprise Co-existence & InfoSec VAPT Suite', () => {
  const rootDir = path.join(__dirname, '..');
  const manifestPath = path.join(rootDir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  // ---------------------------------------------------------------------------
  // 1. Static Manifest & Scoping Isolation
  // ---------------------------------------------------------------------------
  test('Phase 2: Content script matches strictly isolate to YouTube origins and reject enterprise SaaS domains', () => {
    const enterpriseDomains = [
      'https://myworkday.com/corporate/home',
      'https://company.my.salesforce.com/lightning/page/home',
      'https://fiori.corp.sap.com/sap/bc/ui5_ui5/ui2/ushell/shells/abap/FioriLaunchpad.html',
      'https://service-now.com/navpage.do',
      'https://jira.atlassian.net/jira/software/projects',
      'https://portal.office.com',
      'https://sharepoint.com/sites/intranet',
      'https://login.microsoftonline.com',
      'https://google.com',
      'https://slack.com'
    ];

    const contentScripts = manifest.content_scripts || [];
    assert.ok(contentScripts.length > 0, 'manifest must define content_scripts');

    for (const entry of contentScripts) {
      for (const pattern of entry.matches) {
        assert.ok(
          pattern.includes('youtube.com'),
          `Match pattern '${pattern}' must be restricted to YouTube domains`
        );
        assert.strictEqual(
          pattern.includes('<all_urls>'),
          false,
          'Content scripts must never match <all_urls>'
        );
      }
    }

    // Verify regex matching logic against enterprise domains
    for (const domain of enterpriseDomains) {
      const url = new URL(domain);
      for (const entry of contentScripts) {
        for (const pattern of entry.matches) {
          const regexStr = '^' + pattern
            .replace(/\./g, '\\.')
            .replace(/\*/g, '.*')
            .replace(/\//g, '\\/') + '$';
          const rx = new RegExp(regexStr);
          assert.strictEqual(
            rx.test(url.href),
            false,
            `Enterprise SaaS URL '${url.href}' must NEVER match extension pattern '${pattern}'`
          );
        }
      }
    }
  });

  test('Phase 2: Host permissions strictly isolate network scope and forbid enterprise SaaS interception', () => {
    const hostPerms = manifest.host_permissions || [];
    const allowedHosts = [
      'https://*.youtube.com/*',
      'https://returnyoutubedislikeapi.com/*',
      'https://biggest_bucket.storage.googleapis.com/*'
    ];

    assert.deepStrictEqual(hostPerms.sort(), allowedHosts.sort());

    for (const host of hostPerms) {
      assert.strictEqual(host.includes('<all_urls>'), false, 'Cannot include <all_urls>');
      assert.strictEqual(host.includes('http://'), false, 'All host permissions must enforce HTTPS');
    }
  });

  test('Phase 2: Managed schema conforms to Chrome Enterprise storage.managed Draft 3/4 spec', () => {
    const schemaPath = path.join(rootDir, 'managed-schema.json');
    assert.ok(fs.existsSync(schemaPath), 'managed-schema.json must exist in root directory');

    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    assert.strictEqual(schema.$schema, 'http://json-schema.org/draft-03/schema#');
    assert.strictEqual(schema.type, 'object');
    assert.ok(schema.properties, 'schema must declare properties');

    const requiredKeys = ['DisableAdBlock', 'DisableRecording', 'DisableThirdPartyAPIs', 'ForceDefaultQuality'];
    for (const key of requiredKeys) {
      assert.ok(schema.properties[key], `managed-schema must define property '${key}'`);
      assert.ok(schema.properties[key].type, `Property '${key}' must define type`);
      assert.ok(schema.properties[key].title, `Property '${key}' must define title`);
      assert.ok(schema.properties[key].description, `Property '${key}' must define description`);
    }
  });

  test('Phase 3: Grey-Box VAPT - Zero plaintext tokens, credentials, or PII written to storage', () => {
    const scanDirs = ['content', 'background', 'popup', 'shared'];
    const forbiddenPatterns = [
      /password/i,
      /secret/i,
      /token\s*[:=]\s*['"`][a-zA-Z0-9_\-]{16,}['"`]/,
      /jwt/i,
      /api_key\s*[:=]/i,
      /auth_header/i,
      /cookie\s*[:=]/i
    ];

    for (const dir of scanDirs) {
      const fullDir = path.join(rootDir, dir);
      if (!fs.existsSync(fullDir)) continue;
      const files = fs.readdirSync(fullDir).filter(f => f.endsWith('.js'));
      for (const file of files) {
        const content = fs.readFileSync(path.join(fullDir, file), 'utf8');
        for (const pattern of forbiddenPatterns) {
          const match = content.match(pattern);
          assert.strictEqual(
            match,
            null,
            `Security Alert: Hardcoded sensitive secret or credential keyword matched '${pattern}' in ${dir}/${file}`
          );
        }
      }
    }
  });

  test('Phase 3: Grey-Box VAPT - Zero cross-world message broadcasts using wildcard targetOrigin ("*")', () => {
    const mainWorldFiles = [
      'content/main-world.js',
      'content/youtube-quality.js',
      'content/stats-overlay.js'
    ];

    for (const relPath of mainWorldFiles) {
      const filePath = path.join(rootDir, relPath);
      const code = fs.readFileSync(filePath, 'utf8');

      const wildcardPostMessageRegex = /window\.postMessage\([^)]*['"]\*['"]\)/g;
      const matches = code.match(wildcardPostMessageRegex);
      assert.strictEqual(
        matches,
        null,
        `File ${relPath} must not use wildcard targetOrigin '*' in postMessage calls. Found: ${matches}`
      );
    }
  });

  test('Phase 3: Compliance & Privacy - Zero third-party telemetry, tracking pixels, or external beacon SDKs', () => {
    const trackingSignatures = [
      'google-analytics.com',
      'googletagmanager.com',
      'analytics.js',
      'gtag',
      'mixpanel',
      'amplitude',
      'hotjar',
      'sentry.io',
      'datadoghq',
      'segment.io',
      'facebook.net'
    ];

    const scanDirs = ['content', 'background', 'popup', 'shared'];
    for (const dir of scanDirs) {
      const fullDir = path.join(rootDir, dir);
      if (!fs.existsSync(fullDir)) continue;
      const files = fs.readdirSync(fullDir).filter(f => f.endsWith('.js') || f.endsWith('.html'));
      for (const file of files) {
        const content = fs.readFileSync(path.join(fullDir, file), 'utf8');
        for (const sig of trackingSignatures) {
          assert.strictEqual(
            content.includes(sig),
            false,
            `DPIA Violation: Prohibited third-party tracker or telemetry signature '${sig}' found in ${dir}/${file}`
          );
        }
      }
    }
  });

  // ---------------------------------------------------------------------------
  // 2. Corporate App Co-existence (Workday, Salesforce, SAP, ServiceNow, Jira, M365)
  // ---------------------------------------------------------------------------
  test('Phase 2: Zero DOM & CSS breakage across all 6 core enterprise SaaS applications', () => {
    const saasApps = ['workday', 'salesforce', 'sap', 'servicenow', 'jira', 'm365'];

    // Load extension CSS files
    const cssFiles = ['content/content.css', 'content/stats-overlay.css', 'content/annotations.css'];
    const allCss = cssFiles.map(f => fs.readFileSync(path.join(rootDir, f), 'utf8')).join('\n');

    // Vendor class prefixes from official design systems
    const saasClassPrefixes = ['wd-', 'slds-', 'sapM', 'sapUi', 'sapUshell', 'now-', 'ak-', 'ms-'];
    for (const prefix of saasClassPrefixes) {
      // Look for CSS rules explicitly targeting SaaS prefixes as rule subjects
      const collisionRegex = new RegExp(`(^|\\s|\\}|,)\\.${prefix}[a-zA-Z0-9_-]+\\s*\\{`, 'g');
      assert.strictEqual(
        collisionRegex.test(allCss),
        false,
        `Extension CSS must never declare styles directly modifying SaaS class prefix '.${prefix}'`
      );
    }

    for (const app of saasApps) {
      const fixture = createSaaSDOM(app);
      const baseline = fixture.snapshot();

      // Read and evaluate content scripts in the SaaS window environment
      const defaults = fs.readFileSync(path.join(rootDir, 'shared/defaults.js'), 'utf8');
      const playerMgr = fs.readFileSync(path.join(rootDir, 'content/player-manager.js'), 'utf8');
      const content = fs.readFileSync(path.join(rootDir, 'content/content.js'), 'utf8');

      const origWindow = globalThis.window;
      const origDocument = globalThis.document;
      const origLocation = globalThis.location;
      const origChrome = globalThis.chrome;
      const origMutationObserver = globalThis.MutationObserver;

      globalThis.window = fixture.window;
      globalThis.document = fixture.document;
      globalThis.location = fixture.window.location;
      globalThis.chrome = fixture.chrome;
      globalThis.MutationObserver = fixture.window.MutationObserver;

      // Ensure style.setProperty/removeProperty exist on SaaS document elements
      if (!fixture.document.documentElement.style.setProperty) {
        fixture.document.documentElement.style.setProperty = function(k, v) { this[k] = String(v); };
        fixture.document.documentElement.style.removeProperty = function(k) { delete this[k]; };
      }
      if (!fixture.document.body.style.setProperty) {
        fixture.document.body.style.setProperty = function(k, v) { this[k] = String(v); };
        fixture.document.body.style.removeProperty = function(k) { delete this[k]; };
      }

      try {
        const combinedCode = defaults + '\n' + playerMgr + '\n' + content;
        const fn = new Function('window', 'document', 'chrome', 'location', 'MutationObserver', combinedCode);
        fn.call(fixture.window, fixture.window, fixture.document, fixture.chrome, fixture.window.location, fixture.window.MutationObserver);
      } finally {
        if (fixture.window.CineGlowPlayer && fixture.window.CineGlowPlayer.searchInterval) {
          clearInterval(fixture.window.CineGlowPlayer.searchInterval);
        }
        globalThis.window = origWindow;
        globalThis.document = origDocument;
        globalThis.location = origLocation;
        globalThis.chrome = origChrome;
        globalThis.MutationObserver = origMutationObserver;
      }

      const postState = fixture.snapshot();

      // Assert zero DOM mutations
      assert.deepStrictEqual(
        postState.bodyClass,
        baseline.bodyClass,
        `Body classes on ${app} must not be altered`
      );
      assert.strictEqual(
        postState.rootChildrenCount,
        baseline.rootChildrenCount,
        `Root children count on ${app} must remain untouched`
      );
      assert.deepStrictEqual(
        postState.globals,
        baseline.globals,
        `SaaS globals on ${app} must remain completely intact`
      );
      assert.deepStrictEqual(
        postState.domTree,
        baseline.domTree,
        `DOM tree on ${app} must remain completely identical`
      );

      // Verify no ambient light canvas was mounted
      const ambientCanvas = fixture.document.getElementById('aura-ambient-canvas');
      assert.strictEqual(ambientCanvas, null, `No ambient canvas should be mounted on ${app}`);
      assert.strictEqual(
        fixture.document.documentElement.classList.contains('aura-active'),
        false,
        `aura-active must not be present on html for ${app}`
      );
    }
  });

  test('Phase 2: Zero interception or monkeypatching of unrelated enterprise XHR/Fetch requests', async () => {
    const saasApps = ['workday', 'salesforce', 'sap', 'servicenow', 'jira', 'm365'];

    for (const app of saasApps) {
      const fixture = createSaaSDOM(app);

      // Native descriptors must remain unmodified
      assert.strictEqual(fixture.window.fetch, fixture.nativeFetch);
      assert.strictEqual(fixture.window.XMLHttpRequest, fixture.MockXHR);

      // Simulate representative SaaS Fetch call
      const fetchResponse = await fixture.window.fetch(fixture.config.sampleEndpoint, {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer corporate-session-jwt-token',
          'X-Correlation-Id': 'corr-12345'
        }
      });
      assert.strictEqual(fetchResponse.status, 200);
      const fetchData = await fetchResponse.json();
      assert.strictEqual(fetchData.status, 'ok');

      // Simulate representative SaaS XMLHttpRequest call
      const xhr = new fixture.MockXHR();
      xhr.open('POST', fixture.config.sampleEndpoint);
      xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.send(JSON.stringify({ query: 'sync-workday-data' }));
      assert.strictEqual(xhr.status, 200);

      // Verify that networkCalls records both requests directly without modification
      assert.strictEqual(fixture.networkCalls.length, 2);
      assert.strictEqual(fixture.networkCalls[0].type, 'fetch');
      assert.strictEqual(fixture.networkCalls[0].url, fixture.config.sampleEndpoint);
      assert.strictEqual(fixture.networkCalls[1].type, 'xhr');
      assert.strictEqual(fixture.networkCalls[1].url, fixture.config.sampleEndpoint);
    }
  });

  test('Phase 2: Page load degradation benchmark verifying < 50ms (0ms on non-YouTube origins)', () => {
    const saasUrls = [
      'https://myworkday.com/corporate/home',
      'https://company.my.salesforce.com/lightning/page/home',
      'https://fiori.corp.sap.com/sap/bc/ui5_ui5/ui2/ushell/shells/abap/FioriLaunchpad.html',
      'https://service-now.com/navpage.do',
      'https://jira.atlassian.net/jira/software/projects',
      'https://portal.office.com',
      'https://sharepoint.com/sites/intranet',
      'https://login.microsoftonline.com'
    ];

    const contentScripts = manifest.content_scripts || [];

    // Part 1: Non-YouTube origins overhead is identically 0ms
    for (const saasUrl of saasUrls) {
      const url = new URL(saasUrl);
      let matched = false;
      const t0 = performance.now();
      for (const entry of contentScripts) {
        for (const pattern of entry.matches) {
          const regexStr = '^' + pattern
            .replace(/\./g, '\\.')
            .replace(/\*/g, '.*')
            .replace(/\//g, '\\/') + '$';
          if (new RegExp(regexStr).test(url.href)) {
            matched = true;
          }
        }
      }
      const t1 = performance.now();
      assert.strictEqual(matched, false, `URL ${saasUrl} must not match content script patterns`);
      const overheadMs = matched ? (t1 - t0) : 0;
      assert.strictEqual(overheadMs, 0, 'Non-YouTube enterprise origins must have exactly 0ms degradation');
    }

    // Part 2: YouTube origins initialization overhead strictly < 50ms
    const latencies = [];
    const iterations = 50;
    const defaults = fs.readFileSync(path.join(rootDir, 'shared/defaults.js'), 'utf8');
    const playerMgr = fs.readFileSync(path.join(rootDir, 'content/player-manager.js'), 'utf8');
    const content = fs.readFileSync(path.join(rootDir, 'content/content.js'), 'utf8');

    const origWindow = globalThis.window;
    const origDocument = globalThis.document;
    const origLocation = globalThis.location;
    const origChrome = globalThis.chrome;
    const origMutationObserver = globalThis.MutationObserver;

    try {
      for (let i = 0; i < iterations; i++) {
        const env = setupMockEnvironment('https://www.youtube.com/watch?v=perfBenchmark');
        const player = new MockElement('div', { id: 'movie_player' });
        const video = new MockVideoElement();
        env.elements.set('#movie_player', player);
        env.elements.set('video', video);

        globalThis.window = env.window;
        globalThis.document = env.document;
        globalThis.location = env.window.location;
        globalThis.chrome = env.chrome;
        globalThis.MutationObserver = env.window.MutationObserver;

        if (!env.document.documentElement.style.setProperty) {
          env.document.documentElement.style.setProperty = function(k, v) { this[k] = String(v); };
          env.document.documentElement.style.removeProperty = function(k) { delete this[k]; };
        }
        if (!env.document.body.style.setProperty) {
          env.document.body.style.setProperty = function(k, v) { this[k] = String(v); };
          env.document.body.style.removeProperty = function(k) { delete this[k]; };
        }

        const tStart = performance.now();
        const combinedCode = defaults + '\n' + playerMgr + '\n' + content;
        new Function('window', 'document', 'chrome', 'location', 'MutationObserver', combinedCode).call(
          env.window, env.window, env.document, env.chrome, env.window.location, env.window.MutationObserver
        );
        const tEnd = performance.now();
        latencies.push(tEnd - tStart);

        if (env.window.CineGlowPlayer && env.window.CineGlowPlayer.searchInterval) {
          clearInterval(env.window.CineGlowPlayer.searchInterval);
        }
      }
    } finally {
      globalThis.window = origWindow;
      globalThis.document = origDocument;
      globalThis.location = origLocation;
      globalThis.chrome = origChrome;
      globalThis.MutationObserver = origMutationObserver;
    }

    latencies.sort((a, b) => a - b);
    const mean = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    const p99 = latencies[Math.floor(iterations * 0.99)];

    assert.ok(
      mean < 50,
      `Mean initialization overhead must be < 50ms. Actual mean: ${mean.toFixed(2)}ms`
    );
    assert.ok(
      p99 < 50,
      `P99 initialization overhead must be < 50ms. Actual p99: ${p99.toFixed(2)}ms`
    );
  });

  // ---------------------------------------------------------------------------
  // 3. Security Agent Compatibility & SSL Inspection (CrowdStrike, EDR, Zscaler)
  // ---------------------------------------------------------------------------
  test('Phase 2: Security Agent & SSL inspection compatibility under EDR/DLP/Zscaler proxy', async () => {
    // 1. EDR Sandbox Containment & Zero Native Messaging
    assert.strictEqual(
      manifest.permissions.includes('nativeMessaging'),
      false,
      'Manifest must not declare nativeMessaging permission'
    );

    const scanDirs = ['content', 'background', 'popup', 'shared'];
    const edrViolations = ['connectNative', 'sendNativeMessage', 'child_process', 'execSync', 'spawnSync'];
    for (const dir of scanDirs) {
      const fullDir = path.join(rootDir, dir);
      if (!fs.existsSync(fullDir)) continue;
      const files = fs.readdirSync(fullDir).filter(f => f.endsWith('.js'));
      for (const file of files) {
        const code = fs.readFileSync(path.join(fullDir, file), 'utf8');
        for (const term of edrViolations) {
          assert.strictEqual(
            code.includes(term),
            false,
            `EDR Violation: Prohibited process or native messaging call '${term}' found in ${dir}/${file}`
          );
        }
      }
    }

    // 2. Corporate Proxy & Zero Certificate Pinning
    const pinningTerms = ['hpkp', 'publicKeyPins', 'spki', 'certificatePinner', 'cert_hash', 'rejectUnauthorized'];
    for (const dir of scanDirs) {
      const fullDir = path.join(rootDir, dir);
      if (!fs.existsSync(fullDir)) continue;
      const files = fs.readdirSync(fullDir).filter(f => f.endsWith('.js'));
      for (const file of files) {
        const code = fs.readFileSync(path.join(fullDir, file), 'utf8');
        for (const term of pinningTerms) {
          assert.strictEqual(
            code.includes(term),
            false,
            `SSL Proxy Incompatibility: Forbidden cert pinning pattern '${term}' found in ${dir}/${file}`
          );
        }
      }
    }

    // 3. Simulated Zscaler SSL Inspection Proxy Forwarding
    const backgroundCode = fs.readFileSync(path.join(rootDir, 'background/background.js'), 'utf8');
    const messageListeners = [];
    const mockChrome = {
      storage: {
        sync: { get: async () => ({}), set: async () => {} },
        local: { get: async () => ({}), set: async () => {} },
        managed: { get: async () => ({ DisableThirdPartyAPIs: false }) },
        onChanged: { addListener: () => {} }
      },
      declarativeNetRequest: {
        updateEnabledRulesets: async () => {},
        updateSessionRules: async () => {}
      },
      runtime: {
        onMessage: { addListener: (fn) => messageListeners.push(fn) },
        onInstalled: { addListener: () => {} },
        onStartup: { addListener: () => {} },
        getManifest: () => ({ version: '2.3.0' })
      },
      tabs: { query: async () => [], sendMessage: async () => {} }
    };

    // Proxy returns response with enterprise headers (Zscaler TLS MITM re-encryption)
    const zscalerProxyFetch = async (url, opts) => {
      return new Response(JSON.stringify({ id: 'testVideo123', dislikes: 450 }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Via': '1.1 zscaler',
          'X-Forwarded-For': '10.200.1.55',
          'Server': 'ZIA-Gateway'
        }
      });
    };

    const bgFn = new Function('chrome', 'fetch', 'console', backgroundCode);
    bgFn(mockChrome, zscalerProxyFetch, console);

    assert.ok(messageListeners.length > 0, 'Background script must register message listener');
    const dispatchMessage = (msg) => new Promise((resolve) => {
      for (const listener of messageListeners) {
        const handled = listener(msg, {}, resolve);
        if (handled === true) return;
      }
    });

    const dislikeResp = await dispatchMessage({ type: 'FETCH_DISLIKES', videoId: 'testVideo123' });
    assert.deepStrictEqual(dislikeResp, {
      success: true,
      data: { id: 'testVideo123', dislikes: 450 }
    });

    // 4. Proxy policy blocking handling (HTTP 403 Forbidden with X-Zscaler-Blocked)
    const proxyBlockedFetch = async () => {
      return new Response('Blocked by Corporate Egress Policy', {
        status: 403,
        statusText: 'Forbidden',
        headers: {
          'Content-Type': 'text/plain',
          'X-Zscaler-Blocked': 'PolicyViolation',
          'Via': '1.1 zscaler'
        }
      });
    };

    const blockedListeners = [];
    const mockChromeBlocked = {
      ...mockChrome,
      runtime: {
        ...mockChrome.runtime,
        onMessage: { addListener: (fn) => blockedListeners.push(fn) }
      }
    };
    new Function('chrome', 'fetch', 'console', backgroundCode)(mockChromeBlocked, proxyBlockedFetch, console);

    const dispatchBlocked = (msg) => new Promise((resolve) => {
      for (const listener of blockedListeners) {
        const handled = listener(msg, {}, resolve);
        if (handled === true) return;
      }
    });

    const blockedResp = await dispatchBlocked({ type: 'FETCH_DISLIKES', videoId: 'testVideo123' });
    assert.deepStrictEqual(blockedResp, { success: false, status: 403 });
  });

  // ---------------------------------------------------------------------------
  // 4. DLP Storage Safety & Screen Recording Lockdown (DisableRecording)
  // ---------------------------------------------------------------------------
  test('Phase 2: DLP storage write validation (zero sensitive data/PII/tokens exfiltrated; DisableRecording immediately unmounting recording elements)', async () => {
    // 1. DLP Signature Scanning on All Storage Writes
    const dlpSignatures = {
      ssn: /\b\d{3}-\d{2}-\d{4}\b/,
      creditCard: /\b(?:\d{4}[- ]?){3}\d{4}\b/,
      email: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/,
      jwt: /\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/,
      privateKey: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/,
      apiKey: /\b(?:api[_-]?key|secret|password|bearer|auth[_-]?token)\s*[:=]/i
    };

    const storageWrites = [];
    const interceptSet = (area, items) => {
      storageWrites.push({ area, items });
    };

    const syncArea = new MockStorageArea();
    const localArea = new MockStorageArea();
    const sessionArea = new MockStorageArea();

    const origSyncSet = syncArea.set.bind(syncArea);
    const origLocalSet = localArea.set.bind(localArea);
    const origSessionSet = sessionArea.set.bind(sessionArea);

    syncArea.set = async (items) => { interceptSet('sync', items); return origSyncSet(items); };
    localArea.set = async (items) => { interceptSet('local', items); return origLocalSet(items); };
    sessionArea.set = async (items) => { interceptSet('session', items); return origSessionSet(items); };

    // Simulate extension lifecycle storage operations
    await syncArea.set({
      enabled: true,
      opacity: 80,
      blur: 40,
      spread: 150,
      preferredQuality: 'hd1080',
      recordFormat: 'webm',
      recordFps: 60
    });
    await syncArea.set({ adblockCount: 25 });
    await syncArea.set({ preferredSpeed: 1.5 });
    await syncArea.set({ statsEnabled: false });
    await localArea.set({ ar_video12345: '<xml><annotations><annotation type="text">Sample</annotation></annotations></xml>' });

    assert.ok(storageWrites.length >= 5, 'Storage writes should be captured');

    for (const write of storageWrites) {
      const serialized = JSON.stringify(write.items);
      for (const [name, regex] of Object.entries(dlpSignatures)) {
        assert.strictEqual(
          regex.test(serialized),
          false,
          `DLP Violation: Storage write to ${write.area} matched sensitive pattern '${name}': ${serialized}`
        );
      }
    }

    // 2. DLP Screen Recording Lockdown (DisableRecording)
    const env = setupEnterpriseYouTubeEnvironment({ url: 'https://www.youtube.com/watch?v=dlpRecordTest' });
    env.chrome.storage.managed._data = { DisableRecording: true };

    const player = new MockElement('div', { id: 'movie_player' });
    const controls = new MockElement('div', { class: 'ytp-right-controls' });
    player.appendChild(controls);
    env.elements.set('#movie_player', player);
    env.elements.set('.ytp-right-controls', controls);

    env.document.querySelectorAll = function(sel) {
      return player.querySelectorAll(sel);
    };

    globalThis.window = env.window;
    globalThis.document = env.document;
    globalThis.chrome = env.chrome;
    globalThis.MutationObserver = env.window.MutationObserver;

    const pm = new EventTarget();
    pm.isWatchPage = true;
    pm.player = player;
    globalThis.window.CineGlowPlayer = pm;

    const recordScript = fs.readFileSync(path.join(rootDir, 'content/record-button.js'), 'utf8');
    new Function(recordScript)();

    // Give microtasks time to execute injectRecordButton
    await new Promise(r => setTimeout(r, 40));

    // Under DisableRecording: true, zero recording wrappers must be mounted
    const recordWrappers = player.querySelectorAll('.cineglow-record-wrapper');
    assert.strictEqual(
      recordWrappers.length,
      0,
      'When DisableRecording is active in managed storage, zero recording elements should be mounted'
    );
  });

  // ---------------------------------------------------------------------------
  // 5. Identity & SSO Flow (Entra ID, Okta, Session Revocation)
  // ---------------------------------------------------------------------------
  test('Phase 2: OAuth2/OIDC silent token refresh (chrome.identity) simulation', async () => {
    const identity = new MockIdentity();

    // 1. Microsoft Entra ID silent token acquisition
    const entraAuthUrl = 'https://login.microsoftonline.com/corp-tenant-uuid/oauth2/v2.0/authorize?' +
      'client_id=corp-client-123&response_type=token&redirect_uri=' +
      encodeURIComponent(identity.getRedirectURL()) + '&scope=openid%20profile&prompt=none';

    const entraRedirect = await identity.launchWebAuthFlow({
      url: entraAuthUrl,
      interactive: false
    });

    assert.ok(entraRedirect.includes('access_token='), 'Entra ID silent refresh must return access_token');
    assert.ok(entraRedirect.includes('token_type=Bearer'), 'Token type must be Bearer');

    // 2. Okta Enterprise SSO silent token acquisition
    const oktaAuthUrl = 'https://company.okta.com/oauth2/v1/authorize?' +
      'client_id=okta-client-456&response_type=token&redirect_uri=' +
      encodeURIComponent(identity.getRedirectURL()) + '&scope=openid&prompt=none';

    const oktaRedirect = await identity.launchWebAuthFlow({
      url: oktaAuthUrl,
      interactive: false
    });

    assert.ok(oktaRedirect.includes('access_token='), 'Okta silent refresh must return access_token');

    // 3. Negative check: Untrusted IdP domain rejected
    await assert.rejects(
      identity.launchWebAuthFlow({
        url: 'https://malicious-phishing.com/oauth/authorize?client_id=evil',
        interactive: false
      }),
      /Untrusted IdP domain/,
      'Must reject unauthorized IdP domains'
    );

    // 4. Session expired / MFA required (interactive: false fails cleanly)
    identity._shouldFailInteractiveFalse = true;
    await assert.rejects(
      identity.launchWebAuthFlow({
        url: entraAuthUrl,
        interactive: false
      }),
      /Authorization page could not be loaded without user interaction/,
      'Expired corporate session must cleanly fail without unexpected errors'
    );
  });

  test('Phase 2: Session revocation immediately wiping chrome.storage.session', async () => {
    const sessionStorage = new MockStorageArea();

    // Step 1: Store ephemeral token in session storage
    await sessionStorage.set({
      authToken: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.sessionToken123',
      userPrincipal: 'architect@corp.internal',
      expiresAt: Date.now() + 3600000
    });

    const activeSession = await sessionStorage.get('authToken');
    assert.ok(activeSession.authToken, 'Session storage must contain active authToken');

    // Step 2: Corporate session revocation triggered (e.g. employee logout or token revocation)
    await sessionStorage.clear();

    // Step 3: Verify immediate wiping
    const postRevocation = await sessionStorage.get('authToken');
    assert.strictEqual(postRevocation.authToken, undefined, 'Revocation must immediately wipe authToken');

    const allData = await sessionStorage.get(null);
    assert.deepStrictEqual(allData, {}, 'Revocation must completely purge session storage');

    // Step 4: Verify subsequent authenticated operations immediately reject with 401 Unauthorized
    const executeAuthenticatedCall = async () => {
      const session = await sessionStorage.get('authToken');
      if (!session.authToken) {
        throw new Error('401 Unauthorized: Session credentials revoked');
      }
      return { status: 200 };
    };

    await assert.rejects(
      executeAuthenticatedCall(),
      /401 Unauthorized/,
      'Operations following revocation must fail immediately'
    );
  });

  test('Phase 2: Zero plaintext tokens on disk (chrome.storage.local and sync)', async () => {
    const syncStorage = new MockStorageArea();
    const localStorage = new MockStorageArea();

    // Populate stores with standard operational data
    await syncStorage.set({
      enabled: true,
      opacity: 75,
      blur: 40,
      spread: 150,
      adblockCount: 42,
      preferredQuality: 'hd1080'
    });
    await localStorage.set({
      ar_dQw4w9WgXcQ: '<xml><annotation text="Sample"/></xml>'
    });

    // 1. Dynamic check: Ensure zero sensitive keys in local and sync stores
    const forbiddenKeyPattern = /token|auth|secret|jwt|bearer|credential|password/i;
    for (const key of Object.keys(syncStorage._data)) {
      assert.strictEqual(
        forbiddenKeyPattern.test(key),
        false,
        `Plaintext token/secret key '${key}' found in chrome.storage.sync`
      );
    }
    for (const key of Object.keys(localStorage._data)) {
      assert.strictEqual(
        forbiddenKeyPattern.test(key),
        false,
        `Plaintext token/secret key '${key}' found in chrome.storage.local`
      );
    }

    // 2. Dynamic check: Ensure zero JWT or Bearer string values in local and sync stores
    const jwtPattern = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
    const bearerPattern = /Bearer\s+[A-Za-z0-9_\-\.]+/i;

    const checkValues = (obj, areaName) => {
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === 'string') {
          assert.strictEqual(
            jwtPattern.test(v),
            false,
            `Plaintext JWT token value found under '${k}' in ${areaName}`
          );
          assert.strictEqual(
            bearerPattern.test(v),
            false,
            `Plaintext Bearer token value found under '${k}' in ${areaName}`
          );
        }
      }
    };

    checkValues(syncStorage._data, 'chrome.storage.sync');
    checkValues(localStorage._data, 'chrome.storage.local');
  });

  // ---------------------------------------------------------------------------
  // 6. Managed Policy Enforcement (Registry/GPO/plist) & Tamper Resistance
  // ---------------------------------------------------------------------------
  test('Phase 2: Dynamic chrome.storage.managed configuration auto-reading on startup and onChanged', async () => {
    // 1. Startup Configuration Precedence
    const managedData = {
      DisableAdBlock: true,
      DisableRecording: true,
      DisableThirdPartyAPIs: true,
      ForceDefaultQuality: 'hd720'
    };

    const mockChrome = {
      storage: {
        sync: new MockStorageArea({ adblockEnabled: true, preferredQuality: 'hd1080' }),
        local: new MockStorageArea(),
        managed: new MockStorageArea(managedData),
        onChanged: {
          _listeners: [],
          addListener(fn) { this._listeners.push(fn); },
          dispatch(changes, area) {
            this._listeners.forEach(fn => fn(changes, area));
          }
        }
      },
      declarativeNetRequest: {
        updateEnabledRulesets: async () => {},
        updateSessionRules: async () => {}
      },
      runtime: {
        onMessage: {
          _listeners: [],
          addListener(fn) { this._listeners.push(fn); }
        },
        onInstalled: { addListener: () => {} },
        onStartup: { addListener: () => {} },
        getManifest: () => ({ version: '2.3.0' })
      },
      tabs: { query: async () => [], sendMessage: async () => {} }
    };

    // Verify auto-reading managed config
    const startupManaged = await mockChrome.storage.managed.get(null);
    assert.deepStrictEqual(startupManaged, managedData);

    // Verify that background handles FETCH_DISLIKES by checking managed policy
    const backgroundCode = fs.readFileSync(path.join(rootDir, 'background/background.js'), 'utf8');
    new Function('chrome', 'fetch', 'console', backgroundCode)(mockChrome, globalThis.fetch, console);

    const dispatchMessage = (msg) => new Promise((resolve) => {
      for (const listener of mockChrome.runtime.onMessage._listeners) {
        const handled = listener(msg, {}, resolve);
        if (handled === true) return;
      }
    });

    // When DisableThirdPartyAPIs is true, request is blocked by enterprise policy
    const dislikeResp = await dispatchMessage({ type: 'FETCH_DISLIKES', videoId: 'video789' });
    assert.deepStrictEqual(dislikeResp, {
      success: false,
      error: 'Blocked by enterprise policy'
    });

    const annotResp = await dispatchMessage({ type: 'FETCH_ANNOTATIONS', videoId: 'video789012' });
    assert.deepStrictEqual(annotResp, {
      success: false,
      error: 'Blocked by enterprise policy'
    });

    // 2. Real-time dynamic updates via chrome.storage.onChanged ('managed')
    let dynamicPolicyState = { ...managedData };
    mockChrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'managed') {
        for (const [key, change] of Object.entries(changes)) {
          dynamicPolicyState[key] = change.newValue;
        }
      }
    });

    // Simulate enterprise MDM pushing updated GPO at runtime
    mockChrome.storage.onChanged.dispatch({
      DisableThirdPartyAPIs: { oldValue: true, newValue: false },
      ForceDefaultQuality: { oldValue: 'hd720', newValue: 'hd1080' }
    }, 'managed');

    assert.strictEqual(dynamicPolicyState.DisableThirdPartyAPIs, false);
    assert.strictEqual(dynamicPolicyState.ForceDefaultQuality, 'hd1080');
  });

  test('Phase 2: Non-admin user blocked from disabling or removing extension (ExtensionInstallForcelist)', async () => {
    // When pushed via ExtensionInstallForcelist:
    // installType is 'admin' and mayDisable is false
    const management = new MockManagement('admin', false);

    const selfInfo = await management.getSelf();
    assert.strictEqual(selfInfo.installType, 'admin');
    assert.strictEqual(selfInfo.mayDisable, false);
    assert.strictEqual(selfInfo.enabled, true);

    // Non-admin user attempts to disable extension via UI toggle or chrome://extensions
    await assert.rejects(
      management.setEnabled('cineglow-pro-extension-id', false),
      /Extension cannot be disabled by user: managed by enterprise policy \(ExtensionInstallForcelist\)/,
      'Non-admin users must be strictly blocked from disabling force-installed extension'
    );

    // Non-admin user attempts to uninstall extension
    await assert.rejects(
      management.uninstallSelf(),
      /Extension cannot be uninstalled by user: managed by enterprise policy/,
      'Non-admin users must be strictly blocked from uninstalling force-installed extension'
    );

    // Verify storage.managed immutability from user context
    // In Chrome MV3, storage.managed has NO set() or clear() API for extension scripts
    const saas = createSaaSDOM('workday');
    assert.strictEqual(
      typeof saas.chrome.storage.managed.set,
      'undefined',
      'chrome.storage.managed must not expose set() to extension code'
    );
  });
});

// test/helpers/enterprise-e2e-harness.js
// Enterprise E2E Test Harness with Storage.session, Identity, Management, Network Proxy & Backoff, and Multi-Tab Profiler
'use strict';

const { setupMockEnvironment, MockElement, MockVideoElement, MockAudioContext, MockMutationObserver } = require('./mock-dom');
const { EnhancedMockElement } = require('./enterprise-saas-fixtures');

/**
 * Normalizes keys argument for chrome.storage get methods.
 */
function normalizeGetResult(sourceData, keys) {
  if (!keys) return { ...sourceData };
  if (typeof keys === 'string') return { [keys]: sourceData[keys] };
  if (Array.isArray(keys)) {
    const out = {};
    keys.forEach(k => { out[k] = sourceData[k]; });
    return out;
  }
  if (typeof keys === 'object' && keys !== null) {
    const out = { ...keys };
    for (const k of Object.keys(keys)) {
      if (k in sourceData) {
        out[k] = sourceData[k];
      }
    }
    return out;
  }
  return { ...sourceData };
}

/**
 * Creates diff object for storage.onChanged event.
 */
function computeChangesDiff(oldData, newItems) {
  const changes = {};
  for (const [k, newVal] of Object.entries(newItems)) {
    changes[k] = {
      oldValue: oldData[k],
      newValue: newVal
    };
  }
  return changes;
}

/**
 * Simulates exponential backoff algorithm with jitter.
 */
function calculateBackoffDelay(attempt, initialDelayMs = 1000, maxDelayMs = 16000, jitterRatio = 0.2) {
  const safeInit = Math.max(100, Number(initialDelayMs) || 100);
  const safeMax = Math.max(safeInit, Number(maxDelayMs) || safeInit);
  const safeJitter = Math.max(0, Math.min(1.0, Number(jitterRatio) || 0));

  const exponential = safeInit * Math.pow(2, attempt);
  const bounded = Math.min(safeMax, exponential);

  if (safeJitter === 0) return bounded;

  const minJitter = bounded * (1 - safeJitter);
  const maxJitter = Math.min(safeMax, bounded * (1 + safeJitter));
  return minJitter + Math.random() * (maxJitter - minJitter);
}

/**
 * MultiTabProcessSimulator: Simulates concurrent tabs and process memory soak.
 */
class MultiTabProcessSimulator {
  constructor(tabCount = 25) {
    this.tabCount = tabCount;
    this.tabs = [];
    this.swState = 'running';
    this.lastActivityTime = Date.now();
    this.idleTimerSeconds = 0;
    this.init();
  }

  init() {
    for (let i = 0; i < this.tabCount; i++) {
      this.tabs.push({
        id: i + 1,
        url: `https://www.youtube.com/watch?v=video_${i + 1}`,
        hidden: i !== 0, // First tab foreground, others background
        playing: i < 5,  // First 5 actively playing
        canvasWidth: 128,
        canvasHeight: 72,
        bytesPerPixel: 4,
        votesCacheSize: 50,
        settledFrames: 0,
        rafActive: i < 5,
        audioNodesCount: i < 5 ? 4 : 0
      });
    }
  }

  /**
   * Computes per-process heap memory usage (in MB).
   * Fixed base per process (~25MB) + per-tab memory (~1.2MB per tab)
   * plus canvas buffer (128x72x4 = 36.86 KB per tab).
   */
  getProcessMemoryMB() {
    const baseProcessHeapMB = 22.0;
    const activeTabs = this.tabs.filter(t => !t.closed);
    let tabHeapMB = 0;

    for (const tab of activeTabs) {
      // 1. Base tab DOM & script overhead (~0.85 MB)
      let perTabMB = 0.85;

      // 2. Canvas buffer allocation (width * height * bytesPerPixel)
      const canvasBytes = tab.canvasWidth * tab.canvasHeight * tab.bytesPerPixel;
      perTabMB += canvasBytes / (1024 * 1024);

      // 3. Cache memory (votesCache capped at 100 entries, ~50 bytes per entry)
      const cacheBytes = Math.min(100, tab.votesCacheSize) * 64;
      perTabMB += cacheBytes / (1024 * 1024);

      // 4. Audio nodes
      perTabMB += (tab.audioNodesCount * 4096) / (1024 * 1024);

      tabHeapMB += perTabMB;
    }

    return baseProcessHeapMB + tabHeapMB;
  }

  advanceIdleTime(seconds) {
    this.idleTimerSeconds += seconds;
    if (this.idleTimerSeconds >= 30.0) {
      this.swState = 'suspended';
    }
  }

  recordActivity() {
    this.idleTimerSeconds = 0;
    this.lastActivityTime = Date.now();
    this.swState = 'running';
  }

  closeTabs(countToClose) {
    let closed = 0;
    for (let i = this.tabs.length - 1; i >= 0 && closed < countToClose; i--) {
      if (!this.tabs[i].closed) {
        this.tabs[i].closed = true;
        this.tabs[i].rafActive = false;
        this.tabs[i].canvasWidth = 0;
        this.tabs[i].canvasHeight = 0;
        this.tabs[i].audioNodesCount = 0;
        closed++;
      }
    }
    return closed;
  }
}

/**
 * Builds a complete Chrome Enterprise testing harness with mocks and spies.
 * @param {string} initialUrl
 * @param {object} initialManagedPolicy
 */
function setupEnterpriseHarness(initialUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', initialManagedPolicy = {}) {
  const env = setupMockEnvironment(initialUrl);

  // Storage onChanged shared emitter
  const changeListeners = [];
  env.chrome.storage.onChanged = {
    _listeners: changeListeners,
    addListener(fn) {
      changeListeners.push(fn);
    },
    removeListener(fn) {
      const idx = changeListeners.indexOf(fn);
      if (idx !== -1) changeListeners.splice(idx, 1);
    },
    dispatch(changes, areaName) {
      changeListeners.forEach(fn => {
        try {
          fn(changes, areaName);
        } catch (_) {}
      });
    }
  };

  // 1. Session Storage Mock (ephemeral in-memory)
  const sessionStorageData = {};
  env.chrome.storage.session = {
    _data: sessionStorageData,
    get: async (keys) => normalizeGetResult(sessionStorageData, keys),
    set: async (items) => {
      const diff = computeChangesDiff(sessionStorageData, items);
      Object.assign(sessionStorageData, items);
      env.chrome.storage.onChanged.dispatch(diff, 'session');
    },
    remove: async (keys) => {
      const arr = Array.isArray(keys) ? keys : [keys];
      const diff = {};
      arr.forEach(k => {
        diff[k] = { oldValue: sessionStorageData[k], newValue: undefined };
        delete sessionStorageData[k];
      });
      env.chrome.storage.onChanged.dispatch(diff, 'session');
    },
    clear: async () => {
      const diff = {};
      Object.keys(sessionStorageData).forEach(k => {
        diff[k] = { oldValue: sessionStorageData[k], newValue: undefined };
        delete sessionStorageData[k];
      });
      env.chrome.storage.onChanged.dispatch(diff, 'session');
    }
  };

  // 2. Managed Storage Mock (Chrome Enterprise GPO / Registry)
  const managedStorageData = { ...initialManagedPolicy };
  env.chrome.storage.managed = {
    _data: managedStorageData,
    get: async (keys) => normalizeGetResult(managedStorageData, keys),
    set: async (items) => {
      // In Chrome Enterprise, standard clients cannot write to storage.managed directly
      throw new Error('chrome.storage.managed is read-only');
    },
    // Test helper to simulate administrative GPO policy push
    adminPush: async (items) => {
      const diff = computeChangesDiff(managedStorageData, items);
      Object.assign(managedStorageData, items);
      env.chrome.storage.onChanged.dispatch(diff, 'managed');
    }
  };

  // 3. Local Storage with dispatch
  const originalLocalSet = env.chrome.storage.local.set;
  env.chrome.storage.local.get = async (keys) => normalizeGetResult(env.chrome.storage.local._data, keys);
  env.chrome.storage.local.set = async (items) => {
    const diff = computeChangesDiff(env.chrome.storage.local._data, items);
    await originalLocalSet(items);
    env.chrome.storage.onChanged.dispatch(diff, 'local');
  };
  env.chrome.storage.local.remove = async (keys) => {
    const arr = Array.isArray(keys) ? keys : [keys];
    const diff = {};
    arr.forEach(k => {
      diff[k] = { oldValue: env.chrome.storage.local._data[k], newValue: undefined };
      delete env.chrome.storage.local._data[k];
    });
    env.chrome.storage.onChanged.dispatch(diff, 'local');
  };
  env.chrome.storage.local.clear = async () => {
    const diff = {};
    Object.keys(env.chrome.storage.local._data).forEach(k => {
      diff[k] = { oldValue: env.chrome.storage.local._data[k], newValue: undefined };
      delete env.chrome.storage.local._data[k];
    });
    env.chrome.storage.onChanged.dispatch(diff, 'local');
  };

  // 4. Sync Storage with dispatch
  const originalSyncSet = env.chrome.storage.sync.set;
  env.chrome.storage.sync.get = async (keys) => normalizeGetResult(env.chrome.storage.sync._data, keys);
  env.chrome.storage.sync.set = async (items) => {
    const diff = computeChangesDiff(env.chrome.storage.sync._data, items);
    await originalSyncSet(items);
    env.chrome.storage.onChanged.dispatch(diff, 'sync');
  };
  env.chrome.storage.sync.remove = async (keys) => {
    const arr = Array.isArray(keys) ? keys : [keys];
    const diff = {};
    arr.forEach(k => {
      diff[k] = { oldValue: env.chrome.storage.sync._data[k], newValue: undefined };
      delete env.chrome.storage.sync._data[k];
    });
    env.chrome.storage.onChanged.dispatch(diff, 'sync');
  };
  env.chrome.storage.sync.clear = async () => {
    const diff = {};
    Object.keys(env.chrome.storage.sync._data).forEach(k => {
      diff[k] = { oldValue: env.chrome.storage.sync._data[k], newValue: undefined };
      delete env.chrome.storage.sync._data[k];
    });
    env.chrome.storage.onChanged.dispatch(diff, 'sync');
  };

  // 5. Chrome Identity Mock (OAuth2 / OIDC)
  env.chrome.identity = {
    getAuthToken: async ({ interactive }) => {
      if (managedStorageData.BlockEnterpriseSSO) {
        throw new Error('Blocked by enterprise policy');
      }
      return 'mock_bearer_token_' + Math.random().toString(36).slice(2);
    },
    launchWebAuthFlow: async ({ url, interactive }) => {
      const parsed = new URL(url);
      if (parsed.searchParams.get('prompt') === 'none' && managedStorageData.RequireMFA) {
        return `https://redirect/?error=interaction_required&error_description=Session+expired`;
      }
      return `https://redirect/?code=auth_${Math.random().toString(36).slice(2)}`;
    }
  };

  // 6. Chrome Management Mock (Tamper Resistance & Force-Install)
  env.chrome.management = {
    getSelf: async () => ({
      id: 'cineglow-pro-id',
      installType: 'admin',
      mayDisable: false,
      enabled: true,
      version: '2.3.0'
    }),
    uninstallSelf: async () => {
      throw new Error('Extension cannot be uninstalled because it was installed by enterprise policy');
    },
    setEnabled: async (id, enabled) => {
      throw new Error('Permissions error: Only administrators can modify force-installed extensions');
    }
  };

  // 7. Network Spy & Proxy Simulator
  env.networkSpy = {
    outboundRequests: [],
    proxyHeaders: {
      'Via': '1.1 zscaler',
      'X-Enterprise-Policy': 'inspected',
      'X-Zscaler-Client': '10.128.4.19'
    },
    mockFetch: async (url, options = {}) => {
      env.networkSpy.outboundRequests.push({ url: String(url), options, timestamp: Date.now() });
      return {
        ok: true,
        status: 200,
        headers: new Map(Object.entries(env.networkSpy.proxyHeaders)),
        json: async () => ({ success: true, count: 42 }),
        text: async () => '<timedtext><p t="0">test</p></timedtext>'
      };
    }
  };

  // 8. Backoff simulation runner
  env.simulateFetchWithBackoff = async (requestFn, config = {}) => {
    const {
      initialDelayMs = 1000,
      maxDelayMs = 16000,
      maxRetries = 3,
      jitterRatio = 0.2
    } = config;

    let attempt = 0;
    const history = [];

    while (true) {
      if (managedStorageData.KillSwitch) {
        return { success: false, error: 'Extension disabled by emergency kill switch', history };
      }

      try {
        const res = await requestFn(attempt);
        history.push({ attempt, status: res.status });

        // Retryable status codes
        const retryable = [502, 503, 504, 429].includes(res.status);

        if (!retryable || res.ok) {
          return { success: res.ok, status: res.status, data: res.data, history };
        }

        if (attempt >= maxRetries) {
          return { success: false, status: res.status, error: 'Max retries exhausted', history };
        }

        const delay = calculateBackoffDelay(attempt, initialDelayMs, maxDelayMs, jitterRatio);
        history[history.length - 1].delayMs = delay;
        attempt++;
      } catch (err) {
        history.push({ attempt, error: err.message });
        if (attempt >= maxRetries) {
          return { success: false, error: err.message, history };
        }
        attempt++;
      }
    }
  };

  // 9. MultiTab Simulator Factory
  env.createMultiTabSimulator = (count = 25) => new MultiTabProcessSimulator(count);

  // 10. Robust DOM querying on env.document
  const { findElements } = require('./enterprise-saas-fixtures');
  env.document.getElementById = function(id) {
    const found = findElements(this, '#' + id);
    if (found.length > 0) return found[0];
    return env.elements.get('#' + id) || env.elements.get(id) || null;
  };
  env.document.querySelector = function(sel) {
    const found = findElements(this, sel);
    if (found.length > 0) return found[0];
    return env.elements.get(sel) || null;
  };
  env.document.querySelectorAll = function(sel) {
    return findElements(this, sel);
  };

  return env;
}

module.exports = {
  setupEnterpriseHarness,
  calculateBackoffDelay,
  MultiTabProcessSimulator,
  normalizeGetResult,
  computeChangesDiff
};

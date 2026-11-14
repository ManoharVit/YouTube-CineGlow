// Background service worker for Aura
// Milestone M1: Network Backoff & Emergency Enterprise Kill-Switch
// Author: Giri Manohar Vemula (https://www.linkedin.com/in/manoharv511)

// Import shared backoff utility in classic Service Worker environment
if (typeof importScripts === 'function') {
  try {
    importScripts('/shared/network-backoff.js');
  } catch (err) {
    console.error('[Aura] Failed to import network-backoff:', err);
  }
}

// Emergency Kill-Switch State
let isKillSwitchActive = false;
let isAdBlockPolicyDisabled = false;

// Keep DNR rules and managed policies in sync with settings
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === 'sync' && 'adblockEnabled' in changes) {
    const userPref = changes.adblockEnabled.newValue ?? true;
    const isEnabled = userPref && !isAdBlockPolicyDisabled && !isKillSwitchActive;
    try {
      if (chrome.declarativeNetRequest && chrome.declarativeNetRequest.updateEnabledRulesets) {
        await chrome.declarativeNetRequest.updateEnabledRulesets({
          enableRulesetIds: isEnabled ? ['adblock_rules'] : [],
          disableRulesetIds: isEnabled ? [] : ['adblock_rules']
        });
      }
    } catch (err) {
      console.error('[Aura] Failed to update rulesets:', err);
    }
  }
  if (area === 'sync' && ('blockAV1' in changes || 'blockVP9' in changes || 'block60fps' in changes)) {
    updateCodecBlockers();
  }

  // Handle managed storage policy updates (Chrome Enterprise MDM)
  if (area === 'managed') {
    if ('KillSwitch' in changes) {
      const isKilled = changes.KillSwitch.newValue === true;
      if (isKilled) {
        await activateKillSwitch('Managed Policy KillSwitch activated via storage.onChanged');
      } else if (isKillSwitchActive) {
        await deactivateKillSwitch();
      }
    }
    if ('DisableAdBlock' in changes) {
      isAdBlockPolicyDisabled = changes.DisableAdBlock.newValue === true;
      try {
        if (chrome.declarativeNetRequest && chrome.declarativeNetRequest.updateEnabledRulesets) {
          if (isAdBlockPolicyDisabled || isKillSwitchActive) {
            await chrome.declarativeNetRequest.updateEnabledRulesets({
              disableRulesetIds: ['adblock_rules']
            }).catch(() => {});
          } else {
            const { adblockEnabled = true } = await chrome.storage.sync.get('adblockEnabled');
            if (adblockEnabled) {
              await chrome.declarativeNetRequest.updateEnabledRulesets({
                enableRulesetIds: ['adblock_rules']
              }).catch(() => {});
            }
          }
        }
      } catch (err) {
        console.error('[Aura] Failed to apply DisableAdBlock managed policy:', err);
      }
    }
  }
});

/**
 * Activates the emergency kill-switch, tearing down background egress,
 * unregistering dynamic scripts, and broadcasting the shutdown event to all tabs.
 * @param {string} reason
 */
async function activateKillSwitch(reason = 'Managed Policy KillSwitch activated') {
  if (isKillSwitchActive) return;
  isKillSwitchActive = true;
  console.warn(`[Aura Emergency] Kill-switch activated: ${reason}`);

  // Flush any pending throttled adblock and sponsorblock count writes
  flushAdBlockCount();
  flushSponsorBlockCount();

  // 1. Set persistent local flag for new tabs / re-initializations
  try {
    if (chrome.storage && chrome.storage.local) {
      await chrome.storage.local.set({ auraKillSwitchActive: true });
    }
  } catch (err) {
    console.error('[Aura Emergency] Failed to persist kill switch flag:', err);
  }

  // 2. Broadcast emergency shutdown message to all open tabs
  try {
    if (chrome.tabs && chrome.tabs.query) {
      chrome.tabs.query({}, (tabs) => {
        if (!tabs || !Array.isArray(tabs)) return;
        for (const tab of tabs) {
          if (!tab || typeof tab.id !== 'number') continue;
          try {
            const p = chrome.tabs.sendMessage(tab.id, {
              type: 'AURA_EMERGENCY_KILL_SWITCH',
              reason: reason,
              timestamp: Date.now()
            });
            if (p && typeof p.catch === 'function') {
              p.catch(() => {});
            }
          } catch (_) {}
        }
      });
    }
  } catch (err) {
    console.error('[Aura Emergency] Failed to broadcast kill switch message to tabs:', err);
  }

  // 3. Unregister dynamic content scripts (codec blockers)
  try {
    if (chrome.scripting && chrome.scripting.unregisterContentScripts) {
      const registered = await chrome.scripting.getRegisteredContentScripts().catch(() => []);
      if (registered && registered.length > 0) {
        const ids = registered.map(s => s.id);
        await chrome.scripting.unregisterContentScripts({ ids }).catch(() => {});
      }
    }
  } catch (err) {
    console.error('[Aura Emergency] Failed to unregister dynamic content scripts:', err);
  }

  // 4. Disable declarativeNetRequest adblock ruleset
  try {
    if (chrome.declarativeNetRequest && chrome.declarativeNetRequest.updateEnabledRulesets) {
      await chrome.declarativeNetRequest.updateEnabledRulesets({
        disableRulesetIds: ['adblock_rules']
      }).catch(() => {});
    }
  } catch (err) {
    console.error('[Aura Emergency] Failed to disable DNR rulesets:', err);
  }
}

// Add chrome.tabs.onUpdated listener to broadcast kill switch state to newly navigated or reloaded tabs
if (typeof chrome !== 'undefined' && chrome.tabs?.onUpdated?.addListener) {
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (isKillSwitchActive && (changeInfo.status === 'loading' || changeInfo.status === 'complete')) {
      try {
        const p = chrome.tabs.sendMessage(tabId, {
          type: 'AURA_EMERGENCY_KILL_SWITCH',
          reason: 'Emergency KillSwitch active on updated tab',
          timestamp: Date.now()
        });
        if (p && typeof p.catch === 'function') {
          p.catch(() => {});
        }
      } catch (_) {}
    }
  });
}

/**
 * Deactivates emergency kill-switch when managed policy is cleared.
 */
async function deactivateKillSwitch() {
  if (!isKillSwitchActive) return;
  isKillSwitchActive = false;
  console.info('[Aura Emergency] Kill-switch deactivated by managed policy');

  try {
    if (chrome.storage && chrome.storage.local) {
      await chrome.storage.local.set({ auraKillSwitchActive: false });
    }
  } catch (err) {}

  // Restore codec blockers and DNR rules
  updateCodecBlockers();
  try {
    const { adblockEnabled = true } = await chrome.storage.sync.get('adblockEnabled');
    if (adblockEnabled && !isAdBlockPolicyDisabled && chrome.declarativeNetRequest && chrome.declarativeNetRequest.updateEnabledRulesets) {
      await chrome.declarativeNetRequest.updateEnabledRulesets({
        enableRulesetIds: ['adblock_rules']
      }).catch(() => {});
    }
  } catch (err) {}
}

/**
 * Checks managed storage for KillSwitch policy.
 */
async function checkKillSwitchPolicy() {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.managed) {
    try {
      const managed = await chrome.storage.managed.get(['KillSwitch', 'DisableAdBlock']).catch(() => null);
      if (managed) {
        if (managed.DisableAdBlock === true) {
          isAdBlockPolicyDisabled = true;
          if (chrome.declarativeNetRequest && chrome.declarativeNetRequest.updateEnabledRulesets) {
            await chrome.declarativeNetRequest.updateEnabledRulesets({
              disableRulesetIds: ['adblock_rules']
            }).catch(() => {});
          }
        }
        if (managed.KillSwitch === true) {
          await activateKillSwitch('Managed Policy KillSwitch active on startup');
          return true;
        } else if (isKillSwitchActive && managed.KillSwitch === false) {
          await deactivateKillSwitch();
          return false;
        }
      }
    } catch (err) {
      console.error('[Aura] Failed to query managed storage for policies:', err);
    }
  }
  return false;
}

let isUpdatingCodecBlockers = false;
let pendingCodecUpdate = false;

async function updateCodecBlockers() {
  if (isUpdatingCodecBlockers) {
    pendingCodecUpdate = true;
    return;
  }
  isUpdatingCodecBlockers = true;
  pendingCodecUpdate = false;

  const settings = await chrome.storage.sync.get(['blockAV1', 'blockVP9', 'block60fps']);
  
  const scriptsToRegister = [];
  
  if (settings.blockAV1) {
    scriptsToRegister.push({
      id: 'block-av1',
      matches: ['*://*.youtube.com/*'],
      js: ['content/block-av1.js'],
      runAt: 'document_start',
      world: 'MAIN'
    });
  }
  
  if (settings.blockVP9) {
    scriptsToRegister.push({
      id: 'block-vp9',
      matches: ['*://*.youtube.com/*'],
      js: ['content/block-vp9.js'],
      runAt: 'document_start',
      world: 'MAIN'
    });
  }
  
  if (settings.block60fps) {
    scriptsToRegister.push({
      id: 'block-60fps',
      matches: ['*://*.youtube.com/*'],
      js: ['content/block-60fps.js'],
      runAt: 'document_start',
      world: 'MAIN'
    });
  }

  try {
    const registered = await chrome.scripting.getRegisteredContentScripts().catch(() => []);
    const targetIds = ['block-av1', 'block-vp9', 'block-60fps'];
    const registeredIds = registered.map(s => s.id).filter(id => targetIds.includes(id));
    if (registeredIds.length > 0) {
      await chrome.scripting.unregisterContentScripts({ ids: registeredIds }).catch(() => {});
    }
    if (scriptsToRegister.length > 0) {
      await chrome.scripting.registerContentScripts(scriptsToRegister);
    }
  } catch (err) {
    console.error('[Aura] Failed to register codec blockers:', err);
  } finally {
    isUpdatingCodecBlockers = false;
    if (pendingCodecUpdate) {
      updateCodecBlockers();
    }
  }
}

// --- Throttled Adblock Count Persistence (CG-FIND-04) ---
let pendingAdBlockIncrement = 0;
let lastAdBlockWriteTime = 0;
let adBlockThrottleTimer = null;
const ADBLOCK_WRITE_INTERVAL_MS = 500; // Cap writes to max 120/min

async function flushAdBlockCount() {
  if (adBlockThrottleTimer) {
    clearTimeout(adBlockThrottleTimer);
    adBlockThrottleTimer = null;
  }
  if (pendingAdBlockIncrement === 0) return;
  const toAdd = pendingAdBlockIncrement;
  pendingAdBlockIncrement = 0;
  lastAdBlockWriteTime = Date.now();

  try {
    if (chrome.storage && chrome.storage.local) {
      let { adblockCount } = await chrome.storage.local.get('adblockCount');
      if (typeof adblockCount !== 'number') {
        const syncData = await chrome.storage.sync?.get('adblockCount').catch(() => ({}));
        adblockCount = typeof syncData?.adblockCount === 'number' ? syncData.adblockCount : 0;
      }
      await chrome.storage.local.set({ adblockCount: adblockCount + toAdd });
    }
  } catch (err) {
    console.error('[Aura] Failed to update adblock count in storage.local:', err);
  }
}

function recordAdBlocked(count = 1) {
  pendingAdBlockIncrement += count;
  const now = Date.now();
  const timeSinceLastWrite = now - lastAdBlockWriteTime;

  if (timeSinceLastWrite >= ADBLOCK_WRITE_INTERVAL_MS && !adBlockThrottleTimer) {
    // Leading-edge: execute immediately if quiet period elapsed
    flushAdBlockCount();
  } else if (!adBlockThrottleTimer) {
    // Trailing-edge: schedule after remaining throttle delay
    const delay = Math.max(0, ADBLOCK_WRITE_INTERVAL_MS - timeSinceLastWrite);
    adBlockThrottleTimer = setTimeout(() => {
      adBlockThrottleTimer = null;
      flushAdBlockCount();
    }, delay);
    if (adBlockThrottleTimer && typeof adBlockThrottleTimer.unref === 'function') {
      adBlockThrottleTimer.unref();
    }
  }
}

// --- Throttled SponsorBlock Count Persistence ---
let pendingSponsorIncrement = 0;
let lastSponsorWriteTime = 0;
let sponsorThrottleTimer = null;
const SPONSOR_WRITE_INTERVAL_MS = 500;

async function flushSponsorBlockCount() {
  if (sponsorThrottleTimer) {
    clearTimeout(sponsorThrottleTimer);
    sponsorThrottleTimer = null;
  }
  if (pendingSponsorIncrement === 0) return;
  const toAdd = pendingSponsorIncrement;
  pendingSponsorIncrement = 0;
  lastSponsorWriteTime = Date.now();

  try {
    if (chrome.storage && chrome.storage.local) {
      let { sponsorBlockCount } = await chrome.storage.local.get('sponsorBlockCount');
      if (typeof sponsorBlockCount !== 'number') {
        const syncData = await chrome.storage.sync?.get('sponsorBlockCount').catch(() => ({}));
        sponsorBlockCount = typeof syncData?.sponsorBlockCount === 'number' ? syncData.sponsorBlockCount : 0;
      }
      await chrome.storage.local.set({ sponsorBlockCount: sponsorBlockCount + toAdd });
    }
  } catch (err) {
    console.error('[Aura] Failed to update sponsor block count in storage.local:', err);
  }
}

function recordSponsorBlocked(count = 1) {
  pendingSponsorIncrement += count;
  const now = Date.now();
  const timeSinceLastWrite = now - lastSponsorWriteTime;

  if (timeSinceLastWrite >= SPONSOR_WRITE_INTERVAL_MS && !sponsorThrottleTimer) {
    flushSponsorBlockCount();
  } else if (!sponsorThrottleTimer) {
    const delay = Math.max(0, SPONSOR_WRITE_INTERVAL_MS - timeSinceLastWrite);
    sponsorThrottleTimer = setTimeout(() => {
      sponsorThrottleTimer = null;
      flushSponsorBlockCount();
    }, delay);
    if (sponsorThrottleTimer && typeof sponsorThrottleTimer.unref === 'function') {
      sponsorThrottleTimer.unref();
    }
  }
}

// --- LRU Annotations Cache (CG-FIND-03) ---
const MAX_ANNOTATION_CACHE_ENTRIES = 5;

async function getCachedAnnotation(cacheKey) {
  try {
    if (!chrome.storage || !chrome.storage.local) return null;
    const data = await chrome.storage.local.get([cacheKey, 'ar_cache_keys']);
    if (data && data[cacheKey]) {
      // Refresh LRU order: move cacheKey to most-recent position
      let keys = Array.isArray(data.ar_cache_keys) ? data.ar_cache_keys.filter(k => k !== cacheKey) : [];
      keys.push(cacheKey);
      await chrome.storage.local.set({ ar_cache_keys: keys }).catch(() => {});
      return data[cacheKey];
    }
  } catch (_) {}
  return null;
}

async function setCachedAnnotation(cacheKey, xml) {
  try {
    if (!chrome.storage || !chrome.storage.local) return;
    const data = await chrome.storage.local.get('ar_cache_keys');
    let keys = Array.isArray(data?.ar_cache_keys) ? data.ar_cache_keys.filter(k => k !== cacheKey) : null;
    if (!keys) {
      const allLocal = await chrome.storage.local.get(null).catch(() => ({}));
      keys = Object.keys(allLocal).filter(k => k.startsWith('ar_') && k !== 'ar_cache_keys' && k !== cacheKey);
    }
    keys.push(cacheKey);

    // Evict oldest entries exceeding maximum cache size (LRU)
    const keysToRemove = [];
    while (keys.length > MAX_ANNOTATION_CACHE_ENTRIES) {
      const oldestKey = keys.shift();
      if (oldestKey && oldestKey !== cacheKey) {
        keysToRemove.push(oldestKey);
      }
    }

    if (keysToRemove.length > 0) {
      await chrome.storage.local.remove(keysToRemove).catch(() => {});
    }

    await chrome.storage.local.set({
      [cacheKey]: xml,
      ar_cache_keys: keys
    });
  } catch (err) {
    console.error('[Aura] Failed to cache annotation in storage.local:', err);
  }
}

// Increment counter when content scripts report blocked/skipped ads.
// (DNR network block counts require 'declarativeNetRequestFeedback' which is dev-only,
// so we rely on content scripts for counts).
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Global emergency kill-switch guard
  if (isKillSwitchActive) {
    sendResponse({ success: false, error: 'Extension disabled by emergency kill-switch', killed: true });
    return false;
  }

  if (message.type === 'AD_BLOCKED') {
    recordAdBlocked(message.count || 1);
  }
  if (message.type === 'SPONSOR_BLOCKED') {
    recordSponsorBlocked(message.count || 1);
  }
  if (message.type === 'FETCH_SPONSOR_BLOCK') {
    (async () => {
      const videoId = message.videoId;
      if (!videoId || typeof videoId !== 'string') {
        sendResponse({ success: false, error: 'Invalid video ID' });
        return;
      }
      try {
        if (chrome.storage && chrome.storage.managed) {
          const managed = await chrome.storage.managed.get(['DisableThirdPartyAPIs', 'KillSwitch']).catch(() => null);
          if (managed && (managed.DisableThirdPartyAPIs || managed.KillSwitch)) {
            sendResponse({ success: false, error: 'Blocked by enterprise policy' });
            return;
          }
        }
        const categories = Array.isArray(message.categories) && message.categories.length > 0
          ? message.categories
          : ['sponsor', 'selfpromo', 'interaction'];
        const url = `https://sponsor.ajay.app/api/skipSegments?videoID=${encodeURIComponent(videoId)}&categories=${encodeURIComponent(JSON.stringify(categories))}`;
        const fetchFn = typeof fetchWithBackoff === 'function' ? fetchWithBackoff : fetch;
        const resp = await fetchFn(url, { cache: 'no-cache' });
        if (resp.status === 404) {
          sendResponse({ success: true, segments: [] });
          return;
        }
        if (!resp.ok) {
          sendResponse({ success: false, status: resp.status });
          return;
        }
        const data = await resp.json();
        sendResponse({ success: true, segments: Array.isArray(data) ? data : [] });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }
  if (message.type === 'FETCH_DISLIKES') {
    (async () => {
      const videoId = message.videoId;
      if (!videoId || typeof videoId !== 'string') {
        sendResponse({ success: false, error: 'Invalid video ID' });
        return;
      }
      try {
        if (chrome.storage && chrome.storage.managed) {
          const managed = await chrome.storage.managed.get(['DisableThirdPartyAPIs', 'KillSwitch']).catch(() => null);
          if (managed && (managed.DisableThirdPartyAPIs || managed.KillSwitch)) {
            sendResponse({ success: false, error: 'Blocked by enterprise policy' });
            return;
          }
        }
        const fetchFn = typeof fetchWithBackoff === 'function' ? fetchWithBackoff : fetch;
        const resp = await fetchFn(`https://returnyoutubedislikeapi.com/votes?videoId=${encodeURIComponent(videoId)}`, {
          cache: 'no-cache'
        });
        if (!resp.ok) {
          sendResponse({ success: false, status: resp.status });
          return;
        }
        const data = await resp.json();
        sendResponse({ success: true, data });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }
  if (message.type === 'FETCH_ANNOTATIONS') {
    (async () => {
      const videoId = message.videoId;
      if (!videoId || typeof videoId !== 'string' || videoId.length !== 11) {
        sendResponse({ success: false, error: 'Invalid video ID' });
        return;
      }
      try {
        if (chrome.storage && chrome.storage.managed) {
          const managed = await chrome.storage.managed.get(['DisableThirdPartyAPIs', 'KillSwitch']).catch(() => null);
          if (managed && (managed.DisableThirdPartyAPIs || managed.KillSwitch)) {
            sendResponse({ success: false, error: 'Blocked by enterprise policy' });
            return;
          }
        }
        const cacheKey = `ar_${videoId}`;
        const cachedXml = await getCachedAnnotation(cacheKey);
        if (cachedXml) {
          sendResponse({ success: true, xml: cachedXml, cached: true });
          return;
        }

        let dir = videoId[0];
        if (dir === '-') dir = '-/ar-';
        const url = `https://biggest_bucket.storage.googleapis.com/annotations/${dir}/${videoId.substring(0, 3)}/${videoId}.xml.gz`;

        const fetchFn = typeof fetchWithBackoff === 'function' ? fetchWithBackoff : fetch;
        const resp = await fetchFn(url);
        if (!resp.ok) {
          sendResponse({ success: false, status: resp.status });
          return;
        }

        const xml = await resp.text();
        if (xml && xml.length < 1000000) {
          await setCachedAnnotation(cacheKey, xml);
        }
        sendResponse({ success: true, xml, cached: false });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }
  return false;
});

/**
 * Out-of-band HTTPS Remote Endpoint Polling for Emergency Kill-Switch (CAB Milestone 2 Item 2).
 */
async function checkRemoteKillSwitch() {
  if (isKillSwitchActive) return;
  if (typeof fetch === 'function') {
    try {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timeoutId = controller ? setTimeout(() => controller.abort(), 2000) : null;
      const res = await fetch('https://biggest_bucket.storage.googleapis.com/cineglow-policy.json', {
        signal: controller ? controller.signal : undefined,
        cache: 'no-store'
      }).catch(() => null);
      if (timeoutId) clearTimeout(timeoutId);
      if (res && res.ok) {
        const data = await res.json().catch(() => null);
        if (data && (data.killSwitch === true || data.KillSwitch === true)) {
          await activateKillSwitch('Remote HTTPS KillSwitch active');
        }
      }
    } catch (_) {}
  }
}

// 5-Minute Periodic Backup Sync for Emergency Kill-Switch
if (typeof chrome !== 'undefined' && chrome.alarms) {
  try {
    chrome.alarms.create('AURA_KILL_SWITCH_SYNC', { periodInMinutes: 5 });
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm && alarm.name === 'AURA_KILL_SWITCH_SYNC') {
        checkKillSwitchPolicy();
        checkRemoteKillSwitch();
      }
    });
  } catch (err) {
    console.warn('[Aura] chrome.alarms setup failed, relying on storage.onChanged:', err);
  }
}

// Initial sync on install/startup
if (typeof chrome !== 'undefined' && chrome.runtime?.onInstalled?.addListener) {
  chrome.runtime.onInstalled.addListener(async () => {
    const killed = await checkKillSwitchPolicy();
    if (killed) return;

    const { adblockEnabled = true } = await chrome.storage.sync.get('adblockEnabled');
    if (!adblockEnabled && chrome.declarativeNetRequest && chrome.declarativeNetRequest.updateEnabledRulesets) {
      await chrome.declarativeNetRequest.updateEnabledRulesets({
        disableRulesetIds: ['adblock_rules']
      });
    }
    updateCodecBlockers();
  });
}

// Cold startup sync
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onStartup) {
  chrome.runtime.onStartup.addListener(async () => {
    await checkKillSwitchPolicy();
  });
}

// Immediate top-level check
checkKillSwitchPolicy();

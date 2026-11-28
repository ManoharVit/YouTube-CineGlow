// Background service worker for CineGlow Pro
// Author: Giri Manohar Vemula (https://www.linkedin.com/in/manoharv511)

if (typeof importScripts === 'function') {
  try {
    importScripts('/shared/network-backoff.js');
  } catch (err) {
    console.error('[Aura] Failed to import network-backoff:', err);
  }
}

const YOUTUBE_MATCHES = ['*://*.youtube.com/*'];
const YOUTUBE_EXCLUDES = [
  '*://studio.youtube.com/*',
  '*://accounts.youtube.com/*',
  '*://consent.youtube.com/*'
];
const GCS_BUCKET_BASE = 'https://storage.googleapis.com/biggest_bucket';

// In-memory cache backed by chrome.storage.session across MV3 SW restarts
let policyState = {
  killSwitchActive: false,
  adBlockPolicyDisabled: false,
  thirdPartyAPIsDisabled: false
};
let hydrationPromise = null;

async function getPolicyState() {
  if (!hydrationPromise) {
    hydrationPromise = (async () => {
      try {
        if (chrome.storage?.session) {
          const cached = await chrome.storage.session.get('auraPolicyState');
          if (cached?.auraPolicyState) {
            policyState = { ...policyState, ...cached.auraPolicyState };
            return policyState;
          }
        }
      } catch (_) {}
      await syncPolicies();
      return policyState;
    })().finally(() => {
      hydrationPromise = null;
    });
  }
  return hydrationPromise;
}

function savePolicyState(nextState) {
  policyState = { ...policyState, ...nextState };
  try {
    if (chrome.storage?.session) {
      chrome.storage.session.set({ auraPolicyState: policyState })?.catch?.(() => {});
    }
  } catch (_) {}
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && 'adblockEnabled' in changes) {
    const userPref = changes.adblockEnabled.newValue ?? true;
    const isEnabled = userPref && !policyState.adBlockPolicyDisabled && !policyState.killSwitchActive;
    try {
      chrome.declarativeNetRequest?.updateEnabledRulesets({
        enableRulesetIds: isEnabled ? ['adblock_rules'] : [],
        disableRulesetIds: isEnabled ? [] : ['adblock_rules']
      })?.catch?.((err) => {
        console.error('[Aura] Failed to update rulesets:', err);
      });
    } catch (err) {
      console.error('[Aura] Failed to update rulesets:', err);
    }
  }

  if (area === 'sync' && ('blockAV1' in changes || 'blockVP9' in changes || 'block60fps' in changes)) {
    updateCodecBlockers();
  }

  if (area === 'managed') {
    if ('DisableThirdPartyAPIs' in changes) {
      savePolicyState({ thirdPartyAPIsDisabled: changes.DisableThirdPartyAPIs.newValue === true });
    }
    if ('KillSwitch' in changes) {
      if (changes.KillSwitch.newValue === true) {
        activateKillSwitch('Managed Policy KillSwitch activated via storage.onChanged');
      } else if (policyState.killSwitchActive) {
        deactivateKillSwitch();
      }
    }
    if ('DisableAdBlock' in changes) {
      const disabled = changes.DisableAdBlock.newValue === true;
      savePolicyState({ adBlockPolicyDisabled: disabled });
      try {
        if (disabled || policyState.killSwitchActive) {
          chrome.declarativeNetRequest?.updateEnabledRulesets({
            disableRulesetIds: ['adblock_rules']
          })?.catch?.(() => {});
        } else {
          (async () => {
            try {
              const { adblockEnabled = true } = await chrome.storage.sync.get('adblockEnabled');
              if (adblockEnabled) {
                await chrome.declarativeNetRequest?.updateEnabledRulesets({
                  enableRulesetIds: ['adblock_rules']
                });
              }
            } catch (err) {
              console.error('[Aura] Failed to re-enable adblock ruleset:', err);
            }
          })();
        }
      } catch (err) {
        console.error('[Aura] Failed to apply DisableAdBlock managed policy:', err);
      }
    }
  }
});

function broadcastKillSwitchToYouTubeTabs(reason) {
  if (!chrome.tabs?.query) return;
  const sentTabs = new Set();
  const sendToTabs = (tabs) => {
    if (!Array.isArray(tabs)) return;
    for (const tab of tabs) {
      if (typeof tab?.id !== 'number' || sentTabs.has(tab.id)) continue;
      sentTabs.add(tab.id);
      try {
        const p = chrome.tabs.sendMessage(tab.id, {
          type: 'AURA_EMERGENCY_KILL_SWITCH',
          reason,
          timestamp: Date.now()
        });
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch (_) {}
    }
  };

  try {
    const res = chrome.tabs.query({ url: YOUTUBE_MATCHES }, sendToTabs);
    if (res && typeof res.then === 'function') {
      res.then(sendToTabs).catch(() => {});
    }
  } catch (err) {
    console.error('[Aura Emergency] Failed to broadcast kill switch:', err);
  }
}

async function activateKillSwitch(reason = 'Managed Policy KillSwitch activated') {
  if (policyState.killSwitchActive) return;
  savePolicyState({ killSwitchActive: true });
  console.warn(`[Aura Emergency] Kill-switch activated: ${reason}`);

  try {
    await chrome.storage?.local?.set({ auraKillSwitchActive: true });
  } catch (err) {
    console.error('[Aura Emergency] Failed to persist kill switch flag:', err);
  }

  broadcastKillSwitchToYouTubeTabs(reason);

  try {
    const registered = await chrome.scripting?.getRegisteredContentScripts().catch(() => []);
    if (registered?.length > 0) {
      await chrome.scripting.unregisterContentScripts({
        ids: registered.map((s) => s.id)
      }).catch(() => {});
    }
  } catch (err) {
    console.error('[Aura Emergency] Failed to unregister dynamic content scripts:', err);
  }

  try {
    await chrome.declarativeNetRequest?.updateEnabledRulesets({
      disableRulesetIds: ['adblock_rules']
    }).catch(() => {});
  } catch (err) {
    console.error('[Aura Emergency] Failed to disable DNR rulesets:', err);
  }
}

// Chrome tabs.onUpdated only takes 1 argument (callback); filter URL inside callback
if (chrome.tabs?.onUpdated?.addListener) {
  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'loading' && changeInfo.status !== 'complete') return;
    if (!tab?.url || !/^https:\/\/([^/]+\.)?youtube\.com\//i.test(tab.url)) return;

    const state = await getPolicyState();
    if (!state.killSwitchActive) return;

    chrome.tabs.sendMessage(tabId, {
      type: 'AURA_EMERGENCY_KILL_SWITCH',
      reason: 'Emergency KillSwitch active on updated tab',
      timestamp: Date.now()
    }).catch(() => {});
  });
}

async function deactivateKillSwitch() {
  if (!policyState.killSwitchActive) return;
  savePolicyState({ killSwitchActive: false });
  console.info('[Aura Emergency] Kill-switch deactivated by managed policy');

  try {
    await chrome.storage?.local?.set({ auraKillSwitchActive: false });
  } catch (_) {}

  updateCodecBlockers();
  try {
    const { adblockEnabled = true } = await chrome.storage.sync.get('adblockEnabled');
    if (adblockEnabled && !policyState.adBlockPolicyDisabled) {
      await chrome.declarativeNetRequest?.updateEnabledRulesets({
        enableRulesetIds: ['adblock_rules']
      }).catch(() => {});
    }
  } catch (_) {}
}

async function syncPolicies() {
  let localKilled = false;
  try {
    const local = await chrome.storage?.local?.get('auraKillSwitchActive').catch(() => null);
    localKilled = local?.auraKillSwitchActive === true;
  } catch (_) {}

  if (chrome.storage?.managed) {
    try {
      const managed = await chrome.storage.managed
        .get(['KillSwitch', 'DisableAdBlock', 'DisableThirdPartyAPIs'])
        .catch(() => null);

      if (managed) {
        const adBlockDisabled = managed.DisableAdBlock === true;
        const apiDisabled = managed.DisableThirdPartyAPIs === true;
        savePolicyState({
          adBlockPolicyDisabled: adBlockDisabled,
          thirdPartyAPIsDisabled: apiDisabled
        });

        if (adBlockDisabled) {
          await chrome.declarativeNetRequest?.updateEnabledRulesets({
            disableRulesetIds: ['adblock_rules']
          }).catch(() => {});
        }
        if (managed.KillSwitch === true) {
          await activateKillSwitch('Managed Policy KillSwitch active');
          return true;
        }
        if (managed.KillSwitch === false && (policyState.killSwitchActive || localKilled)) {
          await deactivateKillSwitch();
          return false;
        }
      }
    } catch (err) {
      console.error('[Aura] Failed to query managed storage:', err);
    }
  }

  if (localKilled) {
    await activateKillSwitch('Persisted KillSwitch state active');
    return true;
  }
  savePolicyState({ killSwitchActive: false });
  return false;
}

let isUpdatingCodecBlockers = false;
let pendingCodecUpdate = false;

async function updateCodecBlockers() {
  const state = await getPolicyState();
  if (state.killSwitchActive) return;

  if (isUpdatingCodecBlockers) {
    pendingCodecUpdate = true;
    return;
  }
  isUpdatingCodecBlockers = true;
  pendingCodecUpdate = false;

  try {
    const settings = await chrome.storage.sync.get(['blockAV1', 'blockVP9', 'block60fps']);
    const scriptsToRegister = [];

    if (settings.blockAV1) {
      scriptsToRegister.push({
        id: 'block-av1',
        matches: YOUTUBE_MATCHES,
        excludeMatches: YOUTUBE_EXCLUDES,
        js: ['content/block-av1.js'],
        runAt: 'document_start',
        world: 'MAIN'
      });
    }
    if (settings.blockVP9) {
      scriptsToRegister.push({
        id: 'block-vp9',
        matches: YOUTUBE_MATCHES,
        excludeMatches: YOUTUBE_EXCLUDES,
        js: ['content/block-vp9.js'],
        runAt: 'document_start',
        world: 'MAIN'
      });
    }
    if (settings.block60fps) {
      scriptsToRegister.push({
        id: 'block-60fps',
        matches: YOUTUBE_MATCHES,
        excludeMatches: YOUTUBE_EXCLUDES,
        js: ['content/block-60fps.js'],
        runAt: 'document_start',
        world: 'MAIN'
      });
    }

    const registered = await chrome.scripting.getRegisteredContentScripts().catch(() => []);
    const targetIds = ['block-av1', 'block-vp9', 'block-60fps'];
    const registeredIds = registered.map((s) => s.id).filter((id) => targetIds.includes(id));
    if (registeredIds.length > 0) {
      await chrome.scripting.unregisterContentScripts({ ids: registeredIds }).catch(() => {});
    }
    if (scriptsToRegister.length > 0 && !policyState.killSwitchActive) {
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

// --- LRU Annotations Cache ---
const MAX_ANNOTATION_CACHE_ENTRIES = 5;
let annotationCacheQueue = Promise.resolve();

function enqueueAnnotationCacheOp(fn) {
  const next = annotationCacheQueue.then(fn, fn);
  annotationCacheQueue = next.catch(() => {});
  return next;
}

function getCachedAnnotation(cacheKey) {
  return enqueueAnnotationCacheOp(async () => {
    try {
      if (!chrome.storage?.local) return null;
      const data = await chrome.storage.local.get([cacheKey, 'ar_cache_keys']);
      if (data?.[cacheKey]) {
        const keys = Array.isArray(data.ar_cache_keys)
          ? data.ar_cache_keys.filter((k) => k !== cacheKey)
          : [];
        keys.push(cacheKey);
        await chrome.storage.local.set({ ar_cache_keys: keys }).catch(() => {});
        return data[cacheKey];
      }
    } catch (_) {}
    return null;
  });
}

function setCachedAnnotation(cacheKey, xml) {
  return enqueueAnnotationCacheOp(async () => {
    try {
      if (!chrome.storage?.local) return;
      const data = await chrome.storage.local.get('ar_cache_keys');
      let keys = Array.isArray(data?.ar_cache_keys)
        ? data.ar_cache_keys.filter((k) => k !== cacheKey)
        : null;

      if (!keys) {
        const allLocal = await chrome.storage.local.get(null).catch(() => ({}));
        keys = Object.keys(allLocal).filter(
          (k) => k.startsWith('ar_') && k !== 'ar_cache_keys' && k !== cacheKey
        );
      }
      keys.push(cacheKey);

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
      await chrome.storage.local.set({ [cacheKey]: xml, ar_cache_keys: keys });
    } catch (err) {
      console.error('[Aura] Failed to cache annotation:', err);
    }
  });
}

async function readPossiblyGzippedText(resp) {
  if (typeof resp.arrayBuffer !== 'function') {
    return typeof resp.text === 'function' ? await resp.text() : '';
  }
  const bytes = new Uint8Array(await resp.arrayBuffer());
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b && typeof DecompressionStream === 'function') {
    const decompressedStream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return await new Response(decompressedStream).text();
  }
  return new TextDecoder('utf-8').decode(bytes);
}

async function authorizeApiMessage(sendResponse) {
  const state = await getPolicyState();
  if (state.killSwitchActive) {
    sendResponse({
      success: false,
      error: 'Extension disabled by emergency kill-switch',
      killed: true
    });
    return null;
  }
  if (state.thirdPartyAPIsDisabled) {
    sendResponse({
      success: false,
      error: 'Blocked by enterprise policy'
    });
    return null;
  }
  return state;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return false;

  // Immediate synchronous guard for emergency kill-switch
  if (policyState.killSwitchActive) {
    sendResponse({
      success: false,
      error: 'Extension disabled by emergency kill-switch',
      killed: true
    });
    return false;
  }

  if (message.type === 'FETCH_SPONSOR_BLOCK') {
    (async () => {
      try {
        if (!(await authorizeApiMessage(sendResponse))) return;
        const videoId = message.videoId;
        if (!videoId || typeof videoId !== 'string') {
          sendResponse({ success: false, error: 'Invalid video ID' });
          return;
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
        sendResponse({ success: false, error: err?.message || 'Unexpected background error' });
      }
    })();
    return true;
  }

  if (message.type === 'FETCH_DISLIKES') {
    (async () => {
      try {
        if (!(await authorizeApiMessage(sendResponse))) return;
        const videoId = message.videoId;
        if (!videoId || typeof videoId !== 'string') {
          sendResponse({ success: false, error: 'Invalid video ID' });
          return;
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
        sendResponse({ success: false, error: err?.message || 'Unexpected background error' });
      }
    })();
    return true;
  }

  if (message.type === 'FETCH_ANNOTATIONS') {
    (async () => {
      try {
        if (!(await authorizeApiMessage(sendResponse))) return;
        const videoId = message.videoId;
        if (!videoId || typeof videoId !== 'string' || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
          sendResponse({ success: false, error: 'Invalid video ID' });
          return;
        }
        const cacheKey = `ar_${videoId}`;
        const cachedXml = await getCachedAnnotation(cacheKey);
        if (cachedXml) {
          sendResponse({ success: true, xml: cachedXml, cached: true });
          return;
        }

        const dir = videoId[0] === '-' ? '-/ar-' : videoId[0];
        const url = `${GCS_BUCKET_BASE}/annotations/${dir}/${videoId.substring(0, 3)}/${videoId}.xml.gz`;

        const fetchFn = typeof fetchWithBackoff === 'function' ? fetchWithBackoff : fetch;
        const resp = await fetchFn(url);
        if (!resp.ok) {
          sendResponse({ success: false, status: resp.status });
          return;
        }

        const xml = await readPossiblyGzippedText(resp);
        if (xml && xml.length < 1_000_000) {
          await setCachedAnnotation(cacheKey, xml);
        }
        sendResponse({ success: true, xml, cached: false });
      } catch (err) {
        sendResponse({ success: false, error: err?.message || 'Unexpected background error' });
      }
    })();
    return true;
  }

  return false;
});

async function checkRemoteKillSwitch() {
  const state = await getPolicyState();
  if (state.killSwitchActive) return;

  try {
    const res = await fetch(`${GCS_BUCKET_BASE}/cineglow-policy.json`, {
      signal: AbortSignal.timeout(2000),
      cache: 'no-store'
    }).catch(() => null);

    if (res?.ok) {
      const data = await res.json().catch(() => null);
      if (data && (data.killSwitch === true || data.KillSwitch === true)) {
        await activateKillSwitch('Remote HTTPS KillSwitch active');
      }
    }
  } catch (_) {}
}

if (chrome.alarms) {
  chrome.alarms.create('AURA_KILL_SWITCH_SYNC', { periodInMinutes: 5 });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm?.name === 'AURA_KILL_SWITCH_SYNC') {
      syncPolicies();
      checkRemoteKillSwitch();
    }
  });
}

chrome.runtime.onInstalled?.addListener(async () => {
  const killed = await syncPolicies();
  if (killed) return;

  const { adblockEnabled = true } = await chrome.storage.sync.get('adblockEnabled');
  if (!adblockEnabled) {
    await chrome.declarativeNetRequest?.updateEnabledRulesets({
      disableRulesetIds: ['adblock_rules']
    }).catch(() => {});
  }
  updateCodecBlockers();
});

chrome.runtime.onStartup?.addListener(async () => {
  await syncPolicies();
});

getPolicyState();

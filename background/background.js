// Background service worker for Aura

// Keep DNR rules in sync with settings
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === 'sync' && 'adblockEnabled' in changes) {
    const isEnabled = changes.adblockEnabled.newValue ?? true;
    try {
      await chrome.declarativeNetRequest.updateEnabledRulesets({
        enableRulesetIds: isEnabled ? ['adblock_rules'] : [],
        disableRulesetIds: isEnabled ? [] : ['adblock_rules']
      });
    } catch (err) {
      console.error('[Aura] Failed to update rulesets:', err);
    }
  }
  if (area === 'sync' && ('blockAV1' in changes || 'blockVP9' in changes || 'block60fps' in changes)) {
    updateCodecBlockers();
  }
});

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


const DOWNLOAD_DNR_RULE_ID = 8888;

async function setupDownloadHeadersRule() {
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [DOWNLOAD_DNR_RULE_ID],
      addRules: [{
        id: DOWNLOAD_DNR_RULE_ID,
        priority: 2,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [
            { header: 'Referer', operation: 'set', value: 'https://www.youtube.com/' },
            { header: 'Origin', operation: 'set', value: 'https://www.youtube.com' }
          ]
        },
        condition: {
          urlFilter: '||googlevideo.com'
        }
      }]
    });
  } catch (err) {
    console.debug('[Aura] Could not set DNR download headers rule:', err);
  }
}
setupDownloadHeadersRule();

// Increment counter when content scripts report blocked/skipped ads.
// (DNR network block counts require 'declarativeNetRequestFeedback' which is dev-only,
// so we rely on content scripts for counts).
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'AD_BLOCKED') {
    (async () => {
      try {
        const { adblockCount = 0 } = await chrome.storage.sync.get('adblockCount');
        await chrome.storage.sync.set({ adblockCount: adblockCount + (message.count || 1) });
      } catch (err) {
        console.error('[Aura] Failed to update adblock count:', err);
      }
    })();
  }
  if (message.type === 'DOWNLOAD_VIDEO') {
    (async () => {
      try {
        await setupDownloadHeadersRule();
        await chrome.downloads.download({
          url: message.url,
          filename: message.filename
        });
      } catch (err) {
        console.error('[Aura] Download failed:', err);
      }
    })();
  }
  if (message.type === 'FETCH_DISLIKES') {
    (async () => {
      const videoId = message.videoId;
      if (!videoId || typeof videoId !== 'string') {
        sendResponse({ success: false, error: 'Invalid video ID' });
        return;
      }
      try {
        const resp = await fetch(`https://returnyoutubedislikeapi.com/votes?videoId=${encodeURIComponent(videoId)}`, {
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
        const cacheKey = `ar_${videoId}`;
        const cached = await chrome.storage.local.get(cacheKey);
        if (cached && cached[cacheKey]) {
          sendResponse({ success: true, xml: cached[cacheKey], cached: true });
          return;
        }

        let dir = videoId[0];
        if (dir === '-') dir = '-/ar-';
        const url = `https://storage.googleapis.com/biggest_bucket/annotations/${dir}/${videoId.substring(0, 3)}/${videoId}.xml.gz`;

        const resp = await fetch(url);
        if (!resp.ok) {
          sendResponse({ success: false, status: resp.status });
          return;
        }

        const xml = await resp.text();
        if (xml && xml.length < 1000000) {
          await chrome.storage.local.set({ [cacheKey]: xml }).catch(() => {});
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

// Initial sync on install/startup
chrome.runtime.onInstalled.addListener(async () => {
  const { adblockEnabled = true } = await chrome.storage.sync.get('adblockEnabled');
  if (!adblockEnabled) {
    await chrome.declarativeNetRequest.updateEnabledRulesets({
      disableRulesetIds: ['adblock_rules']
    });
  }
  updateCodecBlockers();
  setupDownloadHeadersRule();
});

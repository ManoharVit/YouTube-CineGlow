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
    await chrome.scripting.unregisterContentScripts({ ids: ['block-av1', 'block-vp9', 'block-60fps'] }).catch((err) => { console.debug('[Aura] Unregister note:', err); });
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
  // No async response needed, don't return true
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
});

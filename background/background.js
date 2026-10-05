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
});

// Increment counter when content scripts report blocked/skipped ads.
// (DNR network block counts require 'declarativeNetRequestFeedback' which is dev-only,
// so we rely on content scripts for counts).
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'AD_BLOCKED') {
    (async () => {
      const { adblockCount = 0 } = await chrome.storage.sync.get('adblockCount');
      await chrome.storage.sync.set({ adblockCount: adblockCount + (message.count || 1) });
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
});

// Codec Blocker Settings Syncer (Isolated World)
// Syncs chrome.storage settings to localStorage so the MAIN world script can read them synchronously
(async () => {
  'use strict';

  async function syncSettings() {
    try {
      const settings = await chrome.storage.sync.get(['blockAV1', 'blockVP9', 'block60fps']);
      window.localStorage.setItem('__aura_settings', JSON.stringify(settings));
    } catch (err) {
      console.warn('[Aura] Failed to sync codec settings to localStorage:', err);
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && (changes.blockAV1 || changes.blockVP9 || changes.block60fps)) {
      syncSettings();
    }
  });

  syncSettings();
})();

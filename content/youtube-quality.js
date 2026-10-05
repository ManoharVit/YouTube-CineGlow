// Auto-HD Quality Controller for YouTube
(() => {
  'use strict';

  let settings = { qualityEnabled: false, preferredQuality: 'hd1080' };

  async function loadSettings() {
    try {
      const stored = await chrome.storage.sync.get(['qualityEnabled', 'preferredQuality']);
      if (stored.qualityEnabled !== undefined) {
        settings.qualityEnabled = stored.qualityEnabled;
      }
      if (stored.preferredQuality !== undefined) {
        settings.preferredQuality = stored.preferredQuality;
      }
    } catch (err) {
      console.warn('[Aura Quality] Could not load settings:', err);
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync') {
      if (changes.qualityEnabled) settings.qualityEnabled = changes.qualityEnabled.newValue;
      if (changes.preferredQuality) settings.preferredQuality = changes.preferredQuality.newValue;
      // If either changed and is enabled, apply immediately
      if (settings.qualityEnabled) {
        applyQuality();
      }
    }
  });

  // The main world script (content/main-world.js) is injected by manifest.json
  // and listens for the 'AURA_SET_QUALITY' message.

  function applyQuality() {
    if (!settings.qualityEnabled || !settings.preferredQuality) return;
    
    // 1. Set YouTube's internal localStorage preference. 
    // This is the most reliable way to force quality, as YouTube reads this on load.
    try {
      const now = Date.now();
      const ytQualityObj = {
        data: JSON.stringify({
          quality: settings.preferredQuality,
          previousQuality: "auto"
        }),
        expiration: now + (30 * 24 * 60 * 60 * 1000), // 30 days
        creation: now
      };
      window.localStorage.setItem('yt-player-quality', JSON.stringify(ytQualityObj));
    } catch (err) {
      console.warn('[Aura Quality] Could not set localStorage:', err);
    }

    // 2. The main world script is already running, just send message to force it immediately via API
    window.postMessage({
      type: 'AURA_SET_QUALITY',
      quality: settings.preferredQuality
    }, '*');
  }

  let lastVideo = null;
  let lastVideoId = null;
  window.CineGlowPlayer.addEventListener('state-change', (e) => {
    const state = e.detail;
    if (state.video !== lastVideo || state.videoId !== lastVideoId) {
      lastVideo = state.video;
      lastVideoId = state.videoId;
      if (state.isWatchPage && state.video) {
        setTimeout(applyQuality, 500);
      }
    }
  });

  // Initial load
  loadSettings().then(() => {
    applyQuality();
  });

})();

// YouTube specific ad blocking/skipping content script
(() => {
  'use strict';

  let settings = { adblockEnabled: true };

  async function loadSettings() {
    try {
      const stored = await chrome.storage.sync.get(['adblockEnabled']);
      if (stored.adblockEnabled !== undefined) {
        settings.adblockEnabled = stored.adblockEnabled;
      }
    } catch (err) {
      console.warn('[Aura Adblock] Could not load settings:', err);
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.adblockEnabled) {
      settings.adblockEnabled = changes.adblockEnabled.newValue;
      checkAdState();
    }
  });

  // Automatically skip or fast-forward video ads on YouTube
  let lastAdSkipTime = 0;
  
  function skipVideoAds() {
    if (!settings.adblockEnabled) return;

    const moviePlayer = document.querySelector('#movie_player');
    const isAdShowing = moviePlayer && moviePlayer.classList.contains('ad-showing');
    
    // 1. Click skip buttons if they exist
    const skipBtn = document.querySelector('.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button, [id^="skip-button:"]');
    if (skipBtn) {
      skipBtn.click();
    }

    // 2. If it's an unskippable ad or the button isn't ready, fast-forward it
    if (isAdShowing) {
      const video = document.querySelector('video.html5-main-video');
      if (video && !isNaN(video.duration) && video.duration > 0) {
        video.muted = true; // silence the ad
        video.playbackRate = 16.0;
        if (video.currentTime < video.duration - 0.5) {
          video.currentTime = video.duration - 0.5;
        }
      }
    }

    // Only count it once per few seconds to avoid spamming the counter
    if ((skipBtn || isAdShowing) && (Date.now() - lastAdSkipTime > 3000)) {
      chrome.runtime.sendMessage({ type: 'AD_BLOCKED', count: 1 });
      lastAdSkipTime = Date.now();
    }
  }

  // Hide static UI banners/ads that CSS might miss, or remove them entirely
  function hideUiAds() {
    if (!settings.adblockEnabled) return;

    const adSelectors = [
      'ytd-promoted-sparkles-web-renderer',
      'ytd-banner-promo-renderer',
      'ytd-video-masthead-ad-v3-renderer',
      'ytd-action-companion-ad-renderer',
      'ytd-player-legacy-desktop-watch-ads-renderer',
      '#masthead-ad',
      '#player-ads',
      '.ytd-in-feed-ad-layout-renderer'
    ];

    let blocked = 0;
    for (const selector of adSelectors) {
      const els = document.querySelectorAll(selector);
      els.forEach(el => {
        if (el.style.display !== 'none') {
          el.style.display = 'none';
          blocked++;
        }
      });
    }

    if (blocked > 0) {
      chrome.runtime.sendMessage({ type: 'AD_BLOCKED', count: blocked });
    }
  }

  let adSkipTimer = 0;

  function checkAdState() {
    const state = window.CineGlowPlayer;
    if (settings.adblockEnabled && state && state.isAdShowing) {
      if (!adSkipTimer) {
        skipVideoAds();
        adSkipTimer = setInterval(skipVideoAds, 500);
      }
    } else {
      if (adSkipTimer) {
        clearInterval(adSkipTimer);
        adSkipTimer = 0;
      }
    }
  }

  window.CineGlowPlayer.addEventListener('state-change', checkAdState);

  document.addEventListener('yt-page-data-updated', () => {
    if (settings.adblockEnabled) hideUiAds();
  });
  
  document.addEventListener('yt-navigate-finish', () => {
    if (settings.adblockEnabled) hideUiAds();
  });

  loadSettings().then(() => {
    checkAdState();
    hideUiAds();
  });

})();

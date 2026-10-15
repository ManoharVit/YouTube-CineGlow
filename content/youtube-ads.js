// YouTube specific ad blocking/skipping content script
(() => {
  'use strict';

  let settings = { adblockEnabled: true };
  let adMutedByUs = false;
  let lastAdSkipTime = 0;
  let adSkipTimer = 0;
  let activeVideo = null;

  function safeSendMessage(msg) {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
        chrome.runtime.sendMessage(msg, () => {
          if (chrome.runtime.lastError) {}
        });
      }
    } catch (_) {
      // Extension context invalidated (e.g. extension was reloaded in chrome://extensions)
    }
  }

  const AD_CSS_ID = 'cineglow-adblock-styles';
  const AD_CSS = `
    #masthead-ad,
    ytd-ad-slot-renderer,
    ytd-promoted-sparkles-web-renderer,
    ytd-banner-promo-renderer,
    ytd-video-masthead-ad-v3-renderer,
    ytd-action-companion-ad-renderer,
    ytd-player-legacy-desktop-watch-ads-renderer,
    #player-ads,
    .ytd-in-feed-ad-layout-renderer,
    .ytp-ad-overlay-container,
    .ytp-ad-message-container,
    ytd-enforcement-message-view-model,
    tp-yt-paper-dialog:has(ytd-enforcement-message-view-model) {
      display: none !important;
    }
  `;

  function applyAdBlockStyles() {
    let el = document.getElementById(AD_CSS_ID);
    if (settings.adblockEnabled) {
      if (!el) {
        el = document.createElement('style');
        el.id = AD_CSS_ID;
        el.textContent = AD_CSS;
        (document.head || document.documentElement).appendChild(el);
      }
    } else if (el) {
      el.remove();
    }
  }

  async function loadSettings() {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
        const stored = await chrome.storage.sync.get(['adblockEnabled']);
        if (stored.adblockEnabled !== undefined) {
          settings.adblockEnabled = stored.adblockEnabled;
        }
      }
    } catch (_) {}
    applyAdBlockStyles();
    checkAdState();
  }

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' && changes.adblockEnabled) {
        settings.adblockEnabled = changes.adblockEnabled.newValue;
        applyAdBlockStyles();
        checkAdState();
      }
    });
  }

  function isAdActive() {
    const moviePlayer = document.querySelector('#movie_player') || document.querySelector('.html5-video-player');
    if (moviePlayer && (moviePlayer.classList.contains('ad-showing') || moviePlayer.classList.contains('ad-interrupting'))) {
      return true;
    }
    const adModule = document.querySelector('.video-ads.ytp-ad-module') || document.querySelector('.video-ads');
    if (adModule && adModule.childElementCount > 0) {
      return true;
    }
    if (document.querySelector('.ytp-ad-player-overlay, .ytp-ad-player-overlay-layout, .ytp-ad-text, .ytp-ad-preview-text, .ytp-ad-skip-button-slot')) {
      return true;
    }
    return false;
  }

  function skipVideoAds() {
    if (!settings.adblockEnabled) return;

    // Dismiss YouTube Anti-Adblock popup if it ever appears
    const enforcementModal = document.querySelector('ytd-enforcement-message-view-model');
    if (enforcementModal) {
      const dialog = enforcementModal.closest('tp-yt-paper-dialog') || enforcementModal;
      dialog.remove();
      const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
      if (video && video.paused) {
        video.play().catch(() => {});
      }
    }

    const isAd = isAdActive();

    // 1. Click skip buttons if available
    const skipBtn = document.querySelector(
      '.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button, .ytp-ad-skip-button-slot button, [id^="skip-button:"], .ytp-ad-overlay-close-button'
    );
    if (skipBtn) {
      skipBtn.click();
    }

    // 2. Fast-forward video ad
    const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
    if (isAd && video) {
      if (!video.muted) {
        video.muted = true;
        adMutedByUs = true;
      }
      video.playbackRate = 16.0;
      if (!isNaN(video.duration) && video.duration > 0 && isFinite(video.duration)) {
        video.currentTime = video.duration;
      }

      if (Date.now() - lastAdSkipTime > 2500) {
        safeSendMessage({ type: 'AD_BLOCKED', count: 1 });
        lastAdSkipTime = Date.now();
      }
    } else if (!isAd && adMutedByUs && video) {
      // Ad finished — restore audio and normal playback speed
      video.muted = false;
      video.playbackRate = 1.0;
      adMutedByUs = false;
    }
  }

  function checkAdState() {
    if (!settings.adblockEnabled) {
      if (adSkipTimer) {
        clearInterval(adSkipTimer);
        adSkipTimer = 0;
      }
      return;
    }

    const isAd = isAdActive();
    if (isAd) {
      skipVideoAds();
      if (!adSkipTimer) {
        adSkipTimer = setInterval(skipVideoAds, 250);
      }
    } else {
      if (adSkipTimer) {
        clearInterval(adSkipTimer);
        adSkipTimer = 0;
      }
      if (adMutedByUs) {
        const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
        if (video) {
          video.muted = false;
          video.playbackRate = 1.0;
        }
        adMutedByUs = false;
      }
    }
  }

  function attachVideoListener(video) {
    if (activeVideo === video) return;
    if (activeVideo) {
      activeVideo.removeEventListener('timeupdate', checkAdState);
    }
    activeVideo = video;
    if (activeVideo) {
      activeVideo.addEventListener('timeupdate', checkAdState);
    }
  }

  if (window.CineGlowPlayer) {
    window.CineGlowPlayer.addEventListener('state-change', (e) => {
      if (e.detail && e.detail.video) {
        attachVideoListener(e.detail.video);
      }
      checkAdState();
    });
    if (window.CineGlowPlayer.video) {
      attachVideoListener(window.CineGlowPlayer.video);
    }
  }

  document.addEventListener('yt-page-data-updated', checkAdState);
  document.addEventListener('yt-navigate-finish', checkAdState);

  loadSettings();
})();

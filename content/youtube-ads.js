// YouTube specific ad blocking/skipping content script
(() => {
  'use strict';

  let settings = { adblockEnabled: true };
  let adMutedByUs = false;
  let mutedVideoElement = null;
  let userWasMuted = false;
  let preAdSpeed = 1.0;
  let lastAdSkipTime = 0;
  let adSkipTimer = 0;
  let activeVideo = null;
  let isKilled = false;
  let isAdBlockPolicyDisabled = false;

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
    ytd-companion-slot-renderer,
    ytd-action-companion-ad-renderer,
    ytd-ad-slot-renderer,
    ytd-promoted-sparkles-web-renderer,
    ytd-promoted-video-renderer,
    ytd-banner-promo-renderer,
    ytd-video-masthead-ad-v3-renderer,
    ytd-player-legacy-desktop-watch-ads-renderer,
    ytd-in-feed-ad-layout-renderer,
    ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"],
    ytd-merch-shelf-renderer,
    #secondary #companion,
    #secondary #player-ads,
    #secondary ytd-ad-slot-renderer,
    #items > ytd-ad-slot-renderer,
    [target-id="engagement-panel-ads"],
    #player-ads,
    .ytp-ad-overlay-container,
    .ytp-ad-message-container,
    .ytp-ad-survey,
    .ytp-ad-preview-container,
    .ytp-ad-player-overlay,
    .ytp-ad-player-overlay-layout,
    .ytp-ad-player-overlay-instream-info,
    .ad-showing .ytp-ad-player-overlay,
    .ad-showing .ytp-ad-player-overlay-layout,
    .ad-showing .ytp-ad-player-overlay-instream-info,
    .ad-showing .ytp-ad-text,
    .ad-showing .ytp-ad-preview-text,
    .ad-showing .ytp-ad-preview-container,
    .ad-showing .ytp-ad-message-container,
    .ad-showing .ytp-ad-survey,
    .ad-showing .ytp-ad-image-overlay,
    .ad-showing ytd-action-companion-ad-renderer,
    .ad-showing ytd-companion-slot-renderer,
    ytd-enforcement-message-view-model,
    tp-yt-paper-dialog:has(ytd-enforcement-message-view-model) {
      display: none !important;
      height: 0 !important;
      visibility: hidden !important;
      pointer-events: none !important;
    }
  `;

  function applyAdBlockStyles() {
    if (isKilled || (typeof window !== 'undefined' && window.CineGlowKilled)) {
      const el = document.getElementById(AD_CSS_ID);
      if (el) el.remove();
      return;
    }
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
    if (isKilled || (typeof window !== 'undefined' && window.CineGlowKilled)) return;
    try {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        if (chrome.storage.local) {
          const local = await chrome.storage.local.get(['auraKillSwitchActive']).catch(() => ({}));
          if (local && local.auraKillSwitchActive) {
            teardownKillSwitch();
            return;
          }
        }
        if (chrome.storage.managed) {
          const managed = await chrome.storage.managed.get(['DisableAdBlock', 'KillSwitch']).catch(() => ({}));
          if (managed) {
            if (managed.KillSwitch) {
              teardownKillSwitch();
              return;
            }
            if (managed.DisableAdBlock) {
              isAdBlockPolicyDisabled = true;
            }
          }
        }
        if (chrome.storage.sync) {
          const stored = await chrome.storage.sync.get(['adblockEnabled']);
          if (stored.adblockEnabled !== undefined) {
            settings.adblockEnabled = stored.adblockEnabled;
          }
        }
      }
    } catch (_) {}

    if (isAdBlockPolicyDisabled) {
      settings.adblockEnabled = false;
    }
    applyAdBlockStyles();
    checkAdState();
    setupAdObserver();
  }

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (isKilled || (typeof window !== 'undefined' && window.CineGlowKilled)) return;
      if (area === 'managed') {
        if ('DisableAdBlock' in changes) {
          isAdBlockPolicyDisabled = changes.DisableAdBlock.newValue === true;
          if (isAdBlockPolicyDisabled) {
            settings.adblockEnabled = false;
          } else {
            settings.adblockEnabled = true;
          }
          applyAdBlockStyles();
          checkAdState();
        }
        if ('KillSwitch' in changes && changes.KillSwitch.newValue === true) {
          teardownKillSwitch();
        }
      }
      if (area === 'local' && changes.auraKillSwitchActive && changes.auraKillSwitchActive.newValue === true) {
        teardownKillSwitch();
      }
      if (area === 'sync' && changes.adblockEnabled) {
        if (!isAdBlockPolicyDisabled) {
          settings.adblockEnabled = changes.adblockEnabled.newValue;
          applyAdBlockStyles();
          checkAdState();
        }
      }
    });
  }

  function isAdActive() {
    const moviePlayer = document.querySelector('#movie_player, #shorts-player, .html5-video-player');
    if (!moviePlayer) return false;

    // 1. YouTube adds 'ad-showing' or 'ad-interrupting' exclusively when in-stream ad video is active
    if (moviePlayer.classList.contains('ad-showing') || moviePlayer.classList.contains('ad-interrupting')) {
      return true;
    }

    // 2. Modern ad overlay or skip container presence
    if (moviePlayer.querySelector('.ytp-ad-player-overlay, .ytp-ad-player-overlay-layout, .ytp-ad-skip-button-slot, .ytp-ad-skip-button-modern, .ytp-skip-ad-button')) {
      return true;
    }

    // 3. Fallback: check if an ad text or preview element is explicitly rendered with visible content
    const adText = moviePlayer.querySelector('.ytp-ad-text, .ytp-ad-preview-text');
    if (adText && (adText.offsetParent !== null || adText.offsetWidth > 0) && adText.textContent.trim().length > 0) {
      return true;
    }

    return false;
  }

  function dismissEnforcementModal() {
    const enforcementModal = document.querySelector('ytd-enforcement-message-view-model');
    if (enforcementModal) {
      const dialog = enforcementModal.closest('tp-yt-paper-dialog') || enforcementModal;
      dialog.remove();
      const moviePlayer = document.querySelector('#movie_player, .html5-video-player');
      if (moviePlayer && typeof moviePlayer.playVideo === 'function') {
        moviePlayer.playVideo();
      }
      const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
      if (video && video.paused) {
        video.play().catch(() => {});
      }
    }
  }

  let adMutationObserver = null;
  let isSkipping = false;
  let lastSkipButtonClickTime = 0;

  const SKIP_BUTTON_SELECTOR = [
    '.ytp-ad-skip-button-modern',
    '.ytp-ad-skip-button',
    '.ytp-skip-ad-button',
    '.ytp-ad-skip-button-slot button',
    '[id^="skip-button:"] button',
    'button.ytp-ad-skip-button-modern',
    '.ytp-ad-skip-button-container button',
    'button[aria-label*="Skip"]',
    '.ytp-ad-overlay-close-button'
  ].join(', ');

  function setupAdObserver() {
    if (isKilled) return;
    if (adMutationObserver) return;
    const target = document.querySelector('#movie_player, .html5-video-player') || document.body;
    if (target && typeof MutationObserver !== 'undefined') {
      adMutationObserver = new MutationObserver(() => {
        if (!settings.adblockEnabled) return;
        if (isAdActive()) {
          skipVideoAds();
        }
      });
      adMutationObserver.observe(target, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    }
  }

  function skipVideoAds() {
    if (isKilled || (typeof window !== 'undefined' && window.CineGlowKilled)) return;
    if (!settings.adblockEnabled) return;
    if (isSkipping) return;
    isSkipping = true;

    try {
      // Dismiss YouTube Anti-Adblock popup if it ever appears
      dismissEnforcementModal();

      // Trigger MAIN world privileged skipAd() engine
      try {
        window.postMessage({ type: 'CINEGLOW_FORCE_SKIP_AD' }, window.location.origin);
      } catch (_) {}

      const isAd = isAdActive();

      // 1. Click the active skip button (resolving to child button if container element is matched)
      const now = Date.now();
      if (now - lastSkipButtonClickTime > 200) {
        let btn = document.querySelector(SKIP_BUTTON_SELECTOR);
        if (btn && btn.tagName !== 'BUTTON' && typeof btn.querySelector === 'function') {
          const childBtn = btn.querySelector('button, [role="button"]');
          if (childBtn) btn = childBtn;
        }
        if (btn) {
          lastSkipButtonClickTime = now;
          try {
            btn.click();
          } catch (_) {}
        }
      }

      // 2. Fast-forward video ad ONLY if an ad is actively confirmed
      const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
      if (isAd && video) {
        if (!adMutedByUs) {
          if (video.playbackRate > 0 && video.playbackRate !== 16.0) {
            preAdSpeed = video.playbackRate;
          }
          userWasMuted = video.muted;
          if (!video.muted) {
            video.muted = true;
            adMutedByUs = true;
            mutedVideoElement = video;
          }
        } else if (!userWasMuted && !video.muted) {
          // Handle video element swap mid-ad
          video.muted = true;
          mutedVideoElement = video;
        }
        video.playbackRate = 16.0;
        if (!isNaN(video.duration) && video.duration > 0 && isFinite(video.duration)) {
          video.currentTime = video.duration;
        } else {
          video.currentTime = 99999;
        }

        if (Date.now() - lastAdSkipTime > 2500) {
          safeSendMessage({ type: 'AD_BLOCKED', count: 1 });
          lastAdSkipTime = Date.now();
        }
      } else if (!isAd && video) {
        // Ad finished — restore audio and user's playback speed ONLY on the element we modified
        restoreModifiedPlaybackState(video);
      }
    } finally {
      isSkipping = false;
    }
  }

  function restoreModifiedPlaybackState(video) {
    const targetVideo = video || mutedVideoElement || activeVideo || document.querySelector('video.html5-main-video') || document.querySelector('video');
    if (adMutedByUs) {
      if (mutedVideoElement && targetVideo && mutedVideoElement === targetVideo && !userWasMuted) {
        targetVideo.muted = false;
      }
      adMutedByUs = false;
      mutedVideoElement = null;
    }
    userWasMuted = false;
    if (targetVideo && targetVideo.playbackRate === 16.0) {
      targetVideo.playbackRate = preAdSpeed || 1.0;
    }
  }

  function checkAdState() {
    if (isKilled || (typeof window !== 'undefined' && window.CineGlowKilled)) return;
    if (!settings.adblockEnabled) {
      if (adSkipTimer) {
        clearInterval(adSkipTimer);
        adSkipTimer = 0;
      }
      const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
      restoreModifiedPlaybackState(video);
      return;
    }

    const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
    if (video && activeVideo !== video) {
      attachVideoListener(video);
    }

    const isAd = isAdActive();
    if (isAd) {
      skipVideoAds();
      if (!adSkipTimer) {
        adSkipTimer = setInterval(skipVideoAds, 250);
        if (adSkipTimer && typeof adSkipTimer === 'object' && typeof adSkipTimer.unref === 'function') {
          adSkipTimer.unref();
        }
      }
    } else {
      if (adSkipTimer) {
        clearInterval(adSkipTimer);
        adSkipTimer = 0;
      }
      restoreModifiedPlaybackState(video);
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

  function cleanup() {
    if (adSkipTimer) {
      clearInterval(adSkipTimer);
      adSkipTimer = 0;
    }
    if (adMutationObserver) {
      adMutationObserver.disconnect();
      adMutationObserver = null;
    }
    if (activeVideo) {
      activeVideo.removeEventListener('timeupdate', checkAdState);
    }
    restoreModifiedPlaybackState(activeVideo);
    activeVideo = null;
  }

  // --- Emergency Kill-Switch Teardown ---
  function teardownKillSwitch() {
    if (isKilled) return;
    isKilled = true;
    settings.adblockEnabled = false;
    if (typeof window !== 'undefined') window.CineGlowKilled = true;

    cleanup();
    if (adMutationObserver) {
      adMutationObserver.disconnect();
      adMutationObserver = null;
    }
    const styleEl = document.getElementById(AD_CSS_ID);
    if (styleEl) styleEl.remove();
  }

  // Dual listener registration: Direct runtime message + In-tab fallback event
  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage?.addListener) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message && message.type === 'AURA_EMERGENCY_KILL_SWITCH') {
        teardownKillSwitch();
        if (typeof window !== 'undefined' && !window._cineglowKillEventFired) {
          window._cineglowKillEventFired = true;
          window.dispatchEvent(new CustomEvent('cineglow:kill-switch', { detail: message }));
        }
        if (typeof sendResponse === 'function') {
          sendResponse({ success: true, script: 'youtube-ads.js' });
        }
      }
    });
  }

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('cineglow:kill-switch', () => {
      teardownKillSwitch();
    }, { once: true });
  }

  // Expose for testing and external diagnostics if needed
  window.CineGlowAdBlock = {
    settings,
    isAdBlockPolicyDisabled: () => isAdBlockPolicyDisabled,
    isAdActive,
    skipVideoAds,
    checkAdState,
    dismissEnforcementModal,
    restoreModifiedPlaybackState,
    cleanup,
    teardownKillSwitch
  };

  loadSettings();
})();

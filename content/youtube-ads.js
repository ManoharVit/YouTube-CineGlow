// YouTube specific ad blocking/skipping content script
// Author: Giri Manohar Vemula (https://www.linkedin.com/in/manoharv511)
(() => {
  'use strict';

  // Cosmetic ad suppression rules managed via content.css (html.aura-adblock):
  // ytd-companion-slot-renderer, #secondary #companion, [target-id="engagement-panel-ads"],
  // ytd-ad-slot-renderer, ytd-action-companion-ad-renderer

  let settings = { adblockEnabled: true };
  let isKilled = false;
  let isAdBlockPolicyDisabled = false;
  let popupObserver = null;
  let popupBootstrapObserver = null;
  let observedPopupContainer = null;
  let fallbackAdTimer = 0;
  let wasAdShowing = false;
  let adMutedByFallback = false;
  let mutedVideoElement = null;
  let userWasMuted = false;
  let preAdSpeed = 1.0;
  let activeVideo = null;

  function safeSendMessage(msg) {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime?.id) {
        chrome.runtime.sendMessage(msg, () => {
          try {
            if (chrome.runtime?.lastError) {}
          } catch (_) {}
        });
      }
    } catch (_) {}
  }

  function syncAdBlockStateToMainWorld() {
    try {
      const origin = window.location?.origin || 'https://www.youtube.com';
      window.postMessage({
        type: 'CINEGLOW_SET_ADBLOCK_STATE',
        enabled: settings.adblockEnabled
      }, origin);
    } catch (_) {}
  }

  function applyAdBlockClass() {
    if (isKilled || window.CineGlowKilled) {
      document.documentElement?.classList.remove('aura-adblock');
      return;
    }
    document.documentElement?.classList.toggle('aura-adblock', Boolean(settings.adblockEnabled));
  }

  async function loadSettings() {
    if (isKilled || window.CineGlowKilled) return;
    try {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        const [local, managed, stored] = await Promise.all([
          chrome.storage.local?.get(['auraKillSwitchActive']).catch(() => ({})),
          chrome.storage.managed?.get(['DisableAdBlock', 'KillSwitch']).catch(() => ({})),
          chrome.storage.sync?.get(['adblockEnabled']).catch(() => ({}))
        ]);

        if (local?.auraKillSwitchActive || managed?.KillSwitch) {
          teardownKillSwitch();
          return;
        }
        if (managed?.DisableAdBlock) {
          isAdBlockPolicyDisabled = true;
        }
        if (stored?.adblockEnabled !== undefined) {
          settings.adblockEnabled = Boolean(stored.adblockEnabled);
        }
      }
    } catch (_) {}

    if (isAdBlockPolicyDisabled) {
      settings.adblockEnabled = false;
    }
    applyAdBlockClass();
    syncAdBlockStateToMainWorld();
    setupPopupObserver();
    checkAdState();
  }

  const handleStorageChange = (changes, area) => {
    if (isKilled || window.CineGlowKilled) return;
    if (area === 'managed') {
      if ('DisableAdBlock' in changes) {
        isAdBlockPolicyDisabled = changes.DisableAdBlock.newValue === true;
        settings.adblockEnabled = !isAdBlockPolicyDisabled;
        applyAdBlockClass();
        syncAdBlockStateToMainWorld();
        checkAdState();
      }
      if (changes.KillSwitch?.newValue === true) {
        teardownKillSwitch();
      }
    }
    if (area === 'local' && changes.auraKillSwitchActive?.newValue === true) {
      teardownKillSwitch();
    }
    if (area === 'sync' && 'adblockEnabled' in changes && !isAdBlockPolicyDisabled) {
      settings.adblockEnabled = Boolean(changes.adblockEnabled.newValue);
      applyAdBlockClass();
      syncAdBlockStateToMainWorld();
      checkAdState();
    }
  };
  chrome.storage?.onChanged?.addListener(handleStorageChange);

  function getPlayerElement() {
    return document.querySelector('#movie_player, #shorts-player, .html5-video-player');
  }

  function isAdActive(player = getPlayerElement()) {
    if (!player) return false;
    return Boolean(player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting'));
  }

  function dismissEnforcementModal() {
    if (!settings.adblockEnabled || isKilled) return;
    const enforcementModal = document.querySelector('ytd-enforcement-message-view-model');
    if (!enforcementModal) return;

    const dialog = enforcementModal.closest('tp-yt-paper-dialog');
    if (dialog && dialog.getAttribute('aria-hidden') === 'true') return;

    (dialog || enforcementModal).remove();
    document.querySelectorAll('tp-yt-iron-overlay-backdrop, iron-overlay-backdrop, .scrim').forEach((b) => {
      if (b && typeof b.remove === 'function') b.remove();
    });

    const moviePlayer = document.querySelector('#movie_player, .html5-video-player');
    if (moviePlayer && typeof moviePlayer.playVideo === 'function') {
      moviePlayer.playVideo();
    }

    const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
    if (video && video.paused) {
      video.play().catch(() => {});
    }
  }

  // Observe ytd-popup-container (where YouTube mounts enforcement dialogs), never document.body permanently
  function setupPopupObserver() {
    if (isKilled || !settings.adblockEnabled || typeof MutationObserver === 'undefined') return;
    const container = document.querySelector('ytd-popup-container');
    if (container) {
      if (popupBootstrapObserver) {
        popupBootstrapObserver.disconnect();
        popupBootstrapObserver = null;
      }
      if (observedPopupContainer === container && popupObserver) return;
      if (!popupObserver) {
        popupObserver = new MutationObserver(() => dismissEnforcementModal());
      }
      popupObserver.disconnect();
      observedPopupContainer = container;
      popupObserver.observe(container, { childList: true, subtree: true });
      dismissEnforcementModal();
      return;
    }

    if (!popupBootstrapObserver && document.body) {
      popupBootstrapObserver = new MutationObserver(() => {
        if (document.querySelector('ytd-popup-container')) {
          setupPopupObserver();
        }
      });
      popupBootstrapObserver.observe(document.body, { childList: true, subtree: true });
    }
  }

  const SKIP_BUTTON_SELECTOR = [
    '.ytp-ad-skip-button-modern',
    '.ytp-ad-skip-button',
    '.ytp-skip-ad-button',
    '.ytp-ad-skip-button-slot button',
    '[id^="skip-button:"] button',
    'button.ytp-ad-skip-button-modern',
    '.ytp-ad-skip-button-container button',
    '.ytp-ad-overlay-close-button'
  ].join(', ');

  function fallbackSkipAd() {
    if (isKilled || window.CineGlowKilled || !settings.adblockEnabled) return;
    const player = getPlayerElement();
    if (!isAdActive(player)) {
      restoreFallbackState();
      return;
    }

    try {
      window.postMessage({ type: 'CINEGLOW_FORCE_SKIP_AD' }, window.location.origin);
    } catch (_) {}

    const btn = player?.querySelector?.(SKIP_BUTTON_SELECTOR);
    if (btn) {
      try {
        (btn.tagName !== 'BUTTON' ? btn.querySelector('button, [role="button"]') || btn : btn).click();
      } catch (_) {}
    }

    const video = document.querySelector('video.html5-main-video') || player?.querySelector?.('video') || document.querySelector('video');
    if (video) {
      const alreadyMutedByCineGlow = typeof video.hasAttribute === 'function' && video.hasAttribute('data-cineglow-ad-muted');
      if (!adMutedByFallback || alreadyMutedByCineGlow || !video.muted || mutedVideoElement !== video) {
        if (video.playbackRate > 0 && video.playbackRate !== 16.0) {
          preAdSpeed = video.playbackRate;
        }
        userWasMuted = video.muted && !alreadyMutedByCineGlow;
        video.muted = true;
        if (typeof video.setAttribute === 'function') {
          video.setAttribute('data-cineglow-ad-muted', 'true');
        }
        adMutedByFallback = true;
        mutedVideoElement = video;
      }
      if (video.playbackRate !== 16.0) {
        video.playbackRate = 16.0;
      }
    }
  }

  function restoreFallbackState() {
    if (fallbackAdTimer) {
      clearTimeout(fallbackAdTimer);
      fallbackAdTimer = 0;
    }
    const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
    const targetVideo = video || mutedVideoElement || activeVideo;
    if (adMutedByFallback || (targetVideo && typeof targetVideo.hasAttribute === 'function' && targetVideo.hasAttribute('data-cineglow-ad-muted'))) {
      if (mutedVideoElement && targetVideo && mutedVideoElement === targetVideo && !userWasMuted) {
        targetVideo.muted = false;
      } else if (!mutedVideoElement && targetVideo && !userWasMuted && targetVideo.getAttribute('data-cineglow-ad-muted') === 'true') {
        targetVideo.muted = false;
      }
      if (targetVideo && typeof targetVideo.removeAttribute === 'function') {
        targetVideo.removeAttribute('data-cineglow-ad-muted');
      }
      if (mutedVideoElement && typeof mutedVideoElement.removeAttribute === 'function') {
        mutedVideoElement.removeAttribute('data-cineglow-ad-muted');
      }
      adMutedByFallback = false;
      mutedVideoElement = null;
    }
    userWasMuted = false;
    if (targetVideo && targetVideo.playbackRate === 16.0) {
      const restoreSpeed = typeof window.CineGlowSpeed?.preferredSpeed === 'number'
        ? window.CineGlowSpeed.preferredSpeed
        : (preAdSpeed || 1.0);
      targetVideo.playbackRate = restoreSpeed;
    }
  }

  function checkAdState() {
    if (isKilled || window.CineGlowKilled) return;
    if (!settings.adblockEnabled) {
      wasAdShowing = false;
      restoreFallbackState();
      return;
    }

    const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
    const isAd = isAdActive();

    if (isAd) {
      if (!wasAdShowing) {
        wasAdShowing = true;
        try {
          window.postMessage({ type: 'CINEGLOW_FORCE_SKIP_AD' }, window.location.origin);
        } catch (_) {}
      }
      fallbackSkipAd();
    } else if (wasAdShowing || adMutedByFallback) {
      wasAdShowing = false;
      restoreFallbackState();
    }
    activeVideo = video;
  }

  const onPlayerStateChange = () => checkAdState();
  let navFinishTimer = null;
  const onNavigateFinish = () => {
    if (isKilled) return;
    setupPopupObserver();
    checkAdState();
    clearTimeout(navFinishTimer);
    navFinishTimer = setTimeout(() => {
      const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
      const player = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
      if (video && video.paused && video.currentTime < 0.5 && !video.ended && !isAdActive() && !isKilled) {
        try {
          if (player && typeof player.playVideo === 'function') {
            const state = typeof player.getPlayerState === 'function' ? player.getPlayerState() : -1;
            if (state === -1 || state === 5) {
              player.playVideo();
            }
          } else {
            video.play().catch(() => {});
          }
        } catch (_) {}
      }
    }, 300);
  };
  window.CineGlowPlayer?.addEventListener('state-change', onPlayerStateChange);
  document.addEventListener('yt-page-data-updated', checkAdState, { passive: true });
  document.addEventListener('yt-navigate-finish', onNavigateFinish, { passive: true });

  function teardownKillSwitch() {
    if (isKilled) return;
    isKilled = true;
    settings.adblockEnabled = false;
    window.CineGlowKilled = true;
    clearTimeout(navFinishTimer);
    navFinishTimer = null;

    chrome.storage?.onChanged?.removeListener(handleStorageChange);
    window.CineGlowPlayer?.removeEventListener?.('state-change', onPlayerStateChange);
    document.removeEventListener('yt-page-data-updated', checkAdState);
    document.removeEventListener('yt-navigate-finish', onNavigateFinish);

    if (popupBootstrapObserver) {
      popupBootstrapObserver.disconnect();
      popupBootstrapObserver = null;
    }
    if (popupObserver) {
      popupObserver.disconnect();
      popupObserver = null;
    }
    observedPopupContainer = null;

    syncAdBlockStateToMainWorld();
    restoreFallbackState();
    document.documentElement?.classList.remove('aura-adblock');
  }

  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage?.addListener) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === 'AURA_EMERGENCY_KILL_SWITCH') {
        teardownKillSwitch();
        if (!window._cineglowKillEventFired) {
          window._cineglowKillEventFired = true;
          window.dispatchEvent(new CustomEvent('cineglow:kill-switch', { detail: message }));
        }
        if (typeof sendResponse === 'function') {
          sendResponse({ success: true, script: 'youtube-ads.js' });
        }
      }
    });
  }

  window.addEventListener('cineglow:kill-switch', () => {
    teardownKillSwitch();
  }, { once: true });

  window.CineGlowAdBlock = {
    settings,
    isAdBlockPolicyDisabled: () => isAdBlockPolicyDisabled,
    isAdActive,
    skipVideoAds: fallbackSkipAd,
    checkAdState,
    dismissEnforcementModal,
    restoreModifiedPlaybackState: restoreFallbackState,
    syncAdBlockStateToMainWorld,
    cleanup: restoreFallbackState,
    teardownKillSwitch
  };

  loadSettings();
})();

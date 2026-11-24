(() => {
  'use strict';

  let autoPauseMode = 'off'; // 'off' | 'tab' | 'app'
  let pausedByExtension = false;
  let lastExtensionPauseTime = 0;
  let lastVideo = null;
  let blurTimer = null;
  let isKilled = false;
  let hasExplicitMode = false;

  const handleStorageChange = (changes, area) => {
    if (isKilled || window.CineGlowKilled) return;
    if (area === 'managed' && changes.KillSwitch?.newValue === true) {
      teardownKillSwitch();
      return;
    }
    if (area === 'local' && changes.auraKillSwitchActive?.newValue === true) {
      teardownKillSwitch();
      return;
    }
    if (area === 'sync' && changes.autoPauseMode) {
      autoPauseMode = changes.autoPauseMode.newValue || 'off';
      hasExplicitMode = true;
      if (autoPauseMode === 'off' && pausedByExtension) {
        resumePlayback();
      } else {
        checkState();
      }
    }
  };

  async function loadSettings() {
    if (isKilled || window.CineGlowKilled) return;
    try {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        const [local, managed, stored] = await Promise.all([
          chrome.storage.local?.get(['auraKillSwitchActive']).catch(() => ({})),
          chrome.storage.managed?.get(['KillSwitch']).catch(() => ({})),
          chrome.storage.sync?.get({ autoPauseMode: 'off' }).catch(() => ({}))
        ]);
        if (local?.auraKillSwitchActive || managed?.KillSwitch) {
          teardownKillSwitch();
          return;
        }
        if (!hasExplicitMode && stored?.autoPauseMode) {
          autoPauseMode = stored.autoPauseMode;
        }
        checkState();
      }
    } catch (_) {}
  }

  chrome.storage?.onChanged?.addListener(handleStorageChange);

  function shouldPause() {
    if (autoPauseMode === 'off') return false;
    if (window._cineglowPipTransition) return false;
    if (document.querySelector('.ad-showing, .ad-interrupting') || window.CineGlowPlayer?.isAdShowing) {
      return false;
    }
    if (document.hidden) return true;
    if (autoPauseMode === 'app' && typeof document.hasFocus === 'function') {
      if (document.activeElement?.tagName === 'IFRAME') return false;
      if (!document.hasFocus()) return true;
    }
    return false;
  }

  function resumePlayback() {
    const video = window.CineGlowPlayer?.video;
    if (video && pausedByExtension) {
      pausedByExtension = false;
      video.play().catch(() => {});
    }
  }

  function checkState() {
    if (isKilled || window.CineGlowKilled) return;
    const playerManager = window.CineGlowPlayer;
    const video = playerManager?.video;
    if (!video) return;

    if (playerManager.isPiP || document.pictureInPictureElement === video) {
      return;
    }

    if (shouldPause()) {
      if (!video.paused) {
        lastExtensionPauseTime = Date.now();
        video.pause();
        pausedByExtension = true;
      }
    } else if (pausedByExtension) {
      resumePlayback();
    }
  }

  const onVisibilityChange = () => {
    if (blurTimer) {
      clearTimeout(blurTimer);
      blurTimer = null;
    }
    checkState();
  };

  const onWindowBlur = () => {
    if (autoPauseMode === 'app') {
      if (blurTimer) clearTimeout(blurTimer);
      blurTimer = setTimeout(() => {
        blurTimer = null;
        checkState();
      }, 150);
      if (typeof blurTimer?.unref === 'function') blurTimer.unref();
    }
  };

  const onWindowFocus = () => {
    if (blurTimer) {
      clearTimeout(blurTimer);
      blurTimer = null;
    }
    checkState();
  };

  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('blur', onWindowBlur);
  window.addEventListener('focus', onWindowFocus);

  const onUserPlay = () => {
    if (!shouldPause()) {
      pausedByExtension = false;
    }
  };

  const onUserPause = () => {
    if (!shouldPause() || (Date.now() - lastExtensionPauseTime > 200)) {
      pausedByExtension = false;
    }
  };

  const onPlayerStateChange = (e) => {
    if (isKilled) return;
    const state = e.detail;
    if (state.video !== lastVideo) {
      if (lastVideo) {
        lastVideo.removeEventListener('play', onUserPlay);
        lastVideo.removeEventListener('pause', onUserPause);
      }
      lastVideo = state.video;
      pausedByExtension = false;
      if (lastVideo) {
        lastVideo.addEventListener('play', onUserPlay, { passive: true });
        lastVideo.addEventListener('pause', onUserPause, { passive: true });
        checkState();
      }
    }
  };

  function teardownKillSwitch() {
    if (isKilled) return;
    isKilled = true;
    autoPauseMode = 'off';
    lastExtensionPauseTime = 0;
    window.CineGlowKilled = true;

    chrome.storage?.onChanged?.removeListener(handleStorageChange);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('blur', onWindowBlur);
    window.removeEventListener('focus', onWindowFocus);

    if (blurTimer) {
      clearTimeout(blurTimer);
      blurTimer = null;
    }
    if (pausedByExtension) {
      resumePlayback();
    }
    if (lastVideo) {
      lastVideo.removeEventListener('play', onUserPlay);
      lastVideo.removeEventListener('pause', onUserPause);
      lastVideo = null;
    }
    window.CineGlowPlayer?.removeEventListener?.('state-change', onPlayerStateChange);
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
          sendResponse({ success: true, script: 'smart-pause.js' });
        }
      }
    });
  }

  window.addEventListener('cineglow:kill-switch', () => {
    teardownKillSwitch();
  }, { once: true });

  window.CineGlowSmartPauseTeardown = teardownKillSwitch;

  if (window.CineGlowPlayer) {
    window.CineGlowPlayer.addEventListener('state-change', onPlayerStateChange);
    if (window.CineGlowPlayer.video) {
      onPlayerStateChange({ detail: window.CineGlowPlayer });
    }
  }

  loadSettings();
})();

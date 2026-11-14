(() => {
  'use strict';

  let autoPauseMode = 'off'; // 'off' | 'tab' | 'app'
  let pausedByExtension = false;
  let lastExtensionPauseTime = 0;
  let lastVideo = null;
  let blurTimer = null;
  let isKilled = false;

  // Sync mode from extension storage
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
    chrome.storage.sync.get({ autoPauseMode: 'off' }, (items) => {
      autoPauseMode = items.autoPauseMode || 'off';
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (isKilled || (typeof window !== 'undefined' && window.CineGlowKilled)) return;
      if (area === 'sync' && changes.autoPauseMode) {
        autoPauseMode = changes.autoPauseMode.newValue || 'off';
        // If mode was disabled while extension paused it, resume playback safely
        if (autoPauseMode === 'off' && pausedByExtension) {
          resumePlayback();
        }
      }
    });
  }

  function shouldPause() {
    if (autoPauseMode === 'off') return false;

    // Prevent PiP from opening in a paused state during transition (FP-4.4)
    if (typeof window !== 'undefined' && window._cineglowPipTransition) return false;

    // Active in-stream ads must not freeze when switching tabs (FP-4.3)
    if (document.querySelector('.ad-showing, .ad-interrupting') || window.CineGlowPlayer?.isAdShowing) {
      return false;
    }

    // Always pause if the tab is completely hidden (switched tabs / minimized)
    if (document.hidden) return true;

    // In 'app' mode, also pause if user switches to another desktop app/window
    if (autoPauseMode === 'app' && typeof document.hasFocus === 'function') {
      // Focus moved to an internal iframe (e.g. Live Chat) does not auto-pause (FP-4.2)
      if (document.activeElement && document.activeElement.tagName === 'IFRAME') return false;
      if (!document.hasFocus()) return true;
    }

    return false;
  }

  function resumePlayback() {
    const playerManager = window.CineGlowPlayer;
    const video = playerManager ? playerManager.video : null;
    if (video && pausedByExtension) {
      pausedByExtension = false;
      video.play().catch(e => console.error('[CineGlow Smart Pause] Play failed:', e));
    }
  }

  function checkState() {
    if (isKilled || (typeof window !== 'undefined' && window.CineGlowKilled)) return;
    const playerManager = window.CineGlowPlayer;
    const video = playerManager ? playerManager.video : null;
    if (!video) return;

    // Do not auto-pause if the user is watching in Picture-in-Picture
    if (playerManager.isPiP || document.pictureInPictureElement === video) {
      return;
    }

    if (shouldPause()) {
      if (!video.paused) {
        lastExtensionPauseTime = Date.now();
        video.pause();
        pausedByExtension = true;
      }
    } else {
      if (pausedByExtension) {
        resumePlayback();
      }
    }
  }

  // Named listeners for tab switching & window minimize / focus
  const onVisibilityChange = () => {
    if (blurTimer) {
      clearTimeout(blurTimer);
      blurTimer = null;
    }
    checkState();
  };

  const onWindowBlur = () => {
    if (autoPauseMode === 'app') {
      // Debounce slightly to avoid false positives on quick in-page clicks or iframe focus
      if (blurTimer) clearTimeout(blurTimer);
      blurTimer = setTimeout(() => {
        blurTimer = null;
        checkState();
      }, 150);
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

  // Reset extension pause flag if user manually interacts with playback controls
  const onUserPlay = () => {
    if (!shouldPause()) {
      pausedByExtension = false;
    }
  };

  const onUserPause = () => {
    // If a pause event fires >200ms after an extension pause, treat as explicit user intent
    // (e.g. media keys/headset pause while tab hidden) and clear pausedByExtension
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
      if (lastVideo) {
        lastVideo.addEventListener('play', onUserPlay);
        lastVideo.addEventListener('pause', onUserPause);
      }
    }
  };

  // --- Emergency Kill-Switch Teardown ---
  function teardownKillSwitch() {
    if (isKilled) return;
    isKilled = true;
    autoPauseMode = 'off';
    lastExtensionPauseTime = 0;
    if (typeof window !== 'undefined') window.CineGlowKilled = true;

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
    if (window.CineGlowPlayer && typeof window.CineGlowPlayer.removeEventListener === 'function') {
      window.CineGlowPlayer.removeEventListener('state-change', onPlayerStateChange);
    }
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
          sendResponse({ success: true, script: 'smart-pause.js' });
        }
      }
    });
  }

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('cineglow:kill-switch', () => {
      teardownKillSwitch();
    }, { once: true });
  }

  window.CineGlowSmartPauseTeardown = teardownKillSwitch;

  if (window.CineGlowPlayer) {
    window.CineGlowPlayer.addEventListener('state-change', onPlayerStateChange);
  }

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('unhandledrejection', (event) => {
      if (event && event.reason && String(event.reason.message || event.reason).includes('Extension context invalidated')) {
        try { event.preventDefault(); } catch (_) {}
      }
    });
    window.addEventListener('error', (event) => {
      if (event && event.message && String(event.message).includes('Extension context invalidated')) {
        try { event.preventDefault(); } catch (_) {}
      }
    });
  }
})();

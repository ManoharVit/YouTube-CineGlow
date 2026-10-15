(() => {
  'use strict';

  let autoPauseMode = 'off'; // 'off' | 'tab' | 'app'
  let pausedByExtension = false;
  let lastVideo = null;
  let blurTimer = null;

  // Sync mode from extension storage
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
    chrome.storage.sync.get({ autoPauseMode: 'off' }, (items) => {
      autoPauseMode = items.autoPauseMode || 'off';
    });

    chrome.storage.onChanged.addListener((changes, area) => {
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
    
    // Always pause if the tab is completely hidden (switched tabs / minimized)
    if (document.hidden) return true;

    // In 'app' mode, also pause if user switches to another desktop app/window
    if (autoPauseMode === 'app' && typeof document.hasFocus === 'function') {
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
    const playerManager = window.CineGlowPlayer;
    const video = playerManager ? playerManager.video : null;
    if (!video) return;

    // Do not auto-pause if the user is watching in Picture-in-Picture
    if (playerManager.isPiP || document.pictureInPictureElement === video) {
      return;
    }

    if (shouldPause()) {
      if (!video.paused) {
        video.pause();
        pausedByExtension = true;
      }
    } else {
      if (pausedByExtension) {
        resumePlayback();
      }
    }
  }

  // Handle tab switching & window minimize
  document.addEventListener('visibilitychange', () => {
    if (blurTimer) {
      clearTimeout(blurTimer);
      blurTimer = null;
    }
    checkState();
  });

  // Handle switching apps (window blur/focus)
  window.addEventListener('blur', () => {
    if (autoPauseMode === 'app') {
      // Debounce slightly to avoid false positives on quick in-page clicks or iframe focus
      if (blurTimer) clearTimeout(blurTimer);
      blurTimer = setTimeout(() => {
        blurTimer = null;
        checkState();
      }, 150);
    }
  });

  window.addEventListener('focus', () => {
    if (blurTimer) {
      clearTimeout(blurTimer);
      blurTimer = null;
    }
    checkState();
  });

  // Reset extension pause flag if user manually interacts with playback controls
  const onUserPlay = () => {
    if (!shouldPause()) {
      pausedByExtension = false;
    }
  };

  const onUserPause = () => {
    if (!shouldPause()) {
      pausedByExtension = false;
    }
  };

  if (window.CineGlowPlayer) {
    window.CineGlowPlayer.addEventListener('state-change', (e) => {
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
    });
  }
})();

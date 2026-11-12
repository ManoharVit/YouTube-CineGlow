(() => {
  'use strict';

  let enabled = true;
  let isKilled = false;
  let currentVideoId = null;
  let userRevealed = false;
  let programmaticClick = false;
  let mutationObserver = null;
  let currentPlayer = null;

  // --- Settings Management ---
  async function loadSettings() {
    if (isKilled || (typeof window !== 'undefined' && window.CineGlowKilled)) return;
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.sync) {
        const stored = await chrome.storage.sync.get('hideEndCards');
        if (stored.hideEndCards !== undefined) {
          enabled = !!stored.hideEndCards;
        }
      }
      if (enabled) {
        checkAndHide();
      }
    } catch (err) {
      console.warn('[CineGlow HideEndCards] Could not load settings:', err);
    }
  }

  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (isKilled || (typeof window !== 'undefined' && window.CineGlowKilled)) return;
      if (area === 'sync' && 'hideEndCards' in changes) {
        enabled = !!changes.hideEndCards.newValue;
        if (enabled) {
          userRevealed = false;
          checkAndHide();
        }
      }
    });
  }

  // --- Hide Logic ---
  function checkAndHide() {
    if (isKilled || (typeof window !== 'undefined' && window.CineGlowKilled)) return;
    if (!enabled || userRevealed) return;
    const player = currentPlayer || document.querySelector('#movie_player') || document.querySelector('.html5-video-player');
    if (!player) return;

    // 1. YouTube Native "Hide" Button Integration
    const hideBtn = player.querySelector('.ytp-ce-hide-button-container button');
    if (hideBtn) {
      const isPressed = hideBtn.getAttribute('aria-pressed') === 'true';

      // In YouTube: aria-pressed="false" means cards are currently visible (button shows "Hide").
      // Clicking it dismisses the cards and changes button to "Show" (aria-pressed="true").
      if (!isPressed) {
        try {
          programmaticClick = true;
          hideBtn.click();
        } catch (e) {
          console.debug('[CineGlow HideEndCards] Native click error:', e);
        } finally {
          setTimeout(() => {
            programmaticClick = false;
          }, 150);
        }
        return;
      }
    }

    // 2. Fallback: If end-screen cards exist without native hide button
    const ceElements = player.querySelectorAll('.ytp-ce-element');
    if (ceElements.length > 0 && !player.querySelector('.ytp-ce-hide-button-container')) {
      for (const el of ceElements) {
        if (el.style.display !== 'none') {
          el.style.display = 'none';
        }
      }
    }
  }

  // --- Player Setup & Listeners ---
  function setupPlayer(player) {
    if (!player) return;
    if (currentPlayer === player && mutationObserver) return;
    teardown();

    currentPlayer = player;

    // Detect user manual interaction with the native Hide/Show button
    currentPlayer.addEventListener('click', onPlayerClick, true);

    // Observe player for end-screen element injection
    mutationObserver = new MutationObserver(() => {
      checkAndHide();
    });

    mutationObserver.observe(currentPlayer, {
      childList: true,
      subtree: true
    });

    checkAndHide();
  }

  function onPlayerClick(e) {
    if (programmaticClick) return;
    const btn = e.target.closest('.ytp-ce-hide-button-container button');
    if (!btn) return;

    // The user clicked the native button themselves!
    // If it was in "Show" state (aria-pressed="true"), the user clicked to SHOW the cards.
    const wasPressed = btn.getAttribute('aria-pressed') === 'true';
    if (wasPressed) {
      userRevealed = true;
      // Re-enable any CSS-hidden cards if present
      if (currentPlayer) {
        const ceElements = currentPlayer.querySelectorAll('.ytp-ce-element');
        for (const el of ceElements) {
          if (el.style.display === 'none') {
            el.style.display = '';
          }
        }
      }
    } else {
      userRevealed = false;
    }
  }

  function teardown() {
    if (mutationObserver) {
      mutationObserver.disconnect();
      mutationObserver = null;
    }
    if (currentPlayer) {
      currentPlayer.removeEventListener('click', onPlayerClick, true);
      currentPlayer = null;
    }
  }

  // --- Player Manager Hook ---
  function onPlayerState(e) {
    if (isKilled || (typeof window !== 'undefined' && window.CineGlowKilled)) return;
    const pm = e ? e.detail : window.CineGlowPlayer;
    if (!pm) return;

    if (!pm.isWatchPage) {
      teardown();
      currentVideoId = null;
      userRevealed = false;
      return;
    }

    if (pm.videoId !== currentVideoId) {
      currentVideoId = pm.videoId;
      userRevealed = false; // Reset manual override for new video
    }

    if (pm.player) {
      setupPlayer(pm.player);
    } else if (enabled) {
      checkAndHide();
    }
  }

  // --- Emergency Kill-Switch Teardown ---
  function teardownKillSwitch() {
    if (isKilled) return;
    isKilled = true;
    enabled = false;
    if (typeof window !== 'undefined') window.CineGlowKilled = true;

    teardown();
    const player = currentPlayer || document.querySelector('#movie_player') || document.querySelector('.html5-video-player');
    if (player) {
      player.querySelectorAll('.ytp-ce-element').forEach(el => {
        el.style.display = '';
      });
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
          sendResponse({ success: true, script: 'hide-endcards.js' });
        }
      }
    });
  }

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('cineglow:kill-switch', () => {
      teardownKillSwitch();
    }, { once: true });
  }

  window.CineGlowEndCardsTeardown = teardownKillSwitch;

  // Hook into video playback ticks as a lightweight safety net
  document.addEventListener('timeupdate', (e) => {
    if (e.target && e.target.tagName === 'VIDEO' && enabled && !userRevealed && !isKilled) {
      checkAndHide();
    }
  }, true);

  if (window.CineGlowPlayer) {
    window.CineGlowPlayer.addEventListener('state-change', onPlayerState);
    if (window.CineGlowPlayer.isWatchPage && window.CineGlowPlayer.player) {
      onPlayerState({ detail: window.CineGlowPlayer });
    }
  }

  // Immediate check if player already in DOM
  const existingPlayer = document.querySelector('#movie_player') || document.querySelector('.html5-video-player');
  if (existingPlayer) {
    setupPlayer(existingPlayer);
  }

  loadSettings();
})();

(() => {
  'use strict';

  let enabled = false;
  let isKilled = false;
  let currentVideoId = null;
  let userRevealed = false;
  let programmaticClick = false;
  let mutationObserver = null;
  let currentPlayer = null;

  async function loadSettings() {
    if (isKilled || window.CineGlowKilled) return;
    try {
      const [local, managed, stored] = await Promise.all([
        chrome.storage?.local?.get(['auraKillSwitchActive']).catch(() => ({})),
        chrome.storage?.managed?.get(['KillSwitch']).catch(() => ({})),
        chrome.storage?.sync?.get('hideEndCards').catch(() => ({}))
      ]);
      if (local?.auraKillSwitchActive || managed?.KillSwitch) {
        teardownKillSwitch();
        return;
      }
      if (stored?.hideEndCards !== undefined) {
        enabled = Boolean(stored.hideEndCards);
      } else if (typeof AURA_DEFAULTS !== 'undefined' && AURA_DEFAULTS.hideEndCards !== undefined) {
        enabled = Boolean(AURA_DEFAULTS.hideEndCards);
      }
      if (enabled) {
        checkAndHide();
      }
    } catch (err) {
      console.warn('[CineGlow HideEndCards] Could not load settings:', err);
    }
  }

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
    if (area === 'sync' && 'hideEndCards' in changes) {
      enabled = Boolean(changes.hideEndCards.newValue);
      if (enabled) {
        userRevealed = false;
        checkAndHide();
      } else if (currentPlayer) {
        currentPlayer.querySelectorAll('.ytp-ce-element').forEach((el) => {
          if (el.style.display === 'none') el.style.display = '';
        });
      }
    }
  };
  chrome.storage?.onChanged?.addListener(handleStorageChange);

  function checkAndHide() {
    if (isKilled || window.CineGlowKilled || !enabled || userRevealed) return;
    const player = currentPlayer || document.querySelector('#movie_player, .html5-video-player');
    if (!player) return;

    const hideBtn = player.querySelector('.ytp-ce-hide-button-container button');
    if (hideBtn) {
      const isPressed = hideBtn.getAttribute('aria-pressed') === 'true';
      if (!isPressed) {
        try {
          programmaticClick = true;
          hideBtn.click();
        } catch (_) {
        } finally {
          const t = setTimeout(() => {
            programmaticClick = false;
          }, 150);
          if (typeof t?.unref === 'function') t.unref();
        }
        return;
      }
    }

    const ceElements = player.querySelectorAll('.ytp-ce-element');
    if (ceElements.length > 0 && !player.querySelector('.ytp-ce-hide-button-container')) {
      for (const el of ceElements) {
        if (el.style.display !== 'none') {
          el.style.display = 'none';
        }
      }
    }
  }

  function setupPlayer(player) {
    if (!player) return;
    if (currentPlayer === player && mutationObserver) return;
    teardown();

    currentPlayer = player;
    currentPlayer.addEventListener('click', onPlayerClick, true);

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
    const btn = e.target.closest?.('.ytp-ce-hide-button-container button');
    if (!btn) return;

    const wasPressed = btn.getAttribute('aria-pressed') === 'true';
    if (wasPressed) {
      userRevealed = true;
      currentPlayer?.querySelectorAll('.ytp-ce-element').forEach((el) => {
        if (el.style.display === 'none') el.style.display = '';
      });
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

  function onPlayerState(e) {
    if (isKilled || window.CineGlowKilled) return;
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
      userRevealed = false;
    }

    if (pm.player) {
      setupPlayer(pm.player);
    } else if (enabled) {
      checkAndHide();
    }
  }

  function teardownKillSwitch() {
    if (isKilled) return;
    isKilled = true;
    enabled = false;
    window.CineGlowKilled = true;

    chrome.storage?.onChanged?.removeListener(handleStorageChange);
    window.CineGlowPlayer?.removeEventListener?.('state-change', onPlayerState);

    const player = currentPlayer || document.querySelector('#movie_player, .html5-video-player');
    teardown();
    player?.querySelectorAll('.ytp-ce-element').forEach((el) => {
      el.style.display = '';
    });
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
          sendResponse({ success: true, script: 'hide-endcards.js' });
        }
      }
    });
  }

  window.addEventListener('cineglow:kill-switch', () => {
    teardownKillSwitch();
  }, { once: true });

  window.CineGlowEndCardsTeardown = teardownKillSwitch;

  if (window.CineGlowPlayer) {
    window.CineGlowPlayer.addEventListener('state-change', onPlayerState);
    if (window.CineGlowPlayer.isWatchPage && window.CineGlowPlayer.player) {
      onPlayerState({ detail: window.CineGlowPlayer });
    }
  }

  const existingPlayer = document.querySelector('#movie_player, .html5-video-player');
  if (existingPlayer) {
    setupPlayer(existingPlayer);
  }

  loadSettings();
})();

/*
 * CineGlow Pro - Interactive A-B Section Looper (Continuous Segment Repeat)
 * Production Architecture: Shadow DOM HUD, Timeline Progress Bar Overlay, Hotkeys
 */
(() => {
  'use strict';

  let settings = { ...AURA_DEFAULTS };
  let video = null;
  let player = null;
  let isKilled = false;

  let pointA = null; // in seconds
  let pointB = null; // in seconds
  let isLooping = false;
  let loopCount = 0;

  let hostEl = null;
  let shadowRoot = null;
  let hudEl = null;
  let badgeEl = null;
  let timesEl = null;
  let counterEl = null;
  let toggleBtn = null;
  let clearBtn = null;
  let rangeOverlayEl = null;

  function formatTime(seconds) {
    if (seconds === null || isNaN(seconds)) return '--:--';
    const s = Math.floor(seconds);
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  function ensureShadowHUD() {
    if (isKilled) return null;
    const targetContainer = player || document.getElementById('movie_player') || document.body;
    if (!targetContainer) return null;

    if (!hostEl || !hostEl.isConnected) {
      hostEl = document.createElement('div');
      hostEl.id = 'cineglow-ab-host';
      hostEl.className = 'cineglow-ab-host';
      hostEl.style.position = 'absolute';
      hostEl.style.top = '16px';
      hostEl.style.left = '16px';
      hostEl.style.zIndex = '9999';
      hostEl.style.pointerEvents = 'auto';

      if (typeof hostEl.attachShadow === 'function') {
        try {
          shadowRoot = hostEl.attachShadow({ mode: 'open' });
        } catch (_) {
          shadowRoot = hostEl;
        }
      } else {
        shadowRoot = hostEl;
      }

      hudEl = document.createElement('div');
      hudEl.className = 'cineglow-ab-hud';

      const style = document.createElement('style');
      style.textContent = `
        .cineglow-ab-hud {
          display: none;
          align-items: center;
          gap: 8px;
          background: rgba(15, 15, 20, 0.88);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border: 1px solid rgba(255, 255, 255, 0.15);
          border-radius: 20px;
          padding: 6px 14px;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          font-size: 12px;
          font-weight: 500;
          color: #fff;
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
          user-select: none;
          transition: opacity 0.25s ease, transform 0.25s ease;
        }
        .cineglow-ab-hud.visible {
          display: flex;
        }
        .cineglow-ab-badge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: #ff0055;
          color: #fff;
          font-weight: 700;
          font-size: 10px;
          border-radius: 10px;
          padding: 2px 6px;
          letter-spacing: 0.5px;
        }
        .cineglow-ab-badge.looping {
          background: #00e676;
          color: #000;
        }
        .cineglow-ab-times {
          font-variant-numeric: tabular-nums;
          color: rgba(255, 255, 255, 0.9);
        }
        .cineglow-ab-counter {
          background: rgba(255, 255, 255, 0.12);
          border-radius: 8px;
          padding: 1px 6px;
          font-size: 11px;
          color: #ffd600;
        }
        .cineglow-ab-btn {
          background: none;
          border: none;
          color: rgba(255, 255, 255, 0.7);
          cursor: pointer;
          padding: 2px 4px;
          font-size: 14px;
          line-height: 1;
          border-radius: 4px;
        }
        .cineglow-ab-btn:hover {
          color: #fff;
          background: rgba(255, 255, 255, 0.2);
        }
      `;

      badgeEl = document.createElement('span');
      badgeEl.className = 'cineglow-ab-badge';
      badgeEl.id = 'abBadge';
      badgeEl.textContent = 'A-B LOOP';

      timesEl = document.createElement('span');
      timesEl.className = 'cineglow-ab-times';
      timesEl.id = 'abTimes';
      timesEl.textContent = 'A: --:-- | B: --:--';

      counterEl = document.createElement('span');
      counterEl.className = 'cineglow-ab-counter';
      counterEl.id = 'abCounter';
      counterEl.style.display = 'none';
      counterEl.textContent = '0x';

      toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'cineglow-ab-btn';
      toggleBtn.id = 'abToggleBtn';
      toggleBtn.title = 'Toggle Loop (\\)';
      toggleBtn.textContent = '⏯';
      toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleLoop();
      });

      clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'cineglow-ab-btn';
      clearBtn.id = 'abClearBtn';
      clearBtn.title = 'Clear Loop (Esc)';
      clearBtn.textContent = '✕';
      clearBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        resetLoop();
      });

      hudEl.appendChild(style);
      hudEl.appendChild(badgeEl);
      hudEl.appendChild(timesEl);
      hudEl.appendChild(counterEl);
      hudEl.appendChild(toggleBtn);
      hudEl.appendChild(clearBtn);

      shadowRoot.appendChild(hudEl);
      targetContainer.appendChild(hostEl);
    }

    return hudEl;
  }

  function updateHUD() {
    if (isKilled) return;
    const hud = ensureShadowHUD();
    if (!hud) return;

    if (pointA === null && pointB === null) {
      hud.classList.remove('visible');
      removeProgressBarOverlay();
      return;
    }

    hud.classList.add('visible');

    if (badgeEl) {
      badgeEl.textContent = isLooping ? 'LOOP ON' : 'A-B SET';
      badgeEl.classList.toggle('looping', isLooping);
    }

    if (timesEl) {
      timesEl.textContent = `A: ${formatTime(pointA)} | B: ${formatTime(pointB)}`;
    }

    if (counterEl) {
      if (isLooping && loopCount > 0) {
        counterEl.style.display = 'inline-block';
        counterEl.textContent = `${loopCount}x`;
      } else {
        counterEl.style.display = 'none';
      }
    }

    renderProgressBarOverlay();
  }

  function renderProgressBarOverlay() {
    if (isKilled || !video || !video.duration || pointA === null) {
      removeProgressBarOverlay();
      return;
    }

    const progressBar = player ? player.querySelector('.ytp-progress-bar, .ytp-progress-list') : document.querySelector('.ytp-progress-bar');
    if (!progressBar) return;

    if (!rangeOverlayEl) {
      rangeOverlayEl = document.createElement('div');
      rangeOverlayEl.className = 'cineglow-ab-range-overlay';
      rangeOverlayEl.style.position = 'absolute';
      rangeOverlayEl.style.top = '0';
      rangeOverlayEl.style.bottom = '0';
      rangeOverlayEl.style.height = '100%';
      rangeOverlayEl.style.background = isLooping ? 'rgba(0, 230, 118, 0.45)' : 'rgba(255, 0, 85, 0.4)';
      rangeOverlayEl.style.borderLeft = '2px solid #ff0055';
      rangeOverlayEl.style.borderRight = pointB !== null ? '2px solid #00e676' : 'none';
      rangeOverlayEl.style.pointerEvents = 'none';
      rangeOverlayEl.style.zIndex = '35';
      rangeOverlayEl.style.transition = 'background 0.2s ease';
      progressBar.appendChild(rangeOverlayEl);
    }

    const duration = video.duration || 1;
    const leftPct = Math.max(0, Math.min(100, (pointA / duration) * 100));
    const endSec = pointB !== null ? pointB : duration;
    const widthPct = Math.max(0, Math.min(100 - leftPct, ((endSec - pointA) / duration) * 100));

    rangeOverlayEl.style.left = `${leftPct}%`;
    rangeOverlayEl.style.width = `${widthPct}%`;
    rangeOverlayEl.style.background = isLooping ? 'rgba(0, 230, 118, 0.45)' : 'rgba(255, 0, 85, 0.4)';
    rangeOverlayEl.style.borderRight = pointB !== null ? '2px solid #00e676' : 'none';
  }

  function removeProgressBarOverlay() {
    if (rangeOverlayEl) {
      rangeOverlayEl.remove();
      rangeOverlayEl = null;
    }
  }

  function setPointA(timeSec) {
    if (isKilled || !video) return;
    const t = typeof timeSec === 'number' ? timeSec : video.currentTime;
    pointA = Math.max(0, t);
    if (pointB !== null && pointB <= pointA) {
      pointB = null;
    }
    isLooping = (pointA !== null && pointB !== null);
    loopCount = 0;
    updateHUD();
  }

  function setPointB(timeSec) {
    if (isKilled || !video) return;
    const t = typeof timeSec === 'number' ? timeSec : video.currentTime;
    if (pointA === null) {
      pointA = 0;
    }
    if (t > pointA) {
      pointB = t;
      isLooping = true;
      loopCount = 0;
    }
    updateHUD();
  }

  function toggleLoop() {
    if (isKilled) return;
    if (pointA !== null && pointB !== null) {
      isLooping = !isLooping;
      updateHUD();
    } else if (pointA !== null && video) {
      setPointB(video.currentTime);
    }
  }

  function resetLoop() {
    pointA = null;
    pointB = null;
    isLooping = false;
    loopCount = 0;
    updateHUD();
  }

  function onTimeUpdate() {
    if (isKilled || !video || !isLooping || pointA === null || pointB === null) return;
    if (video.currentTime >= pointB) {
      video.currentTime = pointA;
      loopCount++;
      updateHUD();
    }
  }

  function isInputFocused() {
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || el.isContentEditable || el.getAttribute('role') === 'textbox';
  }

  function onKeyDown(e) {
    if (isKilled || isInputFocused() || e.ctrlKey || e.metaKey || e.altKey) return;

    if (e.key === '[') {
      e.preventDefault();
      setPointA();
    } else if (e.key === ']') {
      e.preventDefault();
      setPointB();
    } else if (e.key === '\\') {
      e.preventDefault();
      toggleLoop();
    } else if ((e.key === 'Backspace' || e.key === 'Escape') && (pointA !== null || pointB !== null)) {
      if (e.target && e.target.closest && e.target.closest('#movie_player')) {
        e.preventDefault();
        resetLoop();
      }
    }
  }

  function handlePlayerState(state) {
    if (isKilled) return;
    if (state.video !== video) {
      if (video) {
        video.removeEventListener('timeupdate', onTimeUpdate);
      }
      video = state.video;
      if (video) {
        video.addEventListener('timeupdate', onTimeUpdate);
      }
      resetLoop();
    }
    player = state.player || document.getElementById('movie_player');
    if (!state.isWatchPage) {
      resetLoop();
    }
  }

  function teardownKillSwitch() {
    if (isKilled) return;
    isKilled = true;
    if (video) {
      video.removeEventListener('timeupdate', onTimeUpdate);
    }
    window.removeEventListener('keydown', onKeyDown);
    removeProgressBarOverlay();
    if (hostEl) {
      hostEl.remove();
      hostEl = null;
    }
    shadowRoot = null;
    hudEl = null;
    badgeEl = null;
    timesEl = null;
    counterEl = null;
    toggleBtn = null;
    clearBtn = null;
    video = null;
    player = null;
  }

  // Register listeners
  window.addEventListener('keydown', onKeyDown, { passive: false });

  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage?.addListener) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message && message.type === 'AURA_EMERGENCY_KILL_SWITCH') {
        teardownKillSwitch();
        if (typeof sendResponse === 'function') {
          sendResponse({ success: true, script: 'ab-loop.js' });
        }
      }
    });
  }

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('cineglow:kill-switch', () => {
      teardownKillSwitch();
    }, { once: true });
  }

  window.CineGlowABLoopTeardown = teardownKillSwitch;
  window.CineGlowABLoop = {
    setPointA,
    setPointB,
    toggleLoop,
    resetLoop,
    getState: () => ({ pointA, pointB, isLooping, loopCount }),
    teardown: teardownKillSwitch
  };

  if (window.CineGlowPlayer) {
    window.CineGlowPlayer.addEventListener('state-change', (e) => handlePlayerState(e.detail));
    handlePlayerState(window.CineGlowPlayer);
  } else {
    const v = document.querySelector('video');
    if (v) {
      video = v;
      video.addEventListener('timeupdate', onTimeUpdate);
    }
  }

  // Storage listener for popup integration
  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (isKilled || area !== 'sync') return;
      if (changes.abLoopEnabled) {
        if (!changes.abLoopEnabled.newValue) {
          resetLoop();
        }
      }
    });
  }
})();

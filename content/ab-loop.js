/*
 * CineGlow Pro - Interactive A-B Section Looper (Continuous Segment Repeat)
 * Architecture: Shadow DOM HUD, Precision Loop Boundary Timer, Timeline Overlay
 */
(() => {
  'use strict';

  const lifecycle = new AbortController();
  const { signal } = lifecycle;

  let settings = typeof AURA_DEFAULTS !== 'undefined' ? { ...AURA_DEFAULTS } : { abLoopEnabled: false };
  let video = null;
  let videoAbortController = null;
  let player = null;
  let currentVideoId = null;
  let isKilled = false;

  let pointA = null;
  let pointB = null;
  let isLooping = false;
  let loopCount = 0;
  let loopBoundaryTimer = 0;

  let hostEl = null;
  let shadowRoot = null;
  let hudEl = null;
  let badgeEl = null;
  let timesEl = null;
  let counterEl = null;
  let toggleBtn = null;
  let clearBtn = null;
  let toastEl = null;
  let toastTimer = null;
  let rangeOverlayEl = null;

  function formatTime(seconds) {
    if (seconds === null || isNaN(seconds)) return '--:--';
    const s = Math.floor(seconds);
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  function clearLoopBoundaryTimer() {
    if (loopBoundaryTimer) {
      clearTimeout(loopBoundaryTimer);
      loopBoundaryTimer = 0;
    }
  }

  function scheduleNextLoopCheck() {
    clearLoopBoundaryTimer();
    if (isKilled || !video || !isLooping || pointA === null || pointB === null) return;
    if (video.paused || video.ended || video.seeking) return;

    const remainingSec = pointB - video.currentTime;
    const rate = Math.max(0.1, video.playbackRate || 1);
    const delayMs = remainingSec <= 0
      ? 20
      : Math.max(10, Math.min(30_000, (remainingSec / rate) * 1000));
    loopBoundaryTimer = setTimeout(() => {
      loopBoundaryTimer = 0;
      onTimeUpdate();
    }, delayMs);
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
      hostEl.style.pointerEvents = 'none';

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
          pointer-events: auto;
          align-items: center;
          gap: 8px;
          background: rgba(15, 15, 20, 0.88);
          backdrop-filter: blur(12px);
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
        .cineglow-ab-hud.visible { display: flex; }
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
        .cineglow-ab-badge.looping { background: #00e676; color: #000; }
        .cineglow-ab-times { font-variant-numeric: tabular-nums; color: rgba(255, 255, 255, 0.9); }
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
        .cineglow-ab-btn:hover { color: #fff; background: rgba(255, 255, 255, 0.2); }
        .cineglow-ab-toast {
          display: none;
          position: absolute;
          top: calc(100% + 8px);
          left: 0;
          background: rgba(15, 16, 22, 0.94);
          backdrop-filter: blur(10px);
          border: 1px solid rgba(255, 255, 255, 0.2);
          border-radius: 8px;
          padding: 7px 12px;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          font-size: 11.5px;
          font-weight: 500;
          color: #f8fafc;
          white-space: nowrap;
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
          pointer-events: none;
          z-index: 10001;
        }
        .cineglow-ab-toast.visible { display: block; }
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
      }, { signal });

      clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'cineglow-ab-btn';
      clearBtn.id = 'abClearBtn';
      clearBtn.title = 'Clear Loop (Esc)';
      clearBtn.textContent = '✕';
      clearBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        resetLoop();
      }, { signal });

      hudEl.appendChild(style);
      hudEl.appendChild(badgeEl);
      hudEl.appendChild(timesEl);
      hudEl.appendChild(counterEl);
      hudEl.appendChild(toggleBtn);
      hudEl.appendChild(clearBtn);

      toastEl = document.createElement('div');
      toastEl.className = 'cineglow-ab-toast';
      toastEl.id = 'abToast';

      shadowRoot.appendChild(hudEl);
      shadowRoot.appendChild(toastEl);
      targetContainer.appendChild(hostEl);
    }

    return hudEl;
  }

  function showHUDToast(message, durationMs = 1800) {
    if (isKilled) return;
    ensureShadowHUD();
    if (!shadowRoot) return;

    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'cineglow-ab-toast';
      toastEl.id = 'abToast';
      shadowRoot.appendChild(toastEl);
    }
    toastEl.textContent = message;
    toastEl.classList.add('visible');

    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl?.classList.remove('visible');
    }, durationMs);
  }

  function updateHUD() {
    if (isKilled) return;
    const hud = ensureShadowHUD();
    if (!hud) return;

    if (pointA === null && pointB === null) {
      hud.classList.remove('visible');
      removeProgressBarOverlay();
      clearLoopBoundaryTimer();
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
    scheduleNextLoopCheck();
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
      Object.assign(rangeOverlayEl.style, {
        position: 'absolute',
        top: '0',
        bottom: '0',
        height: '100%',
        borderLeft: '2px solid #ff0055',
        pointerEvents: 'none',
        zIndex: '35',
        transition: 'background 0.2s ease'
      });
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
    isLooping = pointA !== null && pointB !== null;
    loopCount = 0;
    updateHUD();
  }

  function setPointB(timeSec) {
    if (isKilled || !video) return;
    if (pointA === null || pointA === undefined) {
      showHUDToast('Set Point A first ([)');
      return;
    }
    const t = typeof timeSec === 'number' ? timeSec : video.currentTime;
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
    clearLoopBoundaryTimer();
    updateHUD();
  }

  function jumpToLoopStart(resumePlayback = false) {
    if (!video || pointA === null) return;
    video.currentTime = pointA;
    loopCount++;
    updateHUD();
    if (resumePlayback && video.paused) {
      video.play().catch(() => {});
    }
  }

  function onTimeUpdate() {
    if (isKilled || !video || !isLooping || pointA === null || pointB === null) return;
    if (video.seeking || window.CineGlowPlayer?.isAdShowing) return;
    if (video.currentTime >= pointB) {
      jumpToLoopStart(false);
    } else {
      scheduleNextLoopCheck();
    }
  }

  function onVideoEnded() {
    clearLoopBoundaryTimer();
    if (isKilled || !video || !isLooping || pointA === null || pointB === null) return;
    if (Number.isFinite(video.duration) && pointB >= video.duration - 0.35) {
      jumpToLoopStart(true);
    }
  }

  function isInputFocused(e) {
    if (e && typeof e.composedPath === 'function') {
      try {
        for (const node of e.composedPath()) {
          if (!node || (node.nodeType !== undefined && node.nodeType !== 1)) continue;
          const tag = (node.tagName || '').toLowerCase();
          if (tag === 'input' || tag === 'textarea' || node.isContentEditable) return true;
          const role = node.getAttribute?.('role');
          if (role === 'textbox' || role === 'combobox' || role === 'searchbox') return true;
          if (
            tag === 'ytd-commentbox' ||
            tag === 'ytd-searchbox' ||
            tag === 'yt-searchbox' ||
            tag === 'ytd-comment-simplebox-renderer' ||
            tag === 'yt-live-chat-text-input-field-renderer'
          ) {
            return true;
          }
        }
      } catch (_) {}
    }

    let el = document.activeElement;
    while (el?.shadowRoot?.activeElement) {
      el = el.shadowRoot.activeElement;
    }
    if (!el) return false;
    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || el.isContentEditable) return true;
    const role = el.getAttribute?.('role');
    if (role === 'textbox' || role === 'combobox' || role === 'searchbox') return true;
    if (tag === 'ytd-commentbox' || tag === 'ytd-searchbox' || tag === 'yt-searchbox' || tag === 'ytd-comment-simplebox-renderer') {
      return true;
    }
    return Boolean(el.closest?.('ytd-commentbox, ytd-searchbox, yt-searchbox, ytd-comment-simplebox-renderer, #search-form'));
  }

  window.addEventListener('keydown', (e) => {
    if (isKilled || !settings.abLoopEnabled || isInputFocused(e) || e.ctrlKey || e.metaKey || e.altKey) return;

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
      if (e.target?.closest?.('#movie_player')) {
        e.preventDefault();
        resetLoop();
      }
    }
  }, { passive: false, signal });

  function bindVideo(nextVideo) {
    if (video === nextVideo) return;
    if (videoAbortController) {
      videoAbortController.abort();
      videoAbortController = null;
    }
    video = nextVideo;
    if (video) {
      videoAbortController = new AbortController();
      const vSig = videoAbortController.signal;
      video.addEventListener('timeupdate', onTimeUpdate, { passive: true, signal: vSig });
      video.addEventListener('seeked', scheduleNextLoopCheck, { passive: true, signal: vSig });
      video.addEventListener('ratechange', scheduleNextLoopCheck, { passive: true, signal: vSig });
      video.addEventListener('play', scheduleNextLoopCheck, { passive: true, signal: vSig });
      video.addEventListener('playing', scheduleNextLoopCheck, { passive: true, signal: vSig });
      video.addEventListener('pause', clearLoopBoundaryTimer, { passive: true, signal: vSig });
      video.addEventListener('ended', onVideoEnded, { passive: true, signal: vSig });
    }
  }

  function handlePlayerState(state) {
    if (isKilled || !state) return;
    const videoChanged = state.video !== video;
    const videoIdChanged = Boolean(state.videoId && state.videoId !== currentVideoId);

    if (videoChanged) {
      bindVideo(state.video);
    }
    if (videoIdChanged || (videoChanged && !state.videoId)) {
      currentVideoId = state.videoId || null;
      resetLoop();
    }

    player = state.player || document.getElementById('movie_player');
    if (!state.isWatchPage) {
      currentVideoId = null;
      resetLoop();
    }
  }

  const handleStorageChange = (changes, area) => {
    if (isKilled || area !== 'sync') return;
    if (changes.abLoopEnabled) {
      const prevEnabled = Boolean(settings.abLoopEnabled);
      const nextEnabled = Boolean(changes.abLoopEnabled.newValue);
      settings.abLoopEnabled = nextEnabled;
      if (!nextEnabled) {
        resetLoop();
      } else if (!prevEnabled) {
        showHUDToast('A-B Loop ON — [ Set A • ] Set B • \\ Toggle • Esc Clear', 4000);
      }
    }
  };

  function teardownKillSwitch() {
    if (isKilled) return;
    isKilled = true;
    window.CineGlowKilled = true;

    chrome.storage?.onChanged?.removeListener(handleStorageChange);
    clearLoopBoundaryTimer();
    bindVideo(null);
    lifecycle.abort();
    removeProgressBarOverlay();

    hostEl?.remove();
    hostEl = null;
    shadowRoot = null;
    hudEl = null;
    badgeEl = null;
    timesEl = null;
    counterEl = null;
    toggleBtn = null;
    clearBtn = null;

    clearTimeout(toastTimer);
    toastTimer = null;
    toastEl?.remove();
    toastEl = null;
    player = null;
  }

  chrome.runtime?.onMessage?.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'AURA_EMERGENCY_KILL_SWITCH') {
      teardownKillSwitch();
      sendResponse?.({ success: true, script: 'ab-loop.js' });
    }
  });

  window.addEventListener('cineglow:kill-switch', teardownKillSwitch, { once: true });
  window.CineGlowABLoopTeardown = teardownKillSwitch;
  window.CineGlowABLoop = {
    setPointA,
    setPointB,
    toggleLoop,
    resetLoop,
    showHUDToast,
    isInputFocused,
    getSettings: () => settings,
    setSettings: (s) => { Object.assign(settings, s); },
    getState: () => ({ pointA, pointB, isLooping, loopCount }),
    teardown: teardownKillSwitch
  };

  if (window.CineGlowPlayer) {
    window.CineGlowPlayer.addEventListener('state-change', (e) => handlePlayerState(e.detail), { signal });
    handlePlayerState(window.CineGlowPlayer);
  } else {
    const v = document.querySelector('video');
    if (v) bindVideo(v);
  }

  chrome.storage?.sync?.get({ abLoopEnabled: false }).then((items) => {
    if (!isKilled && typeof items?.abLoopEnabled === 'boolean') {
      settings.abLoopEnabled = items.abLoopEnabled;
    }
  }).catch(() => {});

  chrome.storage?.onChanged?.addListener(handleStorageChange);
})();


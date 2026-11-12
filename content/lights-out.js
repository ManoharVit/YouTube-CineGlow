/*
 * CineGlow Pro - Cinema Lights Out & Ambient Focus Dimmer
 * Production Architecture: Dynamic Opacity Dimming, Smart Hover Reveal, Hotkey Toggle (Shift+D)
 */
(() => {
  'use strict';

  let settings = { ...AURA_DEFAULTS };
  let isKilled = false;
  let video = null;
  let isHoverRevealed = false;
  let idleTimeout = null;

  const IDLE_DELAY_MS = 2500;

  function updateLightsOutClasses() {
    if (isKilled) return;
    const isWatch = window.CineGlowPlayer ? window.CineGlowPlayer.isWatchPage : location.pathname === '/watch';
    const isPlaying = video ? (!video.paused && !video.ended) : false;
    const isEnabled = !!settings.lightsOut && isWatch;

    const shouldDim = isEnabled && isPlaying && !isHoverRevealed;

    document.documentElement.classList.toggle('aura-lights-out', isEnabled);
    document.documentElement.classList.toggle('aura-lights-out-active', shouldDim);

    const opacityVal = settings.lightsOutOpacity !== undefined ? Number(settings.lightsOutOpacity) : 85;
    const dimVal = Math.max(0, Math.min(1, (100 - opacityVal) / 100));
    if (document.documentElement.style && document.documentElement.style.setProperty) {
      document.documentElement.style.setProperty('--cineglow-dim-opacity', String(Number(dimVal.toFixed(2))));
    }
  }

  function handleMouseMove(e) {
    if (isKilled || !settings.lightsOut) return;
    
    // Don't reveal if mouse is strictly hovering directly on the video player
    const playerEl = window.CineGlowPlayer?.player || document.getElementById('movie_player');
    const isOverPlayer = playerEl && playerEl.contains(e.target);

    if (!isOverPlayer) {
      if (!isHoverRevealed) {
        isHoverRevealed = true;
        updateLightsOutClasses();
      }
      clearTimeout(idleTimeout);
      idleTimeout = setTimeout(() => {
        isHoverRevealed = false;
        updateLightsOutClasses();
      }, IDLE_DELAY_MS);
    }
  }

  function toggleLightsOut() {
    if (isKilled) return;
    settings.lightsOut = !settings.lightsOut;
    try {
      chrome.storage.sync.set({ lightsOut: settings.lightsOut });
    } catch (_) {}
    updateLightsOutClasses();
  }

  function onKeyDown(e) {
    if (isKilled || e.ctrlKey || e.metaKey || e.altKey) return;
    const el = document.activeElement;
    if (el) {
      const tag = el.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || el.isContentEditable || el.getAttribute('role') === 'textbox') {
        return;
      }
    }

    // Shift + D toggles Lights Out
    if (e.shiftKey && (e.key === 'D' || e.key === 'd')) {
      e.preventDefault();
      toggleLightsOut();
    }
  }

  function handlePlayerState(state) {
    if (isKilled) return;
    if (state.video !== video) {
      if (video) {
        video.removeEventListener('play', updateLightsOutClasses);
        video.removeEventListener('pause', updateLightsOutClasses);
        video.removeEventListener('ended', updateLightsOutClasses);
      }
      video = state.video;
      if (video) {
        video.addEventListener('play', updateLightsOutClasses);
        video.addEventListener('pause', updateLightsOutClasses);
        video.addEventListener('ended', updateLightsOutClasses);
      }
    }
    updateLightsOutClasses();
  }

  function teardownKillSwitch() {
    if (isKilled) return;
    isKilled = true;
    clearTimeout(idleTimeout);
    document.documentElement.classList.remove('aura-lights-out', 'aura-lights-out-active');
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('keydown', onKeyDown);
    if (video) {
      video.removeEventListener('play', updateLightsOutClasses);
      video.removeEventListener('pause', updateLightsOutClasses);
      video.removeEventListener('ended', updateLightsOutClasses);
    }
    video = null;
  }

  // Register Event Handlers
  window.addEventListener('mousemove', handleMouseMove, { passive: true });
  window.addEventListener('keydown', onKeyDown, { passive: false });

  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage?.addListener) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message && message.type === 'AURA_EMERGENCY_KILL_SWITCH') {
        teardownKillSwitch();
        if (typeof sendResponse === 'function') {
          sendResponse({ success: true, script: 'lights-out.js' });
        }
      }
    });
  }

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('cineglow:kill-switch', () => {
      teardownKillSwitch();
    }, { once: true });
  }

  window.CineGlowLightsOutTeardown = teardownKillSwitch;
  window.CineGlowLightsOut = {
    toggle: toggleLightsOut,
    setOpacity: (pct) => {
      settings.lightsOutOpacity = pct;
      updateLightsOutClasses();
    },
    getState: () => ({ enabled: !!settings.lightsOut, isHoverRevealed }),
    teardown: teardownKillSwitch
  };

  if (window.CineGlowPlayer) {
    window.CineGlowPlayer.addEventListener('state-change', (e) => handlePlayerState(e.detail));
    handlePlayerState(window.CineGlowPlayer);
  }

  // Storage integration
  async function loadSettings() {
    if (isKilled) return;
    try {
      const stored = await chrome.storage.sync.get(AURA_DEFAULTS);
      settings = { ...AURA_DEFAULTS, ...stored };
    } catch (_) {}
    updateLightsOutClasses();
  }

  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (isKilled || area !== 'sync') return;
      let changed = false;
      for (const [key, { newValue }] of Object.entries(changes)) {
        if (key in AURA_DEFAULTS) {
          settings[key] = newValue ?? AURA_DEFAULTS[key];
          changed = true;
        }
      }
      if (changed) {
        updateLightsOutClasses();
      }
    });
  }

  loadSettings();
})();

/*
 * CineGlow Pro - Cinema Lights Out & Ambient Focus Dimmer
 * Architecture: Dynamic Opacity Dimming, Smart Hover Reveal, Hotkey Toggle (Shift+D)
 * Author: Giri Manohar Vemula (https://www.linkedin.com/in/manoharv511)
 */
(() => {
  'use strict';

  let settings = { ...(typeof AURA_DEFAULTS !== 'undefined' ? AURA_DEFAULTS : {}) };
  let isKilled = false;
  let video = null;
  let isHoverRevealed = false;
  let idleTimeout = null;
  let lastRevealHeartbeat = 0;

  const IDLE_DELAY_MS = 2500;

  function isWatchPage() {
    return window.CineGlowPlayer ? window.CineGlowPlayer.isWatchPage : location.pathname === '/watch';
  }

  function updateLightsOutClasses() {
    if (isKilled) return;
    const isPlaying = video ? (!video.paused && !video.ended) : false;
    const isEnabled = Boolean(settings.lightsOut) && isWatchPage();
    const shouldDim = isEnabled && isPlaying && !isHoverRevealed;

    document.documentElement.classList.toggle('aura-lights-out', isEnabled);
    document.documentElement.classList.toggle('aura-lights-out-active', shouldDim);

    const opacityVal = settings.lightsOutOpacity !== undefined ? Number(settings.lightsOutOpacity) : 95;
    const dimVal = Math.max(0, Math.min(1, (100 - opacityVal) / 100));
    document.documentElement.style?.setProperty('--cineglow-dim-opacity', String(Number(dimVal.toFixed(2))));
  }

  function handleMouseMove(e) {
    if (isKilled || !settings.lightsOut || !isWatchPage()) return;

    const now = performance.now();
    if (isHoverRevealed && now - lastRevealHeartbeat < 400) return;
    lastRevealHeartbeat = now;

    const playerEl = window.CineGlowPlayer?.player || document.getElementById('movie_player');
    let isOverPlayer = false;
    if (playerEl && e?.target && typeof e.target === 'object') {
      try {
        isOverPlayer = playerEl.contains(e.target);
      } catch (_) {
        isOverPlayer = false;
      }
    }

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
      if (typeof idleTimeout?.unref === 'function') idleTimeout.unref();
    }
  }

  function toggleLightsOut() {
    if (isKilled) return;
    settings.lightsOut = !settings.lightsOut;
    chrome.storage?.sync?.set({ lightsOut: settings.lightsOut }).catch(() => {});
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

    if (e.shiftKey && (e.code === 'KeyD' || e.key === 'D' || e.key === 'd')) {
      if (typeof e.preventDefault === 'function') e.preventDefault();
      toggleLightsOut();
    }
  }

  function handlePlayerState(state) {
    if (isKilled || !state) return;
    if (state.video !== video) {
      if (video) {
        video.removeEventListener('play', updateLightsOutClasses);
        video.removeEventListener('pause', updateLightsOutClasses);
        video.removeEventListener('ended', updateLightsOutClasses);
      }
      video = state.video;
      if (video) {
        video.addEventListener('play', updateLightsOutClasses, { passive: true });
        video.addEventListener('pause', updateLightsOutClasses, { passive: true });
        video.addEventListener('ended', updateLightsOutClasses, { passive: true });
      }
    }
    updateLightsOutClasses();
  }

  const onPlayerStateChange = (e) => handlePlayerState(e?.detail);

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
    if (area !== 'sync') return;
    let changed = false;
    const defaults = typeof AURA_DEFAULTS !== 'undefined' ? AURA_DEFAULTS : {};
    for (const [key, { newValue }] of Object.entries(changes)) {
      if (key in defaults) {
        settings[key] = newValue ?? defaults[key];
        changed = true;
      }
    }
    if (changed) {
      updateLightsOutClasses();
    }
  };
  chrome.storage?.onChanged?.addListener(handleStorageChange);

  function teardownKillSwitch() {
    if (isKilled) return;
    isKilled = true;
    window.CineGlowKilled = true;
    clearTimeout(idleTimeout);

    chrome.storage?.onChanged?.removeListener(handleStorageChange);
    window.CineGlowPlayer?.removeEventListener?.('state-change', onPlayerStateChange);
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('keydown', onKeyDown);

    document.documentElement.classList.remove('aura-lights-out', 'aura-lights-out-active');
    document.documentElement.style?.removeProperty('--cineglow-dim-opacity');

    if (video) {
      video.removeEventListener('play', updateLightsOutClasses);
      video.removeEventListener('pause', updateLightsOutClasses);
      video.removeEventListener('ended', updateLightsOutClasses);
    }
    video = null;
  }

  window.addEventListener('mousemove', handleMouseMove, { passive: true });
  window.addEventListener('keydown', onKeyDown, { passive: false });

  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage?.addListener) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === 'AURA_EMERGENCY_KILL_SWITCH') {
        teardownKillSwitch();
        if (typeof sendResponse === 'function') {
          sendResponse({ success: true, script: 'lights-out.js' });
        }
      }
    });
  }

  window.addEventListener('cineglow:kill-switch', () => {
    teardownKillSwitch();
  }, { once: true });

  window.CineGlowLightsOutTeardown = teardownKillSwitch;
  window.CineGlowLightsOut = {
    toggle: toggleLightsOut,
    setOpacity: (pct) => {
      settings.lightsOutOpacity = pct;
      updateLightsOutClasses();
    },
    getState: () => ({ enabled: Boolean(settings.lightsOut), isHoverRevealed }),
    teardown: teardownKillSwitch
  };

  if (window.CineGlowPlayer) {
    window.CineGlowPlayer.addEventListener('state-change', onPlayerStateChange);
    handlePlayerState(window.CineGlowPlayer);
  }

  async function loadSettings() {
    if (isKilled) return;
    const defaults = typeof AURA_DEFAULTS !== 'undefined' ? AURA_DEFAULTS : {};
    try {
      const [local, managed, stored] = await Promise.all([
        chrome.storage?.local?.get(['auraKillSwitchActive']).catch(() => ({})),
        chrome.storage?.managed?.get(['KillSwitch']).catch(() => ({})),
        chrome.storage?.sync?.get(defaults).catch(() => ({}))
      ]);
      if (local?.auraKillSwitchActive || managed?.KillSwitch) {
        teardownKillSwitch();
        return;
      }
      settings = { ...defaults, ...stored };
    } catch (_) {}
    updateLightsOutClasses();
  }

  loadSettings();
})();

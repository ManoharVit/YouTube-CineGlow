// Auto-HD Quality Controller for YouTube
(() => {
  'use strict';

  const defaultQualityEnabled = (typeof AURA_DEFAULTS !== 'undefined' && AURA_DEFAULTS.qualityEnabled !== undefined)
    ? AURA_DEFAULTS.qualityEnabled
    : true;
  const defaultPreferredQuality = (typeof AURA_DEFAULTS !== 'undefined' && AURA_DEFAULTS.preferredQuality !== undefined)
    ? AURA_DEFAULTS.preferredQuality
    : 'hd1080';

  let settings = {
    qualityEnabled: defaultQualityEnabled,
    preferredQuality: defaultPreferredQuality
  };

  let forcedQualityPolicy = null;
  let isKilled = false;
  let applyTimer = null;
  let followUpTimer = null;
  let lastAppliedKey = '';

  async function loadSettings() {
    if (isKilled || window.CineGlowKilled) return;
    try {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        const [local, managed, stored] = await Promise.all([
          chrome.storage.local?.get(['auraKillSwitchActive']).catch(() => ({})),
          chrome.storage.managed?.get(['ForceDefaultQuality', 'KillSwitch']).catch(() => ({})),
          chrome.storage.sync?.get({
            qualityEnabled: defaultQualityEnabled,
            preferredQuality: defaultPreferredQuality
          }).catch(() => ({}))
        ]);

        if (local?.auraKillSwitchActive || managed?.KillSwitch) {
          teardownKillSwitch();
          return;
        }
        if (managed?.ForceDefaultQuality) {
          forcedQualityPolicy = managed.ForceDefaultQuality;
        }
        if (stored?.qualityEnabled !== undefined) {
          settings.qualityEnabled = stored.qualityEnabled;
        }
        if (stored?.preferredQuality !== undefined) {
          settings.preferredQuality = stored.preferredQuality;
        }
      }
    } catch (err) {
      console.warn('[Aura Quality] Could not load settings:', err);
    }

    if (forcedQualityPolicy) {
      settings.preferredQuality = forcedQualityPolicy;
      settings.qualityEnabled = true;
    }
  }

  const handleStorageChange = (changes, area) => {
    if (isKilled || window.CineGlowKilled) return;
    if (area === 'managed') {
      if ('ForceDefaultQuality' in changes) {
        forcedQualityPolicy = changes.ForceDefaultQuality.newValue || null;
        if (forcedQualityPolicy) {
          settings.preferredQuality = forcedQualityPolicy;
          settings.qualityEnabled = true;
          lastAppliedKey = '';
          applyQuality(true);
        }
      }
      if (changes.KillSwitch?.newValue === true) {
        teardownKillSwitch();
      }
    }
    if (area === 'local' && changes.auraKillSwitchActive?.newValue === true) {
      teardownKillSwitch();
    }
    if (area === 'sync') {
      if (changes.qualityEnabled) settings.qualityEnabled = changes.qualityEnabled.newValue;
      if (changes.preferredQuality) {
        settings.preferredQuality = forcedQualityPolicy || changes.preferredQuality.newValue;
      }
      if (settings.qualityEnabled) {
        lastAppliedKey = '';
        applyQuality(true);
      }
    }
  };
  chrome.storage?.onChanged?.addListener(handleStorageChange);

  function applyQuality(force = false) {
    if (isKilled || window.CineGlowKilled) return;
    if (!settings.qualityEnabled || !settings.preferredQuality) return;

    const state = window.CineGlowPlayer;
    if (state && (!state.isWatchPage || !state.video || state.isAdShowing)) return;

    const applyKey = `${state?.videoId || 'unknown'}:${settings.preferredQuality}`;
    if (!force && applyKey === lastAppliedKey) return;
    lastAppliedKey = applyKey;

    try {
      const now = Date.now();
      const ytQualityObj = {
        data: JSON.stringify({
          quality: settings.preferredQuality,
          previousQuality: 'auto'
        }),
        expiration: now + 30 * 24 * 60 * 60 * 1000,
        creation: now
      };
      window.localStorage.setItem('yt-player-quality', JSON.stringify(ytQualityObj));
    } catch (_) {}

    window.postMessage({
      type: 'AURA_SET_QUALITY',
      quality: settings.preferredQuality
    }, window.location.origin);
  }

  function scheduleApplyQuality(delay = 350) {
    clearTimeout(applyTimer);
    clearTimeout(followUpTimer);
    const runWhenReady = () => {
      const state = window.CineGlowPlayer;
      const v = state?.video;
      if (v && v.readyState !== undefined && v.readyState < 2) {
        const onReady = () => applyQuality(true);
        v.addEventListener('canplay', onReady, { once: true, passive: true });
        return;
      }
      applyQuality(true);
    };
    applyTimer = setTimeout(() => {
      runWhenReady();
      followUpTimer = setTimeout(() => applyQuality(true), 1200);
      if (followUpTimer && typeof followUpTimer.unref === 'function') {
        followUpTimer.unref();
      }
    }, delay);
    if (applyTimer && typeof applyTimer.unref === 'function') {
      applyTimer.unref();
    }
  }

  let lastVideo = null;
  let lastVideoId = null;
  let wasAdShowing = false;

  const onPlayerStateChange = (e) => {
    if (isKilled || window.CineGlowKilled) return;
    const state = e?.detail;
    if (!state) return;
    const adJustEnded = wasAdShowing && !state.isAdShowing;
    wasAdShowing = Boolean(state.isAdShowing);

    if (state.video !== lastVideo || state.videoId !== lastVideoId || adJustEnded) {
      lastVideo = state.video;
      lastVideoId = state.videoId;
      lastAppliedKey = '';
      if (state.isWatchPage && state.video && !state.isAdShowing) {
        scheduleApplyQuality(350);
      }
    }
  };

  if (window.CineGlowPlayer) {
    window.CineGlowPlayer.addEventListener('state-change', onPlayerStateChange);
  }

  function teardownKillSwitch() {
    if (isKilled) return;
    isKilled = true;
    settings.qualityEnabled = false;
    window.CineGlowKilled = true;
    clearTimeout(applyTimer);
    clearTimeout(followUpTimer);
    chrome.storage?.onChanged?.removeListener(handleStorageChange);
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
          sendResponse({ success: true, script: 'youtube-quality.js' });
        }
      }
    });
  }

  window.addEventListener('cineglow:kill-switch', () => {
    teardownKillSwitch();
  }, { once: true });

  window.CineGlowQuality = {
    settings,
    loadSettings,
    applyQuality: () => applyQuality(true),
    teardownKillSwitch,
    isForcedByPolicy: () => !!forcedQualityPolicy
  };

  loadSettings().then(() => {
    applyQuality(true);
  });
})();

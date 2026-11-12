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

  async function loadSettings() {
    if (isKilled || (typeof window !== 'undefined' && window.CineGlowKilled)) return;
    try {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        if (chrome.storage.local) {
          const local = await chrome.storage.local.get(['auraKillSwitchActive']).catch(() => ({}));
          if (local && local.auraKillSwitchActive) {
            teardownKillSwitch();
            return;
          }
        }
        if (chrome.storage.managed) {
          const managed = await chrome.storage.managed.get(['ForceDefaultQuality', 'KillSwitch']).catch(() => ({}));
          if (managed) {
            if (managed.KillSwitch) {
              teardownKillSwitch();
              return;
            }
            if (managed.ForceDefaultQuality) {
              forcedQualityPolicy = managed.ForceDefaultQuality;
            }
          }
        }
        if (chrome.storage.sync) {
          const stored = await chrome.storage.sync.get({
            qualityEnabled: defaultQualityEnabled,
            preferredQuality: defaultPreferredQuality
          });
          if (stored && stored.qualityEnabled !== undefined) {
            settings.qualityEnabled = stored.qualityEnabled;
          }
          if (stored && stored.preferredQuality !== undefined) {
            settings.preferredQuality = stored.preferredQuality;
          }
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

  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (isKilled || (typeof window !== 'undefined' && window.CineGlowKilled)) return;
      if (area === 'managed') {
        if ('ForceDefaultQuality' in changes) {
          forcedQualityPolicy = changes.ForceDefaultQuality.newValue || null;
          if (forcedQualityPolicy) {
            settings.preferredQuality = forcedQualityPolicy;
            settings.qualityEnabled = true;
            applyQuality();
          }
        }
        if ('KillSwitch' in changes && changes.KillSwitch.newValue === true) {
          teardownKillSwitch();
        }
      }
      if (area === 'local' && changes.auraKillSwitchActive && changes.auraKillSwitchActive.newValue === true) {
        teardownKillSwitch();
      }
      if (area === 'sync') {
        if (changes.qualityEnabled) settings.qualityEnabled = changes.qualityEnabled.newValue;
        if (changes.preferredQuality) {
          if (forcedQualityPolicy) {
            settings.preferredQuality = forcedQualityPolicy;
          } else {
            settings.preferredQuality = changes.preferredQuality.newValue;
          }
        }
        if (settings.qualityEnabled) {
          applyQuality();
        }
      }
    });
  }

  function teardownKillSwitch() {
    if (isKilled) return;
    isKilled = true;
    settings.qualityEnabled = false;
    if (typeof window !== 'undefined') window.CineGlowKilled = true;
  }

  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage?.addListener) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message && message.type === 'AURA_EMERGENCY_KILL_SWITCH') {
        teardownKillSwitch();
        if (typeof window !== 'undefined' && !window._cineglowKillEventFired) {
          window._cineglowKillEventFired = true;
          window.dispatchEvent(new CustomEvent('cineglow:kill-switch', { detail: message }));
        }
        if (typeof sendResponse === 'function') {
          sendResponse({ success: true, script: 'youtube-quality.js' });
        }
      }
    });
  }

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('cineglow:kill-switch', () => {
      teardownKillSwitch();
    }, { once: true });
  }

  // The main world script (content/main-world.js) is injected by manifest.json
  // and listens for the 'AURA_SET_QUALITY' message.

  function applyQuality() {
    if (isKilled || (typeof window !== 'undefined' && window.CineGlowKilled)) return;
    if (!settings.qualityEnabled || !settings.preferredQuality) return;
    
    // 1. Set YouTube's internal localStorage preference. 
    // This is the most reliable way to force quality, as YouTube reads this on load.
    try {
      const now = Date.now();
      const ytQualityObj = {
        data: JSON.stringify({
          quality: settings.preferredQuality,
          previousQuality: "auto"
        }),
        expiration: now + (30 * 24 * 60 * 60 * 1000), // 30 days
        creation: now
      };
      window.localStorage.setItem('yt-player-quality', JSON.stringify(ytQualityObj));
    } catch (err) {
      console.warn('[Aura Quality] Could not set localStorage:', err);
    }

    // 2. The main world script is already running, just send message to force it immediately via API
    window.postMessage({
      type: 'AURA_SET_QUALITY',
      quality: settings.preferredQuality
    }, window.location.origin);
  }

  let lastVideo = null;
  let lastVideoId = null;
  if (window.CineGlowPlayer) {
    window.CineGlowPlayer.addEventListener('state-change', (e) => {
      if (isKilled || (typeof window !== 'undefined' && window.CineGlowKilled)) return;
      const state = e.detail;
      if (state.video !== lastVideo || state.videoId !== lastVideoId) {
        lastVideo = state.video;
        lastVideoId = state.videoId;
        if (state.isWatchPage && state.video) {
          setTimeout(applyQuality, 500);
        }
      }
    });
  }

  window.CineGlowQuality = {
    settings,
    loadSettings,
    applyQuality,
    teardownKillSwitch,
    isForcedByPolicy: () => !!forcedQualityPolicy
  };

  // Initial load
  loadSettings().then(() => {
    applyQuality();
  });

})();

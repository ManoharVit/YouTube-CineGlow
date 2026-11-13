// Runs in the MAIN world at document_start to safely bypass CSP restrictions
(() => {
  'use strict';

  let isKilled = false;
  let adBlockEnabled = true;
  let mainWorldAdInterval = null;
  let adMutationObserver = null;
  let preAdSpeed = 1.0;
  let preferredPlaybackSpeed = 1.0;
  let adMuted = false;
  let isSkippingMainWorld = false;
  let lastMainWorldSkipClickTime = 0;
  let origJSONParse = null;
  let origFetch = null;
  let origOpen = null;
  let origSend = null;
  let origFnToString = null;

  try {
    if (typeof Function !== 'undefined' && Function.prototype && Function.prototype.toString) {
      origFnToString = Function.prototype.toString;
      const customFnToString = function toString() {
        if (this === JSON.parse && origJSONParse) return origJSONParse.toString();
        if (typeof window !== 'undefined' && this === window.fetch && origFetch) return origFetch.toString();
        if (typeof XMLHttpRequest !== 'undefined') {
          if (this === XMLHttpRequest.prototype.open && origOpen) return origOpen.toString();
          if (this === XMLHttpRequest.prototype.send && origSend) return origSend.toString();
        }
        return origFnToString.apply(this, arguments);
      };
      Function.prototype.toString = customFnToString;
    }
  } catch (_) {}

  const MAIN_SKIP_BUTTON_SELECTOR = [
    '.ytp-ad-skip-button-modern',
    '.ytp-ad-skip-button',
    '.ytp-skip-ad-button',
    '.ytp-ad-skip-button-slot button',
    '[id^="skip-button:"] button',
    'button.ytp-ad-skip-button-modern',
    '.ytp-ad-skip-button-container button',
    'button[aria-label*="Skip"]',
    '.ytp-ad-overlay-close-button'
  ].join(', ');

  // --- Phase 1: Stub YouTube Ad Globals BEFORE any YouTube code runs ---
  // This must happen at the very top, before document_start scripts parse

  // 1A. Stub googletag (GPT ad library) safely
  try {
    if (typeof window !== 'undefined') {
      let gTag = { cmd: [] };
      Object.defineProperty(window, 'googletag', {
        configurable: true,
        enumerable: false,
        get: () => gTag,
        set: (v) => { if (v && typeof v === 'object') gTag = v; }
      });
    }
  } catch (_) {}

  // 1B. Stub ytAds / yt.ads so the ad module thinks ads are unavailable
  try {
    if (typeof window !== 'undefined') {
      Object.defineProperty(window, 'ytAds', {
        configurable: true,
        enumerable: false,
        get: () => undefined,
        set: () => {}
      });
    }
  } catch (_) {}

  // 1C. Force adBlocksFound to always return 0 (anti-adblock evasion)
  try {
    if (typeof window !== 'undefined') {
      Object.defineProperty(window, 'adBlocksFound', {
        configurable: true,
        enumerable: false,
        get: () => 0,
        set: () => {}
      });
      window.yt = window.yt || {};
      Object.defineProperty(window.yt, 'adBlocksFound', {
        configurable: true,
        enumerable: false,
        get: () => 0,
        set: () => {}
      });
    }
  } catch (_) {}

  // 1D. Force hasAllowedInstreamAd to true (bypass ad requirement checks)
  try {
    if (typeof window !== 'undefined') {
      Object.defineProperty(window, 'hasAllowedInstreamAd', {
        configurable: true,
        enumerable: false,
        get: () => true,
        set: () => {}
      });
      window.yt = window.yt || {};
      Object.defineProperty(window.yt, 'hasAllowedInstreamAd', {
        configurable: true,
        enumerable: false,
        get: () => true,
        set: () => {}
      });
    }
  } catch (_) {}

  // --- Phase 2: Deep Player Response Pruning ---
  // Comprehensive list of ALL ad-related keys in YouTube player responses
  const AD_KEYS_TO_DELETE = [
    'adPlacements', 'playerAds', 'adSlots', 'adBreakHeartbeatParams',
    'adSlotRenderer', 'companionSlot', 'adBreakParams',
    'adsEngagementPanelConfig', 'adModule',
    'actionCompanionAdRenderer', 'adBreakServiceRenderer',
    'adHoverTextButtonRenderer', 'adInfoDialogRenderer',
    'adLayoutLoggingData', 'adPlacementConfig',
    'inPlayerAdSlotRenderer', 'instreamAdBreak',
    'linkedPlayerBytesAdLayoutRenderer', 'playerBytesAdLayoutRenderer',
    'instreamVideoAdRenderer', 'linearAdSequenceRenderer',
    'adInfoRenderer', 'promotedSparklesWebRenderer',
    'adFeedbackRenderer', 'adSurveyRenderer',
    'playerLegacyDesktopWatchAdsRenderer',
    'desktopWatchAdsRenderer',
    'bannerPromoRenderer',
    'cards',
    'cardCollectionRenderer',
    'cardsRenderer'
  ];

  function prunePlayerAds(data) {
    if (!data || typeof data !== 'object') return data;
    try {
      for (const key of AD_KEYS_TO_DELETE) {
        if (key in data) {
          if (Array.isArray(data[key])) {
            data[key] = [];
          } else {
            delete data[key];
          }
        }
      }

      // Deep prune nested player responses
      if (data.playerResponse && typeof data.playerResponse === 'object') {
        prunePlayerAds(data.playerResponse);
      }
      if (data.raw_player_response && typeof data.raw_player_response === 'object') {
        prunePlayerAds(data.raw_player_response);
      }

      // Prune ad config from playerConfig
      if (data.playerConfig) {
        if (data.playerConfig.adConfig) delete data.playerConfig.adConfig;
        if (data.playerConfig.adsConfig) delete data.playerConfig.adsConfig;
      }

      // Preserve data.attestation: required by YouTube Web-Environment-Integrity for chunk stream playback

      // Prune overlay/engagement ad renderers from response
      if (data.overlay && data.overlay.playerOverlayRenderer) {
        const ovr = data.overlay.playerOverlayRenderer;
        if (ovr.decoratedPlayerBarRenderer) {
          const dpbr = ovr.decoratedPlayerBarRenderer.decoratedPlayerBarRenderer;
          if (dpbr && dpbr.playerBar) {
            // Remove ad markers from progress bar
            const pb = dpbr.playerBar.multiMarkersPlayerBarRenderer || dpbr.playerBar.chapteredPlayerBarRenderer;
            if (pb && pb.adBreakMarkerRenderer) delete pb.adBreakMarkerRenderer;
          }
        }
      }

      // Prune engagementPanels with ad content
      if (Array.isArray(data.engagementPanels)) {
        data.engagementPanels = data.engagementPanels.filter(
          p => !p?.engagementPanelSectionListRenderer?.targetId?.includes('ads')
        );
      }

    } catch (_) {}
    return data;
  }

  // --- Phase 3: Global JSON.parse Hook (Core Technique) ---
  try {
    if (typeof JSON !== 'undefined' && typeof JSON.parse === 'function') {
      origJSONParse = JSON.parse;
      JSON.parse = function parse(...args) {
        if (isKilled && origJSONParse) {
          return origJSONParse.apply(this, args);
        }
        const result = origJSONParse.apply(this, args);
        if (result && typeof result === 'object') {
          prunePlayerAds(result);
        }
        return result;
      };
    }
  } catch (_) {}

  // --- Phase 4: Intercept and Sanitize YouTube Global Config Objects ---
  try {
    if (typeof window !== 'undefined') {
      // 4A. ytInitialPlayerResponse
      let _rawInitial = window.ytInitialPlayerResponse;
      if (_rawInitial) prunePlayerAds(_rawInitial);
      Object.defineProperty(window, 'ytInitialPlayerResponse', {
        configurable: true,
        enumerable: true,
        get: () => _rawInitial,
        set: (val) => { _rawInitial = prunePlayerAds(val); }
      });

      // 4B. ytInitialData
      let _rawInitialData = window.ytInitialData;
      if (_rawInitialData) prunePlayerAds(_rawInitialData);
      Object.defineProperty(window, 'ytInitialData', {
        configurable: true,
        enumerable: true,
        get: () => _rawInitialData,
        set: (val) => { _rawInitialData = prunePlayerAds(val); }
      });

      // 4C. ytplayer
      let _rawYtPlayer = window.ytplayer;
      if (_rawYtPlayer && _rawYtPlayer.config && _rawYtPlayer.config.args) {
        prunePlayerAds(_rawYtPlayer.config.args.raw_player_response);
        prunePlayerAds(_rawYtPlayer.config.args);
      }
      Object.defineProperty(window, 'ytplayer', {
        configurable: true,
        enumerable: true,
        get: () => _rawYtPlayer,
        set: (val) => {
          if (val && val.config && val.config.args) {
            prunePlayerAds(val.config.args.raw_player_response);
            prunePlayerAds(val.config.args);
            // Null out the ad module reference
            if (val.config.args.ad3_module) val.config.args.ad3_module = null;
            if (val.config.args.ad_pings) val.config.args.ad_pings = null;
          }
          _rawYtPlayer = val;
        }
      });

      // 4D. Neutralize yt.config_ anti-adblock popup
      const neutralizeYtConfig = () => {
        try {
          if (window.yt && window.yt.config_) {
            if (window.yt.config_.openPopupConfig &&
                window.yt.config_.openPopupConfig.supportedPopups) {
              window.yt.config_.openPopupConfig.supportedPopups.adBlockMessageViewModel = false;
              window.yt.config_.openPopupConfig.supportedPopups.adBlockMessageViewModelOld = false;
            }
            // Disable ad-block experiment flags
            if (window.yt.config_.EXPERIMENT_FLAGS) {
              const flags = window.yt.config_.EXPERIMENT_FLAGS;
              flags.web_gel_timeout_cap = false;
              flags.web_display_mode = undefined;
              flags.ab_det_el_h = false;
              flags.ab_det_gen_re = false;
            }
          }
        } catch (_) {}
      };

      // Try immediately and also on a timer (yt.config_ loads async)
      neutralizeYtConfig();
      setTimeout(neutralizeYtConfig, 500);
      setTimeout(neutralizeYtConfig, 1500);
      setTimeout(neutralizeYtConfig, 3000);
    }
  } catch (_) {}

  // --- Phase 5: Comprehensive Network Interception ---

  // 5A. URLs to block entirely (return empty response)
  const BLOCK_URL_PATTERNS = [
    '/youtubei/v1/player/ad_break',
    '/ptracking',
    '/api/stats/ads',
    '/pagead/',
    '/pcs/activeview',
    'doubleclick.net',
    'googlesyndication.com',
  ];

  // 5B. URLs whose responses need ad data stripped
  const PRUNE_URL_PATTERNS = [
    '/youtubei/v1/player',
    '/youtubei/v1/next',
    '/youtubei/v1/browse',
  ];

  function shouldBlockUrl(url) {
    if (!adBlockEnabled) return false;
    return BLOCK_URL_PATTERNS.some(p => url.includes(p));
  }

  function shouldPruneUrl(url) {
    if (!adBlockEnabled) return false;
    // Must check block first — don't prune what we block
    return !shouldBlockUrl(url) && PRUNE_URL_PATTERNS.some(p => url.includes(p));
  }

  // 5C. Intercept window.fetch
  if (typeof window !== 'undefined' && typeof window.fetch === 'function' && typeof Response !== 'undefined') {
    origFetch = window.fetch;
    window.fetch = async function fetch(...args) {
      if (isKilled && origFetch) {
        return origFetch.apply(this, args);
      }
      try {
        const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');

        // Block ad-related fetches entirely
        if (shouldBlockUrl(url)) {
          return new Response('{}', {
            status: 200,
            statusText: 'OK',
            headers: { 'Content-Type': 'application/json' }
          });
        }
      } catch (_) {}

      const response = await origFetch.apply(this, args);

      try {
        const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
        if (shouldPruneUrl(url)) {
          const clone = response.clone();
          const text = await clone.text();
          try {
            const json = JSON.parse(text);
            if (json && typeof json === 'object') {
              prunePlayerAds(json);
              return new Response(JSON.stringify(json), {
                status: response.status,
                statusText: response.statusText,
                headers: response.headers
              });
            }
          } catch (_) {
            // Not JSON, return original
          }
        }
      } catch (_) {}
      return response;
    };
  }

  // 5D. Intercept XMLHttpRequest
  if (typeof window !== 'undefined' && typeof window.XMLHttpRequest !== 'undefined') {
    origOpen = XMLHttpRequest.prototype.open;
    origSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function open(method, url, ...rest) {
      if (isKilled && origOpen) {
        return origOpen.call(this, method, url, ...rest);
      }
      this._cineglowUrl = typeof url === 'string' ? url : String(url);
      return origOpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function send(...args) {
      if (isKilled && origSend) {
        return origSend.apply(this, args);
      }
      if (this._cineglowUrl && shouldBlockUrl(this._cineglowUrl)) {
        try {
          Object.defineProperty(this, 'responseText', { value: '{}', writable: false, configurable: true });
          Object.defineProperty(this, 'response', { value: '{}', writable: false, configurable: true });
          Object.defineProperty(this, 'status', { value: 200, writable: false, configurable: true });
          Object.defineProperty(this, 'readyState', { value: 4, writable: false, configurable: true });
          setTimeout(() => {
            this.dispatchEvent(new Event('readystatechange'));
            this.dispatchEvent(new Event('load'));
          }, 0);
          return;
        } catch (_) {}
      }
      return origSend.apply(this, args);
    };
  }

  // --- Phase 6: Zero-Latency Main-World Ad Skipping ---
  function skipMainWorldAd() {
    if (isKilled) return;
    if (!adBlockEnabled) return;
    if (isSkippingMainWorld) return;
    isSkippingMainWorld = true;

    try {
      const player = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
      const isAd = !!(
        player && (
          player.classList.contains('ad-showing') ||
          player.classList.contains('ad-interrupting')
        )
      ) || (() => {
        const skipBtn = document.querySelector(MAIN_SKIP_BUTTON_SELECTOR);
        return !!(skipBtn && (skipBtn.offsetParent !== null || skipBtn.offsetWidth > 0 || (skipBtn.getClientRects && skipBtn.getClientRects().length > 0)));
      })();

      if (isAd) {
        // A. Try YouTube internal skipAd() method
        if (player && typeof player.skipAd === 'function') {
          try { player.skipAd(); } catch (_) {}
        }

        // B. Fast-forward and mute HTML5 video
        const video = (player && player.querySelector('video')) || document.querySelector('video.html5-main-video') || document.querySelector('video');
        if (video) {
          if (!adMuted) {
            if (video.playbackRate > 0 && video.playbackRate !== 16.0) {
              preAdSpeed = video.playbackRate;
            }
            if (!video.muted) {
              video.muted = true;
              adMuted = true;
            }
          }
          video.playbackRate = 16.0;
        }

        // C. Click the active skip button
        const now = Date.now();
        if (now - lastMainWorldSkipClickTime > 150) {
          let btn = document.querySelector(MAIN_SKIP_BUTTON_SELECTOR);
          if (btn) {
            lastMainWorldSkipClickTime = now;
            try {
              if (btn.tagName !== 'BUTTON' && typeof btn.querySelector === 'function') {
                const childBtn = btn.querySelector('button, [role="button"]');
                if (childBtn) childBtn.click();
              }
              btn.click();
            } catch (_) {}
          }
        }

        // D. Force-remove ad overlay and info card elements from DOM
        try {
          const overlays = document.querySelectorAll(
            '.ytp-ad-player-overlay, .ytp-ad-player-overlay-layout, ' +
            '.ytp-ad-player-overlay-instream-info, .ytp-ad-message-container, ' +
            '.ytp-ad-overlay-container, .ytp-ad-survey, .ytp-ad-preview-container, ' +
            '.ytp-cards-button, .ytp-cards-button-icon, .ytp-cards-teaser'
          );
          overlays.forEach(el => {
            el.style.display = 'none';
            try { el.remove(); } catch (_) {}
          });
        } catch (_) {}

      } else {
        // Ad finished — restore audio and playback rate
        const video = (player && player.querySelector('video')) || document.querySelector('video.html5-main-video') || document.querySelector('video');
        if (video) {
          if (adMuted) {
            video.muted = false;
            adMuted = false;
          }
          if (video.playbackRate === 16.0) {
            video.playbackRate = preferredPlaybackSpeed || preAdSpeed || 1.0;
          }
        }
      }
    } catch (_) {
    } finally {
      isSkippingMainWorld = false;
    }
  }

  // Active continuous monitoring loop (50ms interval for maximum responsiveness)
  if (typeof window !== 'undefined') {
    mainWorldAdInterval = setInterval(skipMainWorldAd, 50);
    if (mainWorldAdInterval && typeof mainWorldAdInterval === 'object' && typeof mainWorldAdInterval.unref === 'function') {
      mainWorldAdInterval.unref();
    }
  }

  // Zero-latency MutationObserver targeting class changes on player
  if (typeof document !== 'undefined' && typeof MutationObserver !== 'undefined') {
    adMutationObserver = new MutationObserver(() => {
      skipMainWorldAd();
    });
    const attachObserver = () => {
      const p = document.getElementById('movie_player') || document.querySelector('.html5-video-player') || document.documentElement;
      if (p) {
        adMutationObserver.observe(p, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
      }
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', attachObserver, { once: true });
    } else {
      attachObserver();
    }
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('yt-action', skipMainWorldAd, { passive: true });
    document.addEventListener('yt-navigate-finish', skipMainWorldAd, { passive: true });
  }

  function handleForceSkipMessage(event) {
    if (isKilled) return;
    if (event.source === window && event.data?.type === 'CINEGLOW_FORCE_SKIP_AD') {
      skipMainWorldAd();
    }
  }

  function handleAdBlockStateMessage(event) {
    if (isKilled) return;
    if (event.source !== window) return;
    if (event.data?.type === 'CINEGLOW_SET_ADBLOCK_STATE') {
      const enabled = event.data?.enabled !== undefined
        ? event.data.enabled
        : (event.data?.payload?.enabled !== undefined ? event.data.payload.enabled : true);
      adBlockEnabled = Boolean(enabled);
      if (!adBlockEnabled) {
        try {
          const player = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
          const video = (player && player.querySelector('video')) || document.querySelector('video.html5-main-video') || document.querySelector('video');
          if (video) {
            if (adMuted) {
              video.muted = false;
              adMuted = false;
            }
            if (video.playbackRate === 16.0) {
              video.playbackRate = preferredPlaybackSpeed || preAdSpeed || 1.0;
            }
          }
        } catch (_) {}
      }
    }
  }

  function handlePreferredSpeedMessage(event) {
    if (isKilled) return;
    if (event.source !== window) return;
    if (event.data?.type === 'CINEGLOW_SET_PREFERRED_SPEED') {
      const speed = event.data?.speed;
      if (typeof speed === 'number' && speed > 0 && speed <= 15) {
        preferredPlaybackSpeed = speed;
        preAdSpeed = speed;
      }
    }
  }

  function handleKillSwitchMessage(event) {
    if (event.source === window && event.data?.type === 'AURA_EMERGENCY_KILL_SWITCH') {
      teardownMainWorld();
    }
  }

  // --- Existing Non-Ad Features (Quality, Stats, Theater) ---

  function handleQualityMessage(event) {
    if (isKilled) return;
    if (event.source !== window || event.origin !== window.location.origin || event.data?.type !== 'AURA_SET_QUALITY') return;
    let quality = event.data.quality;
    const player = document.getElementById('movie_player');

    if (player && typeof player.setPlaybackQualityRange === 'function') {
      try {
        if (quality === 'highres' && typeof player.getAvailableQualityLevels === 'function') {
          const levels = player.getAvailableQualityLevels();
          const best = levels.find(q => q !== 'auto' && q !== 'highres');
          if (best) quality = best;
        }
        player.setPlaybackQualityRange(quality, quality);
        if (typeof player.setPlaybackQuality === 'function') {
          player.setPlaybackQuality(quality);
        }
      } catch (err) {
        console.error('[Aura Main World] Quality setting error:', err);
      }
    }
  }

  function handleStatsMessage(event) {
    if (isKilled) return;
    if (event.source !== window || event.origin !== window.location.origin || event.data?.type !== 'CINEGLOW_GET_STATS_NERDS') return;
    try {
      const player = document.getElementById('movie_player');
      let stats = null;
      if (player && typeof player.getStatsForNerds === 'function') {
        const s = player.getStatsForNerds();
        if (s) {
          stats = {};
          for (const k in s) {
            const v = s[k];
            if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
              stats[k] = v;
            }
          }
        }
      }

      if (stats && player) {
        try {
          const resp = typeof player.getPlayerResponse === 'function' ? player.getPlayerResponse() : window.ytInitialPlayerResponse;
          const adaptive = resp && resp.streamingData && resp.streamingData.adaptiveFormats;
          if (Array.isArray(adaptive)) {
            let itag = null;
            if (stats.codecs) {
              const m = String(stats.codecs).match(/\((\d+)\)/);
              if (m) itag = m[1];
            }
            if (!itag && stats.fmt) itag = String(stats.fmt);
            if (itag) {
              const fmt = adaptive.find(f => String(f.itag) === String(itag));
              if (fmt) {
                stats.videoBitrate = fmt.bitrate || fmt.averageBitrate || null;
                stats.averageBitrate = fmt.averageBitrate || null;
                stats.formatQuality = fmt.qualityLabel || null;
                stats.colorInfo = fmt.colorInfo || null;
              }
            }
          }
        } catch (_) {}
      }

      window.postMessage({
        type: 'CINEGLOW_STATS_NERDS_RESPONSE',
        stats: stats
      }, window.location.origin);
    } catch (_) {}
  }

  function syncTheaterState() {
    if (isKilled) return;
    try {
      const watchFlexy = document.querySelector('ytd-watch-flexy, ytd-watch-grid');
      const isTheater = !!(
        watchFlexy && (
          watchFlexy.hasAttribute('theater') ||
          watchFlexy.hasAttribute('theater-requested_') ||
          watchFlexy.theater ||
          watchFlexy.theaterRequested_
        )
      );
      if (document.documentElement) {
        if (isTheater) {
          document.documentElement.setAttribute('data-cineglow-theater', 'true');
        } else {
          document.documentElement.removeAttribute('data-cineglow-theater');
        }
      }
    } catch (_) {}
  }

  function handleKeydown(e) {
    if (e.key === 't' || e.key === 'T') {
      setTimeout(syncTheaterState, 80);
      setTimeout(syncTheaterState, 350);
    }
  }

  function teardownMainWorld() {
    if (isKilled) return;
    isKilled = true;
    if (mainWorldAdInterval) {
      clearInterval(mainWorldAdInterval);
      mainWorldAdInterval = null;
    }
    if (adMutationObserver) {
      adMutationObserver.disconnect();
      adMutationObserver = null;
    }

    // Restore video playback/audio state if killed during an active ad
    try {
      const player = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
      const video = (player && player.querySelector('video')) || document.querySelector('video.html5-main-video') || document.querySelector('video');
      if (video) {
        if (adMuted) {
          video.muted = false;
          adMuted = false;
        }
        if (video.playbackRate === 16.0) {
          video.playbackRate = preferredPlaybackSpeed || preAdSpeed || 1.0;
        }
      }
    } catch (_) {}

    // Restore native prototypes and functions
    if (origFetch && typeof window !== 'undefined') {
      try { window.fetch = origFetch; } catch (_) {}
    }
    if (origOpen && typeof XMLHttpRequest !== 'undefined') {
      try { XMLHttpRequest.prototype.open = origOpen; } catch (_) {}
    }
    if (origSend && typeof XMLHttpRequest !== 'undefined') {
      try { XMLHttpRequest.prototype.send = origSend; } catch (_) {}
    }
    if (origJSONParse && typeof JSON !== 'undefined') {
      try { JSON.parse = origJSONParse; } catch (_) {}
    }
    if (origFnToString && typeof Function !== 'undefined' && Function.prototype) {
      try { Function.prototype.toString = origFnToString; } catch (_) {}
    }

    window.removeEventListener('message', handleQualityMessage);
    window.removeEventListener('message', handleStatsMessage);
    window.removeEventListener('message', handleForceSkipMessage);
    window.removeEventListener('message', handleAdBlockStateMessage);
    window.removeEventListener('message', handlePreferredSpeedMessage);
    window.removeEventListener('message', handleKillSwitchMessage);
    window.removeEventListener('keydown', handleKeydown);
    document.removeEventListener('yt-action', syncTheaterState);
    document.removeEventListener('yt-navigate-finish', syncTheaterState);
    document.removeEventListener('yt-action', skipMainWorldAd);
    document.removeEventListener('yt-navigate-finish', skipMainWorldAd);
  }

  window.addEventListener('message', handleQualityMessage);
  window.addEventListener('message', handleStatsMessage);
  window.addEventListener('message', handleForceSkipMessage);
  window.addEventListener('message', handleAdBlockStateMessage);
  window.addEventListener('message', handlePreferredSpeedMessage);
  window.addEventListener('message', handleKillSwitchMessage);
  document.addEventListener('yt-action', syncTheaterState, { passive: true });
  document.addEventListener('yt-navigate-finish', syncTheaterState, { passive: true });
  window.addEventListener('keydown', handleKeydown, { passive: true });

  window.addEventListener('cineglow:kill-switch', () => {
    teardownMainWorld();
  }, { once: true });
})();

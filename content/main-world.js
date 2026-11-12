// Runs in the MAIN world at document_start to safely bypass CSP restrictions
(() => {
  'use strict';

  let isKilled = false;
  let mainWorldAdInterval = null;
  let adMutationObserver = null;
  let preAdSpeed = 1.0;
  let adMuted = false;
  let isSkippingMainWorld = false;
  let lastMainWorldSkipClickTime = 0;

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

  // --- Brave Shields / uBlock-style In-Page YouTube In-Stream Ad Neutralization ---
  function prunePlayerAds(data) {
    if (!data || typeof data !== 'object') return data;
    try {
      if ('adPlacements' in data) delete data.adPlacements;
      if ('playerAds' in data) delete data.playerAds;
      if ('adSlots' in data) delete data.adSlots;
      if ('adBreakHeartbeatParams' in data) delete data.adBreakHeartbeatParams;
      if (Array.isArray(data.playerAds)) data.playerAds = [];
      if (Array.isArray(data.adPlacements)) data.adPlacements = [];
      if (Array.isArray(data.adSlots)) data.adSlots = [];
      if (data.playerResponse && typeof data.playerResponse === 'object') {
        prunePlayerAds(data.playerResponse);
      }
      if (data.raw_player_response && typeof data.raw_player_response === 'object') {
        prunePlayerAds(data.raw_player_response);
      }
      if (data.adSlotRenderer) delete data.adSlotRenderer;
      if (data.companionSlot) delete data.companionSlot;
    } catch (_) {}
    return data;
  }

  // Intercept JSON.parse globally in MAIN world (Brave Shields / uBlock core technique)
  try {
    if (typeof JSON !== 'undefined' && typeof JSON.parse === 'function') {
      const origJSONParse = JSON.parse;
      JSON.parse = function(...args) {
        const result = origJSONParse.apply(this, args);
        if (result && typeof result === 'object') {
          prunePlayerAds(result);
        }
        return result;
      };
    }
  } catch (_) {}

  // 1. Intercept and sanitize window.ytInitialPlayerResponse, ytInitialData, and ytplayer before YouTube player initializes
  try {
    if (typeof window !== 'undefined') {
      let _rawInitial = window.ytInitialPlayerResponse;
      if (_rawInitial) {
        prunePlayerAds(_rawInitial);
      }
      Object.defineProperty(window, 'ytInitialPlayerResponse', {
        configurable: true,
        enumerable: true,
        get: () => _rawInitial,
        set: (val) => {
          _rawInitial = prunePlayerAds(val);
        }
      });

      let _rawInitialData = window.ytInitialData;
      if (_rawInitialData) {
        prunePlayerAds(_rawInitialData);
      }
      Object.defineProperty(window, 'ytInitialData', {
        configurable: true,
        enumerable: true,
        get: () => _rawInitialData,
        set: (val) => {
          _rawInitialData = prunePlayerAds(val);
        }
      });

      let _rawYtPlayer = window.ytplayer;
      if (_rawYtPlayer && _rawYtPlayer.config && _rawYtPlayer.config.args) {
        prunePlayerAds(_rawYtPlayer.config.args.raw_player_response);
      }
      Object.defineProperty(window, 'ytplayer', {
        configurable: true,
        enumerable: true,
        get: () => _rawYtPlayer,
        set: (val) => {
          if (val && val.config && val.config.args) {
            prunePlayerAds(val.config.args.raw_player_response);
          }
          _rawYtPlayer = val;
        }
      });
    }
  } catch (_) {}

  // 2. Intercept window.fetch for /youtubei/v1/player and /ad_break to strip ads before the player receives payload
  if (typeof window !== 'undefined' && typeof window.fetch === 'function' && typeof Response !== 'undefined') {
    const origFetch = window.fetch;
    window.fetch = async function(...args) {
      try {
        const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
        if (url.includes('/youtubei/v1/player/ad_break')) {
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
        if (url.includes('/youtubei/v1/player')) {
          const clone = response.clone();
          const json = await clone.json();
          if (json && typeof json === 'object') {
            prunePlayerAds(json);
            return new Response(JSON.stringify(json), {
              status: response.status,
              statusText: response.statusText,
              headers: response.headers
            });
          }
        }
      } catch (_) {}
      return response;
    };
  }

  // 3. Intercept XMLHttpRequest for YouTube ad requests
  if (typeof window !== 'undefined' && typeof window.XMLHttpRequest !== 'undefined') {
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
      this._cineglowUrl = typeof url === 'string' ? url : String(url);
      return origOpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function(...args) {
      if (this._cineglowUrl && this._cineglowUrl.includes('/youtubei/v1/player/ad_break')) {
        try {
          Object.defineProperty(this, 'responseText', { value: '{}', writable: false });
          Object.defineProperty(this, 'response', { value: '{}', writable: false });
          Object.defineProperty(this, 'status', { value: 200, writable: false });
          Object.defineProperty(this, 'readyState', { value: 4, writable: false });
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

  // 4. Zero-Latency Main-World Ad Skipping via Direct Player API & Instant Acceleration
  function skipMainWorldAd() {
    if (isKilled) return;
    if (isSkippingMainWorld) return;
    isSkippingMainWorld = true;

    try {
      const player = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
      const isAd = !!(
        player && (
          player.classList.contains('ad-showing') ||
          player.classList.contains('ad-interrupting')
        )
      ) || !!document.querySelector('.ytp-ad-player-overlay, .ytp-ad-skip-button-slot, .ytp-ad-skip-button-modern, .ytp-skip-ad-button, .ytp-ad-player-overlay-layout');

      if (isAd) {
        // A. Call YouTube's own internal player skipAd() method in MAIN world (bypasses isTrusted checks)
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
          if (isFinite(video.duration) && video.duration > 0.1) {
            video.currentTime = video.duration - 0.1;
          } else {
            video.currentTime = 999999;
          }
        }

        // C. Click the active skip button (resolving to child button if container element is matched)
        const now = Date.now();
        if (now - lastMainWorldSkipClickTime > 200) {
          let btn = document.querySelector(MAIN_SKIP_BUTTON_SELECTOR);
          if (btn && btn.tagName !== 'BUTTON' && typeof btn.querySelector === 'function') {
            const childBtn = btn.querySelector('button, [role="button"]');
            if (childBtn) btn = childBtn;
          }
          if (btn) {
            lastMainWorldSkipClickTime = now;
            try {
              btn.click();
            } catch (_) {}
          }
        }
      } else {
        // Ad finished — restore audio and playback rate
        const video = (player && player.querySelector('video')) || document.querySelector('video.html5-main-video') || document.querySelector('video');
        if (video) {
          if (adMuted) {
            video.muted = false;
            adMuted = false;
          }
          if (video.playbackRate === 16.0) {
            video.playbackRate = preAdSpeed || 1.0;
          }
        }
      }
    } catch (_) {
    } finally {
      isSkippingMainWorld = false;
    }
  }

  // Active continuous monitoring loop (100ms interval for immediate responsiveness)
  if (typeof window !== 'undefined') {
    mainWorldAdInterval = setInterval(skipMainWorldAd, 100);
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

  window.addEventListener('message', (event) => {
    if (event.source === window && event.data?.type === 'CINEGLOW_FORCE_SKIP_AD') {
      skipMainWorldAd();
    }
  });

  function handleQualityMessage(event) {
    if (isKilled) return;
    if (event.source !== window || event.origin !== window.location.origin || event.data?.type !== 'AURA_SET_QUALITY') return;
    let quality = event.data.quality;
    const player = document.getElementById('movie_player');
    
    if (player && typeof player.setPlaybackQualityRange === 'function') {
      try {
        // If "highres" is selected, dynamically find the actual highest available quality
        if (quality === 'highres' && typeof player.getAvailableQualityLevels === 'function') {
          const levels = player.getAvailableQualityLevels();
          // levels are usually sorted highest to lowest (e.g., ['hd2160', 'hd1080', 'hd720', 'large', 'medium', 'small', 'tiny', 'auto'])
          const best = levels.find(q => q !== 'auto' && q !== 'highres');
          if (best) {
            quality = best;
          }
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

      // Extract encoded video stream bitrate and quality from streamingData
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
        } catch (e) {}
      }

      window.postMessage({
        type: 'CINEGLOW_STATS_NERDS_RESPONSE',
        stats: stats
      }, window.location.origin);
    } catch (e) {}
  }

  function syncTheaterState() {
    if (isKilled) return;
    try {
      const watchFlexy = document.querySelector('ytd-watch-flexy, ytd-watch-grid');
      const isTheater = !!(
        watchFlexy && (
          watchFlexy.theater ||
          watchFlexy.theaterRequested_ ||
          watchFlexy.hasAttribute('theater') ||
          watchFlexy.hasAttribute('full-bleed-player')
        )
      );
      if (document.documentElement) {
        if (isTheater) {
          document.documentElement.setAttribute('data-cineglow-theater', 'true');
        } else if (!document.documentElement.classList.contains('aura-in-theater')) {
          document.documentElement.removeAttribute('data-cineglow-theater');
        }
      }
    } catch (_) {}
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
    window.removeEventListener('message', handleQualityMessage);
    window.removeEventListener('message', handleStatsMessage);
    document.removeEventListener('yt-action', syncTheaterState);
    document.removeEventListener('yt-navigate-finish', syncTheaterState);
    document.removeEventListener('yt-action', skipMainWorldAd);
    document.removeEventListener('yt-navigate-finish', skipMainWorldAd);
  }

  window.addEventListener('message', handleQualityMessage);
  window.addEventListener('message', handleStatsMessage);
  document.addEventListener('yt-action', syncTheaterState, { passive: true });
  document.addEventListener('yt-navigate-finish', syncTheaterState, { passive: true });
  window.addEventListener('keydown', (e) => {
    if (e.key === 't' || e.key === 'T') {
      setTimeout(syncTheaterState, 80);
      setTimeout(syncTheaterState, 350);
    }
  }, { passive: true });

  window.addEventListener('cineglow:kill-switch', () => {
    teardownMainWorld();
  }, { once: true });

  window.addEventListener('message', (event) => {
    if (event.source === window && event.data?.type === 'AURA_EMERGENCY_KILL_SWITCH') {
      teardownMainWorld();
    }
  });
})();

// Runs in the MAIN world at document_start to safely bypass CSP restrictions
(() => {
  'use strict';

  let isKilled = false;

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
    } catch (_) {}
    return data;
  }

  // 1. Intercept and sanitize window.ytInitialPlayerResponse before YouTube player initializes
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
    }
  } catch (_) {}

  // 2. Intercept window.fetch for /youtubei/v1/player to strip ads before the player receives payload
  if (typeof window !== 'undefined' && typeof window.fetch === 'function' && typeof Response !== 'undefined') {
    const origFetch = window.fetch;
    window.fetch = async function(...args) {
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

  // 3. Instant Main-World Ad-Skip Fallback via HTML5 Player API
  function skipMainWorldAd() {
    if (isKilled) return;
    try {
      const player = document.getElementById('movie_player');
      if (player && (player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting'))) {
        if (typeof player.skipAd === 'function') {
          player.skipAd();
        }
        const video = player.querySelector('video.html5-main-video') || document.querySelector('video.html5-main-video');
        if (video) {
          video.muted = true;
          video.playbackRate = 16.0;
          if (!isNaN(video.duration) && video.duration > 0 && isFinite(video.duration)) {
            video.currentTime = video.duration;
          }
        }
      }
    } catch (_) {}
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('yt-action', skipMainWorldAd, { passive: true });
  }

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
    window.removeEventListener('message', handleQualityMessage);
    window.removeEventListener('message', handleStatsMessage);
    document.removeEventListener('yt-action', syncTheaterState);
    document.removeEventListener('yt-navigate-finish', syncTheaterState);
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

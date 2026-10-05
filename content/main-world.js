// Runs in the MAIN world at document_start to safely bypass CSP restrictions
(() => {
  'use strict';

  // --- 1. Codec Blocker ---
  try {
    const raw = window.localStorage.getItem('__aura_settings');
    if (raw) {
      const settings = JSON.parse(raw);
      function shouldBlock(type) {
        if (!type) return false;
        const t = type.toLowerCase();
        if (settings.blockAV1 && t.includes('av01')) return true;
        if (settings.blockVP9 && (t.includes('vp9') || t.includes('vp09'))) return true;
        if (settings.block60fps && (t.includes('framerate=60') || t.includes('framerate=50'))) return true;
        return false;
      }
      
      if (settings.blockAV1 || settings.blockVP9 || settings.block60fps) {
        if (window.MediaSource && typeof window.MediaSource.isTypeSupported === 'function') {
          const originalIsTypeSupported = window.MediaSource.isTypeSupported;
          window.MediaSource.isTypeSupported = function(type) {
            if (shouldBlock(type)) return false;
            return originalIsTypeSupported.call(this, type);
          };
        }
        if (window.HTMLMediaElement && typeof window.HTMLMediaElement.prototype.canPlayType === 'function') {
          const originalCanPlayType = window.HTMLMediaElement.prototype.canPlayType;
          window.HTMLMediaElement.prototype.canPlayType = function(type) {
            if (shouldBlock(type)) return '';
            return originalCanPlayType.call(this, type);
          };
        }
      }
    }
  } catch(e) {
    console.error('[Aura Main World] Codec blocker error:', e);
  }

  // --- 2. Quality Controller API Interceptor ---
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.data.type !== 'AURA_SET_QUALITY') return;
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
  });
})();

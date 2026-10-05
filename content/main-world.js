// Runs in the MAIN world at document_start to safely bypass CSP restrictions
(() => {
  'use strict';

  // Codec Blocker moved to codec-blocker.js

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

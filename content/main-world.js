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

  // --- 3. Format Extractor for Download ---
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.data.type !== 'CINEGLOW_GET_DOWNLOAD_FORMAT') return;
    try {
      let formats = null;
      const player = document.getElementById('movie_player');
      let streamingData = null;

      if (player && typeof player.getPlayerResponse === 'function') {
        const response = player.getPlayerResponse();
        if (response && response.streamingData) {
          streamingData = response.streamingData;
        }
      }
      
      // Fallback to ytInitialPlayerResponse
      if (!streamingData && window.ytInitialPlayerResponse && window.ytInitialPlayerResponse.streamingData) {
        streamingData = window.ytInitialPlayerResponse.streamingData;
      }

      if (streamingData) {
        if (Array.isArray(streamingData.formats) && streamingData.formats.length > 0) {
          formats = streamingData.formats;
        } else if (Array.isArray(streamingData.adaptiveFormats)) {
          // If progressive formats are absent, extract mp4 video formats from adaptiveFormats
          const mp4Formats = streamingData.adaptiveFormats.filter(f => f.mimeType && f.mimeType.includes('video/mp4'));
          formats = mp4Formats.length > 0 ? mp4Formats : streamingData.adaptiveFormats;
        }
      }

      window.postMessage({
        type: 'CINEGLOW_DOWNLOAD_FORMAT_RESPONSE',
        formats: formats
      }, '*');
    } catch(err) {
      console.error('[Aura Main World] Format extraction error:', err);
    }
  });

  // --- 4. Stats for Nerds / Codec Info Extractor ---
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.data.type !== 'CINEGLOW_GET_STATS_NERDS') return;
    try {
      const player = document.getElementById('movie_player');
      let stats = null;
      if (player && typeof player.getStatsForNerds === 'function') {
        const s = player.getStatsForNerds();
        if (s) {
          stats = {
            codecs: s.codecs || '',
            resolution: s.resolution || '',
            color: s.color || '',
            optimal_format: s.optimal_format || '',
            fmt: s.fmt || ''
          };
        }
      }
      window.postMessage({
        type: 'CINEGLOW_STATS_NERDS_RESPONSE',
        stats: stats
      }, '*');
    } catch (e) {}
  });
})();

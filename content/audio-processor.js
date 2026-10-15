(() => {
  'use strict';

  let settings = { audioNormalizer: false, audioBoost: 100, audioReactive: false };
  let audioCtx = null;
  let source = null;
  let compressor = null;
  let gainNode = null;
  let analyser = null;
  let dataArray = null;
  let currentVideo = null;

  async function loadSettings() {
    try {
      const stored = await chrome.storage.sync.get(['audioNormalizer', 'audioBoost', 'audioReactive']);
      if (stored.audioNormalizer !== undefined) settings.audioNormalizer = stored.audioNormalizer;
      if (stored.audioBoost !== undefined) settings.audioBoost = stored.audioBoost;
      if (stored.audioReactive !== undefined) settings.audioReactive = stored.audioReactive;
    } catch (err) {
      console.warn('[CineGlow Audio] Could not load settings:', err);
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync') {
      let changed = false;
      if (changes.audioNormalizer) {
        settings.audioNormalizer = changes.audioNormalizer.newValue;
        changed = true;
      }
      if (changes.audioBoost) {
        settings.audioBoost = changes.audioBoost.newValue;
        changed = true;
      }
      if (changes.audioReactive) {
        settings.audioReactive = changes.audioReactive.newValue;
        changed = true;
      }
      if (changed) {
        updateRouting();
      }
    }
  });

  function initAudio(video) {
    if (!video || video.cineGlowAudioAttached) return;
    
    try {
      if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        compressor = audioCtx.createDynamicsCompressor();
        
        compressor.threshold.value = -24; 
        compressor.knee.value = 30;       
        compressor.ratio.value = 12;      
        compressor.attack.value = 0.003;  
        compressor.release.value = 0.25;  
        
        gainNode = audioCtx.createGain();
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 1024;
        const bufferLength = analyser.frequencyBinCount;
        dataArray = new Uint8Array(bufferLength);
        
        window.CineGlowAudioAnalyser = analyser;
        window.CineGlowAudioDataArray = dataArray;
      }

      if (source) {
        source.disconnect();
      }
      
      source = audioCtx.createMediaElementSource(video);
      
      currentVideo = video;
      video.cineGlowAudioAttached = true;
      
      // Auto-resume AudioContext on playback to bypass browser autoplay policies
      const tryResume = () => {
        if (audioCtx && audioCtx.state === 'suspended') {
          audioCtx.resume();
        }
      };
      video.addEventListener('play', tryResume);
      // If the video is already playing but audio context is suspended, we need user interaction
      window.addEventListener('click', tryResume, { passive: true });
      window.addEventListener('keydown', tryResume, { passive: true });
      if (!video.paused) tryResume();
      
      updateRouting();
    } catch (err) {
      console.error('[CineGlow Audio] Failed to initialize AudioContext:', err);
    }
  }

  function updateRouting() {
    if (!source || !audioCtx) return;

    // Disconnect everything first to avoid duplicate connections
    source.disconnect();
    compressor.disconnect();
    gainNode.disconnect();
    analyser.disconnect();

    if (settings.audioNormalizer) {
      // Route: Source -> Compressor -> Gain -> Destination
      source.connect(compressor);
      compressor.connect(gainNode);
    } else {
      // Route: Source -> Gain -> Destination
      source.connect(gainNode);
    }
    
    // Always connect to analyser for beat detection
    gainNode.connect(analyser);
    analyser.connect(audioCtx.destination);
    
    // Apply volume boost (100% = 1.0, 200% = 2.0, etc.)
    gainNode.gain.value = Math.max(1, settings.audioBoost) / 100;
  }

  // Hook into the central player manager to find the video element
  function attachToPlayer() {
    if (window.CineGlowPlayer && window.CineGlowPlayer.video) {
      initAudio(window.CineGlowPlayer.video);
    }
  }

  if (window.CineGlowPlayer) {
    window.CineGlowPlayer.addEventListener('state-change', attachToPlayer);
    attachToPlayer();
  } else {
    // Fallback if player manager hasn't initialized yet
    window.addEventListener('load', () => {
      if (window.CineGlowPlayer) attachToPlayer();
    });
  }

  loadSettings();
})();

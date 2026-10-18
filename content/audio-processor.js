(() => {
  'use strict';

  let settings = {
    audioNormalizer: false,
    audioBoost: 100,
    bassBoost: 0,
    vocalBoost: 0,
    eq60: 0,
    eq250: 0,
    eq1000: 0,
    eq4000: 0,
    eq12000: 0,
    audioReactive: false
  };

  let audioCtx = null;
  let source = null;
  let normalizerGain = null;
  let compressor = null;
  let compressedGain = null;
  let bassFilter = null;
  let vocalFilter = null;
  let eqFilter60 = null;
  let eqFilter250 = null;
  let eqFilter1000 = null;
  let eqFilter4000 = null;
  let eqFilter12000 = null;
  let gainNode = null;
  let limiterNode = null;
  let analyser = null;
  let dataArray = null;
  let currentVideo = null;

  async function loadSettings() {
    try {
      const keys = ['audioNormalizer', 'audioBoost', 'bassBoost', 'vocalBoost', 'eq60', 'eq250', 'eq1000', 'eq4000', 'eq12000', 'audioReactive'];
      const stored = await chrome.storage.sync.get(keys);
      for (const k of keys) {
        if (stored[k] !== undefined) settings[k] = stored[k];
      }
      updateAudioParams();
    } catch (err) {
      console.warn('[CineGlow Audio] Could not load settings:', err);
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync') {
      let changed = false;
      const keys = ['audioNormalizer', 'audioBoost', 'bassBoost', 'vocalBoost', 'eq60', 'eq250', 'eq1000', 'eq4000', 'eq12000', 'audioReactive'];
      for (const k of keys) {
        if (changes[k] !== undefined) {
          settings[k] = changes[k].newValue;
          changed = true;
        }
      }
      if (changed) {
        updateAudioParams();
      }
    }
  });

  function initAudio(video) {
    if (!video || video.cineGlowAudioAttached) return;
    
    try {
      if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        
        // 1. Normalizer (Compressor + Dry/Wet Crossfader)
        compressor = audioCtx.createDynamicsCompressor();
        compressor.threshold.value = -24; 
        compressor.knee.value = 30;       
        compressor.ratio.value = 12;      
        compressor.attack.value = 0.003;  
        compressor.release.value = 0.25;  

        normalizerGain = audioCtx.createGain(); // Dry path (when normalizer is OFF)
        compressedGain = audioCtx.createGain(); // Wet path (when normalizer is ON)

        // 2. Dedicated Bass Booster (80 Hz Low-Shelf)
        bassFilter = audioCtx.createBiquadFilter();
        bassFilter.type = 'lowshelf';
        bassFilter.frequency.value = 80;
        bassFilter.gain.value = Number(settings.bassBoost) || 0;

        // 3. Voice / Vocal Booster (2500 Hz Peaking Filter, Q=1.2)
        vocalFilter = audioCtx.createBiquadFilter();
        vocalFilter.type = 'peaking';
        vocalFilter.frequency.value = 2500;
        vocalFilter.Q.value = 1.2;
        vocalFilter.gain.value = Number(settings.vocalBoost) || 0;

        // 4. 5-Band Music Equalizer Filters
        // Band 1: 60 Hz Sub-Bass (Low-shelf)
        eqFilter60 = audioCtx.createBiquadFilter();
        eqFilter60.type = 'lowshelf';
        eqFilter60.frequency.value = 60;
        eqFilter60.gain.value = Number(settings.eq60) || 0;

        // Band 2: 250 Hz Low-Mid (Peaking)
        eqFilter250 = audioCtx.createBiquadFilter();
        eqFilter250.type = 'peaking';
        eqFilter250.frequency.value = 250;
        eqFilter250.Q.value = 1.4;
        eqFilter250.gain.value = Number(settings.eq250) || 0;

        // Band 3: 1 kHz Midrange (Peaking)
        eqFilter1000 = audioCtx.createBiquadFilter();
        eqFilter1000.type = 'peaking';
        eqFilter1000.frequency.value = 1000;
        eqFilter1000.Q.value = 1.4;
        eqFilter1000.gain.value = Number(settings.eq1000) || 0;

        // Band 4: 4 kHz High-Mid / Presence (Peaking)
        eqFilter4000 = audioCtx.createBiquadFilter();
        eqFilter4000.type = 'peaking';
        eqFilter4000.frequency.value = 4000;
        eqFilter4000.Q.value = 1.4;
        eqFilter4000.gain.value = Number(settings.eq4000) || 0;

        // Band 5: 12 kHz Treble / Air (High-shelf)
        eqFilter12000 = audioCtx.createBiquadFilter();
        eqFilter12000.type = 'highshelf';
        eqFilter12000.frequency.value = 12000;
        eqFilter12000.gain.value = Number(settings.eq12000) || 0;

        // 5. Volume Boost Gain Node
        gainNode = audioCtx.createGain();
        gainNode.gain.value = Math.max(1, Number(settings.audioBoost) || 100) / 100;

        // 6. Safety Brickwall Limiter (prevents digital clipping on heavy bass/volume boost)
        limiterNode = audioCtx.createDynamicsCompressor();
        limiterNode.threshold.value = -1.0;
        limiterNode.knee.value = 0;
        limiterNode.ratio.value = 20;
        limiterNode.attack.value = 0.001;
        limiterNode.release.value = 0.05;

        // 7. Analyser Node for Ambient Light Beat Reactive Glow
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 1024;
        const bufferLength = analyser.frequencyBinCount;
        dataArray = new Uint8Array(bufferLength);
        
        window.CineGlowAudioAnalyser = analyser;
        window.CineGlowAudioDataArray = dataArray;
        window.CineGlowAudioCtx = audioCtx;
        window.CineGlowAudioGainNode = gainNode;

        // --- Wire Node Connections ---
        // Normalizer bypass routing
        compressor.connect(compressedGain);

        // Connect both dry and wet paths into the Bass Booster
        normalizerGain.connect(bassFilter);
        compressedGain.connect(bassFilter);

        // DSP Filter Chain in Series
        bassFilter.connect(vocalFilter);
        vocalFilter.connect(eqFilter60);
        eqFilter60.connect(eqFilter250);
        eqFilter250.connect(eqFilter1000);
        eqFilter1000.connect(eqFilter4000);
        eqFilter4000.connect(eqFilter12000);

        // Connect EQ into Volume Gain, then through Limiter to Analyser & Destination
        eqFilter12000.connect(gainNode);
        gainNode.connect(limiterNode);
        limiterNode.connect(analyser);
        analyser.connect(audioCtx.destination);
      }

      if (source) {
        source.disconnect();
      }
      
      source = audioCtx.createMediaElementSource(video);
      source.connect(normalizerGain);
      source.connect(compressor);
      
      currentVideo = video;
      video.cineGlowAudioAttached = true;
      
      // Auto-resume AudioContext on playback to comply with autoplay policy
      const tryResume = () => {
        if (audioCtx && audioCtx.state === 'suspended') {
          audioCtx.resume();
        }
      };
      video.addEventListener('play', tryResume);
      window.addEventListener('click', tryResume, { passive: true });
      window.addEventListener('keydown', tryResume, { passive: true });
      if (!video.paused) tryResume();
      
      updateAudioParams();
    } catch (err) {
      console.error('[CineGlow Audio] Failed to initialize AudioContext:', err);
    }
  }

  function updateAudioParams() {
    if (!audioCtx) return;
    const t = audioCtx.currentTime;

    // 1. Normalizer Crossfade
    if (normalizerGain && compressedGain) {
      const normOn = !!settings.audioNormalizer;
      normalizerGain.gain.setTargetAtTime(normOn ? 0 : 1, t, 0.02);
      compressedGain.gain.setTargetAtTime(normOn ? 1 : 0, t, 0.02);
    }

    // 2. Extra Volume Boost (100% = 1.0, 200% = 2.0, 300% = 3.0)
    if (gainNode) {
      const vol = Math.max(1, Number(settings.audioBoost) || 100) / 100;
      gainNode.gain.setTargetAtTime(vol, t, 0.02);
    }

    // 3. Dedicated Bass Booster (0 to +15 dB)
    if (bassFilter) {
      const bass = Math.max(0, Math.min(15, Number(settings.bassBoost) || 0));
      bassFilter.gain.setTargetAtTime(bass, t, 0.02);
    }

    // 4. Voice / Vocal Booster (0 to +12 dB)
    if (vocalFilter) {
      const vocal = Math.max(0, Math.min(12, Number(settings.vocalBoost) || 0));
      vocalFilter.gain.setTargetAtTime(vocal, t, 0.02);
    }

    // 5. 5-Band Music Equalizer (-12 to +12 dB each)
    if (eqFilter60) eqFilter60.gain.setTargetAtTime(Number(settings.eq60) || 0, t, 0.02);
    if (eqFilter250) eqFilter250.gain.setTargetAtTime(Number(settings.eq250) || 0, t, 0.02);
    if (eqFilter1000) eqFilter1000.gain.setTargetAtTime(Number(settings.eq1000) || 0, t, 0.02);
    if (eqFilter4000) eqFilter4000.gain.setTargetAtTime(Number(settings.eq4000) || 0, t, 0.02);
    if (eqFilter12000) eqFilter12000.gain.setTargetAtTime(Number(settings.eq12000) || 0, t, 0.02);
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
    window.addEventListener('load', () => {
      if (window.CineGlowPlayer) attachToPlayer();
    });
  }

  loadSettings();
})();

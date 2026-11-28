(() => {
  'use strict';

  const defaults = (typeof AURA_DEFAULTS !== 'undefined' ? AURA_DEFAULTS : (typeof window !== 'undefined' && window.AURA_DEFAULTS) || (typeof globalThis !== 'undefined' && globalThis.AURA_DEFAULTS)) || {};
  let settings = {
    audioNormalizer: defaults.audioNormalizer || false,
    audioBoost: defaults.audioBoost !== undefined ? defaults.audioBoost : 100,
    bassBoost: defaults.bassBoost || 0,
    vocalBoost: defaults.vocalBoost || 0,
    eq60: defaults.eq60 || 0,
    eq250: defaults.eq250 || 0,
    eq1000: defaults.eq1000 || 0,
    eq4000: defaults.eq4000 || 0,
    eq12000: defaults.eq12000 || 0,
    audioReactive: defaults.audioReactive || false
  };

  let audioCtx = null;
  let source = null;
  let sourceUsesDsp = false;
  let normalizerGain = null;
  let compressor = null;
  let makeupGainNode = null;
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
  const videoSources = new WeakMap();
  let isKilled = false;
  let onUserInteractionResume = null;
  let onVideoPlaybackResume = null;
  let boundResumeVideo = null;

  const AUDIO_KEYS = [
    'audioNormalizer', 'audioBoost', 'bassBoost', 'vocalBoost',
    'eq60', 'eq250', 'eq1000', 'eq4000', 'eq12000', 'audioReactive'
  ];

  function isDspEnabled() {
    const boost = Number(settings.audioBoost);
    const hasVolumeBoost = Number.isFinite(boost) && boost !== 100 && boost >= 0;
    const hasNormalizer = Boolean(settings.audioNormalizer);
    const hasBassBoost = Number(settings.bassBoost) !== 0;
    const hasVocalBoost = Number(settings.vocalBoost) !== 0;
    const hasEq = (
      Number(settings.eq60) !== 0 ||
      Number(settings.eq250) !== 0 ||
      Number(settings.eq1000) !== 0 ||
      Number(settings.eq4000) !== 0 ||
      Number(settings.eq12000) !== 0
    );
    return hasNormalizer || hasVolumeBoost || hasBassBoost || hasVocalBoost || hasEq;
  }

  function needsAudioGraph() {
    return isDspEnabled() || Boolean(settings.audioReactive);
  }

  async function loadSettings() {
    if (isKilled || (typeof window !== 'undefined' && window.CineGlowKilled)) return;
    try {
      const stored = await chrome.storage.sync.get(AUDIO_KEYS);
      for (const k of AUDIO_KEYS) {
        if (stored[k] !== undefined) settings[k] = stored[k];
      }
      attachToPlayer();
      updateAudioParams();
    } catch (err) {
      console.warn('[CineGlow Audio] Could not load settings:', err);
    }
  }

  const handleStorageChange = (changes, area) => {
    if (isKilled || (typeof window !== 'undefined' && window.CineGlowKilled)) return;
    if (area === 'sync') {
      let changed = false;
      for (const k of AUDIO_KEYS) {
        if (changes[k] !== undefined) {
          settings[k] = changes[k].newValue;
          changed = true;
        }
      }
      if (changed) {
        attachToPlayer();
        updateAudioParams();
      }
    }
  };

  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged?.addListener) {
    chrome.storage.onChanged.addListener(handleStorageChange);
  }

  function initAudio(video, force = false) {
    if (isKilled || (typeof window !== 'undefined' && window.CineGlowKilled)) return;
    if (!video) return;

    // FP-6.1: In attachToPlayer() / initAudio(), only instantiate AudioContext and mediaElementSource
    // when at least one audio DSP feature is enabled, avoiding unnecessary 5.1/7.1 downmixing & autoplay silence
    if (!force && !isDspEnabled()) {
      if (currentVideo === video && !sourceUsesDsp) return;
      if (source) {
        try { source.disconnect(); } catch (_) {}
      }
      source = videoSources.get(video) || null;
      if (source && audioCtx) source.connect(audioCtx.destination);
      currentVideo = video;
      sourceUsesDsp = false;
      return;
    }
    if (currentVideo === video && source && sourceUsesDsp) return;

    try {
      if (!audioCtx) {
        const AudioContextClass = (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) ||
                                  (typeof globalThis !== 'undefined' && (globalThis.AudioContext || globalThis.webkitAudioContext));
        if (!AudioContextClass) {
          console.warn('[CineGlow Audio] Web Audio API not supported in this environment');
          return;
        }
        audioCtx = new AudioContextClass({ latencyHint: 'playback' });

        // Preserve 5.1 / 7.1 surround channel layout when supported by output hardware
        if (audioCtx.destination && audioCtx.destination.maxChannelCount > 2) {
          try {
            audioCtx.destination.channelCount = audioCtx.destination.maxChannelCount;
            audioCtx.destination.channelCountMode = 'explicit';
          } catch (_) {}
        }

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
        gainNode.gain.value = computeEffectiveGain();

        // 5b. Makeup Gain Node on Compressor Wet Path (+8 dB to +10 dB, +9 dB = 2.818x linear) (FP-6.2)
        makeupGainNode = audioCtx.createGain();
        makeupGainNode.gain.value = Math.pow(10, 9.0 / 20); // +9 dB makeup gain to eliminate normalizer volume drop

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
        // Normalizer wet path with makeup gain (+8 dB to +10 dB) (FP-6.2)
        compressor.connect(makeupGainNode);
        makeupGainNode.connect(compressedGain);

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

        // Connect EQ into Volume Gain, then through Limiter to Destination & Side-Chain Analyser
        eqFilter12000.connect(gainNode);
        gainNode.connect(limiterNode);
        limiterNode.connect(audioCtx.destination);
        limiterNode.connect(analyser);

        // Auto-resume AudioContext on user interaction to comply with autoplay policy
        if (!onUserInteractionResume && typeof window !== 'undefined') {
          onUserInteractionResume = () => {
            if (audioCtx && audioCtx.state === 'suspended') {
              Promise.resolve(audioCtx.resume()).catch(() => {});
            }
          };
          window.addEventListener('click', onUserInteractionResume, { passive: true });
          window.addEventListener('keydown', onUserInteractionResume, { passive: true });
          window.addEventListener('pointerdown', onUserInteractionResume, { passive: true });
          window.addEventListener('touchstart', onUserInteractionResume, { passive: true });
        }
      }

      if (source) {
        try {
          source.disconnect();
        } catch (_) {}
        source = null;
      }

      // Retain and reuse each video's existing MediaElementAudioSourceNode
      let videoSource = videoSources.get(video);
      if (!videoSource) {
        videoSource = audioCtx.createMediaElementSource(video);
        videoSources.set(video, videoSource);
      } else {
        try {
          videoSource.disconnect();
        } catch (_) {}
      }

      videoSource.connect(normalizerGain);
      videoSource.connect(compressor);

      source = videoSource;
      sourceUsesDsp = true;
      currentVideo = video;
      video.cineGlowAudioAttached = true;

      // Auto-resume AudioContext on playback to comply with autoplay policy
      if (!video._cineGlowResumeAttached) {
        onVideoPlaybackResume = () => {
          if (audioCtx && audioCtx.state === 'suspended') {
            Promise.resolve(audioCtx.resume()).catch(() => {});
          }
        };
        video.addEventListener('play', onVideoPlaybackResume);
        video.addEventListener('playing', onVideoPlaybackResume);
        video.addEventListener('volumechange', onVideoPlaybackResume);
        video._cineGlowResumeAttached = true;
        video._cineGlowResumeHandler = onVideoPlaybackResume;
        boundResumeVideo = video;
      }
      if (!video.paused && audioCtx.state === 'suspended') {
        Promise.resolve(audioCtx.resume()).catch(() => {});
      }

      updateAudioParams();
    } catch (err) {
      console.error('[CineGlow Audio] Failed to initialize AudioContext:', err);
    }
  }

  function computeEffectiveGain() {
    const boostVal = settings.audioBoost !== undefined && !isNaN(Number(settings.audioBoost)) ? Number(settings.audioBoost) : 100;
    const rawGain = Math.max(0, boostVal) / 100;

    // FP-6.4: Rely on the downstream safety brickwall limiterNode (threshold -1 dB, ratio 20:1) to prevent
    // digital clipping rather than applying broadband headroom attenuation across the master mix when
    // bass/vocal/EQ boost is active. This ensures boosting bass does not muffle vocals and dialogue across the master mix.
    return rawGain;
  }

  function updateAudioParams() {
    if (isKilled || (typeof window !== 'undefined' && window.CineGlowKilled)) return;
    if (!audioCtx) return;
    const t = audioCtx.currentTime;

    // 1. Normalizer Crossfade
    if (normalizerGain && compressedGain) {
      const normOn = !!settings.audioNormalizer;
      normalizerGain.gain.setTargetAtTime(normOn ? 0 : 1, t, 0.02);
      compressedGain.gain.setTargetAtTime(normOn ? 1 : 0, t, 0.02);
    }

    // 2. Extra Volume Boost (relying on limiterNode for clipping prevention)
    if (gainNode) {
      const vol = computeEffectiveGain();
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
    if (isKilled || (typeof window !== 'undefined' && window.CineGlowKilled)) return;
    if (typeof window !== 'undefined' && window.CineGlowPlayer) {
      if (window.CineGlowPlayer.video) {
        initAudio(window.CineGlowPlayer.video);
      } else if (source) {
        try {
          source.disconnect();
        } catch (_) {}
        source = null;
        sourceUsesDsp = false;
        currentVideo = null;
      }
    }
  }

  // --- Emergency Kill-Switch Teardown ---
  function teardownKillSwitch() {
    if (isKilled) return;
    isKilled = true;
    if (typeof window !== 'undefined') window.CineGlowKilled = true;

    // 1. FP-6.3: In teardownKillSwitch(), do NOT call audioCtx.close(), which permanently severs audio
    // from the HTMLMediaElement under W3C Web Audio spec. Instead, bypass DSP by connecting
    // source.connect(audioCtx.destination), setting wetGain to 0, and dryGain to 1.
    if (source && audioCtx) {
      try { source.disconnect(); } catch (_) {}
      try { source.connect(audioCtx.destination); } catch (_) {}
    }

    if (compressedGain && compressedGain.gain) {
      try { compressedGain.gain.value = 0; } catch (_) {}
    }
    if (normalizerGain && normalizerGain.gain) {
      try { normalizerGain.gain.value = 1; } catch (_) {}
    }
    if (gainNode && gainNode.gain) {
      try { gainNode.gain.value = 1; } catch (_) {}
    }

    // 2. Clear global window hooks
    if (typeof window !== 'undefined') {
      window.CineGlowAudioAnalyser = null;
      window.CineGlowAudioDataArray = null;
      window.CineGlowAudioCtx = null;
      window.CineGlowAudioGainNode = null;
    }

    // 3. Detach storage listener
    if (typeof chrome !== 'undefined' && chrome.storage?.onChanged?.removeListener) {
      try {
        chrome.storage.onChanged.removeListener(handleStorageChange);
      } catch (_) {}
    }

    // 4. Detach video flags and collect videos before clearing currentVideo
    const videosToClean = [];
    if (currentVideo) {
      videosToClean.push(currentVideo);
      currentVideo.cineGlowAudioAttached = false;
      currentVideo = null;
    }
    if (boundResumeVideo && !videosToClean.includes(boundResumeVideo)) {
      videosToClean.push(boundResumeVideo);
    }

    // 5. Remove window interaction listeners
    if (onUserInteractionResume && typeof window !== 'undefined') {
      try {
        window.removeEventListener('click', onUserInteractionResume, { passive: true });
        window.removeEventListener('keydown', onUserInteractionResume, { passive: true });
        window.removeEventListener('pointerdown', onUserInteractionResume, { passive: true });
        window.removeEventListener('touchstart', onUserInteractionResume, { passive: true });
      } catch (_) {}
      onUserInteractionResume = null;
    }

    // 6. Remove video playback resume listeners
    for (const v of videosToClean) {
      const handler = v._cineGlowResumeHandler || onVideoPlaybackResume;
      if (handler && typeof v.removeEventListener === 'function') {
        try {
          v.removeEventListener('play', handler);
          v.removeEventListener('playing', handler);
          v.removeEventListener('volumechange', handler);
        } catch (_) {}
      }
      v._cineGlowResumeAttached = false;
      delete v._cineGlowResumeHandler;
    }
    onVideoPlaybackResume = null;
    boundResumeVideo = null;

    // 7. Remove player state listener
    if (typeof window !== 'undefined' && window.CineGlowPlayer && typeof window.CineGlowPlayer.removeEventListener === 'function') {
      try {
        window.CineGlowPlayer.removeEventListener('state-change', attachToPlayer);
      } catch (_) {}
    }
  }

  // Dual listener registration: Direct runtime message + In-tab fallback event
  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage?.addListener) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message && message.type === 'AURA_EMERGENCY_KILL_SWITCH') {
        teardownKillSwitch();
        if (typeof window !== 'undefined' && !window._cineglowKillEventFired) {
          window._cineglowKillEventFired = true;
          window.dispatchEvent(new CustomEvent('cineglow:kill-switch', { detail: message }));
        }
        if (typeof sendResponse === 'function') {
          sendResponse({ success: true, script: 'audio-processor.js' });
        }
      }
    });
  }

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('cineglow:kill-switch', () => {
      teardownKillSwitch();
    }, { once: true });
  }

  if (typeof window !== 'undefined' && window.CineGlowPlayer) {
    window.CineGlowPlayer.addEventListener('state-change', attachToPlayer);
    attachToPlayer();
  } else if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('load', () => {
      if (typeof window !== 'undefined' && window.CineGlowPlayer) {
        window.CineGlowPlayer.addEventListener('state-change', attachToPlayer);
        attachToPlayer();
      }
    }, { once: true });
  }

  window.CineGlowAudioComputeEffectiveGain = computeEffectiveGain;
  window.CineGlowAudioInit = (v, force = true) => initAudio(v, force);
  window.CineGlowAudioGetActiveSource = () => source;
  window.CineGlowAudioGetVideoSource = (v) => videoSources.get(v);
  window.CineGlowAudioTeardown = teardownKillSwitch;
  window.CineGlowAudioIsDspEnabled = isDspEnabled;
  window.CineGlowAudioGetMakeupGainNode = () => makeupGainNode;

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('unhandledrejection', (event) => {
      if (event && event.reason && String(event.reason.message || event.reason).includes('Extension context invalidated')) {
        try { event.preventDefault(); } catch (_) {}
      }
    });
    window.addEventListener('error', (event) => {
      if (event && event.message && String(event.message).includes('Extension context invalidated')) {
        try { event.preventDefault(); } catch (_) {}
      }
    });
  }

  loadSettings();
})();

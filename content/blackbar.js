/*
 * Aura - Black Bar Detection and Removal (Auto-Crop)
 * Production Architecture: OffscreenCanvas + Web Worker Async Frame Analysis
 */
(() => {
  'use strict';

  let settings = { ...AURA_DEFAULTS };
  let video = null;
  let intervalId = null;
  let worker = null;
  let isKilled = false;
  
  // Milestone 3 Item 2: Downsampled OffscreenCanvas (64x64) eliminates GPU readback stalls
  const SCAN_WIDTH = 64;
  const SCAN_HEIGHT = 64;
  let offscreenCanvas = null;
  let offscreenCtx = null;

  if (typeof OffscreenCanvas !== 'undefined') {
    try {
      offscreenCanvas = new OffscreenCanvas(SCAN_WIDTH, SCAN_HEIGHT);
      offscreenCtx = offscreenCanvas.getContext('2d', { willReadFrequently: true });
    } catch (_) {
      offscreenCanvas = null;
    }
  }

  const canvas = offscreenCanvas || document.createElement('canvas');
  canvas.width = SCAN_WIDTH;
  canvas.height = SCAN_HEIGHT;
  const ctx = offscreenCtx || (canvas.getContext && canvas.getContext('2d', { willReadFrequently: true }));

  // Initialize Web Worker for non-blocking asynchronous pixel analysis
  if (typeof Worker !== 'undefined' && typeof Blob !== 'undefined' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
    try {
      const workerBlob = new Blob([`
        self.onmessage = function(e) {
          const { buffer, width, height } = e.data;
          const data = new Uint8ClampedArray(buffer);
          const threshold = 15;
          function isBlack(x, y) {
            const i = (y * width + x) * 4;
            return data[i] <= threshold && data[i+1] <= threshold && data[i+2] <= threshold;
          }
          function isRowBlack(y) {
            const startX = Math.floor(width * 0.25);
            const endX = Math.floor(width * 0.75);
            const tolerance = Math.max(1, Math.floor((endX - startX) * 0.05));
            let nonBlack = 0;
            for (let x = startX; x < endX; x++) {
              if (!isBlack(x, y)) {
                nonBlack++;
                if (nonBlack > tolerance) return false;
              }
            }
            return true;
          }
          function isColBlack(x) {
            const startY = Math.floor(height * 0.25);
            const endY = Math.floor(height * 0.75);
            const tolerance = Math.max(1, Math.floor((endY - startY) * 0.05));
            let nonBlack = 0;
            for (let y = startY; y < endY; y++) {
              if (!isBlack(x, y)) {
                nonBlack++;
                if (nonBlack > tolerance) return false;
              }
            }
            return true;
          }
          let topBar = height;
          for (let y = 0; y < height; y++) {
            if (!isRowBlack(y)) { topBar = y; break; }
          }
          let bottomBar = height;
          for (let y = height - 1; y >= 0; y--) {
            if (!isRowBlack(y)) { bottomBar = height - 1 - y; break; }
          }
          let leftBar = width;
          for (let x = 0; x < width; x++) {
            if (!isColBlack(x)) { leftBar = x; break; }
          }
          let rightBar = width;
          for (let x = width - 1; x >= 0; x--) {
            if (!isColBlack(x)) { rightBar = width - 1 - x; break; }
          }
          self.postMessage({ topBar, bottomBar, leftBar, rightBar, width, height });
        };
      `], { type: 'application/javascript' });
      worker = new Worker(URL.createObjectURL(workerBlob));
      worker.onmessage = (e) => {
        const { topBar, bottomBar, leftBar, rightBar, width, height } = e.data;
        calculateCropFromDimensions(topBar, bottomBar, leftBar, rightBar, width, height);
      };
    } catch (_) {
      worker = null;
    }
  }

  const STABILITY_REQUIRED = 4;
  let stableCrop = { top: 0, bottom: 0, left: 0, right: 0 };
  let candidateCrop = { top: 0, bottom: 0, left: 0, right: 0 };
  let stabilityCount = 0;

  function calculateCropFromDimensions(topBar, bottomBar, leftBar, rightBar, width, height) {
    if (topBar === height || leftBar === width) return;
    const overscanY = (topBar > 0 || bottomBar > 0) ? 0.006 : 0;
    const overscanX = (leftBar > 0 || rightBar > 0) ? 0.006 : 0;

    const cropTop = topBar > 0 ? (topBar / height) + overscanY : 0;
    const cropBottom = bottomBar > 0 ? (bottomBar / height) + overscanY : 0;
    const cropLeft = leftBar > 0 ? (leftBar / width) + overscanX : 0;
    const cropRight = rightBar > 0 ? (rightBar / width) + overscanX : 0;

    handleCropResult({ cropTop, cropBottom, cropLeft, cropRight });
  }

  function handleCropResult(result) {
    if (isKilled || (typeof window !== 'undefined' && window.CineGlowKilled)) return;
    if (!video || !settings.removeBlackBars) return;
    
    // Ignore unreasonable crops (no real video has >25% black bars on one side)
    // Also ignore highly asymmetric crops (real black bars are roughly equal on both sides)
    if (result.cropTop > 0.25 || result.cropBottom > 0.25 || result.cropLeft > 0.25 || result.cropRight > 0.25) {
      return; 
    }
    if (Math.abs(result.cropTop - result.cropBottom) > 0.05) return;
    if (Math.abs(result.cropLeft - result.cropRight) > 0.05) return;
    
    const tolerance = 0.02;
    const isSameCandidate = 
      Math.abs(result.cropTop - candidateCrop.top) < tolerance &&
      Math.abs(result.cropBottom - candidateCrop.bottom) < tolerance &&
      Math.abs(result.cropLeft - candidateCrop.left) < tolerance &&
      Math.abs(result.cropRight - candidateCrop.right) < tolerance;
      
    if (isSameCandidate) {
      stabilityCount++;
      if (stabilityCount === STABILITY_REQUIRED) {
        applyCrop(candidateCrop);
      }
    } else {
      candidateCrop = {
        top: result.cropTop,
        bottom: result.cropBottom,
        left: result.cropLeft,
        right: result.cropRight
      };
      stabilityCount = 1;
    }
  }

  function applyCrop(crop) {
    const isDifferent = 
      Math.abs(crop.top - stableCrop.top) > 0.01 ||
      Math.abs(crop.bottom - stableCrop.bottom) > 0.01 ||
      Math.abs(crop.left - stableCrop.left) > 0.01 ||
      Math.abs(crop.right - stableCrop.right) > 0.01;
      
    if (isDifferent) {
      stableCrop = { ...crop };
      
      let scale = Math.max(
        1 / (1 - crop.top - crop.bottom),
        1 / (1 - crop.left - crop.right)
      );
      
      if (scale > 1.01) {
        window.CineGlowCrop = stableCrop;
        video.style.clipPath = `inset(${crop.top * 100}% ${crop.right * 100}% ${crop.bottom * 100}% ${crop.left * 100}%)`;
        video.style.transition = 'clip-path 0.5s ease';
      } else {
        resetCrop();
      }
    }
  }

  function resetCrop() {
    window.CineGlowCrop = null;
    stableCrop = { top: 0, bottom: 0, left: 0, right: 0 };
    candidateCrop = { top: 0, bottom: 0, left: 0, right: 0 };
    stabilityCount = 0;
    if (video) {
      video.style.clipPath = '';
    }
  }

  function processScanFallback(data, width, height) {
    const threshold = 15;
    function isBlack(x, y) {
      const i = (y * width + x) * 4;
      return data[i] <= threshold && data[i+1] <= threshold && data[i+2] <= threshold;
    }
    function isRowBlack(y) {
      const startX = Math.floor(width * 0.25);
      const endX = Math.floor(width * 0.75);
      const tolerance = Math.max(1, Math.floor((endX - startX) * 0.05));
      let nonBlack = 0;
      for (let x = startX; x < endX; x++) {
        if (!isBlack(x, y)) {
          nonBlack++;
          if (nonBlack > tolerance) return false;
        }
      }
      return true;
    }
    function isColBlack(x) {
      const startY = Math.floor(height * 0.25);
      const endY = Math.floor(height * 0.75);
      const tolerance = Math.max(1, Math.floor((endY - startY) * 0.05));
      let nonBlack = 0;
      for (let y = startY; y < endY; y++) {
        if (!isBlack(x, y)) {
          nonBlack++;
          if (nonBlack > tolerance) return false;
        }
      }
      return true;
    }
    let topBar = height;
    for (let y = 0; y < height; y++) {
      if (!isRowBlack(y)) { topBar = y; break; }
    }
    let bottomBar = height;
    for (let y = height - 1; y >= 0; y--) {
      if (!isRowBlack(y)) { bottomBar = height - 1 - y; break; }
    }
    let leftBar = width;
    for (let x = 0; x < width; x++) {
      if (!isColBlack(x)) { leftBar = x; break; }
    }
    let rightBar = width;
    for (let x = width - 1; x >= 0; x--) {
      if (!isColBlack(x)) { rightBar = width - 1 - x; break; }
    }
    calculateCropFromDimensions(topBar, bottomBar, leftBar, rightBar, width, height);
  }

  function scanFrame() {
    if (isKilled || (typeof window !== 'undefined' && window.CineGlowKilled)) return;
    if (!settings.removeBlackBars || !video || video.readyState < 2 || video.paused) {
      return;
    }
    
    try {
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      if (!imageData || !imageData.data) return;

      if (worker) {
        const bufferCopy = imageData.data.buffer.slice(0);
        worker.postMessage({ buffer: bufferCopy, width: canvas.width, height: canvas.height }, [bufferCopy]);
      } else {
        processScanFallback(imageData.data, canvas.width, canvas.height);
      }
    } catch (err) {
      console.debug('[Aura] BlackBar drawImage failed:', err);
    }
  }

  function startScanning() {
    if (isKilled || (typeof window !== 'undefined' && window.CineGlowKilled)) return;
    if (!intervalId) {
      intervalId = setInterval(scanFrame, 500);
    }
  }

  function stopScanning() {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }

  function handlePlayerState(state) {
    if (isKilled || (typeof window !== 'undefined' && window.CineGlowKilled)) return;
    if (state.video !== video) {
      if (video) resetCrop();
      video = state.video;
    }
    
    if (state.isWatchPage && video) {
      startScanning();
    } else {
      stopScanning();
      resetCrop();
    }
  }

  // --- Emergency Kill-Switch Teardown ---
  function teardownKillSwitch() {
    if (isKilled) return;
    isKilled = true;
    settings.removeBlackBars = false;
    if (typeof window !== 'undefined') window.CineGlowKilled = true;

    stopScanning();
    resetCrop();
    window.CineGlowCrop = null;
    video = null;

    if (worker) {
      try {
        worker.terminate();
      } catch (_) {}
      worker = null;
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
          sendResponse({ success: true, script: 'blackbar.js' });
        }
      }
    });
  }

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('cineglow:kill-switch', () => {
      teardownKillSwitch();
    }, { once: true });
  }

  window.CineGlowCropTeardown = teardownKillSwitch;

  if (window.CineGlowPlayer) {
    window.CineGlowPlayer.addEventListener('state-change', (e) => handlePlayerState(e.detail));
    handlePlayerState(window.CineGlowPlayer);
  }

  async function loadSettings() {
    if (isKilled || (typeof window !== 'undefined' && window.CineGlowKilled)) return;
    try {
      const stored = await chrome.storage.sync.get(AURA_DEFAULTS);
      settings = { ...AURA_DEFAULTS, ...stored };
    } catch (err) {}
    
    if (!settings.removeBlackBars) {
      resetCrop();
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (isKilled || (typeof window !== 'undefined' && window.CineGlowKilled)) return;
    if (area !== 'sync') return;
    let changed = false;
    for (const [key, { newValue }] of Object.entries(changes)) {
      if (key in AURA_DEFAULTS) {
        settings[key] = newValue ?? AURA_DEFAULTS[key];
        changed = true;
      }
    }
    if (changed && !settings.removeBlackBars) {
      resetCrop();
    }
  });

  loadSettings();
})();

/*
 * Aura - Black Bar Detection and Removal (Auto-Crop)
 */
(() => {
  'use strict';

  let settings = { ...AURA_DEFAULTS };
  let video = null;
  let intervalId = null;
  let worker = null;
  
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  const workerCode = `
    self.onmessage = function(e) {
      const imgData = e.data.imageData;
      const width = e.data.width;
      const height = e.data.height;
      const data = imgData.data;
      
      const threshold = 15;
      
      function isBlack(x, y) {
        const i = (y * width + x) * 4;
        return data[i] <= threshold && data[i+1] <= threshold && data[i+2] <= threshold;
      }
      
      function isRowBlack(y) {
        const startX = Math.floor(width * 0.25);
        const endX = Math.floor(width * 0.75);
        // Step by a few pixels for performance if needed, but 128x128 is small enough
        for (let x = startX; x < endX; x++) {
          if (!isBlack(x, y)) return false;
        }
        return true;
      }
      
      function isColBlack(x) {
        const startY = Math.floor(height * 0.25);
        const endY = Math.floor(height * 0.75);
        for (let y = startY; y < endY; y++) {
          if (!isBlack(x, y)) return false;
        }
        return true;
      }
      
      let topBar = height;
      for (let y = 0; y < height; y++) {
        if (!isRowBlack(y)) {
          topBar = y;
          break;
        }
      }
      
      let bottomBar = height;
      for (let y = height - 1; y >= 0; y--) {
        if (!isRowBlack(y)) {
          bottomBar = height - 1 - y;
          break;
        }
      }
      
      let leftBar = width;
      for (let x = 0; x < width; x++) {
        if (!isColBlack(x)) {
          leftBar = x;
          break;
        }
      }
      
      let rightBar = width;
      for (let x = width - 1; x >= 0; x--) {
        if (!isColBlack(x)) {
          rightBar = width - 1 - x;
          break;
        }
      }
      
      const cropTop = topBar / height;
      const cropBottom = bottomBar / height;
      const cropLeft = leftBar / width;
      const cropRight = rightBar / width;
      
      self.postMessage({ cropTop, cropBottom, cropLeft, cropRight });
    };
  `;
  
  let workerUrl = null;
  
  function initWorker() {
    if (!worker) {
      if (!workerUrl) {
        const blob = new Blob([workerCode], { type: 'application/javascript' });
        workerUrl = URL.createObjectURL(blob);
      }
      worker = new Worker(workerUrl);
      worker.onmessage = (e) => {
        handleCropResult(e.data);
      };
    }
  }

  const STABILITY_REQUIRED = 4;
  let stableCrop = { top: 0, bottom: 0, left: 0, right: 0 };
  let candidateCrop = { top: 0, bottom: 0, left: 0, right: 0 };
  let stabilityCount = 0;

  function handleCropResult(result) {
    if (!video || !settings.removeBlackBars) return;
    
    // Ignore completely black or near-black frames
    if (result.cropTop > 0.4 || result.cropBottom > 0.4 || result.cropLeft > 0.4 || result.cropRight > 0.4) {
      return; 
    }
    
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
      
      const scale = Math.max(
        1 / (1 - crop.top - crop.bottom),
        1 / (1 - crop.left - crop.right)
      );
      
      if (scale > 1.01) {
        if (video.parentElement) {
          video.parentElement.style.overflow = 'hidden';
        }
        video.style.transformOrigin = 'center center';
        video.style.transform = `scale(${scale})`;
        video.style.transition = 'transform 0.5s ease';
      } else {
        resetCrop();
      }
    }
  }

  function resetCrop() {
    if (video) {
      if (video.parentElement) {
        video.parentElement.style.overflow = '';
      }
      video.style.transform = '';
      video.style.transformOrigin = '';
      video.style.transition = 'transform 0.5s ease';
    }
    stableCrop = { top: 0, bottom: 0, left: 0, right: 0 };
    candidateCrop = { top: 0, bottom: 0, left: 0, right: 0 };
    stabilityCount = 0;
  }

  function scanFrame() {
    if (!settings.removeBlackBars || !video || video.readyState < 2 || video.paused) {
      return;
    }
    
    try {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      worker.postMessage({ imageData, width: canvas.width, height: canvas.height });
    } catch (err) {
      console.debug('[Aura] BlackBar drawImage failed:', err);
    }
  }

  function startScanning() {
    if (!intervalId) {
      initWorker();
      intervalId = setInterval(scanFrame, 500);
    }
  }

  function stopScanning() {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
    if (worker) {
      worker.terminate();
      worker = null;
    }
  }

  window.CineGlowPlayer.addEventListener('state-change', (e) => {
    const state = e.detail;
    
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
  });

  async function loadSettings() {
    try {
      const stored = await chrome.storage.sync.get(AURA_DEFAULTS);
      settings = { ...AURA_DEFAULTS, ...stored };
    } catch (err) {}
    
    if (!settings.removeBlackBars) {
      resetCrop();
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
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

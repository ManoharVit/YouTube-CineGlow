/*
 * Aura - Black Bar Detection and Removal (Auto-Crop)
 * Architecture: OffscreenCanvas + requestVideoFrameCallback Frame Analysis
 */
(() => {
  'use strict';

  let settings = { ...(typeof AURA_DEFAULTS !== 'undefined' ? AURA_DEFAULTS : {}) };
  let video = null;
  let videoId = null;
  let isAdShowing = false;
  let rvfcId = 0;
  let fallbackIntervalId = 0;
  let lastScanAt = 0;
  let lastUnfocusedScan = 0;
  let isKilled = false;

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

  const canvas = offscreenCanvas || (typeof document !== 'undefined' && document.createElement ? document.createElement('canvas') : null);
  if (canvas) {
    canvas.width = SCAN_WIDTH;
    canvas.height = SCAN_HEIGHT;
  }
  const ctx = offscreenCtx || (canvas && canvas.getContext ? canvas.getContext('2d', { willReadFrequently: true }) : null);

  const STABLE_THRESHOLD = 8;
  const UNFOCUSED_STABLE_THRESHOLD = 4; // ~6s at 2000ms unfocused scan cadence
  const RELEASE_THRESHOLD = 2;
  const EDGE_OVERSCAN_RATIO = 0.006;
  const MAX_SINGLE_SIDE_CROP = 0.25;
  const MAX_ASYMMETRY_RATIO = 0.05;
  const STABILITY_MATCH_TOLERANCE = 0.02;
  const BLACK_LUMA_THRESHOLD = 15;
  const STRICT_PILLAR_AVG_LUMA = 8;
  const MIN_AXIS_CROP_RATIO = 0.04;

  let stableCrop = { top: 0, bottom: 0, left: 0, right: 0 };
  let candidateCrop = { top: 0, bottom: 0, left: 0, right: 0 };
  let stabilityCount = 0;
  let releaseCount = 0;

  /**
   * Return true when the document is visible in an unfocused window (e.g. secondary monitor).
   * @returns {boolean}
   */
  function isUnfocusedDocument() {
    return typeof document !== 'undefined' && typeof document.hasFocus === 'function' && !document.hasFocus();
  }

  function calculateCropFromDimensions(topBar, bottomBar, leftBar, rightBar, width, height) {
    if (topBar === height || leftBar === width) return;
    const overscanY = (topBar > 0 || bottomBar > 0) ? EDGE_OVERSCAN_RATIO : 0;
    const overscanX = (leftBar > 0 || rightBar > 0) ? EDGE_OVERSCAN_RATIO : 0;

    let cropTop = topBar > 0 ? (topBar / height) + overscanY : 0;
    let cropBottom = bottomBar > 0 ? (bottomBar / height) + overscanY : 0;
    let cropLeft = leftBar > 0 ? (leftBar / width) + overscanX : 0;
    let cropRight = rightBar > 0 ? (rightBar / width) + overscanX : 0;

    // Never crop all 4 edges into a miniature box when letterbox bars exist;
    // dark vertical vignettes in 21:9 cinema frames must not trim horizontal sides.
    if (cropTop >= MIN_AXIS_CROP_RATIO && cropBottom >= MIN_AXIS_CROP_RATIO) {
      cropLeft = 0;
      cropRight = 0;
    }

    handleCropResult({ cropTop, cropBottom, cropLeft, cropRight });
  }

  function handleCropResult(result) {
    if (isKilled || (typeof window !== 'undefined' && window.CineGlowKilled)) return;
    if (!video || (!settings.removeBlackBars && !settings.screenXMode)) return;

    if (
      result.cropTop > MAX_SINGLE_SIDE_CROP ||
      result.cropBottom > MAX_SINGLE_SIDE_CROP ||
      result.cropLeft > MAX_SINGLE_SIDE_CROP ||
      result.cropRight > MAX_SINGLE_SIDE_CROP
    ) {
      return;
    }
    if (Math.abs(result.cropTop - result.cropBottom) > MAX_ASYMMETRY_RATIO) return;
    if (Math.abs(result.cropLeft - result.cropRight) > MAX_ASYMMETRY_RATIO) return;

    const needsRelease =
      (stableCrop.top > 0 && result.cropTop < stableCrop.top - STABILITY_MATCH_TOLERANCE) ||
      (stableCrop.bottom > 0 && result.cropBottom < stableCrop.bottom - STABILITY_MATCH_TOLERANCE) ||
      (stableCrop.left > 0 && result.cropLeft < stableCrop.left - STABILITY_MATCH_TOLERANCE) ||
      (stableCrop.right > 0 && result.cropRight < stableCrop.right - STABILITY_MATCH_TOLERANCE);

    if (needsRelease) {
      releaseCount++;
      if (releaseCount >= RELEASE_THRESHOLD) {
        releaseCount = 0;
        const relaxed = {
          top: result.cropTop < stableCrop.top - STABILITY_MATCH_TOLERANCE ? result.cropTop : stableCrop.top,
          bottom: result.cropBottom < stableCrop.bottom - STABILITY_MATCH_TOLERANCE ? result.cropBottom : stableCrop.bottom,
          left: result.cropLeft < stableCrop.left - STABILITY_MATCH_TOLERANCE ? result.cropLeft : stableCrop.left,
          right: result.cropRight < stableCrop.right - STABILITY_MATCH_TOLERANCE ? result.cropRight : stableCrop.right
        };
        applyCrop(relaxed, true);
        candidateCrop = { ...relaxed };
        stabilityCount = 1;
        return;
      }
    } else {
      releaseCount = 0;
    }

    const isSameCandidate =
      Math.abs(result.cropTop - candidateCrop.top) < STABILITY_MATCH_TOLERANCE &&
      Math.abs(result.cropBottom - candidateCrop.bottom) < STABILITY_MATCH_TOLERANCE &&
      Math.abs(result.cropLeft - candidateCrop.left) < STABILITY_MATCH_TOLERANCE &&
      Math.abs(result.cropRight - candidateCrop.right) < STABILITY_MATCH_TOLERANCE;

    if (isSameCandidate) {
      stabilityCount++;
      const requiredStability = isUnfocusedDocument() ? UNFOCUSED_STABLE_THRESHOLD : STABLE_THRESHOLD;
      if (stabilityCount >= requiredStability) {
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

  function applyCrop(crop, forceSync = false) {
    const isDifferent =
      Math.abs(crop.top - stableCrop.top) > 0.01 ||
      Math.abs(crop.bottom - stableCrop.bottom) > 0.01 ||
      Math.abs(crop.left - stableCrop.left) > 0.01 ||
      Math.abs(crop.right - stableCrop.right) > 0.01;

    if (isDifferent || forceSync) {
      stableCrop = { ...crop };
      if (crop.top || crop.right || crop.bottom || crop.left) {
        if (typeof window !== 'undefined') window.CineGlowGlowCrop = stableCrop;
        if (settings.removeBlackBars) {
          if (typeof window !== 'undefined') window.CineGlowCrop = stableCrop;
          if (video) {
            video.style.clipPath = `inset(${crop.top * 100}% ${crop.right * 100}% ${crop.bottom * 100}% ${crop.left * 100}%)`;
          }
        } else {
          if (typeof window !== 'undefined') window.CineGlowCrop = null;
          if (video) {
            video.style.clipPath = '';
          }
        }
      } else {
        resetCrop();
      }
    }
  }

  function resetCrop() {
    if (typeof window !== 'undefined') {
      window.CineGlowCrop = null;
      window.CineGlowGlowCrop = null;
    }
    stableCrop = { top: 0, bottom: 0, left: 0, right: 0 };
    candidateCrop = { top: 0, bottom: 0, left: 0, right: 0 };
    stabilityCount = 0;
    releaseCount = 0;
    if (video) {
      video.style.clipPath = '';
    }
  }

  function processScan(rgbaPixels, width, height) {
    function isBlack(x, y) {
      const idx = (y * width + x) * 4;
      return (
        rgbaPixels[idx] <= BLACK_LUMA_THRESHOLD &&
        rgbaPixels[idx + 1] <= BLACK_LUMA_THRESHOLD &&
        rgbaPixels[idx + 2] <= BLACK_LUMA_THRESHOLD
      );
    }
    function isRowBlack(y) {
      const startX = Math.floor(width * 0.05);
      const endX = Math.floor(width * 0.95);
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
    function isColBlack(x, startY, endY) {
      if (endY <= startY) return false;
      const span = endY - startY;
      const tolerance = Math.max(1, Math.floor(span * 0.05));
      let nonBlack = 0;
      let lumaSum = 0;
      for (let y = startY; y < endY; y++) {
        const idx = (y * width + x) * 4;
        const maxCh = Math.max(rgbaPixels[idx], rgbaPixels[idx + 1], rgbaPixels[idx + 2]);
        lumaSum += maxCh;
        if (maxCh > BLACK_LUMA_THRESHOLD) {
          nonBlack++;
          if (nonBlack > tolerance) return false;
        }
      }
      return (lumaSum / span) <= STRICT_PILLAR_AVG_LUMA;
    }

    function bandBlackRatio(isHorizontal, start, end, spanStart, spanEnd) {
      if (end <= start || spanEnd <= spanStart) return 0;
      let total = 0;
      let black = 0;
      for (let a = start; a < end; a++) {
        for (let b = spanStart; b < spanEnd; b++) {
          total++;
          if (isHorizontal ? isBlack(b, a) : isBlack(a, b)) black++;
        }
      }
      return total > 0 ? black / total : 0;
    }

    // If one bar is a clean cinema letterbox/pillarbox (>= 4px on 64px scan, <= 25%) and
    // the opposite side stopped early because of a localized badge/watermark/subtitle,
    // recover the symmetric boundary only when >= 72% of that band is still pure black
    // and real active picture begins at the symmetric edge.
    function recoverAsymmetricBar(strictSelf, strictOther, size, spanStart, spanEnd, isHorizontal, isStartSide) {
      const minAnchor = Math.max(4, Math.ceil(size * 0.06));
      const maxAnchor = Math.floor(size * 0.25);
      if (strictOther < minAnchor || strictOther > maxAnchor || strictSelf >= strictOther - 2) {
        return strictSelf;
      }
      const bandStart = isStartSide ? 0 : size - strictOther;
      const bandEnd = isStartSide ? strictOther : size;
      const boundaryIndex = isStartSide ? strictOther : size - 1 - strictOther;
      const edgeCheck = isHorizontal ? isRowBlack(boundaryIndex) : isColBlack(boundaryIndex, spanStart, spanEnd);
      if (edgeCheck) return strictSelf;

      const ratio = bandBlackRatio(isHorizontal, bandStart, bandEnd, spanStart, spanEnd);
      return ratio >= 0.72 ? strictOther : strictSelf;
    }

    let topBar = height;
    for (let y = 0; y < height; y++) {
      if (!isRowBlack(y)) { topBar = y; break; }
    }
    let bottomBar = height;
    for (let y = height - 1; y >= 0; y--) {
      if (!isRowBlack(y)) { bottomBar = height - 1 - y; break; }
    }

    const colSpanStart = Math.max(Math.floor(height * 0.05), topBar < height ? topBar : 0);
    const colSpanEnd = Math.min(Math.floor(height * 0.95), bottomBar < height ? height - bottomBar : height);

    let leftBar = width;
    for (let x = 0; x < width; x++) {
      if (!isColBlack(x, colSpanStart, colSpanEnd)) { leftBar = x; break; }
    }
    let rightBar = width;
    for (let x = width - 1; x >= 0; x--) {
      if (!isColBlack(x, colSpanStart, colSpanEnd)) { rightBar = width - 1 - x; break; }
    }

    const rowSpanStart = Math.floor(width * 0.05);
    const rowSpanEnd = Math.floor(width * 0.95);

    const recoveredTop = recoverAsymmetricBar(topBar, bottomBar, height, rowSpanStart, rowSpanEnd, true, true);
    const recoveredBottom = recoverAsymmetricBar(bottomBar, topBar, height, rowSpanStart, rowSpanEnd, true, false);
    const recoveredLeft = recoverAsymmetricBar(leftBar, rightBar, width, colSpanStart, colSpanEnd, false, true);
    const recoveredRight = recoverAsymmetricBar(rightBar, leftBar, width, colSpanStart, colSpanEnd, false, false);

    calculateCropFromDimensions(recoveredTop, recoveredBottom, recoveredLeft, recoveredRight, width, height);
  }

  function scanFrame(now = (typeof Date !== 'undefined' ? Date.now() : performance.now())) {
    if (isKilled || (typeof window !== 'undefined' && window.CineGlowKilled)) return;
    if ((!settings.removeBlackBars && !settings.screenXMode) || isAdShowing || !video || video.readyState < 2 || video.paused) return;
    if (typeof document !== 'undefined' && document.hidden) return;

    if (isUnfocusedDocument()) {
      if (now - lastUnfocusedScan < 2000) {
        return;
      }
      lastUnfocusedScan = now;
    }

    try {
      if (!ctx || !canvas) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      if (!imageData?.data) return;
      processScan(imageData.data, canvas.width, canvas.height);
    } catch (_) {}
  }

  function onVideoFrame(now) {
    rvfcId = 0;
    if (isKilled || (typeof window !== 'undefined' && window.CineGlowKilled) || (!settings.removeBlackBars && !settings.screenXMode) || !video || isAdShowing) return;
    const currentTime = typeof Date !== 'undefined' ? Date.now() : now;
    const hasLockedCrop = Boolean(stableCrop.top || stableCrop.bottom || stableCrop.left || stableCrop.right);
    const minInterval = isUnfocusedDocument()
      ? 2000
      : (hasLockedCrop ? 500 : 150);
    if (currentTime - lastScanAt >= minInterval) {
      lastScanAt = currentTime;
      scanFrame(currentTime);
    }
    if (video && typeof video.requestVideoFrameCallback === 'function') {
      rvfcId = video.requestVideoFrameCallback(onVideoFrame);
    }
  }

  function startScanning() {
    if (isKilled || (typeof window !== 'undefined' && window.CineGlowKilled) || (!settings.removeBlackBars && !settings.screenXMode) || !video) return;
    if (typeof video.requestVideoFrameCallback === 'function') {
      if (!rvfcId) {
        rvfcId = video.requestVideoFrameCallback(onVideoFrame);
      }
    } else if (!fallbackIntervalId) {
      fallbackIntervalId = setInterval(() => scanFrame(), 500);
      if (fallbackIntervalId && typeof fallbackIntervalId.unref === 'function') {
        fallbackIntervalId.unref();
      }
    }
  }

  function stopScanning() {
    if (rvfcId && video && typeof video.cancelVideoFrameCallback === 'function') {
      try { video.cancelVideoFrameCallback(rvfcId); } catch (_) {}
      rvfcId = 0;
    }
    if (fallbackIntervalId) {
      clearInterval(fallbackIntervalId);
      fallbackIntervalId = 0;
    }
    lastScanAt = 0;
    lastUnfocusedScan = 0;
  }

  function syncScanningState() {
    if (isKilled || (typeof window !== 'undefined' && window.CineGlowKilled)) return;
    const isWatchPage = (typeof window !== 'undefined' && window.CineGlowPlayer)
      ? window.CineGlowPlayer.isWatchPage
      : (typeof location !== 'undefined' && location.pathname === '/watch');
    if ((settings.removeBlackBars || settings.screenXMode) && isWatchPage && video && !isAdShowing) {
      if (stableCrop.top || stableCrop.bottom || stableCrop.left || stableCrop.right) {
        applyCrop(stableCrop, true);
      }
      startScanning();
    } else {
      stopScanning();
      resetCrop();
    }
  }

  function handlePlayerState(state) {
    if (isKilled || (typeof window !== 'undefined' && window.CineGlowKilled) || !state) return;
    const nextAdShowing = Boolean(state.isAdShowing);
    if (state.video !== video || state.videoId !== videoId || nextAdShowing !== isAdShowing) {
      stopScanning();
      resetCrop();
      video = state.video;
      videoId = state.videoId;
      isAdShowing = nextAdShowing;
    }
    syncScanningState();
  }

  const onPlayerStateChange = (e) => handlePlayerState(e?.detail);

  const handleStorageChange = (changes, area) => {
    if (isKilled || (typeof window !== 'undefined' && window.CineGlowKilled)) return;
    if (area === 'managed' && changes.KillSwitch?.newValue === true) {
      teardownKillSwitch();
      return;
    }
    if (area === 'local' && changes.auraKillSwitchActive?.newValue === true) {
      teardownKillSwitch();
      return;
    }
    if (area !== 'sync') return;
    let changed = false;
    const defaults = typeof AURA_DEFAULTS !== 'undefined' ? AURA_DEFAULTS : {};
    for (const [key, { newValue }] of Object.entries(changes)) {
      if (key in defaults) {
        settings[key] = newValue ?? defaults[key];
        changed = true;
      }
    }
    if (changed) {
      syncScanningState();
    }
  };
  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged?.addListener) {
    chrome.storage.onChanged.addListener(handleStorageChange);
  }

  function teardownKillSwitch() {
    if (isKilled) return;
    isKilled = true;
    settings.removeBlackBars = false;
    if (typeof window !== 'undefined') {
      window.CineGlowKilled = true;
      window.CineGlowCrop = null;
      window.CineGlowGlowCrop = null;
    }

    if (typeof chrome !== 'undefined' && chrome.storage?.onChanged?.removeListener) {
      chrome.storage.onChanged.removeListener(handleStorageChange);
    }
    if (typeof window !== 'undefined' && window.CineGlowPlayer?.removeEventListener) {
      window.CineGlowPlayer.removeEventListener('state-change', onPlayerStateChange);
    }
    stopScanning();
    resetCrop();
    video = null;
  }

  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage?.addListener) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === 'AURA_EMERGENCY_KILL_SWITCH') {
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

  if (typeof window !== 'undefined') {
    window.CineGlowCropTeardown = teardownKillSwitch;
  }

  if (typeof window !== 'undefined' && window.CineGlowPlayer) {
    window.CineGlowPlayer.addEventListener('state-change', onPlayerStateChange);
    handlePlayerState(window.CineGlowPlayer);
  }

  async function loadSettings() {
    if (isKilled || (typeof window !== 'undefined' && window.CineGlowKilled)) return;
    try {
      const defaults = typeof AURA_DEFAULTS !== 'undefined' ? AURA_DEFAULTS : {};
      if (typeof chrome !== 'undefined' && chrome.storage) {
        const [local, managed, stored] = await Promise.all([
          chrome.storage.local?.get(['auraKillSwitchActive']).catch(() => ({})),
          chrome.storage.managed?.get(['KillSwitch']).catch(() => ({})),
          chrome.storage.sync?.get(defaults).catch(() => ({}))
        ]);
        if (local?.auraKillSwitchActive || managed?.KillSwitch) {
          teardownKillSwitch();
          return;
        }
        settings = { ...defaults, ...stored };
      }
    } catch (_) {}

    syncScanningState();
  }

  loadSettings();
})();

(() => {
  'use strict';

  const SPEED_BUTTON_CLASS = 'cineglow-speed-button';
  const SPEED_ICON_PATH = 'M12 4a8 8 0 0 0-8 8c0 2.2.9 4.2 2.3 5.7l1.4-1.4A6 6 0 0 1 6 12a6 6 0 1 1 12 0c0 1.6-.6 3-1.7 4.3l1.4 1.4A8 8 0 0 0 12 4zm-1 4v4.6l2.8 1.7.8-1.3-2.1-1.3V8h-1.5z';
  const PRESET_SPEEDS = [0.25, 0.5, 1.0, 1.5, 2.0, 5.0];

  let currentButton = null;
  let activeMenu = null;
  let toastEl = null;
  let toastTimeout = 0;
  let abortController = null;
  let currentSpeed = 1.0;
  let preferredSpeed = 1.0;
  let isApplyingSpeed = false;
  let lastVideoId = null;
  let boundVideo = null;
  let onRateChange = null;
  let onLoadedMetadata = null;
  let onCanPlay = null;
  let onPlaying = null;
  let onDocumentNavigation = null;
  let onPlayerStateChange = null;
  let onWindowKeydown = null;
  let onPointerDown = null;
  let onPointerUp = null;
  let lastSpeedKeypressTime = 0;
  let lastNavigatedTime = Date.now();
  let lastNativeSettingsClickTime = 0;
  let isPointerDownOnVideo = false;
  let enforcementTimer = null;
  let storageDebounceTimer = null;
  let isKilled = false;
  let activeOutsideClickListener = null;
  let outsideClickTimer = null;
  let isInjectingSpeedButton = false;
  let lastAdEndTime = 0;
  let lastWasAdShowing = false;

  function isAdActive() {
    if (typeof window !== 'undefined' && window.CineGlowPlayer && window.CineGlowPlayer.isAdShowing) {
      return true;
    }
    const player = (typeof window !== 'undefined' && window.CineGlowPlayer && window.CineGlowPlayer.player) ||
      (typeof document !== 'undefined' && document.querySelector('#movie_player, #shorts-player, .html5-video-player'));
    if (player && (player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting'))) {
      return true;
    }
    return false;
  }

  function isNativeSpeedMenuOpen() {
    return Array.from(document.querySelectorAll('.ytp-settings-menu, .ytp-panel-speed')).some(menu => {
      if (!menu.getClientRects || menu.getClientRects().length === 0) return false;
      const style = typeof getComputedStyle === 'function' ? getComputedStyle(menu) : menu.style;
      return style.display !== 'none' && style.visibility !== 'hidden';
    });
  }

  function checkAdActive() {
    if (isAdActive()) {
      lastAdEndTime = Date.now();
      return true;
    }
    return false;
  }

  const SYNC_THROTTLE_MS = 550;

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    onWindowKeydown = (e) => {
      if (isKilled || !isContextValid()) return;
      if (e.key === '<' || e.key === '>' || (e.shiftKey && (e.key === ',' || e.key === '.'))) {
        lastSpeedKeypressTime = Date.now();
      }
    };
    window.addEventListener('keydown', onWindowKeydown, { passive: true });

    // Track pointer state to support YouTube's native "Hold to 2x" speed gesture
    onPointerDown = () => { isPointerDownOnVideo = true; };
    onPointerUp = () => { isPointerDownOnVideo = false; };
    window.addEventListener('pointerdown', onPointerDown, { passive: true });
    window.addEventListener('pointerup', onPointerUp, { passive: true });
    window.addEventListener('pointercancel', onPointerUp, { passive: true });

    // Track user clicks in YouTube native settings menu to avoid fighting rate changes
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('click', (e) => {
        if (e.target && e.target.closest && e.target.closest('.ytp-settings-menu, .ytp-panel-speed, .ytp-settings-button, .ytp-menuitem')) {
          lastNativeSettingsClickTime = Date.now();
          clearEnforcementTimers();
        }
      }, true);
    }

    window.addEventListener('unhandledrejection', (event) => {
      if (event && event.reason && String(event.reason.message || event.reason).includes('Extension context invalidated')) {
        try { event.preventDefault(); } catch (_) {}
        try { teardownKillSwitch(); } catch (_) {}
      }
    });

    window.addEventListener('error', (event) => {
      if (event && event.message && String(event.message).includes('Extension context invalidated')) {
        try { event.preventDefault(); } catch (_) {}
        try { teardownKillSwitch(); } catch (_) {}
      }
    });
  }

  function clearEnforcementTimers() {
    if (enforcementTimer) {
      clearTimeout(enforcementTimer);
      enforcementTimer = null;
    }
  }

  function safeStorageSetDebounced(items, delay = SYNC_THROTTLE_MS) {
    if (storageDebounceTimer) clearTimeout(storageDebounceTimer);
    storageDebounceTimer = setTimeout(() => {
      storageDebounceTimer = null;
      safeStorageSet(items);
    }, delay);
  }

  function isContextValid() {
    try {
      if (typeof chrome === 'undefined') return true;
      if (!chrome.runtime || !chrome.runtime.id) return false;
      if (typeof chrome.runtime.getManifest === 'function') {
        const manifest = chrome.runtime.getManifest();
        if (!manifest) return false;
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  function checkContextOrTeardown() {
    if (!isContextValid()) {
      try { teardownKillSwitch(); } catch (_) {}
      return false;
    }
    return true;
  }

  async function safeStorageGet(defaults) {
    try {
      if (!isContextValid() || typeof chrome === 'undefined' || !chrome.storage?.sync?.get) return defaults;
      const res = await chrome.storage.sync.get(defaults).catch(() => defaults);
      return res || defaults;
    } catch (_) {
      return defaults;
    }
  }

  function safeStorageSet(items) {
    if (storageDebounceTimer) {
      clearTimeout(storageDebounceTimer);
      storageDebounceTimer = null;
    }
    try {
      if (!isContextValid() || typeof chrome === 'undefined' || !chrome.storage?.sync?.set) return;
      const p = chrome.storage.sync.set(items);
      if (p && typeof p.catch === 'function') {
        p.catch(() => {});
      }
    } catch (_) {}
  }

  function removeExistingButton() {
    try {
      closeMenu();
      document.querySelectorAll(`.${SPEED_BUTTON_CLASS}`).forEach(el => {
        try { el.remove(); } catch (_) {}
      });
      currentButton = null;

      const toolbar = document.querySelector('.cineglow-floating-toolbar');
      if (toolbar) {
        let remainingCount = 0;
        try {
          remainingCount = toolbar.querySelectorAll ? toolbar.querySelectorAll('.cineglow-record-wrapper, .cineglow-pip-button, .cineglow-screenshot-button, .cineglow-speed-button').length : 0;
        } catch (_) {}
        const hasChildren = typeof toolbar.hasChildNodes === 'function' ? toolbar.hasChildNodes() : (toolbar.children && toolbar.children.length > 0);
        if (!hasChildren || remainingCount === 0) {
          if (typeof toolbar._autohideTeardown === 'function') {
            try { toolbar._autohideTeardown(); } catch (_) {}
          }
          try { toolbar.remove(); } catch (_) {}
        }
      }
    } catch (_) {}
  }

  function formatSpeed(rate) {
    if (rate === 1) return '1.0×';
    if (Number.isInteger(rate)) return `${rate}.0×`;
    const rounded = Math.round(rate * 100) / 100;
    if (Math.round(rounded * 10) === rounded * 10) {
      return `${rounded.toFixed(1)}×`;
    }
    return `${rounded.toFixed(2)}×`;
  }

  function showSpeedToast(player, rate) {
    if (!player) return;
    if (!toastEl || !player.contains(toastEl)) {
      if (toastEl) toastEl.remove();
      toastEl = document.createElement('div');
      toastEl.className = 'cineglow-speed-toast';
      player.appendChild(toastEl);
    }
    const icon = rate < 1.0 ? '🐢' : (rate > 2.0 ? '🚀' : '⚡');
    toastEl.textContent = `${icon} ${formatSpeed(rate)} Speed`;
    toastEl.classList.add('visible');

    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      if (toastEl) toastEl.classList.remove('visible');
    }, 900);
  }

  function enforcePlaybackSpeed(video, showToast = false) {
    if (isKilled || (typeof window !== 'undefined' && window.CineGlowKilled)) return;
    if (!checkContextOrTeardown()) return;
    const targetVideo = video || (window.CineGlowPlayer ? window.CineGlowPlayer.video : document.querySelector('video.html5-main-video') || document.querySelector('video'));
    if (!targetVideo) return;
    // If an ad is fast-forwarding at 16x, ignore and do not interfere with adblocker
    if (targetVideo.playbackRate > 15) return;

    // Detect YouTube's native "Hold to 2x" speed gesture or speedmaster overlay
    if ((isPointerDownOnVideo || (typeof document !== 'undefined' && document.querySelector('.ytp-speedmaster-overlay, .ytp-speedmaster-label'))) && targetVideo.playbackRate === 2.0 && preferredSpeed !== 2.0) {
      return;
    }

    const targetSpeed = preferredSpeed;
    const isBufferingInitial = targetVideo.readyState !== undefined && targetVideo.readyState < 2;

    if (targetVideo.defaultPlaybackRate !== targetSpeed) {
      try { targetVideo.defaultPlaybackRate = targetSpeed; } catch (_) {}
    }

    if (!isBufferingInitial && (targetVideo.playbackRate !== targetSpeed || targetVideo.defaultPlaybackRate !== targetSpeed)) {
      isApplyingSpeed = true;
      try {
        targetVideo.playbackRate = targetSpeed;
        targetVideo.defaultPlaybackRate = targetSpeed;
      } catch (_) {}
      // YouTube's native player API only accepts speeds <= 2.0 (rates: 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2.0).
      // Calling setPlaybackRate with > 2.0 triggers YouTube's internal rate clamping or fallback to 1.0.
      // Prevent resetting chunk buffer: only call setPlaybackRate if media is ready (readyState >= 2)
      if (targetSpeed <= 2.0 && (targetVideo.readyState === undefined || targetVideo.readyState >= 2)) {
        const player = document.getElementById('movie_player');
        if (player && typeof player.setPlaybackRate === 'function') {
          try {
            if (typeof player.getPlaybackRate !== 'function' || player.getPlaybackRate() !== targetSpeed) {
              player.setPlaybackRate(targetSpeed);
            }
          } catch (_) {}
        }
      }
      setTimeout(() => { isApplyingSpeed = false; }, 80);
    }

    // Sync preferred speed to main-world adblocker
    if (typeof window !== 'undefined' && typeof window.postMessage === 'function' && window.location?.origin) {
      try {
        window.postMessage({ type: 'CINEGLOW_SET_PREFERRED_SPEED', speed: targetSpeed }, window.location.origin);
      } catch (_) {}
    }

    currentSpeed = targetSpeed;
    updateButtonLabel(targetSpeed);
    if (activeMenu) syncMenuControls(targetSpeed);
    if (showToast) {
      const player = document.getElementById('movie_player');
      showSpeedToast(player, targetSpeed);
    }
  }

  function scheduleSpeedEnforcement(video, delay = 150) {
    if (isKilled || (typeof window !== 'undefined' && window.CineGlowKilled) || preferredSpeed === 1.0) return;
    if (!checkContextOrTeardown()) return;

    // If user clicked or interacted with YouTube native settings menu recently, do not override
    if ((Date.now() - lastNativeSettingsClickTime) < 1200 || isNativeSpeedMenuOpen()) {
      return;
    }

    const v = video || (window.CineGlowPlayer ? window.CineGlowPlayer.video : document.querySelector('video.html5-main-video') || document.querySelector('video'));
    if (!v) return;

    // If initial buffer is loading (readyState < 2), set defaultPlaybackRate and schedule deferred enforcement once media frames are ready
    if (v.readyState !== undefined && v.readyState < 2) {
      try { v.defaultPlaybackRate = preferredSpeed; } catch (_) {}
      const onReady = () => {
        if (isKilled || preferredSpeed === 1.0) return;
        if (v.readyState === undefined || v.readyState >= 2) {
          enforcePlaybackSpeed(v);
        }
      };
      try {
        if (typeof v.addEventListener === 'function') {
          v.addEventListener('canplay', onReady, { once: true, passive: true });
          v.addEventListener('playing', onReady, { once: true, passive: true });
        }
      } catch (_) {}
      return;
    }

    clearEnforcementTimers();
    enforcementTimer = setTimeout(() => {
      enforcementTimer = null;
      if (isKilled || (typeof window !== 'undefined' && window.CineGlowKilled)) return;
      if (!checkContextOrTeardown()) return;
      if ((Date.now() - lastNativeSettingsClickTime) < 1200 || isNativeSpeedMenuOpen()) {
        return;
      }
      if (v.playbackRate !== preferredSpeed && v.playbackRate <= 15) {
        enforcePlaybackSpeed(v);
      }
    }, delay);

    if (v.playbackRate !== preferredSpeed && v.playbackRate <= 15) {
      enforcePlaybackSpeed(v);
    }
  }

  function setPlaybackSpeed(rate, updateStorage = true) {
    if (isKilled || (typeof window !== 'undefined' && window.CineGlowKilled)) return;
    if (!checkContextOrTeardown()) return;
    rate = Math.min(Math.max(Math.round(rate * 100) / 100, 0.1), 10.0);
    currentSpeed = rate;
    preferredSpeed = rate;

    const video = window.CineGlowPlayer ? window.CineGlowPlayer.video : document.querySelector('video');
    enforcePlaybackSpeed(video, true);

    if (updateStorage) {
      safeStorageSet({ preferredSpeed: rate });
    }
  }

  function updateButtonLabel(rate) {
    if (!currentButton) return;
    const badge = currentButton.querySelector('.cineglow-speed-badge');
    if (badge) {
      const shortStr = rate === 1 ? '1×' : (rate >= 10 ? '10×' : `${rate}×`);
      badge.textContent = shortStr;
    }
    currentButton.title = `Playback Speed: ${formatSpeed(rate)} (Click to adjust scale)`;
  }

  function closeMenu() {
    if (outsideClickTimer) {
      clearTimeout(outsideClickTimer);
      outsideClickTimer = null;
    }
    if (activeOutsideClickListener) {
      if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
        try {
          document.removeEventListener('click', activeOutsideClickListener);
        } catch (_) {}
      }
      activeOutsideClickListener = null;
    }
    if (activeMenu) {
      const toolbar = activeMenu.closest ? activeMenu.closest('.cineglow-floating-toolbar') : null;
      if (toolbar && toolbar.classList) toolbar.classList.remove('cineglow-menu-open');
      try { activeMenu.remove(); } catch (_) {}
      activeMenu = null;
    }
  }

  function syncMenuControls(rate, skipSlider = null) {
    if (!activeMenu) return;
    const rateDisplay = activeMenu.querySelector('.cineglow-speed-current-val');
    const scale0Slider = activeMenu.querySelector('.cineglow-scale0-slider');
    const scale1Slider = activeMenu.querySelector('.cineglow-scale1-slider');
    const scale2Slider = activeMenu.querySelector('.cineglow-scale2-slider');
    const scale0Val = activeMenu.querySelector('.cineglow-scale0-val');
    const scale1Val = activeMenu.querySelector('.cineglow-scale1-val');
    const scale2Val = activeMenu.querySelector('.cineglow-scale2-val');
    const scale0Box = activeMenu.querySelector('.cineglow-scale0-box');
    const scale1Box = activeMenu.querySelector('.cineglow-scale1-box');
    const scale2Box = activeMenu.querySelector('.cineglow-scale2-box');

    if (rateDisplay) rateDisplay.textContent = formatSpeed(rate);

    if (rate < 1.0) {
      if (scale0Slider && scale0Slider !== skipSlider) scale0Slider.value = rate;
      if (scale1Slider && scale1Slider !== skipSlider) scale1Slider.value = 1.0;
      if (scale2Slider && scale2Slider !== skipSlider) scale2Slider.value = 2.0;

      if (scale0Val) scale0Val.textContent = formatSpeed(rate);
      if (scale1Val) scale1Val.textContent = '1.0×';
      if (scale2Val) scale2Val.textContent = '2.0×';

      if (scale0Box) scale0Box.classList.add('scale-active');
      if (scale1Box) scale1Box.classList.remove('scale-active');
      if (scale2Box) scale2Box.classList.remove('scale-active');
    } else if (rate <= 2.0) {
      if (scale0Slider && scale0Slider !== skipSlider) scale0Slider.value = 1.0;
      if (scale1Slider && scale1Slider !== skipSlider) scale1Slider.value = rate;
      if (scale2Slider && scale2Slider !== skipSlider) scale2Slider.value = 2.0;

      if (scale0Val) scale0Val.textContent = '1.0×';
      if (scale1Val) scale1Val.textContent = formatSpeed(rate);
      if (scale2Val) scale2Val.textContent = '2.0×';

      if (scale0Box) scale0Box.classList.remove('scale-active');
      if (scale1Box) scale1Box.classList.add('scale-active');
      if (scale2Box) scale2Box.classList.remove('scale-active');
    } else {
      if (scale0Slider && scale0Slider !== skipSlider) scale0Slider.value = 1.0;
      if (scale1Slider && scale1Slider !== skipSlider) scale1Slider.value = 2.0;
      if (scale2Slider && scale2Slider !== skipSlider) scale2Slider.value = rate;

      if (scale0Val) scale0Val.textContent = '1.0×';
      if (scale1Val) scale1Val.textContent = '2.0×';
      if (scale2Val) scale2Val.textContent = formatSpeed(rate);

      if (scale0Box) scale0Box.classList.remove('scale-active');
      if (scale1Box) scale1Box.classList.remove('scale-active');
      if (scale2Box) scale2Box.classList.add('scale-active');
    }

    activeMenu.querySelectorAll('.cineglow-preset-pill').forEach(btn => {
      const pVal = parseFloat(btn.dataset.speed);
      btn.classList.toggle('active', Math.abs(pVal - rate) < 0.04);
    });
  }

  function openSpeedMenu(anchorBtn, player) {
    if (activeMenu) {
      const wasConnected = Boolean(activeMenu.isConnected || activeMenu.parentElement);
      closeMenu();
      if (wasConnected) {
        return;
      }
    }

    const menu = document.createElement('div');
    menu.className = 'cineglow-speed-menu';

    // Isolate all mouse/touch/pointer events from bubbling to YouTube player (#movie_player)
    ['pointerdown', 'mousedown', 'mouseup', 'click', 'touchstart', 'touchend'].forEach(evtType => {
      menu.addEventListener(evtType, (e) => {
        e.stopPropagation();
      });
    });

    // Header with live readout and reset button
    const header = document.createElement('div');
    header.className = 'cineglow-speed-header';
    header.innerHTML = `
      <div class="cineglow-speed-header-left">
        <svg viewBox="0 0 24 24" class="cineglow-speed-header-icon">
          <path d="${SPEED_ICON_PATH}" fill="currentColor"/>
        </svg>
        <span class="cineglow-speed-header-title">Playback Speed</span>
      </div>
      <div class="cineglow-speed-header-right">
        <span class="cineglow-speed-current-val">${formatSpeed(currentSpeed)}</span>
        <button class="cineglow-speed-reset-btn" title="Reset to normal speed (1.0×)">Reset</button>
      </div>
    `;
    menu.appendChild(header);

    const resetBtn = header.querySelector('.cineglow-speed-reset-btn');
    if (resetBtn) {
      resetBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        setPlaybackSpeed(1.0);
      });
    }

    // Scale 0: 0.1x to 1.0x (Slow-Mo scale)
    const scale0Box = document.createElement('div');
    scale0Box.className = `cineglow-scale-box cineglow-scale0-box ${currentSpeed < 1.0 ? 'scale-active' : ''}`;
    scale0Box.innerHTML = `
      <div class="cineglow-scale-row">
        <span class="cineglow-scale-name">Slow-Mo Scale (0.1× – 1.0×)</span>
        <span class="cineglow-scale-val cineglow-scale0-val">${currentSpeed < 1.0 ? formatSpeed(currentSpeed) : '1.0×'}</span>
      </div>
      <input type="range" class="cineglow-scale-slider cineglow-scale0-slider" min="0.1" max="1.0" step="0.05" value="${currentSpeed < 1.0 ? currentSpeed : 1.0}">
      <div class="cineglow-scale-ruler">
        <span>0.1×</span>
        <span>0.25×</span>
        <span>0.5×</span>
        <span>0.75×</span>
        <span>1.0×</span>
      </div>
    `;
    menu.appendChild(scale0Box);

    // Scale 1: 1.0x to 2.0x (Precision scale)
    const scale1Box = document.createElement('div');
    scale1Box.className = `cineglow-scale-box cineglow-scale1-box ${currentSpeed >= 1.0 && currentSpeed <= 2.0 ? 'scale-active' : ''}`;
    scale1Box.innerHTML = `
      <div class="cineglow-scale-row">
        <span class="cineglow-scale-name">Precision Scale (1.0× – 2.0×)</span>
        <span class="cineglow-scale-val cineglow-scale1-val">${currentSpeed >= 1.0 && currentSpeed <= 2.0 ? formatSpeed(currentSpeed) : (currentSpeed < 1.0 ? '1.0×' : '2.0×')}</span>
      </div>
      <input type="range" class="cineglow-scale-slider cineglow-scale1-slider" min="1.0" max="2.0" step="0.05" value="${Math.min(Math.max(currentSpeed, 1.0), 2.0)}">
      <div class="cineglow-scale-ruler">
        <span>1.0×</span>
        <span>1.25×</span>
        <span>1.5×</span>
        <span>1.75×</span>
        <span>2.0×</span>
      </div>
    `;
    menu.appendChild(scale1Box);

    // Scale 2: 2.0x to 10.0x (Turbo scale)
    const scale2Box = document.createElement('div');
    scale2Box.className = `cineglow-scale-box cineglow-scale2-box ${currentSpeed > 2.0 ? 'scale-active' : ''}`;
    scale2Box.innerHTML = `
      <div class="cineglow-scale-row">
        <span class="cineglow-scale-name">Turbo Scale (2.0× – 10.0×)</span>
        <span class="cineglow-scale-val cineglow-scale2-val">${currentSpeed >= 2.0 ? formatSpeed(currentSpeed) : '2.0×'}</span>
      </div>
      <input type="range" class="cineglow-scale-slider cineglow-scale2-slider" min="2.0" max="10.0" step="0.2" value="${Math.max(currentSpeed, 2.0)}">
      <div class="cineglow-scale-ruler">
        <span>2×</span>
        <span>4×</span>
        <span>6×</span>
        <span>8×</span>
        <span>10×</span>
      </div>
    `;
    menu.appendChild(scale2Box);

    // Quick Presets Bar: Single row (0.25x, 0.5x, 1x, 1.5x, 2x, 5x)
    const presetsRow = document.createElement('div');
    presetsRow.className = 'cineglow-presets-row';
    PRESET_SPEEDS.forEach(p => {
      const pill = document.createElement('button');
      pill.className = `cineglow-preset-pill ${Math.abs(p - currentSpeed) < 0.04 ? 'active' : ''}`;
      pill.dataset.speed = String(p);
      pill.textContent = p === 1 ? '1×' : `${p}×`;
      pill.title = `${formatSpeed(p)} Speed`;
      pill.addEventListener('click', (e) => {
        e.stopPropagation();
        setPlaybackSpeed(p);
      });
      presetsRow.appendChild(pill);
    });
    menu.appendChild(presetsRow);

    const applySliderSpeed = (val, sourceSlider = null) => {
      const rate = Math.min(Math.max(Math.round(val * 100) / 100, 0.1), 10.0);
      currentSpeed = rate;
      preferredSpeed = rate;
      const v = window.CineGlowPlayer ? window.CineGlowPlayer.video : document.querySelector('video');
      if (v) {
        isApplyingSpeed = true;
        try {
          v.playbackRate = rate;
          v.defaultPlaybackRate = rate;
        } catch (_) {}
        setTimeout(() => { isApplyingSpeed = false; }, 80);
      }
      updateButtonLabel(rate);
      syncMenuControls(rate, sourceSlider);
      safeStorageSetDebounced({ preferredSpeed: rate }, SYNC_THROTTLE_MS);
    };

    // Slider 0 Events (Slow-Mo: Drag & Wheel)
    const s0 = scale0Box.querySelector('.cineglow-scale0-slider');
    if (s0) {
      s0.addEventListener('input', (e) => {
        e.stopPropagation();
        applySliderSpeed(parseFloat(s0.value), s0);
      });
      s0.addEventListener('change', (e) => {
        e.stopPropagation();
        setPlaybackSpeed(parseFloat(s0.value));
      });
    }
    scale0Box.addEventListener('wheel', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const delta = e.deltaY < 0 ? 0.05 : -0.05;
      const target = Math.min(Math.max(Math.round((currentSpeed + delta) * 100) / 100, 0.1), 1.0);
      applySliderSpeed(target);
    }, { passive: false });

    // Slider 1 Events (Precision: Drag & Wheel)
    const s1 = scale1Box.querySelector('.cineglow-scale1-slider');
    if (s1) {
      s1.addEventListener('input', (e) => {
        e.stopPropagation();
        applySliderSpeed(parseFloat(s1.value), s1);
      });
      s1.addEventListener('change', (e) => {
        e.stopPropagation();
        setPlaybackSpeed(parseFloat(s1.value));
      });
    }
    scale1Box.addEventListener('wheel', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const delta = e.deltaY < 0 ? 0.05 : -0.05;
      const target = Math.min(Math.max(Math.round((currentSpeed + delta) * 100) / 100, 1.0), 2.0);
      applySliderSpeed(target);
    }, { passive: false });

    // Slider 2 Events (Turbo: Drag & Wheel)
    const s2 = scale2Box.querySelector('.cineglow-scale2-slider');
    if (s2) {
      s2.addEventListener('input', (e) => {
        e.stopPropagation();
        applySliderSpeed(parseFloat(s2.value), s2);
      });
      s2.addEventListener('change', (e) => {
        e.stopPropagation();
        setPlaybackSpeed(parseFloat(s2.value));
      });
    }
    scale2Box.addEventListener('wheel', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const delta = e.deltaY < 0 ? 0.2 : -0.2;
      const target = Math.min(Math.max(Math.round((currentSpeed + delta) * 10) / 10, 2.0), 10.0);
      applySliderSpeed(target);
    }, { passive: false });

    // Mount to floating toolbar
    const toolbar = anchorBtn.closest('.cineglow-floating-toolbar') || player;
    toolbar.appendChild(menu);
    toolbar.classList.add('cineglow-menu-open');
    toolbar.classList.remove('cineglow-toolbar-hidden');
    activeMenu = menu;

    activeOutsideClickListener = (e) => {
      if (activeMenu && !activeMenu.contains(e.target) && (!anchorBtn || !anchorBtn.contains(e.target))) {
        closeMenu();
      }
    };
    if (outsideClickTimer) {
      clearTimeout(outsideClickTimer);
      outsideClickTimer = null;
    }
    outsideClickTimer = setTimeout(() => {
      outsideClickTimer = null;
      if (activeMenu === menu && typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
        document.addEventListener('click', activeOutsideClickListener);
      }
    }, 0);
  }

  function initToolbarAutohide(player, toolbar) {
    if (toolbar._autohideInitialized) return;
    toolbar._autohideInitialized = true;

    let hideTimeout = 0;

    const syncVisibility = () => {
      // NEVER hide if hovered, focused, or if any menu is open
      const isHovered = toolbar.matches(':hover') || toolbar.querySelector(':hover');
      const isMenuOpen = toolbar.classList.contains('cineglow-menu-open') || 
                         toolbar.querySelector('.cineglow-rec-menu, .cineglow-speed-menu');
      const isFocused = toolbar.matches(':focus-within');

      if (isHovered || isMenuOpen || isFocused) {
        toolbar.classList.remove('cineglow-toolbar-hidden');
        return;
      }

      const isAutohide = player.classList.contains('ytp-autohide') || 
                         player.classList.contains('ytp-hide-controls');
      const chromeBottom = player.querySelector('.ytp-chrome-bottom');
      const isChromeHidden = chromeBottom && (
        chromeBottom.hidden ||
        chromeBottom.style.display === 'none' ||
        chromeBottom.classList.contains('ytp-chrome-hidden')
      );

      if (isAutohide || isChromeHidden) {
        toolbar.classList.add('cineglow-toolbar-hidden');
      } else {
        toolbar.classList.remove('cineglow-toolbar-hidden');
      }
    };

    const observer = new MutationObserver(() => syncVisibility());
    observer.observe(player, { attributes: true, attributeFilter: ['class'] });

    const chromeBottom = player.querySelector('.ytp-chrome-bottom');
    if (chromeBottom) {
      observer.observe(chromeBottom, { attributes: true, attributeFilter: ['style', 'class'] });
    }

    const onToolbarMouseEnter = () => {
      toolbar.classList.remove('cineglow-toolbar-hidden');
    };

    const onToolbarMouseMove = () => {
      toolbar.classList.remove('cineglow-toolbar-hidden');
    };

    const onToolbarMouseLeave = () => {
      clearTimeout(hideTimeout);
      hideTimeout = setTimeout(syncVisibility, 200);
    };

    const onPlayerMouseEnter = () => {
      toolbar.classList.remove('cineglow-toolbar-hidden');
    };

    const onPlayerMouseMove = () => {
      toolbar.classList.remove('cineglow-toolbar-hidden');
    };

    toolbar.addEventListener('mouseenter', onToolbarMouseEnter);
    toolbar.addEventListener('mousemove', onToolbarMouseMove);
    toolbar.addEventListener('mouseleave', onToolbarMouseLeave);
    player.addEventListener('mouseenter', onPlayerMouseEnter);
    player.addEventListener('mousemove', onPlayerMouseMove);

    const teardownAutohide = () => {
      clearTimeout(hideTimeout);
      if (observer) {
        try { observer.disconnect(); } catch (_) {}
      }
      try { toolbar.removeEventListener('mouseenter', onToolbarMouseEnter); } catch (_) {}
      try { toolbar.removeEventListener('mousemove', onToolbarMouseMove); } catch (_) {}
      try { toolbar.removeEventListener('mouseleave', onToolbarMouseLeave); } catch (_) {}
      try { player.removeEventListener('mouseenter', onPlayerMouseEnter); } catch (_) {}
      try { player.removeEventListener('mousemove', onPlayerMouseMove); } catch (_) {}
      toolbar._autohideInitialized = false;
      delete toolbar._autohideTeardown;
      delete toolbar._teardownAutohide;
    };

    toolbar._autohideTeardown = teardownAutohide;
    toolbar._teardownAutohide = teardownAutohide;

    syncVisibility();
  }

  function waitForFloatingToolbar(player, signal) {
    return new Promise((resolve) => {
      const getToolbar = () => {
        let toolbar = player.querySelector('.cineglow-floating-toolbar');
        if (toolbar) return toolbar;

        toolbar = document.createElement('div');
        toolbar.className = 'cineglow-floating-toolbar cineglow-vertical-toolbar';
        player.appendChild(toolbar);
        initToolbarAutohide(player, toolbar);
        return toolbar;
      };

      const existing = getToolbar();
      if (existing) {
        resolve(existing);
        return;
      }

      const observer = new MutationObserver(() => {
        const el = getToolbar();
        if (el) {
          observer.disconnect();
          resolve(el);
        }
      });

      signal.addEventListener('abort', () => {
        observer.disconnect();
        resolve(null);
      }, { once: true });

      observer.observe(player, { childList: true, subtree: true });
    });
  }

  async function injectSpeedButton(playerManager) {
    if (isKilled || (typeof window !== 'undefined' && window.CineGlowKilled)) return;
    if (!checkContextOrTeardown()) return;
    if (isInjectingSpeedButton) return;
    isInjectingSpeedButton = true;
    try {
      const { player, isWatchPage, video } = playerManager;

      if (abortController) {
        abortController.abort();
      }
      abortController = new AbortController();
      const signal = abortController.signal;

      if (!isWatchPage || !player) {
        removeExistingButton();
        return;
      }

      if (currentButton && player.contains(currentButton)) {
        return;
      }

      removeExistingButton();

      const toolbar = await waitForFloatingToolbar(player, signal);
      if (!toolbar || signal.aborted) return;

      // Purge any existing or duplicate speed buttons inside the toolbar
      if (typeof toolbar.querySelectorAll === 'function') {
        toolbar.querySelectorAll(`.${SPEED_BUTTON_CLASS}`).forEach(el => el.remove());
      }

      // Load initial preferred speed from settings
      try {
        const stored = await safeStorageGet({ preferredSpeed: 1.0 });
        if (stored && typeof stored.preferredSpeed === 'number') {
          if (stored.preferredSpeed > 10.0 || stored.preferredSpeed < 0.1) {
            preferredSpeed = 1.0;
            safeStorageSet({ preferredSpeed: 1.0 });
          } else {
            preferredSpeed = stored.preferredSpeed;
          }
          currentSpeed = preferredSpeed;
        }
      } catch (e) {}

      if (signal.aborted) return;

      const btn = document.createElement('button');
      btn.className = `ytp-button ${SPEED_BUTTON_CLASS}`;
      btn.title = `Playback Speed: ${formatSpeed(currentSpeed)} (Click for speed scales)`;
      btn.setAttribute('aria-label', 'Playback Speed');

      const inner = document.createElement('div');
      inner.className = 'cineglow-speed-inner';

      const xmlns = 'http://www.w3.org/2000/svg';
      const svgElem = document.createElementNS(xmlns, 'svg');
      svgElem.setAttributeNS(null, 'viewBox', '0 0 24 24');
      svgElem.setAttributeNS(null, 'width', '100%');
      svgElem.setAttributeNS(null, 'height', '100%');
      try {
        if (svgElem.className && typeof svgElem.className === 'object') {
          svgElem.className.baseVal = 'cineglow-speed-icon';
        } else {
          svgElem.setAttribute('class', 'cineglow-speed-icon');
        }
      } catch (_) {
        svgElem.setAttribute('class', 'cineglow-speed-icon');
      }

      const pathEl = document.createElementNS(xmlns, 'path');
      pathEl.setAttributeNS(null, 'd', SPEED_ICON_PATH);
      pathEl.setAttributeNS(null, 'fill', 'currentColor');
      svgElem.appendChild(pathEl);

      const badge = document.createElement('span');
      badge.className = 'cineglow-speed-badge';
      badge.textContent = currentSpeed === 1 ? '1×' : `${currentSpeed}×`;

      inner.appendChild(svgElem);
      inner.appendChild(badge);
      btn.appendChild(inner);

      // Prevent pointerdown/mousedown on button from triggering YouTube player interactions
      ['pointerdown', 'mousedown', 'touchstart'].forEach(evtType => {
        btn.addEventListener(evtType, (e) => {
          e.stopPropagation();
        });
      });

      // Left click & Right click both toggle the multi-scale menu
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openSpeedMenu(btn, player);
      });

      // Double click immediately resets speed to 1.0x (keeps menu open)
      btn.addEventListener('dblclick', (e) => {
        e.preventDefault();
        e.stopPropagation();
        setPlaybackSpeed(1.0);
      });

      btn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openSpeedMenu(btn, player);
      });

      // In stack: Speed button goes strictly above Screenshot button (top of stack)
      const screenshotBtn = toolbar.querySelector('.cineglow-screenshot-button');
      const pipBtn = toolbar.querySelector('.cineglow-pip-button');
      if (screenshotBtn) {
        toolbar.insertBefore(btn, screenshotBtn);
      } else if (pipBtn) {
        toolbar.insertBefore(btn, pipBtn);
      } else {
        toolbar.appendChild(btn);
      }

      currentButton = btn;

      bindVideoListeners(video);
    } finally {
      isInjectingSpeedButton = false;
    }
  }

  function unbindVideoListeners() {
    if (boundVideo) {
      try {
        if (onRateChange) boundVideo.removeEventListener('ratechange', onRateChange);
        if (onLoadedMetadata) boundVideo.removeEventListener('loadedmetadata', onLoadedMetadata);
        if (onCanPlay) boundVideo.removeEventListener('canplay', onCanPlay);
        if (onPlaying) boundVideo.removeEventListener('playing', onPlaying);
      } catch (_) {}
      boundVideo = null;
    }
  }

  function bindVideoListeners(video) {
    if (!video) return;
    if (video === boundVideo) {
      if (preferredSpeed !== 1.0) scheduleSpeedEnforcement(video);
      return;
    }
    unbindVideoListeners();
    boundVideo = video;

    onRateChange = () => {
      if (isKilled) return;
      if (!checkContextOrTeardown()) return;
      // If an ad is fast-forwarding at 16x, ignore and track ad timestamp
      if (video.playbackRate > 15) {
        lastAdEndTime = Date.now();
        return;
      }
      if (checkAdActive()) return;

      // If this rate change was triggered by CineGlow itself, ignore
      if (isApplyingSpeed) return;
      // If user is holding pointer down on video (YouTube's native "Hold to 2x") or speedmaster active, ignore
      const isHoldTo2x = (isPointerDownOnVideo || Boolean(document.querySelector('.ytp-speedmaster-overlay, .ytp-speedmaster-label'))) && video.playbackRate === 2.0 && preferredSpeed !== 2.0;
      if (isHoldTo2x) return;

      const isHotkeyPress = (Date.now() - lastSpeedKeypressTime) < 600;
      const isNativeSettingsAction = (Date.now() - lastNativeSettingsClickTime) < 1200 || isNativeSpeedMenuOpen();
      const isDuringNewVideoLoad = (Date.now() - lastNavigatedTime) < 2500 || (typeof video.currentTime === 'number' && video.currentTime < 0.5);
      const isAdTransition = (Date.now() - lastAdEndTime) < 1500 || checkAdActive();

      // Check if YouTube's player reset the playbackRate to 1.0 on video load/navigation or post-ad
      if (video.playbackRate === 1.0 && preferredSpeed !== 1.0) {
        // If mid-roll ad concluded or during ad transition, never treat as manual reset; re-enforce preferred speed
        if (isAdTransition && !isHotkeyPress && !isNativeSettingsAction) {
          enforcePlaybackSpeed(video);
          scheduleSpeedEnforcement(video);
          return;
        }

        // If this was an intentional reset by hotkey, settings menu, or happened during active video playback:
        if (!isDuringNewVideoLoad || isHotkeyPress || isNativeSettingsAction) {
          clearEnforcementTimers();
          currentSpeed = 1.0;
          preferredSpeed = 1.0;
          updateButtonLabel(1.0);
          if (activeMenu) syncMenuControls(1.0);
          safeStorageSet({ preferredSpeed: 1.0 });
          return;
        }

        // Otherwise, this is YouTube's automatic reset to 1.0 on new video load/navigation
        scheduleSpeedEnforcement(video);
        return;
      }

      if (isNativeSettingsAction) {
        clearEnforcementTimers();
      }

      currentSpeed = video.playbackRate;
      preferredSpeed = video.playbackRate;
      updateButtonLabel(currentSpeed);
      if (activeMenu) syncMenuControls(currentSpeed);
      safeStorageSetDebounced({ preferredSpeed: currentSpeed }, SYNC_THROTTLE_MS);
    };

    onLoadedMetadata = () => { if (checkContextOrTeardown() && preferredSpeed !== 1.0) scheduleSpeedEnforcement(video); };
    onCanPlay = () => { if (checkContextOrTeardown() && preferredSpeed !== 1.0) scheduleSpeedEnforcement(video); };
    onPlaying = () => { if (checkContextOrTeardown() && preferredSpeed !== 1.0) scheduleSpeedEnforcement(video); };

    video.addEventListener('ratechange', onRateChange, { passive: true });
    video.addEventListener('loadedmetadata', onLoadedMetadata, { passive: true });
    video.addEventListener('canplay', onCanPlay, { passive: true });
    video.addEventListener('playing', onPlaying, { passive: true });

    // Apply preferred speed if non-default on load
    if (preferredSpeed !== 1.0) {
      scheduleSpeedEnforcement(video);
    }
  }

  // --- Emergency Kill-Switch Teardown ---
  function teardownKillSwitch() {
    if (isKilled) return;
    isKilled = true;
    if (typeof window !== 'undefined') window.CineGlowKilled = true;

    try {
      if (abortController) {
        abortController.abort();
        abortController = null;
      }
      unbindVideoListeners();
      clearEnforcementTimers();
      if (storageDebounceTimer) {
        clearTimeout(storageDebounceTimer);
        storageDebounceTimer = null;
      }
      if (onCaptureMediaEvent && typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
        try {
          document.removeEventListener('ratechange', onCaptureMediaEvent, true);
          document.removeEventListener('loadedmetadata', onCaptureMediaEvent, true);
          document.removeEventListener('canplay', onCaptureMediaEvent, true);
          document.removeEventListener('play', onCaptureMediaEvent, true);
          document.removeEventListener('playing', onCaptureMediaEvent, true);
          onCaptureMediaEvent = null;
        } catch (_) {}
      }
      if (onDocumentNavigation) {
        document.removeEventListener('yt-navigate-finish', onDocumentNavigation);
        document.removeEventListener('yt-page-data-updated', onDocumentNavigation);
        document.removeEventListener('yt-navigate-start', onDocumentNavigation);
        onDocumentNavigation = null;
      }
      if (onPlayerStateChange && window.CineGlowPlayer && typeof window.CineGlowPlayer.removeEventListener === 'function') {
        try { window.CineGlowPlayer.removeEventListener('state-change', onPlayerStateChange); } catch (_) {}
        onPlayerStateChange = null;
      }
      if (onWindowKeydown && typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
        try { window.removeEventListener('keydown', onWindowKeydown); } catch (_) {}
        onWindowKeydown = null;
      }
      if (onPointerDown && typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
        try {
          window.removeEventListener('pointerdown', onPointerDown);
          window.removeEventListener('pointerup', onPointerUp);
          window.removeEventListener('pointercancel', onPointerUp);
          onPointerDown = null;
          onPointerUp = null;
        } catch (_) {}
      }
      if (outsideClickTimer) {
        clearTimeout(outsideClickTimer);
        outsideClickTimer = null;
      }
      if (activeOutsideClickListener && typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
        try {
          document.removeEventListener('click', activeOutsideClickListener);
        } catch (_) {}
        activeOutsideClickListener = null;
      }
      clearTimeout(toastTimeout);
      lastAdEndTime = 0;
      lastWasAdShowing = false;
      if (toastEl) {
        toastEl.remove();
        toastEl = null;
      }
      removeExistingButton();
      const toolbar = document.querySelector('.cineglow-floating-toolbar');
      if (toolbar) {
        if (typeof toolbar._autohideTeardown === 'function') {
          try { toolbar._autohideTeardown(); } catch (_) {}
        }
        let remainingCount = 0;
        try {
          remainingCount = toolbar.querySelectorAll ? toolbar.querySelectorAll('.cineglow-record-wrapper, .cineglow-pip-button, .cineglow-screenshot-button, .cineglow-speed-button').length : 0;
        } catch (_) {}
        const hasChildren = typeof toolbar.hasChildNodes === 'function' ? toolbar.hasChildNodes() : (toolbar.children && toolbar.children.length > 0);
        if (!hasChildren || remainingCount === 0) {
          try { toolbar.remove(); } catch (_) {}
        }
      }
    } catch (_) {}
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
          sendResponse({ success: true, script: 'speed-button.js' });
        }
      }
    });
  }

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('cineglow:kill-switch', () => {
      teardownKillSwitch();
    }, { once: true });
  }

  window.CineGlowSpeedTeardown = teardownKillSwitch;
  window.CineGlowSpeed = {
    get currentSpeed() { return currentSpeed; },
    get preferredSpeed() { return preferredSpeed; },
    get lastNavigatedTime() { return lastNavigatedTime; },
    set lastNavigatedTime(val) { lastNavigatedTime = val; },
    get lastAdEndTime() { return lastAdEndTime; },
    set lastAdEndTime(val) { lastAdEndTime = val; },
    setPlaybackSpeed,
    enforcePlaybackSpeed,
    scheduleSpeedEnforcement,
    teardownKillSwitch
  };

  // Listen to CineGlow centralized player lifecycle
  if (window.CineGlowPlayer) {
    onPlayerStateChange = (e) => {
      if (isKilled) return;
      if (!checkContextOrTeardown()) return;
      const state = e.detail;
      if (state.isAdShowing) {
        lastAdEndTime = Date.now();
      } else if (lastWasAdShowing) {
        lastAdEndTime = Date.now();
        if (state.video && preferredSpeed !== 1.0) {
          scheduleSpeedEnforcement(state.video);
        }
      }
      lastWasAdShowing = Boolean(state.isAdShowing);
      if (state.isWatchPage && state.player) {
        if (!currentButton || !state.player.contains(currentButton)) {
          injectSpeedButton(state);
        } else if (state.video) {
          bindVideoListeners(state.video);
        }
        if (state.videoId && state.videoId !== lastVideoId) {
          lastVideoId = state.videoId;
          lastNavigatedTime = Date.now();
          if (preferredSpeed !== 1.0) scheduleSpeedEnforcement(state.video);
        }
      } else {
        removeExistingButton();
      }
    };
    window.CineGlowPlayer.addEventListener('state-change', onPlayerStateChange);

    injectSpeedButton(window.CineGlowPlayer);
  }

  // SPA Navigation listeners for YouTube
  onDocumentNavigation = () => {
    if (isKilled) return;
    if (!checkContextOrTeardown()) return;
    lastNavigatedTime = Date.now();
    const video = window.CineGlowPlayer ? window.CineGlowPlayer.video : document.querySelector('video');
    if (video && preferredSpeed !== 1.0) scheduleSpeedEnforcement(video);
  };
  document.addEventListener('yt-navigate-finish', onDocumentNavigation, { passive: true });
  document.addEventListener('yt-page-data-updated', onDocumentNavigation, { passive: true });
  document.addEventListener('yt-navigate-start', onDocumentNavigation, { passive: true });

  // Global document-level capture listener guarantees speed enforcement on ANY video element
  // regardless of SPA swaps, dynamic player re-instantiations, or delayed media loading.
  let onCaptureMediaEvent = null;
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    onCaptureMediaEvent = (e) => {
      if (isKilled || (typeof window !== 'undefined' && window.CineGlowKilled)) return;
      if (!checkContextOrTeardown()) return;
      const target = e.target;
      if (!target) return;
      const tag = (target.tagName || target.nodeName || '').toUpperCase();
      if (tag !== 'VIDEO') return;
      if (target.playbackRate > 15) {
        lastAdEndTime = Date.now();
        return; // In-ad fast-forward (handled by adblocker)
      }
      if (checkAdActive()) return;

      if (e.type === 'ratechange') {
        if (isApplyingSpeed) return;
        // Detect YouTube's native "Hold to 2x" speed gesture
        const isHoldTo2x = (isPointerDownOnVideo || Boolean(document.querySelector('.ytp-speedmaster-overlay, .ytp-speedmaster-label'))) && target.playbackRate === 2.0 && preferredSpeed !== 2.0;
        if (isHoldTo2x) return;

        const isHotkeyPress = (Date.now() - lastSpeedKeypressTime) < 600;
        const isNativeSettingsAction = (Date.now() - lastNativeSettingsClickTime) < 1200 || isNativeSpeedMenuOpen();
        const isDuringNewVideoLoad = (Date.now() - lastNavigatedTime) < 2500 || (typeof target.currentTime === 'number' && target.currentTime < 0.5);
        const isAdTransition = (Date.now() - lastAdEndTime) < 1500 || checkAdActive();

        // If target reset to 1.0 while preferred speed is non-1.0:
        if (target.playbackRate === 1.0 && preferredSpeed !== 1.0) {
          if (isAdTransition && !isHotkeyPress && !isNativeSettingsAction) {
            enforcePlaybackSpeed(target);
            scheduleSpeedEnforcement(target);
            return;
          }

          if (!isDuringNewVideoLoad || isHotkeyPress || isNativeSettingsAction) {
            clearEnforcementTimers();
            currentSpeed = 1.0;
            preferredSpeed = 1.0;
            updateButtonLabel(1.0);
            if (activeMenu) syncMenuControls(1.0);
            safeStorageSet({ preferredSpeed: 1.0 });
            return;
          }
          scheduleSpeedEnforcement(target);
          return;
        }

        if (isNativeSettingsAction) {
          clearEnforcementTimers();
        }

        // Accept user-initiated speed changes from YouTube native menu or controls
        currentSpeed = target.playbackRate;
        preferredSpeed = target.playbackRate;
        updateButtonLabel(currentSpeed);
        if (activeMenu) syncMenuControls(currentSpeed);
        safeStorageSetDebounced({ preferredSpeed: currentSpeed }, SYNC_THROTTLE_MS);
      } else {
        // loadedmetadata, canplay, play, playing
        if (preferredSpeed !== 1.0) {
          scheduleSpeedEnforcement(target);
        }
      }
    };

    document.addEventListener('ratechange', onCaptureMediaEvent, true);
    document.addEventListener('loadedmetadata', onCaptureMediaEvent, true);
    document.addEventListener('canplay', onCaptureMediaEvent, true);
    document.addEventListener('play', onCaptureMediaEvent, true);
    document.addEventListener('playing', onCaptureMediaEvent, true);
  }

  // Early storage load
  safeStorageGet({ preferredSpeed: 1.0 }).then(stored => {
    if (isKilled || !isContextValid()) return;
    if (stored && typeof stored.preferredSpeed === 'number') {
      if (stored.preferredSpeed > 10.0 || stored.preferredSpeed < 0.1) {
        preferredSpeed = 1.0;
        safeStorageSet({ preferredSpeed: 1.0 });
      } else {
        preferredSpeed = stored.preferredSpeed;
      }
      currentSpeed = preferredSpeed;
      updateButtonLabel(currentSpeed);
      if (activeMenu) syncMenuControls(currentSpeed);
      const video = window.CineGlowPlayer ? window.CineGlowPlayer.video : document.querySelector('video');
      if (video && preferredSpeed !== 1.0) scheduleSpeedEnforcement(video);
    }
  }).catch(() => {});

  // Storage listener for external popup changes
  if (isContextValid() && typeof chrome !== 'undefined' && chrome.storage?.onChanged?.addListener) {
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (isKilled || (typeof window !== 'undefined' && window.CineGlowKilled)) return;
        if (!checkContextOrTeardown()) return;
        if (area === 'sync' && changes.preferredSpeed) {
          const newRate = changes.preferredSpeed.newValue;
          if (typeof newRate === 'number' && newRate !== currentSpeed) {
            setPlaybackSpeed(newRate, false);
          }
        }
      });
    } catch (_) {}
  }
})();

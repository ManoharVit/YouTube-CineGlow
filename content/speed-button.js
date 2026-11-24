(() => {
  'use strict';

  const SPEED_BUTTON_CLASS = 'cineglow-speed-button';
  const SPEED_ICON_PATH = 'M12 4a8 8 0 0 0-8 8c0 2.2.9 4.2 2.3 5.7l1.4-1.4A6 6 0 0 1 6 12a6 6 0 1 1 12 0c0 1.6-.6 3-1.7 4.3l1.4 1.4A8 8 0 0 0 12 4zm-1 4v4.6l2.8 1.7.8-1.3-2.1-1.3V8h-1.5z';
  const PRESET_SPEEDS = [0.25, 0.5, 1.0, 1.5, 2.0, 5.0];
  const SYNC_THROTTLE_MS = 550;

  const lifecycle = new AbortController();
  const { signal } = lifecycle;

  let currentButton = null;
  let activeMenu = null;
  let menuAbortController = null;
  let toastEl = null;
  let toastTimeout = 0;
  let currentSpeed = 1.0;
  let preferredSpeed = 1.0;
  let isApplyingSpeed = false;
  let lastVideoId = null;
  let enforcedForVideoId = null;
  let boundVideo = null;
  let videoAbortController = null;
  let lastSpeedKeypressTime = 0;
  let lastNavigatedTime = Date.now();
  let lastNativeSettingsClickTime = 0;
  let isPointerDownOnVideo = false;
  let enforcementTimer = null;
  let storageDebounceTimer = null;
  let isKilled = false;
  let isInjectingSpeedButton = false;
  let lastAdEndTime = 0;
  let lastWasAdShowing = false;

  function getCurrentVideoId() {
    return window.CineGlowPlayer?.videoId || new URLSearchParams(window.location.search).get('v') || 'default';
  }

  function getMainVideo(player = null) {
    if (window.CineGlowPlayer?.video) return window.CineGlowPlayer.video;
    const p = player || window.CineGlowPlayer?.player || document.getElementById('movie_player') || document.querySelector('.html5-video-player');
    if (p) {
      const v = p.querySelector('video.html5-main-video') || p.querySelector('video');
      if (v) return v;
    }
    return document.querySelector('#movie_player video.html5-main-video') ||
           document.querySelector('#movie_player video') ||
           document.querySelector('video.html5-main-video') ||
           document.querySelector('video');
  }

  function isMainPlayerVideo(video) {
    if (!video) return false;
    if (window.CineGlowPlayer?.video && window.CineGlowPlayer.video === video) return true;
    return Boolean(video.classList?.contains('html5-main-video') && video.closest?.('#movie_player'));
  }

  function isAdActive() {
    if (window.CineGlowPlayer?.isAdShowing) return true;
    const player = window.CineGlowPlayer?.player || document.querySelector('#movie_player, #shorts-player, .html5-video-player');
    return Boolean(player && (player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting')));
  }

  function isNativeSpeedMenuOpen() {
    return Array.from(document.querySelectorAll('.ytp-settings-menu, .ytp-panel-speed')).some((menu) => {
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

  window.addEventListener('keydown', (e) => {
    if (isKilled || !isContextValid()) return;
    if (e.key === '<' || e.key === '>' || (e.shiftKey && (e.key === ',' || e.key === '.'))) {
      lastSpeedKeypressTime = Date.now();
    }
  }, { passive: true, signal });

  window.addEventListener('pointerdown', () => { isPointerDownOnVideo = true; }, { passive: true, signal });
  window.addEventListener('pointerup', () => { isPointerDownOnVideo = false; }, { passive: true, signal });
  window.addEventListener('pointercancel', () => { isPointerDownOnVideo = false; }, { passive: true, signal });

  document.addEventListener('click', (e) => {
    if (e.target?.closest?.('.ytp-settings-menu, .ytp-panel-speed, .ytp-settings-button, .ytp-menuitem')) {
      lastNativeSettingsClickTime = Date.now();
      clearEnforcementTimers();
    }
  }, { capture: true, signal });

  function clearEnforcementTimers() {
    if (enforcementTimer) {
      clearTimeout(enforcementTimer);
      enforcementTimer = null;
    }
  }

  function isContextValid() {
    try {
      if (typeof chrome === 'undefined') return true;
      if (!chrome.runtime || !chrome.runtime.id) return false;
      if (typeof chrome.runtime.getManifest === 'function') {
        return Boolean(chrome.runtime.getManifest());
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
      return (await chrome.storage.sync.get(defaults).catch(() => defaults)) || defaults;
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
      chrome.storage.sync.set(items)?.catch?.(() => {});
    } catch (_) {}
  }

  function safeStorageSetDebounced(items, delay = SYNC_THROTTLE_MS) {
    if (storageDebounceTimer) clearTimeout(storageDebounceTimer);
    storageDebounceTimer = setTimeout(() => {
      storageDebounceTimer = null;
      safeStorageSet(items);
    }, delay);
  }

  function removeExistingButton() {
    closeMenu();
    document.querySelectorAll(`.${SPEED_BUTTON_CLASS}`).forEach((el) => el.remove());
    currentButton = null;
    window.CineGlowToolbar?.cleanupToolbarIfEmpty?.();
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
      toastEl?.remove();
      toastEl = document.createElement('div');
      toastEl.className = 'cineglow-speed-toast';
      player.appendChild(toastEl);
    }
    const icon = rate < 1.0 ? '🐢' : (rate > 2.0 ? '🚀' : '⚡');
    toastEl.textContent = `${icon} ${formatSpeed(rate)} Speed`;
    toastEl.classList.add('visible');

    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      toastEl?.classList.remove('visible');
    }, 900);
  }

  function enforcePlaybackSpeed(video, showToast = false) {
    if (isKilled || window.CineGlowKilled) return;
    if (!checkContextOrTeardown()) return;
    const targetVideo = video || getMainVideo();
    if (!targetVideo || targetVideo.playbackRate > 15) return;

    if (!showToast && (isPointerDownOnVideo || document.querySelector('.ytp-speedmaster-overlay, .ytp-speedmaster-label')) && targetVideo.playbackRate === 2.0 && preferredSpeed !== 2.0) {
      return;
    }

    const targetSpeed = preferredSpeed;
    const isBufferingInitial = !showToast && targetVideo.readyState !== undefined && targetVideo.readyState < 2;

    if (targetVideo.defaultPlaybackRate !== targetSpeed) {
      try { targetVideo.defaultPlaybackRate = targetSpeed; } catch (_) {}
    }

    if (!isBufferingInitial && (targetVideo.playbackRate !== targetSpeed || targetVideo.defaultPlaybackRate !== targetSpeed)) {
      isApplyingSpeed = true;
      try {
        targetVideo.playbackRate = targetSpeed;
        targetVideo.defaultPlaybackRate = targetSpeed;
      } catch (_) {}

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
      enforcedForVideoId = getCurrentVideoId();
      queueMicrotask(() => { isApplyingSpeed = false; });
    }

    if (window.location?.origin) {
      try {
        window.postMessage({ type: 'CINEGLOW_SET_PREFERRED_SPEED', speed: targetSpeed }, window.location.origin);
      } catch (_) {}
    }

    currentSpeed = targetSpeed;
    updateButtonLabel(targetSpeed);
    if (activeMenu) syncMenuControls(targetSpeed);
    if (showToast) {
      showSpeedToast(document.getElementById('movie_player'), targetSpeed);
    }
  }

  function scheduleSpeedEnforcement(video, delay = 150) {
    if (isKilled || window.CineGlowKilled) return;
    if (!checkContextOrTeardown()) return;

    if ((Date.now() - lastNativeSettingsClickTime) < 1200 || isNativeSpeedMenuOpen()) {
      return;
    }

    const v = video || getMainVideo();
    if (!v) return;
    if (v.playbackRate === preferredSpeed) return;

    if (v.readyState !== undefined && v.readyState < 2) {
      try { v.defaultPlaybackRate = preferredSpeed; } catch (_) {}
      const onReady = () => {
        if (!isKilled && v.playbackRate !== preferredSpeed && (v.readyState === undefined || v.readyState >= 2)) {
          enforcePlaybackSpeed(v);
        }
      };
      v.addEventListener('canplay', onReady, { once: true, passive: true });
      v.addEventListener('playing', onReady, { once: true, passive: true });
      return;
    }

    clearEnforcementTimers();
    enforcementTimer = setTimeout(() => {
      enforcementTimer = null;
      if (isKilled || window.CineGlowKilled || !checkContextOrTeardown()) return;
      if ((Date.now() - lastNativeSettingsClickTime) < 1200 || isNativeSpeedMenuOpen()) return;
      if (v.playbackRate !== preferredSpeed && v.playbackRate <= 15) {
        enforcePlaybackSpeed(v);
      }
    }, delay);

    if (v.playbackRate !== preferredSpeed && v.playbackRate <= 15) {
      enforcePlaybackSpeed(v);
    }
  }

  function setPlaybackSpeed(rate, updateStorage = true) {
    if (isKilled || window.CineGlowKilled || !checkContextOrTeardown()) return;
    rate = Math.min(Math.max(Math.round(rate * 100) / 100, 0.1), 10.0);
    currentSpeed = rate;
    preferredSpeed = rate;
    enforcedForVideoId = getCurrentVideoId();

    const video = getMainVideo();
    enforcePlaybackSpeed(video, true);

    if (updateStorage) {
      safeStorageSet({ preferredSpeed: rate });
    }
  }

  function updateButtonLabel(rate) {
    if (!currentButton) return;
    const badge = currentButton.querySelector('.cineglow-speed-badge');
    if (badge) {
      badge.textContent = rate === 1 ? '1×' : (rate >= 10 ? '10×' : `${rate}×`);
    }
    currentButton.title = `Playback Speed: ${formatSpeed(rate)} (Click to adjust scale)`;
  }

  function closeMenu() {
    if (menuAbortController) {
      menuAbortController.abort();
      menuAbortController = null;
    }
    if (activeMenu) {
      activeMenu.closest?.('.cineglow-floating-toolbar')?.classList.remove('cineglow-menu-open');
      activeMenu.remove();
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

      scale0Box?.classList.add('scale-active');
      scale1Box?.classList.remove('scale-active');
      scale2Box?.classList.remove('scale-active');
    } else if (rate <= 2.0) {
      if (scale0Slider && scale0Slider !== skipSlider) scale0Slider.value = 1.0;
      if (scale1Slider && scale1Slider !== skipSlider) scale1Slider.value = rate;
      if (scale2Slider && scale2Slider !== skipSlider) scale2Slider.value = 2.0;

      if (scale0Val) scale0Val.textContent = '1.0×';
      if (scale1Val) scale1Val.textContent = formatSpeed(rate);
      if (scale2Val) scale2Val.textContent = '2.0×';

      scale0Box?.classList.remove('scale-active');
      scale1Box?.classList.add('scale-active');
      scale2Box?.classList.remove('scale-active');
    } else {
      if (scale0Slider && scale0Slider !== skipSlider) scale0Slider.value = 1.0;
      if (scale1Slider && scale1Slider !== skipSlider) scale1Slider.value = 2.0;
      if (scale2Slider && scale2Slider !== skipSlider) scale2Slider.value = rate;

      if (scale0Val) scale0Val.textContent = '1.0×';
      if (scale1Val) scale1Val.textContent = '2.0×';
      if (scale2Val) scale2Val.textContent = formatSpeed(rate);

      scale0Box?.classList.remove('scale-active');
      scale1Box?.classList.remove('scale-active');
      scale2Box?.classList.add('scale-active');
    }

    activeMenu.querySelectorAll('.cineglow-preset-pill').forEach((btn) => {
      const pVal = parseFloat(btn.dataset.speed);
      btn.classList.toggle('active', Math.abs(pVal - rate) < 0.04);
    });
  }

  function buildScaleBox({ boxClass, sliderClass, valClass, title, initialValText, min, max, step, initialVal, isActive, ticks }) {
    const box = document.createElement('div');
    box.className = `cineglow-scale-box ${boxClass} ${isActive ? 'scale-active' : ''}`;

    const row = document.createElement('div');
    row.className = 'cineglow-scale-row';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'cineglow-scale-name';
    nameSpan.textContent = title;
    const valSpan = document.createElement('span');
    valSpan.className = `cineglow-scale-val ${valClass}`;
    valSpan.textContent = initialValText;
    row.appendChild(nameSpan);
    row.appendChild(valSpan);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = `cineglow-scale-slider ${sliderClass}`;
    slider.min = String(min);
    slider.max = String(max);
    slider.step = String(step);
    slider.value = String(initialVal);

    const ruler = document.createElement('div');
    ruler.className = 'cineglow-scale-ruler';
    for (const tick of ticks) {
      const s = document.createElement('span');
      s.textContent = tick;
      ruler.appendChild(s);
    }

    box.appendChild(row);
    box.appendChild(slider);
    box.appendChild(ruler);
    return { box, slider };
  }

  function openSpeedMenu(anchorBtn, player) {
    if (activeMenu) {
      const wasConnected = Boolean(activeMenu.isConnected || activeMenu.parentElement);
      closeMenu();
      if (wasConnected) return;
    }

    menuAbortController = new AbortController();
    const menuSig = menuAbortController.signal;

    const menu = document.createElement('div');
    menu.className = 'cineglow-speed-menu';

    ['pointerdown', 'mousedown', 'mouseup', 'click', 'touchstart', 'touchend'].forEach((evtType) => {
      menu.addEventListener(evtType, (e) => e.stopPropagation(), { signal: menuSig });
    });

    const header = document.createElement('div');
    header.className = 'cineglow-speed-header';

    const headerLeft = document.createElement('div');
    headerLeft.className = 'cineglow-speed-header-left';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'cineglow-speed-header-icon');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', SPEED_ICON_PATH);
    path.setAttribute('fill', 'currentColor');
    svg.appendChild(path);
    const titleSpan = document.createElement('span');
    titleSpan.className = 'cineglow-speed-header-title';
    titleSpan.textContent = 'Playback Speed';
    headerLeft.appendChild(svg);
    headerLeft.appendChild(titleSpan);

    const headerRight = document.createElement('div');
    headerRight.className = 'cineglow-speed-header-right';
    const valSpan = document.createElement('span');
    valSpan.className = 'cineglow-speed-current-val';
    valSpan.textContent = formatSpeed(currentSpeed);
    valSpan.title = 'Click to reset to 1.0×';
    valSpan.style.cursor = 'pointer';
    valSpan.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      setPlaybackSpeed(1.0);
    }, { signal: menuSig });

    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 'cineglow-speed-reset-btn';
    resetBtn.title = 'Reset to normal speed (1.0×)';
    resetBtn.textContent = 'Reset';

    ['pointerdown', 'mousedown', 'touchstart'].forEach((evtType) => {
      resetBtn.addEventListener(evtType, (e) => e.stopPropagation(), { signal: menuSig });
    });

    resetBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      setPlaybackSpeed(1.0);
    }, { signal: menuSig });

    resetBtn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        setPlaybackSpeed(1.0);
      }
    }, { signal: menuSig });

    headerRight.appendChild(valSpan);
    headerRight.appendChild(resetBtn);

    header.appendChild(headerLeft);
    header.appendChild(headerRight);
    menu.appendChild(header);

    const s0Obj = buildScaleBox({
      boxClass: 'cineglow-scale0-box',
      sliderClass: 'cineglow-scale0-slider',
      valClass: 'cineglow-scale0-val',
      title: 'Slow-Mo Scale (0.1× – 1.0×)',
      initialValText: currentSpeed < 1.0 ? formatSpeed(currentSpeed) : '1.0×',
      min: 0.1,
      max: 1.0,
      step: 0.05,
      initialVal: currentSpeed < 1.0 ? currentSpeed : 1.0,
      isActive: currentSpeed < 1.0,
      ticks: ['0.1×', '0.25×', '0.5×', '0.75×', '1.0×']
    });
    menu.appendChild(s0Obj.box);

    const s1Obj = buildScaleBox({
      boxClass: 'cineglow-scale1-box',
      sliderClass: 'cineglow-scale1-slider',
      valClass: 'cineglow-scale1-val',
      title: 'Precision Scale (1.0× – 2.0×)',
      initialValText: currentSpeed >= 1.0 && currentSpeed <= 2.0 ? formatSpeed(currentSpeed) : (currentSpeed < 1.0 ? '1.0×' : '2.0×'),
      min: 1.0,
      max: 2.0,
      step: 0.05,
      initialVal: Math.min(Math.max(currentSpeed, 1.0), 2.0),
      isActive: currentSpeed >= 1.0 && currentSpeed <= 2.0,
      ticks: ['1.0×', '1.25×', '1.5×', '1.75×', '2.0×']
    });
    menu.appendChild(s1Obj.box);

    const s2Obj = buildScaleBox({
      boxClass: 'cineglow-scale2-box',
      sliderClass: 'cineglow-scale2-slider',
      valClass: 'cineglow-scale2-val',
      title: 'Turbo Scale (2.0× – 10.0×)',
      initialValText: currentSpeed >= 2.0 ? formatSpeed(currentSpeed) : '2.0×',
      min: 2.0,
      max: 10.0,
      step: 0.2,
      initialVal: Math.max(currentSpeed, 2.0),
      isActive: currentSpeed > 2.0,
      ticks: ['2×', '4×', '6×', '8×', '10×']
    });
    menu.appendChild(s2Obj.box);

    const presetsRow = document.createElement('div');
    presetsRow.className = 'cineglow-presets-row';
    PRESET_SPEEDS.forEach((p) => {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = `cineglow-preset-pill ${Math.abs(p - currentSpeed) < 0.04 ? 'active' : ''}`;
      pill.dataset.speed = String(p);
      pill.textContent = p === 1 ? '1×' : `${p}×`;
      pill.title = `${formatSpeed(p)} Speed`;
      ['pointerdown', 'mousedown', 'touchstart'].forEach((evtType) => {
        pill.addEventListener(evtType, (e) => e.stopPropagation(), { signal: menuSig });
      });
      pill.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        setPlaybackSpeed(p);
      }, { signal: menuSig });
      presetsRow.appendChild(pill);
    });
    menu.appendChild(presetsRow);

    const applySliderSpeed = (val, sourceSlider = null) => {
      const rate = Math.min(Math.max(Math.round(val * 100) / 100, 0.1), 10.0);
      currentSpeed = rate;
      preferredSpeed = rate;
      enforcedForVideoId = getCurrentVideoId();
      const v = getMainVideo();
      if (v) {
        isApplyingSpeed = true;
        try {
          v.playbackRate = rate;
          v.defaultPlaybackRate = rate;
        } catch (_) {}
        queueMicrotask(() => { isApplyingSpeed = false; });
      }
      updateButtonLabel(rate);
      syncMenuControls(rate, sourceSlider);
      safeStorageSetDebounced({ preferredSpeed: rate }, SYNC_THROTTLE_MS);
    };

    [s0Obj.slider, s1Obj.slider, s2Obj.slider].forEach((sl) => {
      sl.addEventListener('input', (e) => {
        e.stopPropagation();
        applySliderSpeed(parseFloat(sl.value), sl);
      }, { signal: menuSig });
      sl.addEventListener('change', (e) => {
        e.stopPropagation();
        setPlaybackSpeed(parseFloat(sl.value));
      }, { signal: menuSig });
    });

    s0Obj.box.addEventListener('wheel', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const delta = e.deltaY < 0 ? 0.05 : -0.05;
      applySliderSpeed(Math.min(Math.max(Math.round((currentSpeed + delta) * 100) / 100, 0.1), 1.0));
    }, { passive: false, signal: menuSig });

    s1Obj.box.addEventListener('wheel', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const delta = e.deltaY < 0 ? 0.05 : -0.05;
      applySliderSpeed(Math.min(Math.max(Math.round((currentSpeed + delta) * 100) / 100, 1.0), 2.0));
    }, { passive: false, signal: menuSig });

    s2Obj.box.addEventListener('wheel', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const delta = e.deltaY < 0 ? 0.2 : -0.2;
      applySliderSpeed(Math.min(Math.max(Math.round((currentSpeed + delta) * 10) / 10, 2.0), 10.0));
    }, { passive: false, signal: menuSig });

    const toolbar = anchorBtn.closest('.cineglow-floating-toolbar') || player;
    toolbar.appendChild(menu);
    toolbar.classList.add('cineglow-menu-open');
    toolbar.classList.remove('cineglow-toolbar-hidden');
    activeMenu = menu;

    queueMicrotask(() => {
      if (activeMenu === menu && menuAbortController) {
        document.addEventListener('click', (e) => {
          if (!menu.contains(e.target) && (!anchorBtn || !anchorBtn.contains(e.target))) {
            closeMenu();
          }
        }, { signal: menuSig });
      }
    });
  }

  function injectSpeedButton(playerManager) {
    if (isKilled || window.CineGlowKilled || !checkContextOrTeardown() || !playerManager) return;
    try {
      const { player, isWatchPage, video } = playerManager;
      if (!isWatchPage || !player) {
        removeExistingButton();
        return;
      }

      const toolbar = window.CineGlowToolbar?.getOrCreateToolbar?.(player) || (() => {
        let tb = player.querySelector('.cineglow-floating-toolbar');
        if (!tb) {
          tb = document.createElement('div');
          tb.className = 'cineglow-floating-toolbar cineglow-vertical-toolbar';
          player.appendChild(tb);
        }
        return tb;
      })();
      if (!toolbar || isKilled) return;

      if (currentButton && toolbar.contains(currentButton)) {
        bindVideoListeners(video);
        return;
      }

      removeExistingButton();

      toolbar.querySelectorAll(`.${SPEED_BUTTON_CLASS}`).forEach((el) => el.remove());

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `ytp-button ${SPEED_BUTTON_CLASS}`;
      btn.title = `Playback Speed: ${formatSpeed(currentSpeed)} (Click for speed scales)`;
      btn.setAttribute('aria-label', 'Playback Speed');

      const inner = document.createElement('div');
      inner.className = 'cineglow-speed-inner';

      const xmlns = 'http://www.w3.org/2000/svg';
      const svgElem = document.createElementNS(xmlns, 'svg');
      svgElem.setAttribute('viewBox', '0 0 24 24');
      svgElem.setAttribute('width', '100%');
      svgElem.setAttribute('height', '100%');
      svgElem.setAttribute('class', 'cineglow-speed-icon');

      const pathEl = document.createElementNS(xmlns, 'path');
      pathEl.setAttribute('d', SPEED_ICON_PATH);
      pathEl.setAttribute('fill', 'currentColor');
      svgElem.appendChild(pathEl);

      const badge = document.createElement('span');
      badge.className = 'cineglow-speed-badge';
      badge.textContent = currentSpeed === 1 ? '1×' : `${currentSpeed}×`;

      inner.appendChild(svgElem);
      inner.appendChild(badge);
      btn.appendChild(inner);

      ['pointerdown', 'mousedown', 'touchstart'].forEach((evtType) => {
        btn.addEventListener(evtType, (e) => e.stopPropagation(), { signal });
      });

      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openSpeedMenu(btn, player);
      }, { signal });

      btn.addEventListener('dblclick', (e) => {
        e.preventDefault();
        e.stopPropagation();
        setPlaybackSpeed(1.0);
      }, { signal });

      btn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openSpeedMenu(btn, player);
      }, { signal });

      const screenshotBtn = toolbar.querySelector('.cineglow-screenshot-button');
      const recordWrapper = toolbar.querySelector('.cineglow-record-wrapper');
      const pipBtn = toolbar.querySelector('.cineglow-pip-button');
      if (screenshotBtn) {
        toolbar.insertBefore(btn, screenshotBtn);
      } else if (recordWrapper) {
        toolbar.insertBefore(btn, recordWrapper);
      } else if (pipBtn) {
        toolbar.insertBefore(btn, pipBtn);
      } else {
        toolbar.appendChild(btn);
      }

      currentButton = btn;
      bindVideoListeners(video);
    } catch (_) {}
  }

  function unbindVideoListeners() {
    if (videoAbortController) {
      videoAbortController.abort();
      videoAbortController = null;
    }
    boundVideo = null;
  }

  function bindVideoListeners(video) {
    if (!video || !isMainPlayerVideo(video)) return;
    if (video === boundVideo) {
      if (preferredSpeed !== 1.0) scheduleSpeedEnforcement(video);
      return;
    }
    unbindVideoListeners();
    boundVideo = video;
    videoAbortController = new AbortController();
    const vSig = videoAbortController.signal;

    const onRateChange = () => {
      if (isKilled || !checkContextOrTeardown()) return;
      if (video.playbackRate > 15) {
        lastAdEndTime = Date.now();
        return;
      }
      if (checkAdActive() || isApplyingSpeed) return;

      const isHoldTo2x = (isPointerDownOnVideo || Boolean(document.querySelector('.ytp-speedmaster-overlay, .ytp-speedmaster-label'))) && video.playbackRate === 2.0 && preferredSpeed !== 2.0;
      if (isHoldTo2x) return;

      const isHotkeyPress = (Date.now() - lastSpeedKeypressTime) < 600;
      const isNativeSettingsAction = (Date.now() - lastNativeSettingsClickTime) < 1200 || isNativeSpeedMenuOpen();
      const isAdTransition = (Date.now() - lastAdEndTime) < 1500 || checkAdActive();
      const vid = getCurrentVideoId();

      // Deterministic check: if we haven't enforced preferredSpeed on this video yet, YouTube's
      // initial rate=1.0 is a load reset rather than a user action (unless user used hotkey/menu).
      if (video.playbackRate === 1.0 && preferredSpeed !== 1.0) {
        if (video.readyState !== undefined && video.readyState < 2) {
          try { video.defaultPlaybackRate = preferredSpeed; } catch (_) {}
          scheduleSpeedEnforcement(video);
          return;
        }

        if ((isAdTransition || enforcedForVideoId !== vid) && !isHotkeyPress && !isNativeSettingsAction) {
          enforcePlaybackSpeed(video);
          scheduleSpeedEnforcement(video);
          return;
        }

        clearEnforcementTimers();
        currentSpeed = 1.0;
        preferredSpeed = 1.0;
        enforcedForVideoId = vid;
        updateButtonLabel(1.0);
        if (activeMenu) syncMenuControls(1.0);
        safeStorageSet({ preferredSpeed: 1.0 });
        return;
      }

      if (isNativeSettingsAction) {
        clearEnforcementTimers();
      }

      currentSpeed = video.playbackRate;
      preferredSpeed = video.playbackRate;
      enforcedForVideoId = vid;
      updateButtonLabel(currentSpeed);
      if (activeMenu) syncMenuControls(currentSpeed);
      safeStorageSetDebounced({ preferredSpeed: currentSpeed }, SYNC_THROTTLE_MS);
    };

    const onReady = () => {
      if (checkContextOrTeardown() && preferredSpeed !== 1.0) scheduleSpeedEnforcement(video);
    };

    video.addEventListener('ratechange', onRateChange, { passive: true, signal: vSig });
    video.addEventListener('loadedmetadata', onReady, { passive: true, signal: vSig });
    video.addEventListener('canplay', onReady, { passive: true, signal: vSig });
    video.addEventListener('playing', onReady, { passive: true, signal: vSig });

    if (preferredSpeed !== 1.0) {
      scheduleSpeedEnforcement(video);
    }
  }

  const onDocumentNavigation = () => {
    if (isKilled || !checkContextOrTeardown()) return;
    lastNavigatedTime = Date.now();
    enforcedForVideoId = null;
    const video = getMainVideo();
    if (video && preferredSpeed !== 1.0) scheduleSpeedEnforcement(video);
  };
  document.addEventListener('yt-navigate-finish', onDocumentNavigation, { passive: true, signal });
  document.addEventListener('yt-page-data-updated', onDocumentNavigation, { passive: true, signal });
  document.addEventListener('yt-navigate-start', onDocumentNavigation, { passive: true, signal });

  const onCaptureMediaEvent = (e) => {
    if (isKilled || !checkContextOrTeardown()) return;
    const target = e.target;
    if (!target) return;
    const tag = (target.tagName || target.nodeName || '').toUpperCase();
    if (tag !== 'VIDEO') return;
    if (target.playbackRate > 15) {
      lastAdEndTime = Date.now();
      return;
    }
    if (checkAdActive()) return;

    if (!isMainPlayerVideo(target)) return;

    if (e.type === 'ratechange') {
      if (isApplyingSpeed) return;
      const isHoldTo2x = (isPointerDownOnVideo || Boolean(document.querySelector('.ytp-speedmaster-overlay, .ytp-speedmaster-label'))) && target.playbackRate === 2.0 && preferredSpeed !== 2.0;
      if (isHoldTo2x) return;

      const isHotkeyPress = (Date.now() - lastSpeedKeypressTime) < 600;
      const isNativeSettingsAction = (Date.now() - lastNativeSettingsClickTime) < 1200 || isNativeSpeedMenuOpen();
      const isAdTransition = (Date.now() - lastAdEndTime) < 1500 || checkAdActive();
      const vid = getCurrentVideoId();

      if (target.playbackRate === 1.0 && preferredSpeed !== 1.0) {
        if (target.readyState !== undefined && target.readyState < 2) {
          try { target.defaultPlaybackRate = preferredSpeed; } catch (_) {}
          scheduleSpeedEnforcement(target);
          return;
        }

        if ((isAdTransition || enforcedForVideoId !== vid) && !isHotkeyPress && !isNativeSettingsAction) {
          enforcePlaybackSpeed(target);
          scheduleSpeedEnforcement(target);
          return;
        }

        clearEnforcementTimers();
        currentSpeed = 1.0;
        preferredSpeed = 1.0;
        enforcedForVideoId = vid;
        updateButtonLabel(1.0);
        if (activeMenu) syncMenuControls(1.0);
        safeStorageSet({ preferredSpeed: 1.0 });
        return;
      }

      if (isNativeSettingsAction) {
        clearEnforcementTimers();
      }

      currentSpeed = target.playbackRate;
      preferredSpeed = target.playbackRate;
      enforcedForVideoId = vid;
      updateButtonLabel(currentSpeed);
      if (activeMenu) syncMenuControls(currentSpeed);
      safeStorageSetDebounced({ preferredSpeed: currentSpeed }, SYNC_THROTTLE_MS);
    } else {
      if (preferredSpeed !== 1.0) {
        scheduleSpeedEnforcement(target);
      }
    }
  };

  document.addEventListener('ratechange', onCaptureMediaEvent, { capture: true, signal });
  document.addEventListener('loadedmetadata', onCaptureMediaEvent, { capture: true, signal });
  document.addEventListener('canplay', onCaptureMediaEvent, { capture: true, signal });
  document.addEventListener('play', onCaptureMediaEvent, { capture: true, signal });
  document.addEventListener('playing', onCaptureMediaEvent, { capture: true, signal });

  const handleStorageChange = (changes, area) => {
    if (isKilled || window.CineGlowKilled || !checkContextOrTeardown()) return;
    if (area === 'sync' && changes.preferredSpeed) {
      const newRate = changes.preferredSpeed.newValue;
      if (typeof newRate === 'number' && newRate !== currentSpeed) {
        setPlaybackSpeed(newRate, false);
      }
    }
  };
  chrome.storage?.onChanged?.addListener(handleStorageChange);

  function teardownKillSwitch() {
    if (isKilled) return;
    isKilled = true;
    window.CineGlowKilled = true;

    chrome.storage?.onChanged?.removeListener(handleStorageChange);
    unbindVideoListeners();
    clearEnforcementTimers();
    if (storageDebounceTimer) {
      clearTimeout(storageDebounceTimer);
      storageDebounceTimer = null;
    }

    lifecycle.abort();
    clearTimeout(toastTimeout);
    toastEl?.remove();
    toastEl = null;
    removeExistingButton();
  }

  chrome.runtime?.onMessage?.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'AURA_EMERGENCY_KILL_SWITCH') {
      teardownKillSwitch();
      if (!window._cineglowKillEventFired) {
        window._cineglowKillEventFired = true;
        window.dispatchEvent(new CustomEvent('cineglow:kill-switch', { detail: message }));
      }
      sendResponse?.({ success: true, script: 'speed-button.js' });
    }
  });

  window.addEventListener('cineglow:kill-switch', teardownKillSwitch, { once: true });
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

  if (window.CineGlowPlayer) {
    window.CineGlowPlayer.addEventListener('state-change', (e) => {
      if (isKilled || !checkContextOrTeardown()) return;
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
          enforcedForVideoId = null;
          if (preferredSpeed !== 1.0) scheduleSpeedEnforcement(state.video);
        }
      } else {
        removeExistingButton();
      }
    }, { signal });

    injectSpeedButton(window.CineGlowPlayer);

    document.addEventListener('yt-navigate-finish', () => {
      setTimeout(() => {
        if (!isKilled && window.CineGlowPlayer?.isWatchPage) {
          injectSpeedButton(window.CineGlowPlayer);
        }
      }, 250);
    }, { signal, passive: true });
  }

  safeStorageGet({ preferredSpeed: 1.0 }).then((stored) => {
    if (isKilled || !isContextValid()) return;
    if (typeof stored?.preferredSpeed === 'number') {
      if (stored.preferredSpeed > 10.0 || stored.preferredSpeed < 0.1) {
        preferredSpeed = 1.0;
        safeStorageSet({ preferredSpeed: 1.0 });
      } else {
        preferredSpeed = stored.preferredSpeed;
      }
      currentSpeed = preferredSpeed;
      updateButtonLabel(currentSpeed);
      if (activeMenu) syncMenuControls(currentSpeed);
      const video = window.CineGlowPlayer?.video || document.querySelector('#movie_player video.html5-main-video');
      if (video && preferredSpeed !== 1.0) scheduleSpeedEnforcement(video);
    }
    if (window.CineGlowPlayer && !isKilled) {
      injectSpeedButton(window.CineGlowPlayer);
    }
  }).catch(() => {});
})();


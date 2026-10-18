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
  let boundVideo = null;
  let onRateChange = null;

  function removeExistingButton() {
    closeMenu();
    document.querySelectorAll(`.${SPEED_BUTTON_CLASS}`).forEach(el => el.remove());
    currentButton = null;
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

  function setPlaybackSpeed(rate, updateStorage = true) {
    rate = Math.min(Math.max(Math.round(rate * 100) / 100, 0.1), 10.0);
    currentSpeed = rate;

    const video = window.CineGlowPlayer ? window.CineGlowPlayer.video : document.querySelector('video');
    if (video) {
      video.playbackRate = rate;
    }

    const player = document.getElementById('movie_player');
    if (player && typeof player.setPlaybackRate === 'function') {
      try { player.setPlaybackRate(rate); } catch (e) {}
    }

    updateButtonLabel(rate);
    showSpeedToast(player, rate);

    if (activeMenu) {
      syncMenuControls(rate);
    }

    if (updateStorage) {
      chrome.storage.sync.set({ preferredSpeed: rate }).catch(() => {});
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
    if (activeMenu) {
      const toolbar = activeMenu.closest('.cineglow-floating-toolbar');
      if (toolbar) toolbar.classList.remove('cineglow-menu-open');
      activeMenu.remove();
      activeMenu = null;
    }
  }

  function syncMenuControls(rate) {
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
      if (scale0Slider) scale0Slider.value = rate;
      if (scale1Slider) scale1Slider.value = 1.0;
      if (scale2Slider) scale2Slider.value = 2.0;

      if (scale0Val) scale0Val.textContent = formatSpeed(rate);
      if (scale1Val) scale1Val.textContent = '1.0×';
      if (scale2Val) scale2Val.textContent = '2.0×';

      if (scale0Box) scale0Box.classList.add('scale-active');
      if (scale1Box) scale1Box.classList.remove('scale-active');
      if (scale2Box) scale2Box.classList.remove('scale-active');
    } else if (rate <= 2.0) {
      if (scale0Slider) scale0Slider.value = 1.0;
      if (scale1Slider) scale1Slider.value = rate;
      if (scale2Slider) scale2Slider.value = 2.0;

      if (scale0Val) scale0Val.textContent = '1.0×';
      if (scale1Val) scale1Val.textContent = formatSpeed(rate);
      if (scale2Val) scale2Val.textContent = '2.0×';

      if (scale0Box) scale0Box.classList.remove('scale-active');
      if (scale1Box) scale1Box.classList.add('scale-active');
      if (scale2Box) scale2Box.classList.remove('scale-active');
    } else {
      if (scale0Slider) scale0Slider.value = 1.0;
      if (scale1Slider) scale1Slider.value = 2.0;
      if (scale2Slider) scale2Slider.value = rate;

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
      closeMenu();
      return;
    }

    const menu = document.createElement('div');
    menu.className = 'cineglow-speed-menu';

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

    header.querySelector('.cineglow-speed-reset-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      setPlaybackSpeed(1.0);
    });

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

    // Slider 0 Events (Slow-Mo: Drag & Wheel)
    const s0 = scale0Box.querySelector('.cineglow-scale0-slider');
    s0.addEventListener('input', (e) => {
      e.stopPropagation();
      setPlaybackSpeed(parseFloat(s0.value));
    });
    scale0Box.addEventListener('wheel', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const delta = e.deltaY < 0 ? 0.05 : -0.05;
      const target = Math.min(Math.max(Math.round((currentSpeed + delta) * 100) / 100, 0.1), 1.0);
      setPlaybackSpeed(target);
    }, { passive: false });

    // Slider 1 Events (Precision: Drag & Wheel)
    const s1 = scale1Box.querySelector('.cineglow-scale1-slider');
    s1.addEventListener('input', (e) => {
      e.stopPropagation();
      setPlaybackSpeed(parseFloat(s1.value));
    });
    scale1Box.addEventListener('wheel', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const delta = e.deltaY < 0 ? 0.05 : -0.05;
      const target = Math.min(Math.max(Math.round((currentSpeed + delta) * 100) / 100, 1.0), 2.0);
      setPlaybackSpeed(target);
    }, { passive: false });

    // Slider 2 Events (Turbo: Drag & Wheel)
    const s2 = scale2Box.querySelector('.cineglow-scale2-slider');
    s2.addEventListener('input', (e) => {
      e.stopPropagation();
      setPlaybackSpeed(parseFloat(s2.value));
    });
    scale2Box.addEventListener('wheel', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const delta = e.deltaY < 0 ? 0.2 : -0.2;
      const target = Math.min(Math.max(Math.round((currentSpeed + delta) * 10) / 10, 2.0), 10.0);
      setPlaybackSpeed(target);
    }, { passive: false });

    // Mount to floating toolbar
    const toolbar = anchorBtn.closest('.cineglow-floating-toolbar') || player;
    toolbar.appendChild(menu);
    toolbar.classList.add('cineglow-menu-open');
    toolbar.classList.remove('cineglow-toolbar-hidden');
    activeMenu = menu;

    const onOutsideClick = (e) => {
      if (!menu.contains(e.target) && !anchorBtn.contains(e.target)) {
        closeMenu();
        document.removeEventListener('click', onOutsideClick);
      }
    };
    setTimeout(() => {
      document.addEventListener('click', onOutsideClick);
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

    toolbar.addEventListener('mouseenter', () => {
      toolbar.classList.remove('cineglow-toolbar-hidden');
    });

    toolbar.addEventListener('mousemove', () => {
      toolbar.classList.remove('cineglow-toolbar-hidden');
    });

    toolbar.addEventListener('mouseleave', () => {
      clearTimeout(hideTimeout);
      hideTimeout = setTimeout(syncVisibility, 200);
    });

    player.addEventListener('mouseenter', () => {
      toolbar.classList.remove('cineglow-toolbar-hidden');
    });

    player.addEventListener('mousemove', () => {
      toolbar.classList.remove('cineglow-toolbar-hidden');
    });

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
    toolbar.querySelectorAll(`.${SPEED_BUTTON_CLASS}`).forEach(el => el.remove());

    // Load initial preferred speed from settings
    try {
      const stored = await chrome.storage.sync.get({ preferredSpeed: 1.0 });
      if (stored && typeof stored.preferredSpeed === 'number') {
        currentSpeed = stored.preferredSpeed;
      }
    } catch (e) {}

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
    svgElem.className.baseVal = 'cineglow-speed-icon';

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

    // Left click & Right click both toggle the dual-scale menu
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openSpeedMenu(btn, player);
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
  }

  function bindVideoListeners(video) {
    if (!video || video === boundVideo) return;
    if (boundVideo && onRateChange) {
      boundVideo.removeEventListener('ratechange', onRateChange);
    }
    boundVideo = video;
    onRateChange = () => {
      // If an ad is fast-forwarding at 16x, ignore
      if (video.playbackRate > 15) return;
      currentSpeed = video.playbackRate;
      updateButtonLabel(currentSpeed);
      syncMenuControls(currentSpeed);
    };
    video.addEventListener('ratechange', onRateChange, { passive: true });

    // Apply preferred speed if non-default on load
    if (currentSpeed !== 1.0) {
      video.playbackRate = currentSpeed;
      const player = document.getElementById('movie_player');
      if (player && typeof player.setPlaybackRate === 'function') {
        try { player.setPlaybackRate(currentSpeed); } catch (e) {}
      }
    }
  }

  // Listen to CineGlow centralized player lifecycle
  if (window.CineGlowPlayer) {
    window.CineGlowPlayer.addEventListener('state-change', (e) => {
      const state = e.detail;
      if (state.isWatchPage && state.player) {
        if (!currentButton || !state.player.contains(currentButton)) {
          injectSpeedButton(state);
        } else if (state.video && state.video !== boundVideo) {
          bindVideoListeners(state.video);
        }
      } else {
        removeExistingButton();
      }
    });

    injectSpeedButton(window.CineGlowPlayer);
  }

  // Storage listener for external popup changes
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.preferredSpeed) {
      const newRate = changes.preferredSpeed.newValue;
      if (typeof newRate === 'number' && newRate !== currentSpeed) {
        setPlaybackSpeed(newRate, false);
      }
    }
  });
})();

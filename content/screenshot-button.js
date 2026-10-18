(() => {
  'use strict';

  const SCREENSHOT_BUTTON_CLASS = 'cineglow-screenshot-button';

  // SVG icon for a camera
  const CAMERA_SVG_PATH = 'M12,12 A3,3 0 1,0 15,15 A3,3 0 0,0 12,12 Z M20,8 L18.3,8 L16.8,6 L7.2,6 L5.7,8 L4,8 C2.9,8 2,8.9 2,10 L2,20 C2,21.1 2.9,22 4,22 L20,22 C21.1,22 22,21.1 22,20 L22,10 C22,8.9 21.1,8 20,8 Z M12,20 A5,5 0 1,1 17,15 A5,5 0 0,1 12,20 Z';

  let currentButton = null;
  let abortController = null;

  function removeExistingButton() {
    document.querySelectorAll(`.${SCREENSHOT_BUTTON_CLASS}`).forEach(el => el.remove());
    currentButton = null;
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
        // Remove legacy center controls
        const legacy = player.querySelectorAll('.cineglow-center-controls');
        legacy.forEach(el => el.remove());

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

  function takeScreenshot(video) {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      
      canvas.toBlob((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        const title = document.title.replace(/ - YouTube$/, '').replace(/[\\/:*?"<>|]/g, '');
        const time = Math.floor(video.currentTime);
        const hrs = Math.floor(time / 3600).toString().padStart(2, '0');
        const mins = Math.floor((time % 3600) / 60).toString().padStart(2, '0');
        const secs = (time % 60).toString().padStart(2, '0');
        a.download = `Screenshot_${title}_${hrs}-${mins}-${secs}.png`;
        document.body.appendChild(a);
        a.click();
        
        setTimeout(() => {
          if (a.parentNode) a.parentNode.removeChild(a);
          window.URL.revokeObjectURL(url);
        }, 100);
      }, 'image/png');
    } catch (err) {
      console.error('[CineGlow Screenshot]', err);
      if (err.name === 'SecurityError') {
        alert('Cannot take screenshot: This video is DRM-protected or has cross-origin restrictions.');
      } else {
        alert('Failed to take screenshot: ' + err.message);
      }
    }
  }

  async function injectScreenshotButton(playerManager) {
    const { player, isWatchPage } = playerManager;

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

    const btn = document.createElement('button');
    btn.className = `ytp-button ${SCREENSHOT_BUTTON_CLASS}`;
    btn.title = 'Take High-Res Screenshot';
    btn.setAttribute('aria-label', 'Take High-Res Screenshot');

    const xmlns = 'http://www.w3.org/2000/svg';
    const svgElem = document.createElementNS(xmlns, 'svg');
    svgElem.setAttributeNS(null, 'height', '100%');
    svgElem.setAttributeNS(null, 'version', '1.1');
    svgElem.setAttributeNS(null, 'viewBox', '0 0 24 24');
    svgElem.setAttributeNS(null, 'width', '100%');
    svgElem.style.display = 'block';
    svgElem.style.margin = 'auto';

    const groupEl = document.createElementNS(xmlns, 'g');
    const pathEl = document.createElementNS(xmlns, 'path');
    pathEl.setAttributeNS(null, 'class', 'ytp-svg-fill');
    pathEl.setAttributeNS(null, 'd', CAMERA_SVG_PATH);
    pathEl.setAttributeNS(null, 'fill', '#fff');

    groupEl.appendChild(pathEl);
    svgElem.appendChild(groupEl);
    btn.appendChild(svgElem);

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      const currentVideo = window.CineGlowPlayer ? window.CineGlowPlayer.video : null;
      if (currentVideo) {
        takeScreenshot(currentVideo);
      }
    });

    // In stack: Screenshot goes before PiP (middle of stack)
    const pipBtn = toolbar.querySelector('.cineglow-pip-button');
    if (pipBtn) {
      toolbar.insertBefore(btn, pipBtn);
    } else {
      toolbar.appendChild(btn);
    }

    currentButton = btn;
  }

  if (window.CineGlowPlayer) {
    window.CineGlowPlayer.addEventListener('state-change', (e) => {
      const state = e.detail;
      if (state.isWatchPage && state.player) {
        if (!currentButton || !state.player.contains(currentButton)) {
          injectScreenshotButton(state);
        }
      } else {
        removeExistingButton();
      }
    });

    injectScreenshotButton(window.CineGlowPlayer);
  }
})();

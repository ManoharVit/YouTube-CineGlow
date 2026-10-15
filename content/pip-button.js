(() => {
  'use strict';

  const PIP_BUTTON_CLASS = 'cineglow-pip-button';
  const PIP_ACTIVE_CLASS = 'cineglow-pip-active';

  // SVG paths for the two visual states.
  // "Enter PiP" icon: small window inside a larger frame.
  const ENTER_PIP_PATH = 'M25,17 L17,17 L17,23 L25,23 L25,17 L25,17 Z M29,25 L29,10.98 C29,9.88 28.1,9 27,9 L9,9 C7.9,9 7,9.88 7,10.98 L7,25 C7,26.1 7.9,27 9,27 L27,27 C28.1,27 29,26.1 29,25 L29,25 Z M27,25.02 L9,25.02 L9,10.97 L27,10.97 L27,25.02 L27,25.02 Z';
  // "Exit PiP" icon: filled small window to indicate active state.
  const EXIT_PIP_PATH = 'M19,11 L11,11 L11,17 L19,17 L19,11 Z M29,25 L29,10.98 C29,9.88 28.1,9 27,9 L9,9 C7.9,9 7,9.88 7,10.98 L7,25 C7,26.1 7.9,27 9,27 L27,27 C28.1,27 29,26.1 29,25 L29,25 Z M27,25.02 L9,25.02 L9,10.97 L27,10.97 L27,25.02 L27,25.02 Z';

  let currentButton = null;
  let pathEl = null;
  let abortController = null;

  function updateButtonState(isActive) {
    if (!currentButton || !pathEl) return;
    if (isActive) {
      currentButton.classList.add(PIP_ACTIVE_CLASS);
      currentButton.title = 'Exit Picture-in-Picture';
      currentButton.setAttribute('aria-label', 'Exit Picture-in-Picture');
      pathEl.setAttributeNS(null, 'd', EXIT_PIP_PATH);
    } else {
      currentButton.classList.remove(PIP_ACTIVE_CLASS);
      currentButton.title = 'Picture-in-Picture';
      currentButton.setAttribute('aria-label', 'Picture-in-Picture');
      pathEl.setAttributeNS(null, 'd', ENTER_PIP_PATH);
    }
  }

  function removeExistingButton() {
    if (currentButton) {
      const parent = currentButton.parentElement;
      currentButton.remove();
      currentButton = null;
      pathEl = null;
      if (parent && parent.classList.contains('cineglow-floating-toolbar') && !parent.hasChildNodes()) {
        parent.remove();
      }
    }
  }

  function initToolbarAutohide(player, toolbar) {
    if (toolbar._autohideInitialized) return;
    toolbar._autohideInitialized = true;

    const syncVisibility = () => {
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

    player.addEventListener('mouseenter', () => {
      toolbar.classList.remove('cineglow-toolbar-hidden');
    });

    player.addEventListener('mousemove', () => {
      if (!player.classList.contains('ytp-autohide')) {
        toolbar.classList.remove('cineglow-toolbar-hidden');
      }
    });

    syncVisibility();
  }

  /**
   * Wait for .cineglow-floating-toolbar on the right side of the player.
   * Creates it if it doesn't exist yet and removes legacy center controls.
   */
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

  async function injectPipButton(playerManager) {
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

    // Build button
    const pipButton = document.createElement('button');
    pipButton.className = `ytp-button ${PIP_BUTTON_CLASS}`;
    pipButton.title = 'Picture-in-Picture';
    pipButton.setAttribute('aria-label', 'Picture-in-Picture');

    const xmlns = 'http://www.w3.org/2000/svg';
    const svgElem = document.createElementNS(xmlns, 'svg');
    svgElem.setAttributeNS(null, 'height', '100%');
    svgElem.setAttributeNS(null, 'version', '1.1');
    svgElem.setAttributeNS(null, 'viewBox', '0 0 36 36');
    svgElem.setAttributeNS(null, 'width', '100%');
    svgElem.style.display = 'block';
    svgElem.style.margin = 'auto';

    const groupEl = document.createElementNS(xmlns, 'g');
    groupEl.setAttributeNS(null, 'transform', 'translate(-1, -1)');

    pathEl = document.createElementNS(xmlns, 'path');
    pathEl.setAttributeNS(null, 'class', 'ytp-svg-fill');
    pathEl.setAttributeNS(null, 'd', ENTER_PIP_PATH);
    pathEl.setAttributeNS(null, 'fill', '#fff');

    groupEl.appendChild(pathEl);
    svgElem.appendChild(groupEl);
    pipButton.appendChild(svgElem);

    pipButton.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const currentVideo = window.CineGlowPlayer ? window.CineGlowPlayer.video : null;
      if (!currentVideo) return;

      try {
        if (document.pictureInPictureElement === currentVideo) {
          await document.exitPictureInPicture();
        } else {
          await currentVideo.requestPictureInPicture();
        }
      } catch (error) {
        console.error('[CineGlow] PiP Error:', error);
      }
    });

    // PiP button must strictly be at the bottom of the stack
    toolbar.appendChild(pipButton);

    currentButton = pipButton;

    updateButtonState(!!document.pictureInPictureElement);
  }

  if (window.CineGlowPlayer) {
    window.CineGlowPlayer.addEventListener('state-change', (e) => {
      const state = e.detail;
      if (state.isWatchPage && state.player) {
        if (!currentButton || !state.player.contains(currentButton)) {
          injectPipButton(state);
        }
      } else {
        removeExistingButton();
      }
      updateButtonState(state.isPiP);
    });

    injectPipButton(window.CineGlowPlayer);
  }
})();

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
      currentButton.remove();
      currentButton = null;
      pathEl = null;
    }
  }

  /**
   * Wait for .ytp-right-controls to appear inside the player.
   * Uses a MutationObserver instead of setTimeout polling.
   * Aborts automatically via the provided AbortSignal.
   */
  function waitForRightControls(player, signal) {
    return new Promise((resolve) => {
      const existing = player.querySelector('.ytp-right-controls');
      if (existing) {
        resolve(existing);
        return;
      }

      const observer = new MutationObserver(() => {
        const el = player.querySelector('.ytp-right-controls');
        if (el) {
          observer.disconnect();
          resolve(el);
        }
      });

      // Abort if a new state-change fires before controls appear.
      signal.addEventListener('abort', () => {
        observer.disconnect();
        resolve(null);
      }, { once: true });

      observer.observe(player, { childList: true, subtree: true });
    });
  }

  async function injectPipButton(playerManager) {
    const { player, isWatchPage } = playerManager;

    // Abort any in-flight waitForRightControls from a previous call.
    if (abortController) {
      abortController.abort();
    }
    abortController = new AbortController();
    const signal = abortController.signal;

    if (!isWatchPage || !player) {
      removeExistingButton();
      return;
    }

    // If the button already exists inside this player, nothing to do.
    if (currentButton && player.contains(currentButton)) {
      return;
    }

    // Button was orphaned by a DOM wipe; discard the stale reference.
    removeExistingButton();

    const rightControls = await waitForRightControls(player, signal);
    if (!rightControls || signal.aborted) return;

    // Build button
    const pipButton = document.createElement('button');
    pipButton.className = `ytp-button ${PIP_BUTTON_CLASS}`;
    pipButton.title = 'Picture-in-Picture';
    pipButton.setAttribute('aria-label', 'Picture-in-Picture');
    pipButton.style.width = '48px';
    pipButton.style.height = '48px';
    pipButton.style.verticalAlign = 'top';

    const xmlns = 'http://www.w3.org/2000/svg';
    const svgElem = document.createElementNS(xmlns, 'svg');
    svgElem.setAttributeNS(null, 'height', '100%');
    svgElem.setAttributeNS(null, 'version', '1.1');
    svgElem.setAttributeNS(null, 'viewBox', '0 0 36 36');
    svgElem.setAttributeNS(null, 'width', '100%');

    pathEl = document.createElementNS(xmlns, 'path');
    pathEl.setAttributeNS(null, 'class', 'ytp-svg-fill');
    pathEl.setAttributeNS(null, 'd', ENTER_PIP_PATH);
    pathEl.setAttributeNS(null, 'fill', '#fff');

    svgElem.appendChild(pathEl);
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

    // Insert before the fullscreen button, or append as fallback.
    const fullscreenBtn = rightControls.querySelector('.ytp-fullscreen-button');
    if (fullscreenBtn) {
      try {
        fullscreenBtn.insertAdjacentElement('beforebegin', pipButton);
      } catch (e) {
        rightControls.appendChild(pipButton);
      }
    } else {
      rightControls.appendChild(pipButton);
    }

    currentButton = pipButton;

    // Reflect current PiP state immediately.
    updateButtonState(!!document.pictureInPictureElement);
  }

  if (window.CineGlowPlayer) {
    window.CineGlowPlayer.addEventListener('state-change', (e) => {
      const state = e.detail;
      // Re-inject if the player was recreated (SPA navigation / DOM wipe).
      if (state.isWatchPage && state.player) {
        if (!currentButton || !state.player.contains(currentButton)) {
          injectPipButton(state);
        }
      } else {
        removeExistingButton();
      }
      // Update icon to reflect PiP state changes.
      updateButtonState(state.isPiP);
    });

    // Initial injection.
    injectPipButton(window.CineGlowPlayer);
  }
})();

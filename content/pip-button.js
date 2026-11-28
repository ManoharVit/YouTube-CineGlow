(() => {
  'use strict';

  const PIP_BUTTON_CLASS = 'cineglow-pip-button';
  const PIP_ACTIVE_CLASS = 'cineglow-pip-active';

  const ENTER_PIP_PATH = 'M25,17 L17,17 L17,23 L25,23 L25,17 L25,17 Z M29,25 L29,10.98 C29,9.88 28.1,9 27,9 L9,9 C7.9,9 7,9.88 7,10.98 L7,25 C7,26.1 7.9,27 9,27 L27,27 C28.1,27 29,26.1 29,25 L29,25 Z M27,25.02 L9,25.02 L9,10.97 L27,10.97 L27,25.02 L27,25.02 Z';
  const EXIT_PIP_PATH = 'M19,11 L11,11 L11,17 L19,17 L19,11 Z M29,25 L29,10.98 C29,9.88 28.1,9 27,9 L9,9 C7.9,9 7,9.88 7,10.98 L7,25 C7,26.1 7.9,27 9,27 L27,27 C28.1,27 29,26.1 29,25 L29,25 Z M27,25.02 L9,25.02 L9,10.97 L27,10.97 L27,25.02 L27,25.02 Z';

  const lifecycle = new AbortController();
  const { signal } = lifecycle;

  let currentButton = null;
  let pathEl = null;
  let isKilled = false;
  let pipTransitionTimer = 0;

  function initToolbarAutohide(player, toolbar) {
    if (!player || !toolbar || toolbar._autohideInitialized) return;
    toolbar._autohideInitialized = true;

    const ac = new AbortController();
    let hideTimeout = 0;
    let observedChrome = null;

    const bindChromeObserver = () => {
      const chromeBottom = player.querySelector('.ytp-chrome-bottom');
      if (chromeBottom && chromeBottom !== observedChrome) {
        observedChrome = chromeBottom;
        chromeObserver.disconnect();
        chromeObserver.observe(chromeBottom, { attributes: true, attributeFilter: ['style', 'class'] });
      }
    };

    const syncVisibility = () => {
      bindChromeObserver();
      const isHovered = toolbar.matches(':hover') || Boolean(toolbar.querySelector(':hover'));
      const isMenuOpen = toolbar.classList.contains('cineglow-menu-open') ||
                         Boolean(toolbar.querySelector('.cineglow-rec-menu, .cineglow-speed-menu'));
      const isFocused = toolbar.matches(':focus-within');

      if (isHovered || isMenuOpen || isFocused) {
        toolbar.classList.remove('cineglow-toolbar-hidden');
        return;
      }

      const isAutohide = player.classList.contains('ytp-autohide') ||
                         player.classList.contains('ytp-hide-controls');
      const isChromeHidden = Boolean(observedChrome && (
        observedChrome.hidden ||
        observedChrome.style.display === 'none' ||
        observedChrome.classList.contains('ytp-chrome-hidden')
      ));

      toolbar.classList.toggle('cineglow-toolbar-hidden', isAutohide || isChromeHidden);
    };

    const playerObserver = new MutationObserver(syncVisibility);
    playerObserver.observe(player, { attributes: true, attributeFilter: ['class'] });

    const chromeObserver = new MutationObserver(syncVisibility);
    bindChromeObserver();

    const showToolbar = () => toolbar.classList.remove('cineglow-toolbar-hidden');
    const onToolbarMouseLeave = () => {
      clearTimeout(hideTimeout);
      hideTimeout = setTimeout(syncVisibility, 200);
    };

    toolbar.addEventListener('mouseenter', showToolbar, { passive: true, signal: ac.signal });
    toolbar.addEventListener('mousemove', showToolbar, { passive: true, signal: ac.signal });
    toolbar.addEventListener('mouseleave', onToolbarMouseLeave, { passive: true, signal: ac.signal });
    player.addEventListener('mouseenter', showToolbar, { passive: true, signal: ac.signal });
    player.addEventListener('mousemove', showToolbar, { passive: true, signal: ac.signal });

    const teardownAutohide = () => {
      clearTimeout(hideTimeout);
      playerObserver.disconnect();
      chromeObserver.disconnect();
      ac.abort();
      toolbar._autohideInitialized = false;
      delete toolbar._autohideTeardown;
      delete toolbar._teardownAutohide;
    };

    toolbar._autohideTeardown = teardownAutohide;
    toolbar._teardownAutohide = teardownAutohide;
    syncVisibility();
  }

  function getOrCreateToolbar(player) {
    if (!player) return null;
    player.querySelectorAll('.cineglow-center-controls').forEach((el) => el.remove());

    let toolbar = player.querySelector('.cineglow-floating-toolbar');
    if (!toolbar) {
      toolbar = document.createElement('div');
      toolbar.className = 'cineglow-floating-toolbar cineglow-vertical-toolbar';
      player.appendChild(toolbar);
    }
    initToolbarAutohide(player, toolbar);
    return toolbar;
  }

  function cleanupToolbarIfEmpty() {
    const toolbar = document.querySelector('.cineglow-floating-toolbar');
    if (!toolbar) return;
    const remaining = toolbar.querySelectorAll(
      '.cineglow-record-wrapper, .cineglow-pip-button, .cineglow-screenshot-button, .cineglow-speed-button'
    ).length;
    if (!toolbar.hasChildNodes() || remaining === 0) {
      toolbar._autohideTeardown?.();
      toolbar.remove();
    }
  }

  window.CineGlowToolbar = window.CineGlowToolbar || {
    getOrCreateToolbar,
    cleanupToolbarIfEmpty
  };

  function updateButtonState(isActive) {
    if (!currentButton || !pathEl) return;
    if (isActive) {
      currentButton.classList.add(PIP_ACTIVE_CLASS);
      currentButton.title = 'Exit Picture-in-Picture';
      currentButton.setAttribute('aria-label', 'Exit Picture-in-Picture');
      pathEl.setAttribute('d', EXIT_PIP_PATH);
    } else {
      currentButton.classList.remove(PIP_ACTIVE_CLASS);
      currentButton.title = 'Picture-in-Picture';
      currentButton.setAttribute('aria-label', 'Picture-in-Picture');
      pathEl.setAttribute('d', ENTER_PIP_PATH);
    }
  }

  function removeExistingButton() {
    document.querySelectorAll(`.${PIP_BUTTON_CLASS}`).forEach((el) => el.remove());
    currentButton = null;
    pathEl = null;
    cleanupToolbarIfEmpty();
  }

  function injectPipButton(playerManager) {
    if (isKilled || window.CineGlowKilled || !playerManager) return;
    const { player, isWatchPage } = playerManager;

    if (!isWatchPage || !player) {
      removeExistingButton();
      return;
    }

    if (currentButton && player.contains(currentButton)) {
      return;
    }

    removeExistingButton();

    const toolbar = window.CineGlowToolbar.getOrCreateToolbar(player);
    if (!toolbar) return;

    const pipButton = document.createElement('button');
    pipButton.type = 'button';
    pipButton.className = `ytp-button ${PIP_BUTTON_CLASS}`;
    pipButton.title = 'Picture-in-Picture';
    pipButton.setAttribute('aria-label', 'Picture-in-Picture');

    const xmlns = 'http://www.w3.org/2000/svg';
    const svgElem = document.createElementNS(xmlns, 'svg');
    svgElem.setAttribute('height', '100%');
    svgElem.setAttribute('width', '100%');
    svgElem.setAttribute('viewBox', '0 0 36 36');
    svgElem.style.display = 'block';
    svgElem.style.margin = 'auto';

    const groupEl = document.createElementNS(xmlns, 'g');
    groupEl.setAttribute('transform', 'translate(-1, -1)');

    pathEl = document.createElementNS(xmlns, 'path');
    pathEl.setAttribute('class', 'ytp-svg-fill');
    pathEl.setAttribute('d', ENTER_PIP_PATH);
    pathEl.setAttribute('fill', '#fff');

    groupEl.appendChild(pathEl);
    svgElem.appendChild(groupEl);
    pipButton.appendChild(svgElem);

    pipButton.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const currentVideo = window.CineGlowPlayer?.video;
      if (!currentVideo) return;

      try {
        if (document.pictureInPictureElement === currentVideo) {
          await document.exitPictureInPicture();
        } else {
          if (currentVideo.disablePictureInPicture) {
            currentVideo.disablePictureInPicture = false;
          }
          window._cineglowPipTransition = true;
          clearTimeout(pipTransitionTimer);
          pipTransitionTimer = setTimeout(() => {
            window._cineglowPipTransition = false;
          }, 500);
          await currentVideo.requestPictureInPicture();
        }
      } catch (error) {
        clearTimeout(pipTransitionTimer);
        window._cineglowPipTransition = false;
        console.error('[CineGlow] PiP Error:', error);
      }
    }, { signal });

    toolbar.appendChild(pipButton);
    currentButton = pipButton;
    updateButtonState(Boolean(document.pictureInPictureElement));
  }

  function teardownKillSwitch() {
    if (isKilled) return;
    isKilled = true;
    window.CineGlowKilled = true;
    clearTimeout(pipTransitionTimer);
    window._cineglowPipTransition = false;

    lifecycle.abort();
    removeExistingButton();
  }

  chrome.runtime?.onMessage?.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'AURA_EMERGENCY_KILL_SWITCH') {
      teardownKillSwitch();
      if (!window._cineglowKillEventFired) {
        window._cineglowKillEventFired = true;
        window.dispatchEvent(new CustomEvent('cineglow:kill-switch', { detail: message }));
      }
      sendResponse?.({ success: true, script: 'pip-button.js' });
    }
  });

  window.addEventListener('cineglow:kill-switch', teardownKillSwitch, { once: true });
  window.CineGlowPipTeardown = teardownKillSwitch;

  if (window.CineGlowPlayer) {
    window.CineGlowPlayer.addEventListener('state-change', (e) => {
      if (isKilled) return;
      const state = e?.detail;
      if (!state) return;
      if (state.isWatchPage && state.player) {
        if (!currentButton || !state.player.contains(currentButton)) {
          injectPipButton(state);
        }
      } else {
        removeExistingButton();
      }
      updateButtonState(state.isPiP);
    }, { signal });

    injectPipButton(window.CineGlowPlayer);
  }
})();


(() => {
  'use strict';

  function waitForRightControls(player, maxRetries = 20) {
    return new Promise((resolve) => {
      let retries = 0;
      
      function check() {
        const rightControls = player.querySelector('.ytp-right-controls');
        if (rightControls) {
          resolve(rightControls);
        } else if (retries < maxRetries) {
          retries++;
          setTimeout(check, 250);
        } else {
          resolve(null);
        }
      }
      
      check();
    });
  }

  async function injectPipButton(playerManager) {
    const { player, isWatchPage } = playerManager;

    if (!isWatchPage || !player) {
      return;
    }

    const rightControls = await waitForRightControls(player);
    if (!rightControls) {
      return;
    }

    // Check if it already exists
    if (rightControls.querySelector('.ytp-pip-button')) {
      return;
    }

    const pipButton = document.createElement('button');
    pipButton.className = 'ytp-button ytp-pip-button';
    pipButton.title = 'Picture-in-Picture';
    pipButton.setAttribute('aria-label', 'Picture-in-Picture');
    
    // Standard PiP SVG icon
    pipButton.innerHTML = `
      <svg height="100%" version="1.1" viewBox="0 0 36 36" width="100%">
        <path d="M25,17 L17,17 L17,23 L25,23 L25,17 L25,17 Z M29,25 L29,10.98 C29,9.88 28.1,9 27,9 L9,9 C7.9,9 7,9.88 7,10.98 L7,25 C7,26.1 7.9,27 9,27 L27,27 C28.1,27 29,26.1 29,25 L29,25 Z M27,25.02 L9,25.02 L9,10.97 L27,10.97 L27,25.02 L27,25.02 Z" fill="#fff"></path>
      </svg>
    `;

    pipButton.addEventListener('click', async (e) => {
      // Prevent default behavior if any
      e.preventDefault();
      e.stopPropagation();

      // Fetch the latest video from the global manager to avoid stale references
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

    // Try to insert before the fullscreen button, or just append
    const fullscreenBtn = rightControls.querySelector('.ytp-fullscreen-button');
    if (fullscreenBtn) {
      rightControls.insertBefore(pipButton, fullscreenBtn);
    } else {
      rightControls.appendChild(pipButton);
    }
  }

  // Handle player state changes
  if (window.CineGlowPlayer) {
    window.CineGlowPlayer.addEventListener('state-change', (e) => {
      injectPipButton(e.detail);
    });
    // Try inject immediately in case we missed the initial event
    injectPipButton(window.CineGlowPlayer);
  } else {
    console.warn('[CineGlow] CineGlowPlayer not found');
  }
})();

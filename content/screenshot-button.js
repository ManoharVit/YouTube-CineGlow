(() => {
  'use strict';

  const SCREENSHOT_BUTTON_CLASS = 'cineglow-screenshot-button';
  const CAMERA_SVG_PATH = 'M12,12 A3,3 0 1,0 15,15 A3,3 0 0,0 12,12 Z M20,8 L18.3,8 L16.8,6 L7.2,6 L5.7,8 L4,8 C2.9,8 2,8.9 2,10 L2,20 C2,21.1 2.9,22 4,22 L20,22 C21.1,22 22,21.1 22,20 L22,10 C22,8.9 21.1,8 20,8 Z M12,20 A5,5 0 1,1 17,15 A5,5 0 0,1 12,20 Z';

  const lifecycle = new AbortController();
  const { signal } = lifecycle;

  let currentButton = null;
  let isKilled = false;
  let isRecordingDisabled = false;
  let policyLoaded = false;
  let toastTimeout = 0;

  function showToast(msg) {
    const player = window.CineGlowPlayer?.player || document.getElementById('movie_player');
    if (!player) return;
    let toast = player.querySelector('.cineglow-rec-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'cineglow-rec-toast';
      player.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('visible');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      toast.classList.remove('visible');
    }, 2400);
  }

  function removeExistingButton() {
    document.querySelectorAll(`.${SCREENSHOT_BUTTON_CLASS}`).forEach((el) => el.remove());
    currentButton = null;
    window.CineGlowToolbar?.cleanupToolbarIfEmpty?.();
  }

  function takeScreenshot(video) {
    if (isRecordingDisabled) {
      showToast('Screenshots disabled by enterprise DLP policy');
      return;
    }
    if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
      showToast('Video frame not ready yet');
      return;
    }

    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      canvas.toBlob((blob) => {
        if (!blob) {
          showToast('Screenshot failed (DRM protected stream)');
          return;
        }
        try {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.style.display = 'none';
          a.href = url;
          const title = document.title.replace(/ - YouTube$/, '').replace(/[\\/:*?"<>|]/g, '').trim() || 'YouTube';
          const time = Math.floor(video.currentTime);
          const hrs = Math.floor(time / 3600).toString().padStart(2, '0');
          const mins = Math.floor((time % 3600) / 60).toString().padStart(2, '0');
          const secs = (time % 60).toString().padStart(2, '0');
          a.download = `Screenshot_${title}_${hrs}-${mins}-${secs}.png`;
          document.body.appendChild(a);
          a.click();

          setTimeout(() => {
            a.remove();
            URL.revokeObjectURL(url);
          }, 250);
          showToast(`Saved ${canvas.width}×${canvas.height} PNG`);
        } catch (cbErr) {
          console.error('[CineGlow Screenshot] Failed to save screenshot blob:', cbErr);
        }
      }, 'image/png');
    } catch (err) {
      console.error('[CineGlow Screenshot]', err);
      showToast(err.name === 'SecurityError' ? 'Cannot capture DRM-protected stream' : 'Screenshot failed');
    }
  }

  async function ensureManagedPolicy() {
    if (policyLoaded) return;
    policyLoaded = true;
    try {
      const [local, managed] = await Promise.all([
        chrome.storage?.local?.get(['auraKillSwitchActive']).catch(() => ({})),
        chrome.storage?.managed?.get(['DisableRecording', 'KillSwitch']).catch(() => ({}))
      ]);
      if (local?.auraKillSwitchActive || managed?.KillSwitch === true) {
        teardownKillSwitch();
        return;
      }
      if (managed?.DisableRecording === true) {
        isRecordingDisabled = true;
        removeExistingButton();
      }
    } catch (_) {}
  }

  async function injectScreenshotButton(playerManager) {
    if (isKilled || window.CineGlowKilled || !playerManager) return;
    await ensureManagedPolicy();

    if (isKilled || isRecordingDisabled) {
      removeExistingButton();
      return;
    }

    const { player, isWatchPage } = playerManager;
    if (!isWatchPage || !player) {
      removeExistingButton();
      return;
    }

    if (currentButton && player.contains(currentButton)) {
      return;
    }

    removeExistingButton();

    const toolbar = window.CineGlowToolbar?.getOrCreateToolbar?.(player) || (() => {
      let tb = player.querySelector('.cineglow-floating-toolbar');
      if (!tb) {
        tb = document.createElement('div');
        tb.className = 'cineglow-floating-toolbar cineglow-vertical-toolbar';
        player.appendChild(tb);
      }
      return tb;
    })();
    if (!toolbar || isRecordingDisabled || isKilled) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `ytp-button ${SCREENSHOT_BUTTON_CLASS}`;
    btn.title = 'Take High-Res Screenshot';
    btn.setAttribute('aria-label', 'Take High-Res Screenshot');

    const xmlns = 'http://www.w3.org/2000/svg';
    const svgElem = document.createElementNS(xmlns, 'svg');
    svgElem.setAttribute('height', '100%');
    svgElem.setAttribute('width', '100%');
    svgElem.setAttribute('viewBox', '0 0 24 24');
    svgElem.style.display = 'block';
    svgElem.style.margin = 'auto';

    const pathEl = document.createElementNS(xmlns, 'path');
    pathEl.setAttribute('class', 'ytp-svg-fill');
    pathEl.setAttribute('d', CAMERA_SVG_PATH);
    pathEl.setAttribute('fill', '#fff');

    svgElem.appendChild(pathEl);
    btn.appendChild(svgElem);

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const currentVideo = window.CineGlowPlayer?.video;
      if (currentVideo) {
        takeScreenshot(currentVideo);
      }
    }, { signal });

    const pipBtn = toolbar.querySelector('.cineglow-pip-button');
    if (pipBtn) {
      toolbar.insertBefore(btn, pipBtn);
    } else {
      toolbar.appendChild(btn);
    }

    currentButton = btn;
  }

  const handleStorageChange = (changes, area) => {
    if (area === 'managed') {
      if ('DisableRecording' in changes) {
        isRecordingDisabled = changes.DisableRecording.newValue === true;
        if (isRecordingDisabled) {
          removeExistingButton();
        } else if (window.CineGlowPlayer && !isKilled) {
          injectScreenshotButton(window.CineGlowPlayer);
        }
      }
      if (changes.KillSwitch?.newValue === true) {
        teardownKillSwitch();
      }
    }
    if (area === 'local' && changes.auraKillSwitchActive?.newValue === true) {
      teardownKillSwitch();
    }
  };
  chrome.storage?.onChanged?.addListener(handleStorageChange);

  function teardownKillSwitch() {
    if (isKilled) return;
    isKilled = true;
    window.CineGlowKilled = true;
    clearTimeout(toastTimeout);

    chrome.storage?.onChanged?.removeListener(handleStorageChange);
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
      sendResponse?.({ success: true, script: 'screenshot-button.js' });
    }
  });

  window.addEventListener('cineglow:kill-switch', teardownKillSwitch, { once: true });
  window.CineGlowScreenshotTeardown = teardownKillSwitch;

  if (window.CineGlowPlayer) {
    window.CineGlowPlayer.addEventListener('state-change', (e) => {
      if (isKilled) return;
      if (isRecordingDisabled) {
        removeExistingButton();
        return;
      }
      const state = e.detail;
      if (state.isWatchPage && state.player) {
        if (!currentButton || !state.player.contains(currentButton)) {
          injectScreenshotButton(state);
        }
      } else {
        removeExistingButton();
      }
    }, { signal });

    injectScreenshotButton(window.CineGlowPlayer);
  }
})();


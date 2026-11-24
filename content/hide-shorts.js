// content/hide-shorts.js
// Author: Giri Manohar Vemula (https://www.linkedin.com/in/manoharv511)
(() => {
  'use strict';

  let hideShortsEnabled = false;
  let isKilled = false;

  function updateDomAttribute(enabled) {
    if (isKilled || window.CineGlowKilled) {
      document.documentElement?.removeAttribute('cineglow-hide-shorts');
      return;
    }
    if (enabled) {
      document.documentElement?.setAttribute('cineglow-hide-shorts', 'true');
    } else {
      document.documentElement?.removeAttribute('cineglow-hide-shorts');
    }
  }

  function navigateWithinYouTube(targetPath) {
    const app = document.querySelector('ytd-app');
    if (app && typeof app.fire === 'function') {
      try {
        app.fire('yt-navigate', {
          endpoint: {
            commandMetadata: { webCommandMetadata: { url: targetPath } },
            watchEndpoint: targetPath.startsWith('/watch?v=')
              ? { videoId: new URLSearchParams(targetPath.split('?')[1]).get('v') }
              : undefined,
            browseEndpoint: targetPath === '/' ? { browseId: 'FEwhat_to_watch' } : undefined
          }
        });
        return;
      } catch (_) {}
    }
    if (typeof window.location?.replace === 'function') {
      window.location.replace(targetPath);
    } else if (window.location) {
      window.location.href = targetPath;
    }
  }

  function checkShortsRedirect() {
    if (isKilled || window.CineGlowKilled || !hideShortsEnabled) return;
    const path = window.location.pathname;
    if (path.startsWith('/shorts')) {
      const match = path.match(/^\/shorts\/([a-zA-Z0-9_-]+)/);
      const target = match?.[1] ? `/watch?v=${encodeURIComponent(match[1])}` : '/';
      navigateWithinYouTube(target);
    }
  }

  const onShortsClick = (e) => {
    if (!hideShortsEnabled || isKilled) return;
    const closestAnchor = e.target.closest?.('a');
    const anchor = e.target.closest?.('a[href*="/shorts"]') ||
                   (closestAnchor && (closestAnchor.getAttribute('href') || closestAnchor.href || '').includes('/shorts') ? closestAnchor : null);
    if (!anchor) return;

    let hostname = anchor.hostname;
    if (!hostname && anchor.href) {
      try {
        hostname = new URL(anchor.getAttribute('href') || anchor.href, window.location.href).hostname;
      } catch (_) {
        hostname = window.location.hostname;
      }
    }
    const h = (hostname || '').toLowerCase();
    const isYouTube = h === 'youtube.com' || h.endsWith('.youtube.com') || h === 'youtu.be' || h.endsWith('.youtu.be');
    if (!isYouTube) return;

    e.preventDefault();
    e.stopPropagation();

    const match = (anchor.getAttribute('href') || anchor.href || '').match(/\/shorts\/([a-zA-Z0-9_-]+)/);
    if (match?.[1]) {
      navigateWithinYouTube(`/watch?v=${encodeURIComponent(match[1])}`);
    }
  };

  const onNavigate = () => checkShortsRedirect();

  const handleStorageChange = (changes, area) => {
    if (isKilled || window.CineGlowKilled) return;
    if (area === 'managed' && changes.KillSwitch?.newValue === true) {
      teardownKillSwitch();
      return;
    }
    if (area === 'local' && changes.auraKillSwitchActive?.newValue === true) {
      teardownKillSwitch();
      return;
    }
    if (area === 'sync' && 'hideShorts' in changes) {
      hideShortsEnabled = Boolean(changes.hideShorts.newValue);
      updateDomAttribute(hideShortsEnabled);
      checkShortsRedirect();
    }
  };

  function teardownKillSwitch() {
    if (isKilled) return;
    isKilled = true;
    hideShortsEnabled = false;
    window.CineGlowKilled = true;
    document.documentElement?.removeAttribute('cineglow-hide-shorts');

    chrome.storage?.onChanged?.removeListener(handleStorageChange);
    document.removeEventListener('click', onShortsClick, true);
    document.removeEventListener('yt-navigate-finish', onNavigate);
    document.removeEventListener('yt-page-data-updated', onNavigate);
    window.removeEventListener('popstate', onNavigate);
    window.CineGlowPlayer?.removeEventListener?.('state-change', onNavigate);
  }

  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage?.addListener) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === 'AURA_EMERGENCY_KILL_SWITCH') {
        teardownKillSwitch();
        if (!window._cineglowKillEventFired) {
          window._cineglowKillEventFired = true;
          window.dispatchEvent(new CustomEvent('cineglow:kill-switch', { detail: message }));
        }
        if (typeof sendResponse === 'function') {
          sendResponse({ success: true, script: 'hide-shorts.js' });
        }
      }
    });
  }

  window.addEventListener('cineglow:kill-switch', () => {
    teardownKillSwitch();
  }, { once: true });

  window.CineGlowShortsTeardown = teardownKillSwitch;

  function init() {
    if (isKilled || window.CineGlowKilled) return;

    document.addEventListener('click', onShortsClick, true);
    document.addEventListener('yt-navigate-finish', onNavigate, { passive: true });
    document.addEventListener('yt-page-data-updated', onNavigate, { passive: true });
    window.addEventListener('popstate', onNavigate, { passive: true });
    window.CineGlowPlayer?.addEventListener('state-change', onNavigate);
    chrome.storage?.onChanged?.addListener(handleStorageChange);

    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.sync?.get({ hideShorts: false }, (stored) => {
        if (isKilled) return;
        hideShortsEnabled = Boolean(stored?.hideShorts);
        updateDomAttribute(hideShortsEnabled);
        checkShortsRedirect();
      });
      chrome.storage.managed?.get(['KillSwitch'], (managed) => {
        if (managed?.KillSwitch) teardownKillSwitch();
      });
      chrome.storage.local?.get(['auraKillSwitchActive'], (local) => {
        if (local?.auraKillSwitchActive) teardownKillSwitch();
      });
    }
  }

  init();
})();

(() => {
  'use strict';

  let hideShortsEnabled = false;
  let isKilled = false;

  const SHORTS_SELECTORS = [
    'grid-shelf-view-model',
    'reel-shelf-view-model',
    'yt-reel-shelf-view-model',
    'ytd-reel-shelf-renderer',
    'ytd-rich-shelf-renderer[is-shorts]',
    'ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts])',
    'ytd-rich-section-renderer:has(reel-shelf-view-model)',
    'ytd-rich-section-renderer:has(yt-reel-shelf-view-model)',
    'ytd-rich-section-renderer:has(grid-shelf-view-model)',
    'ytm-shorts-lockup-view-model',
    'ytm-shorts-lockup-view-model-v2',
    'yt-lockup-view-model:has(a[href*="/shorts/"])',
    'ytd-rich-item-renderer:has(a[href*="/shorts/"])',
    'ytd-rich-item-renderer:has(ytm-shorts-lockup-view-model)',
    'ytd-video-renderer:has(a[href*="/shorts/"])',
    'ytd-compact-video-renderer:has(a[href*="/shorts/"])',
    'ytd-guide-entry-renderer:has(a[href*="/shorts"])',
    'ytd-mini-guide-entry-renderer:has(a[href*="/shorts"])',
    'yt-guide-entry-view-model:has(a[href*="/shorts"])',
    'a#endpoint[title="Shorts"]',
    'a#endpoint[href*="/shorts"]',
    'ytm-pivot-bar-item-renderer:has(a[href*="/shorts"])',
    'yt-tab-shape[tab-title="Shorts"]',
    'yt-tab-shape:has(a[href*="/shorts"])',
    'ytd-browse[page-subtype="channels"] ytd-tab-renderer:has(a[href*="/shorts"])',
    'ytd-reel-video-renderer'
  ].join(',');

  function updateDomAttribute(enabled) {
    if (isKilled || (typeof window !== 'undefined' && window.CineGlowKilled)) {
      document.documentElement.removeAttribute('cineglow-hide-shorts');
      return;
    }
    if (enabled) {
      document.documentElement.setAttribute('cineglow-hide-shorts', 'true');
    } else {
      document.documentElement.removeAttribute('cineglow-hide-shorts');
    }
  }

  // If user navigates directly to /shorts, redirect back to YouTube Home
  function checkShortsRedirect() {
    if (isKilled || (typeof window !== 'undefined' && window.CineGlowKilled)) return;
    if (!hideShortsEnabled) return;
    const path = window.location.pathname;
    if (path.startsWith('/shorts')) {
      window.location.replace('/');
    }
  }

  // --- Emergency Kill-Switch Teardown ---
  function teardownKillSwitch() {
    if (isKilled) return;
    isKilled = true;
    hideShortsEnabled = false;
    if (typeof window !== 'undefined') window.CineGlowKilled = true;
    document.documentElement.removeAttribute('cineglow-hide-shorts');
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
          sendResponse({ success: true, script: 'hide-shorts.js' });
        }
      }
    });
  }

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('cineglow:kill-switch', () => {
      teardownKillSwitch();
    }, { once: true });
  }

  window.CineGlowShortsTeardown = teardownKillSwitch;

  function init() {
    if (isKilled || (typeof window !== 'undefined' && window.CineGlowKilled)) return;
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.get({ hideShorts: false }, (items) => {
        if (isKilled) return;
        hideShortsEnabled = !!items.hideShorts;
        updateDomAttribute(hideShortsEnabled);
        checkShortsRedirect();
      });

      chrome.storage.onChanged.addListener((changes, area) => {
        if (isKilled || (typeof window !== 'undefined' && window.CineGlowKilled)) return;
        if (area === 'sync' && 'hideShorts' in changes) {
          hideShortsEnabled = !!changes.hideShorts.newValue;
          updateDomAttribute(hideShortsEnabled);
          checkShortsRedirect();
        }
      });
    }

    // Intercept and cancel clicks on any /shorts links when hiding is enabled
    document.addEventListener('click', (e) => {
      if (!hideShortsEnabled || isKilled) return;
      const anchor = e.target.closest && e.target.closest('a[href*="/shorts"]');
      if (anchor) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);

    // YouTube SPA navigation listeners
    document.addEventListener('yt-navigate-finish', () => {
      checkShortsRedirect();
    });

    document.addEventListener('yt-page-data-updated', () => {
      checkShortsRedirect();
    });

    window.addEventListener('popstate', () => {
      checkShortsRedirect();
    });

    if (window.CineGlowPlayer) {
      window.CineGlowPlayer.addEventListener('state-change', () => {
        checkShortsRedirect();
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

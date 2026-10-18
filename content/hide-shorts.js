(() => {
  'use strict';

  let hideShortsEnabled = false;

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
    if (enabled) {
      document.documentElement.setAttribute('cineglow-hide-shorts', 'true');
    } else {
      document.documentElement.removeAttribute('cineglow-hide-shorts');
    }
  }

  // If user navigates directly to /shorts, redirect back to YouTube Home
  function checkShortsRedirect() {
    if (!hideShortsEnabled) return;
    const path = window.location.pathname;
    if (path.startsWith('/shorts')) {
      window.location.replace('/');
    }
  }

  function init() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.get({ hideShorts: false }, (items) => {
        hideShortsEnabled = !!items.hideShorts;
        updateDomAttribute(hideShortsEnabled);
        checkShortsRedirect();
      });

      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'sync' && 'hideShorts' in changes) {
          hideShortsEnabled = !!changes.hideShorts.newValue;
          updateDomAttribute(hideShortsEnabled);
          checkShortsRedirect();
        }
      });
    }

    // Intercept and cancel clicks on any /shorts links when hiding is enabled
    document.addEventListener('click', (e) => {
      if (!hideShortsEnabled) return;
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

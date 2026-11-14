(() => {
  'use strict';

  let hideShortsEnabled = false;
  let isKilled = false;
  let onShortsClick = null;
  let onYtNavigateFinish = null;
  let onYtPageDataUpdated = null;
  let onPopstate = null;
  let onPlayerStateChange = null;
  let onDomContentLoaded = null;

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

  // If user navigates directly to /shorts, redirect to standard video view or YouTube Home
  function checkShortsRedirect() {
    if (isKilled || (typeof window !== 'undefined' && window.CineGlowKilled)) return;
    if (!hideShortsEnabled) return;
    const path = window.location.pathname;
    if (path.startsWith('/shorts')) {
      const match = path.match(/^\/shorts\/([a-zA-Z0-9_-]+)/);
      if (match && match[1]) {
        const shortId = match[1];
        window.location.replace(`/watch?v=${encodeURIComponent(shortId)}`);
      } else {
        window.location.replace('/');
      }
    }
  }

  // --- Emergency Kill-Switch Teardown ---
  function teardownKillSwitch() {
    if (isKilled) return;
    isKilled = true;
    hideShortsEnabled = false;
    if (typeof window !== 'undefined') window.CineGlowKilled = true;
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.removeAttribute('cineglow-hide-shorts');
    }

    if (onShortsClick && typeof document !== 'undefined') {
      try { document.removeEventListener('click', onShortsClick, true); } catch (_) {}
      onShortsClick = null;
    }
    if (onYtNavigateFinish && typeof document !== 'undefined') {
      try { document.removeEventListener('yt-navigate-finish', onYtNavigateFinish); } catch (_) {}
      onYtNavigateFinish = null;
    }
    if (onYtPageDataUpdated && typeof document !== 'undefined') {
      try { document.removeEventListener('yt-page-data-updated', onYtPageDataUpdated); } catch (_) {}
      onYtPageDataUpdated = null;
    }
    if (onPopstate && typeof window !== 'undefined') {
      try { window.removeEventListener('popstate', onPopstate); } catch (_) {}
      onPopstate = null;
    }
    if (onPlayerStateChange && window.CineGlowPlayer && typeof window.CineGlowPlayer.removeEventListener === 'function') {
      try { window.CineGlowPlayer.removeEventListener('state-change', onPlayerStateChange); } catch (_) {}
      onPlayerStateChange = null;
    }
    if (onDomContentLoaded && typeof document !== 'undefined') {
      try { document.removeEventListener('DOMContentLoaded', onDomContentLoaded); } catch (_) {}
      onDomContentLoaded = null;
    }
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
    onShortsClick = (e) => {
      if (!hideShortsEnabled || isKilled) return;
      const anchor = e.target.closest ? (e.target.closest('a[href*="/shorts"]') || (e.target.closest('a') && (e.target.closest('a').getAttribute('href') || e.target.closest('a').href || '').includes('/shorts') ? e.target.closest('a') : null)) : null;
      if (anchor) {
        let hostname = anchor.hostname;
        if (!hostname && anchor.href) {
          try {
            hostname = new URL(anchor.href, window.location.href).hostname;
          } catch (_) {
            hostname = window.location.hostname;
          }
        }
        const h = (hostname || '').toLowerCase();
        const isYouTube = h === 'youtube.com' ||
                          h.endsWith('.youtube.com') ||
                          h === 'youtu.be' ||
                          h.endsWith('.youtu.be');
        if (isYouTube) {
          e.preventDefault();
          e.stopPropagation();
        }
      }
    };
    document.addEventListener('click', onShortsClick, true);

    // YouTube SPA navigation listeners
    onYtNavigateFinish = () => {
      checkShortsRedirect();
    };
    document.addEventListener('yt-navigate-finish', onYtNavigateFinish);

    onYtPageDataUpdated = () => {
      checkShortsRedirect();
    };
    document.addEventListener('yt-page-data-updated', onYtPageDataUpdated);

    onPopstate = () => {
      checkShortsRedirect();
    };
    window.addEventListener('popstate', onPopstate);

    if (window.CineGlowPlayer) {
      onPlayerStateChange = () => {
        checkShortsRedirect();
      };
      window.CineGlowPlayer.addEventListener('state-change', onPlayerStateChange);
    }
  }

  if (document.readyState === 'loading') {
    onDomContentLoaded = init;
    document.addEventListener('DOMContentLoaded', onDomContentLoaded);
  } else {
    init();
  }

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('unhandledrejection', (event) => {
      if (event && event.reason && String(event.reason.message || event.reason).includes('Extension context invalidated')) {
        try { event.preventDefault(); } catch (_) {}
      }
    });
    window.addEventListener('error', (event) => {
      if (event && event.message && String(event.message).includes('Extension context invalidated')) {
        try { event.preventDefault(); } catch (_) {}
      }
    });
  }
})();

// content/hide-shorts.js
// Author: Giri Manohar Vemula (https://www.linkedin.com/in/manoharv511)
(() => {
  'use strict';

  let hideShortsEnabled = false;
  let isKilled = false;
  let domObserver = null;
  let scanScheduled = false;

  const SHORTS_HIDDEN_ATTR = 'data-cineglow-shorts-hidden';
  const GUIDE_ENTRY_SELECTOR = 'ytd-guide-entry-renderer, ytd-mini-guide-entry-renderer, yt-guide-entry-view-model';
  const SHELF_SELECTOR = 'ytd-rich-section-renderer, ytd-rich-shelf-renderer, ytd-reel-shelf-renderer, grid-shelf-view-model, reel-shelf-view-model, yt-reel-shelf-view-model';
  const ITEM_SELECTOR = 'ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, ytd-grid-video-renderer, yt-lockup-view-model';
  const CHIP_SELECTOR = 'yt-chip-cloud-chip-renderer';

  function isYouTubeContext() {
    if (typeof window === 'undefined' || !window.location) return false;
    const h = (window.location.hostname || '').toLowerCase();
    return h === '' || h === 'youtube.com' || h.endsWith('.youtube.com') || h === 'youtu.be' || h.endsWith('.youtu.be');
  }

  /**
   * Return true if rawHref points to a YouTube /shorts route (excluding handles like /@shorts).
   * @param {string} rawHref
   * @returns {boolean}
   */
  function isExactShortsHref(rawHref) {
    if (!rawHref || typeof rawHref !== 'string') return false;
    try {
      const origin = (typeof window !== 'undefined' && window.location?.origin && window.location.origin !== 'null')
        ? window.location.origin
        : 'https://www.youtube.com';
      const parsed = new URL(rawHref, origin);
      const host = (parsed.hostname || '').toLowerCase();
      const isYt = host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be' || host.endsWith('.youtu.be');
      if (!isYt) return false;
      return parsed.pathname === '/shorts' || parsed.pathname.startsWith('/shorts/');
    } catch (_) {
      return rawHref === '/shorts' || rawHref.startsWith('/shorts/');
    }
  }

  /**
   * Extract a Shorts video ID when rawHref targets an exact YouTube /shorts/<id> route.
   * @param {string} rawHref
   * @returns {string|null}
   */
  function parseShortsVideoId(rawHref) {
    if (!isExactShortsHref(rawHref)) return null;
    try {
      const origin = (typeof window !== 'undefined' && window.location?.origin && window.location.origin !== 'null')
        ? window.location.origin
        : 'https://www.youtube.com';
      const parsed = new URL(rawHref, origin);
      const match = parsed.pathname.match(/^\/shorts\/([a-zA-Z0-9_-]+)/);
      return match?.[1] || null;
    } catch (_) {
      const match = rawHref.match(/^\/shorts\/([a-zA-Z0-9_-]+)/);
      return match?.[1] || null;
    }
  }

  function containsShortsLink(container) {
    if (!container || typeof container.querySelectorAll !== 'function') return false;
    const anchors = container.querySelectorAll('a');
    for (const a of anchors) {
      const href = a.getAttribute?.('href') || a.href || '';
      if (isExactShortsHref(href)) return true;
    }
    return Boolean(container.querySelector?.('ytm-shorts-lockup-view-model, ytm-shorts-lockup-view-model-v2'));
  }

  function restoreHiddenShortsDom() {
    const root = document.body || document;
    if (!root || typeof root.querySelectorAll !== 'function') return;
    const selector = `${GUIDE_ENTRY_SELECTOR}, ${SHELF_SELECTOR}, ${ITEM_SELECTOR}, ${CHIP_SELECTOR}`;
    for (const el of root.querySelectorAll(selector)) {
      if (el.hasAttribute(SHORTS_HIDDEN_ATTR)) {
        el.removeAttribute(SHORTS_HIDDEN_ATTR);
      }
    }
    try {
      for (const el of root.querySelectorAll(`[${SHORTS_HIDDEN_ATTR}]`)) {
        el.removeAttribute(SHORTS_HIDDEN_ATTR);
      }
    } catch (_) {}
  }

  function setShortsHidden(el, shouldHide) {
    if (!el) return;
    if (shouldHide) {
      if (el.getAttribute(SHORTS_HIDDEN_ATTR) !== 'true') {
        el.setAttribute(SHORTS_HIDDEN_ATTR, 'true');
      }
    } else if (el.hasAttribute(SHORTS_HIDDEN_ATTR)) {
      el.removeAttribute(SHORTS_HIDDEN_ATTR);
    }
  }

  function isGuideShortsEntry(entry) {
    if (!entry) return false;
    if (containsShortsLink(entry)) return true;
    if ((entry.getAttribute?.('aria-label') || '').trim() === 'Shorts') return true;
    if ((entry.getAttribute?.('title') || '').trim() === 'Shorts') return true;
    for (const node of entry.querySelectorAll?.('a, yt-formatted-string, .title, span') || []) {
      const aria = (node.getAttribute?.('aria-label') || '').trim();
      const title = (node.getAttribute?.('title') || '').trim();
      const nodeText = (node.textContent || '').trim();
      if (aria === 'Shorts' || title === 'Shorts' || nodeText === 'Shorts') return true;
    }
    const text = (entry.textContent || '').replace(/\s+/g, ' ').trim();
    return text === 'Shorts';
  }

  function isShortsShelf(shelf) {
    if (!shelf) return false;
    const tag = (shelf.tagName || '').toLowerCase();
    if (tag === 'ytd-reel-shelf-renderer' || tag === 'reel-shelf-view-model' || tag === 'yt-reel-shelf-view-model') {
      return true;
    }
    if (shelf.hasAttribute?.('is-shorts') || shelf.querySelector?.('ytd-rich-shelf-renderer[is-shorts]')) {
      return true;
    }
    if (containsShortsLink(shelf)) return true;
    const titleNode = shelf.querySelector?.('#title, #title-text, h2');
    return Boolean(titleNode && (titleNode.textContent || '').trim() === 'Shorts');
  }

  /**
   * Scan guide, shelf, item, and chip elements to hide Shorts and clear recycled non-Shorts nodes.
   */
  function scanShortsDom() {
    scanScheduled = false;
    if (isKilled || window.CineGlowKilled || !isYouTubeContext()) return;
    if (!hideShortsEnabled) {
      restoreHiddenShortsDom();
      return;
    }
    const root = document.body || document;
    if (!root || typeof root.querySelectorAll !== 'function') return;

    for (const entry of root.querySelectorAll(GUIDE_ENTRY_SELECTOR)) {
      setShortsHidden(entry, isGuideShortsEntry(entry));
    }

    for (const shelf of root.querySelectorAll(SHELF_SELECTOR)) {
      setShortsHidden(shelf, isShortsShelf(shelf));
    }

    for (const item of root.querySelectorAll(ITEM_SELECTOR)) {
      const hasBadgeOverlay = Boolean(item.querySelector?.('ytd-thumbnail-overlay-time-status-renderer[overlay-style="SHORTS"]'));
      setShortsHidden(item, hasBadgeOverlay || containsShortsLink(item));
    }

    for (const chip of root.querySelectorAll(CHIP_SELECTOR)) {
      const text = (chip.textContent || '').trim();
      const isShortsChip = text === 'Shorts' || (chip.getAttribute?.('title') || '').trim() === 'Shorts';
      setShortsHidden(chip, isShortsChip);
    }
  }

  function scheduleShortsScan() {
    if (scanScheduled || isKilled || window.CineGlowKilled || !hideShortsEnabled) return;
    scanScheduled = true;
    if (typeof queueMicrotask === 'function') {
      queueMicrotask(scanShortsDom);
    } else {
      Promise.resolve().then(scanShortsDom);
    }
  }

  function syncObserver(enabled) {
    if (!enabled || isKilled || window.CineGlowKilled || !isYouTubeContext()) {
      if (domObserver) {
        domObserver.disconnect();
        domObserver = null;
      }
      return;
    }
    if (!domObserver && typeof MutationObserver === 'function') {
      const target = document.body || document.documentElement;
      if (target) {
        domObserver = new MutationObserver(() => scheduleShortsScan());
        domObserver.observe(target, { childList: true, subtree: true });
      }
    }
  }

  function updateDomAttribute(enabled) {
    if (isKilled || window.CineGlowKilled) {
      scanScheduled = false;
      document.documentElement?.removeAttribute('cineglow-hide-shorts');
      syncObserver(false);
      restoreHiddenShortsDom();
      return;
    }
    if (enabled) {
      document.documentElement?.setAttribute('cineglow-hide-shorts', 'true');
      syncObserver(true);
      scanShortsDom();
    } else {
      scanScheduled = false;
      document.documentElement?.removeAttribute('cineglow-hide-shorts');
      syncObserver(false);
      restoreHiddenShortsDom();
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
    const anchor = e.target.closest?.('a');
    if (!anchor) return;

    const rawHref = anchor.getAttribute?.('href') || anchor.href || '';
    const videoId = parseShortsVideoId(rawHref);
    if (!videoId) return;

    e.preventDefault();
    e.stopPropagation();
    navigateWithinYouTube(`/watch?v=${encodeURIComponent(videoId)}`);
  };

  const onNavigate = () => {
    checkShortsRedirect();
    if (hideShortsEnabled && !isKilled) {
      scanShortsDom();
    }
  };

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
    syncObserver(false);
    restoreHiddenShortsDom();

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
        if (chrome.runtime?.lastError || isKilled) return;
        hideShortsEnabled = Boolean(stored?.hideShorts);
        updateDomAttribute(hideShortsEnabled);
        checkShortsRedirect();
      });
      chrome.storage.managed?.get(['KillSwitch'], (managed) => {
        if (!chrome.runtime?.lastError && managed?.KillSwitch) teardownKillSwitch();
      });
      chrome.storage.local?.get(['auraKillSwitchActive'], (local) => {
        if (!chrome.runtime?.lastError && local?.auraKillSwitchActive) teardownKillSwitch();
      });
    }
  }

  init();
})();

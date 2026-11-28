// content/hide-ai.js
// CineGlow Pro for YouTube - Official AI / Synthetic Content Disclosure Filter
// Author: Giri Manohar Vemula (https://www.linkedin.com/in/manoharv511)
(() => {
  'use strict';

  const CARD_SELECTOR = [
    'ytd-rich-item-renderer',
    'ytd-video-renderer',
    'ytd-compact-video-renderer',
    'ytd-grid-video-renderer',
    'ytd-playlist-video-renderer',
    'yt-lockup-view-model'
  ].join(', ');

  const CARD_BADGE_SELECTOR = [
    'ytd-badge-supported-renderer',
    'yt-badge-view-model',
    'badge-shape',
    '.yt-badge-shape',
    '.badge',
    '.badge-style-type-simple',
    '[class*="badge"]',
    '[class*="disclosure"]'
  ].join(', ');

  const WATCH_DISCLOSURE_SELECTOR = [
    'ytd-video-attributes-renderer',
    'yt-attribute-view-model',
    'ytd-info-panel-content-renderer',
    '.ytp-disclosure'
  ].join(', ');

  const HIDDEN_CARD_ATTR = 'data-cineglow-ai-hidden';
  const WATCH_HIDDEN_ATTR = 'cineglow-ai-watch-hidden';
  const OVERLAY_ID = 'cineglow-ai-disclosure-overlay';

  const OFFICIAL_CARD_BADGE_RE = /\b(altered or synthetic content|made with ai|synthetic content|sound or visuals were significantly edited or digitally generated)\b/i;
  const WATCH_DISCLOSURE_TEXT_RE = /\b(how this content was made|altered or synthetic content|made with ai|sound or visuals were significantly edited or digitally generated)\b/i;
  const WATCH_HEADING_RE = /\bhow this content was made\b/i;
  const WATCH_DETAIL_RE = /\b(altered or synthetic content|made with ai|sound or visuals were significantly edited or digitally generated|synthetic media)\b/i;

  const MAX_DISMISSED_IDS = 200;
  let hideAiEnabled = typeof AURA_DEFAULTS !== 'undefined' && AURA_DEFAULTS.hideAiVideos !== undefined
    ? Boolean(AURA_DEFAULTS.hideAiVideos)
    : false;
  let isKilled = Boolean(typeof window !== 'undefined' && window.CineGlowKilled);
  let currentVideoId = null;
  let disclosedVideoId = null;
  let disclosureReason = null;
  const dismissedVideoIds = new Set();

  function rememberDismissedVideo(videoId) {
    if (!videoId) return;
    if (dismissedVideoIds.size >= MAX_DISMISSED_IDS && !dismissedVideoIds.has(videoId)) {
      const oldest = dismissedVideoIds.values().next().value;
      if (oldest !== undefined) dismissedVideoIds.delete(oldest);
    }
    dismissedVideoIds.add(videoId);
  }

  let domObserver = null;
  let scanScheduled = false;
  let playGuardVideo = null;

  function isYouTubeContext() {
    if (typeof window === 'undefined' || !window.location) return false;
    const h = (window.location.hostname || '').toLowerCase();
    return h === '' || h === 'youtube.com' || h.endsWith('.youtube.com') || h === 'youtu.be' || h.endsWith('.youtu.be');
  }

  function getCurrentWatchVideoId() {
    if (typeof window === 'undefined' || !window.location) return null;
    try {
      const url = new URL(window.location.href);
      const v = url.searchParams?.get?.('v');
      if (v) return v;
      const match = (url.pathname || '').match(/^\/(?:live|shorts)\/([a-zA-Z0-9_-]+)/);
      return match ? match[1] : null;
    } catch (_) {
      return null;
    }
  }

  function clearPlayGuard() {
    if (playGuardVideo) {
      playGuardVideo.removeEventListener('play', onGuardedVideoPlay, true);
      playGuardVideo = null;
    }
  }

  function shouldBlockWatchPlayer() {
    return Boolean(
      !isKilled &&
      !window.CineGlowKilled &&
      hideAiEnabled &&
      currentVideoId &&
      disclosedVideoId === currentVideoId &&
      !dismissedVideoIds.has(currentVideoId)
    );
  }

  function onGuardedVideoPlay(e) {
    if (!shouldBlockWatchPlayer()) {
      clearPlayGuard();
      return;
    }
    const video = e?.target;
    if (video && typeof video.pause === 'function') {
      try { video.pause(); } catch (_) {}
    }
  }

  function removeWatchOverlay() {
    clearPlayGuard();
    document.documentElement?.removeAttribute(WATCH_HIDDEN_ATTR);
    const existing = document.getElementById(OVERLAY_ID);
    if (existing) existing.remove();
  }

  function isInsideDescriptionExpander(el) {
    if (!el) return false;
    if (typeof el.closest === 'function') {
      return Boolean(el.closest('#description, ytd-text-inline-expander'));
    }
    let curr = el.parentElement || el.parentNode;
    while (curr) {
      const id = (curr.getAttribute?.('id') || curr.id || '').toLowerCase();
      const tag = (curr.tagName || '').toLowerCase();
      if (id === 'description' || tag === 'ytd-text-inline-expander') return true;
      curr = curr.parentElement || curr.parentNode;
    }
    return false;
  }

  /**
   * Restore all feed cards hidden by official AI disclosure markers.
   */
  function restoreHiddenCards() {
    const root = document.body || document;
    if (!root || typeof root.querySelectorAll !== 'function') return;
    for (const card of root.querySelectorAll(CARD_SELECTOR)) {
      if (card.hasAttribute(HIDDEN_CARD_ATTR)) {
        card.removeAttribute(HIDDEN_CARD_ATTR);
      }
    }
    try {
      for (const card of root.querySelectorAll(`[${HIDDEN_CARD_ATTR}]`)) {
        card.removeAttribute(HIDDEN_CARD_ATTR);
      }
    } catch (_) {}
  }

  /**
   * Return true when an official badge or disclosure child reports synthetic content.
   * Deliberately ignores video titles to avoid false positives.
   * @param {Element} card
   * @returns {boolean}
   */
  function hasOfficialBadgeDisclosure(card) {
    if (!card || typeof card.querySelectorAll !== 'function') return false;
    const badges = card.querySelectorAll(CARD_BADGE_SELECTOR);
    for (const badge of badges) {
      const text = (badge.textContent || '').trim();
      if (text && OFFICIAL_CARD_BADGE_RE.test(text)) return true;
      const aria = (badge.getAttribute?.('aria-label') || '').trim();
      if (aria && OFFICIAL_CARD_BADGE_RE.test(aria)) return true;
    }
    return false;
  }

  /**
   * Scan feed and sidebar cards for official YouTube AI disclosure badges.
   */
  function scanFeeds() {
    if (isKilled || window.CineGlowKilled || !isYouTubeContext()) return;
    if (!hideAiEnabled) {
      restoreHiddenCards();
      return;
    }
    const root = document.body || document;
    if (!root || typeof root.querySelectorAll !== 'function') return;
    const cards = root.querySelectorAll(CARD_SELECTOR);
    for (const card of cards) {
      if (hasOfficialBadgeDisclosure(card)) {
        if (card.getAttribute(HIDDEN_CARD_ATTR) !== 'true') {
          card.setAttribute(HIDDEN_CARD_ATTR, 'true');
        }
      } else if (card.hasAttribute(HIDDEN_CARD_ATTR)) {
        card.removeAttribute(HIDDEN_CARD_ATTR);
      }
    }
  }

  /**
   * Detect structured Watch Page official disclosure panels outside free-form descriptions.
   * @returns {string|null}
   */
  function detectWatchDomDisclosure() {
    const root = document.body || document;
    if (!root || typeof root.querySelectorAll !== 'function') return null;
    const nodes = root.querySelectorAll(WATCH_DISCLOSURE_SELECTOR);
    for (const el of nodes) {
      // Never inspect free-form creator descriptions inside expanders
      if (isInsideDescriptionExpander(el)) continue;
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      if (el.tagName?.toLowerCase() === 'ytd-video-attributes-renderer') {
        if (WATCH_HEADING_RE.test(text) && WATCH_DETAIL_RE.test(text)) {
          return 'Altered or synthetic content';
        }
        continue;
      }
      if (WATCH_DISCLOSURE_TEXT_RE.test(text) && text.length <= 220) {
        return WATCH_DETAIL_RE.test(text)
          ? text.slice(0, 120)
          : 'How this content was made: Altered or synthetic content';
      }
    }
    return null;
  }

  function navigateNextOrBack(player) {
    try {
      if (player && typeof player.nextVideo === 'function') {
        const nextBtn = player.querySelector?.('.ytp-next-button');
        const nextHref = nextBtn?.getAttribute?.('href');
        if (nextHref) {
          player.nextVideo();
          return;
        }
      }
      const nextLink = document.querySelector('.ytp-next-button[href]');
      if (nextLink && typeof nextLink.click === 'function') {
        nextLink.click();
        return;
      }
      if (typeof window.history?.back === 'function') {
        window.history.back();
      }
    } catch (_) {}
  }

  function getActivePlayer() {
    return document.getElementById('movie_player') || document.querySelector('.html5-video-player');
  }

  function getActiveVideo(player) {
    return player?.querySelector?.('video.html5-main-video') ||
      player?.querySelector?.('video') ||
      document.querySelector('video.html5-main-video') ||
      document.querySelector('video');
  }

  function syncWatchBlockingUi() {
    if (!shouldBlockWatchPlayer()) {
      removeWatchOverlay();
      return;
    }

    const player = getActivePlayer();
    const video = getActiveVideo(player);
    document.documentElement?.setAttribute(WATCH_HIDDEN_ATTR, 'true');

    if (video) {
      if (playGuardVideo && playGuardVideo !== video) {
        clearPlayGuard();
      }
      if (playGuardVideo !== video) {
        video.addEventListener('play', onGuardedVideoPlay, true);
        playGuardVideo = video;
      }
      if (!video.paused && typeof video.pause === 'function') {
        try { video.pause(); } catch (_) {}
      }
    }

    const host = player || document.body;
    if (!host) return;

    let overlay = document.getElementById(OVERLAY_ID);
    const reasonText = disclosureReason || 'Altered or synthetic content';

    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = OVERLAY_ID;
      overlay.className = 'cineglow-ai-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-label', 'AI content disclosure notice');

      const card = document.createElement('div');
      card.className = 'cineglow-ai-card';

      const pill = document.createElement('span');
      pill.className = 'cineglow-ai-pill';
      pill.textContent = 'YouTube Official Disclosure';

      const heading = document.createElement('h2');
      heading.className = 'cineglow-ai-title';
      heading.textContent = 'AI or Synthetic Content Detected';

      const subtitle = document.createElement('p');
      subtitle.className = 'cineglow-ai-reason';
      subtitle.textContent = reasonText;

      const actions = document.createElement('div');
      actions.className = 'cineglow-ai-actions';

      const nextBtn = document.createElement('button');
      nextBtn.type = 'button';
      nextBtn.className = 'cineglow-ai-btn cineglow-ai-btn-primary';
      nextBtn.textContent = 'Skip to Next';
      nextBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        navigateNextOrBack(getActivePlayer());
      });

      const watchBtn = document.createElement('button');
      watchBtn.type = 'button';
      watchBtn.className = 'cineglow-ai-btn cineglow-ai-btn-secondary';
      watchBtn.textContent = 'Watch Anyway';
      watchBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        rememberDismissedVideo(currentVideoId);
        removeWatchOverlay();
        const v = getActiveVideo(getActivePlayer());
        if (v && v.paused && typeof v.play === 'function') {
          try {
            const p = v.play();
            if (p && typeof p.catch === 'function') p.catch(() => {});
          } catch (_) {}
        }
      });

      actions.appendChild(nextBtn);
      actions.appendChild(watchBtn);
      card.appendChild(pill);
      card.appendChild(heading);
      card.appendChild(subtitle);
      card.appendChild(actions);
      overlay.appendChild(card);
      host.appendChild(overlay);
    } else {
      const subtitle = overlay.querySelector('.cineglow-ai-reason');
      if (subtitle) subtitle.textContent = reasonText;
    }
  }

  function requestMainWorldDisclosureCheck() {
    if (isKilled || window.CineGlowKilled || !hideAiEnabled || !isYouTubeContext()) return;
    if (typeof window.postMessage === 'function') {
      try {
        window.postMessage({ type: 'CINEGLOW_CHECK_AI_DISCLOSURE' }, window.location.origin);
      } catch (_) {}
    }
  }

  function scanWatchDisclosure() {
    if (isKilled || window.CineGlowKilled || !isYouTubeContext()) return;
    const vid = getCurrentWatchVideoId();
    if (vid !== currentVideoId) {
      currentVideoId = vid;
      disclosedVideoId = null;
      disclosureReason = null;
      removeWatchOverlay();
    }
    if (!hideAiEnabled || !currentVideoId) {
      removeWatchOverlay();
      return;
    }
    const domReason = detectWatchDomDisclosure();
    if (domReason) {
      disclosedVideoId = currentVideoId;
      disclosureReason = domReason;
    }
    syncWatchBlockingUi();
  }

  function runScan() {
    scanScheduled = false;
    if (isKilled || window.CineGlowKilled) return;
    scanFeeds();
    scanWatchDisclosure();
  }

  function scheduleScan() {
    if (scanScheduled || isKilled || window.CineGlowKilled || !hideAiEnabled) return;
    scanScheduled = true;
    if (typeof queueMicrotask === 'function') {
      queueMicrotask(runScan);
    } else {
      Promise.resolve().then(runScan);
    }
  }

  function ensureObserver() {
    if (domObserver || isKilled || window.CineGlowKilled || !hideAiEnabled || !isYouTubeContext()) return;
    if (typeof MutationObserver !== 'function') return;
    const target = document.body || document.documentElement;
    if (!target) return;
    domObserver = new MutationObserver(() => scheduleScan());
    domObserver.observe(target, { childList: true, subtree: true });
  }

  function disconnectObserver() {
    if (domObserver) {
      domObserver.disconnect();
      domObserver = null;
    }
  }

  function applyEnabledState(nextEnabled) {
    hideAiEnabled = Boolean(nextEnabled);
    if (!hideAiEnabled) {
      disconnectObserver();
      restoreHiddenCards();
      removeWatchOverlay();
      return;
    }
    ensureObserver();
    runScan();
    requestMainWorldDisclosureCheck();
  }

  function handleWindowMessage(event) {
    if (isKilled || window.CineGlowKilled) return;
    if (!event || event.source !== window || event.origin !== window.location.origin) return;
    if (event.data?.type !== 'CINEGLOW_AI_DISCLOSURE_RESPONSE') return;

    const { videoId, disclosed, reason } = event.data;
    const activeId = getCurrentWatchVideoId();
    if (!videoId || videoId !== activeId) return;

    currentVideoId = activeId;
    if (disclosed) {
      disclosedVideoId = videoId;
      disclosureReason = typeof reason === 'string' && reason.trim()
        ? reason.trim()
        : 'Altered or synthetic content';
      syncWatchBlockingUi();
    } else if (disclosedVideoId === videoId && !detectWatchDomDisclosure()) {
      disclosedVideoId = null;
      disclosureReason = null;
      removeWatchOverlay();
    }
  }

  function handleNavigate() {
    if (isKilled || window.CineGlowKilled) return;
    const vid = getCurrentWatchVideoId();
    if (vid !== currentVideoId) {
      currentVideoId = vid;
      disclosedVideoId = null;
      disclosureReason = null;
      removeWatchOverlay();
    }
    if (hideAiEnabled) {
      runScan();
      requestMainWorldDisclosureCheck();
    }
  }

  function handleStorageChange(changes, area) {
    if (isKilled || window.CineGlowKilled) return;
    if (area === 'managed' && changes?.KillSwitch?.newValue === true) {
      teardownKillSwitch();
      return;
    }
    if (area === 'local' && changes?.auraKillSwitchActive?.newValue === true) {
      teardownKillSwitch();
      return;
    }
    if (area === 'sync' && changes && 'hideAiVideos' in changes) {
      applyEnabledState(Boolean(changes.hideAiVideos.newValue));
    }
  }

  function teardownKillSwitch() {
    if (isKilled) return;
    isKilled = true;
    hideAiEnabled = false;
    disclosedVideoId = null;
    disclosureReason = null;
    dismissedVideoIds.clear();
    disconnectObserver();
    restoreHiddenCards();
    removeWatchOverlay();

    chrome.storage?.onChanged?.removeListener(handleStorageChange);
    window.removeEventListener('message', handleWindowMessage);
    document.removeEventListener('yt-navigate-start', handleNavigate);
    document.removeEventListener('yt-navigate-finish', handleNavigate);
    document.removeEventListener('yt-page-data-updated', handleNavigate);
    window.removeEventListener('popstate', handleNavigate);
    window.CineGlowPlayer?.removeEventListener?.('state-change', handleNavigate);
  }

  function handleRuntimeMessage(message, _sender, sendResponse) {
    if (message?.type === 'AURA_EMERGENCY_KILL_SWITCH') {
      teardownKillSwitch();
      if (typeof sendResponse === 'function') sendResponse({ ok: true });
    }
  }

  async function init() {
    if (isKilled || window.CineGlowKilled || !isYouTubeContext()) return;
    try {
      const [local, managed, stored] = await Promise.all([
        chrome.storage?.local?.get?.(['auraKillSwitchActive']).catch(() => ({})),
        chrome.storage?.managed?.get?.(['KillSwitch']).catch(() => ({})),
        chrome.storage?.sync?.get?.({ hideAiVideos: false }).catch(() => ({}))
      ]);
      if (local?.auraKillSwitchActive || managed?.KillSwitch) {
        teardownKillSwitch();
        return;
      }
      applyEnabledState(Boolean(stored?.hideAiVideos));
    } catch (err) {
      console.warn('[CineGlow HideAI] Initialization error:', err);
    }
  }

  if (typeof window !== 'undefined') {
    window.CineGlowHideAi = {
      scanFeeds,
      scanWatchDisclosure,
      applyEnabledState,
      teardownKillSwitch,
      getState: () => ({
        isKilled,
        hideAiEnabled,
        currentVideoId,
        disclosedVideoId,
        disclosureReason,
        dismissedCount: dismissedVideoIds.size
      })
    };
  }

  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage?.addListener) {
    chrome.runtime.onMessage.addListener(handleRuntimeMessage);
  }
  chrome.storage?.onChanged?.addListener(handleStorageChange);
  window.addEventListener('message', handleWindowMessage);
  document.addEventListener('yt-navigate-start', handleNavigate);
  document.addEventListener('yt-navigate-finish', handleNavigate);
  document.addEventListener('yt-page-data-updated', handleNavigate);
  window.addEventListener('popstate', handleNavigate);
  window.addEventListener('cineglow:kill-switch', teardownKillSwitch, { once: true });
  if (window.CineGlowPlayer?.addEventListener) {
    window.CineGlowPlayer.addEventListener('state-change', handleNavigate);
  }

  init();
})();

// Runs in the MAIN world at document_start to safely bypass CSP restrictions
// Author: Giri Manohar Vemula (https://www.linkedin.com/in/manoharv511)
(() => {
  'use strict';

  let isKilled = false;
  let adBlockEnabled = true;
  let mainWorldAdInterval = null;
  let adMutationObserver = null;
  let bootstrapObserver = null;
  let observedPlayer = null;
  let preAdSpeed = 1.0;
  let acceleratedVideo = null;
  let preferredPlaybackSpeed = 1.0;
  let adMuted = false;
  let userWasMuted = false;
  let isSkippingMainWorld = false;
  let lastMainWorldSkipClickTime = 0;
  let theaterTimer = null;
  let navAutoStartUntil = 0;
  let userPausedCurrentNav = false;
  let hasPlayedCurrentNav = false;
  let sawVideoEnded = false;
  let lastNavLocation = typeof window !== 'undefined' ? (window.location?.href || '') : '';
  let navRecoveryTimers = [];
  let qualityResumePending = false;
  let lastUpdatedPageData = null;
  let lastUpdatedPageVideoId = null;
  let origJSONParse = null;
  let wrappedJSONParse = null;
  let origFetch = null;
  let wrappedFetch = null;
  let origOpen = null;
  let wrappedOpen = null;
  let origSend = null;
  let wrappedSend = null;
  let origFnToString = null;
  let customFnToString = null;

  try {
    if (typeof Function !== 'undefined' && Function.prototype && Function.prototype.toString) {
      origFnToString = Function.prototype.toString;
      customFnToString = function toString() {
        if (this === JSON.parse && origJSONParse) return origJSONParse.toString();
        if (typeof window !== 'undefined' && this === window.fetch && origFetch) return origFetch.toString();
        if (typeof XMLHttpRequest !== 'undefined') {
          if (this === XMLHttpRequest.prototype.open && origOpen) return origOpen.toString();
          if (this === XMLHttpRequest.prototype.send && origSend) return origSend.toString();
        }
        return origFnToString.apply(this, arguments);
      };
      Function.prototype.toString = customFnToString;
    }
  } catch (_) {}

  const MAIN_SKIP_BUTTON_SELECTOR = [
    '.ytp-ad-skip-button-modern',
    '.ytp-ad-skip-button',
    '.ytp-skip-ad-button',
    '.ytp-ad-skip-button-slot button',
    '[id^="skip-button:"] button',
    'button.ytp-ad-skip-button-modern',
    '.ytp-ad-skip-button-container button',
    '.ytp-ad-overlay-close-button'
  ].join(', ');

  // --- Phase 1: Stub YouTube Ad Globals BEFORE any YouTube code runs ---
  try {
    let gTag = { cmd: [] };
    Object.defineProperty(window, 'googletag', {
      configurable: true,
      enumerable: false,
      get: () => gTag,
      set: (v) => { if (v && typeof v === 'object') gTag = v; }
    });
  } catch (_) {}

  try {
    Object.defineProperty(window, 'ytAds', {
      configurable: true,
      enumerable: false,
      get: () => undefined,
      set: () => {}
    });
  } catch (_) {}

  try {
    Object.defineProperty(window, 'adBlocksFound', {
      configurable: true,
      enumerable: false,
      get: () => 0,
      set: () => {}
    });
    window.yt = window.yt || {};
    Object.defineProperty(window.yt, 'adBlocksFound', {
      configurable: true,
      enumerable: false,
      get: () => 0,
      set: () => {}
    });
  } catch (_) {}

  try {
    Object.defineProperty(window, 'hasAllowedInstreamAd', {
      configurable: true,
      enumerable: false,
      get: () => true,
      set: () => {}
    });
    window.yt = window.yt || {};
    Object.defineProperty(window.yt, 'hasAllowedInstreamAd', {
      configurable: true,
      enumerable: false,
      get: () => true,
      set: () => {}
    });
  } catch (_) {}

  // --- Phase 2: Deep Player Response Pruning ---
  const AD_KEYS_TO_DELETE = [
    'adPlacements', 'playerAds', 'adSlots', 'adBreakHeartbeatParams',
    'adSlotRenderer', 'companionSlot', 'adBreakParams',
    'adsEngagementPanelConfig', 'adModule',
    'actionCompanionAdRenderer', 'adBreakServiceRenderer',
    'adHoverTextButtonRenderer', 'adInfoDialogRenderer',
    'adLayoutLoggingData', 'adPlacementConfig',
    'inPlayerAdSlotRenderer', 'instreamAdBreak',
    'linkedPlayerBytesAdLayoutRenderer', 'playerBytesAdLayoutRenderer',
    'instreamVideoAdRenderer', 'linearAdSequenceRenderer',
    'adInfoRenderer', 'promotedSparklesWebRenderer',
    'adFeedbackRenderer', 'adSurveyRenderer',
    'playerLegacyDesktopWatchAdsRenderer',
    'desktopWatchAdsRenderer',
    'bannerPromoRenderer'
  ];

  function prunePlayerAds(data, visited = new WeakSet()) {
    if (isKilled || !adBlockEnabled || !data || typeof data !== 'object') return data;
    if (visited.has(data)) return data;
    visited.add(data);
    try {
      for (const key of AD_KEYS_TO_DELETE) {
        if (key in data) {
          if (Array.isArray(data[key])) {
            data[key] = [];
          } else {
            delete data[key];
          }
        }
      }

      if (data.playerResponse && typeof data.playerResponse === 'object') {
        prunePlayerAds(data.playerResponse, visited);
      }
      if (data.raw_player_response && typeof data.raw_player_response === 'object') {
        prunePlayerAds(data.raw_player_response, visited);
      }

      if (data.playerConfig) {
        if (data.playerConfig.adConfig) delete data.playerConfig.adConfig;
        if (data.playerConfig.adsConfig) delete data.playerConfig.adsConfig;
      }

      if (data.overlay?.playerOverlayRenderer?.decoratedPlayerBarRenderer) {
        const dpbr = data.overlay.playerOverlayRenderer.decoratedPlayerBarRenderer.decoratedPlayerBarRenderer;
        const pb = dpbr?.playerBar?.multiMarkersPlayerBarRenderer || dpbr?.playerBar?.chapteredPlayerBarRenderer;
        if (pb && pb.adBreakMarkerRenderer) delete pb.adBreakMarkerRenderer;
      }

      if (Array.isArray(data.engagementPanels)) {
        data.engagementPanels = data.engagementPanels.filter(
          (p) => !p?.engagementPanelSectionListRenderer?.targetId?.includes('ads')
        );
      }
    } catch (_) {}
    return data;
  }

  // --- Phase 3: Global JSON.parse Hook (covers fetch().json() and inline JSON) ---
  try {
    if (typeof JSON !== 'undefined' && typeof JSON.parse === 'function') {
      origJSONParse = JSON.parse;
      wrappedJSONParse = function parse(...args) {
        if (!adBlockEnabled || (isKilled && origJSONParse)) return origJSONParse.apply(this, args);
        const result = origJSONParse.apply(this, args);
        if (!isKilled && adBlockEnabled && result && typeof result === 'object') {
          prunePlayerAds(result);
        }
        return result;
      };
      JSON.parse = wrappedJSONParse;
    }
  } catch (_) {}

  // --- Phase 4: Intercept and Sanitize YouTube Global Config Objects ---
  try {
    let _rawInitial = window.ytInitialPlayerResponse;
    if (_rawInitial) prunePlayerAds(_rawInitial);
    Object.defineProperty(window, 'ytInitialPlayerResponse', {
      configurable: true,
      enumerable: true,
      get: () => _rawInitial,
      set: (val) => { _rawInitial = prunePlayerAds(val); }
    });

    let _rawInitialData = window.ytInitialData;
    if (_rawInitialData) prunePlayerAds(_rawInitialData);
    Object.defineProperty(window, 'ytInitialData', {
      configurable: true,
      enumerable: true,
      get: () => _rawInitialData,
      set: (val) => { _rawInitialData = prunePlayerAds(val); }
    });

    let _rawYtPlayer = window.ytplayer;
    if (_rawYtPlayer?.config?.args) {
      prunePlayerAds(_rawYtPlayer.config.args.raw_player_response);
      prunePlayerAds(_rawYtPlayer.config.args);
    }
    Object.defineProperty(window, 'ytplayer', {
      configurable: true,
      enumerable: true,
      get: () => _rawYtPlayer,
      set: (val) => {
        if (!isKilled && adBlockEnabled && val?.config?.args) {
          prunePlayerAds(val.config.args.raw_player_response);
          prunePlayerAds(val.config.args);
          if (val.config.args.ad3_module) val.config.args.ad3_module = null;
          if (val.config.args.ad_pings) val.config.args.ad_pings = null;
        }
        _rawYtPlayer = val;
      }
    });

    const neutralizeYtConfig = () => {
      if (isKilled || !adBlockEnabled) return;
      try {
        if (window.yt?.config_) {
          if (window.yt.config_.openPopupConfig?.supportedPopups) {
            window.yt.config_.openPopupConfig.supportedPopups.adBlockMessageViewModel = false;
            window.yt.config_.openPopupConfig.supportedPopups.adBlockMessageViewModelOld = false;
          }
          if (window.yt.config_.EXPERIMENT_FLAGS) {
            const flags = window.yt.config_.EXPERIMENT_FLAGS;
            flags.web_gel_timeout_cap = false;
            flags.web_display_mode = undefined;
            flags.ab_det_el_h = false;
            flags.ab_det_gen_re = false;
          }
        }
      } catch (_) {}
    };

    neutralizeYtConfig();
    const t1 = setTimeout(neutralizeYtConfig, 500);
    const t2 = setTimeout(neutralizeYtConfig, 1500);
    const t3 = setTimeout(neutralizeYtConfig, 3000);
    if (t1?.unref) t1.unref();
    if (t2?.unref) t2.unref();
    if (t3?.unref) t3.unref();
  } catch (_) {}

  // --- Phase 5: Ad Endpoint Blocking ---
  const BLOCK_URL_PATTERNS = [
    '/youtubei/v1/player/ad_break',
    '/ptracking',
    '/api/stats/ads',
    '/pagead/',
    '/pcs/activeview',
    'doubleclick.net',
    'googlesyndication.com'
  ];

  function shouldBlockUrl(url) {
    if (!adBlockEnabled || !url) return false;
    return BLOCK_URL_PATTERNS.some((p) => url.includes(p));
  }

  if (typeof window.fetch === 'function' && typeof Response !== 'undefined') {
    origFetch = window.fetch;
    wrappedFetch = function fetch(...args) {
      if (isKilled && origFetch) {
        return origFetch.apply(this, args);
      }
      const req = args[0];
      const url = typeof req === 'string'
        ? req
        : (req instanceof URL ? req.href : (req?.url || ''));
      if (shouldBlockUrl(url)) {
        return Promise.resolve(
          new Response('{}', {
            status: 200,
            statusText: 'OK',
            headers: { 'Content-Type': 'application/json' }
          })
        );
      }
      return origFetch.apply(this, args);
    };
    window.fetch = wrappedFetch;
  }

  if (typeof window.XMLHttpRequest !== 'undefined') {
    origOpen = XMLHttpRequest.prototype.open;
    origSend = XMLHttpRequest.prototype.send;

    wrappedOpen = function open(method, url, ...rest) {
      if (isKilled && origOpen) {
        return origOpen.call(this, method, url, ...rest);
      }
      this._cineglowUrl = typeof url === 'string' ? url : (url instanceof URL ? url.href : String(url));
      return origOpen.call(this, method, url, ...rest);
    };
    XMLHttpRequest.prototype.open = wrappedOpen;

    wrappedSend = function send(...args) {
      if (isKilled && origSend) {
        return origSend.apply(this, args);
      }
      if (this._cineglowUrl && shouldBlockUrl(this._cineglowUrl)) {
        try {
          const mockPayload = this.responseType === 'json' ? {} : '{}';
          Object.defineProperty(this, 'responseText', { value: '{}', writable: true, configurable: true });
          Object.defineProperty(this, 'response', { value: mockPayload, writable: true, configurable: true });
          Object.defineProperty(this, 'status', { value: 200, writable: true, configurable: true });
          Object.defineProperty(this, 'readyState', { value: 4, writable: true, configurable: true });
          queueMicrotask(() => {
            if (isKilled || !adBlockEnabled) return;
            this.dispatchEvent(new Event('readystatechange'));
            this.dispatchEvent(new Event('load'));
            this.dispatchEvent(new Event('loadend'));
          });
          return;
        } catch (_) {}
      }
      return origSend.apply(this, args);
    };
    XMLHttpRequest.prototype.send = wrappedSend;
  }

  function getPlayerElement() {
    return document.getElementById('movie_player') || document.querySelector('#shorts-player, .html5-video-player');
  }

  function isAdActive(player = getPlayerElement()) {
    return Boolean(
      player && (
        player.classList.contains('ad-showing') ||
        player.classList.contains('ad-interrupting')
      )
    );
  }

  function restoreVideoAfterAd(player = getPlayerElement()) {
    const video = (player && player.querySelector('video')) || document.querySelector('video.html5-main-video') || document.querySelector('video');
    if (!video) return;

    // Only restore if CineGlow actively muted or accelerated playback during an ad
    const hadAdMutation = Boolean(adMuted || acceleratedVideo || video.hasAttribute?.('data-cineglow-ad-muted'));
    if (!hadAdMutation) return;

    if (adMuted || video.hasAttribute?.('data-cineglow-ad-muted')) {
      if (!userWasMuted) {
        video.muted = false;
      }
      video.removeAttribute?.('data-cineglow-ad-muted');
      adMuted = false;
    }
    userWasMuted = false;
    if (acceleratedVideo === video && video.playbackRate === 16.0) {
      video.playbackRate = preAdSpeed || preferredPlaybackSpeed || 1.0;
    }
    acceleratedVideo = null;
  }

  // --- Phase 6: Zero-Latency Main-World Ad Skipping ---
  function skipMainWorldAd() {
    if (isKilled || !adBlockEnabled || isSkippingMainWorld) return;
    isSkippingMainWorld = true;

    try {
      const player = getPlayerElement();
      if (player) attachPlayerObserver(player);

      try {
        const watermarks = document.querySelectorAll(
          '.iv-branding, .branding-img-container, .branding-context-container, .ytp-featured-watermark, [class*="branding-img"], [class*="branding-context"]'
        );
        watermarks.forEach((w) => { try { w.remove(); } catch (_) {} });
      } catch (_) {}

      if (isAdActive(player)) {
        if (player && typeof player.skipAd === 'function') {
          try { player.skipAd(); } catch (_) {}
          if (!isAdActive(player)) {
            restoreVideoAfterAd(player);
            if (!userPausedCurrentNav && !document.hidden) {
              resumePlaybackIfStalled(true);
            }
            return;
          }
        }

        const video = (player && player.querySelector('video')) || document.querySelector('video.html5-main-video') || document.querySelector('video');
        if (video) {
          if (!adMuted) {
            if (video.playbackRate > 0 && video.playbackRate !== 16.0) {
              preAdSpeed = video.playbackRate;
            }
            const alreadyMutedByCineGlow = Boolean(video.hasAttribute?.('data-cineglow-ad-muted'));
            userWasMuted = video.muted && !alreadyMutedByCineGlow;
            if (!video.muted || alreadyMutedByCineGlow) {
              video.muted = true;
              video.setAttribute?.('data-cineglow-ad-muted', 'true');
              adMuted = true;
            }
          }
          acceleratedVideo = video;
          try {
            video.playbackRate = 16.0;
          } catch (_) {}
        }

        if (player) {
          const now = Date.now();
          if (now - lastMainWorldSkipClickTime > 150) {
            const btn = player.querySelector?.(MAIN_SKIP_BUTTON_SELECTOR);
            if (btn) {
              lastMainWorldSkipClickTime = now;
              try {
                if (btn.tagName !== 'BUTTON') {
                  const childBtn = btn.querySelector?.('button, [role="button"]');
                  if (childBtn) childBtn.click();
                }
                btn.click();
              } catch (_) {}
            }
          }
        }

        try {
          const overlays = document.querySelectorAll(
            '.ytp-ad-player-overlay, .ytp-ad-player-overlay-layout, ' +
            '.ytp-ad-player-overlay-instream-info, .ytp-ad-message-container, ' +
            '.ytp-ad-overlay-container, .ytp-ad-survey, .ytp-ad-preview-container'
          );
          overlays.forEach((el) => {
            el.style.display = 'none';
            try { el.remove(); } catch (_) {}
          });
        } catch (_) {}
      } else {
        restoreVideoAfterAd(player);
      }
    } catch (_) {
    } finally {
      isSkippingMainWorld = false;
    }
  }

  function attachPlayerObserver(player = getPlayerElement()) {
    if (isKilled || !adBlockEnabled || !player || observedPlayer === player) return;
    if (bootstrapObserver) {
      bootstrapObserver.disconnect();
      bootstrapObserver = null;
    }
    if (!adMutationObserver && typeof MutationObserver !== 'undefined') {
      adMutationObserver = new MutationObserver(() => {
        skipMainWorldAd();
      });
    }
    if (adMutationObserver) {
      adMutationObserver.disconnect();
      observedPlayer = player;
      adMutationObserver.observe(player, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class']
      });
    }
  }

  // Temporary bootstrap observer that self-disconnects the instant #movie_player mounts
  function startBootstrapObserver() {
    if (isKilled || !adBlockEnabled || observedPlayer || typeof MutationObserver === 'undefined') return;
    const existing = getPlayerElement();
    if (existing) {
      attachPlayerObserver(existing);
      return;
    }
    bootstrapObserver = new MutationObserver(() => {
      const p = getPlayerElement();
      if (p) {
        attachPlayerObserver(p);
        skipMainWorldAd();
      }
    });
    const root = document.body || document.documentElement;
    if (root) {
      bootstrapObserver.observe(root, { childList: true, subtree: true });
    }
  }

  function syncAdLoop() {
    if (isKilled || !adBlockEnabled || document.hidden) {
      if (mainWorldAdInterval) {
        clearInterval(mainWorldAdInterval);
        mainWorldAdInterval = null;
      }
      return;
    }
    if (!mainWorldAdInterval) {
      mainWorldAdInterval = setInterval(skipMainWorldAd, 100);
      if (mainWorldAdInterval && typeof mainWorldAdInterval.unref === 'function') {
        mainWorldAdInterval.unref();
      }
    }
  }

  // --- MAIN-world Polymer Theater Sync (readable only in MAIN world) ---
  function syncTheaterState() {
    if (isKilled) return;
    try {
      const watchFlexy = document.querySelector('ytd-watch-flexy, ytd-watch-grid');
      const isTheater = Boolean(
        watchFlexy && (
          watchFlexy.hasAttribute('theater') ||
          watchFlexy.hasAttribute('theater-requested_') ||
          watchFlexy.theater ||
          watchFlexy.theaterRequested_
        )
      );
      if (document.documentElement) {
        if (isTheater) {
          document.documentElement.setAttribute('data-cineglow-theater', 'true');
        } else {
          document.documentElement.removeAttribute('data-cineglow-theater');
        }
      }
    } catch (_) {}
  }

  function scheduleTheaterSync() {
    clearTimeout(theaterTimer);
    theaterTimer = setTimeout(syncTheaterState, 100);
    if (theaterTimer && typeof theaterTimer.unref === 'function') {
      theaterTimer.unref();
    }
  }

  function handleTheaterKeydown(e) {
    if (e.key === 't' || e.key === 'T') {
      if (e.target?.matches?.('input, textarea, [contenteditable]') || e.target?.closest?.('ytd-searchbox, ytd-commentbox, yt-searchbox')) return;
      scheduleTheaterSync();
    }
  }

  function handleTheaterClick(e) {
    if (e.target?.closest?.('.ytp-size-button')) {
      scheduleTheaterSync();
    }
  }

  function handleVisibilityChange() {
    syncAdLoop();
    if (!document.hidden) skipMainWorldAd();
  }

  function clearNavRecoveryTimers() {
    for (const id of navRecoveryTimers) {
      clearTimeout(id);
    }
    navRecoveryTimers = [];
  }

  function resetNavPlaybackTracking() {
    lastNavLocation = window.location?.href || '';
    userPausedCurrentNav = false;
    hasPlayedCurrentNav = false;
    sawVideoEnded = false;
    qualityResumePending = false;
    navAutoStartUntil = Date.now() + 8000;
  }

  function scheduleNavRecovery() {
    clearNavRecoveryTimers();
    for (const delay of [250, 600, 1400]) {
      const id = setTimeout(() => {
        if (!isKilled) resumePlaybackIfStalled(true);
      }, delay);
      if (id?.unref) id.unref();
      navRecoveryTimers.push(id);
    }
  }

  function resumePlaybackIfStalled(fromLoadRecovery = false) {
    if (isKilled || document.hidden || userPausedCurrentNav) return;
    if (document.documentElement?.hasAttribute?.('cineglow-ai-watch-hidden')) return;
    const path = window.location?.pathname || '';
    if (path !== '/watch' && !path.startsWith('/watch') && !path.startsWith('/live/')) return;
    const player = getPlayerElement();
    const video = (player && player.querySelector('video')) || document.querySelector('video.html5-main-video') || document.querySelector('video');
    if (!video || !player || isAdActive(player)) return;

    if (video.paused && video.currentTime < 0.5 && !video.ended) {
      try {
        if (typeof player.playVideo === 'function') {
          const state = typeof player.getPlayerState === 'function' ? player.getPlayerState() : -1;
          const canRecoverLoad = Boolean(
            fromLoadRecovery &&
            !hasPlayedCurrentNav &&
            Date.now() < navAutoStartUntil &&
            video.readyState >= 2
          );
          if (state === -1 || state === 5 || canRecoverLoad) {
            player.playVideo();
          }
        } else if (fromLoadRecovery && !hasPlayedCurrentNav && video.readyState >= 2) {
          video.play().catch(() => {});
        }
      } catch (_) {}
    }
  }

  /**
   * Extract active YouTube video ID from the current location URL.
   * @returns {string|null}
   */
  function getCurrentWatchVideoId() {
    try {
      const url = new URL(window.location.href);
      const v = url.searchParams.get('v');
      if (v) return v;
      const match = url.pathname.match(/^\/(?:live|shorts)\/([a-zA-Z0-9_-]+)/);
      return match ? match[1] : null;
    } catch (_) {
      return null;
    }
  }

  const AI_DISCLOSURE_CONTAINER_KEYS = new Set([
    'howThisContentWasMade',
    'howThisContentWasMadeSectionViewModel',
    'videoAttributesSectionViewModel',
    'structuredDescriptionContentRenderer',
    'attributeViewModel',
    'ytAttributeViewModel',
    'infoPanelContainerRenderer',
    'infoPanelContentRenderer',
    'metadataBadgeRenderer',
    'playerMicroformatRenderer',
    'microformatDataRenderer',
    'syntheticMedia',
    'alteredOrSyntheticContent',
    'disclosureStatus'
  ]);

  const AI_DISCLOSURE_SKIP_KEYS = new Set([
    'shortDescription',
    'attributedDescription',
    'attributedDescriptionBodyRenderer',
    'description',
    'descriptionText',
    'secondaryResults',
    'relatedVideos',
    'watchNextSecondaryResultsRenderer',
    'continuationItems',
    'commentRenderer',
    'commentsEntryPointHeaderRenderer',
    'liveChatRenderer',
    'transcriptRenderer',
    'annotations',
    'streamingData'
  ]);

  const AI_DISCLOSURE_FLAG_KEYS = new Set([
    'isAlteredOrSynthetic',
    'isSyntheticMedia',
    'containsSyntheticMedia',
    'hasAlteredOrSyntheticContent'
  ]);

  const AI_DISCLOSURE_TEXT_RE = /\b(how this content was made|altered or synthetic content|sound or visuals were significantly edited or digitally generated|made with ai)\b/i;

  /**
   * Traverse structured YouTube disclosure blocks (ignoring descriptions and comments)
   * with a WeakSet cycle guard and bounded recursion depth.
   * @param {unknown} node
   * @param {boolean} inDisclosureScope
   * @param {number} depth
   * @param {WeakSet<object>} seen
   * @returns {string|null}
   */
  function findOfficialAiDisclosure(node, inDisclosureScope = false, depth = 0, seen = new WeakSet()) {
    if (!node || depth > 14) return null;
    if (typeof node === 'boolean') return null;
    if (typeof node === 'string') {
      if (inDisclosureScope && AI_DISCLOSURE_TEXT_RE.test(node)) {
        return node.trim().slice(0, 120);
      }
      return null;
    }
    if (typeof node !== 'object') return null;
    if (seen.has(node)) return null;
    seen.add(node);

    if (Array.isArray(node)) {
      const limit = Math.min(node.length, 40);
      for (let i = 0; i < limit; i++) {
        const hit = findOfficialAiDisclosure(node[i], inDisclosureScope, depth + 1, seen);
        if (hit) return hit;
      }
      return null;
    }

    for (const key of Object.keys(node)) {
      if (AI_DISCLOSURE_SKIP_KEYS.has(key)) continue;
      const val = node[key];
      if (AI_DISCLOSURE_FLAG_KEYS.has(key) && val === true) {
        return 'Altered or synthetic content';
      }
      const nextScope = inDisclosureScope || AI_DISCLOSURE_CONTAINER_KEYS.has(key);
      if (key === 'howThisContentWasMade' || key === 'alteredOrSyntheticContent' || key === 'howThisContentWasMadeSectionViewModel') {
        const innerHit = findOfficialAiDisclosure(val, true, depth + 1, seen);
        return innerHit || 'Altered or synthetic content';
      }
      const hit = findOfficialAiDisclosure(val, nextScope, depth + 1, seen);
      if (hit) return hit;
    }
    return null;
  }

  function extractPayloadVideoId(payload) {
    if (!payload || typeof payload !== 'object') return null;
    return payload?.videoDetails?.videoId ||
      payload?.currentVideoEndpoint?.watchEndpoint?.videoId ||
      payload?.playerResponse?.videoDetails?.videoId ||
      payload?.microformat?.playerMicroformatRenderer?.externalVideoId ||
      null;
  }

  function inspectAndEmitAiDisclosure() {
    if (isKilled) return;
    const videoId = getCurrentWatchVideoId();
    if (!videoId) {
      window.postMessage({ type: 'CINEGLOW_AI_DISCLOSURE_RESPONSE', videoId: null, disclosed: false, reason: null }, window.location.origin);
      return;
    }

    const candidates = [];
    const player = getPlayerElement();
    try {
      const pr = typeof player?.getPlayerResponse === 'function' ? player.getPlayerResponse() : null;
      const prId = extractPayloadVideoId(pr);
      if (pr && (!prId || prId === videoId)) candidates.push(pr);
    } catch (_) {}

    try {
      const flexy = document.querySelector('ytd-watch-flexy');
      const flexyData = flexy?.data;
      const flexyVid = flexy?.getAttribute?.('video-id') || extractPayloadVideoId(flexyData);
      if (flexyData && (!flexyVid || flexyVid === videoId)) candidates.push(flexyData);
    } catch (_) {}

    if (lastUpdatedPageData && (!lastUpdatedPageVideoId || lastUpdatedPageVideoId === videoId)) {
      candidates.push(lastUpdatedPageData);
    }

    try {
      const initPr = window.ytInitialPlayerResponse;
      if (initPr && extractPayloadVideoId(initPr) === videoId) candidates.push(initPr);
      const initData = window.ytInitialData;
      if (initData && extractPayloadVideoId(initData) === videoId) candidates.push(initData);
    } catch (_) {}

    let reason = null;
    for (const candidate of candidates) {
      reason = findOfficialAiDisclosure(candidate);
      if (reason) break;
    }

    window.postMessage({
      type: 'CINEGLOW_AI_DISCLOSURE_RESPONSE',
      videoId,
      disclosed: Boolean(reason),
      reason
    }, window.location.origin);
  }

  function handleNavigateStart() {
    if (isKilled) return;
    resetNavPlaybackTracking();
  }

  function handleNavigateFinish() {
    if (window.location?.href && window.location.href !== lastNavLocation) {
      resetNavPlaybackTracking();
    } else if (!navAutoStartUntil) {
      navAutoStartUntil = Date.now() + 8000;
    }
    startBootstrapObserver();
    skipMainWorldAd();
    syncTheaterState();
    scheduleNavRecovery();
    inspectAndEmitAiDisclosure();
  }

  function handlePageDataUpdated(e) {
    const resp = e?.detail?.response;
    if (resp && typeof resp === 'object') {
      lastUpdatedPageData = resp;
      lastUpdatedPageVideoId = extractPayloadVideoId(resp) || getCurrentWatchVideoId();
    }
    syncTheaterState();
    if (window.location?.href && window.location.href !== lastNavLocation) {
      resetNavPlaybackTracking();
      scheduleNavRecovery();
    }
    inspectAndEmitAiDisclosure();
  }

  const NON_PAUSE_PLAYER_CONTROLS = [
    MAIN_SKIP_BUTTON_SELECTOR,
    '.cineglow-floating-toolbar',
    '.ytp-mute-button',
    '.ytp-volume-panel',
    '.ytp-settings-button',
    '.ytp-settings-menu',
    '.ytp-size-button',
    '.ytp-fullscreen-button',
    '.ytp-subtitles-button',
    '.ytp-pip-button',
    '.ytp-miniplayer-button'
  ].join(', ');

  function handleUserPointerDownCapture(e) {
    if (isKilled) return;
    const player = getPlayerElement();
    if (!player || !player.contains(e.target)) return;
    if (e.target?.closest?.(NON_PAUSE_PLAYER_CONTROLS)) return;
    const video = (player.querySelector('video.html5-main-video') || player.querySelector('video'));
    if (video && !video.paused) {
      userPausedCurrentNav = true;
      navAutoStartUntil = 0;
    }
  }

  function handleUserPauseKeydown(e) {
    if (isKilled || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target?.matches?.('input, textarea, [contenteditable]') || e.target?.closest?.('ytd-searchbox, ytd-commentbox, yt-searchbox')) return;
    if (e.key === ' ' || e.key === 'k' || e.key === 'K' || e.key === 'MediaPlayPause') {
      const player = getPlayerElement();
      const video = (player && (player.querySelector('video.html5-main-video') || player.querySelector('video'))) || document.querySelector('video.html5-main-video') || document.querySelector('video');
      if (video && !video.paused) {
        userPausedCurrentNav = true;
        navAutoStartUntil = 0;
      }
    }
  }

  function handleMediaLifecycleCapture(e) {
    if (isKilled) return;
    const target = e.target;
    if (!target || target.tagName !== 'VIDEO') return;
    const player = getPlayerElement();
    if (player && !player.contains(target)) return;

    if (e.type === 'ended') {
      sawVideoEnded = true;
      return;
    }

    if (e.type === 'timeupdate') {
      if (!target.paused && target.currentTime > 0.5) {
        hasPlayedCurrentNav = true;
        qualityResumePending = false;
      }
      return;
    }

    if (e.type === 'loadedmetadata' || e.type === 'loadeddata' || e.type === 'canplay') {
      if (sawVideoEnded || (window.location?.href && window.location.href !== lastNavLocation)) {
        resetNavPlaybackTracking();
      }
      if (e.type === 'canplay' || e.type === 'loadeddata') {
        if (qualityResumePending && !userPausedCurrentNav && !document.hidden && !document.documentElement?.hasAttribute?.('cineglow-ai-watch-hidden')) {
          qualityResumePending = false;
          if (target.paused && !target.ended && !isAdActive(player)) {
            try {
              if (typeof player?.playVideo === 'function') player.playVideo();
              else target.play().catch(() => {});
            } catch (_) {}
          }
          return;
        }
        if (Date.now() < navAutoStartUntil && !hasPlayedCurrentNav && !userPausedCurrentNav) {
          resumePlaybackIfStalled(true);
        }
      }
    }
  }

  if (window.location?.pathname === '/watch' || window.location?.pathname?.startsWith('/live/')) {
    navAutoStartUntil = Date.now() + 8000;
  }

  syncAdLoop();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startBootstrapObserver, { once: true });
  } else {
    startBootstrapObserver();
  }

  document.addEventListener('visibilitychange', handleVisibilityChange, { passive: true });
  document.addEventListener('yt-navigate-start', handleNavigateStart, { passive: true });
  document.addEventListener('yt-navigate-finish', handleNavigateFinish, { passive: true });
  document.addEventListener('yt-page-data-updated', handlePageDataUpdated, { passive: true });
  document.addEventListener('pointerdown', handleUserPointerDownCapture, { capture: true, passive: true });
  document.addEventListener('loadedmetadata', handleMediaLifecycleCapture, { capture: true, passive: true });
  document.addEventListener('loadeddata', handleMediaLifecycleCapture, { capture: true, passive: true });
  document.addEventListener('canplay', handleMediaLifecycleCapture, { capture: true, passive: true });
  document.addEventListener('timeupdate', handleMediaLifecycleCapture, { capture: true, passive: true });
  document.addEventListener('ended', handleMediaLifecycleCapture, { capture: true, passive: true });
  document.addEventListener('click', handleTheaterClick, { passive: true });
  window.addEventListener('keydown', handleTheaterKeydown, { passive: true });
  window.addEventListener('keydown', handleUserPauseKeydown, { capture: true, passive: true });

  function isTrustedSameWindowMessage(event) {
    if (event.source !== window) return false;
    if (event.origin && window.location?.origin && event.origin !== window.location.origin) return false;
    return true;
  }

  function handleForceSkipMessage(event) {
    if (isKilled || !isTrustedSameWindowMessage(event)) return;
    if (event.data?.type === 'CINEGLOW_FORCE_SKIP_AD') {
      skipMainWorldAd();
    }
  }

  function handleAdBlockStateMessage(event) {
    if (isKilled || !isTrustedSameWindowMessage(event)) return;
    if (event.data?.type === 'CINEGLOW_SET_ADBLOCK_STATE') {
      const enabled = event.data?.enabled !== undefined
        ? event.data.enabled
        : (event.data?.payload?.enabled !== undefined ? event.data.payload.enabled : true);
      adBlockEnabled = Boolean(enabled);
      syncAdLoop();
      if (!adBlockEnabled) {
        if (bootstrapObserver) {
          bootstrapObserver.disconnect();
          bootstrapObserver = null;
        }
        if (adMutationObserver) {
          adMutationObserver.disconnect();
          observedPlayer = null;
        }
        restoreVideoAfterAd();
      } else {
        startBootstrapObserver();
        skipMainWorldAd();
      }
    }
  }

  function handlePreferredSpeedMessage(event) {
    if (isKilled || !isTrustedSameWindowMessage(event)) return;
    if (event.data?.type === 'CINEGLOW_SET_PREFERRED_SPEED') {
      const speed = event.data?.speed;
      if (typeof speed === 'number' && speed > 0 && speed <= 15) {
        preferredPlaybackSpeed = speed;
        preAdSpeed = speed;

        try {
          const player = document.getElementById('movie_player');
          if (player && typeof player.setPlaybackRate === 'function') {
            if (typeof player.getPlaybackRate !== 'function' || player.getPlaybackRate() !== speed) {
              player.setPlaybackRate(speed);
            }
          }
          const video = document.querySelector('#movie_player video.html5-main-video') || document.querySelector('video');
          if (video && video.playbackRate !== speed) {
            video.playbackRate = speed;
            video.defaultPlaybackRate = speed;
          }
        } catch (_) {}
      }
    }
  }

  function handleKillSwitchMessage(event) {
    if (!isTrustedSameWindowMessage(event)) return;
    if (event.data?.type === 'AURA_EMERGENCY_KILL_SWITCH') {
      teardownMainWorld();
    }
  }

  function handleQualityMessage(event) {
    if (isKilled || !isTrustedSameWindowMessage(event) || event.data?.type !== 'AURA_SET_QUALITY') return;
    let quality = event.data.quality;
    const player = document.getElementById('movie_player');

    if (player && typeof player.setPlaybackQualityRange === 'function') {
      try {
        if (quality === 'highres' && typeof player.getAvailableQualityLevels === 'function') {
          const levels = player.getAvailableQualityLevels();
          const best = levels.find((q) => q !== 'auto' && q !== 'highres');
          if (best) quality = best;
        }
        const currentQuality = typeof player.getPlaybackQuality === 'function' ? player.getPlaybackQuality() : null;
        if (currentQuality === quality) return;
        const video = (player && player.querySelector('video')) || document.querySelector('video.html5-main-video') || document.querySelector('video');
        if (video && (!video.paused || (!hasPlayedCurrentNav && !userPausedCurrentNav && Date.now() < navAutoStartUntil))) {
          qualityResumePending = true;
        }
        player.setPlaybackQualityRange(quality, quality);
        if (typeof player.setPlaybackQuality === 'function') {
          player.setPlaybackQuality(quality);
        }
      } catch (err) {
        console.error('[Aura Main World] Quality setting error:', err);
      }
    }
  }

  function handleStatsMessage(event) {
    if (isKilled || !isTrustedSameWindowMessage(event) || event.data?.type !== 'CINEGLOW_GET_STATS_NERDS') return;
    try {
      const player = document.getElementById('movie_player');
      let stats = null;
      if (player && typeof player.getStatsForNerds === 'function') {
        const s = player.getStatsForNerds();
        if (s) {
          stats = {};
          for (const k in s) {
            const v = s[k];
            if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
              stats[k] = v;
            }
          }
        }
      }

      if (stats && player) {
        try {
          const resp = typeof player.getPlayerResponse === 'function' ? player.getPlayerResponse() : window.ytInitialPlayerResponse;
          const adaptive = resp?.streamingData?.adaptiveFormats;
          if (Array.isArray(adaptive)) {
            let itag = null;
            if (stats.codecs) {
              const m = String(stats.codecs).match(/\((\d+)\)/);
              if (m) itag = m[1];
            }
            if (!itag && stats.fmt) itag = String(stats.fmt);
            if (itag) {
              const fmt = adaptive.find((f) => String(f.itag) === String(itag));
              if (fmt) {
                stats.videoBitrate = fmt.bitrate || fmt.averageBitrate || null;
                stats.averageBitrate = fmt.averageBitrate || null;
                stats.formatQuality = fmt.qualityLabel || null;
                stats.colorInfo = fmt.colorInfo || null;
              }
            }
          }
        } catch (_) {}
      }

      window.postMessage({
        type: 'CINEGLOW_STATS_NERDS_RESPONSE',
        stats
      }, window.location.origin);
    } catch (_) {}
  }

  function handleAiDisclosureMessage(event) {
    if (isKilled || !isTrustedSameWindowMessage(event) || event.data?.type !== 'CINEGLOW_CHECK_AI_DISCLOSURE') return;
    inspectAndEmitAiDisclosure();
  }

  function teardownMainWorld() {
    if (isKilled) return;
    isKilled = true;
    lastUpdatedPageData = null;
    lastUpdatedPageVideoId = null;
    clearTimeout(theaterTimer);
    clearNavRecoveryTimers();
    if (mainWorldAdInterval) {
      clearInterval(mainWorldAdInterval);
      mainWorldAdInterval = null;
    }
    if (bootstrapObserver) {
      bootstrapObserver.disconnect();
      bootstrapObserver = null;
    }
    if (adMutationObserver) {
      adMutationObserver.disconnect();
      adMutationObserver = null;
    }
    observedPlayer = null;

    restoreVideoAfterAd();

    if (origFetch && window.fetch === wrappedFetch) {
      try { window.fetch = origFetch; } catch (_) {}
    }
    if (origOpen && typeof XMLHttpRequest !== 'undefined' && XMLHttpRequest.prototype.open === wrappedOpen) {
      try { XMLHttpRequest.prototype.open = origOpen; } catch (_) {}
    }
    if (origSend && typeof XMLHttpRequest !== 'undefined' && XMLHttpRequest.prototype.send === wrappedSend) {
      try { XMLHttpRequest.prototype.send = origSend; } catch (_) {}
    }
    if (origJSONParse && JSON.parse === wrappedJSONParse) {
      try { JSON.parse = origJSONParse; } catch (_) {}
    }
    if (origFnToString && typeof Function !== 'undefined' && Function.prototype && Function.prototype.toString === customFnToString) {
      try { Function.prototype.toString = origFnToString; } catch (_) {}
    }

    document.documentElement?.removeAttribute('data-cineglow-theater');
    window.removeEventListener('message', handleQualityMessage);
    window.removeEventListener('message', handleStatsMessage);
    window.removeEventListener('message', handleAiDisclosureMessage);
    window.removeEventListener('message', handleForceSkipMessage);
    window.removeEventListener('message', handleAdBlockStateMessage);
    window.removeEventListener('message', handlePreferredSpeedMessage);
    window.removeEventListener('message', handleKillSwitchMessage);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    document.removeEventListener('yt-navigate-start', handleNavigateStart);
    document.removeEventListener('yt-navigate-finish', handleNavigateFinish);
    document.removeEventListener('yt-page-data-updated', handlePageDataUpdated);
    document.removeEventListener('pointerdown', handleUserPointerDownCapture, true);
    document.removeEventListener('loadedmetadata', handleMediaLifecycleCapture, true);
    document.removeEventListener('loadeddata', handleMediaLifecycleCapture, true);
    document.removeEventListener('canplay', handleMediaLifecycleCapture, true);
    document.removeEventListener('timeupdate', handleMediaLifecycleCapture, true);
    document.removeEventListener('ended', handleMediaLifecycleCapture, true);
    document.removeEventListener('click', handleTheaterClick);
    window.removeEventListener('keydown', handleTheaterKeydown);
    window.removeEventListener('keydown', handleUserPauseKeydown, true);
  }

  window.addEventListener('message', handleQualityMessage);
  window.addEventListener('message', handleStatsMessage);
  window.addEventListener('message', handleAiDisclosureMessage);
  window.addEventListener('message', handleForceSkipMessage);
  window.addEventListener('message', handleAdBlockStateMessage);
  window.addEventListener('message', handlePreferredSpeedMessage);
  window.addEventListener('message', handleKillSwitchMessage);

  window.addEventListener('cineglow:kill-switch', () => {
    teardownMainWorld();
  }, { once: true });
})();

// content/sponsor-skip.js
// CineGlow Pro for YouTube - Creator Branded Content & Sponsor Segment Skipping Engine
// Author: Giri Manohar Vemula (https://www.linkedin.com/in/manoharv511)

(() => {
  'use strict';

  if (typeof window !== 'undefined' && window.CineGlowKilled) return;

  const DEFAULT_CATEGORIES = Object.freeze(['sponsor', 'selfpromo', 'interaction']);
  const SPONSOR_NOTICE_CLASS = 'cineglow-sponsor-notice';
  const SPONSOR_MARKERS_CLASS = 'cineglow-sponsor-markers';
  const SPONSOR_MARKER_CLASS = 'cineglow-sponsor-marker';

  let settings = {
    sponsorBlockEnabled: true,
    sponsorBlockMode: 'skip', // 'skip' | 'fastforward'
    sponsorBlockCategories: ['sponsor', 'selfpromo', 'interaction'],
    sponsorBlockNotice: true
  };

  let isKilled = false;
  let isThirdPartyDisabled = false;
  let currentVideoId = null;
  let activeVideo = null;
  let activePlayer = null;
  let segments = []; // Array of { id, start, end, category, actionType, source }
  let segmentCache = new Map(); // videoId -> segments[] (LRU bounded to 50)
  let unskippedSegments = new Set(); // segment IDs unskipped by user via Undo
  let abortController = null;
  let activeNoticeEl = null;
  let noticeDismissTimer = null;
  let isFastForwarding = false;
  let currentFastForwardSegment = null;
  let preFastForwardSpeed = 1.0;
  let preFastForwardMuted = false;
  let markerContainer = null;
  let checkInterval = null;

  function isContextValid() {
    try {
      if (typeof chrome === 'undefined') return true;
      if (!chrome.runtime || !chrome.runtime.id) return false;
      if (typeof chrome.runtime.getManifest === 'function') {
        const manifest = chrome.runtime.getManifest();
        if (!manifest) return false;
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  function checkContextOrTeardown() {
    if (!isContextValid()) {
      try { teardownKillSwitch(); } catch (_) {}
      return false;
    }
    return true;
  }

  function queryOne(root, selector) {
    if (!root || !selector) return null;
    if (typeof selector === 'string' && selector.includes(',')) {
      const parts = selector.split(',').map(s => s.trim()).filter(Boolean);
      for (const part of parts) {
        if (typeof root.querySelector === 'function') {
          const el = root.querySelector(part);
          if (el) return el;
        }
      }
      return null;
    }
    return typeof root.querySelector === 'function' ? root.querySelector(selector) : null;
  }

  function queryAll(root, selector) {
    if (!root || !selector) return [];
    if (typeof selector === 'string' && selector.includes(',')) {
      const parts = selector.split(',').map(s => s.trim()).filter(Boolean);
      const set = new Set();
      for (const part of parts) {
        if (typeof root.querySelectorAll === 'function') {
          const list = root.querySelectorAll(part);
          if (list) {
            for (const el of list) set.add(el);
          }
        }
      }
      return Array.from(set);
    }
    if (typeof root.querySelectorAll === 'function') {
      return Array.from(root.querySelectorAll(selector));
    }
    return [];
  }

  function safeSendMessage(msg, callback) {
    if (!isContextValid()) {
      if (typeof callback === 'function') callback(null);
      return;
    }
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime?.id) {
        chrome.runtime.sendMessage(msg, (response) => {
          try {
            if (chrome.runtime?.lastError) {
              if (typeof callback === 'function') callback(null);
            } else if (typeof callback === 'function') {
              callback(response);
            }
          } catch (_) {
            if (typeof callback === 'function') callback(null);
          }
        });
        return;
      }
    } catch (_) {}
    if (typeof callback === 'function') callback(null);
  }

  function formatTime(seconds) {
    if (seconds == null || isNaN(seconds)) return '0:00';
    const s = Math.max(0, Math.floor(seconds));
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  }

  function formatCategory(cat) {
    switch (cat) {
      case 'sponsor': return 'Sponsor';
      case 'selfpromo': return 'Self-Promo';
      case 'interaction': return 'Interaction';
      case 'intro': return 'Intro';
      case 'outro': return 'Outro';
      case 'preview': return 'Preview';
      case 'filler': return 'Filler';
      default: return 'Sponsorship';
    }
  }

  function getCategoryColor(cat) {
    switch (cat) {
      case 'sponsor': return '#00d26a';      // Vibrant Green
      case 'selfpromo': return '#f5a623';    // Amber/Orange
      case 'interaction': return '#9b59b6';  // Purple
      case 'intro': return '#3498db';        // Blue
      case 'outro': return '#00b4d8';        // Cyan
      default: return '#00f0ff';
    }
  }

  function getVideoId() {
    if (typeof window === 'undefined') return null;
    const urlParams = new URLSearchParams(window.location.search);
    const v = urlParams.get('v');
    if (v) return v;

    if (window.location.pathname.startsWith('/shorts/')) {
      const parts = window.location.pathname.split('/shorts/');
      if (parts[1]) return parts[1].split('/')[0].split('?')[0];
    }
    if (window.location.pathname.startsWith('/live/')) {
      const parts = window.location.pathname.split('/live/');
      if (parts[1]) return parts[1].split('/')[0].split('?')[0];
    }
    if (window.location.pathname.startsWith('/embed/')) {
      const parts = window.location.pathname.split('/embed/');
      if (parts[1]) return parts[1].split('/')[0].split('?')[0];
    }

    if (window.CineGlowPlayer && window.CineGlowPlayer.videoId) {
      return window.CineGlowPlayer.videoId;
    }
    return null;
  }

  function isAdActive() {
    try {
      const playerEl = activePlayer || (typeof document !== 'undefined' && queryOne(document, '#movie_player, #shorts-player, .html5-video-player'));
      if (playerEl && (playerEl.classList.contains('ad-showing') || playerEl.classList.contains('ad-interrupting'))) {
        return true;
      }
    } catch (_) {}
    return false;
  }

  // --- Settings & Enterprise Policies ---
  async function loadSettings() {
    if (isKilled || (typeof window !== 'undefined' && window.CineGlowKilled)) return;
    if (!checkContextOrTeardown()) return;
    try {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        if (chrome.storage.local) {
          const local = await chrome.storage.local.get(['auraKillSwitchActive']).catch(() => ({}));
          if (local && local.auraKillSwitchActive) {
            teardownKillSwitch();
            return;
          }
        }
        if (chrome.storage.managed) {
          const managed = await chrome.storage.managed.get(['DisableThirdPartyAPIs', 'KillSwitch']).catch(() => ({}));
          if (managed) {
            if (managed.KillSwitch) {
              teardownKillSwitch();
              return;
            }
            if (managed.DisableThirdPartyAPIs) {
              isThirdPartyDisabled = true;
            }
          }
        }
        if (chrome.storage.sync) {
          const stored = await chrome.storage.sync.get([
            'sponsorBlockEnabled',
            'sponsorBlockMode',
            'sponsorBlockCategories',
            'sponsorBlockNotice'
          ]).catch(() => ({}));

          if (stored.sponsorBlockEnabled !== undefined) {
            settings.sponsorBlockEnabled = !!stored.sponsorBlockEnabled;
          } else if (typeof AURA_DEFAULTS !== 'undefined' && AURA_DEFAULTS.sponsorBlockEnabled !== undefined) {
            settings.sponsorBlockEnabled = !!AURA_DEFAULTS.sponsorBlockEnabled;
          }

          if (stored.sponsorBlockMode) {
            settings.sponsorBlockMode = stored.sponsorBlockMode;
          } else if (typeof AURA_DEFAULTS !== 'undefined' && AURA_DEFAULTS.sponsorBlockMode) {
            settings.sponsorBlockMode = AURA_DEFAULTS.sponsorBlockMode;
          }

          if (Array.isArray(stored.sponsorBlockCategories)) {
            settings.sponsorBlockCategories = stored.sponsorBlockCategories;
          } else if (typeof AURA_DEFAULTS !== 'undefined' && Array.isArray(AURA_DEFAULTS.sponsorBlockCategories)) {
            settings.sponsorBlockCategories = AURA_DEFAULTS.sponsorBlockCategories;
          }

          if (stored.sponsorBlockNotice !== undefined) {
            settings.sponsorBlockNotice = !!stored.sponsorBlockNotice;
          }
        }
      }
    } catch (_) {}

    if (!settings.sponsorBlockEnabled) {
      cleanupPlaybackModifications();
      removeMarkers();
      dismissNotice();
    } else {
      updateForCurrentVideo();
    }
  }

  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (isKilled || (typeof window !== 'undefined' && window.CineGlowKilled)) return;
      if (!checkContextOrTeardown()) return;
      if (area === 'managed') {
        if ('KillSwitch' in changes && changes.KillSwitch.newValue === true) {
          teardownKillSwitch();
        }
        if ('DisableThirdPartyAPIs' in changes) {
          isThirdPartyDisabled = changes.DisableThirdPartyAPIs.newValue === true;
          updateForCurrentVideo();
        }
      }
      if (area === 'local' && changes.auraKillSwitchActive?.newValue === true) {
        teardownKillSwitch();
      }
      if (area === 'sync') {
        let changed = false;
        if ('sponsorBlockEnabled' in changes) {
          settings.sponsorBlockEnabled = !!changes.sponsorBlockEnabled.newValue;
          changed = true;
        }
        if ('sponsorBlockMode' in changes) {
          const oldMode = settings.sponsorBlockMode;
          settings.sponsorBlockMode = changes.sponsorBlockMode.newValue;
          if (oldMode === 'fastforward' && settings.sponsorBlockMode !== 'fastforward') {
            cleanupPlaybackModifications();
          }
          changed = true;
        }
        if ('sponsorBlockCategories' in changes && Array.isArray(changes.sponsorBlockCategories.newValue)) {
          settings.sponsorBlockCategories = changes.sponsorBlockCategories.newValue;
          changed = true;
        }
        if ('sponsorBlockNotice' in changes) {
          settings.sponsorBlockNotice = !!changes.sponsorBlockNotice.newValue;
        }
        if (changed) {
          if (!settings.sponsorBlockEnabled) {
            cleanupPlaybackModifications();
            removeMarkers();
            dismissNotice();
          } else {
            renderMarkers();
            checkSegmentState();
          }
        }
      }
    });
  }

  // --- Native YouTube Chapter Detection (Zero-Network Fallback) ---
  const SPONSOR_KEYWORDS = /\b(sponsors?|sponsored|sponsorships?|our sponsor|a word from our sponsor|thanks to our sponsor|(?:brand|paid|official|channel|sponsor(?:ed)?)\s+partners?|ad\s*breaks?|(?:brand|channel|self|video|paid)\s+promo(?:tion)?s?|brand\s*deals?|paid\s*promotions?|merch\s*plug|merch(?:andise)?\s+(?:plug|drop|store|link|haul|shoutout|discount)|patreon\s*(?:shoutouts?|supporters?|backers?|tiers?|plug)|support\s+(?:us\s+)?on\s+patreon)\b/i;
  const SPONSOR_EXCLUSION_KEYWORDS = /\b(no\s+sponsors?|not\s+sponsored|without\s+sponsors?|unsponsored|(?:pawn|chess)\s+promotions?|(?:sports?|league|division|relegation)\s+promotions?|promotion\s+(?:race|battle|playoffs?|relegation)|unboxings?|unboxing|patreon\s+(?:q\s*&?\s*a|qa|questions?(?:\s+and\s+answers?)?))\b/i;

  function isSponsorTitle(title) {
    if (!title || typeof title !== 'string') return false;
    const trimmed = title.trim();
    if (!trimmed) return false;
    if (SPONSOR_EXCLUSION_KEYWORDS.test(trimmed)) return false;
    return SPONSOR_KEYWORDS.test(trimmed);
  }

  function detectChaptersFromDOM() {
    if (typeof document === 'undefined') return [];
    const detected = [];
    const root = queryOne(document, '#movie_player, .html5-video-player') || activePlayer || document.body || document;
    const video = activeVideo || (typeof document !== 'undefined' && (queryOne(document, 'video.html5-main-video') || queryOne(document, 'video')));

    function calcFallbackEnd(start, nextStart) {
      if (typeof nextStart === 'number' && !isNaN(nextStart) && nextStart > start) {
        return nextStart;
      }
      const dur = (video && typeof video.duration === 'number' && isFinite(video.duration)) ? video.duration : (start + 20);
      return Math.min(start + 20, dur);
    }

    // 1. YouTube player API chapters (if exposed by movie_player)
    try {
      const player = queryOne(document, '#movie_player, .html5-video-player');
      if (player && typeof player.getChapters === 'function') {
        const chs = player.getChapters();
        if (Array.isArray(chs)) {
          for (let i = 0; i < chs.length; i++) {
            const ch = chs[i];
            if (ch && ch.title && isSponsorTitle(ch.title)) {
              const start = Number(ch.time != null ? ch.time : (ch.start_time != null ? ch.start_time : 0));
              let nextStart = null;
              for (let j = i + 1; j < chs.length; j++) {
                const ns = Number(chs[j]?.time != null ? chs[j].time : (chs[j]?.start_time != null ? chs[j].start_time : NaN));
                if (!isNaN(ns) && ns > start) {
                  nextStart = ns;
                  break;
                }
              }
              const end = Number(ch.end_time || (ch.duration ? start + ch.duration : calcFallbackEnd(start, nextStart)));
              if (end > start) {
                detected.push({
                  id: `chapter_${start}_${end}`,
                  start,
                  end,
                  category: 'sponsor',
                  actionType: 'skip',
                  title: ch.title,
                  source: 'chapter'
                });
              }
            }
          }
        }
      }
    } catch (_) {}

    // 2. DOM chapter markers on YouTube scrubber
    try {
      const chapterMarkers = queryAll(root, '.ytp-chapter-container, .ytp-chapter-marker');
      for (let i = 0; i < chapterMarkers.length; i++) {
        const cm = chapterMarkers[i];
        const title = cm.getAttribute('title') || cm.getAttribute('aria-label') || '';
        if (isSponsorTitle(title)) {
          const start = parseFloat(cm.dataset?.start || cm.getAttribute('data-start') || '0');
          let nextStart = null;
          for (let j = i + 1; j < chapterMarkers.length; j++) {
            const nextCm = chapterMarkers[j];
            const parsedNext = parseFloat(nextCm.dataset?.start || nextCm.getAttribute('data-start') || '');
            if (!isNaN(parsedNext) && parsedNext > start) {
              nextStart = parsedNext;
              break;
            }
          }
          const explicitEnd = cm.dataset?.end || cm.getAttribute('data-end');
          const end = explicitEnd ? parseFloat(explicitEnd) : calcFallbackEnd(start, nextStart);
          if (end > start) {
            const isDuplicate = detected.some(d => Math.abs(d.start - start) < 3);
            if (!isDuplicate) {
              detected.push({
                id: `chapter_dom_${start}_${end}`,
                start,
                end,
                category: 'sponsor',
                actionType: 'skip',
                title,
                source: 'chapter'
              });
            }
          }
        }
      }
    } catch (_) {}

    // 3. YouTube description or engagement panel chapters
    try {
      const macroMarkers = queryAll(root, 'ytd-macro-markers-list-item-renderer, #macro-markers ytd-macro-markers-list-item-renderer');
      for (let i = 0; i < macroMarkers.length; i++) {
        const item = macroMarkers[i];
        const titleEl = item.querySelector('#title, .macro-markers-title');
        const timeEl = item.querySelector('#time, .macro-markers-time');
        const title = titleEl ? titleEl.textContent.trim() : '';
        if (isSponsorTitle(title) && timeEl) {
          const start = parseTimeString(timeEl.textContent.trim());
          if (start != null) {
            let nextStart = null;
            for (let j = i + 1; j < macroMarkers.length; j++) {
              const nextTimeEl = macroMarkers[j].querySelector('#time, .macro-markers-time');
              if (nextTimeEl) {
                const parsed = parseTimeString(nextTimeEl.textContent.trim());
                if (parsed != null && parsed > start) {
                  nextStart = parsed;
                  break;
                }
              }
            }
            const end = calcFallbackEnd(start, nextStart);
            const isDuplicate = detected.some(d => Math.abs(d.start - start) < 3);
            if (!isDuplicate && end > start) {
              detected.push({
                id: `chapter_macro_${start}`,
                start,
                end,
                category: 'sponsor',
                actionType: 'skip',
                title,
                source: 'chapter'
              });
            }
          }
        }
      }
    } catch (_) {}

    return detected;
  }

  function parseTimeString(str) {
    if (!str) return null;
    const match = str.match(/(\d+):(\d+)(?::(\d+))?/);
    if (!match) return null;
    if (match[3] != null) {
      return (Number(match[1]) * 3600) + (Number(match[2]) * 60) + Number(match[3]);
    }
    return (Number(match[1]) * 60) + Number(match[2]);
  }

  // --- Fetch Segments ---
  async function fetchSegments(videoId) {
    if (isKilled || (typeof window !== 'undefined' && window.CineGlowKilled)) return [];
    if (!checkContextOrTeardown()) return [];
    if (!videoId) return [];

    if (segmentCache.has(videoId)) {
      return segmentCache.get(videoId);
    }

    if (abortController) {
      abortController.abort();
    }
    abortController = new AbortController();
    const signal = abortController.signal;

    let apiSegments = [];

    // Attempt SponsorBlock community database query if third-party APIs are allowed
    if (!isThirdPartyDisabled) {
      const cats = (settings.sponsorBlockCategories && settings.sponsorBlockCategories.length > 0)
        ? settings.sponsorBlockCategories
        : DEFAULT_CATEGORIES;

      try {
        const responseData = await new Promise((resolve) => {
          // 1. Try background service worker relay
          safeSendMessage({ type: 'FETCH_SPONSOR_BLOCK', videoId, categories: cats }, (resp) => {
            if (resp && resp.success && Array.isArray(resp.segments)) {
              resolve(resp.segments);
            } else if (resp && (resp.error === 'Blocked by enterprise policy' || resp.status === 403)) {
              isThirdPartyDisabled = true;
              resolve('BLOCKED');
            } else {
              resolve(null);
            }
          });
        });

        if (responseData === 'BLOCKED') {
          apiSegments = [];
        } else if (responseData && Array.isArray(responseData)) {
          apiSegments = responseData;
        } else if (!signal.aborted && !isThirdPartyDisabled) {
          // 2. Direct fallback fetch from content script (supported via CORS Access-Control-Allow-Origin: *)
          const url = `https://sponsor.ajay.app/api/skipSegments?videoID=${encodeURIComponent(videoId)}&categories=${encodeURIComponent(JSON.stringify(cats))}`;
          const fetchFn = (typeof fetchWithBackoff === 'function')
            ? fetchWithBackoff
            : (typeof fetch === 'function' ? fetch : null);

          if (fetchFn) {
            const resp = await fetchFn(url, { signal, cache: 'no-cache' }).catch(() => null);
            if (resp && resp.ok) {
              const data = await resp.json().catch(() => []);
              if (Array.isArray(data)) {
                apiSegments = data;
              }
            }
          }
        }
      } catch (_) {}
    }

    if (signal.aborted) return [];

    // Normalize API segments
    const normalized = [];
    for (const item of apiSegments) {
      if (item && Array.isArray(item.segment) && item.segment.length >= 2) {
        const start = Math.max(0, Number(item.segment[0]) || 0);
        const end = Math.max(start, Number(item.segment[1]) || 0);
        if (end > start) {
          normalized.push({
            id: item.UUID || `${videoId}_${start}_${end}`,
            start,
            end,
            category: item.category || 'sponsor',
            actionType: item.actionType || 'skip',
            source: 'sponsorblock'
          });
        }
      }
    }

    // Merge native chapters (FP-2.5: true interval intersection deduplication)
    const chapters = detectChaptersFromDOM();
    for (const ch of chapters) {
      const overlaps = normalized.some(s =>
        (ch.start >= s.start && ch.start <= s.end) ||
        (ch.end >= s.start && ch.end <= s.end) ||
        (s.start >= ch.start && s.start <= ch.end) ||
        Math.abs(s.start - ch.start) < 5
      );
      if (!overlaps) {
        normalized.push(ch);
      }
    }

    // Sort by start time ascending
    normalized.sort((a, b) => a.start - b.start);

    // Cache bounded to 50 items
    segmentCache.set(videoId, normalized);
    if (segmentCache.size > 50) {
      const oldestKey = segmentCache.keys().next().value;
      segmentCache.delete(oldestKey);
    }

    return normalized;
  }

  // --- Scrubber Timeline Markers ---
  function renderMarkers() {
    if (isKilled || !settings.sponsorBlockEnabled) {
      removeMarkers();
      return;
    }
    if (!checkContextOrTeardown()) return;

    const video = activeVideo || (typeof document !== 'undefined' && (queryOne(document, 'video.html5-main-video') || queryOne(document, 'video')));
    const player = activePlayer || (typeof document !== 'undefined' && queryOne(document, '#movie_player, .html5-video-player'));
    if (!video || !player) return;

    const progressBar = queryOne(player, '.ytp-progress-bar, .ytp-progress-bar-container') ||
                        (typeof document !== 'undefined' && queryOne(document, '.ytp-progress-bar, .ytp-progress-bar-container'));
    if (!progressBar) return;

    let duration = video.duration;
    if (!duration || isNaN(duration) || duration <= 0 || !isFinite(duration)) {
      // Defer rendering until duration is ready and finite
      return;
    }

    removeMarkers();

    if (!segments || segments.length === 0) return;

    const activeCategories = Array.isArray(settings.sponsorBlockCategories) && settings.sponsorBlockCategories.length > 0
      ? settings.sponsorBlockCategories
      : DEFAULT_CATEGORIES;

    markerContainer = document.createElement('div');
    markerContainer.className = SPONSOR_MARKERS_CLASS;
    markerContainer.style.position = 'absolute';
    markerContainer.style.top = '0';
    markerContainer.style.left = '0';
    markerContainer.style.width = '100%';
    markerContainer.style.height = '100%';
    markerContainer.style.pointerEvents = 'none';
    markerContainer.style.zIndex = '25';

    for (const seg of segments) {
      if (!activeCategories.includes(seg.category)) continue;
      const startPct = (seg.start / duration) * 100;
      const widthPct = Math.max(0.4, ((seg.end - seg.start) / duration) * 100);
      if (startPct >= 0 && startPct <= 100) {
        const marker = document.createElement('div');
        marker.className = SPONSOR_MARKER_CLASS;
        marker.dataset.category = seg.category;
        marker.dataset.start = String(seg.start);
        marker.dataset.end = String(seg.end);
        marker.title = `${formatCategory(seg.category)} (${formatTime(seg.start)} - ${formatTime(seg.end)})`;
        marker.style.position = 'absolute';
        marker.style.left = `${startPct}%`;
        marker.style.width = `${Math.min(100 - startPct, widthPct)}%`;
        marker.style.height = '100%';
        marker.style.backgroundColor = getCategoryColor(seg.category);
        marker.style.opacity = '0.85';
        marker.style.borderRadius = '2px';
        marker.style.boxShadow = `0 0 4px ${getCategoryColor(seg.category)}`;
        marker.style.pointerEvents = 'none';

        markerContainer.appendChild(marker);
      }
    }

    progressBar.appendChild(markerContainer);
  }

  function removeMarkers() {
    if (markerContainer) {
      markerContainer.remove();
      markerContainer = null;
    }
    if (typeof document !== 'undefined') {
      const existing = document.querySelectorAll(`.${SPONSOR_MARKERS_CLASS}`);
      for (const el of existing) {
        el.remove();
      }
    }
  }

  // --- Interactive HUD Notice & Undo ---
  function showNotice(segment, onUndo) {
    if (isKilled || !settings.sponsorBlockNotice) return;
    if (!checkContextOrTeardown()) return;
    dismissNotice();

    const player = activePlayer || (typeof document !== 'undefined' && queryOne(document, '#movie_player, .html5-video-player'));
    if (!player) return;

    const isFF = settings.sponsorBlockMode === 'fastforward';
    const actionLabel = isFF ? 'Fast-forwarding' : 'Skipped';
    const messageText = `${actionLabel} ${formatCategory(segment.category)} (${formatTime(segment.start)} - ${formatTime(segment.end)})`;

    const notice = document.createElement('div');
    notice.className = SPONSOR_NOTICE_CLASS;
    notice.setAttribute('role', 'status');
    notice.setAttribute('data-notice-text', messageText);
    notice.textContent = messageText;
    notice.style.position = 'absolute';
    notice.style.bottom = '68px';
    notice.style.left = '24px';
    notice.style.zIndex = '60';
    notice.style.display = 'flex';
    notice.style.alignItems = 'center';
    notice.style.gap = '10px';
    notice.style.padding = '8px 14px';
    notice.style.backgroundColor = 'rgba(15, 15, 20, 0.88)';
    notice.style.backdropFilter = 'blur(10px)';
    notice.style.webkitBackdropFilter = 'blur(10px)';
    notice.style.color = '#ffffff';
    notice.style.borderRadius = '8px';
    notice.style.border = '1px solid rgba(255, 255, 255, 0.15)';
    notice.style.boxShadow = '0 6px 20px rgba(0, 0, 0, 0.4)';
    notice.style.fontSize = '12px';
    notice.style.fontWeight = '500';
    notice.style.fontFamily = 'YouTube Noto, Roboto, Arial, sans-serif';
    notice.style.pointerEvents = 'auto';
    notice.style.transition = 'opacity 0.25s ease, transform 0.25s ease';

    const color = getCategoryColor(segment.category);
    const badge = document.createElement('span');
    badge.style.display = 'inline-block';
    badge.style.width = '8px';
    badge.style.height = '8px';
    badge.style.borderRadius = '50%';
    badge.style.backgroundColor = color;
    badge.style.boxShadow = `0 0 6px ${color}`;

    const text = document.createElement('span');
    text.textContent = messageText;

    const undoBtn = document.createElement('button');
    undoBtn.className = 'cineglow-sponsor-undo';
    undoBtn.textContent = 'Undo';
    undoBtn.style.background = 'rgba(255, 255, 255, 0.16)';
    undoBtn.style.border = 'none';
    undoBtn.style.color = '#ffffff';
    undoBtn.style.borderRadius = '4px';
    undoBtn.style.padding = '3px 8px';
    undoBtn.style.fontSize = '11px';
    undoBtn.style.fontWeight = '600';
    undoBtn.style.cursor = 'pointer';
    undoBtn.style.transition = 'background 0.2s';
    undoBtn.addEventListener('mouseenter', () => {
      undoBtn.style.background = 'rgba(255, 255, 255, 0.28)';
    });
    undoBtn.addEventListener('mouseleave', () => {
      undoBtn.style.background = 'rgba(255, 255, 255, 0.16)';
    });
    undoBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      dismissNotice();
      if (typeof onUndo === 'function') {
        onUndo();
      }
    });

    notice.appendChild(badge);
    notice.appendChild(text);
    notice.appendChild(undoBtn);

    player.appendChild(notice);
    activeNoticeEl = notice;

    if (noticeDismissTimer) {
      clearTimeout(noticeDismissTimer);
    }
    noticeDismissTimer = setTimeout(() => {
      dismissNotice();
    }, 4000);
  }

  function dismissNotice() {
    if (noticeDismissTimer) {
      clearTimeout(noticeDismissTimer);
      noticeDismissTimer = null;
    }
    if (activeNoticeEl) {
      activeNoticeEl.remove();
      activeNoticeEl = null;
    }
    if (typeof document !== 'undefined') {
      const existing = document.querySelectorAll(`.${SPONSOR_NOTICE_CLASS}`);
      for (const el of existing) el.remove();
    }
  }

  // --- Playback Controller & Segment Execution ---
  function checkSegmentState() {
    if (isKilled || (typeof window !== 'undefined' && window.CineGlowKilled)) return;
    if (!checkContextOrTeardown()) return;
    if (!settings.sponsorBlockEnabled) return;
    if (!segments || segments.length === 0) return;

    const video = activeVideo || (typeof document !== 'undefined' && (document.querySelector('video.html5-main-video') || document.querySelector('video')));
    if (!video) return;

    // Live stream & premiere guard: prevent 16x buffer stalling
    if (!isFinite(video.duration) || (typeof document !== 'undefined' && document.querySelector && document.querySelector('.ytp-live, .ytp-live-badge'))) {
      return;
    }

    // Do not skip while user is actively scrubbing, paused, or ended
    if (video.seeking || video.paused || video.ended) return;

    // Yield while an in-stream ad is showing
    if (isAdActive()) return;

    const currentTime = video.currentTime;
    const activeCategories = Array.isArray(settings.sponsorBlockCategories) && settings.sponsorBlockCategories.length > 0
      ? settings.sponsorBlockCategories
      : DEFAULT_CATEGORIES;

    // Find if current playback time is inside any enabled segment
    let matchedSegment = null;
    for (const seg of segments) {
      if (!activeCategories.includes(seg.category)) continue;
      if (unskippedSegments.has(seg.id)) continue;
      // Trigger when currentTime is within [start, end - 0.15]
      if (currentTime >= seg.start && currentTime < (seg.end - 0.15)) {
        matchedSegment = seg;
        break;
      }
    }

    if (matchedSegment) {
      if (settings.sponsorBlockMode === 'skip') {
        // Auto-skip mode: jump immediately past segment
        const targetTime = Math.min(video.duration || Infinity, matchedSegment.end);
        video.currentTime = targetTime;

        safeSendMessage({ type: 'SPONSOR_BLOCKED', count: 1 });

        showNotice(matchedSegment, () => {
          undoSkip(matchedSegment);
        });
      } else if (settings.sponsorBlockMode === 'fastforward') {
        // Fast-forward mode: accelerate to 16x and mute
        if (!isFastForwarding) {
          isFastForwarding = true;
          currentFastForwardSegment = matchedSegment;
          if (video.playbackRate > 0 && video.playbackRate <= 5.0) {
            preFastForwardSpeed = video.playbackRate;
          }
          preFastForwardMuted = video.muted;
          video.muted = true;
          video.playbackRate = 16.0;

          showNotice(matchedSegment, () => {
            undoSkip(matchedSegment);
          });
        } else if (currentFastForwardSegment && currentFastForwardSegment.id !== matchedSegment.id) {
          // Transitioning immediately to an adjacent or overlapping segment
          safeSendMessage({ type: 'SPONSOR_BLOCKED', count: 1 });
          currentFastForwardSegment = matchedSegment;
          showNotice(matchedSegment, () => {
            undoSkip(matchedSegment);
          });
        }
      }
    } else if (isFastForwarding) {
      // Exited sponsor segment in fast-forward mode: restore speed and unmute
      cleanupPlaybackModifications(video);
      safeSendMessage({ type: 'SPONSOR_BLOCKED', count: 1 });
    }
  }

  function cleanupPlaybackModifications(targetVideo) {
    const video = targetVideo || activeVideo || (typeof document !== 'undefined' && (document.querySelector('video.html5-main-video') || document.querySelector('video')));
    if (isFastForwarding) {
      isFastForwarding = false;
      currentFastForwardSegment = null;
      if (video) {
        if (!preFastForwardMuted && video.muted) {
          video.muted = false;
        }
        if (video.playbackRate === 16.0) {
          const restoreSpeed = (typeof window !== 'undefined' && window.CineGlowSpeed && typeof window.CineGlowSpeed.preferredSpeed === 'number')
            ? window.CineGlowSpeed.preferredSpeed
            : (preFastForwardSpeed || 1.0);
          video.playbackRate = restoreSpeed;
          try { video.defaultPlaybackRate = restoreSpeed; } catch (_) {}
        }
      }
    }
  }

  function undoSkip(segment) {
    if (!segment) return;
    unskippedSegments.add(segment.id);

    const video = activeVideo || (typeof document !== 'undefined' && (document.querySelector('video.html5-main-video') || document.querySelector('video')));
    if (video) {
      cleanupPlaybackModifications(video);
      video.currentTime = segment.start;
    }
  }

  function onVideoSeeked() {
    if (isKilled || !settings.sponsorBlockEnabled) return;
    if (!segments || segments.length === 0) return;
    const video = activeVideo || (typeof document !== 'undefined' && (document.querySelector('video.html5-main-video') || document.querySelector('video')));
    if (!video) return;

    const cur = video.currentTime;
    for (const seg of segments) {
      if (cur >= seg.start && cur <= seg.end) {
        unskippedSegments.add(seg.id);
        if (isFastForwarding && currentFastForwardSegment && currentFastForwardSegment.id === seg.id) {
          cleanupPlaybackModifications(video);
        }
      }
    }
  }

  // --- Video & Player Binding ---
  function attachVideo(video) {
    if (activeVideo === video) return;
    if (activeVideo) {
      cleanupPlaybackModifications(activeVideo);
      activeVideo.removeEventListener('timeupdate', checkSegmentState);
      activeVideo.removeEventListener('seeked', onVideoSeeked);
      activeVideo.removeEventListener('durationchange', renderMarkers);
      activeVideo.removeEventListener('loadedmetadata', renderMarkers);
    }
    activeVideo = video;
    if (activeVideo) {
      activeVideo.addEventListener('timeupdate', checkSegmentState);
      activeVideo.addEventListener('seeked', onVideoSeeked);
      activeVideo.addEventListener('durationchange', renderMarkers);
      activeVideo.addEventListener('loadedmetadata', renderMarkers);
    }
  }

  async function updateForCurrentVideo() {
    if (isKilled || (typeof window !== 'undefined' && window.CineGlowKilled)) return;
    if (!checkContextOrTeardown()) return;
    const vId = getVideoId();

    const player = (typeof document !== 'undefined' && queryOne(document, '#movie_player, .html5-video-player')) || activePlayer;
    const video = (typeof document !== 'undefined' && queryOne(document, 'video.html5-main-video')) ||
                  (player && (queryOne(player, 'video.html5-main-video') || queryOne(player, 'video'))) ||
                  (typeof document !== 'undefined' && queryOne(document, 'video'));

    activePlayer = player;
    if (video) {
      attachVideo(video);
    }

    if (!settings.sponsorBlockEnabled) {
      removeMarkers();
      dismissNotice();
      return;
    }

    if (vId !== currentVideoId) {
      currentVideoId = vId;
      segments = [];
      unskippedSegments.clear();
      cleanupPlaybackModifications();
      removeMarkers();
      dismissNotice();

      if (vId) {
        const segs = await fetchSegments(vId);
        if (!isKilled && settings.sponsorBlockEnabled && currentVideoId === vId) {
          segments = segs;
          renderMarkers();
          checkSegmentState();
        }
      } else {
        segments = [];
      }
    } else {
      renderMarkers();
      checkSegmentState();
    }
  }

  // --- Lifecycle Listeners ---
  if (typeof window !== 'undefined' && window.CineGlowPlayer) {
    window.CineGlowPlayer.addEventListener('state-change', (e) => {
      if (e.detail?.video) {
        attachVideo(e.detail.video);
      }
      updateForCurrentVideo();
    });
    if (window.CineGlowPlayer.video) {
      attachVideo(window.CineGlowPlayer.video);
    }
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('yt-page-data-updated', updateForCurrentVideo);
    document.addEventListener('yt-navigate-finish', updateForCurrentVideo);
    if (typeof window !== 'undefined') {
      window.addEventListener('popstate', updateForCurrentVideo);
    }
  }

  // Periodic fallback check loop (every 150ms during active playback)
  checkInterval = setInterval(() => {
    if (isKilled || !settings.sponsorBlockEnabled) return;
    if (!checkContextOrTeardown()) return;
    const video = activeVideo || (typeof document !== 'undefined' && (document.querySelector('video.html5-main-video') || document.querySelector('video')));
    if (video && !video.paused && !video.ended) {
      checkSegmentState();
    }
  }, 150);
  if (checkInterval && typeof checkInterval.unref === 'function') {
    checkInterval.unref();
  }

  // --- Emergency Kill-Switch Teardown ---
  function teardownKillSwitch() {
    if (isKilled) return;
    isKilled = true;
    settings.sponsorBlockEnabled = false;

    if (checkInterval) {
      clearInterval(checkInterval);
      checkInterval = null;
    }
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
    if (activeVideo) {
      activeVideo.removeEventListener('timeupdate', checkSegmentState);
      activeVideo.removeEventListener('seeked', onVideoSeeked);
      activeVideo.removeEventListener('durationchange', renderMarkers);
      activeVideo.removeEventListener('loadedmetadata', renderMarkers);
      cleanupPlaybackModifications(activeVideo);
      activeVideo = null;
    }
    removeMarkers();
    dismissNotice();
    segments = [];
    unskippedSegments.clear();
  }

  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage?.addListener) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === 'AURA_EMERGENCY_KILL_SWITCH') {
        teardownKillSwitch();
        if (typeof sendResponse === 'function') {
          sendResponse({ success: true, script: 'sponsor-skip.js' });
        }
      }
    });
  }

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('cineglow:kill-switch', () => {
      teardownKillSwitch();
    }, { once: true });
  }

  // Diagnostics & External Testing Interface
  const api = {
    settings,
    getVideoId,
    getSegments: () => segments,
    setSegments: (newSegs) => { segments = Array.isArray(newSegs) ? newSegs : []; },
    fetchSegments,
    detectChaptersFromDOM,
    isSponsorTitle,
    isAdActive,
    renderMarkers,
    removeMarkers,
    showNotice,
    dismissNotice,
    checkSegmentState,
    undoSkip,
    onVideoSeeked,
    getUnskippedSegments: () => unskippedSegments,
    cleanupPlaybackModifications,
    teardownKillSwitch,
    isKilled: () => isKilled,
    isThirdPartyDisabled: () => isThirdPartyDisabled,
    isContextValid,
    updateForCurrentVideo
  };

  if (typeof window !== 'undefined') {
    window.CineGlowSponsorBlock = api;
  }

  loadSettings();
})();

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
  let segments = [];
  const segmentCache = new Map();
  const unskippedSegments = new Set();
  let abortController = null;
  let activeNoticeEl = null;
  let noticeDismissTimer = null;
  let nextSegmentTimer = 0;
  let isFastForwarding = false;
  let currentFastForwardSegment = null;
  let preFastForwardSpeed = 1.0;
  let preFastForwardMuted = false;
  let markerContainer = null;

  function isContextValid() {
    try {
      if (typeof chrome === 'undefined') return true;
      if (!chrome.runtime || !chrome.runtime.id) return false;
      if (typeof chrome.runtime.getManifest === 'function') {
        return Boolean(chrome.runtime.getManifest());
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
      case 'sponsor': return '#00d26a';
      case 'selfpromo': return '#f5a623';
      case 'interaction': return '#9b59b6';
      case 'intro': return '#3498db';
      case 'outro': return '#00b4d8';
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

    return window.CineGlowPlayer?.videoId || null;
  }

  function isAdActive() {
    try {
      const playerEl = activePlayer || document.querySelector('#movie_player, #shorts-player, .html5-video-player');
      return Boolean(playerEl && (playerEl.classList.contains('ad-showing') || playerEl.classList.contains('ad-interrupting')));
    } catch (_) {
      return false;
    }
  }

  function clearNextSegmentTimer() {
    if (nextSegmentTimer) {
      clearTimeout(nextSegmentTimer);
      nextSegmentTimer = 0;
    }
  }

  // Event-driven boundary scheduler: 0% CPU between sponsor segments
  function scheduleNextSegmentCheck() {
    clearNextSegmentTimer();
    if (isKilled || !settings.sponsorBlockEnabled || !segments.length) return;

    const video = activeVideo || document.querySelector('video.html5-main-video') || document.querySelector('video');
    if (!video || video.paused || video.ended || !isFinite(video.duration)) return;

    const activeCategories = settings.sponsorBlockCategories?.length > 0
      ? settings.sponsorBlockCategories
      : DEFAULT_CATEGORIES;

    const nowTime = video.currentTime;
    const rate = Math.max(0.1, video.playbackRate || 1);
    let nextBoundarySec = Infinity;

    for (const seg of segments) {
      if (!activeCategories.includes(seg.category) || unskippedSegments.has(seg.id)) continue;
      if (nowTime < seg.start) {
        nextBoundarySec = Math.min(nextBoundarySec, seg.start - nowTime);
        break; // segments are sorted by start ascending
      }
      if (nowTime >= seg.start && nowTime < seg.end) {
        nextBoundarySec = Math.min(nextBoundarySec, Math.max(0.02, seg.end - nowTime));
        break;
      }
    }

    if (Number.isFinite(nextBoundarySec)) {
      const delayMs = Math.max(15, Math.min(30_000, (nextBoundarySec / rate) * 1000));
      nextSegmentTimer = setTimeout(() => {
        nextSegmentTimer = 0;
        checkSegmentState();
      }, delayMs);
      if (typeof nextSegmentTimer?.unref === 'function') nextSegmentTimer.unref();
    }
  }

  async function loadSettings() {
    if (isKilled || window.CineGlowKilled) return;
    if (!checkContextOrTeardown()) return;
    try {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        const [local, managed, stored] = await Promise.all([
          chrome.storage.local?.get(['auraKillSwitchActive']).catch(() => ({})),
          chrome.storage.managed?.get(['DisableThirdPartyAPIs', 'KillSwitch']).catch(() => ({})),
          chrome.storage.sync?.get([
            'sponsorBlockEnabled',
            'sponsorBlockMode',
            'sponsorBlockCategories',
            'sponsorBlockNotice'
          ]).catch(() => ({}))
        ]);

        if (local?.auraKillSwitchActive || managed?.KillSwitch) {
          teardownKillSwitch();
          return;
        }
        if (managed?.DisableThirdPartyAPIs) {
          isThirdPartyDisabled = true;
        }

        if (stored.sponsorBlockEnabled !== undefined) {
          settings.sponsorBlockEnabled = Boolean(stored.sponsorBlockEnabled);
        } else if (typeof AURA_DEFAULTS !== 'undefined' && AURA_DEFAULTS.sponsorBlockEnabled !== undefined) {
          settings.sponsorBlockEnabled = Boolean(AURA_DEFAULTS.sponsorBlockEnabled);
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
          settings.sponsorBlockNotice = Boolean(stored.sponsorBlockNotice);
        }
      }
    } catch (_) {}

    if (!settings.sponsorBlockEnabled) {
      clearNextSegmentTimer();
      cleanupPlaybackModifications();
      removeMarkers();
      dismissNotice();
    } else {
      updateForCurrentVideo();
    }
  }

  const handleStorageChange = (changes, area) => {
    if (isKilled || window.CineGlowKilled) return;
    if (!checkContextOrTeardown()) return;
    if (area === 'managed') {
      if (changes.KillSwitch?.newValue === true) {
        teardownKillSwitch();
        return;
      }
      if ('DisableThirdPartyAPIs' in changes) {
        isThirdPartyDisabled = changes.DisableThirdPartyAPIs.newValue === true;
        updateForCurrentVideo();
      }
    }
    if (area === 'local' && changes.auraKillSwitchActive?.newValue === true) {
      teardownKillSwitch();
      return;
    }
    if (area === 'sync') {
      let changed = false;
      if ('sponsorBlockEnabled' in changes) {
        settings.sponsorBlockEnabled = Boolean(changes.sponsorBlockEnabled.newValue);
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
        settings.sponsorBlockNotice = Boolean(changes.sponsorBlockNotice.newValue);
      }
      if (changed) {
        if (!settings.sponsorBlockEnabled) {
          clearNextSegmentTimer();
          cleanupPlaybackModifications();
          removeMarkers();
          dismissNotice();
        } else {
          renderMarkers();
          checkSegmentState();
        }
      }
    }
  };
  chrome.storage?.onChanged?.addListener(handleStorageChange);

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
    const root = document.querySelector('#movie_player, .html5-video-player') || activePlayer || document.body || document;
    const video = activeVideo || document.querySelector('video.html5-main-video') || document.querySelector('video');

    function calcFallbackEnd(start, nextStart) {
      if (typeof nextStart === 'number' && !isNaN(nextStart) && nextStart > start) {
        return nextStart;
      }
      const dur = (video && typeof video.duration === 'number' && isFinite(video.duration)) ? video.duration : (start + 20);
      return Math.min(start + 20, dur);
    }

    try {
      const player = document.querySelector('#movie_player, .html5-video-player');
      if (player && typeof player.getChapters === 'function') {
        const chs = player.getChapters();
        if (Array.isArray(chs)) {
          for (let i = 0; i < chs.length; i++) {
            const ch = chs[i];
            if (ch?.title && isSponsorTitle(ch.title)) {
              const start = Number(ch.time ?? ch.start_time ?? 0);
              let nextStart = null;
              for (let j = i + 1; j < chs.length; j++) {
                const ns = Number(chs[j]?.time ?? chs[j]?.start_time ?? NaN);
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

    try {
      const chapterMarkers = root.querySelectorAll('.ytp-chapter-container, .ytp-chapter-marker');
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
          if (end > start && !detected.some((d) => Math.abs(d.start - start) < 3)) {
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
    } catch (_) {}

    try {
      const macroMarkers = root.querySelectorAll('ytd-macro-markers-list-item-renderer, #macro-markers ytd-macro-markers-list-item-renderer');
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
            if (!detected.some((d) => Math.abs(d.start - start) < 3) && end > start) {
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
      return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
    }
    return Number(match[1]) * 60 + Number(match[2]);
  }

  async function fetchSegments(videoId) {
    if (isKilled || window.CineGlowKilled) return [];
    if (!checkContextOrTeardown() || !videoId) return [];

    if (segmentCache.has(videoId)) {
      return segmentCache.get(videoId);
    }

    if (abortController) {
      abortController.abort();
    }
    abortController = new AbortController();
    const signal = abortController.signal;

    let apiSegments = [];

    if (!isThirdPartyDisabled) {
      const cats = (settings.sponsorBlockCategories?.length > 0)
        ? settings.sponsorBlockCategories
        : DEFAULT_CATEGORIES;

      try {
        const responseData = await new Promise((resolve) => {
          safeSendMessage({ type: 'FETCH_SPONSOR_BLOCK', videoId, categories: cats }, (resp) => {
            if (resp?.success && Array.isArray(resp.segments)) {
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
        } else if (Array.isArray(responseData)) {
          apiSegments = responseData;
        } else if (!signal.aborted && !isThirdPartyDisabled) {
          const url = `https://sponsor.ajay.app/api/skipSegments?videoID=${encodeURIComponent(videoId)}&categories=${encodeURIComponent(JSON.stringify(cats))}`;
          const fetchFn = (typeof fetchWithBackoff === 'function') ? fetchWithBackoff : fetch;
          if (typeof fetchFn === 'function') {
            const resp = await fetchFn(url, { signal, cache: 'no-cache' }).catch(() => null);
            if (resp?.ok) {
              const data = await resp.json().catch(() => []);
              if (Array.isArray(data)) apiSegments = data;
            }
          }
        }
      } catch (_) {}
    }

    if (signal.aborted) return [];

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

    const chapters = detectChaptersFromDOM();
    for (const ch of chapters) {
      const overlaps = normalized.some((s) =>
        (ch.start >= s.start && ch.start <= s.end) ||
        (ch.end >= s.start && ch.end <= s.end) ||
        (s.start >= ch.start && s.start <= ch.end) ||
        Math.abs(s.start - ch.start) < 5
      );
      if (!overlaps) {
        normalized.push(ch);
      }
    }

    normalized.sort((a, b) => a.start - b.start);

    segmentCache.set(videoId, normalized);
    if (segmentCache.size > 50) {
      const oldestKey = segmentCache.keys().next().value;
      segmentCache.delete(oldestKey);
    }

    return normalized;
  }

  function renderMarkers() {
    if (isKilled || !settings.sponsorBlockEnabled) {
      removeMarkers();
      return;
    }
    if (!checkContextOrTeardown()) return;

    const video = activeVideo || document.querySelector('video.html5-main-video') || document.querySelector('video');
    const player = activePlayer || document.querySelector('#movie_player, .html5-video-player');
    if (!video || !player) return;

    const progressBar = player.querySelector('.ytp-progress-bar, .ytp-progress-bar-container') ||
                        document.querySelector('.ytp-progress-bar, .ytp-progress-bar-container');
    if (!progressBar) return;

    const duration = video.duration;
    if (!duration || isNaN(duration) || duration <= 0 || !isFinite(duration)) return;

    removeMarkers();
    if (!segments || segments.length === 0) return;

    const activeCategories = settings.sponsorBlockCategories?.length > 0
      ? settings.sponsorBlockCategories
      : DEFAULT_CATEGORIES;

    markerContainer = document.createElement('div');
    markerContainer.className = SPONSOR_MARKERS_CLASS;

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
        marker.style.left = `${startPct}%`;
        marker.style.width = `${Math.min(100 - startPct, widthPct)}%`;
        marker.style.backgroundColor = getCategoryColor(seg.category);
        marker.style.boxShadow = `0 0 4px ${getCategoryColor(seg.category)}`;
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
    document.querySelectorAll(`.${SPONSOR_MARKERS_CLASS}`).forEach((el) => el.remove());
  }

  function showNotice(segment, onUndo) {
    if (isKilled || !settings.sponsorBlockNotice) return;
    if (!checkContextOrTeardown()) return;
    dismissNotice();

    const player = activePlayer || document.querySelector('#movie_player, .html5-video-player');
    if (!player) return;

    const isFF = settings.sponsorBlockMode === 'fastforward';
    const actionLabel = isFF ? 'Fast-forwarding' : 'Skipped';
    const messageText = `${actionLabel} ${formatCategory(segment.category)} (${formatTime(segment.start)} - ${formatTime(segment.end)})`;

    // Styled by .cineglow-sponsor-notice & .cineglow-sponsor-undo in content.css
    const notice = document.createElement('div');
    notice.className = SPONSOR_NOTICE_CLASS;
    notice.setAttribute('role', 'status');
    notice.setAttribute('data-notice-text', messageText);
    notice.textContent = messageText;

    const color = getCategoryColor(segment.category);
    const badge = document.createElement('span');
    badge.style.cssText = `display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};box-shadow:0 0 6px ${color};`;

    const text = document.createElement('span');
    text.textContent = messageText;

    const undoBtn = document.createElement('button');
    undoBtn.className = 'cineglow-sponsor-undo';
    undoBtn.type = 'button';
    undoBtn.textContent = 'Undo';
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
    if (typeof noticeDismissTimer?.unref === 'function') noticeDismissTimer.unref();
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
    document.querySelectorAll(`.${SPONSOR_NOTICE_CLASS}`).forEach((el) => el.remove());
  }

  function checkSegmentState() {
    if (isKilled || window.CineGlowKilled) return;
    if (!checkContextOrTeardown() || !settings.sponsorBlockEnabled) return;
    if (!segments || segments.length === 0) return;

    const video = activeVideo || document.querySelector('video.html5-main-video') || document.querySelector('video');
    if (!video) return;

    if (!isFinite(video.duration) || document.querySelector('.ytp-live, .ytp-live-badge')) {
      return;
    }

    if (video.seeking || video.paused || video.ended || isAdActive()) return;

    const currentTime = video.currentTime;
    const activeCategories = settings.sponsorBlockCategories?.length > 0
      ? settings.sponsorBlockCategories
      : DEFAULT_CATEGORIES;

    let matchedSegment = null;
    for (const seg of segments) {
      if (!activeCategories.includes(seg.category)) continue;
      if (unskippedSegments.has(seg.id)) continue;
      if (currentTime >= seg.start && currentTime < (seg.end - 0.15)) {
        matchedSegment = seg;
        break;
      }
    }

    if (matchedSegment) {
      if (settings.sponsorBlockMode === 'skip') {
        video.currentTime = Math.min(video.duration || Infinity, matchedSegment.end);
        safeSendMessage({ type: 'SPONSOR_BLOCKED', count: 1 });
        showNotice(matchedSegment, () => undoSkip(matchedSegment));
      } else if (settings.sponsorBlockMode === 'fastforward') {
        if (!isFastForwarding) {
          isFastForwarding = true;
          currentFastForwardSegment = matchedSegment;
          if (video.playbackRate > 0 && video.playbackRate <= 5.0) {
            preFastForwardSpeed = video.playbackRate;
          }
          preFastForwardMuted = video.muted;
          video.muted = true;
          video.playbackRate = 16.0;
          showNotice(matchedSegment, () => undoSkip(matchedSegment));
        } else if (currentFastForwardSegment && currentFastForwardSegment.id !== matchedSegment.id) {
          safeSendMessage({ type: 'SPONSOR_BLOCKED', count: 1 });
          currentFastForwardSegment = matchedSegment;
          showNotice(matchedSegment, () => undoSkip(matchedSegment));
        }
      }
    } else if (isFastForwarding) {
      cleanupPlaybackModifications(video);
      safeSendMessage({ type: 'SPONSOR_BLOCKED', count: 1 });
    }

    scheduleNextSegmentCheck();
  }

  function cleanupPlaybackModifications(targetVideo) {
    const video = targetVideo || activeVideo || document.querySelector('video.html5-main-video') || document.querySelector('video');
    if (isFastForwarding) {
      isFastForwarding = false;
      currentFastForwardSegment = null;
      if (video) {
        if (!preFastForwardMuted && video.muted) {
          video.muted = false;
        }
        if (video.playbackRate === 16.0) {
          const restoreSpeed = (typeof window.CineGlowSpeed?.preferredSpeed === 'number')
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
    const video = activeVideo || document.querySelector('video.html5-main-video') || document.querySelector('video');
    if (video) {
      cleanupPlaybackModifications(video);
      video.currentTime = segment.start;
    }
    scheduleNextSegmentCheck();
  }

  function onVideoSeeked() {
    if (isKilled || !settings.sponsorBlockEnabled || !segments?.length) return;
    const video = activeVideo || document.querySelector('video.html5-main-video') || document.querySelector('video');
    if (!video) return;

    const cur = video.currentTime;
    for (const seg of segments) {
      if (cur >= seg.start && cur <= seg.end) {
        unskippedSegments.add(seg.id);
        if (isFastForwarding && currentFastForwardSegment?.id === seg.id) {
          cleanupPlaybackModifications(video);
        }
      }
    }
    scheduleNextSegmentCheck();
  }

  function attachVideo(video) {
    if (activeVideo === video) return;
    if (activeVideo) {
      clearNextSegmentTimer();
      cleanupPlaybackModifications(activeVideo);
      activeVideo.removeEventListener('timeupdate', checkSegmentState);
      activeVideo.removeEventListener('seeked', onVideoSeeked);
      activeVideo.removeEventListener('ratechange', scheduleNextSegmentCheck);
      activeVideo.removeEventListener('durationchange', renderMarkers);
      activeVideo.removeEventListener('loadedmetadata', renderMarkers);
      activeVideo.removeEventListener('play', scheduleNextSegmentCheck);
      activeVideo.removeEventListener('playing', scheduleNextSegmentCheck);
      activeVideo.removeEventListener('pause', clearNextSegmentTimer);
      activeVideo.removeEventListener('ended', clearNextSegmentTimer);
    }
    activeVideo = video;
    if (activeVideo) {
      activeVideo.addEventListener('timeupdate', checkSegmentState, { passive: true });
      activeVideo.addEventListener('seeked', onVideoSeeked, { passive: true });
      activeVideo.addEventListener('ratechange', scheduleNextSegmentCheck, { passive: true });
      activeVideo.addEventListener('durationchange', renderMarkers, { passive: true });
      activeVideo.addEventListener('loadedmetadata', renderMarkers, { passive: true });
      activeVideo.addEventListener('play', scheduleNextSegmentCheck, { passive: true });
      activeVideo.addEventListener('playing', scheduleNextSegmentCheck, { passive: true });
      activeVideo.addEventListener('pause', clearNextSegmentTimer, { passive: true });
      activeVideo.addEventListener('ended', clearNextSegmentTimer, { passive: true });
      if (!activeVideo.paused && !activeVideo.ended) {
        scheduleNextSegmentCheck();
      }
    }
  }

  async function updateForCurrentVideo() {
    if (isKilled || window.CineGlowKilled) return;
    if (!checkContextOrTeardown()) return;
    const vId = getVideoId();

    const player = document.querySelector('#movie_player, .html5-video-player') || activePlayer;
    const video = document.querySelector('video.html5-main-video') ||
                  player?.querySelector('video.html5-main-video, video') ||
                  document.querySelector('video');

    activePlayer = player;
    if (video) {
      attachVideo(video);
    }

    if (!settings.sponsorBlockEnabled) {
      clearNextSegmentTimer();
      removeMarkers();
      dismissNotice();
      return;
    }

    if (vId !== currentVideoId) {
      currentVideoId = vId;
      segments = [];
      unskippedSegments.clear();
      clearNextSegmentTimer();
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
      }
    } else {
      renderMarkers();
      checkSegmentState();
    }
  }

  const onPlayerStateChange = (e) => {
    if (e.detail?.video) {
      attachVideo(e.detail.video);
    }
    updateForCurrentVideo();
  };

  if (window.CineGlowPlayer) {
    window.CineGlowPlayer.addEventListener('state-change', onPlayerStateChange);
    if (window.CineGlowPlayer.video) {
      attachVideo(window.CineGlowPlayer.video);
    }
  }

  document.addEventListener('yt-page-data-updated', updateForCurrentVideo, { passive: true });
  document.addEventListener('yt-navigate-finish', updateForCurrentVideo, { passive: true });
  window.addEventListener('popstate', updateForCurrentVideo, { passive: true });

  function teardownKillSwitch() {
    if (isKilled) return;
    isKilled = true;
    settings.sponsorBlockEnabled = false;
    window.CineGlowKilled = true;

    chrome.storage?.onChanged?.removeListener(handleStorageChange);
    window.CineGlowPlayer?.removeEventListener?.('state-change', onPlayerStateChange);
    document.removeEventListener('yt-page-data-updated', updateForCurrentVideo);
    document.removeEventListener('yt-navigate-finish', updateForCurrentVideo);
    window.removeEventListener('popstate', updateForCurrentVideo);

    clearNextSegmentTimer();
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
    if (activeVideo) {
      activeVideo.removeEventListener('timeupdate', checkSegmentState);
      activeVideo.removeEventListener('seeked', onVideoSeeked);
      activeVideo.removeEventListener('ratechange', scheduleNextSegmentCheck);
      activeVideo.removeEventListener('durationchange', renderMarkers);
      activeVideo.removeEventListener('loadedmetadata', renderMarkers);
      activeVideo.removeEventListener('play', scheduleNextSegmentCheck);
      activeVideo.removeEventListener('playing', scheduleNextSegmentCheck);
      activeVideo.removeEventListener('pause', clearNextSegmentTimer);
      activeVideo.removeEventListener('ended', clearNextSegmentTimer);
      cleanupPlaybackModifications(activeVideo);
      activeVideo = null;
    }
    removeMarkers();
    dismissNotice();
    segments = [];
    segmentCache.clear();
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

  window.addEventListener('cineglow:kill-switch', () => {
    teardownKillSwitch();
  }, { once: true });

  window.CineGlowSponsorBlock = {
    settings,
    getVideoId,
    getSegments: () => segments,
    setSegments: (newSegs) => {
      segments = Array.isArray(newSegs) ? newSegs : [];
      scheduleNextSegmentCheck();
    },
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

  loadSettings();
})();

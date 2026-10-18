(() => {
  'use strict';

  let enabled = true;
  let currentVideoId = null;
  let currentVideo = null;
  let currentPlayer = null;
  let overlayContainer = null;
  let annotationsList = [];
  let updateIntervalId = null;
  let resizeObserver = null;
  let isAdPlaying = false;

  // --- Settings Management ---
  async function loadSettings() {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.sync) {
        const stored = await chrome.storage.sync.get('restoreAnnotations');
        if (stored.restoreAnnotations !== undefined) {
          enabled = !!stored.restoreAnnotations;
        }
      }
      if (!enabled) {
        teardown();
      } else if (currentVideoId && !overlayContainer) {
        initForVideo(currentVideoId, currentVideo, currentPlayer);
      }
    } catch (err) {
      console.warn('[CineGlow Annotations] Could not load settings:', err);
    }
  }

  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' && 'restoreAnnotations' in changes) {
        enabled = !!changes.restoreAnnotations.newValue;
        if (!enabled) {
          teardown();
        } else if (currentVideoId) {
          initForVideo(currentVideoId, currentVideo, currentPlayer);
        }
      }
    });
  }

  // --- Time & Color Utilities ---
  function parseTime(str) {
    if (!str || str === 'never') return null;
    if (str.includes(':')) {
      const parts = str.split(':');
      let secs = 0;
      let mult = 1;
      while (parts.length > 0) {
        secs += mult * parseFloat(parts.pop() || 0);
        mult *= 60;
      }
      return secs;
    }
    if (str.includes('h') || str.includes('m') || str.includes('s')) {
      let result = 0;
      const hours = str.split('h');
      const minutes = (hours[1] || str).split('m');
      const seconds = (minutes[1] || str).split('s');
      if (hours[0] && hours.length === 2) result += parseFloat(hours[0]) * 3600;
      if (minutes[0] && minutes.length === 2) result += parseFloat(minutes[0]) * 60;
      if (seconds[0] && seconds.length === 2) result += parseFloat(seconds[0]);
      return result;
    }
    return parseFloat(str) || 0;
  }

  function decimalToHex(dec) {
    let hex = (parseInt(dec, 10) || 0).toString(16);
    while (hex.length < 6) hex = '0' + hex;
    return hex;
  }

  function getRgba(bgColor, bgAlpha) {
    const hex = decimalToHex(bgColor);
    const r = parseInt(hex.slice(0, 2), 16) || 0;
    const g = parseInt(hex.slice(2, 4), 16) || 0;
    const b = parseInt(hex.slice(4, 6), 16) || 0;
    const a = bgAlpha !== undefined && !isNaN(bgAlpha) ? parseFloat(bgAlpha) : 0.8;
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }

  function extractAction(actionEl, videoId) {
    if (!actionEl) return null;
    const urlEl = actionEl.querySelector('url');
    if (!urlEl) return null;
    const rawVal = urlEl.getAttribute('value') || '';
    if (!rawVal) return null;

    // Check for timestamp link within same video
    if (rawVal.includes('#t=') || (rawVal.includes('v=') && rawVal.includes(videoId))) {
      const match = rawVal.match(/#t=([^&]+)/);
      if (match) {
        const seconds = parseTime(match[1]);
        if (seconds !== null) {
          return { type: 'seek', seconds, url: rawVal };
        }
      }
    }

    return { type: 'url', url: rawVal, target: urlEl.getAttribute('target') || 'current' };
  }

  // --- XML Parsing ---
  function parseAnnotationsXml(xmlString, videoId) {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(xmlString, 'text/xml');
      const annotationNodes = Array.from(doc.getElementsByTagName('annotation'));
      const parsed = [];

      for (const a of annotationNodes) {
        const id = a.getAttribute('id') || `anno_${Math.random().toString(36).substr(2, 9)}`;
        const type = a.getAttribute('type') || 'text';
        if (type === 'pause' || type === 'timeline' || type === 'marker') continue;

        const style = a.getAttribute('style') || (type === 'highlight' ? 'highlight' : 'popup');
        const textEl = a.querySelector('TEXT');
        const text = textEl ? textEl.textContent.trim() : '';

        const rects = Array.from(a.querySelectorAll('rectRegion'));
        if (!rects.length) continue;

        const firstRect = rects[0];
        const lastRect = rects[rects.length - 1];

        const timeStart = parseTime(firstRect.getAttribute('t'));
        const timeEnd = parseTime(lastRect.getAttribute('t'));
        if (timeStart === null || timeEnd === null || isNaN(timeStart) || isNaN(timeEnd)) continue;

        const x = parseFloat(firstRect.getAttribute('x') || '0');
        const y = parseFloat(firstRect.getAttribute('y') || '0');
        const w = parseFloat(firstRect.getAttribute('w') || '0');
        const h = parseFloat(firstRect.getAttribute('h') || '0');
        const sx = firstRect.getAttribute('sx') ? parseFloat(firstRect.getAttribute('sx')) : null;
        const sy = firstRect.getAttribute('sy') ? parseFloat(firstRect.getAttribute('sy')) : null;

        const appEl = a.querySelector('appearance');
        const bgColor = appEl ? appEl.getAttribute('bgColor') : null;
        const bgAlpha = appEl ? appEl.getAttribute('bgAlpha') : null;
        const fgColor = appEl ? appEl.getAttribute('fgColor') : null;
        const textSize = appEl ? parseFloat(appEl.getAttribute('textSize') || '3.5') : 3.5;

        const action = extractAction(a.querySelector('action'), videoId);

        parsed.push({
          id,
          type,
          style,
          text,
          timeStart,
          timeEnd,
          x,
          y,
          w,
          h,
          sx,
          sy,
          bgColor: bgColor !== null ? parseInt(bgColor, 10) : 0,
          bgAlpha: bgAlpha !== null ? parseFloat(bgAlpha) : 0.8,
          fgColor: fgColor !== null ? parseInt(fgColor, 10) : 16777215,
          textSize: textSize || 3.5,
          action,
          isClosed: false,
          domEl: null
        });
      }

      return parsed;
    } catch (e) {
      console.warn('[CineGlow Annotations] Error parsing XML:', e);
      return [];
    }
  }

  // --- Annotation DOM Creation ---
  function createAnnotationElement(item) {
    const el = document.createElement('div');
    el.className = `cineglow-annotation cineglow-annotation-${item.style}`;
    el.id = `cg_anno_${item.id}`;
    el.hidden = true;

    // Background & text styling
    if (item.type === 'highlight') {
      el.classList.add('cineglow-annotation-highlight');
    } else {
      el.classList.add('cineglow-annotation-note');
      el.style.backgroundColor = getRgba(item.bgColor, item.bgAlpha);
      el.style.color = `#${decimalToHex(item.fgColor)}`;
    }

    if (item.action) {
      el.setAttribute('data-clickable', 'true');
    }

    // Text content
    if (item.text) {
      const content = document.createElement('div');
      content.className = 'cineglow-annotation-content';
      content.textContent = item.text;
      el.appendChild(content);
    }

    // Speech bubble tail
    if (item.style === 'speech' && item.sx !== null && item.sy !== null) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'cineglow-annotation-speech-tail');
      const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      polygon.setAttribute('fill', getRgba(item.bgColor, item.bgAlpha));
      svg.appendChild(polygon);
      el.appendChild(svg);
      item.speechSvg = svg;
      item.speechPolygon = polygon;
    }

    // Close button
    const closeBtn = document.createElement('div');
    closeBtn.className = 'cineglow-annotation-close';
    closeBtn.textContent = '×';
    closeBtn.title = 'Dismiss Annotation';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      item.isClosed = true;
      el.hidden = true;
    });
    el.appendChild(closeBtn);

    // Click handler
    if (item.action) {
      el.addEventListener('click', (e) => {
        if (e.target === closeBtn) return;
        e.stopPropagation();
        e.preventDefault();

        if (item.action.type === 'seek' && currentVideo) {
          currentVideo.currentTime = item.action.seconds;
          try { currentVideo.play(); } catch (_) {}
        } else if (item.action.type === 'url') {
          if (item.action.url.startsWith('https://www.youtube.com/') || item.action.url.startsWith('/')) {
            window.location.href = item.action.url;
          } else {
            window.open(item.action.url, '_blank', 'noopener,noreferrer');
          }
        }
      });
    }

    item.domEl = el;
    return el;
  }

  // --- Geometry & Positioning ---
  function updateLayout() {
    if (!overlayContainer || !currentVideo || !currentPlayer) return;

    const pRect = currentPlayer.getBoundingClientRect();
    const pWidth = pRect.width || 640;
    const pHeight = pRect.height || 360;

    const vWidth = currentVideo.videoWidth || 16;
    const vHeight = currentVideo.videoHeight || 9;

    const playerAspect = pWidth / pHeight;
    const videoAspect = vWidth / vHeight;

    let renderW = pWidth;
    let renderH = pHeight;
    let offsetL = 0;
    let offsetT = 0;

    if (playerAspect > videoAspect) {
      renderH = pHeight;
      renderW = pHeight * videoAspect;
      offsetL = (pWidth - renderW) / 2;
    } else {
      renderW = pWidth;
      renderH = pWidth / videoAspect;
      offsetT = (pHeight - renderH) / 2;
    }

    for (const item of annotationsList) {
      if (!item.domEl) continue;

      const pxL = offsetL + (item.x / 100) * renderW;
      const pxT = offsetT + (item.y / 100) * renderH;
      const pxW = (item.w / 100) * renderW;
      const pxH = (item.h / 100) * renderH;

      item.domEl.style.left = `${pxL}px`;
      item.domEl.style.top = `${pxT}px`;
      item.domEl.style.width = `${pxW}px`;
      item.domEl.style.height = `${pxH}px`;

      // Font size proportional to video height
      const fontSizePx = Math.max(10, Math.round((item.textSize / 100) * renderH));
      item.domEl.style.fontSize = `${fontSizePx}px`;

      // Speech bubble pointer calculation
      if (item.speechPolygon && item.sx !== null && item.sy !== null) {
        const pointPxX = offsetL + (item.sx / 100) * renderW - pxL;
        const pointPxY = offsetT + (item.sy / 100) * renderH - pxT;

        // Base points on the nearest edge of the bubble
        const baseStartX = pxW * 0.25;
        const baseEndX = pxW * 0.45;
        const baseEndY = pxH;

        item.speechPolygon.setAttribute('points', `${baseStartX},${baseEndY} ${pointPxX},${pointPxY} ${baseEndX},${baseEndY}`);
      }
    }
  }

  // --- Playback Sync Loop ---
  function onTimeTick() {
    if (!currentVideo || !overlayContainer || isAdPlaying) return;
    const curTime = currentVideo.currentTime;

    for (const item of annotationsList) {
      if (!item.domEl || item.isClosed) continue;
      const shouldShow = curTime >= item.timeStart && curTime < item.timeEnd;
      if (item.domEl.hidden === shouldShow) {
        item.domEl.hidden = !shouldShow;
      }
    }
  }

  // --- Video Initialization & Fetching ---
  async function initForVideo(videoId, video, player) {
    teardown();
    if (!enabled || !videoId || !player) return;

    currentVideoId = videoId;
    currentVideo = video;
    currentPlayer = player;

    // Check if ads are currently playing
    isAdPlaying = player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting');

    // Create overlay container
    overlayContainer = document.createElement('div');
    overlayContainer.className = 'cineglow-annotations-overlay';
    if (isAdPlaying) overlayContainer.style.display = 'none';

    // Insert into movie_player above video
    player.appendChild(overlayContainer);

    // Setup ResizeObserver for responsive video letterboxing
    resizeObserver = new ResizeObserver(() => updateLayout());
    resizeObserver.observe(player);
    if (video) resizeObserver.observe(video);

    // Fetch archived annotations from background service worker
    try {
      chrome.runtime.sendMessage({ type: 'FETCH_ANNOTATIONS', videoId }, (response) => {
        if (!response || !response.success || !response.xml) {
          console.debug('[CineGlow Annotations] No archived annotations available for:', videoId);
          return;
        }

        if (currentVideoId !== videoId || !overlayContainer) return;

        annotationsList = parseAnnotationsXml(response.xml, videoId);
        console.info(`[CineGlow Annotations] Restored ${annotationsList.length} classic annotations for ${videoId}`);

        const fragment = document.createDocumentFragment();
        for (const item of annotationsList) {
          const el = createAnnotationElement(item);
          fragment.appendChild(el);
        }
        overlayContainer.appendChild(fragment);

        updateLayout();
        onTimeTick();

        // Start sync timers
        if (!updateIntervalId) {
          updateIntervalId = setInterval(onTimeTick, 150);
        }
      });
    } catch (err) {
      console.warn('[CineGlow Annotations] Failed to request annotations:', err);
    }

    if (video) {
      video.addEventListener('timeupdate', onTimeTick);
    }
  }

  function teardown() {
    if (updateIntervalId) {
      clearInterval(updateIntervalId);
      updateIntervalId = null;
    }
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
    if (currentVideo) {
      currentVideo.removeEventListener('timeupdate', onTimeTick);
    }
    if (overlayContainer) {
      overlayContainer.remove();
      overlayContainer = null;
    }
    annotationsList = [];
  }

  // --- Player Manager Hook ---
  function onPlayerState(e) {
    const pm = e ? e.detail : window.CineGlowPlayer;
    if (!pm) return;

    if (!pm.isWatchPage || !pm.videoId) {
      teardown();
      currentVideoId = null;
      return;
    }

    isAdPlaying = !!pm.isAdShowing;
    if (overlayContainer) {
      overlayContainer.style.display = isAdPlaying ? 'none' : 'block';
    }

    if (pm.videoId !== currentVideoId || !overlayContainer) {
      initForVideo(pm.videoId, pm.video, pm.player);
    }
  }

  if (window.CineGlowPlayer) {
    window.CineGlowPlayer.addEventListener('state-change', onPlayerState);
    if (window.CineGlowPlayer.isWatchPage && window.CineGlowPlayer.videoId) {
      onPlayerState({ detail: window.CineGlowPlayer });
    }
  } else {
    window.addEventListener('load', () => {
      if (window.CineGlowPlayer) {
        window.CineGlowPlayer.addEventListener('state-change', onPlayerState);
        if (window.CineGlowPlayer.isWatchPage && window.CineGlowPlayer.videoId) {
          onPlayerState({ detail: window.CineGlowPlayer });
        }
      }
    });
  }

  loadSettings();
})();

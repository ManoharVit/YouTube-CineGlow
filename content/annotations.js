(() => {
  'use strict';

  let enabled = false;
  let settingsLoaded = false;
  let isThirdPartyDisabled = false;
  let currentVideoId = null;
  let currentVideo = null;
  let attachedVideo = null;
  let currentPlayer = null;
  let activeVideoId = null;
  let overlayContainer = null;
  let annotationsList = [];
  let boundaryTimerId = 0;
  let resizeObserver = null;
  let isAdPlaying = false;
  let isKilled = false;

  async function loadSettings() {
    if (isKilled || window.CineGlowKilled) return;
    try {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        const [local, managed, stored] = await Promise.all([
          chrome.storage.local?.get(['auraKillSwitchActive']).catch(() => ({})),
          chrome.storage.managed?.get(['DisableThirdPartyAPIs', 'KillSwitch']).catch(() => ({})),
          chrome.storage.sync?.get('restoreAnnotations').catch(() => ({}))
        ]);
        if (local?.auraKillSwitchActive || managed?.KillSwitch) {
          teardownKillSwitch();
          return;
        }
        if (managed?.DisableThirdPartyAPIs) {
          isThirdPartyDisabled = true;
        }
        if (stored?.restoreAnnotations !== undefined) {
          enabled = Boolean(stored.restoreAnnotations);
        } else if (typeof AURA_DEFAULTS !== 'undefined' && AURA_DEFAULTS.restoreAnnotations !== undefined) {
          enabled = Boolean(AURA_DEFAULTS.restoreAnnotations);
        }
      } else if (typeof AURA_DEFAULTS !== 'undefined' && AURA_DEFAULTS.restoreAnnotations !== undefined) {
        enabled = Boolean(AURA_DEFAULTS.restoreAnnotations);
      }
    } catch (err) {
      console.warn('[CineGlow Annotations] Could not load settings:', err);
    } finally {
      settingsLoaded = true;
      if (!enabled || isThirdPartyDisabled) {
        teardown();
      } else if (currentVideoId && currentPlayer && !overlayContainer) {
        initForVideo(currentVideoId, currentVideo, currentPlayer);
      }
    }
  }

  const handleStorageChange = (changes, area) => {
    if (isKilled || window.CineGlowKilled) return;
    if (area === 'managed') {
      if (changes.KillSwitch?.newValue === true) {
        teardownKillSwitch();
        return;
      }
      if ('DisableThirdPartyAPIs' in changes) {
        isThirdPartyDisabled = changes.DisableThirdPartyAPIs.newValue === true;
        if (isThirdPartyDisabled) teardown();
      }
    }
    if (area === 'local' && changes.auraKillSwitchActive?.newValue === true) {
      teardownKillSwitch();
      return;
    }
    if (area === 'sync' && 'restoreAnnotations' in changes) {
      enabled = Boolean(changes.restoreAnnotations.newValue);
      if (!enabled || isThirdPartyDisabled) {
        teardown();
      } else if (currentVideoId && currentPlayer) {
        initForVideo(currentVideoId, currentVideo, currentPlayer);
      }
    }
  };
  chrome.storage?.onChanged?.addListener(handleStorageChange);

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
      const hmsMatch = str.match(/^(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s)?$/);
      if (hmsMatch && (hmsMatch[1] !== undefined || hmsMatch[2] !== undefined || hmsMatch[3] !== undefined)) {
        return (
          (hmsMatch[1] ? parseFloat(hmsMatch[1]) * 3600 : 0) +
          (hmsMatch[2] ? parseFloat(hmsMatch[2]) * 60 : 0) +
          (hmsMatch[3] ? parseFloat(hmsMatch[3]) : 0)
        );
      }
      return 0;
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
    const numericAlpha = bgAlpha !== null && bgAlpha !== undefined && bgAlpha !== '' ? Number(bgAlpha) : NaN;
    const a = Number.isFinite(numericAlpha) ? Math.min(1, Math.max(0, numericAlpha)) : 0.8;
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }

  function extractAction(actionEl, videoId) {
    if (!actionEl) return null;
    const urlEl = actionEl.querySelector('url');
    if (!urlEl) return null;
    const rawVal = urlEl.getAttribute('value') || '';
    if (!rawVal) return null;

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

  function parseAnnotationsXml(xmlString, videoId) {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(xmlString, 'text/xml');
      if (doc.querySelector?.('parsererror')) return [];
      const annotationNodes = Array.from(doc.getElementsByTagName('annotation'));
      const parsed = [];

      for (const a of annotationNodes) {
        const fallbackId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID().slice(0, 8)
          : Math.random().toString(36).slice(2, 10);
        const id = a.getAttribute('id') || `anno_${fallbackId}`;
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

  function createAnnotationElement(item) {
    const el = document.createElement('div');
    el.className = `cineglow-annotation cineglow-annotation-${item.style}`;
    el.id = `cg_anno_${item.id}`;
    el.hidden = true;

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

    if (item.text) {
      const content = document.createElement('div');
      content.className = 'cineglow-annotation-content';
      content.textContent = item.text;
      el.appendChild(content);
    }

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

    if (item.action) {
      el.addEventListener('click', (e) => {
        if (e.target === closeBtn) return;
        e.stopPropagation();
        e.preventDefault();

        if (item.action.type === 'seek' && currentVideo) {
          currentVideo.currentTime = item.action.seconds;
          try { currentVideo.play(); } catch (_) {}
        } else if (item.action.type === 'url') {
          try {
            if (typeof item.action.url === 'string' && !item.action.url.startsWith('//')) {
              const parsed = new URL(item.action.url, 'https://www.youtube.com');
              const host = parsed.hostname;
              const isYouTube = host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be';
              if ((parsed.protocol === 'https:' || parsed.protocol === 'http:') && isYouTube) {
                if (item.action.target === 'new') {
                  window.open(parsed.href, '_blank', 'noopener,noreferrer');
                } else {
                  window.location.href = parsed.href;
                }
              }
            }
          } catch (_) {}
        }
      });
    }

    item.domEl = el;
    return el;
  }

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

      const fontSizePx = Math.max(10, Math.round((item.textSize / 100) * renderH));
      item.domEl.style.fontSize = `${fontSizePx}px`;

      if (item.speechPolygon && item.sx !== null && item.sy !== null) {
        const pointPxX = offsetL + (item.sx / 100) * renderW - pxL;
        const pointPxY = offsetT + (item.sy / 100) * renderH - pxT;
        const baseStartX = pxW * 0.25;
        const baseEndX = pxW * 0.45;
        const baseEndY = pxH;
        item.speechPolygon.setAttribute('points', `${baseStartX},${baseEndY} ${pointPxX},${pointPxY} ${baseEndX},${baseEndY}`);
      }
    }
  }

  function clearBoundaryTimer() {
    if (boundaryTimerId) {
      clearTimeout(boundaryTimerId);
      boundaryTimerId = 0;
    }
  }

  function onTimeTick() {
    clearBoundaryTimer();
    if (!currentVideo || !overlayContainer || isAdPlaying || isKilled) return;
    const curTime = currentVideo.currentTime;
    let nextBoundarySec = Infinity;

    for (const item of annotationsList) {
      if (!item.domEl || item.isClosed) continue;
      const shouldShow = curTime >= item.timeStart && curTime < item.timeEnd;
      if (item.domEl.hidden === shouldShow) {
        item.domEl.hidden = !shouldShow;
      }
      if (curTime < item.timeStart) {
        nextBoundarySec = Math.min(nextBoundarySec, item.timeStart - curTime);
      } else if (curTime < item.timeEnd) {
        nextBoundarySec = Math.min(nextBoundarySec, item.timeEnd - curTime);
      }
    }

    if (!currentVideo.paused && !currentVideo.ended && Number.isFinite(nextBoundarySec)) {
      const rate = Math.max(0.1, currentVideo.playbackRate || 1);
      const delayMs = Math.max(20, Math.min(30_000, (nextBoundarySec / rate) * 1000));
      boundaryTimerId = setTimeout(onTimeTick, delayMs);
      if (typeof boundaryTimerId?.unref === 'function') boundaryTimerId.unref();
    }
  }

  async function initForVideo(videoId, video, player) {
    if (isKilled || window.CineGlowKilled) return;
    teardown();
    if (!enabled || isThirdPartyDisabled || !videoId || !player) return;

    activeVideoId = videoId;
    currentVideoId = videoId;
    currentVideo = video;
    attachedVideo = video;
    currentPlayer = player;

    isAdPlaying = player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting');

    overlayContainer = document.createElement('div');
    overlayContainer.className = 'cineglow-annotations-overlay';
    if (isAdPlaying) overlayContainer.style.display = 'none';
    player.appendChild(overlayContainer);

    resizeObserver = new ResizeObserver(() => updateLayout());
    resizeObserver.observe(player);
    if (video) resizeObserver.observe(video);

    if (video) {
      video.addEventListener('timeupdate', onTimeTick, { passive: true });
      video.addEventListener('seeked', onTimeTick, { passive: true });
      video.addEventListener('ratechange', onTimeTick, { passive: true });
      video.addEventListener('play', onTimeTick, { passive: true });
      video.addEventListener('playing', onTimeTick, { passive: true });
      video.addEventListener('pause', clearBoundaryTimer, { passive: true });
      video.addEventListener('ended', clearBoundaryTimer, { passive: true });
    }

    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      try {
        chrome.runtime.sendMessage({ type: 'FETCH_ANNOTATIONS', videoId }, (response) => {
          try {
            if (chrome.runtime?.lastError) return;
          } catch (_) { return; }
          if (!response?.success || !response.xml) return;
          if (currentVideoId !== videoId || !overlayContainer || !enabled || isKilled) return;

          annotationsList = parseAnnotationsXml(response.xml, videoId);
          const fragment = document.createDocumentFragment();
          for (const item of annotationsList) {
            fragment.appendChild(createAnnotationElement(item));
          }
          overlayContainer.appendChild(fragment);

          updateLayout();
          onTimeTick();
        });
      } catch (err) {
        console.warn('[CineGlow Annotations] Failed to request annotations:', err);
      }
    }
  }

  function detachVideoListeners(v) {
    if (!v) return;
    v.removeEventListener('timeupdate', onTimeTick);
    v.removeEventListener('seeked', onTimeTick);
    v.removeEventListener('ratechange', onTimeTick);
    v.removeEventListener('play', onTimeTick);
    v.removeEventListener('playing', onTimeTick);
    v.removeEventListener('pause', clearBoundaryTimer);
    v.removeEventListener('ended', clearBoundaryTimer);
  }

  function teardown() {
    activeVideoId = null;
    clearBoundaryTimer();
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
    detachVideoListeners(currentVideo);
    if (attachedVideo && attachedVideo !== currentVideo) {
      detachVideoListeners(attachedVideo);
    }
    attachedVideo = null;
    if (overlayContainer) {
      overlayContainer.remove();
      overlayContainer = null;
    }
    annotationsList = [];
  }

  function onPlayerState(e) {
    if (isKilled || window.CineGlowKilled) return;
    const pm = e ? e.detail : window.CineGlowPlayer;
    if (!pm) return;

    if (!pm.isWatchPage || !pm.videoId) {
      teardown();
      currentVideoId = null;
      currentVideo = null;
      attachedVideo = null;
      currentPlayer = null;
      return;
    }

    currentVideoId = pm.videoId;
    currentVideo = pm.video;
    currentPlayer = pm.player;

    isAdPlaying = Boolean(pm.isAdShowing);
    if (overlayContainer) {
      overlayContainer.style.display = isAdPlaying ? 'none' : 'block';
    }

    if (!settingsLoaded || !enabled || isThirdPartyDisabled) return;

    if (pm.videoId !== activeVideoId || !overlayContainer || (pm.video && pm.video !== attachedVideo)) {
      initForVideo(pm.videoId, pm.video, pm.player);
    }
  }

  function teardownKillSwitch() {
    if (isKilled) return;
    isKilled = true;
    enabled = false;
    window.CineGlowKilled = true;

    chrome.storage?.onChanged?.removeListener(handleStorageChange);
    window.CineGlowPlayer?.removeEventListener?.('state-change', onPlayerState);
    teardown();

    currentVideo = null;
    attachedVideo = null;
    currentPlayer = null;
    currentVideoId = null;
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
          sendResponse({ success: true, script: 'annotations.js' });
        }
      }
    });
  }

  window.addEventListener('cineglow:kill-switch', () => {
    teardownKillSwitch();
  }, { once: true });

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
    }, { once: true });
  }

  window.CineGlowAnnotations = {
    loadSettings,
    initForVideo,
    teardown,
    teardownKillSwitch,
    onPlayerState,
    isEnabled: () => enabled,
    isSettingsLoaded: () => settingsLoaded,
    createAnnotationElement
  };

  loadSettings();
})();


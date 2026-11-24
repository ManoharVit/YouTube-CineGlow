(() => {
  'use strict';

  const RECORD_BUTTON_CLASS = 'cineglow-record-button';
  const CAM_SVG_PATH = 'M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z';

  const FORMAT_CONFIGS = {
    mp4: {
      label: 'MP4',
      name: 'MP4 (H.264 + AAC)',
      ext: 'mp4',
      badge: 'MP4',
      desc: 'Universal MP4 with H.264 video & AAC audio — native duration, 100% compatible with macOS (QuickTime, Safari, Finder) & Windows'
    },
    mkv: {
      label: 'MKV',
      name: 'MKV (Matroska)',
      ext: 'mkv',
      badge: 'MKV',
      desc: 'Genuine Matroska container with duration metadata — for IINA / VLC'
    },
    webm: {
      label: 'WebM',
      name: 'WebM (VP9/VP8)',
      ext: 'webm',
      badge: 'WEBM',
      desc: 'Standard native browser format with duration metadata'
    }
  };

  const lifecycle = new AbortController();
  const { signal } = lifecycle;

  let currentButton = null;
  let currentWrapper = null;
  let mediaRecorder = null;
  let canvasPipelineCleanup = null;
  let audioTapCleanup = null;
  let recordedChunks = [];
  let recordingStartTime = 0;
  let timerInterval = 0;
  let activeStream = null;
  let activeRecordedMimeType = '';
  let activeRecordingFormat = null;
  let activeRecordingFps = null;
  let hudEl = null;
  let hudHost = null;
  let hudShadow = null;
  let activeMenu = null;
  let menuAbortController = null;
  let toastTimeout = 0;
  let hudRemoveTimer = 0;
  let isKilled = false;
  let isRecordingDisabled = false;

  let currentFormat = 'mkv';
  let currentFps = 30;

  function sanitizeRecordingTitle(rawTitle) {
    const clean = (rawTitle || 'YouTube')
      .replace(/ - YouTube$/, '')
      .replace(/[\\/:*?"<>|]/g, '')
      .trim();
    return clean || 'YouTube';
  }

  function getRecordingFilename(title, durationSec, ext) {
    return `Recording_${sanitizeRecordingTitle(title)}_${durationSec}s.${ext}`;
  }

  function selectMimeType(targetFormat) {
    const isSupported = (typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function')
      ? (t) => MediaRecorder.isTypeSupported(t)
      : () => false;

    const candidatesByFormat = {
      mp4: ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4'],
      mkv: ['video/x-matroska;codecs=avc1', 'video/x-matroska;codecs=vp9,opus', 'video/x-matroska', 'video/webm;codecs=vp9,opus'],
      webm: ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm;codecs=h264,opus', 'video/webm']
    };

    for (const t of (candidatesByFormat[targetFormat] || candidatesByFormat.webm)) {
      if (isSupported(t)) return t;
    }
    for (const t of ['video/mp4;codecs=avc1,mp4a.40.2', 'video/webm;codecs=vp9,opus', 'video/webm']) {
      if (isSupported(t)) return t;
    }
    return 'video/webm';
  }

  function deriveContainerExtension(mimeType, requestedFormat) {
    const mime = (mimeType || '').toLowerCase();
    if (mime.includes('mp4')) return 'mp4';
    if (mime.includes('matroska') || requestedFormat === 'mkv') return 'mkv';
    if (mime.includes('webm')) return 'webm';
    return requestedFormat || 'webm';
  }

  async function loadSettings() {
    try {
      const [local, managed, stored] = await Promise.all([
        chrome.storage?.local?.get(['auraKillSwitchActive']).catch(() => ({})),
        chrome.storage?.managed?.get(['DisableRecording', 'KillSwitch']).catch(() => ({})),
        chrome.storage?.sync?.get({ recordFormat: 'mkv', recordFps: 30 }).catch(() => ({}))
      ]);
      if (local?.auraKillSwitchActive || managed?.KillSwitch) {
        teardownKillSwitch();
        return;
      }
      if (managed?.DisableRecording) {
        isRecordingDisabled = true;
        removeExistingButton();
        return;
      }
      if (stored?.recordFormat && FORMAT_CONFIGS[stored.recordFormat]) {
        currentFormat = stored.recordFormat;
      }
      if (stored?.recordFps) {
        currentFps = Number(stored.recordFps) || 30;
      }
    } catch (_) {}
    updateButtonVisuals();
  }

  const handleStorageChange = (changes, area) => {
    if (isKilled) return;
    if (area === 'sync') {
      let changed = false;
      if (changes.recordFormat && FORMAT_CONFIGS[changes.recordFormat.newValue]) {
        currentFormat = changes.recordFormat.newValue;
        changed = true;
      }
      if (changes.recordFps) {
        currentFps = Number(changes.recordFps.newValue) || 30;
        changed = true;
      }
      if (changed) {
        updateButtonVisuals();
      }
    }
    if (area === 'managed') {
      if ('DisableRecording' in changes) {
        isRecordingDisabled = changes.DisableRecording.newValue === true;
        if (isRecordingDisabled) {
          if (mediaRecorder?.state === 'recording') stopRecording();
          removeExistingButton();
        } else if (window.CineGlowPlayer) {
          injectRecordButton(window.CineGlowPlayer);
        }
      }
      if (changes.KillSwitch?.newValue === true) {
        teardownKillSwitch();
      }
    }
    if (area === 'local' && changes.auraKillSwitchActive?.newValue === true) {
      teardownKillSwitch();
    }
  };
  chrome.storage?.onChanged?.addListener(handleStorageChange);

  function removeExistingButton() {
    if (mediaRecorder?.state === 'recording') {
      stopRecording();
    }
    closeRecMenu();
    document.querySelectorAll(`.cineglow-record-wrapper, .${RECORD_BUTTON_CLASS}`).forEach((el) => el.remove());
    currentButton = null;
    currentWrapper = null;
    clearTimeout(hudRemoveTimer);
    hudEl?.remove();
    hudEl = null;
    hudHost?.remove();
    hudHost = null;
    hudShadow = null;
    window.CineGlowToolbar?.cleanupToolbarIfEmpty?.();
  }

  function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  function renderBadgeLabel(badge, text, withChevron) {
    if (!badge) return;
    badge.textContent = text;
    if (withChevron) {
      const chev = document.createElement('span');
      chev.className = 'cineglow-rec-chevron';
      chev.textContent = '▾';
      badge.appendChild(chev);
    }
  }

  function updateButtonVisuals() {
    if (!currentButton) return;
    const isRecording = mediaRecorder?.state === 'recording';
    const badge = currentButton.querySelector('.cineglow-record-badge');
    const svgPath = currentButton.querySelector('.cineglow-rec-svg-path');
    const rectIcon = currentButton.querySelector('.cineglow-rec-stop-rect');

    currentButton.classList.toggle('cineglow-recording', isRecording);

    if (isRecording) {
      if (svgPath) svgPath.style.display = 'none';
      if (rectIcon) rectIcon.style.display = 'block';
      const activeFmt = (activeRecordingFormat || currentFormat).toUpperCase();
      const activeFps = activeRecordingFps || currentFps;
      currentButton.title = `Recording ${activeFmt} (${activeFps} FPS)... Click to stop & save`;
    } else {
      if (svgPath) svgPath.style.display = 'block';
      if (rectIcon) rectIcon.style.display = 'none';
      const cfg = FORMAT_CONFIGS[currentFormat] || FORMAT_CONFIGS.mkv;
      renderBadgeLabel(badge, cfg.badge, true);
      if (badge) badge.title = 'Click badge to change format & FPS';
      currentButton.title = `Record Video (${currentFormat.toUpperCase()} • ${currentFps} FPS)\nClick icon to record • Click [${cfg.badge} ▾] or ⚙ Options for format settings`;
    }
  }

  function updateHUD(elapsedSec) {
    clearTimeout(hudRemoveTimer);
    if (!hudEl) {
      const player = window.CineGlowPlayer?.player || document.getElementById('movie_player');
      if (player) {
        hudHost = document.createElement('div');
        hudHost.id = 'cineglow-hud-host';
        hudHost.className = 'cineglow-hud-host';
        hudHost.style.position = 'absolute';
        hudHost.style.top = '18px';
        hudHost.style.right = '22px';
        hudHost.style.zIndex = '70';
        hudHost.style.pointerEvents = 'none';

        if (typeof hudHost.attachShadow === 'function') {
          try {
            hudShadow = hudHost.attachShadow({ mode: 'open' });
          } catch (_) {
            hudShadow = hudHost;
          }
        } else {
          hudShadow = hudHost;
        }

        const style = document.createElement('style');
        style.textContent = `
          :host {
            position: absolute !important;
            top: 18px !important;
            right: 22px !important;
            z-index: 70 !important;
            pointer-events: none !important;
            display: block !important;
          }
          .cineglow-rec-hud {
            position: relative;
            background: rgba(15, 15, 18, 0.88);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            border: 1px solid rgba(239, 68, 68, 0.45);
            padding: 6px 14px;
            border-radius: 20px;
            display: inline-flex;
            align-items: center;
            gap: 8px;
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.6);
            pointer-events: none;
            user-select: none;
            animation: cineglow-pop 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
          }
          @keyframes cineglow-pop {
            0% { transform: scale(0.92); opacity: 0; }
            100% { transform: scale(1); opacity: 1; }
          }
          .cineglow-rec-dot {
            width: 9px;
            height: 9px;
            border-radius: 50%;
            background: #ef4444;
            box-shadow: 0 0 8px #ef4444;
            display: inline-block;
            flex-shrink: 0;
            animation: cineglow-rec-blink 1s infinite alternate ease-in-out;
          }
          @keyframes cineglow-rec-blink {
            0% { opacity: 0.2; transform: scale(0.85); }
            100% { opacity: 1; transform: scale(1.15); }
          }
          .cineglow-rec-hud-text {
            font-family: 'YouTube Sans', 'Roboto', -apple-system, BlinkMacSystemFont, sans-serif;
            font-size: 13px;
            font-weight: 700;
            color: #fff;
            letter-spacing: 0.5px;
            white-space: nowrap;
          }
          .cineglow-rec-badge-tag {
            font-family: 'YouTube Sans', 'Roboto', -apple-system, BlinkMacSystemFont, sans-serif;
            font-size: 11px;
            font-weight: 700;
            color: rgba(255, 255, 255, 0.85);
            background: rgba(255, 255, 255, 0.14);
            padding: 2px 7px;
            border-radius: 10px;
            margin-left: 4px;
            letter-spacing: 0.2px;
            white-space: nowrap;
            display: inline-block;
          }
          .cineglow-rec-saved-text {
            font-family: 'YouTube Sans', 'Roboto', -apple-system, BlinkMacSystemFont, sans-serif;
            font-size: 13px;
            font-weight: 700;
            color: #4ade80;
            white-space: nowrap;
          }
        `;

        hudEl = document.createElement('div');
        hudEl.className = 'cineglow-rec-hud';
        hudEl.style.display = 'inline-flex';
        hudEl.style.alignItems = 'center';
        hudEl.style.gap = '8px';

        if (hudShadow && hudShadow !== hudHost) {
          hudShadow.appendChild(style);
          hudShadow.appendChild(hudEl);
          player.appendChild(hudHost);
        } else {
          hudHost.appendChild(style);
          hudHost.appendChild(hudEl);
          player.appendChild(hudHost);
        }
      }
    }
    if (hudEl) {
      const fmt = (activeRecordingFormat || currentFormat).toUpperCase();
      const fps = activeRecordingFps || currentFps;
      const audioLabel = activeStream?.getAudioTracks().length > 0 ? 'AUDIO' : 'NO AUDIO';

      hudEl.textContent = '';
      const dot = document.createElement('span');
      dot.className = 'cineglow-rec-dot';
      dot.style.display = 'inline-block';
      dot.style.width = '9px';
      dot.style.height = '9px';
      dot.style.borderRadius = '50%';
      dot.style.background = '#ef4444';
      dot.style.boxShadow = '0 0 8px #ef4444';
      dot.style.flexShrink = '0';

      const recText = document.createElement('span');
      recText.className = 'cineglow-rec-hud-text';
      recText.textContent = `REC ${formatTime(elapsedSec)}`;

      const tag = document.createElement('span');
      tag.className = 'cineglow-rec-badge-tag';
      tag.style.display = 'inline-block';
      tag.style.marginLeft = '4px';
      tag.textContent = `${fmt} • ${fps} FPS • ${audioLabel}`;

      hudEl.appendChild(dot);
      hudEl.appendChild(recText);
      hudEl.appendChild(tag);
    }
  }

  function hideHUD(savedMsg) {
    if (!hudEl) return;
    if (savedMsg) {
      hudEl.textContent = '';
      const savedSpan = document.createElement('span');
      savedSpan.className = 'cineglow-rec-saved-text';
      savedSpan.textContent = savedMsg;
      hudEl.appendChild(savedSpan);

      clearTimeout(hudRemoveTimer);
      hudRemoveTimer = setTimeout(() => {
        hudEl?.remove();
        hudEl = null;
        hudHost?.remove();
        hudHost = null;
        hudShadow = null;
      }, 2500);
    } else {
      hudEl.remove();
      hudEl = null;
      hudHost?.remove();
      hudHost = null;
      hudShadow = null;
    }
  }

  function showToast(msg, player) {
    if (!player) return;
    let toast = player.querySelector('.cineglow-rec-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'cineglow-rec-toast';
      player.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('visible');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      toast.classList.remove('visible');
    }, 2000);
  }

  function closeRecMenu() {
    if (menuAbortController) {
      menuAbortController.abort();
      menuAbortController = null;
    }
    if (activeMenu) {
      activeMenu.closest('.cineglow-floating-toolbar')?.classList.remove('cineglow-menu-open');
      activeMenu.remove();
      activeMenu = null;
    }
  }

  function openRecMenu(anchorBtn, player) {
    if (isKilled || window.CineGlowKilled) return;
    if (activeMenu) {
      closeRecMenu();
      return;
    }

    menuAbortController = new AbortController();
    const menu = document.createElement('div');
    menu.className = 'cineglow-rec-menu';

    const header = document.createElement('div');
    header.className = 'cineglow-rec-header';

    const headerLeft = document.createElement('div');
    headerLeft.className = 'cineglow-rec-header-left';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'cineglow-rec-header-icon');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'currentColor');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', CAM_SVG_PATH);
    svg.appendChild(path);
    const titleSpan = document.createElement('span');
    titleSpan.textContent = 'Recording Options';
    headerLeft.appendChild(svg);
    headerLeft.appendChild(titleSpan);

    const badgeSpan = document.createElement('span');
    badgeSpan.className = 'cineglow-rec-current-badge';
    badgeSpan.textContent = `${currentFormat.toUpperCase()} • ${currentFps} FPS`;

    header.appendChild(headerLeft);
    header.appendChild(badgeSpan);
    menu.appendChild(header);

    const sec1 = document.createElement('div');
    sec1.className = 'cineglow-rec-section';
    const label1 = document.createElement('div');
    label1.className = 'cineglow-rec-label';
    label1.textContent = 'Container Format';
    sec1.appendChild(label1);

    const pillsRow = document.createElement('div');
    pillsRow.className = 'cineglow-rec-pills';

    Object.keys(FORMAT_CONFIGS).forEach((fmtKey) => {
      const cfg = FORMAT_CONFIGS[fmtKey];
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = `cineglow-rec-pill ${currentFormat === fmtKey ? 'active' : ''}`;

      const nameEl = document.createElement('span');
      nameEl.className = 'pill-name';
      nameEl.textContent = cfg.label;
      const subEl = document.createElement('span');
      subEl.className = 'pill-sub';
      subEl.textContent = fmtKey === 'mp4' ? 'H.264 (Mac/Win)' : (fmtKey === 'mkv' ? 'Matroska' : 'VP9 / Opus');

      pill.appendChild(nameEl);
      pill.appendChild(subEl);

      pill.addEventListener('click', async (e) => {
        e.stopPropagation();
        currentFormat = fmtKey;
        await chrome.storage?.sync?.set({ recordFormat: fmtKey }).catch(() => {});
        updateButtonVisuals();
        showToast(`Format set to ${cfg.label} (${currentFps} FPS)`, player);
        closeRecMenu();
      }, { signal: menuAbortController.signal });

      pillsRow.appendChild(pill);
    });
    sec1.appendChild(pillsRow);
    menu.appendChild(sec1);

    const sec2 = document.createElement('div');
    sec2.className = 'cineglow-rec-section';
    const label2 = document.createElement('div');
    label2.className = 'cineglow-rec-label';
    label2.textContent = 'Capture Smoothness';
    sec2.appendChild(label2);

    const fpsRow = document.createElement('div');
    fpsRow.className = 'cineglow-rec-fps-pills';

    [
      { fps: 60, title: '60 FPS (Ultra Smooth)' },
      { fps: 30, title: '30 FPS (Standard)' }
    ].forEach((opt) => {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = `cineglow-rec-fps-pill ${currentFps === opt.fps ? 'active' : ''}`;
      pill.textContent = opt.title;

      pill.addEventListener('click', async (e) => {
        e.stopPropagation();
        currentFps = opt.fps;
        await chrome.storage?.sync?.set({ recordFps: opt.fps }).catch(() => {});
        updateButtonVisuals();
        showToast(`Frame rate set to ${opt.fps} FPS (${currentFormat.toUpperCase()})`, player);
        closeRecMenu();
      }, { signal: menuAbortController.signal });

      fpsRow.appendChild(pill);
    });
    sec2.appendChild(fpsRow);
    menu.appendChild(sec2);

    const hint = document.createElement('div');
    hint.className = 'cineglow-rec-hint';
    hint.textContent = 'MP4 works natively in QuickTime, Safari & Windows. MKV is ideal for VLC & IINA.';
    menu.appendChild(hint);

    const toolbar = anchorBtn.closest('.cineglow-floating-toolbar') || player;
    toolbar.appendChild(menu);
    toolbar.classList.add('cineglow-menu-open');
    toolbar.classList.remove('cineglow-toolbar-hidden');
    activeMenu = menu;

    queueMicrotask(() => {
      if (activeMenu === menu && menuAbortController) {
        document.addEventListener('click', (e) => {
          if (!menu.contains(e.target) && !anchorBtn.contains(e.target)) {
            closeRecMenu();
          }
        }, { signal: menuAbortController.signal });
      }
    });
  }

  function readVint(buf, offset) {
    const b = buf[offset];
    if (b === undefined) return null;
    let len = 1;
    let mask = 0x80;
    while (len <= 8 && !(b & mask)) {
      len++;
      mask >>= 1;
    }
    if (len > 8) return null;
    let val = b & (mask - 1);
    for (let i = 1; i < len; i++) {
      val = (val * 256) + buf[offset + i];
    }
    return { len, val };
  }

  function writeVint(val) {
    let len = 1;
    let maxVal = 0x7E;
    let flag = 0x80;
    while (val > maxVal && len < 8) {
      len++;
      flag *= 0x80;
      maxVal = (maxVal * 0x80) + 0x7F;
    }
    const out = new Uint8Array(len);
    let v = flag + val;
    for (let i = len - 1; i >= 0; i--) {
      out[i] = v % 256;
      v = Math.floor(v / 256);
    }
    return out;
  }

  async function fixDurationAndFormat(blob, durationMs, targetFormat) {
    try {
      const headerSliceSize = Math.min(blob.size, 65536);
      const headerBuf = await blob.slice(0, headerSliceSize).arrayBuffer();
      const u8 = new Uint8Array(headerBuf);

      if (u8.length < 32 || u8[0] !== 0x1a || u8[1] !== 0x45 || u8[2] !== 0xdf || u8[3] !== 0xa3) {
        return blob;
      }

      let infoOffset = -1;
      for (let i = 0; i < u8.length - 4; i++) {
        if (u8[i] === 0x15 && u8[i + 1] === 0x49 && u8[i + 2] === 0xa9 && u8[i + 3] === 0x66) {
          infoOffset = i;
          break;
        }
      }
      if (infoOffset === -1) return blob;

      const infoSizeVint = readVint(u8, infoOffset + 4);
      if (!infoSizeVint) return blob;

      const infoDataStart = infoOffset + 4 + infoSizeVint.len;
      const infoDataEnd = infoDataStart + infoSizeVint.val;
      if (infoDataEnd > u8.length) return blob;

      let timecodeScaleNs = 1000000;
      for (let j = infoDataStart; j < infoDataEnd - 4; j++) {
        if (u8[j] === 0x2a && u8[j + 1] === 0xd7 && u8[j + 2] === 0xb1) {
          const v = readVint(u8, j + 3);
          if (v && j + 3 + v.len + v.val <= infoDataEnd) {
            let scale = 0;
            for (let k = 0; k < v.val; k++) {
              scale = (scale * 256) + u8[j + 3 + v.len + k];
            }
            if (scale > 0) timecodeScaleNs = scale;
          }
          break;
        }
      }

      const durationVal = (durationMs * 1000000) / timecodeScaleNs;

      const durTag = new Uint8Array(11);
      durTag[0] = 0x44;
      durTag[1] = 0x89;
      durTag[2] = 0x88;
      new DataView(durTag.buffer).setFloat64(3, durationVal, false);

      let existingDurPos = -1;
      let existingDurLen = 0;
      for (let j = infoDataStart; j < infoDataEnd - 2; j++) {
        if (u8[j] === 0x44 && u8[j + 1] === 0x89) {
          const v = readVint(u8, j + 2);
          if (v) {
            existingDurPos = j;
            existingDurLen = 2 + v.len + v.val;
            break;
          }
        }
      }

      let newInfoData;
      if (existingDurPos !== -1) {
        const before = u8.slice(infoDataStart, existingDurPos);
        const after = u8.slice(existingDurPos + existingDurLen, infoDataEnd);
        newInfoData = new Uint8Array(before.length + durTag.length + after.length);
        newInfoData.set(before, 0);
        newInfoData.set(durTag, before.length);
        newInfoData.set(after, before.length + durTag.length);
      } else {
        const cur = u8.slice(infoDataStart, infoDataEnd);
        newInfoData = new Uint8Array(cur.length + durTag.length);
        newInfoData.set(cur, 0);
        newInfoData.set(durTag, cur.length);
      }

      const newInfoSizeVint = writeVint(newInfoData.length);
      let headerBeforeInfo = u8.slice(0, infoOffset + 4);

      const isMkv = targetFormat === 'mkv';
      if (isMkv) {
        for (let i = 4; i < Math.min(headerBeforeInfo.length - 8, 120); i++) {
          if (headerBeforeInfo[i] === 0x42 && headerBeforeInfo[i + 1] === 0x82) {
            const dLen = headerBeforeInfo[i + 2] & 0x7f;
            const dt = String.fromCharCode(...headerBeforeInfo.slice(i + 3, i + 3 + dLen));
            if (dt === 'webm') {
              const before = headerBeforeInfo.slice(0, i + 2);
              const after = headerBeforeInfo.slice(i + 3 + dLen);
              const matroska = new Uint8Array([0x88, 0x6d, 0x61, 0x74, 0x72, 0x6f, 0x73, 0x6b, 0x61]);
              const combined = new Uint8Array(before.length + matroska.length + after.length);
              combined.set(before, 0);
              combined.set(matroska, before.length);
              combined.set(after, before.length + matroska.length);
              if (combined[4] >= 0x80) {
                combined[4] = combined[4] + (matroska.length - (1 + dLen));
              }
              headerBeforeInfo = combined;
              break;
            }
          }
        }
      }

      const newHeader = new Uint8Array(headerBeforeInfo.length + newInfoSizeVint.length + newInfoData.length);
      let pos = 0;
      newHeader.set(headerBeforeInfo, pos); pos += headerBeforeInfo.length;
      newHeader.set(newInfoSizeVint, pos); pos += newInfoSizeVint.length;
      newHeader.set(newInfoData, pos);

      const mimeType = isMkv ? 'video/x-matroska' : 'video/webm';
      return new Blob([newHeader, blob.slice(infoDataEnd)], { type: mimeType });
    } catch (err) {
      console.warn('[CineGlow Record] Duration/Format injection fallback:', err);
      return blob;
    }
  }

  function cleanupAudioTap() {
    if (audioTapCleanup) {
      try { audioTapCleanup(); } catch (_) {}
      audioTapCleanup = null;
    }
  }

  function startRecording(video) {
    if (isKilled || window.CineGlowKilled) return;
    if (isRecordingDisabled) {
      removeExistingButton();
      return;
    }
    if (mediaRecorder?.state === 'recording') return;

    const maxW = 1920;
    const maxH = 1080;
    let targetW = video.videoWidth || 1920;
    let targetH = video.videoHeight || 1080;
    const scale = Math.min(1, maxW / targetW, maxH / targetH);
    targetW = Math.round(targetW * scale);
    targetH = Math.round(targetH * scale);
    if (targetW % 2 !== 0) targetW--;
    if (targetH % 2 !== 0) targetH--;

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });

    // On-demand frame capture (captureStream(0) + requestFrame()) avoids encoding duplicate/paused frames
    let canvasStream = null;
    let onDemandCapture = false;
    try {
      canvasStream = canvas.captureStream(0);
      onDemandCapture = typeof canvasStream?.getVideoTracks?.()[0]?.requestFrame === 'function';
    } catch (_) {
      try {
        canvasStream = canvas.captureStream(currentFps);
      } catch (e) {
        console.warn('[CineGlow Record] canvas.captureStream failed:', e);
      }
    }

    if (!canvasStream || canvasStream.getVideoTracks().length === 0) {
      const p = window.CineGlowPlayer?.player || document.getElementById('movie_player');
      showToast('Canvas recording is not supported in this browser', p);
      return;
    }

    const videoTrack = canvasStream.getVideoTracks()[0];
    const minFrameIntervalMs = 1000 / Math.max(1, currentFps);
    let lastFrameSentAt = 0;

    const pushCanvasFrame = (now = performance.now()) => {
      if (now - lastFrameSentAt < minFrameIntervalMs * 0.9) return;
      lastFrameSentAt = now;
      try {
        ctx.drawImage(video, 0, 0, targetW, targetH);
        if (onDemandCapture) videoTrack.requestFrame();
      } catch (_) {}
    };

    pushCanvasFrame(performance.now());

    let isDrawing = true;
    let rvfcHandle = null;
    let rafHandle = null;

    function renderFrame(now = performance.now()) {
      if (!isDrawing) return;
      if (video.readyState >= 2 && !video.paused) {
        pushCanvasFrame(now);
      }
      if ('requestVideoFrameCallback' in video) {
        rvfcHandle = video.requestVideoFrameCallback(renderFrame);
      } else {
        rafHandle = requestAnimationFrame(renderFrame);
      }
    }

    renderFrame();

    const pipeAc = new AbortController();
    video.addEventListener('play', () => { if (isDrawing) renderFrame(); }, { passive: true, signal: pipeAc.signal });
    video.addEventListener('playing', () => { if (isDrawing) renderFrame(); }, { passive: true, signal: pipeAc.signal });
    video.addEventListener('seeked', () => {
      if (isDrawing && video.readyState >= 2) {
        lastFrameSentAt = 0;
        pushCanvasFrame(performance.now());
      }
    }, { passive: true, signal: pipeAc.signal });

    canvasPipelineCleanup = () => {
      isDrawing = false;
      pipeAc.abort();
      if (rvfcHandle && 'cancelVideoFrameCallback' in video) {
        try { video.cancelVideoFrameCallback(rvfcHandle); } catch (_) {}
        rvfcHandle = null;
      }
      if (rafHandle) {
        cancelAnimationFrame(rafHandle);
        rafHandle = null;
      }
    };

    let audioTrack = null;
    try {
      const captureFn = typeof video.captureStream === 'function'
        ? video.captureStream.bind(video)
        : (typeof video.mozCaptureStream === 'function' ? video.mozCaptureStream.bind(video) : null);

      if (captureFn) {
        const rawStream = captureFn();
        rawStream.getVideoTracks().forEach((t) => t.stop());
        const aTracks = rawStream.getAudioTracks();
        if (aTracks.length > 0) {
          audioTrack = aTracks[0];
        }
      }
    } catch (err) {
      console.warn('[CineGlow Record] Audio captureStream failed:', err);
    }

    if (!audioTrack && window.CineGlowAudioCtx && window.CineGlowAudioGainNode) {
      try {
        const gainNodeRef = window.CineGlowAudioGainNode;
        const dest = window.CineGlowAudioCtx.createMediaStreamDestination();
        gainNodeRef.connect(dest);
        const aTracks = dest.stream.getAudioTracks();
        if (aTracks.length > 0) {
          audioTrack = aTracks[0];
        }
        audioTapCleanup = () => {
          try { gainNodeRef.disconnect(dest); } catch (_) {}
          dest.stream.getTracks().forEach((t) => t.stop());
        };
      } catch (e) {
        console.warn('[CineGlow Record] Web Audio hook failed:', e);
      }
    }

    const combinedStream = new MediaStream();
    combinedStream.addTrack(videoTrack);
    if (audioTrack) {
      combinedStream.addTrack(audioTrack);
    }

    activeStream = combinedStream;
    activeRecordingFormat = currentFormat;
    activeRecordingFps = currentFps;

    const mimeType = selectMimeType(activeRecordingFormat);
    activeRecordedMimeType = mimeType;
    recordedChunks = [];

    const targetBitrate = activeRecordingFps === 60 ? 12000000 : 8000000;

    try {
      mediaRecorder = new MediaRecorder(combinedStream, {
        mimeType,
        videoBitsPerSecond: targetBitrate
      });
    } catch (_) {
      try {
        mediaRecorder = new MediaRecorder(combinedStream, { mimeType });
      } catch (_) {
        mediaRecorder = new MediaRecorder(combinedStream);
      }
    }

    if (mediaRecorder?.mimeType) {
      activeRecordedMimeType = mediaRecorder.mimeType;
    }

    let totalRecordedBytes = 0;
    const MAX_RECORDING_BYTES = 500 * 1024 * 1024;
    const MAX_RECORDING_SECONDS = 3600;

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        totalRecordedBytes += e.data.size;
        recordedChunks.push(e.data);

        if (totalRecordedBytes >= MAX_RECORDING_BYTES) {
          const p = window.CineGlowPlayer?.player || document.getElementById('movie_player');
          showToast('Memory ceiling reached (500MB). Auto-saving.', p);
          stopRecording();
        }
      }
    };

    mediaRecorder.onstop = () => {
      finalizeRecording();
    };

    mediaRecorder.start(1000);
    recordingStartTime = Date.now();
    updateButtonVisuals();
    updateHUD(0);

    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
      const badge = currentButton?.querySelector('.cineglow-record-badge');
      if (badge) badge.textContent = formatTime(elapsed);
      updateHUD(elapsed);

      if (elapsed >= MAX_RECORDING_SECONDS) {
        const p = window.CineGlowPlayer?.player || document.getElementById('movie_player');
        showToast('Max recording duration reached (60m). Auto-saving.', p);
        stopRecording();
      }
    }, 1000);
  }

  function stopRecording() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = 0;
    }
    if (canvasPipelineCleanup) {
      canvasPipelineCleanup();
      canvasPipelineCleanup = null;
    }
    cleanupAudioTap();
    if (!mediaRecorder || mediaRecorder.state === 'inactive') return;
    try {
      mediaRecorder.stop();
    } catch (_) {}
    updateButtonVisuals();
  }

  async function finalizeRecording() {
    if (canvasPipelineCleanup) {
      canvasPipelineCleanup();
      canvasPipelineCleanup = null;
    }
    cleanupAudioTap();
    clearInterval(timerInterval);
    timerInterval = 0;

    if (activeStream) {
      activeStream.getTracks().forEach((t) => t.stop());
      activeStream = null;
    }

    if (recordedChunks.length === 0) {
      activeRecordingFormat = null;
      activeRecordingFps = null;
      hideHUD(null);
      return;
    }

    const effectiveMime = mediaRecorder?.mimeType || recordedChunks[0]?.type || activeRecordedMimeType;
    if (effectiveMime) {
      activeRecordedMimeType = effectiveMime;
    }

    const durationMs = Math.max(500, Date.now() - recordingStartTime);
    const durationSec = Math.round(durationMs / 1000);
    const ext = deriveContainerExtension(activeRecordedMimeType, activeRecordingFormat);

    const finalBlob = ext === 'mp4'
      ? new Blob(recordedChunks, { type: activeRecordedMimeType || 'video/mp4' })
      : await fixDurationAndFormat(
          new Blob(recordedChunks, { type: activeRecordedMimeType || 'video/webm' }),
          durationMs,
          ext
        );
    recordedChunks = [];

    const sizeMB = (finalBlob.size / (1024 * 1024)).toFixed(1);
    const filename = getRecordingFilename(document.title || 'YouTube', durationSec, ext);

    const url = URL.createObjectURL(finalBlob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();

    setTimeout(() => {
      a.remove();
      try { URL.revokeObjectURL(url); } catch (_) {}
    }, 1000);

    hideHUD(`Saved as ${ext.toUpperCase()} (${sizeMB} MB)`);
    activeRecordingFormat = null;
    activeRecordingFps = null;
  }

  function injectRecordButton(playerManager) {
    if (isKilled || window.CineGlowKilled || isRecordingDisabled || !playerManager) {
      removeExistingButton();
      return;
    }
    const { player, isWatchPage } = playerManager;
    if (!isWatchPage || !player) {
      removeExistingButton();
      return;
    }

    if (currentButton && player.contains(currentButton)) {
      return;
    }

    removeExistingButton();

    const toolbar = window.CineGlowToolbar?.getOrCreateToolbar?.(player) || (() => {
      let tb = player.querySelector('.cineglow-floating-toolbar');
      if (!tb) {
        tb = document.createElement('div');
        tb.className = 'cineglow-floating-toolbar cineglow-vertical-toolbar';
        player.appendChild(tb);
      }
      return tb;
    })();
    if (!toolbar || isKilled || isRecordingDisabled) return;

    toolbar.querySelectorAll(`.cineglow-record-wrapper, .${RECORD_BUTTON_CLASS}`).forEach((el) => el.remove());

    const wrapper = document.createElement('div');
    wrapper.className = 'cineglow-record-wrapper';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `ytp-button ${RECORD_BUTTON_CLASS}`;
    btn.setAttribute('aria-label', 'Record Video Clip');

    const inner = document.createElement('div');
    inner.className = 'cineglow-record-inner';

    const xmlns = 'http://www.w3.org/2000/svg';
    const svgElem = document.createElementNS(xmlns, 'svg');
    svgElem.setAttribute('viewBox', '0 0 24 24');
    svgElem.setAttribute('width', '100%');
    svgElem.setAttribute('height', '100%');
    svgElem.setAttribute('class', 'cineglow-record-icon');

    const pathEl = document.createElementNS(xmlns, 'path');
    pathEl.setAttribute('class', 'cineglow-rec-svg-path');
    pathEl.setAttribute('d', CAM_SVG_PATH);
    pathEl.setAttribute('fill', 'currentColor');
    svgElem.appendChild(pathEl);

    const rectEl = document.createElementNS(xmlns, 'rect');
    rectEl.setAttribute('class', 'cineglow-rec-stop-rect');
    rectEl.setAttribute('x', '7');
    rectEl.setAttribute('y', '7');
    rectEl.setAttribute('width', '10');
    rectEl.setAttribute('height', '10');
    rectEl.setAttribute('rx', '2');
    rectEl.setAttribute('fill', '#ef4444');
    rectEl.style.display = 'none';
    svgElem.appendChild(rectEl);

    const cfg = FORMAT_CONFIGS[currentFormat] || FORMAT_CONFIGS.mkv;
    const badge = document.createElement('span');
    badge.className = 'cineglow-record-badge';
    renderBadgeLabel(badge, cfg.badge, true);
    badge.title = 'Click badge to change format & FPS';

    badge.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openRecMenu(btn, player);
    }, { signal });

    inner.appendChild(svgElem);
    inner.appendChild(badge);
    btn.appendChild(inner);

    const gearBtn = document.createElement('button');
    gearBtn.type = 'button';
    gearBtn.className = 'cineglow-rec-gear-btn';
    gearBtn.title = 'Recording Options (MP4, MKV, WebM, FPS)';

    const gearSvg = document.createElementNS(xmlns, 'svg');
    gearSvg.setAttribute('viewBox', '0 0 24 24');
    gearSvg.setAttribute('fill', 'currentColor');
    const gearPath = document.createElementNS(xmlns, 'path');
    gearPath.setAttribute('d', 'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z');
    gearSvg.appendChild(gearPath);
    const gearText = document.createElement('span');
    gearText.textContent = 'Options';
    gearBtn.appendChild(gearSvg);
    gearBtn.appendChild(gearText);

    gearBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openRecMenu(btn, player);
    }, { signal });

    wrapper.appendChild(btn);
    wrapper.appendChild(gearBtn);

    let longPressTimer = null;
    let isLongPress = false;

    btn.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      isLongPress = false;
      longPressTimer = setTimeout(() => {
        isLongPress = true;
        openRecMenu(btn, player);
      }, 420);
    }, { signal });

    const clearLongPress = () => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    };

    btn.addEventListener('pointerup', clearLongPress, { signal });
    btn.addEventListener('pointerleave', clearLongPress, { signal });
    btn.addEventListener('pointercancel', clearLongPress, { signal });

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (isLongPress) {
        isLongPress = false;
        return;
      }

      const video = window.CineGlowPlayer?.video || document.querySelector('video');
      if (!video) return;

      if (mediaRecorder?.state === 'recording') {
        stopRecording();
      } else {
        startRecording(video);
      }
    }, { signal });

    btn.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openRecMenu(btn, player);
    }, { signal });

    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openRecMenu(btn, player);
    }, { signal });

    const pipBtn = toolbar.querySelector('.cineglow-pip-button');
    if (pipBtn) {
      toolbar.insertBefore(wrapper, pipBtn);
    } else {
      toolbar.appendChild(wrapper);
    }

    currentButton = btn;
    currentWrapper = wrapper;
    updateButtonVisuals();
  }

  window.CineGlowRecorder = {
    FORMAT_CONFIGS,
    selectMimeType,
    deriveContainerExtension,
    sanitizeRecordingTitle,
    getRecordingFilename,
    startRecording,
    stopRecording,
    finalizeRecording,
    fixDurationAndFormat,
    getActiveRecordingFormat: () => activeRecordingFormat,
    getActiveRecordedMimeType: () => activeRecordedMimeType,
    setCurrentFormat: (fmt) => { currentFormat = fmt; },
    getCurrentFormat: () => currentFormat,
    setCurrentFps: (fps) => { currentFps = fps; },
    getCurrentFps: () => currentFps,
    setRecordedChunks: (chunks) => { recordedChunks = chunks; },
    setRecordingStartTime: (t) => { recordingStartTime = t; },
    setActiveRecordedMimeType: (m) => { activeRecordedMimeType = m; },
    setActiveRecordingFormat: (f) => { activeRecordingFormat = f; },
    isRecording: () => Boolean(mediaRecorder?.state === 'recording'),
    isRecordingDisabled: () => isRecordingDisabled,
    updateHUD,
    hideHUD,
    getHUDElement: () => hudEl,
    getHUDHost: () => hudHost,
    teardownKillSwitch
  };
  window.CineGlowRecord = window.CineGlowRecorder;

  function teardownKillSwitch() {
    if (isKilled) return;
    isKilled = true;
    window.CineGlowKilled = true;

    chrome.storage?.onChanged?.removeListener(handleStorageChange);
    lifecycle.abort();

    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = 0;
    }
    if (canvasPipelineCleanup) {
      canvasPipelineCleanup();
      canvasPipelineCleanup = null;
    }
    cleanupAudioTap();

    if (activeStream) {
      activeStream.getTracks().forEach((t) => t.stop());
      activeStream = null;
    }

    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      try {
        mediaRecorder.ondataavailable = null;
        mediaRecorder.onstop = null;
        mediaRecorder.stop();
      } catch (_) {}
      mediaRecorder = null;
    }
    recordedChunks = [];
    clearTimeout(toastTimeout);
    removeExistingButton();
  }

  chrome.runtime?.onMessage?.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'AURA_EMERGENCY_KILL_SWITCH') {
      teardownKillSwitch();
      if (!window._cineglowKillEventFired) {
        window._cineglowKillEventFired = true;
        window.dispatchEvent(new CustomEvent('cineglow:kill-switch', { detail: message }));
      }
      sendResponse?.({ success: true, script: 'record-button.js' });
    }
  });

  window.addEventListener('cineglow:kill-switch', teardownKillSwitch, { once: true });

  // Register player listener synchronously so no state-change events are missed while storage loads
  if (window.CineGlowPlayer) {
    window.CineGlowPlayer.addEventListener('state-change', (e) => {
      if (isKilled) return;
      const state = e.detail;
      if (state.isWatchPage && state.player) {
        if (!currentButton || !state.player.contains(currentButton)) {
          injectRecordButton(state);
        }
      } else {
        removeExistingButton();
      }
    }, { signal });
  }

  loadSettings().then(() => {
    if (!isKilled && !isRecordingDisabled && typeof window !== 'undefined' && window?.CineGlowPlayer) {
      injectRecordButton(window.CineGlowPlayer);
    }
  });
})();


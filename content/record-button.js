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

  let currentButton = null;
  let currentWrapper = null;
  let abortController = null;
  let mediaRecorder = null;
  let canvasPipelineCleanup = null;
  let recordedChunks = [];
  let recordingStartTime = 0;
  let timerInterval = 0;
  let activeStream = null;
  let activeRecordedMimeType = '';
  let hudEl = null;
  let activeMenu = null;
  let toastTimeout = 0;

  // Defaults: Genuine Matroska MKV at 30 FPS
  let currentFormat = 'mkv';
  let currentFps = 30;

  async function loadSettings() {
    try {
      const stored = await chrome.storage.sync.get({ recordFormat: 'mkv', recordFps: 30 });
      if (stored.recordFormat && FORMAT_CONFIGS[stored.recordFormat]) {
        currentFormat = stored.recordFormat;
      }
      if (stored.recordFps) {
        currentFps = Number(stored.recordFps) || 30;
      }
    } catch (_) {}
    updateButtonVisuals();
  }

  // Live storage sync
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync') {
      let changed = false;
      if (changes.recordFormat && FORMAT_CONFIGS[changes.recordFormat.newValue]) {
        currentFormat = changes.recordFormat.newValue;
        changed = true;
      }
      if (changes.recordFps) {
        currentFps = Number(changes.recordFps.newValue) || 60;
        changed = true;
      }
      if (changed) {
        updateButtonVisuals();
      }
    }
  });

  loadSettings();

  function removeExistingButton() {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      stopRecording();
    }
    closeRecMenu();
    document.querySelectorAll('.cineglow-record-wrapper, .' + RECORD_BUTTON_CLASS).forEach(el => el.remove());
    currentButton = null;
    currentWrapper = null;
    if (hudEl) {
      hudEl.remove();
      hudEl = null;
    }
  }

  function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  function updateButtonVisuals() {
    if (!currentButton) return;
    const isRecording = mediaRecorder && mediaRecorder.state === 'recording';
    const badge = currentButton.querySelector('.cineglow-record-badge');
    const svgPath = currentButton.querySelector('.cineglow-rec-svg-path');
    const rectIcon = currentButton.querySelector('.cineglow-rec-stop-rect');

    currentButton.classList.toggle('cineglow-recording', isRecording);

    if (isRecording) {
      if (svgPath) svgPath.style.display = 'none';
      if (rectIcon) rectIcon.style.display = 'block';
      currentButton.title = `Recording ${currentFormat.toUpperCase()} (${currentFps} FPS)... Click to stop & save`;
    } else {
      if (svgPath) svgPath.style.display = 'block';
      if (rectIcon) rectIcon.style.display = 'none';
      const cfg = FORMAT_CONFIGS[currentFormat] || FORMAT_CONFIGS.mkv;
      if (badge) {
        badge.innerHTML = `${cfg.badge}<span class="cineglow-rec-chevron">▾</span>`;
        badge.title = 'Click badge to change format & FPS';
      }
      currentButton.title = `Record Video (${currentFormat.toUpperCase()} • ${currentFps} FPS)\nClick icon to record • Click [${cfg.badge} ▾] or ⚙ Options for format settings`;
    }
  }

  function updateHUD(elapsedSec) {
    if (!hudEl) {
      const player = window.CineGlowPlayer ? window.CineGlowPlayer.player : document.getElementById('movie_player');
      if (player) {
        hudEl = document.createElement('div');
        hudEl.className = 'cineglow-rec-hud';
        player.appendChild(hudEl);
      }
    }
    if (hudEl) {
      const fmt = currentFormat.toUpperCase();
      hudEl.innerHTML = `
        <span class="cineglow-rec-dot"></span>
        <span class="cineglow-rec-hud-text">REC ${formatTime(elapsedSec)}</span>
        <span class="cineglow-rec-badge-tag">${fmt} • ${currentFps} FPS</span>
      `;
    }
  }

  function hideHUD(savedMsg) {
    if (hudEl) {
      if (savedMsg) {
        hudEl.innerHTML = `<span class="cineglow-rec-saved-text">${savedMsg}</span>`;
        setTimeout(() => {
          if (hudEl) {
            hudEl.remove();
            hudEl = null;
          }
        }, 2500);
      } else {
        hudEl.remove();
        hudEl = null;
      }
    }
  }

  function showToast(msg, player) {
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
    if (activeMenu) {
      const toolbar = activeMenu.closest('.cineglow-floating-toolbar');
      if (toolbar) toolbar.classList.remove('cineglow-menu-open');
      activeMenu.remove();
      activeMenu = null;
    }
  }

  function openRecMenu(anchorBtn, player) {
    if (activeMenu) {
      closeRecMenu();
      return;
    }

    const menu = document.createElement('div');
    menu.className = 'cineglow-rec-menu';

    // Header
    const header = document.createElement('div');
    header.className = 'cineglow-rec-header';
    header.innerHTML = `
      <div class="cineglow-rec-header-left">
        <svg class="cineglow-rec-header-icon" viewBox="0 0 24 24" fill="currentColor">
          <path d="${CAM_SVG_PATH}"/>
        </svg>
        <span>Recording Options</span>
      </div>
      <span class="cineglow-rec-current-badge">${currentFormat.toUpperCase()} • ${currentFps} FPS</span>
    `;
    menu.appendChild(header);

    // Section 1: Container Format
    const sec1 = document.createElement('div');
    sec1.className = 'cineglow-rec-section';
    const label1 = document.createElement('div');
    label1.className = 'cineglow-rec-label';
    label1.textContent = 'Container Format';
    sec1.appendChild(label1);

    const pillsRow = document.createElement('div');
    pillsRow.className = 'cineglow-rec-pills';

    Object.keys(FORMAT_CONFIGS).forEach(fmtKey => {
      const cfg = FORMAT_CONFIGS[fmtKey];
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = `cineglow-rec-pill ${currentFormat === fmtKey ? 'active' : ''}`;
      const sub = fmtKey === 'mp4' ? 'H.264 (Mac/Win)' : (fmtKey === 'mkv' ? 'Matroska' : 'VP9 / Opus');
      pill.innerHTML = `
        <span class="pill-name">${cfg.label}</span>
        <span class="pill-sub">${sub}</span>
      `;

      pill.addEventListener('click', async (e) => {
        e.stopPropagation();
        currentFormat = fmtKey;
        await chrome.storage.sync.set({ recordFormat: fmtKey });
        updateButtonVisuals();
        showToast(`Format set to ${cfg.label} (${currentFps} FPS)`, player);
        closeRecMenu();
      });

      pillsRow.appendChild(pill);
    });
    sec1.appendChild(pillsRow);
    menu.appendChild(sec1);

    // Section 2: Smoothness / FPS
    const sec2 = document.createElement('div');
    sec2.className = 'cineglow-rec-section';
    const label2 = document.createElement('div');
    label2.className = 'cineglow-rec-label';
    label2.textContent = 'Capture Smoothness';
    sec2.appendChild(label2);

    const fpsRow = document.createElement('div');
    fpsRow.className = 'cineglow-rec-fps-pills';

    const fpsOptions = [
      { fps: 60, title: '60 FPS (Ultra Smooth)' },
      { fps: 30, title: '30 FPS (Standard)' }
    ];

    fpsOptions.forEach(opt => {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = `cineglow-rec-fps-pill ${currentFps === opt.fps ? 'active' : ''}`;
      pill.textContent = opt.title;

      pill.addEventListener('click', async (e) => {
        e.stopPropagation();
        currentFps = opt.fps;
        await chrome.storage.sync.set({ recordFps: opt.fps });
        updateButtonVisuals();
        showToast(`Frame rate set to ${opt.fps} FPS (${currentFormat.toUpperCase()})`, player);
        closeRecMenu();
      });

      fpsRow.appendChild(pill);
    });
    sec2.appendChild(fpsRow);
    menu.appendChild(sec2);

    // Hint explaining MP4 and Mac compatibility
    const hint = document.createElement('div');
    hint.className = 'cineglow-rec-hint';
    hint.innerHTML = '💡 <b>MP4</b> is universal for <b>macOS QuickTime, Safari & Windows</b> with native duration. <b>MKV</b> is for <b>VLC & IINA</b>. <b>WebM</b> is standard native format.';
    menu.appendChild(hint);

    // Mount to floating toolbar
    const toolbar = anchorBtn.closest('.cineglow-floating-toolbar') || player;
    toolbar.appendChild(menu);
    toolbar.classList.add('cineglow-menu-open');
    toolbar.classList.remove('cineglow-toolbar-hidden');
    activeMenu = menu;

    const onOutsideClick = (e) => {
      if (!menu.contains(e.target) && !anchorBtn.contains(e.target)) {
        closeRecMenu();
        document.removeEventListener('click', onOutsideClick);
      }
    };
    setTimeout(() => {
      document.addEventListener('click', onOutsideClick);
    }, 0);
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

  /**
   * Reads EBML header, parses Segment -> Info container, injects exact
   * Duration tag (0x44 0x89) in 64-bit float, and sets DocType to 'matroska'
   * if targetFormat is 'mkv'.
   *
   * Operates via chunk slicing (only reads the first 64KB for headers),
   * preserving original streaming clusters with zero unnecessary memory re-allocation.
   */
  async function fixDurationAndFormat(blob, durationMs, targetFormat) {
    try {
      const headerSliceSize = Math.min(blob.size, 65536);
      const headerBuf = await blob.slice(0, headerSliceSize).arrayBuffer();
      const u8 = new Uint8Array(headerBuf);

      // Verify EBML Magic: 0x1A 0x45 0xDF 0xA3
      if (u8.length < 32 || u8[0] !== 0x1a || u8[1] !== 0x45 || u8[2] !== 0xdf || u8[3] !== 0xa3) {
        return blob;
      }

      // Locate Info container (0x15 0x49 0xa9 0x66)
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

      // Extract TimecodeScale (0x2A 0xD7 0xB1) inside Info if present
      let timecodeScaleNs = 1000000; // default 1,000,000 ns = 1 ms
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

      // Construct 64-bit IEEE 754 float Duration tag (0x44 0x89)
      const durTag = new Uint8Array(11);
      durTag[0] = 0x44;
      durTag[1] = 0x89;
      durTag[2] = 0x88; // 8 bytes float data
      const view = new DataView(durTag.buffer);
      view.setFloat64(3, durationVal, false); // big-endian

      // Check if Duration (0x44 0x89) already exists inside Info
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

      const isMkv = (targetFormat === 'mkv');
      if (isMkv) {
        // Rewrite DocType from 'webm' to 'matroska'
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
      const remainderBlob = blob.slice(infoDataEnd);
      return new Blob([newHeader, remainderBlob], { type: mimeType });
    } catch (err) {
      console.warn('[CineGlow Record] Duration/Format injection fallback:', err);
      return blob;
    }
  }

  function startRecording(video) {
    if (mediaRecorder && mediaRecorder.state === 'recording') return;

    // 1. Calculate scaled capture dimensions (up to 1080p, maintaining aspect ratio)
    // Capping at 1080p prevents hardware/software encoder choke on 4K/8K YouTube streams!
    const maxW = 1920;
    const maxH = 1080;
    let targetW = video.videoWidth || 1920;
    let targetH = video.videoHeight || 1080;
    const scale = Math.min(1, maxW / targetW, maxH / targetH);
    targetW = Math.round(targetW * scale);
    targetH = Math.round(targetH * scale);

    // Video encoders strictly require even dimensions
    if (targetW % 2 !== 0) targetW--;
    if (targetH % 2 !== 0) targetH--;

    // 2. Offscreen 2D canvas pipeline
    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });

    // Immediate initial draw
    try {
      ctx.drawImage(video, 0, 0, targetW, targetH);
    } catch (_) {}

    // 3. Continuous frame drawing loop:
    // Uses requestVideoFrameCallback (frame-accurate sync with YouTube decoder)
    // with requestAnimationFrame fallback so frames never stall!
    let isDrawing = true;
    let rvfcHandle = null;
    let rafHandle = null;

    function renderFrame() {
      if (!isDrawing) return;
      if (video.readyState >= 2 && !video.paused) {
        try {
          ctx.drawImage(video, 0, 0, targetW, targetH);
        } catch (_) {}
      }

      if ('requestVideoFrameCallback' in video) {
        rvfcHandle = video.requestVideoFrameCallback(renderFrame);
      } else {
        rafHandle = requestAnimationFrame(renderFrame);
      }
    }

    renderFrame();

    // Event listeners to ensure draw loop runs when video plays or seeks
    const onVideoPlay = () => {
      if (isDrawing) {
        renderFrame();
      }
    };
    const onVideoSeeked = () => {
      if (isDrawing && video.readyState >= 2) {
        try {
          ctx.drawImage(video, 0, 0, targetW, targetH);
        } catch (_) {}
      }
    };

    video.addEventListener('play', onVideoPlay);
    video.addEventListener('playing', onVideoPlay);
    video.addEventListener('seeked', onVideoSeeked);

    canvasPipelineCleanup = () => {
      isDrawing = false;
      if (rvfcHandle && 'cancelVideoFrameCallback' in video) {
        video.cancelVideoFrameCallback(rvfcHandle);
        rvfcHandle = null;
      }
      if (rafHandle) {
        cancelAnimationFrame(rafHandle);
        rafHandle = null;
      }
      video.removeEventListener('play', onVideoPlay);
      video.removeEventListener('playing', onVideoPlay);
      video.removeEventListener('seeked', onVideoSeeked);
    };

    // 4. Capture canvas stream at target FPS
    let canvasStream = null;
    try {
      canvasStream = canvas.captureStream(currentFps);
    } catch (e) {
      console.warn('[CineGlow Record] canvas.captureStream failed:', e);
    }

    if (!canvasStream || canvasStream.getVideoTracks().length === 0) {
      alert('Cannot record: Canvas stream capture is not supported by your browser.');
      if (canvasPipelineCleanup) canvasPipelineCleanup();
      return;
    }

    // 5. Extract audio track from video captureStream or Web Audio hook
    let audioTrack = null;
    try {
      if (typeof video.captureStream === 'function') {
        const rawStream = video.captureStream();
        const aTracks = rawStream.getAudioTracks();
        if (aTracks.length > 0) {
          audioTrack = aTracks[0];
        }
      } else if (typeof video.mozCaptureStream === 'function') {
        const rawStream = video.mozCaptureStream();
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
        const dest = window.CineGlowAudioCtx.createMediaStreamDestination();
        window.CineGlowAudioGainNode.connect(dest);
        const aTracks = dest.stream.getAudioTracks();
        if (aTracks.length > 0) {
          audioTrack = aTracks[0];
        }
      } catch (e) {
        console.warn('[CineGlow Record] Web Audio hook failed:', e);
      }
    }

    // 6. Assemble clean combined stream: strictly place Video as track 0!
    const combinedStream = new MediaStream();
    const videoTrack = canvasStream.getVideoTracks()[0];
    combinedStream.addTrack(videoTrack);

    if (audioTrack) {
      combinedStream.addTrack(audioTrack);
    }

    activeStream = combinedStream;

    // 7. Pick best supported MIME type for target format
    let mimeType = '';
    if (currentFormat === 'mp4') {
      const mp4Candidates = [
        'video/mp4;codecs=avc1,mp4a.40.2',
        'video/mp4;codecs=avc1',
        'video/mp4'
      ];
      for (const t of mp4Candidates) {
        if (MediaRecorder.isTypeSupported(t)) {
          mimeType = t;
          break;
        }
      }
    } else if (currentFormat === 'mkv') {
      const mkvCandidates = [
        'video/x-matroska;codecs=avc1',
        'video/x-matroska;codecs=vp9,opus',
        'video/x-matroska',
        'video/webm;codecs=vp9,opus'
      ];
      for (const t of mkvCandidates) {
        if (MediaRecorder.isTypeSupported(t)) {
          mimeType = t;
          break;
        }
      }
    } else {
      const webmCandidates = [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm;codecs=h264,opus',
        'video/webm'
      ];
      for (const t of webmCandidates) {
        if (MediaRecorder.isTypeSupported(t)) {
          mimeType = t;
          break;
        }
      }
    }

    if (!mimeType) {
      const fallbacks = [
        'video/mp4;codecs=avc1,mp4a.40.2',
        'video/webm;codecs=vp9,opus',
        'video/webm'
      ];
      for (const t of fallbacks) {
        if (MediaRecorder.isTypeSupported(t)) {
          mimeType = t;
          break;
        }
      }
    }

    if (!mimeType) {
      mimeType = 'video/webm';
    }

    activeRecordedMimeType = mimeType;
    recordedChunks = [];

    // 12 Mbps for 60fps, 8 Mbps for 30fps
    const targetBitrate = currentFps === 60 ? 12000000 : 8000000;

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

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        recordedChunks.push(e.data);
      }
    };

    mediaRecorder.onstop = () => {
      finalizeRecording();
    };

    // 1000ms chunk slices prevent memory buffer bottlenecks
    mediaRecorder.start(1000);
    recordingStartTime = Date.now();
    updateButtonVisuals();
    updateHUD(0);

    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
      const badge = currentButton ? currentButton.querySelector('.cineglow-record-badge') : null;
      if (badge) badge.textContent = formatTime(elapsed);
      updateHUD(elapsed);
    }, 1000);
  }

  function stopRecording() {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') return;
    if (canvasPipelineCleanup) {
      canvasPipelineCleanup();
      canvasPipelineCleanup = null;
    }
    clearInterval(timerInterval);
    timerInterval = 0;
    try {
      mediaRecorder.stop();
    } catch (e) {}
    updateButtonVisuals();
  }

  async function finalizeRecording() {
    if (canvasPipelineCleanup) {
      canvasPipelineCleanup();
      canvasPipelineCleanup = null;
    }
    clearInterval(timerInterval);
    timerInterval = 0;

    if (activeStream) {
      activeStream.getTracks().forEach(t => t.stop());
      activeStream = null;
    }

    if (recordedChunks.length === 0) {
      hideHUD(null);
      return;
    }

    const durationMs = Math.max(500, Date.now() - recordingStartTime);
    const durationSec = Math.round(durationMs / 1000);
    const title = (document.title || 'YouTube').replace(/ - YouTube$/, '').replace(/[\\/:*?"<>|]/g, '');

    const isMp4 = (currentFormat === 'mp4' && activeRecordedMimeType.includes('mp4'));
    const isMkv = (currentFormat === 'mkv' || (!isMp4 && currentFormat !== 'webm'));
    const ext = isMp4 ? 'mp4' : (isMkv ? 'mkv' : 'webm');

    let finalBlob;
    if (isMp4) {
      // Native MP4 encoded by Chrome contains complete ISO BMFF container metadata & native duration!
      finalBlob = new Blob(recordedChunks, { type: activeRecordedMimeType || 'video/mp4' });
    } else {
      // WebM or MKV: inject exact EBML duration metadata and rewrite container DocType
      const rawBlob = new Blob(recordedChunks, { type: activeRecordedMimeType || 'video/webm' });
      finalBlob = await fixDurationAndFormat(rawBlob, durationMs, ext);
    }
    recordedChunks = [];

    const sizeMB = (finalBlob.size / (1024 * 1024)).toFixed(1);

    const url = URL.createObjectURL(finalBlob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = `Recording_${title}_${durationSec}s.${ext}`;
    document.body.appendChild(a);
    a.click();

    setTimeout(() => {
      if (a.parentNode) a.parentNode.removeChild(a);
      window.URL.revokeObjectURL(url);
    }, 1000);

    hideHUD(`✅ Saved as ${ext.toUpperCase()}! (${sizeMB} MB)`);
  }

  function initToolbarAutohide(player, toolbar) {
    if (toolbar._autohideInitialized) return;
    toolbar._autohideInitialized = true;

    let hideTimeout = 0;

    const syncVisibility = () => {
      // NEVER hide if hovered, focused, or if any menu is open
      const isHovered = toolbar.matches(':hover') || toolbar.querySelector(':hover');
      const isMenuOpen = toolbar.classList.contains('cineglow-menu-open') || 
                         toolbar.querySelector('.cineglow-rec-menu, .cineglow-speed-menu');
      const isFocused = toolbar.matches(':focus-within');

      if (isHovered || isMenuOpen || isFocused) {
        toolbar.classList.remove('cineglow-toolbar-hidden');
        return;
      }

      const isAutohide = player.classList.contains('ytp-autohide') || 
                         player.classList.contains('ytp-hide-controls');
      const chromeBottom = player.querySelector('.ytp-chrome-bottom');
      const isChromeHidden = chromeBottom && (
        chromeBottom.hidden ||
        chromeBottom.style.display === 'none' ||
        chromeBottom.classList.contains('ytp-chrome-hidden')
      );

      if (isAutohide || isChromeHidden) {
        toolbar.classList.add('cineglow-toolbar-hidden');
      } else {
        toolbar.classList.remove('cineglow-toolbar-hidden');
      }
    };

    const observer = new MutationObserver(() => syncVisibility());
    observer.observe(player, { attributes: true, attributeFilter: ['class'] });

    const chromeBottom = player.querySelector('.ytp-chrome-bottom');
    if (chromeBottom) {
      observer.observe(chromeBottom, { attributes: true, attributeFilter: ['style', 'class'] });
    }

    toolbar.addEventListener('mouseenter', () => {
      toolbar.classList.remove('cineglow-toolbar-hidden');
    });

    toolbar.addEventListener('mousemove', () => {
      toolbar.classList.remove('cineglow-toolbar-hidden');
    });

    toolbar.addEventListener('mouseleave', () => {
      clearTimeout(hideTimeout);
      hideTimeout = setTimeout(syncVisibility, 200);
    });

    player.addEventListener('mouseenter', () => {
      toolbar.classList.remove('cineglow-toolbar-hidden');
    });

    player.addEventListener('mousemove', () => {
      toolbar.classList.remove('cineglow-toolbar-hidden');
    });

    syncVisibility();
  }

  function waitForFloatingToolbar(player, signal) {
    return new Promise((resolve) => {
      const getToolbar = () => {
        let toolbar = player.querySelector('.cineglow-floating-toolbar');
        if (toolbar) return toolbar;

        toolbar = document.createElement('div');
        toolbar.className = 'cineglow-floating-toolbar cineglow-vertical-toolbar';
        player.appendChild(toolbar);
        initToolbarAutohide(player, toolbar);
        return toolbar;
      };

      const existing = getToolbar();
      if (existing) {
        resolve(existing);
        return;
      }

      const observer = new MutationObserver(() => {
        const el = getToolbar();
        if (el) {
          observer.disconnect();
          resolve(el);
        }
      });

      signal.addEventListener('abort', () => {
        observer.disconnect();
        resolve(null);
      }, { once: true });

      observer.observe(player, { childList: true, subtree: true });
    });
  }

  async function injectRecordButton(playerManager) {
    const { player, isWatchPage } = playerManager;

    if (abortController) {
      abortController.abort();
    }
    abortController = new AbortController();
    const signal = abortController.signal;

    if (!isWatchPage || !player) {
      removeExistingButton();
      return;
    }

    if (currentButton && player.contains(currentButton)) {
      return;
    }

    removeExistingButton();

    const toolbar = await waitForFloatingToolbar(player, signal);
    if (!toolbar || signal.aborted) return;

    // Purge any existing or duplicate record buttons/wrappers
    toolbar.querySelectorAll('.cineglow-record-wrapper, .' + RECORD_BUTTON_CLASS).forEach(el => el.remove());

    const wrapper = document.createElement('div');
    wrapper.className = 'cineglow-record-wrapper';

    const btn = document.createElement('button');
    btn.className = `ytp-button ${RECORD_BUTTON_CLASS}`;
    btn.setAttribute('aria-label', 'Record Video Clip');

    const inner = document.createElement('div');
    inner.className = 'cineglow-record-inner';

    const xmlns = 'http://www.w3.org/2000/svg';
    const svgElem = document.createElementNS(xmlns, 'svg');
    svgElem.setAttributeNS(null, 'viewBox', '0 0 24 24');
    svgElem.setAttributeNS(null, 'width', '100%');
    svgElem.setAttributeNS(null, 'height', '100%');
    svgElem.className.baseVal = 'cineglow-record-icon';

    // Camera path
    const pathEl = document.createElementNS(xmlns, 'path');
    pathEl.setAttributeNS(null, 'class', 'cineglow-rec-svg-path');
    pathEl.setAttributeNS(null, 'd', CAM_SVG_PATH);
    pathEl.setAttributeNS(null, 'fill', 'currentColor');
    svgElem.appendChild(pathEl);

    // Stop rect (hidden initially)
    const rectEl = document.createElementNS(xmlns, 'rect');
    rectEl.setAttributeNS(null, 'class', 'cineglow-rec-stop-rect');
    rectEl.setAttributeNS(null, 'x', '7');
    rectEl.setAttributeNS(null, 'y', '7');
    rectEl.setAttributeNS(null, 'width', '10');
    rectEl.setAttributeNS(null, 'height', '10');
    rectEl.setAttributeNS(null, 'rx', '2');
    rectEl.setAttributeNS(null, 'fill', '#ef4444');
    rectEl.style.display = 'none';
    svgElem.appendChild(rectEl);

    const cfg = FORMAT_CONFIGS[currentFormat] || FORMAT_CONFIGS.mkv;
    const badge = document.createElement('span');
    badge.className = 'cineglow-record-badge';
    badge.innerHTML = `${cfg.badge}<span class="cineglow-rec-chevron">▾</span>`;
    badge.title = 'Click badge to change format & FPS';

    // Left-click on badge directly opens the options menu!
    badge.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openRecMenu(btn, player);
    });

    inner.appendChild(svgElem);
    inner.appendChild(badge);
    btn.appendChild(inner);

    // Slide-out quick gear button for trackpad / Mac users
    const gearBtn = document.createElement('button');
    gearBtn.type = 'button';
    gearBtn.className = 'cineglow-rec-gear-btn';
    gearBtn.title = 'Recording Options (MKV, WebM, FPS)';
    gearBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
      </svg>
      <span>Options</span>
    `;

    gearBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openRecMenu(btn, player);
    });

    wrapper.appendChild(btn);
    wrapper.appendChild(gearBtn);

    // Trackpad Long-Press (click & hold for 400ms opens menu)
    let longPressTimer = null;
    let isLongPress = false;

    btn.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      isLongPress = false;
      longPressTimer = setTimeout(() => {
        isLongPress = true;
        openRecMenu(btn, player);
      }, 420);
    });

    const clearLongPress = () => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    };

    btn.addEventListener('pointerup', clearLongPress);
    btn.addEventListener('pointerleave', clearLongPress);
    btn.addEventListener('pointercancel', clearLongPress);

    // Left click: start / stop (unless long-press fired)
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (isLongPress) {
        isLongPress = false;
        return;
      }

      const video = window.CineGlowPlayer ? window.CineGlowPlayer.video : document.querySelector('video');
      if (!video) return;

      if (mediaRecorder && mediaRecorder.state === 'recording') {
        stopRecording();
      } else {
        startRecording(video);
      }
    });

    // Double click: open menu
    btn.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openRecMenu(btn, player);
    });

    // Right click / Control+click: open menu
    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openRecMenu(btn, player);
    });

    // In stack: Record button goes before PiP button (order: 2)
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

  // Listen to CineGlow player lifecycle
  if (window.CineGlowPlayer) {
    window.CineGlowPlayer.addEventListener('state-change', (e) => {
      const state = e.detail;
      if (state.isWatchPage && state.player) {
        if (!currentButton || !state.player.contains(currentButton)) {
          injectRecordButton(state);
        }
      } else {
        removeExistingButton();
      }
    });

    injectRecordButton(window.CineGlowPlayer);
  }
})();

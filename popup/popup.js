// Popup: reads/writes settings in chrome.storage.sync.
// The content script listens for storage changes, so updates apply live.

const SLIDER_KEYS = ['opacity', 'blur', 'spread', 'saturation', 'contrast', 'brightness', 'smoothness', 'fadeInDuration', 'videoBrightness', 'videoContrast', 'videoSepia'];

const enabledEl = document.getElementById('enabled');
const adblockEnabledEl = document.getElementById('adblockEnabled');
const audioNormalizerEl = document.getElementById('audioNormalizer');
const audioBoostEl = document.getElementById('audioBoost');
const audioBoostValEl = document.getElementById('audioBoostVal');
const qualityEnabledEl = document.getElementById('qualityEnabled');
const statsEnabledEl = document.getElementById('statsEnabled');
const adblockCountEl = document.getElementById('adblockCount');
const preferredQualityEl = document.getElementById('preferredQuality');
const blockAV1El = document.getElementById('blockAV1');
const blockVP9El = document.getElementById('blockVP9');
const block60fpsEl = document.getElementById('block60fps');
const hideScrollbarEl = document.getElementById('hideScrollbar');
const hideInTheaterEl = document.getElementById('hideInTheater');
const enableInPiPEl = document.getElementById('enableInPiP');
const removeBlackBarsEl = document.getElementById('removeBlackBars');
const audioReactiveEl = document.getElementById('audioReactive');
const lightsOutEl = document.getElementById('lightsOut');
const ultrawideZoomEl = document.getElementById('ultrawideZoom');
const glowTopEl = document.getElementById('glowTop');
const glowRightEl = document.getElementById('glowRight');
const glowBottomEl = document.getElementById('glowBottom');
const glowLeftEl = document.getElementById('glowLeft');
const fpsEl = document.getElementById('fps');
const autoPauseModeEl = document.getElementById('autoPauseMode');
const controlsEl = document.getElementById('controls');
const resetEl = document.getElementById('reset');
const masterStatusTag = document.getElementById('masterStatusTag');

function updateMasterStatus(enabled) {
  if (masterStatusTag) {
    masterStatusTag.textContent = enabled ? 'ACTIVE' : 'OFF';
    masterStatusTag.classList.toggle('disabled', !enabled);
  }
}

function setOutput(key, value) {
  const numInput = document.getElementById(`${key}-val`);
  if (numInput) numInput.value = value;
}

function render(settings) {
  enabledEl.checked = settings.enabled;
  updateMasterStatus(settings.enabled);
  adblockEnabledEl.checked = settings.adblockEnabled;
  if (autoPauseModeEl) autoPauseModeEl.value = settings.autoPauseMode || 'off';
  audioNormalizerEl.checked = settings.audioNormalizer;
  audioBoostEl.value = settings.audioBoost;
  audioBoostValEl.textContent = settings.audioBoost + '%';
  qualityEnabledEl.checked = settings.qualityEnabled;
  statsEnabledEl.checked = settings.statsEnabled;
  preferredQualityEl.value = settings.preferredQuality;
  blockAV1El.checked = settings.blockAV1;
  blockVP9El.checked = settings.blockVP9;
  block60fpsEl.checked = settings.block60fps;
  hideScrollbarEl.checked = settings.hideScrollbar;
  hideInTheaterEl.checked = settings.hideInTheater;
  enableInPiPEl.checked = settings.enableInPiP;
  removeBlackBarsEl.checked = settings.removeBlackBars;
  audioReactiveEl.checked = settings.audioReactive;
  lightsOutEl.checked = settings.lightsOut;
  ultrawideZoomEl.checked = settings.ultrawideZoom;
  glowTopEl.classList.toggle('active', settings.glowTop);
  glowRightEl.classList.toggle('active', settings.glowRight);
  glowBottomEl.classList.toggle('active', settings.glowBottom);
  glowLeftEl.classList.toggle('active', settings.glowLeft);
  adblockCountEl.textContent = settings.adblockCount;
  
  controlsEl.classList.toggle('disabled', !settings.enabled);
  for (const key of SLIDER_KEYS) {
    document.getElementById(key).value = settings[key];
    setOutput(key, settings[key]);
  }
  fpsEl.value = String(settings.fps);
}

async function save(partial) {
  try {
    await chrome.storage.sync.set(partial);
  } catch (err) {
    console.error('[Aura] Failed to save settings:', err);
  }
}

// Throttle slider writes: storage.sync has a write quota (~120 writes/min).
const pending = {};
let flushTimer = 0;
function queueSave(key, value) {
  pending[key] = value;
  if (flushTimer) return;
  flushTimer = setTimeout(async () => {
    flushTimer = 0;
    const batch = { ...pending };
    for (const k of Object.keys(pending)) delete pending[k];
    await save(batch);
  }, 120);
}

async function init() {
  let settings = { ...AURA_DEFAULTS };
  try {
    settings = { ...AURA_DEFAULTS, ...(await chrome.storage.sync.get(AURA_DEFAULTS)) };
  } catch (err) {
    console.error('[Aura] Failed to load settings:', err);
  }
  render(settings);

  // Keep counter updated if ads are blocked while popup is open
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.adblockCount) {
      adblockCountEl.textContent = changes.adblockCount.newValue;
    }
  });

  enabledEl.addEventListener('change', async () => {
    updateMasterStatus(enabledEl.checked);
    controlsEl.classList.toggle('disabled', !enabledEl.checked);
    await save({ enabled: enabledEl.checked });
  });

  // Category pill navigation
  document.querySelectorAll('.nav-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.nav-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      const targetId = pill.getAttribute('data-target');
      const section = document.getElementById(targetId);
      if (section) {
        section.open = true;
        section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
  });

  audioNormalizerEl.addEventListener('change', async () => {
    await save({ audioNormalizer: audioNormalizerEl.checked });
  });

  audioBoostEl.addEventListener('input', () => {
    audioBoostValEl.textContent = audioBoostEl.value + '%';
  });

  audioBoostEl.addEventListener('change', async () => {
    await save({ audioBoost: parseInt(audioBoostEl.value, 10) });
  });

  adblockEnabledEl.addEventListener('change', async () => {
    await save({ adblockEnabled: adblockEnabledEl.checked });
  });

  qualityEnabledEl.addEventListener('change', async () => {
    await save({ qualityEnabled: qualityEnabledEl.checked });
  });

  statsEnabledEl.addEventListener('change', async () => {
    await save({ statsEnabled: statsEnabledEl.checked });
  });

  if (autoPauseModeEl) {
    autoPauseModeEl.addEventListener('change', async () => {
      await save({ autoPauseMode: autoPauseModeEl.value });
    });
  }

  preferredQualityEl.addEventListener('change', async () => {
    await save({ preferredQuality: preferredQualityEl.value });
  });

  blockAV1El.addEventListener('change', async () => {
    await save({ blockAV1: blockAV1El.checked });
  });

  blockVP9El.addEventListener('change', async () => {
    await save({ blockVP9: blockVP9El.checked });
  });

  hideInTheaterEl.addEventListener('change', async () => {
    await save({ hideInTheater: hideInTheaterEl.checked });
  });

  hideScrollbarEl.addEventListener('change', async () => {
    await save({ hideScrollbar: hideScrollbarEl.checked });
  });

  enableInPiPEl.addEventListener('change', async () => {
    await save({ enableInPiP: enableInPiPEl.checked });
  });

  removeBlackBarsEl.addEventListener('change', async () => {
    await save({ removeBlackBars: removeBlackBarsEl.checked });
  });

  block60fpsEl.addEventListener('change', async () => {
    await save({ block60fps: block60fpsEl.checked });
  });

  audioReactiveEl.addEventListener('change', async () => {
    await save({ audioReactive: audioReactiveEl.checked });
  });

  lightsOutEl.addEventListener('change', async () => {
    await save({ lightsOut: lightsOutEl.checked });
  });

  ultrawideZoomEl.addEventListener('change', async () => {
    await save({ ultrawideZoom: ultrawideZoomEl.checked });
  });

  for (const dir of ['Top', 'Right', 'Bottom', 'Left']) {
    const el = document.getElementById('glow' + dir);
    el.addEventListener('click', async () => {
      const active = !el.classList.contains('active');
      el.classList.toggle('active', active);
      await save({ ['glow' + dir]: active });
    });
  }

  for (const key of SLIDER_KEYS) {
    const el = document.getElementById(key);
    const numEl = document.getElementById(`${key}-val`);
    
    // When range slider changes
    el.addEventListener('input', () => {
      const value = Number(el.value);
      setOutput(key, value);
      queueSave(key, value);
    });

    // When number input changes
    if (numEl) {
      numEl.addEventListener('change', () => {
        let value = Number(numEl.value);
        const min = Number(numEl.min);
        const max = Number(numEl.max);
        if (value < min) value = min;
        if (value > max) value = max;
        numEl.value = value;
        el.value = value;
        queueSave(key, value);
      });
    }
  }

  fpsEl.addEventListener('change', async () => {
    await save({ fps: Number(fpsEl.value) });
  });

  resetEl.addEventListener('click', async () => {
    // Preserve adblock count when resetting visual settings
    const currentCount = Number(adblockCountEl.textContent);
    const resetSettings = { ...AURA_DEFAULTS, adblockCount: currentCount };
    render(resetSettings);
    await save(resetSettings);
  });

  // Open external links reliably in a new tab
  document.querySelectorAll('a[href^="http"]').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
        chrome.tabs.create({ url: a.href });
      } else {
        window.open(a.href, '_blank', 'noopener,noreferrer');
      }
    });
  });
}

init();

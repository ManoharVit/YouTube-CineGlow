// Popup: reads/writes settings in chrome.storage.sync.
// The content script listens for storage changes, so updates apply live.

const SLIDER_KEYS = ['opacity', 'blur', 'spread', 'saturation', 'contrast', 'brightness', 'smoothness', 'fadeInDuration'];

const enabledEl = document.getElementById('enabled');
const adblockEnabledEl = document.getElementById('adblockEnabled');
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
const glowTopEl = document.getElementById('glowTop');
const glowRightEl = document.getElementById('glowRight');
const glowBottomEl = document.getElementById('glowBottom');
const glowLeftEl = document.getElementById('glowLeft');
const fpsEl = document.getElementById('fps');
const controlsEl = document.getElementById('controls');
const resetEl = document.getElementById('reset');

function setOutput(key, value) {
  const numInput = document.getElementById(`${key}-val`);
  if (numInput) numInput.value = value;
}

function render(settings) {
  enabledEl.checked = settings.enabled;
  adblockEnabledEl.checked = settings.adblockEnabled;
  qualityEnabledEl.checked = settings.qualityEnabled;
  statsEnabledEl.checked = settings.statsEnabled;
  preferredQualityEl.value = settings.preferredQuality;
  blockAV1El.checked = settings.blockAV1;
  blockVP9El.checked = settings.blockVP9;
  block60fpsEl.checked = settings.block60fps;
  hideScrollbarEl.checked = settings.hideScrollbar;
  hideInTheaterEl.checked = settings.hideInTheater;
  enableInPiPEl.checked = settings.enableInPiP;
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
    controlsEl.classList.toggle('disabled', !enabledEl.checked);
    await save({ enabled: enabledEl.checked });
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

  block60fpsEl.addEventListener('change', async () => {
    await save({ block60fps: block60fpsEl.checked });
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
}

init();

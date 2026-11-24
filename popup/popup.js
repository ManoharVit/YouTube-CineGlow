// Popup: reads/writes settings in chrome.storage.sync.
// The content script listens for storage changes, so updates apply live.

const SLIDER_KEYS = ['opacity', 'blur', 'spread', 'saturation', 'contrast', 'brightness', 'smoothness', 'fadeInDuration', 'videoBrightness', 'videoContrast', 'videoSepia'];

const enabledEl = document.getElementById('enabled');
const adblockEnabledEl = document.getElementById('adblockEnabled');
const audioNormalizerEl = document.getElementById('audioNormalizer');
const audioBoostEl = document.getElementById('audioBoost');
const audioBoostValEl = document.getElementById('audioBoostVal');
const bassBoostEl = document.getElementById('bassBoost');
const bassBoostValEl = document.getElementById('bassBoostVal');
const vocalBoostEl = document.getElementById('vocalBoost');
const vocalBoostValEl = document.getElementById('vocalBoostVal');

const eq60El = document.getElementById('eq60');
const eq60ValEl = document.getElementById('eq60Val');
const eq250El = document.getElementById('eq250');
const eq250ValEl = document.getElementById('eq250Val');
const eq1000El = document.getElementById('eq1000');
const eq1000ValEl = document.getElementById('eq1000Val');
const eq4000El = document.getElementById('eq4000');
const eq4000ValEl = document.getElementById('eq4000Val');
const eq12000El = document.getElementById('eq12000');
const eq12000ValEl = document.getElementById('eq12000Val');

const eqResetEl = document.getElementById('eqReset');
const eqPresetBtns = document.querySelectorAll('.audio-preset-pill');

const EQ_PRESETS = {
  flat:    { eq60: 0,  eq250: 0,  eq1000: 0,  eq4000: 0,  eq12000: 0 },
  bass:    { eq60: 6,  eq250: 4,  eq1000: 0,  eq4000: 0,  eq12000: 0 },
  vocal:   { eq60: -2, eq250: 0,  eq1000: 5,  eq4000: 3,  eq12000: 0 },
  rock:    { eq60: 4,  eq250: 2,  eq1000: -1, eq4000: 3,  eq12000: 4 },
  pop:     { eq60: 2,  eq250: 3,  eq1000: 4,  eq4000: 2,  eq12000: 1 },
  electro: { eq60: 6,  eq250: 3,  eq1000: -1, eq4000: 2,  eq12000: 4 }
};

const GLOW_PRESETS = {
  subtle:   { opacity: 50, spread: 100, smoothness: 70, blur: 30, saturation: 100, contrast: 100, brightness: 90 },
  balanced: { opacity: 75, spread: 150, smoothness: 60, blur: 40, saturation: 110, contrast: 100, brightness: 100 },
  vivid:    { opacity: 90, spread: 200, smoothness: 50, blur: 50, saturation: 130, contrast: 110, brightness: 105 }
};
const glowPresetBtns = document.querySelectorAll('.glow-preset-pill');

let activeManagedPolicies = null;

function applyManagedOverrides(targetSettings) {
  if (!activeManagedPolicies || typeof activeManagedPolicies !== 'object') return targetSettings;
  if (activeManagedPolicies.DisableAdBlock) {
    targetSettings.adblockEnabled = false;
  }
  if (activeManagedPolicies.DisableThirdPartyAPIs) {
    targetSettings.returnDislikes = false;
    targetSettings.restoreAnnotations = false;
  }
  if (activeManagedPolicies.ForceDefaultQuality) {
    targetSettings.preferredQuality = activeManagedPolicies.ForceDefaultQuality;
  }
  return targetSettings;
}

function syncManagedControlLocks() {
  const policies = activeManagedPolicies || {};
  if (adblockEnabledEl) {
    adblockEnabledEl.disabled = Boolean(policies.DisableAdBlock);
    adblockEnabledEl.title = policies.DisableAdBlock ? 'Managed by organization policy' : '';
  }
  if (returnDislikesEl) {
    returnDislikesEl.disabled = Boolean(policies.DisableThirdPartyAPIs);
    returnDislikesEl.title = policies.DisableThirdPartyAPIs ? 'Managed by organization policy' : '';
  }
  if (restoreAnnotationsEl) {
    restoreAnnotationsEl.disabled = Boolean(policies.DisableThirdPartyAPIs);
    restoreAnnotationsEl.title = policies.DisableThirdPartyAPIs ? 'Managed by organization policy' : '';
  }
  if (preferredQualityEl) {
    preferredQualityEl.disabled = Boolean(policies.ForceDefaultQuality);
    preferredQualityEl.title = policies.ForceDefaultQuality ? 'Managed by organization policy' : '';
  }
}

function updateActiveGlowPresetPill(activeKey) {
  glowPresetBtns.forEach((btn) => {
    const isActive = btn.getAttribute('data-preset') === activeKey;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
}

function checkMatchingGlowPreset() {
  const op = Number(document.getElementById('opacity')?.value);
  const sp = Number(document.getElementById('spread')?.value);
  const sm = Number(document.getElementById('smoothness')?.value);
  const bl = Number(document.getElementById('blur')?.value);
  const sa = Number(document.getElementById('saturation')?.value);
  const co = Number(document.getElementById('contrast')?.value);
  const br = Number(document.getElementById('brightness')?.value);

  for (const [key, p] of Object.entries(GLOW_PRESETS)) {
    if (p.opacity === op && p.spread === sp && p.smoothness === sm &&
        p.blur === bl && p.saturation === sa && p.contrast === co && p.brightness === br) {
      updateActiveGlowPresetPill(key);
      return;
    }
  }
  updateActiveGlowPresetPill('custom');
}

function formatDb(val) {
  const n = parseInt(val, 10) || 0;
  return n > 0 ? `+${n} dB` : `${n} dB`;
}

function updateActivePresetPill(activeKey) {
  eqPresetBtns.forEach((btn) => {
    const isActive = btn.getAttribute('data-preset') === activeKey;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
}

function checkMatchingPreset() {
  if (!eq60El) return;
  const current = {
    eq60: parseInt(eq60El.value, 10) || 0,
    eq250: parseInt(eq250El.value, 10) || 0,
    eq1000: parseInt(eq1000El.value, 10) || 0,
    eq4000: parseInt(eq4000El.value, 10) || 0,
    eq12000: parseInt(eq12000El.value, 10) || 0
  };
  for (const [key, preset] of Object.entries(EQ_PRESETS)) {
    if (preset.eq60 === current.eq60 &&
        preset.eq250 === current.eq250 &&
        preset.eq1000 === current.eq1000 &&
        preset.eq4000 === current.eq4000 &&
        preset.eq12000 === current.eq12000) {
      updateActivePresetPill(key);
      queueSave('eqPreset', key);
      return;
    }
  }
  updateActivePresetPill('custom');
  queueSave('eqPreset', 'custom');
}

const qualityEnabledEl = document.getElementById('qualityEnabled');
const statsEnabledEl = document.getElementById('statsEnabled');
const adblockCountEl = document.getElementById('adblockCount');
const sponsorBlockEnabledEl = document.getElementById('sponsorBlockEnabled');
const sponsorBlockModeEl = document.getElementById('sponsorBlockMode');
const sponsorBlockCountEl = document.getElementById('sponsorBlockCount');
const preferredQualityEl = document.getElementById('preferredQuality');
const blockAV1El = document.getElementById('blockAV1');
const blockVP9El = document.getElementById('blockVP9');
const block60fpsEl = document.getElementById('block60fps');
const hideScrollbarEl = document.getElementById('hideScrollbar');
const hideInTheaterEl = document.getElementById('hideInTheater');
const enableInPiPEl = document.getElementById('enableInPiP');
const removeBlackBarsEl = document.getElementById('removeBlackBars');
const audioReactiveEl = document.getElementById('audioReactive');
const screenXModeEl = document.getElementById('screenXMode');
const lightsOutEl = document.getElementById('lightsOut');
const lightsOutOpacityEl = document.getElementById('lightsOutOpacity');
const lightsOutOpacityValEl = document.getElementById('lightsOutOpacityVal');
const abLoopEnabledEl = document.getElementById('abLoopEnabled');
const ultrawideZoomEl = document.getElementById('ultrawideZoom');
const glowTopEl = document.getElementById('glowTop');
const glowRightEl = document.getElementById('glowRight');
const glowBottomEl = document.getElementById('glowBottom');
const glowLeftEl = document.getElementById('glowLeft');
const fpsEl = document.getElementById('fps');
const preferredSpeedEl = document.getElementById('preferredSpeed');
const preferredSpeedValEl = document.getElementById('preferredSpeedVal');
const autoPauseModeEl = document.getElementById('autoPauseMode');
const returnDislikesEl = document.getElementById('returnDislikes');
const hideShortsEl = document.getElementById('hideShorts');
const restoreAnnotationsEl = document.getElementById('restoreAnnotations');
const hideEndCardsEl = document.getElementById('hideEndCards');
const controlsEl = document.getElementById('controls');
const resetEl = document.getElementById('reset');
const masterStatusTag = document.getElementById('masterStatusTag');

const glowResetEl = document.getElementById('glowReset');
const videoResetEl = document.getElementById('videoReset');
const audioResetEl = document.getElementById('audioReset');
const toolsResetEl = document.getElementById('toolsReset');

const GLOW_KEYS = ['opacity', 'spread', 'smoothness', 'blur', 'saturation', 'contrast', 'brightness', 'fadeInDuration', 'glowTop', 'glowRight', 'glowBottom', 'glowLeft', 'enableInPiP', 'audioReactive', 'screenXMode', 'fps'];
const VIDEO_KEYS = ['qualityEnabled', 'preferredQuality', 'preferredSpeed', 'videoBrightness', 'videoContrast', 'videoSepia', 'removeBlackBars', 'ultrawideZoom', 'lightsOut', 'lightsOutOpacity'];
const AUDIO_KEYS = ['audioNormalizer', 'audioBoost', 'bassBoost', 'vocalBoost', 'eq60', 'eq250', 'eq1000', 'eq4000', 'eq12000', 'eqPreset'];
const TOOLS_KEYS = ['adblockEnabled', 'sponsorBlockEnabled', 'sponsorBlockMode', 'statsEnabled', 'abLoopEnabled', 'autoPauseMode', 'returnDislikes', 'hideShorts', 'restoreAnnotations', 'hideEndCards', 'hideInTheater', 'hideScrollbar', 'blockAV1', 'blockVP9', 'block60fps'];

async function save(partial) {
  try {
    await chrome.storage.sync.set(partial);
  } catch (err) {
    console.error('[Aura] Failed to save settings:', err);
  }
}

const pending = {};
let flushTimer = 0;
let lastFlushTime = 0;
const SYNC_THROTTLE_MS = 550;

function flushPendingNow() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = 0;
  }
  const keys = Object.keys(pending);
  if (keys.length === 0) return;
  lastFlushTime = Date.now();
  const batch = { ...pending };
  for (const k of keys) delete pending[k];
  save(batch);
}

function queueSave(key, value) {
  pending[key] = value;
  if (flushTimer) clearTimeout(flushTimer);

  const elapsed = Date.now() - lastFlushTime;
  const delay = elapsed >= SYNC_THROTTLE_MS ? 50 : (SYNC_THROTTLE_MS - elapsed);

  flushTimer = setTimeout(flushPendingNow, delay);
}

window.addEventListener('pagehide', flushPendingNow);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    flushPendingNow();
  }
});

function cancelPendingWrites(keys) {
  if (!keys) {
    for (const k of Object.keys(pending)) {
      delete pending[k];
    }
  } else {
    for (const k of keys) {
      delete pending[k];
    }
  }
  if (Object.keys(pending).length === 0 && flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = 0;
  }
}

async function resetSectionKeys(keys) {
  cancelPendingWrites(keys);
  let current = { ...AURA_DEFAULTS };
  try {
    current = { ...AURA_DEFAULTS, ...(await chrome.storage.sync.get(AURA_DEFAULTS)) };
  } catch (err) {
    console.warn('[CineGlow Popup] Error reading current storage during reset:', err);
  }
  const partial = {};
  for (const k of keys) {
    partial[k] = AURA_DEFAULTS[k];
  }
  applyManagedOverrides(partial);
  const merged = applyManagedOverrides({ ...current, ...partial });
  render(merged);
  await save(partial);
}

function formatSpeedDisplay(rate) {
  if (rate === 1) return '1.0×';
  if (Number.isInteger(rate)) return `${rate}.0×`;
  const rounded = Math.round(rate * 100) / 100;
  if (Math.round(rounded * 10) === rounded * 10) {
    return `${rounded.toFixed(1)}×`;
  }
  return `${rounded.toFixed(2)}×`;
}

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
  if (sponsorBlockEnabledEl) sponsorBlockEnabledEl.checked = Boolean(settings.sponsorBlockEnabled);
  if (sponsorBlockModeEl) sponsorBlockModeEl.value = settings.sponsorBlockMode || 'skip';
  if (sponsorBlockCountEl) sponsorBlockCountEl.textContent = settings.sponsorBlockCount ?? 0;
  if (autoPauseModeEl) autoPauseModeEl.value = settings.autoPauseMode || 'off';
  if (returnDislikesEl) returnDislikesEl.checked = Boolean(settings.returnDislikes);
  if (hideShortsEl) hideShortsEl.checked = Boolean(settings.hideShorts);
  if (restoreAnnotationsEl) restoreAnnotationsEl.checked = Boolean(settings.restoreAnnotations);
  if (hideEndCardsEl) hideEndCardsEl.checked = Boolean(settings.hideEndCards);
  if (preferredSpeedEl) {
    const spd = settings.preferredSpeed ?? 1.0;
    preferredSpeedEl.value = Math.min(Math.max(spd, 0.1), 2.0);
    if (preferredSpeedValEl) preferredSpeedValEl.textContent = formatSpeedDisplay(spd);
  }
  audioNormalizerEl.checked = settings.audioNormalizer;
  audioBoostEl.value = settings.audioBoost;
  audioBoostValEl.textContent = settings.audioBoost + '%';
  if (bassBoostEl) {
    bassBoostEl.value = settings.bassBoost || 0;
    bassBoostValEl.textContent = formatDb(settings.bassBoost);
  }
  if (vocalBoostEl) {
    vocalBoostEl.value = settings.vocalBoost || 0;
    vocalBoostValEl.textContent = formatDb(settings.vocalBoost);
  }
  if (eq60El) {
    eq60El.value = settings.eq60 || 0;
    eq60ValEl.textContent = formatDb(settings.eq60);
  }
  if (eq250El) {
    eq250El.value = settings.eq250 || 0;
    eq250ValEl.textContent = formatDb(settings.eq250);
  }
  if (eq1000El) {
    eq1000El.value = settings.eq1000 || 0;
    eq1000ValEl.textContent = formatDb(settings.eq1000);
  }
  if (eq4000El) {
    eq4000El.value = settings.eq4000 || 0;
    eq4000ValEl.textContent = formatDb(settings.eq4000);
  }
  if (eq12000El) {
    eq12000El.value = settings.eq12000 || 0;
    eq12000ValEl.textContent = formatDb(settings.eq12000);
  }
  updateActivePresetPill(settings.eqPreset || 'flat');
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
  if (screenXModeEl) screenXModeEl.checked = Boolean(settings.screenXMode);
  lightsOutEl.checked = settings.lightsOut;
  if (lightsOutOpacityEl) {
    lightsOutOpacityEl.value = settings.lightsOutOpacity ?? 85;
    if (lightsOutOpacityValEl) lightsOutOpacityValEl.textContent = (settings.lightsOutOpacity ?? 85) + '%';
  }
  if (abLoopEnabledEl) abLoopEnabledEl.checked = Boolean(settings.abLoopEnabled);
  ultrawideZoomEl.checked = settings.ultrawideZoom;
  glowTopEl.classList.toggle('active', settings.glowTop);
  glowRightEl.classList.toggle('active', settings.glowRight);
  glowBottomEl.classList.toggle('active', settings.glowBottom);
  glowLeftEl.classList.toggle('active', settings.glowLeft);
  glowTopEl.setAttribute('aria-pressed', settings.glowTop ? 'true' : 'false');
  glowRightEl.setAttribute('aria-pressed', settings.glowRight ? 'true' : 'false');
  glowBottomEl.setAttribute('aria-pressed', settings.glowBottom ? 'true' : 'false');
  glowLeftEl.setAttribute('aria-pressed', settings.glowLeft ? 'true' : 'false');
  adblockCountEl.textContent = settings.adblockCount;

  controlsEl.classList.toggle('disabled', !settings.enabled);
  for (const key of SLIDER_KEYS) {
    const el = document.getElementById(key);
    if (el) el.value = settings[key];
    setOutput(key, settings[key]);
  }
  fpsEl.value = String(settings.fps);
  checkMatchingGlowPreset();
}

function renderDeactivatedBanner() {
  const controls = document.getElementById('controls');
  if (controls) {
    controls.style.display = 'none';
  }
  let banner = document.getElementById('cineglow-killswitch-banner');
  if (!banner && typeof document !== 'undefined') {
    banner = document.createElement('div');
    banner.id = 'cineglow-killswitch-banner';
    banner.className = 'cineglow-deactivated-banner';
    banner.setAttribute('role', 'alert');
    banner.style.cssText = 'margin: 16px; padding: 16px; background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.4); border-radius: 8px; color: #fca5a5; font-size: 13px; line-height: 1.5; text-align: center; font-weight: 500;';
    banner.textContent = 'CineGlow Pro Disabled: Deactivated by enterprise policy or emergency kill-switch';
    const header = document.querySelector('.app-header');
    if (header?.parentNode) {
      header.parentNode.insertBefore(banner, header.nextSibling);
    } else if (document.body) {
      document.body.appendChild(banner);
    }
  }
  const masterTag = document.getElementById('masterStatusTag');
  if (masterTag) {
    masterTag.textContent = 'DISABLED';
    masterTag.classList.add('disabled');
  }
}

async function init() {
  let settings = { ...AURA_DEFAULTS };
  try {
    if (chrome.storage?.managed) {
      activeManagedPolicies = await chrome.storage.managed.get(null).catch(() => null);
    }
  } catch (_) {}

  let isKillSwitchActive = false;
  let localData = {};
  try {
    if (chrome.storage?.local) {
      localData = await chrome.storage.local.get(['auraKillSwitchActive', 'adblockCount', 'sponsorBlockCount']).catch(() => ({}));
      if (localData?.auraKillSwitchActive === true) {
        isKillSwitchActive = true;
      }
    }
    if (activeManagedPolicies && (activeManagedPolicies.KillSwitch === true || activeManagedPolicies.killSwitch === true)) {
      isKillSwitchActive = true;
    }
  } catch (_) {}

  if (isKillSwitchActive) {
    renderDeactivatedBanner();
    return;
  }

  try {
    settings = { ...AURA_DEFAULTS, ...(await chrome.storage.sync.get(AURA_DEFAULTS)) };
    if (typeof localData.adblockCount === 'number') {
      settings.adblockCount = localData.adblockCount;
    }
    if (typeof localData.sponsorBlockCount === 'number') {
      settings.sponsorBlockCount = localData.sponsorBlockCount;
    }
  } catch (err) {
    console.error('[Aura] Failed to load settings:', err);
  }

  applyManagedOverrides(settings);
  syncManagedControlLocks();
  render(settings);

  try {
    const versionPill = document.querySelector('.header-version-pill');
    const manifest = chrome.runtime?.getManifest?.();
    if (versionPill && manifest?.version) {
      versionPill.textContent = `v${manifest.version}`;
    }
  } catch (_) {}

  chrome.storage.onChanged.addListener((changes, area) => {
    if ((area === 'sync' || area === 'local') && changes.adblockCount) {
      adblockCountEl.textContent = changes.adblockCount.newValue;
    }
    if ((area === 'sync' || area === 'local') && changes.sponsorBlockCount && sponsorBlockCountEl) {
      sponsorBlockCountEl.textContent = changes.sponsorBlockCount.newValue;
    }
    if (area === 'sync') {
      if (changes.screenXMode && screenXModeEl) {
        screenXModeEl.checked = Boolean(changes.screenXMode.newValue);
      }
      if (changes.lightsOut && lightsOutEl) {
        lightsOutEl.checked = Boolean(changes.lightsOut.newValue);
      }
      if (changes.statsEnabled && statsEnabledEl) {
        statsEnabledEl.checked = Boolean(changes.statsEnabled.newValue);
      }
      if (changes.preferredSpeed && preferredSpeedEl && document.activeElement !== preferredSpeedEl) {
        const spd = Number(changes.preferredSpeed.newValue) || 1.0;
        preferredSpeedEl.value = Math.min(Math.max(spd, 0.1), 2.0);
        if (preferredSpeedValEl) preferredSpeedValEl.textContent = formatSpeedDisplay(spd);
      }
    }
    if (area === 'local' && changes.auraKillSwitchActive?.newValue === true) {
      renderDeactivatedBanner();
    }
    if (area === 'managed') {
      activeManagedPolicies = activeManagedPolicies || {};
      for (const [k, { newValue }] of Object.entries(changes)) {
        activeManagedPolicies[k] = newValue;
      }
      if (changes.KillSwitch?.newValue === true) {
        renderDeactivatedBanner();
        return;
      }
      syncManagedControlLocks();
      if (changes.DisableAdBlock?.newValue === true && adblockEnabledEl) {
        adblockEnabledEl.checked = false;
      }
      if (changes.DisableThirdPartyAPIs?.newValue === true) {
        if (returnDislikesEl) returnDislikesEl.checked = false;
        if (restoreAnnotationsEl) restoreAnnotationsEl.checked = false;
      }
      if (changes.ForceDefaultQuality?.newValue && preferredQualityEl) {
        preferredQualityEl.value = changes.ForceDefaultQuality.newValue;
      }
    }
  });

  enabledEl.addEventListener('change', async () => {
    updateMasterStatus(enabledEl.checked);
    controlsEl.classList.toggle('disabled', !enabledEl.checked);
    await save({ enabled: enabledEl.checked });
  });

  const navPills = document.querySelectorAll('.nav-pill');
  const sectionDropdowns = document.querySelectorAll('details.section-dropdown');

  function updateNavPillState(targetId) {
    navPills.forEach((pill) => {
      const match = pill.getAttribute('data-target') === targetId;
      pill.classList.toggle('active', match);
      if (match) {
        pill.setAttribute('aria-current', 'true');
      } else {
        pill.removeAttribute('aria-current');
      }
    });
  }

  navPills.forEach((pill) => {
    pill.addEventListener('click', () => {
      const targetId = pill.getAttribute('data-target');
      updateNavPillState(targetId);
      sectionDropdowns.forEach((sec) => {
        sec.open = sec.id === targetId;
      });
      document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  sectionDropdowns.forEach((sec) => {
    sec.addEventListener('toggle', () => {
      if (sec.open) {
        sectionDropdowns.forEach((other) => {
          if (other !== sec && other.open) other.open = false;
        });
        updateNavPillState(sec.id);
      } else {
        const anyOpen = Array.from(sectionDropdowns).find((s) => s.open);
        updateNavPillState(anyOpen ? anyOpen.id : null);
      }
    });
  });

  glowPresetBtns.forEach((btn) => {
    btn.addEventListener('click', async () => {
      const presetKey = btn.getAttribute('data-preset');
      const preset = GLOW_PRESETS[presetKey];
      if (!preset) return;

      cancelPendingWrites(Object.keys(preset));
      for (const [k, v] of Object.entries(preset)) {
        const slider = document.getElementById(k);
        if (slider) slider.value = v;
        setOutput(k, v);
      }
      updateActiveGlowPresetPill(presetKey);
      await save(preset);
    });
  });

  glowResetEl?.addEventListener('click', async (e) => {
    e.stopPropagation();
    await resetSectionKeys(GLOW_KEYS);
  });

  videoResetEl?.addEventListener('click', async (e) => {
    e.stopPropagation();
    await resetSectionKeys(VIDEO_KEYS);
  });

  audioResetEl?.addEventListener('click', async (e) => {
    e.stopPropagation();
    await resetSectionKeys(AUDIO_KEYS);
  });

  toolsResetEl?.addEventListener('click', async (e) => {
    e.stopPropagation();
    await resetSectionKeys(TOOLS_KEYS);
  });

  const reloadTabBtn = document.getElementById('reloadTabBtn');
  reloadTabBtn?.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTab?.id) {
        await chrome.tabs.reload(activeTab.id);
        const origText = reloadTabBtn.textContent;
        reloadTabBtn.textContent = 'Reloaded!';
        setTimeout(() => {
          reloadTabBtn.textContent = origText;
        }, 1500);
      }
    } catch (_) {}
  });

  audioNormalizerEl.addEventListener('change', () => save({ audioNormalizer: audioNormalizerEl.checked }));

  audioBoostEl.addEventListener('input', () => {
    audioBoostValEl.textContent = audioBoostEl.value + '%';
    queueSave('audioBoost', parseInt(audioBoostEl.value, 10));
  });
  audioBoostEl.addEventListener('change', async () => {
    cancelPendingWrites(['audioBoost']);
    await save({ audioBoost: parseInt(audioBoostEl.value, 10) });
  });

  if (bassBoostEl) {
    bassBoostEl.addEventListener('input', () => {
      bassBoostValEl.textContent = formatDb(bassBoostEl.value);
      queueSave('bassBoost', parseInt(bassBoostEl.value, 10));
    });
    bassBoostEl.addEventListener('change', async () => {
      cancelPendingWrites(['bassBoost']);
      await save({ bassBoost: parseInt(bassBoostEl.value, 10) });
    });
  }

  if (vocalBoostEl) {
    vocalBoostEl.addEventListener('input', () => {
      vocalBoostValEl.textContent = formatDb(vocalBoostEl.value);
      queueSave('vocalBoost', parseInt(vocalBoostEl.value, 10));
    });
    vocalBoostEl.addEventListener('change', async () => {
      cancelPendingWrites(['vocalBoost']);
      await save({ vocalBoost: parseInt(vocalBoostEl.value, 10) });
    });
  }

  const eqSliders = [
    { el: eq60El, valEl: eq60ValEl, key: 'eq60' },
    { el: eq250El, valEl: eq250ValEl, key: 'eq250' },
    { el: eq1000El, valEl: eq1000ValEl, key: 'eq1000' },
    { el: eq4000El, valEl: eq4000ValEl, key: 'eq4000' },
    { el: eq12000El, valEl: eq12000ValEl, key: 'eq12000' }
  ];

  eqSliders.forEach(({ el, valEl, key }) => {
    if (!el) return;
    el.addEventListener('input', () => {
      valEl.textContent = formatDb(el.value);
      queueSave(key, parseInt(el.value, 10));
      checkMatchingPreset();
    });
    el.addEventListener('change', async () => {
      cancelPendingWrites([key]);
      await save({ [key]: parseInt(el.value, 10) });
      checkMatchingPreset();
    });
  });

  eqPresetBtns.forEach((btn) => {
    btn.addEventListener('click', async () => {
      const presetKey = btn.getAttribute('data-preset');
      const preset = EQ_PRESETS[presetKey];
      if (!preset) return;

      cancelPendingWrites(['eq60', 'eq250', 'eq1000', 'eq4000', 'eq12000', 'eqPreset']);
      eqSliders.forEach(({ el, valEl, key }) => {
        if (el && preset[key] !== undefined) {
          el.value = preset[key];
          valEl.textContent = formatDb(preset[key]);
        }
      });

      updateActivePresetPill(presetKey);
      await save({ ...preset, eqPreset: presetKey });
    });
  });

  eqResetEl?.addEventListener('click', async () => {
    cancelPendingWrites(['eq60', 'eq250', 'eq1000', 'eq4000', 'eq12000', 'eqPreset']);
    const flat = EQ_PRESETS.flat;
    eqSliders.forEach(({ el, valEl, key }) => {
      if (el) {
        el.value = flat[key];
        valEl.textContent = formatDb(flat[key]);
      }
    });
    updateActivePresetPill('flat');
    await save({ ...flat, eqPreset: 'flat' });
  });

  adblockEnabledEl.addEventListener('change', () => save({ adblockEnabled: adblockEnabledEl.checked }));
  sponsorBlockEnabledEl?.addEventListener('change', () => save({ sponsorBlockEnabled: sponsorBlockEnabledEl.checked }));
  sponsorBlockModeEl?.addEventListener('change', () => save({ sponsorBlockMode: sponsorBlockModeEl.value }));
  qualityEnabledEl.addEventListener('change', () => save({ qualityEnabled: qualityEnabledEl.checked }));
  statsEnabledEl.addEventListener('change', () => save({ statsEnabled: statsEnabledEl.checked }));
  autoPauseModeEl?.addEventListener('change', () => save({ autoPauseMode: autoPauseModeEl.value }));
  returnDislikesEl?.addEventListener('change', () => save({ returnDislikes: returnDislikesEl.checked }));
  hideShortsEl?.addEventListener('change', () => save({ hideShorts: hideShortsEl.checked }));
  restoreAnnotationsEl?.addEventListener('change', () => save({ restoreAnnotations: restoreAnnotationsEl.checked }));
  hideEndCardsEl?.addEventListener('change', () => save({ hideEndCards: hideEndCardsEl.checked }));
  preferredQualityEl.addEventListener('change', () => save({ preferredQuality: preferredQualityEl.value }));
  blockAV1El.addEventListener('change', () => save({ blockAV1: blockAV1El.checked }));
  blockVP9El.addEventListener('change', () => save({ blockVP9: blockVP9El.checked }));
  hideInTheaterEl.addEventListener('change', () => save({ hideInTheater: hideInTheaterEl.checked }));
  hideScrollbarEl.addEventListener('change', () => save({ hideScrollbar: hideScrollbarEl.checked }));
  enableInPiPEl.addEventListener('change', () => save({ enableInPiP: enableInPiPEl.checked }));
  removeBlackBarsEl.addEventListener('change', () => save({ removeBlackBars: removeBlackBarsEl.checked }));
  block60fpsEl.addEventListener('change', () => save({ block60fps: block60fpsEl.checked }));
  audioReactiveEl.addEventListener('change', () => save({ audioReactive: audioReactiveEl.checked }));
  screenXModeEl?.addEventListener('change', () => save({ screenXMode: screenXModeEl.checked }));
  lightsOutEl.addEventListener('change', () => save({ lightsOut: lightsOutEl.checked }));

  if (lightsOutOpacityEl) {
    lightsOutOpacityEl.addEventListener('input', () => {
      const val = Number(lightsOutOpacityEl.value);
      if (lightsOutOpacityValEl) lightsOutOpacityValEl.textContent = val + '%';
      queueSave('lightsOutOpacity', val);
    });
    lightsOutOpacityEl.addEventListener('change', async () => {
      cancelPendingWrites(['lightsOutOpacity']);
      await save({ lightsOutOpacity: Number(lightsOutOpacityEl.value) });
    });
  }

  abLoopEnabledEl?.addEventListener('change', () => save({ abLoopEnabled: abLoopEnabledEl.checked }));
  ultrawideZoomEl.addEventListener('change', () => save({ ultrawideZoom: ultrawideZoomEl.checked }));

  for (const dir of ['Top', 'Right', 'Bottom', 'Left']) {
    const el = document.getElementById('glow' + dir);
    el.addEventListener('click', async () => {
      const active = !el.classList.contains('active');
      el.classList.toggle('active', active);
      el.setAttribute('aria-pressed', active ? 'true' : 'false');
      await save({ ['glow' + dir]: active });
    });
  }

  for (const key of SLIDER_KEYS) {
    const el = document.getElementById(key);
    const numEl = document.getElementById(`${key}-val`);

    el.addEventListener('input', () => {
      const value = Number(el.value);
      setOutput(key, value);
      queueSave(key, value);
      checkMatchingGlowPreset();
    });

    if (numEl) {
      numEl.addEventListener('change', () => {
        let value = Number(numEl.value);
        const min = Number(numEl.min);
        const max = Number(numEl.max);
        if (!Number.isFinite(value)) value = AURA_DEFAULTS[key];
        if (value < min) value = min;
        if (value > max) value = max;
        numEl.value = value;
        el.value = value;
        queueSave(key, value);
        checkMatchingGlowPreset();
      });
    }
  }

  if (preferredSpeedEl) {
    preferredSpeedEl.addEventListener('input', () => {
      const val = parseFloat(preferredSpeedEl.value);
      if (preferredSpeedValEl) preferredSpeedValEl.textContent = formatSpeedDisplay(val);
      queueSave('preferredSpeed', val);
    });
    preferredSpeedEl.addEventListener('change', async () => {
      cancelPendingWrites(['preferredSpeed']);
      await save({ preferredSpeed: parseFloat(preferredSpeedEl.value) });
    });
    preferredSpeedEl.addEventListener('dblclick', async () => {
      cancelPendingWrites(['preferredSpeed']);
      preferredSpeedEl.value = '1.0';
      if (preferredSpeedValEl) preferredSpeedValEl.textContent = formatSpeedDisplay(1.0);
      await save({ preferredSpeed: 1.0 });
    });
    preferredSpeedValEl?.addEventListener('click', async () => {
      cancelPendingWrites(['preferredSpeed']);
      preferredSpeedEl.value = '1.0';
      preferredSpeedValEl.textContent = formatSpeedDisplay(1.0);
      await save({ preferredSpeed: 1.0 });
    });
  }

  fpsEl.addEventListener('change', () => save({ fps: Number(fpsEl.value) }));

  resetEl.addEventListener('click', async () => {
    cancelPendingWrites();
    const currentCount = Number(adblockCountEl.textContent) || 0;
    const currentSponsorCount = sponsorBlockCountEl ? (Number(sponsorBlockCountEl.textContent) || 0) : 0;
    const syncDefaults = applyManagedOverrides({ ...AURA_DEFAULTS });
    delete syncDefaults.adblockCount;
    delete syncDefaults.sponsorBlockCount;
    render({ ...syncDefaults, adblockCount: currentCount, sponsorBlockCount: currentSponsorCount });
    await save(syncDefaults);
  });

  document.querySelectorAll('a[href^="http"]').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      if (chrome.tabs?.create) {
        chrome.tabs.create({ url: a.href });
      } else {
        window.open(a.href, '_blank', 'noopener,noreferrer');
      }
    });
  });
}

if (typeof window !== 'undefined') {
  window.CineGlowPopup = {
    pending,
    queueSave,
    cancelPendingWrites,
    resetSectionKeys
  };
}

init();


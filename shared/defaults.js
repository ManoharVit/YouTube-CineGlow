// Default settings shared by the content script and the popup.
const AURA_DEFAULTS = Object.freeze({
  enabled: true,
  adblockEnabled: true,
  adblockCount: 0,
  qualityEnabled: true,
  statsEnabled: false,
  preferredQuality: 'hd1080',
  preferredSpeed: 1.0,
  blockAV1: false,
  blockVP9: false,
  block60fps: false,
  hideInTheater: true,
  hideScrollbar: true,
  enableInPiP: false,
  glowTop: true,
  glowRight: true,
  glowBottom: true,
  glowLeft: true,
  opacity: 95,           // %
  fadeInDuration: 1,     // seconds
  blur: 50,              // px
  spread: 250,           // % of video size
  saturation: 120,       // %
  contrast: 110,         // %
  brightness: 105,       // %
  smoothness: 50,        // % — temporal blend between frames
  removeBlackBars: true,
  fps: 30,               // max glow updates per second
  audioNormalizer: false,
  audioBoost: 100,       // %
  bassBoost: 0,          // dB (0 to 15)
  vocalBoost: 0,         // dB (0 to 12)
  eq60: 0,               // dB (-12 to +12)
  eq250: 0,              // dB (-12 to +12)
  eq1000: 0,             // dB (-12 to +12)
  eq4000: 0,             // dB (-12 to +12)
  eq12000: 0,            // dB (-12 to +12)
  eqPreset: 'flat',      // 'flat' | 'bass' | 'vocal' | 'rock' | 'pop' | 'electro' | 'custom'
  audioReactive: true,
  lightsOut: false,
  ultrawideZoom: false,
  videoBrightness: 100,  // %
  videoContrast: 100,    // %
  videoSepia: 0,         // % — acts as blue-light filter
  autoPauseMode: 'off',  // 'off' | 'tab' | 'app'
  recordFormat: 'mkv',   // 'mkv' | 'webm' | 'mp4'
  recordFps: 30,         // 30 | 60
  returnDislikes: false, // restore public dislike count & rating
  hideShorts: false,     // hide YouTube Shorts shelves & feeds
  restoreAnnotations: false, // restore classic YouTube video annotations
  hideEndCards: true       // hide video end cards, suggestions & subscribe overlays by default
});

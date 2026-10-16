// Default settings shared by the content script and the popup.
const AURA_DEFAULTS = Object.freeze({
  enabled: true,
  adblockEnabled: true,
  adblockCount: 0,
  qualityEnabled: false,
  statsEnabled: false,
  preferredQuality: 'hd1080',
  blockAV1: false,
  blockVP9: false,
  block60fps: false,
  hideInTheater: false,
  hideScrollbar: false,
  enableInPiP: false,
  glowTop: true,
  glowRight: true,
  glowBottom: true,
  glowLeft: true,
  opacity: 85,           // %
  fadeInDuration: 1.5,   // seconds
  blur: 60,              // px
  spread: 130,           // % of video size
  saturation: 130,       // %
  contrast: 100,         // %
  brightness: 100,       // %
  smoothness: 60,        // % — temporal blend between frames
  removeBlackBars: false,
  fps: 30,               // max glow updates per second
  audioNormalizer: false,
  audioBoost: 100,       // %
  audioReactive: false,
  lightsOut: false,
  ultrawideZoom: false,
  videoBrightness: 100,  // %
  videoContrast: 100,    // %
  videoSepia: 0,         // % — acts as blue-light filter
  autoPauseMode: 'off'   // 'off' | 'tab' | 'app'
});

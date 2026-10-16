// Default settings shared by the content script and the popup.
// Loaded as a classic script, so this constant is visible to scripts loaded after it.
const AURA_DEFAULTS = Object.freeze({
  enabled: true,         // Ambient light switch
  adblockEnabled: true,  // Ad blocker switch
  adblockCount: 0,       // Lifetime blocked ads counter
  qualityEnabled: false, // Auto-HD switch
  statsEnabled: false,   // Quality stats overlay switch
  preferredQuality: 'hd1080', // Target resolution
  blockAV1: false,       // Codec Blocker: AV1
  blockVP9: false,       // Codec Blocker: VP9
  block60fps: false,     // Codec Blocker: 60fps
  hideInTheater: false,  // Hide UI in theater mode
  hideScrollbar: false,  // Hide the browser scrollbar
  enableInPiP: false,    // Keep glow in Picture-in-Picture
  glowTop: true,         // Glow direction Top
  glowRight: true,       // Glow direction Right
  glowBottom: true,      // Glow direction Bottom
  glowLeft: true,        // Glow direction Left
  opacity: 85,           // Glow opacity, %
  fadeInDuration: 1.5,   // Fade in duration, seconds
  blur: 60,              // Blur radius, px
  spread: 110,           // Glow size relative to the video, %
  saturation: 130,       // Color saturation, %
  contrast: 100,         // Color contrast, %
  brightness: 100,       // Glow brightness, %
  smoothness: 60,        // Temporal smoothing between frames, %
  removeBlackBars: false, // Zoom video to remove letterboxing
  fps: 30,               // Max glow updates per second
  audioNormalizer: false,// Balance loud & quiet sounds
  audioBoost: 100,       // Volume boost percentage
  audioReactive: false,  // Audio-Reactive Glow (Beat Sync)
  lightsOut: false,      // "Lights Out" Cinema Mode
  ultrawideZoom: false,  // Ultrawide "Zoom-to-Fit"
  videoBrightness: 100,  // Video Eye-Care: Brightness
  videoContrast: 100,    // Video Eye-Care: Contrast
  videoSepia: 0,         // Video Eye-Care: Blue-Light Filter (Sepia)
  autoPauseMode: 'off'   // Auto-pause mode: 'off' | 'tab' | 'app'
});

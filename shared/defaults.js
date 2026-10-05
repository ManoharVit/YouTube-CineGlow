// Default settings shared by the content script and the popup.
// Loaded as a classic script, so this constant is visible to scripts loaded after it.
const AURA_DEFAULTS = Object.freeze({
  enabled: true,         // Ambient light switch
  adblockEnabled: true,  // Ad blocker switch
  adblockCount: 0,       // Lifetime blocked ads counter
  qualityEnabled: false, // Auto-HD switch
  preferredQuality: 'hd1080', // Target resolution
  blockAV1: false,       // Codec Blocker: AV1
  blockVP9: false,       // Codec Blocker: VP9
  block60fps: false,     // Codec Blocker: 60fps
  hideInTheater: false,  // Hide UI in theater mode
  hideScrollbar: false,  // Hide the browser scrollbar
  glowTop: true,         // Glow direction Top
  glowRight: true,       // Glow direction Right
  glowBottom: true,      // Glow direction Bottom
  glowLeft: true,        // Glow direction Left
  opacity: 85,           // Glow opacity, %
  fadeInDuration: 1.5,   // Fade in duration, seconds
  blur: 60,              // Blur radius, px
  spread: 130,           // Glow size relative to the video, %
  saturation: 130,       // Color saturation, %
  contrast: 100,         // Color contrast, %
  brightness: 100,       // Glow brightness, %
  smoothness: 60,        // Temporal smoothing between frames, %
  fps: 30,               // Max glow updates per second
});

# Changelog — CineGlow Pro for YouTube

All notable changes to the CineGlow Pro for YouTube extension are documented in this file.
The project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.3.0] — 2026-11-11

### Chrome Web Store Compliance & Targeted Release Patch
- **Store Policy & Trademark Compliance**: Renamed extension from `YouTube CineGlow Pro` to `CineGlow Pro for YouTube` across `manifest.json`, `package.json`, `CHROMEWEBSTORE.md`, `README.md`, and `PACKAGE_SUMMARY.md`. Short name set to `CineGlow Pro`. Action default title updated to `CineGlow Pro`.
- **Downloader Dead Code & Permission Shedding**: Purged dead downloader code (`setupDownloadHeadersRule` and `DOWNLOAD_VIDEO` from `background/background.js`, `CINEGLOW_GET_DOWNLOAD_FORMAT` from `content/main-world.js`). Removed `downloads` and `*://*.googlevideo.com/*` permissions from `manifest.json`.
- **Minimum Chrome Version**: Raised `minimum_chrome_version` in `manifest.json` from `105` to `111` for declarative `world: "MAIN"` content scripts.
- **Annotations Opt-in Verification & Network Guard (P1)**: In `content/annotations.js`, initialized `enabled` to `false` and guarded initialization until `loadSettings()` completes. No network requests are dispatched while annotations remain disabled, strictly upholding opt-in policy.
- **Web Audio Source Node Retention & Reconnection (P1)**: In `content/audio-processor.js`, cached each video element's `MediaElementAudioSourceNode` in a `WeakMap`. Re-navigating to a previously attached video element (switching A → B → A) disconnects the previous source and seamlessly reconnects the existing source node to the Web Audio DSP graph without throwing or skipping reconnection.
- **Mid-Ad AdBlock Disabling State Restoration (P2)**: In `content/youtube-ads.js`, implemented `restoreModifiedPlaybackState()`. Disabling AdBlock mid-ad immediately clears skip timers, restores video playback speed from 16× back to pre-ad speed, and restores mute state (preserving user pre-ad mute choice).
- **Popup Reset Pending Write Cancellation (P2)**: In `popup/popup.js`, implemented `cancelPendingWrites()`. Resetting lighting, section keys, audio/video presets, or executing a master reset immediately cancels and purges queued throttled slider writes, preventing pending slider writes from overwriting saved defaults.
- **Auto-HD Shared Default Alignment (P2)**: In `content/youtube-quality.js`, aligned private default state with `AURA_DEFAULTS.qualityEnabled = true`, ensuring Auto-HD is active upon fresh installation without requiring explicit toggle manipulation.
- **Recording Container Derivation & Lifecycle Integrity (P2 & Verification Gap)**: In `content/record-button.js`, captured active format and frame rate at recording inception and derived download extensions via `deriveContainerExtension()` from actual container MIME types and initial session format. Mid-recording format preference toggles no longer mislabel recorded containers. Exposed recorder methods on `window.CineGlowRecorder` and overhauled `test/recording-and-media.test.js` to eliminate duplicated logic and validate full recording finalization and container preservation.
- **Audio Dynamic Headroom Attenuation (BUG-3)**: In `content/audio-processor.js`, implemented `computeEffectiveGain()` to compute total accumulated boost ($\text{totalMaxBoostDb} = \text{bass} + \text{vocal} + \text{eqMax}$). When total boost exceeds $+6\text{ dB}$, gain attenuates dynamically by $10^{-\frac{\text{totalMaxBoostDb} - 6}{40}}$ across all volume levels (including 100%) to mitigate digital overdriving into the brickwall limiter node.
- **Sync Storage Quota Throttle (BUG-4)**: Implemented a 550ms trailing-edge throttle with batch flushing in `popup/popup.js`, capping sync writes under continuous slider dragging to a maximum of 109 writes/minute (below Chrome's 120 writes/minute quota limit).
- **HTML Label Validation**: Converted duplicate `<label for="...">` wrappers on settings toggle rows in `popup/popup.html` to `<span>` elements with `aria-labelledby` referencing control IDs.
- **Store Screenshots Standardized**: Resized all 5 Chrome Web Store screenshots in `store_assets/` to strictly 1280 × 800 px (16:10 aspect ratio).
- **Popup Version Pill Auto-Derivation**: Dynamically populated `.header-version-pill` in `popup/popup.js` from `chrome.runtime.getManifest().version` during popup initialization to prevent version display desynchronization.
- **Web Audio Autoplay Policy & Interaction Resume Hardening**: In `content/audio-processor.js`, attached `pointerdown` and `touchstart` on `window` along with `playing` and `volumechange` on video elements to reliably resume suspended `AudioContext` graphs during autoplay or when videos start without direct clicks.
- **Repository Cleanliness**: Untracked 2,268 committed `node_modules/` files from Git and added `node_modules/` to `.gitignore`. Removed scratch test files.
- **Regression Test Suite**: Added regression unit tests for annotations opt-in guard, dynamic video mounting, video source node reconnection & unmounting, mid-ad adblock disabling, normal playback preservation, popup pending write cancellation & selective section resets, Auto-HD defaults, recorder constructor fallback, and recording container derivation (50 / 50 tests passing across 6 suites).

---

## [2.2.0] — 2026-10-20
- **Settings Popup Redesign**: Quiet card layout with segmented controls and reduced visual clutter.
- **Active Tab Sync**: Added one-click tab reload button in popup header allowing users to immediately reload the active YouTube watch tab after modifying settings.
- **Demonstration Video**: Created 1080p narrated walkthrough video in `store_assets/YouTube_CineGlow_Pro_Demo.mp4`.
- **Widescreen Auto-Crop**: Improved black bar auto-crop expansion for cinematic letterbox trailers.

---

## [2.1.2] — 2026-10-17
- Tuned popup sizing for smaller laptop screens.
- Improved black border auto-crop detection accuracy on 2.39:1 anamorphic video aspect ratios.
- Updated store visual screenshot gallery.

## [2.1.0] — 2026-10-15
- Introduced vertical floating player toolbar for quick access to PiP, speed, and screenshot controls.
- Added dynamic audio normalizer compressor to eliminate sudden volume spikes between quiet speech and loud sound effects.
- Added night eye-care sepia video filters.
- Implemented smart auto-pause on window blur and tab backgrounding.

## [2.0.0] — 2026-10-09
- Added real-time playback telemetry HUD with live frame-rate graph and dropped frame counters.
- Added ambient lighting support in Picture-in-Picture mode.

## [1.0.0] — 2026-10-05
- Initial release with real-time reactive ambient canvas glow for YouTube video players.
- Basic edge control, blur, spread, saturation, and brightness customization sliders.

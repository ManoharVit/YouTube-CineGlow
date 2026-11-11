# Changelog — CineGlow Pro for YouTube

All notable changes to the CineGlow Pro for YouTube extension are documented in this file.
The project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.2.0] — 2026-11-10

### Targeted Release Patch (Post-Review Remediation)
- **Store Policy & Trademark Compliance**: Renamed extension from `YouTube CineGlow Pro` to `CineGlow Pro for YouTube` across `manifest.json`, `package.json`, `CHROMEWEBSTORE.md`, `README.md`, and `PACKAGE_SUMMARY.md`. Short name set to `CineGlow Pro`. Action default title updated to `CineGlow Pro`.
- **Downloader Dead Code & Permission Shedding**: Purged dead downloader code (`setupDownloadHeadersRule` and `DOWNLOAD_VIDEO` from `background/background.js`, `CINEGLOW_GET_DOWNLOAD_FORMAT` from `content/main-world.js`). Removed `downloads` and `*://*.googlevideo.com/*` permissions from `manifest.json`.
- **Minimum Chrome Version**: Raised `minimum_chrome_version` in `manifest.json` from `105` to `111` for declarative `world: "MAIN"` content scripts.
- **Playback Mute Restoration Integrity (BUG-1 & Follow-up)**: In `content/youtube-ads.js`, tracked `userWasMuted = video.muted` before ad muting so pre-muted videos remain muted when ads end. Explicitly tracked `mutedVideoElement = video` so unmute restoration applies strictly to the exact element muted by CineGlow, preventing unmuting of replacement video elements mounted in a muted state.
- **Audio Dynamic Headroom Attenuation (BUG-3)**: In `content/audio-processor.js`, implemented `computeEffectiveGain()` to compute total accumulated boost ($\text{totalMaxBoostDb} = \text{bass} + \text{vocal} + \text{eqMax}$). When total boost exceeds $+6\text{ dB}$, gain attenuates dynamically by $10^{-\frac{\text{totalMaxBoostDb} - 6}{40}}$ across all volume levels (including 100%) to mitigate digital overdriving into the brickwall limiter node.
- **Sync Storage Quota Throttle (BUG-4)**: Implemented a 550ms trailing-edge throttle with batch flushing in `popup/popup.js`, capping sync writes under continuous slider dragging to a maximum of 109 writes/minute (below Chrome's 120 writes/minute quota limit).
- **HTML Label Validation**: Converted duplicate `<label for="...">` wrappers on settings toggle rows in `popup/popup.html` to `<span>` elements with `aria-labelledby` referencing control IDs.
- **Store Screenshots Standardized**: Resized all 5 Chrome Web Store screenshots in `store_assets/` to strictly 1280 × 800 px (16:10 aspect ratio).
- **Repository Cleanliness**: Untracked 2,268 committed `node_modules/` files from Git and added `node_modules/` to `.gitignore`. Removed scratch test files.
- **Regression Test Suite**: Added regression unit tests for user mute preservation, mid-ad video element replacement, and headroom gain scaling under high EQ boost (34 / 34 tests passing).

### Baseline v2.2.0 Features (Commit `c7f0856`)
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

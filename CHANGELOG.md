# Changelog — CineGlow Pro for YouTube

All notable changes to the CineGlow Pro for YouTube extension are documented in this file.
The project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.2.0] — 2026-11-10

### 1. Store Policy & Trademark Compliance
- **Extension Renaming**: Renamed from `YouTube CineGlow Pro` to `CineGlow Pro for YouTube` across `manifest.json`, `package.json`, `CHROMEWEBSTORE.md`, `README.md`, and `PACKAGE_SUMMARY.md` to adhere strictly to the Chrome Web Store Trademark Guidelines. Short name set to `CineGlow Pro` (12 characters).
- **Prohibited Downloader Dead Code Purged**: Removed `setupDownloadHeadersRule` and `DOWNLOAD_VIDEO` message handling from `background/background.js`. Purged `CINEGLOW_GET_DOWNLOAD_FORMAT` format extraction listener from `content/main-world.js`.
- **Permission Shedding**: Completely removed `downloads` permission and `*://*.googlevideo.com/*` host permission from `manifest.json` to comply with Chrome Web Store Single Purpose and video streaming policies.
- **Minimum Chrome Version**: Raised `minimum_chrome_version` in `manifest.json` from `105` to `111` to match the Chromium release where declarative `world: "MAIN"` content scripts were introduced.
- **Action Title Updated**: Changed default action title in `manifest.json` from `Aura` to `CineGlow Pro`.

### 2. Core Playback & Ad Handling
- **BUG-1 (Forced Unmute Fix)**: Resolved an issue in `content/youtube-ads.js` where videos intentionally muted by the user were forcibly unmuted when an ad sequence completed. Added `userWasMuted` state tracking so pre-existing user mute states are preserved after ad completion.
- **BUG-2 (Mid-Ad Video Swap Tracking)**: Fixed video listener desynchronization in `content/youtube-ads.js` occurring when YouTube destroys and recreates the HTML5 `<video>` element during ad playback. Added element inequality checks (`activeVideo !== video`) and immediate mute re-application.
- **Cleanup & Memory Management**: Added `CineGlowAdBlock.cleanup()` to properly clear intervals and detach `timeupdate` listeners upon page transitions or test resets.

### 3. Web Audio DSP & Dynamic Headroom Protection
- **BUG-3 (Acoustic Clipping Fix)**: Fixed severe audio clipping distortion in `content/audio-processor.js` when combining 300% volume boost with aggressive Bass Boost (+15 dB), Vocal Boost (+12 dB), or 5-band graphic EQ.
- **Dynamic Headroom Scaling**: Implemented `computeEffectiveGain()` to compute total accumulated boost ($$\text{totalMaxBoostDb} = \text{bass} + \text{vocal} + \text{eqMax}$$). When boost exceeds $$+6\text{ dB}$$ and volume multiplier $$> 1.0$$, gain is smoothly attenuated via $$10^{-\frac{\text{totalMaxBoostDb} - 6}{40}}$$ to ensure the brickwall limiter receives clean, non-distorted signals.

### 4. UI Accessibility & Quota Protection
- **BUG-4 (Sync Storage Quota Throttle)**: Implemented a 550ms trailing-edge throttle in `popup/popup.js` with batch flushing. Guarantees maximum write frequency of 109 writes/minute under continuous slider dragging, eliminating `MAX_WRITE_OPERATIONS_PER_MINUTE = 120` errors.
- **Accessibility & Validation Fix**: Corrected duplicate `for` attributes in `popup/popup.html` on toggle rows (`hideScrollbar`, `blockAV1`, `blockVP9`, `block60fps`). Converted title `<label>` elements to `<span>` with `aria-labelledby` referencing control IDs.
- **Active Tab Sync**: Added one-click reload button in popup header allowing users to immediately synchronize settings with the active YouTube watch tab.

### 5. Store Assets & Visual Packaging
- **Screenshot Dimensions Standardized**: Resized all 5 Chrome Web Store screenshots in `store_assets/` to strictly 1280 × 800 px (16:10 aspect ratio), resolving developer console upload rejections.
- **Asset Palette & Layout**: Standardized Small Promo Tile at 440 × 280 px and Marquee Promo Tile at 1400 × 560 px.
- **Video Walkthrough**: Bundled 1080p narrated demonstration video `store_assets/YouTube_CineGlow_Pro_Demo.mp4` highlighting ambient lighting, audio normalization, and cinema layouts.

### 6. Repository Hygiene & Test Suite
- **Git History Cleanup**: Removed 2,268 committed `node_modules/` files from Git tracking and added `node_modules/` to `.gitignore`.
- **Scratch Files Removed**: Deleted redundant root test script `test-worker.js` and redundant root video copy.
- **Automated Regression Suite**: Expanded `test/adblock-and-playback.test.js` with unit tests for BUG-1 (user mute preservation) and BUG-2 (mid-ad element swap). Automated suite passes with 32 / 32 tests (100% pass rate in ~131ms).
- **Release Package**: Rebuilt production package `YouTube-CineGlow-v2.2.0.zip` (109 KB, 41 files, SHA-256: `81745c83e62920e0159d03ef1657f4e6ed2ce8ffc55e63324631f284447ea994`).

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

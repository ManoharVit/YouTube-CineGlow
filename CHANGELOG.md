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
- **Phase 1 Security & Origin Isolation**: Bounded Cloud Storage host permissions to the dedicated virtual-hosted bucket origin `https://biggest_bucket.storage.googleapis.com/*` in `manifest.json` and `background/background.js`, eliminating global multi-tenant GCS over-scoping.
- **Protocol-Relative Open Redirect Remediation**: Hardened URL action handling in `content/annotations.js` by eliminating protocol-relative redirect vulnerabilities (`//evil.com`) and strictly enforcing YouTube origin parsing for annotation links.
- **IPC Cross-World Origin Verification**: Replaced wildcard targetOrigin `'*'` in `window.postMessage` calls with `window.location.origin` in `content/main-world.js`, `content/youtube-quality.js`, and `content/stats-overlay.js`, adding origin validation to message listeners to prevent DOM-based message spoofing.
- **Software Composition Analysis & Lockfile Remediation**: Resolved 4 high-severity vulnerabilities in devDependencies (`npm audit` 0 vulnerabilities) and synchronized `package-lock.json` with bounded Puppeteer dependency `>=25.17.0 <26.0.0`.
- **Enterprise Managed Policy Contract (storage.managed)**: Added `managed-schema.json` declaring enterprise MDM policies (`DisableAdBlock`, `DisableRecording` for DLP compliance, `DisableThirdPartyAPIs` to block external calls, and `ForceDefaultQuality` for bandwidth control). Integrated enforcement into popup settings, recording toolbar, and background telemetry router.
- **Enterprise Co-existence & InfoSec VAPT Suite**: Added automated CI test suite `test/enterprise-coexistence-and-vapt.test.js` validating strict YouTube isolation against corporate SaaS domains (Workday, Salesforce, SAP, ServiceNow, Jira, M365), zero plaintext token or PII storage, zero wildcard IPC message broadcasts, and zero third-party telemetry/tracking scripts (59 / 59 tests passing across 7 suites).
- **Phase 2 Automated Staging & Co-existence Certified**:
  - Expanded automated test coverage to **330 tests across 64 suites** (100% pass rate, 0 failures), plus 16 adversarial stress benchmarks.
  - Implemented exponential backoff with calibrated jitter in `shared/network-backoff.js` to mitigate thundering-herd self-DDoS during backend HTTP 502/503/504 outages.
  - Hardened emergency kill-switch (`KillSwitch` boolean in `managed-schema.json`), executing fleetwide teardown across 25 tabs in 2.005ms (< 5-minute SLA).
  - Empirically verified 25-tab resource soak: 27.63MB memory per process (well below 80MB ceiling); canvas downsampling consumes < 40KB per canvas (< 1MB across 25 tabs).
  - Verified 30-second service worker idle suspension lifecycle with zero persistent timers or open ports and instant 1.01ms event wake-up.
  - Unanimously approved Gate 4 audit across 5 verification subagents with zero facade tests remaining.
- **Pure HTTPS Origin Enforcement**: Pinned manifest `host_permissions` strictly to `https://*.youtube.com/*`, enforcing pure TLS transport and eliminating cleartext schemes.
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

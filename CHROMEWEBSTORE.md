# Chrome Web Store Listing — YouTube CineGlow Pro

> Last Updated: 2026-10-15

## Store Listing

**Extension Name** [REQUIRED]
YouTube CineGlow Pro

**Short Description** [REQUIRED]
Transform YouTube with real-time cinema ambient lighting, smart ad blocking, volume normalization, and automatic pause.

**Detailed Description** [REQUIRED]
Turn watching YouTube videos into an immersive home-theater experience with dynamic, color-matched ambient lighting and precision playback controls.

YouTube CineGlow Pro projects smooth, real-time ambient lighting around your video player by analyzing video edge colors live. Designed for dark-mode viewing and late-night binge watching, it eliminates harsh screen contrast while giving you full control over video, audio, and performance.

KEY FEATURES

• Dynamic Ambient Lighting: Projects soft, real-time color aura around the video player matching the video edges.
• Directional Light Control: Independently enable or disable lighting on the Top, Bottom, Left, or Right sides of the screen.
• Smart Ad Skipping: Automatically skips video ads and filters tracker networks without interrupting playback.
• Audio Normalizer & Booster: Balances quiet dialogue and loud explosions, boosting quiet scenes up to 300%.
• Audio-Reactive Glow: Pulses ambient lighting dynamically in sync with musical beats and bass frequencies.
• Smart Auto-Pause: Automatically pauses playback when you switch tabs or minimize the browser, and resumes when you return.
• Late-Night Eye Care: Adjusts video brightness, contrast, and applies blue-light filtering to reduce eye fatigue.
• Floating Video Toolbar: Quick-access controls for instant Picture-in-Picture and full-resolution uncompressed PNG screenshot capture.
• Draggable Stats Overlay: Live display of true display FPS, video dropped frames, and render timings.

HOW TO USE IT

1. Install YouTube CineGlow Pro.
2. Open any video on YouTube (ensure YouTube is in Dark Theme for optimal visuals).
3. Click the CineGlow Pro icon in your browser toolbar to fine-tune lighting spread, brightness, audio boost, and auto-pause settings.
4. Settings apply immediately and synchronize across all your Chrome devices.

PRIVACY & PERFORMANCE

All lighting calculations, frame processing, and audio normalization happen entirely on your computer in local memory. CineGlow Pro never collects, stores, or transmits your personal data, watch history, or browsing activity. Animation loops instantly halt when videos are paused or tabs are switched to ensure zero unnecessary battery drain.

SUPPORT & SOURCE CODE

YouTube CineGlow Pro is open source:
GitHub: https://github.com/ManoharVit/YouTube-CineGlow

**Category** [REQUIRED]
Photos

**Single Purpose** [REQUIRED]
Projects real-time ambient lighting around YouTube videos and enhances playback with volume balancing and automatic pause controls.

**Primary Language** [REQUIRED]
English

---

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|---|---|---|---|
| Store Icon [REQUIRED] | 128×128 PNG | Ready | `icons/icon-128.png` |
| Small Icon | 48×48 PNG | Ready | `icons/icon-48.png` |
| Toolbar Icon | 16×16 PNG | Ready | `icons/icon-16.png` |
| Screenshot 1 [REQUIRED] | 1280×800 or 640×400 | Capture Needed | Player with cinema ambient glow active |
| Screenshot 2 [RECOMMENDED] | 1280×800 or 640×400 | Capture Needed | Settings popup showcasing category navigation |
| Screenshot 3 [RECOMMENDED] | 1280×800 or 640×400 | Capture Needed | Floating toolbar and Picture-in-Picture |
| Small Promo Tile [RECOMMENDED] | 440×280 | Optional | Promotional banner |
| Marquee Promo Tile | 1400×560 | Optional | Large store header banner |

---

## Permissions Justification

| Permission | Type | Justification |
|---|---|---|
| `storage` | permissions | Stores and synchronizes user preferences (glow intensity, brightness, audio boost level, auto-pause mode) across sessions via Chrome Sync. |
| `declarativeNetRequest` | permissions | Blocks ad network segments and tracking endpoints on YouTube video streams without accessing or inspecting user network payload. |
| `scripting` | permissions | Configures client-side video playback profiles and codec settings within the YouTube page context. |
| `downloads` | permissions | Enables users to save high-resolution, uncompressed video frame screenshots to their local Downloads folder upon clicking the toolbar camera button. |
| `*://*.youtube.com/*` | host_permissions | Allows the extension to sample video frames for ambient lighting, inject player controls, and monitor playback state on YouTube watch pages. |
| `*://*.googlevideo.com/*` | host_permissions | Required for declarativeNetRequest rules to intercept and filter ad stream segments from YouTube video delivery servers. |

---

## Privacy & Data Use

**Does the extension collect user data?** No

### Data Use Certification
- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes

---

## Privacy Policy

**Privacy Policy URL** [REQUIRED]
https://github.com/ManoharVit/YouTube-CineGlow/blob/main/PRIVACY.md

---

## Distribution

**Visibility**: Public
**Regions**: All regions

---

## Developer Info

**Publisher Name**: Giri Manohar Vemula
**Contact Email**: girimanohar.v@gmail.com
**Support / Repository URL**: https://github.com/ManoharVit/YouTube-CineGlow

---

## Version History

| Version | Date | Changes | Status |
|---|---|---|---|
| 2.1.0 | 2026-10-15 | Modern glassmorphism UI, Smart Auto-Pause, vertical floating toolbar, Web Audio normalizer, eye care filters, MIT license | Ready to Submit |
| 2.0.0 | 2026-10-09 | Stats overlay and PiP controls | Archived |
| 1.0.0 | 2026-10-05 | Initial release | Archived |

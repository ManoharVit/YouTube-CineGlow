# Chrome Web Store Listing — YouTube CineGlow Pro

> Last Updated: 2026-10-17

## Store Listing

**Extension Name** [REQUIRED]
YouTube CineGlow Pro

**Short Description** [REQUIRED]
Adds live ambient lighting around YouTube videos, skips ads, normalizes audio, and auto-pauses when you switch tabs.

**Detailed Description** [REQUIRED]
If you watch YouTube in a dark room, staring at a bright video surrounded by pitch-black borders strains your eyes. CineGlow fixes that. It samples colors along the edges of every video frame in real time and projects a soft, matched ambient aura onto the page around the player — like Philips Ambilight TVs, but running directly in your browser.

Alongside ambient lighting, CineGlow packs everyday playback improvements: it balances dialogue so quiet voices aren't drowned out by loud action scenes, skips video ads automatically, and pauses your video when you switch tabs so you never lose your spot.

KEY FEATURES

• Real-Time Ambient Lighting: Samples frames into a lightweight 64x36 canvas and blurs the edges to project a smooth, color-matched glow. Customize brightness, spread, blur, saturation, or toggle individual sides (top, bottom, left, right).
• Audio Normalizer & Dialogue Booster: Uses the Web Audio API to boost quiet voices up to 300% while preventing loud explosions or music from clipping your speakers.
• Audio-Reactive Glow: Reads bass frequencies from a real-time FFT analyzer to pulse the lighting in sync with the beat.
• Smart Ad Skipping: Automatically detects ad overlays and clicks the skip button. Uses Chrome's fast declarative rules to filter tracker networks without inspecting your private traffic.
• Smart Tab Auto-Pause: Automatically pauses playback when you switch tabs or minimize the window, and resumes right where you left off when you return.
• Floating Player Toolbar: Quick-access toolbar beside the player for one-click Picture-in-Picture (PiP) and uncompressed, full-resolution PNG frame screenshots.
• Live Telemetry HUD: Draggable stats overlay showing true display refresh rate, video FPS, dropped frames, bitrate, codec (VP9/AV1), and color space.
• Eye-Care Night Filters: Adjusts video contrast, brightness, and adds a warm blue-light filter to keep late-night binge watching comfortable.
• Letterbox Black Bar Removal: Automatically detects cinematic black bars and scales the video smoothly to fill ultrawide (21:9) or standard displays.

PERFORMANCE & PRIVACY

• Zero Battery Drain When Idle: Rendering and audio loops stop immediately when you pause, switch tabs, or leave the watch page.
• 100% Local & Private: Frame sampling, color math, and audio processing run entirely inside your browser's local memory. No watch history or personal data is ever collected, stored, or sent to any server.

HOW TO USE

1. Install YouTube CineGlow Pro.
2. Open any video on YouTube (YouTube dark theme is recommended).
3. Click the CineGlow icon in your browser toolbar to fine-tune lighting spread, colors, and audio boost.
4. Settings sync across your Chrome devices automatically.

SOURCE CODE

YouTube CineGlow Pro is open source: https://github.com/ManoharVit/YouTube-CineGlow

**Category** [REQUIRED]
Photos

**Single Purpose** [REQUIRED]
Projects live ambient lighting around YouTube videos and adds playback controls for volume normalization and automatic pause.

**Primary Language** [REQUIRED]
English

---

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|---|---|---|---|
| Store Icon [REQUIRED] | 128×128 PNG | Ready | `icons/icon-128.png` |
| Small Icon | 48×48 PNG | Ready | `icons/icon-48.png` |
| Toolbar Icon | 16×16 PNG | Ready | `icons/icon-16.png` |
| Screenshot 1 [REQUIRED] | 2879×1567 PNG | Ready | `store_assets/screenshot_1_ambient_lighting.png` |
| Screenshot 2 [RECOMMENDED] | 2879×1655 PNG | Ready | `store_assets/screenshot_2_settings_popup.png` |
| Screenshot 3 [RECOMMENDED] | 2879×1567 PNG | Ready | `store_assets/screenshot_3_stats_overlay.png` |
| Screenshot 4 [RECOMMENDED] | 2879×1565 PNG | Ready | `store_assets/screenshot_4_theatre_mode.png` |
| Screenshot 5 [RECOMMENDED] | 2879×1565 PNG | Ready | `store_assets/screenshot_5_frame_snap.png` |
| Small Promo Tile [RECOMMENDED] | 440×280 PNG | Ready | `store_assets/promo_tile_440x280.png` |
| Marquee Promo Tile [RECOMMENDED] | 1400×560 PNG/JPG | Ready | `store_assets/marquee_promo_1400x560.png` |

---

## Permissions Justification

| Permission | Type | Why it's needed |
|---|---|---|
| `storage` | permissions | Saves user preferences (glow settings, audio boost level, auto-pause mode) and syncs them across Chrome sessions. |
| `declarativeNetRequest` | permissions | Blocks ad and tracker network requests on YouTube without reading or logging any request payload. |
| `scripting` | permissions | Registers a MAIN-world content script at runtime to override codec capability reporting for codec-blocking features. |
| `downloads` | permissions | Saves full-resolution PNG screenshots to the user's Downloads folder when they click the toolbar camera button. |
| `*://*.youtube.com/*` | host_permissions | Lets the extension inject content scripts that sample video frames, add player controls, and monitor playback state. |
| `*://*.googlevideo.com/*` | host_permissions | Required by declarativeNetRequest to match and block ad stream segments served from YouTube's video CDN. |

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
| 2.1.2 | 2026-10-17 | Compact popup (-20% width), full-res store screenshots, creator badge shortened, black bar crop fixes | Ready to Submit |
| 2.1.0 | 2026-10-15 | New popup UI, Smart Auto-Pause, floating toolbar, Web Audio normalizer, eye-care filters, MIT license | Published |
| 2.0.0 | 2026-10-09 | Stats overlay, PiP controls | Archived |
| 1.0.0 | 2026-10-05 | Initial release | Archived |

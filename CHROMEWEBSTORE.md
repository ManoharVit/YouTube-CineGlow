# Chrome Web Store Listing — YouTube CineGlow Pro

> Last Updated: 2026-10-17

## Store Listing

**Extension Name** [REQUIRED]
YouTube CineGlow Pro

**Short Description** [REQUIRED]
Adds live ambient lighting around YouTube videos, skips ads, normalizes audio, and auto-pauses when you switch tabs.

**Detailed Description** [REQUIRED]
YouTube CineGlow Pro reads the edge colors from every video frame and projects a soft, color-matched glow onto the page behind the player — like Ambilight for your browser. It works best in dark mode.

KEY FEATURES

• Ambient Lighting — Samples each frame and casts a live color glow around all four sides of the video. You can toggle individual sides on or off.
• Ad Skipping — Detects ad overlays and clicks the skip button automatically. Blocks known ad and tracker domains via declarative network rules.
• Audio Normalizer — Runs a Web Audio gain node on the video output, boosting quiet dialogue up to 300% without clipping loud scenes.
• Audio-Reactive Glow — Reads bass frequencies from a real-time FFT and pulses the glow brightness in sync with the music.
• Smart Auto-Pause — Pauses playback when you switch tabs or minimize the window. Resumes when you return.
• Eye-Care Filters — Adjusts video brightness, contrast, and applies a blue-light (sepia) filter for late-night viewing.
• Floating Toolbar — Adds a vertical toolbar to the player with one-click Picture-in-Picture and full-resolution PNG screenshot capture.
• Stats Overlay — Draggable HUD showing true display FPS, dropped frames, video bitrate, codec, and color space.

HOW TO USE IT

1. Install YouTube CineGlow Pro.
2. Open any YouTube video (dark mode recommended).
3. Click the CineGlow icon in the toolbar to adjust glow spread, brightness, audio boost, and other settings.
4. Settings sync across your Chrome devices automatically.

PRIVACY

Everything runs locally in your browser. No data is collected, stored, or sent to any server. Ad blocking uses declarative rules evaluated by the browser engine — the extension never reads your network traffic. Full details: https://github.com/ManoharVit/YouTube-CineGlow/blob/main/PRIVACY.md

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

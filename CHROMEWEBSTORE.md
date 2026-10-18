# Chrome Web Store Listing — YouTube CineGlow Pro

> Last Updated: 2026-10-18

## Store Listing

**Extension Name** [REQUIRED]
YouTube CineGlow Pro

**Short Description** [REQUIRED]
Ambient lighting, full audio suite, ad blocker, speed control, annotations, and cinema tools — all built into YouTube.

**Detailed Description** [REQUIRED]
If you watch YouTube in a dark room, staring at a bright video surrounded by pitch-black borders strains your eyes. CineGlow fixes that. It samples colors along the edges of every video frame in real time and projects a soft, matched ambient aura onto the page around the player — like Philips Ambilight TVs, but running directly in your browser.

Alongside ambient lighting, CineGlow packs a complete set of playback tools: a full audio suite with equalizer and bass booster, fine-grained speed control down to 0.1×, restored classic video annotations, cinema theater mode that actually centers the video, and a live stats overlay with HDR color depth information.

KEY FEATURES

🌟 AMBIENT LIGHTING
• Real-Time Ambient Glow: Samples every frame into a 128×72 canvas and blurs the edges to project a smooth, color-matched glow. Customize opacity, spread, blur, saturation, and toggle individual sides (top, bottom, left, right).
• Audio-Reactive Glow: Reads bass frequencies from a real-time FFT analyser to pulse the lighting in sync with the beat.
• Glow in Picture-in-Picture: Optionally keep the glow running when video enters PiP mode.

🎬 VIDEO & CINEMA
• Clean Cinema Theater Mode: In theater mode, hides YouTube's header and sidebar and centers the video precisely — works on all screen sizes.
• Lights Out Mode: Dims the full page around the player for a true cinema feel.
• Auto-Crop Black Bars: Detects letterbox bars and zooms the video to fill the screen.
• Ultrawide Zoom-to-Fit: Fills 21:9 ultrawide displays without pillarboxes.
• Force High-Definition: Automatically selects your preferred quality on every video (default 1080p).
• Eye-Care Filters: Per-video brightness, contrast, and sepia/blue-light filter for late-night viewing.

🔊 AUDIO SUITE
• Audio Normaliser: Applies uniform gain to match a consistent loudness target — quiet videos and loud videos play at the same perceived volume, without altering dynamics or EQ character.
• Extra Volume Boost: Amplify audio up to 300% beyond the browser limit.
• Dedicated Bass Booster: Sub-bass shelf filter (0–15 dB).
• Vocal & Speech Clarity: Presence boost targeting the vocal midrange (0–12 dB).
• 5-Band Equalizer: Precise control at 60 Hz, 250 Hz, 1 kHz, 4 kHz, 12 kHz (±12 dB per band).
• EQ Presets: Flat, Bass, Vocal, Rock, Pop, EDM — or save your own Custom setting.

⚡ PLAYBACK SPEED
• Speed range 0.1× to 10× with a fine-grained slider and three scales: Slow-Mo, Precision, and Turbo.
• Quick Presets bar: 0.25×, 0.5×, 1×, 1.5×, 2×, 5× with a single click.

🛠️ PLAYER TOOLS
• Picture-in-Picture Button: One-click PiP injected directly into the YouTube control bar — no double right-click needed.
• Screenshot: Captures a full-resolution lossless PNG of the current frame.
• Screen Recorder: Records the tab to MKV, WebM, or MP4 at 30 or 60 fps.
• Smart Ad Skipping: Automatically clicks the skip button and uses Chrome's declarative rules to block tracker network requests — no private traffic is inspected.
• Smart Auto-Pause: Pauses when you switch tabs or minimize the window; resumes when you return.

📊 QUALITY STATS OVERLAY
• Draggable HUD showing: display FPS, video FPS, dropped frames, ambient glow FPS, resolution, codec identifiers, and color depth & range (8-bit / 10-bit / 12-bit with SDR / HDR / HDR10 / HLG badge).
• Scrolling frame-timing canvas graph for visual frame pacing analysis.

🧹 TWEAKS
• Restore Classic Annotations: Brings back the original note, speech-bubble, and spotlight annotations YouTube removed in 2017.
• Return YouTube Dislike: Restores the public dislike count below the video.
• Hide YouTube Shorts: Removes Shorts shelves and feed items across all YouTube pages.
• Hide End Screens & Cards: Removes end-card overlays and info-card suggestions.
• Block AV1 / VP9 / 60fps: Forces YouTube away from specific codecs or frame rates.

PERFORMANCE & PRIVACY

• Zero Battery Drain When Idle: Rendering and audio loops stop immediately when you pause, switch tabs, or leave the watch page.
• 100% Local & Private: Frame sampling, color math, and audio processing run entirely inside your browser's local memory. No watch history or personal data is ever collected, stored, or sent to any server.
• Requires Chrome 105 or newer.

HOW TO USE

1. Install YouTube CineGlow Pro.
2. Open any video on YouTube (YouTube dark theme recommended).
3. Click the CineGlow icon in your browser toolbar to fine-tune lighting, audio, speed, and more.
4. Settings sync across your Chrome devices automatically.

SOURCE CODE

YouTube CineGlow Pro is open source: https://github.com/ManoharVit/YouTube-CineGlow

**Category** [REQUIRED]
Photos

**Single Purpose** [REQUIRED]
Projects live ambient lighting around YouTube videos and enhances playback with audio processing, speed control, ad blocking, and cinema display tools.

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
| `storage` | permissions | Saves and syncs all user preferences (glow settings, audio levels, EQ, speed, tweaks) across Chrome sessions and devices. |
| `declarativeNetRequest` | permissions | Blocks ad and tracker network requests on YouTube without reading or logging any request payload. |
| `scripting` | permissions | Registers a MAIN-world content script at runtime to override codec capability reporting for codec-blocking features. |
| `downloads` | permissions | Saves full-resolution PNG screenshots and video recordings to the user's Downloads folder. |
| `tabCapture` | permissions | Captures the tab's audio/video stream for the screen recorder feature. |
| `*://*.youtube.com/*` | host_permissions | Lets the extension inject content scripts that sample video frames, add player controls, and monitor playback state. |
| `*://*.googlevideo.com/*` | host_permissions | Required by declarativeNetRequest to match and block ad stream segments served from YouTube's video CDN. |
| `*://returnyoutubedislikeapi.com/*` | host_permissions | Fetches aggregated public dislike counts from the Return YouTube Dislike API when that feature is enabled. |

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
| 2.2.0 | 2026-10-18 | Audio suite (bass booster, vocal clarity, 5-band EQ + presets), speed control (0.1–10×), quick presets bar, classic annotations restore, return dislike, hide shorts, hide end cards, screen recorder, clean cinema theater mode (percent-based centering), stats overlay color depth & range card, audio normaliser rename, manifest minimum_chrome_version 105 | Ready to Submit |
| 2.1.2 | 2026-10-17 | Compact popup (-20% width), full-res store screenshots, black bar crop fixes | Archived |
| 2.1.0 | 2026-10-15 | New popup UI, Smart Auto-Pause, floating toolbar, Web Audio normalizer, eye-care filters, MIT license | Archived |
| 2.0.0 | 2026-10-09 | Stats overlay, PiP controls | Archived |
| 1.0.0 | 2026-10-05 | Initial release | Archived |

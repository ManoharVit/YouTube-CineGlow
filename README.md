# YouTube CineGlow Pro

I got tired of watching YouTube in a dark room and staring at a bright rectangle floating in blackness. CineGlow fixes that. It reads the edge colors from every video frame and projects a soft, color-matched glow onto the page behind the player — the same idea as Ambilight TVs, but running entirely inside a Chrome extension.

Along the way I added everything else I kept wishing YouTube had: automatic ad skipping, a full audio suite (normaliser, bass booster, vocal clarity, 5-band EQ), a playback speed wheel, a video recorder, restored classic annotations, and a clean cinema theater mode that actually centers the video.

## Showcase

| ![Ambient Lighting](store_assets/screenshot_1_ambient_lighting.png) | ![Settings Popup](store_assets/screenshot_2_settings_popup.png) |
|:---:|:---:|
| Ambient glow reacting to video edge colors | Settings popup with glow, video, and audio controls |

| ![Stats Overlay](store_assets/screenshot_3_stats_overlay.png) | ![Theatre Mode](store_assets/screenshot_4_theatre_mode.png) |
|:---:|:---:|
| Live telemetry: FPS, dropped frames, codec, color depth & range | Full-page theatre mode with centered player and edge lighting |

| ![Floating Toolbar](store_assets/screenshot_5_frame_snap.png) |
|:---:|
| Floating toolbar with PiP, speed control, screenshot, and record buttons |

## What It Does

### 🌟 Ambient Glow
- Samples each video frame into a 128×72 offscreen canvas, blurs and stretches the result behind the player to create a live ambient glow.
- Customize opacity, blur, spread, saturation, contrast, brightness, and temporal smoothness.
- Toggle glow independently per side: Top, Right, Bottom, Left.
- Pulses glow brightness in sync with bass frequencies via a real-time Web Audio FFT analyser (Audio-Reactive mode).
- Glow-in-PiP: optionally keep the glow rendering when the video enters Picture-in-Picture mode.

### 🎬 Video & Display
- **Clean Cinema Theater Mode** — in theater mode, hides the YouTube header and sidebar and centers the video with percentage-based positioning (works across all screen sizes).
- **Lights Out Cinema Mode** — dims the entire page around the player for a true cinema feel.
- **Auto-Crop Black Bars** — detects letterbox black bars on cinematic content and zooms the video to fill the screen.
- **Ultrawide Zoom-to-Fit (21:9)** — fills ultrawide displays without pillarboxes.
- Per-video **brightness**, **contrast**, and **sepia** (blue-light) filters.
- **Force High-Definition** — auto-selects your preferred quality (default 1080p) on every video.
- **Hide Page Scrollbar** — removes the browser scrollbar on watch pages.
- **Default Playback Speed** — set a preferred speed (0.1× to 2.0×) that applies automatically on load.

### 🔊 Audio Suite
- **Audio Normaliser** — applies uniform gain to match a consistent loudness target; quiet videos and loud videos play at the same perceived volume without altering dynamics or EQ.
- **Extra Volume Boost** — amplify audio up to 300% beyond the browser limit.
- **Dedicated Bass Booster** — shelf filter targeting sub-bass frequencies (0–15 dB).
- **Vocal & Speech Clarity** — presence boost targeting the vocal midrange (0–12 dB).
- **5-Band Equalizer** — precise control at 60 Hz, 250 Hz, 1 kHz, 4 kHz, and 12 kHz (±12 dB per band).
- **EQ Presets** — one-click presets: Flat, Bass, Vocal, Rock, Pop, EDM. Custom preset saves your manual adjustments.

### ⚡ Playback Speed
- Speed range **0.1× to 10×** — fine-grained slow-motion down to 0.1× and turbo mode up to 10×.
- Floating speed menu with three scales: Slow-Mo (0.1–1.0), Precision (1.0–2.0), Turbo (2.0–10.0).
- **Quick Presets bar** — single-row chips: 0.25×, 0.5×, 1×, 1.5×, 2×, 5×.
- Toast icon feedback: 🐢 for slow-mo, ⚡ for normal, 🚀 for turbo.

### 🛠️ Floating Toolbar & Buttons
- **Picture-in-Picture button** — injected directly into the YouTube player control bar (no double right-click needed). Toggles PiP with a single click.
- **Screenshot button** — captures a full-resolution lossless PNG of the current frame and saves it to Downloads.
- **Record button** — records the current video tab to MKV, WebM, or MP4 at 30 or 60 fps.
- **Speed button** — opens the speed menu inline next to the player.

### 📊 Quality Stats Overlay
- Draggable HUD showing:
  - **Display FPS** (vsync-derived), **Video FPS**, **Dropped Frames**
  - **Ambient Glow FPS** vs. configured FPS cap
  - **Resolution** (actual video dimensions)
  - **Codecs** (video + audio stream identifiers)
  - **Color Depth & Range** — 8-bit / 10-bit / 12-bit with SDR / HDR / HDR10 / HLG badge
  - **Scrolling frame-timing canvas graph**
- Toggle on/off from the popup; persists across sessions.

### 🧹 Tweaks
- **Smart AdBlock** — detects ad overlays and clicks skip; declarative network rules block tracker CDNs.
- **Return YouTube Dislike** — restores the public dislike count below the video.
- **Hide YouTube Shorts** — removes Shorts shelves and feed items from every YouTube page.
- **Restore Classic Annotations** — brings back the original note, speech-bubble, and spotlight-style video annotations that YouTube removed in 2017.
- **Hide End Screens & Cards** — removes end-card overlays and info-card suggestions.
- **Block AV1 / VP9 / 60fps** — forces YouTube away from specific codecs or frame rates.
- **Smart Auto-Pause** — pauses when you switch tabs or minimize; resumes on return.

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/ManoharVit/YouTube-CineGlow.git
   ```
2. Open Chrome → `chrome://extensions` → enable **Developer mode**.
3. Click **Load unpacked** and select the cloned folder.
4. Play any YouTube video. Dark mode gives the best visual result.

> Requires **Chrome 105 or newer**.

## How the Rendering Works

1. **Sample** — On each animation frame, `drawImage()` copies the current video frame onto a tiny 128×72 canvas.
2. **Smooth** — New pixel values are blended into the previous frame using an exponential moving average, preventing flickering during fast cuts.
3. **Display** — The canvas is scaled larger than the video and placed behind it (`z-index: -1`). CSS `blur()` and `saturate()` filters spread the color outward to produce the glow.
4. **Idle** — The rendering loop stops immediately when the video pauses, the tab loses focus, or the user navigates away from the watch page. No background CPU burn.

## Project Structure

```
manifest.json              Manifest V3 config: permissions, service worker, content scripts
background/background.js   Service worker: codec script registration and messaging
content/
  player-manager.js        Centralized player lifecycle — tracks video/SPA changes via URL
  content.js + content.css Glow renderer: canvas sampling, blur, layout, CSS variables
  stats-overlay.js + .css  Draggable HUD: FPS, frames, codec, color depth & range, canvas graph
  audio-processor.js       Web Audio: normaliser, volume boost, bass, vocal, 5-band EQ, FFT
  blackbar.js              Letterbox detection via pixel scanning on a downscaled canvas
  pip-button.js            Injects a PiP toggle button into the YouTube player controls
  screenshot-button.js     Floating toolbar button: lossless PNG frame capture
  record-button.js         Floating toolbar button: tab recording to MKV/WebM/MP4
  speed-button.js          Floating toolbar button: speed menu with slider and quick presets
  smart-pause.js           Pauses playback on tab switch or window minimize
  youtube-ads.js           Ad overlay detection and skip-button automation
  youtube-quality.js       Forces preferred resolution on video load
  annotations.js           Restores classic YouTube video annotations
  hide-endcards.js         Hides end-screen overlays and info cards
  hide-shorts.js           Hides YouTube Shorts shelves and feed items
  return-dislikes.js       Fetches and displays public dislike counts
  main-world.js            MAIN-world script for codec capability overrides
popup/
  popup.html + .css + .js  Extension popup: glow, video, audio, tools, tweaks sections
shared/defaults.js         Single source of truth for all default setting values
rules/adblock.json         Declarative network rules blocking ad/tracker domains
store_assets/              Screenshots and promo graphics for the Chrome Web Store listing
```

## Author

**Giri Manohar Vemula** · [@ManoharVit](https://github.com/ManoharVit) · [LinkedIn](https://www.linkedin.com/in/manoharv511/)

## License

[MIT](LICENSE) © 2026 Giri Manohar Vemula

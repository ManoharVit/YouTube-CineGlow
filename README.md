# YouTube CineGlow Pro

> **Version 2.1.2 Pro** — Cinematic ambient edge lighting, real-time playback telemetry HUD, floating toolbar, and precision controls for YouTube.

I built YouTube CineGlow to turn watching videos in dark rooms into an immersive, theater-like experience. While building full-stack web applications and working through my computer science coursework, I grew frustrated with static web video players and the distracting glare of high-contrast screens. CineGlow samples frames directly from the HTML5 video element, calculates the dominant edge colors, and casts a live, smooth ambient aura onto the page around the player.

## Showcase

| Cinema Ambient Lighting | Modern Glassmorphism Controls |
|:---:|:---:|
| ![Ambient Lighting](store_assets/screenshot_1_ambient_lighting.png) | ![Settings Popup](store_assets/screenshot_2_settings_popup.png) |

| Real-Time Telemetry HUD | Theatre Mode Lighting |
|:---:|:---:|
| ![Stats Overlay](store_assets/screenshot_3_stats_overlay.png) | ![Theatre Mode](store_assets/screenshot_4_theatre_mode.png) |

| Floating Toolbar & 4K Frame Snap |
|:---:|
| ![Floating Toolbar](store_assets/screenshot_5_frame_snap.png) |

## What It Does

- Projects ambient lighting around the video player by sampling frames into a small canvas and blurring the edges with CSS filters.
- Skips video ads and blocks tracker networks using declarative network rules and player skip events.
- Adds a floating vertical toolbar to the player for one-click Picture-in-Picture and full-resolution PNG screenshots.
- Normalizes uneven audio and amplifies quiet dialogue up to 300% through the Web Audio API.
- Pulses the ambient glow in sync with bass frequencies using real-time audio frequency analysis.
- Pauses playback when you switch tabs, minimize the window, or switch applications, and resumes when you return.
- Applies night mode blue-light filters and custom contrast or brightness adjustments directly to the video element.
- Detects letterbox black bars and scales the video to fill ultrawide 21:9 or standard displays.
- Displays real-time playback metrics, dropped frames, bitrate, and rendering latency in a draggable stats overlay HUD.

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/ManoharVit/YouTube-CineGlow.git
   ```
2. Open Google Chrome and navigate to `chrome://extensions`.
3. Turn on **Developer mode** in the top-right corner.
4. Click **Load unpacked** and select the extension directory.
5. Open any video on [YouTube](https://www.youtube.com). For the best visual effect, set YouTube to dark mode.

## How the Engine Works

- **Frame Sampling**: During playback, the engine copies the active video frame to an offscreen 64×36 canvas to extract edge colors.
- **Temporal Smoothing**: The renderer blends new color values into previous frames using exponential moving averages, preventing flickering during rapid scene changes.
- **Canvas & Blur**: A fixed canvas sits behind the video player (`z-index: -1`), using CSS blur and scale filters to stretch the lighting past the video boundaries.
- **Playback Lifecycle**: Animation and audio loops stop immediately when playback pauses, when switching tabs, or when leaving the watch page, keeping the browser idle.

## Project Structure

- `manifest.json`: Manifest V3 configuration defining extension permissions, service worker, and content scripts.
- `content/player-manager.js`: Tracks video lifecycle events and handles YouTube single-page navigation without page reloads.
- `content/content.js` & `content/content.css`: Renders the glow canvas and adjusts page element transparency.
- `content/pip-button.js` & `content/screenshot-button.js`: Injects the floating toolbar and captures uncompressed video frames to PNG.
- `content/stats-overlay.js` & `content/stats-overlay.css`: Real-time telemetry HUD displaying display FPS, dropped frames, bitrate, and codec diagnostics.
- `content/blackbar.js`: Detects letterbox black bars and automatically scales the video to fill the screen.
- `content/smart-pause.js`: Monitors tab visibility and window focus to pause and resume playback automatically.
- `content/audio-processor.js`: Connects Web Audio gain and analyser nodes for volume boosting and beat detection.
- `popup/`: Houses the glassmorphism settings menu, category navigation, and control toggles.
- `store_assets/`: High-resolution graphics, promo tile, and full 3K Retina showcase screenshots.
- `rules/adblock.json`: Declarative network request rules for blocking video ads and trackers.
- `shared/defaults.js`: Defines default configuration values across scripts and storage.

## Author

- **Developer**: G.Manohar.V (Giri Manohar Vemula)
- **GitHub**: [@ManoharVit](https://github.com/ManoharVit)
- **LinkedIn**: [in/manohar511](https://www.linkedin.com/in/manohar511/)
- **Repository**: [YouTube-CineGlow](https://github.com/ManoharVit/YouTube-CineGlow)

## License

[MIT License](LICENSE) © 2026 Giri Manohar Vemula

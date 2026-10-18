# YouTube CineGlow Pro — Product Specification & Technical Architecture

**Version:** 2.2.0 Pro  
**Platform:** Google Chrome Extension (Manifest V3)  
**Lead Architect:** Giri Manohar Vemula ([GitHub](https://github.com/ManoharVit) · [LinkedIn](https://www.linkedin.com/in/manoharv511/))  
**Document Generated:** October 2026  
**License:** MIT License  

---

## Generated Documents & Assets
- **PDF Document:** [`YouTube_CineGlow_Pro_Documentation.pdf`](file:///Users/girimanoharv/Downloads/Misc/aura-ambient-light/YouTube_CineGlow_Pro_Documentation.pdf) (7-page, publication-grade print specification)
- **HTML Print Template:** [`DOCUMENTATION.html`](file:///Users/girimanoharv/Downloads/Misc/aura-ambient-light/DOCUMENTATION.html)
- **Interactive Markdown Guide:** [`DOCUMENTATION.md`](file:///Users/girimanoharv/Downloads/Misc/aura-ambient-light/DOCUMENTATION.md)

---

## 1. Executive Summary & Product Overview

**YouTube CineGlow Pro** is a high-performance, privacy-first desktop browser extension engineered to elevate the YouTube video viewing experience. Standard desktop monitors present a stark, high-contrast boundary between vivid video scenes and surrounding dark room environments, inducing optical fatigue and breaking visual immersion.

CineGlow Pro solves this by real-time sampling the boundary colors of active video frames and projecting an organically diffused, color-matched glow onto the webpage behind the player—emulating high-end Ambilight television setups with zero external hardware or camera latency.

Beyond ambient lighting, CineGlow Pro integrates:
- **Dynamic Ambient Glow:** Offscreen 128×72 GPU canvas sampling with Exponential Moving Average (EMA) temporal smoothing and directional edge clipping.
- **Studio DSP Audio Suite:** Hardware-accelerated Web Audio pipeline: uniform loudness normalizer, 5-band biquad EQ, bass shelf, and vocal clarity boost.
- **Display & Aspect Ratios:** Automated letterbox black-bar cropping, 21:9 ultrawide scaling, hardware eye-care filters, and clean cinema theater centering.
- **Floating Productivity HUD:** Uncompressed PNG frame capture, in-browser video recording (WebM/MKV/MP4), native PiP, and precision speed dial (0.1× to 10×).

---

## 2. System Architecture & Lifecycle Design

```
+-----------------------------------------------------------------------------------------+
|                                    CHROME BROWSER ENGINE                                |
|                                                                                         |
|  +-----------------------------+               +-------------------------------------+  |
|  |   Background Service Worker |  sync.storage |          Popup Control Center       |  |
|  |  (background/background.js) | <-----------> |    (Glow / Video / Audio / Tools)   |  |
|  +-----------------------------+               +-------------------------------------+  |
|                 |                                                 |                     |
|  chrome.scripting / declarativeNetRequest                         | chrome.storage.sync |
|                 v                                                 v                     |
|  +-----------------------------------------------------------------------------------+  |
|  |                              YOUTUBE ACTIVE TAB RUNTIME                           |  |
|  |                                                                                   |  |
|  |  +-------------------------+                     +-----------------------------+  |  |
|  |  |    MAIN-World Script    |                     |   Central Player Manager    |  |  |
|  |  |   (content/main-world)  |                     |        (EventTarget)        |  |  |
|  |  |  MediaSource overrides  |                     |  (content/player-manager)   |  |  |
|  |  +-------------------------+                     +-----------------------------+  |  |
|  |                                                                 |                 |  |
|  |         +-----------------------+-------------------------------+                 |  |
|  |         |                       |                               |                 |  |
|  |         v                       v                               v                 |  |
|  |  +---------------+     +--------------------+          +--------------------+     |  |
|  |  |  Canvas Glow  |     |  Studio Web Audio  |          |  Floating Toolbar  |     |  |
|  |  |  GPU Sampling |     |  Normalizer & EQ   |          |  Snap, Record, PiP |     |  |
|  |  +---------------+     +--------------------+          +--------------------+     |  |
|  +-----------------------------------------------------------------------------------+  |
+-----------------------------------------------------------------------------------------+
```

### 2.1 Centralized Player Manager (`player-manager.js`)
YouTube operates as a persistent Single Page Application (SPA). During navigation between videos, `#movie_player` and the `<video>` element are recycled. CineGlow coordinates subsystem lifecycles through a centralized `PlayerManager` extending `EventTarget` (`window.CineGlowPlayer`):
- **Navigation Hooks:** Subscribes directly to YouTube's SPA lifecycle events (`yt-navigate-finish`, `yt-page-data-updated`) and monitors URL query parameters (`v=` parameter changes).
- **Transient DOM Observers:** Employs targeted `MutationObserver` instances scoped to `#movie_player`, `ytd-app`, and `ytd-watch-flexy` to track player state, theater mode, ad-interrupting states, and miniplayer transitions.
- **Cold-Load Fallback:** If YouTube's player elements have not yet mounted when a watch page loads, a 500ms safety interval polls until the nodes are acquired, disconnecting immediately once secured.
- **Consolidated `state-change` Event:** Emits a single `state-change` event (`CustomEvent('state-change', { detail: this })`) broadcasting the active player, video element, and playback flags (`isWatchPage`, `isPlaying`, `isPiP`, `isTheater`, `isFullscreen`, `isAdShowing`). Subsystems attach and detach deterministically in response to this single source of truth.

### 2.2 Dual-World Scripting Model
- **ISOLATED World:** Content scripts execute in isolated VM contexts, with protected access to extension storage and messaging APIs.
- **MAIN World (`main-world.js`):** Injected at `document_start` to intercept `HTMLMediaElement.prototype.canPlayType` and `MediaSource.isTypeSupported`, allowing users to force YouTube away from power-heavy or unaccelerated codecs (AV1, VP9).

---

## 3. Deep-Dive Subsystem Specifications

### 3.1 Ambient Lighting Engine (`content.js`, `content.css`)
- **GPU Sampling Pipeline:** Video frames are sampled onto an internal `128×72` offscreen canvas using `CanvasRenderingContext2D.drawImage()`.
- **Temporal EMA Smoothing:** Pixel buffers are processed through an Exponential Moving Average algorithm:
  $$\text{Pixel}_{\text{current}} = \alpha \cdot \text{Pixel}_{\text{new}} + (1 - \alpha) \cdot \text{Pixel}_{\text{prev}}$$
  where $\alpha$ is calibrated by the **Smoothness** slider to eliminate harsh flickering during fast cuts.
- **Directional Glow Control:** Dedicated toggles allow users to clip or disable emission across any combination of edges (**Top**, **Right**, **Bottom**, **Left**).
- **Radial Falloff Masking:** Glow diffusion is masked using CSS radial gradients:
  `mask-image: radial-gradient(ellipse farthest-side, #000 50%, transparent 100%);`
- **Audio-Reactive Pulsing:** Connects to an FFT `AnalyserNode`; bass energy spikes (40–180 Hz) dynamically scale and brighten the glow in sync with musical beats.
- **Idle Suspension:** The `requestAnimationFrame` and `requestVideoFrameCallback` loops halt when playback pauses, ends, or buffers, suspending canvas redraws and conserving CPU and GPU cycles.

### 3.2 Studio Audio DSP Pipeline (`audio-processor.js`)
YouTube's audio stream is routed through a dedicated Web Audio graph via `AudioContext.createMediaElementSource(video)`:

```
[Video Audio] ──┬──> [Normalizer Gain (Dry)] ──────────────────────────────┬──> [Bass Filter (80Hz)] ──> [Vocal Filter (2.5kHz)]
                │                                                          │
                └──> [Compressor (-24dB)] ──> [Compressed Gain (Wet)] ─────┘
                                                                               │
[Speakers] <─── [Limiter (-1dB)] <─── [Gain (100-300%)] <─── [5-Band Equalizer (60Hz - 12kHz)]
     │
     └───> [AnalyserNode (FFT)] ───> [Beat Pulse to Glow Engine]
```

- **Audio Normalizer Architecture:** Implemented via a Web Audio `DynamicsCompressorNode` (threshold: -24 dB, knee: 30 dB, ratio: 12:1, attack: 3ms, release: 250ms) paired with smooth dry/wet gain crossfading (`normalizerGain` and `compressedGain`). When enabled, loud audio peaks exceeding -24 dB are compressed with a soft knee while boosting lower-level dialogue, followed by a brickwall limiter (`threshold`: -1 dB, `ratio`: 20:1) to prevent clipping.
- **5-Band Equalizer:** Studio-grade biquad filtering across 60 Hz (Sub-Bass lowshelf), 250 Hz (Warmth peaking), 1 kHz (Midrange peaking), 4 kHz (Presence peaking), and 12 kHz (Air highshelf) with ±12 dB range.
- **One-Click Presets:** Instant acoustic profiles: *Flat*, *Bass Boost*, *Vocal Clarity*, *Rock*, *Pop*, and *Electro*.
- **Volume Overdrive:** Amplification up to 300% beyond YouTube's standard ceiling for low-gain podcasts and quiet audio tracks.

### 3.3 Intelligent Video & Display Control
- **Auto-Crop Black Bars (`blackbar.js`):** Samples video aspect ratios on an offscreen analysis canvas, automatically detecting cinematic letterboxing (2.39:1, 21:9) and scaling the video smoothly to fill the monitor.
- **Ultrawide Zoom-to-Fit:** Eliminates pillarboxing on 21:9 displays.
- **Force High-Definition (`youtube-quality.js`):** Bypasses YouTube's initial bitrate throttling, locking playback immediately to 1080p, 1440p, or 4K.
- **Eye-Care Hardware Filters:** Real-time hardware CSS filters for Brightness (50%–150%), Contrast (50%–150%), and Blue-Light Warmth Sepia (0%–100%).
- **Clean Cinema Theater Mode:** Centers the player across the full viewport while collapsing the masthead header and recommendations feed.

### 3.4 Floating Player Toolbar & Productivity Tools
- **Lossless Frame Snapshot:** Captures the uncompressed native frame directly to PNG in the user's Downloads folder.
- **In-Browser Video Recorder:** Captures video stream and audio through `MediaRecorder` directly to WebM/MKV/MP4 files at 30 or 60 fps with zero external servers.
- **Native Picture-in-Picture Button:** Injected directly into YouTube's player control bar next to theater mode.
- **Precision Speed Dial:** 0.1× to 10× continuous speed scaling with quick presets (0.25×, 0.5×, 1×, 1.5×, 2×, 5×).
- **Quality Stats Overlay (`stats-overlay.js`):** Real-time draggable HUD displaying playback FPS via `requestVideoFrameCallback`, dropped frame counters via `getVideoPlaybackQuality`, render draw timing, stream resolution, codec strings, and visual frametime history.

---

## 4. Complete Settings & Configuration Dictionary

All user preferences are persistently synchronized across devices via `chrome.storage.sync`. The table below documents the full schema and matches `shared/defaults.js`:

| Key Name | Type | Default | Domain | Functional Description |
|---|---|---|---|---|
| `enabled` | `boolean` | `true` | Master | Master enable/disable switch for ambient lighting |
| `opacity` | `number` | `75` | Glow | Glow opacity intensity (0% to 100%) |
| `spread` | `number` | `150` | Glow | Scale expansion factor of the ambient light field (100% to 400%) |
| `smoothness` | `number` | `60` | Glow | Exponential Moving Average (EMA) temporal smoothing factor (0% to 100%) |
| `blur` | `number` | `40` | Glow | Gaussian blur radius in pixels (5px to 100px) |
| `saturation` | `number` | `110` | Glow | Color saturation multiplier (50% to 250%) |
| `contrast` | `number` | `100` | Glow | Contrast enhancement curve (50% to 200%) |
| `brightness` | `number` | `100` | Glow | Luminosity brightness multiplier (50% to 200%) |
| `fadeInDuration` | `number` | `1` | Glow | Video transition fade-in duration in seconds (0s to 2s) |
| `glowTop/Right/Bottom/Left` | `boolean` | `true` | Glow | Independent edge emission toggles for all four cardinal directions |
| `audioReactive` | `boolean` | `true` | Glow/Audio | Enables real-time Web Audio FFT bass beat pulse synchronization |
| `enableInPiP` | `boolean` | `false` | Glow | Permits glow rendering on background page while in Picture-in-Picture |
| `fps` | `number` | `30` | Glow | Ambient rendering loop refresh cap (15, 30, or 60 fps) |
| `qualityEnabled` | `boolean` | `true` | Video | Forces preferred high-definition resolution on video initialization |
| `preferredQuality` | `string` | `'hd1080'` | Video | Target resolution: hd1080 (1080p), hd1440 (1440p), or hd2160 (4K) |
| `preferredSpeed` | `number` | `1.0` | Video | Persistent playback speed applied to newly loaded videos (0.1× to 2.0×) |
| `videoBrightness/Contrast` | `number` | `100` | Video | Direct video CSS hardware filter adjustment (50% to 150%) |
| `videoSepia` | `number` | `0` | Video | Eye-care blue-light reduction warm filter (0% to 100%) |
| `removeBlackBars` | `boolean` | `true` | Video | Automatic letterbox and pillarbox black-bar detection and crop |
| `ultrawideZoom` | `boolean` | `false` | Video | Enables 21:9 ultrawide monitor zoom-to-fit transformation |
| `lightsOut` | `boolean` | `false` | Video | Dims the webpage surface around the player during playback |
| `audioNormalizer` | `boolean` | `false` | Audio | Perceived loudness normalization via DynamicsCompressorNode |
| `audioBoost` | `number` | `100` | Audio | Master digital audio volume multiplier (100% to 300%) |
| `bassBoost / vocalBoost` | `number` | `0` | Audio | Low-shelf sub-bass boost (0–15 dB) / Peaking vocal clarity (0–12 dB) |
| `eq60 / 250 / 1000 / 4000 / 12000` | `number` | `0` | Audio | 5-Band Biquad Filter gains in decibels (-12 dB to +12 dB) |
| `eqPreset` | `string` | `'flat'` | Audio | Equalizer preset profile ('flat', 'bass', 'vocal', 'rock', 'pop', 'electro') |
| `adblockEnabled` | `boolean` | `true` | Tools | Enables automated skip and network-level adblocking rules |
| `statsEnabled` | `boolean` | `false` | Tools | Display draggable quality HUD telemetry overlay |
| `returnDislikes` | `boolean` | `false` | Tools | Restores public YouTube dislike counter via Return YouTube Dislike API |
| `restoreAnnotations` | `boolean` | `false` | Tools | Restores legacy interactive notes, speech bubbles, and spotlights |
| `hideShorts` | `boolean` | `false` | Tools | Removes Shorts shelves and recommendation feeds |
| `hideEndCards` | `boolean` | `true` | Tools | Suppresses post-roll end-screen cards and subscription popups |
| `blockAV1 / blockVP9` | `boolean` | `false` | Tools | Blocks AV1 or VP9 codec negotiation via MAIN-world MediaSource hooks |
| `autoPauseMode` | `string` | `'off'` | Tools | Smart auto-pause mode ('off', 'tab', or 'app') |
| `recordFormat` | `string` | `'mkv'` | Tools | Preferred recording container format ('mkv', 'webm', or 'mp4') |
| `recordFps` | `number` | `30` | Tools | Video recording framerate target (30 or 60 fps) |

---

## 5. Security, Privacy & Resource Architecture

### 5.1 Privacy & Permission Model
- **Local Storage by Default:** All user configurations reside strictly within the browser's local sandbox via `chrome.storage.sync`.
- **Declarative Network Rules:** Ad blocking is performed natively by Chromium's network stack via `declarativeNetRequest` without inspecting request payloads or browsing history.
- **External Endpoint Transparency:**
  - `returnyoutubedislikeapi.com`: Contacted only when `returnDislikes` is explicitly enabled. Transmits only the public 11-character video ID to fetch vote statistics. No cookies, auth tokens, or browsing history are sent.
  - `storage.googleapis.com`: Contacted only when `restoreAnnotations` is enabled. Fetches archived XML annotation files by video ID from a public storage bucket. No user identification is transmitted.
- **Zero Behavioral Tracking:** The extension contains no analytics SDKs, advertising libraries, or external telemetry of any kind.

### 5.2 Resource Conservation & Runtime Optimization
Rather than continuous polling loops or unthrottled render cycles, CineGlow utilizes an event-driven resource management design:
1. **Render Loop Cessation:** When video playback is paused, ended, or buffering, both `requestAnimationFrame` and `requestVideoFrameCallback` render chains halt completely. Canvas redraws cease until the player fires `playing`.
2. **Constrained Canvas Resolution:** The ambient sampling pipeline utilizes an internal `128×72` offscreen canvas. By sampling at a compact aspect ratio, pixel read/write operations remain minimal on the CPU/GPU, delegating blurring and scaling to hardware-accelerated CSS layers.
3. **Scoped Mutation Observers:** Mutation observers are strictly targeted to specific YouTube containers (`#movie_player`, `ytd-app`, `ytd-watch-flexy`) and filter by attribute names. Broad document-wide mutation observers are avoided to prevent CPU overhead during dynamic page scrolling.
4. **Decoupled Audio Graph:** Audio processing nodes use native Web Audio API biquad filters and compressors implemented in browser C++ internals, avoiding JavaScript-level audio sample processing.

---

## 6. Developer Installation & Verification

1. Clone the repository: `git clone https://github.com/ManoharVit/YouTube-CineGlow.git`
2. Open Google Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** in the top-right corner.
4. Click **Load unpacked** and select the extension directory.
5. Validate JavaScript syntax across all files:
   ```bash
   node --check popup/popup.js content/*.js background/*.js shared/*.js
   ```
6. Run the automated test suite:
   ```bash
   npm test
   ```

**Author & Lead Architect:** Giri Manohar Vemula · [GitHub: @ManoharVit](https://github.com/ManoharVit) · [LinkedIn: manoharv511](https://www.linkedin.com/in/manoharv511)  
**Project Repository:** [https://github.com/ManoharVit/YouTube-CineGlow](https://github.com/ManoharVit/YouTube-CineGlow)

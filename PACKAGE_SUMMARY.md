# Chrome Web Store Package Summary — YouTube CineGlow Pro v2.2.0

**Release Version:** `2.2.0`  
**Manifest Version:** `3` (Manifest V3 compliant)  
**Package Archive:** [`YouTube-CineGlow-v2.2.0.zip`](file:///Users/girimanoharv/Downloads/Misc/aura-ambient-light/YouTube-CineGlow-v2.2.0.zip)  
**Package Size:** `108 KB`  
**File Count:** 41 files  
**SHA-256 Checksum:** `708782dc4cc837fa178d0e4fa1ee7b5d66489f0e2f05bba75dbec006340512e9`  
**Last Updated:** October 20, 2026  

---

## 1. Quick Copy-Paste for Chrome Web Store Dashboard

### Extension Identity
| Field | Value | Constraints |
|---|---|---|
| **Extension Name** | `YouTube CineGlow Pro` | Max 45 chars (Current: 20 chars) |
| **Short Name** | `CineGlow Pro` | Max 12 chars (Current: 12 chars) |
| **Version** | `2.2.0` | Matches `manifest.json` & `package.json` |
| **Category** | `Photos` / `Accessibility` | Single primary category |
| **Primary Language** | `English` | |

### Short Description / Summary (104 characters, limit 132)
```text
Add ambient lighting to YouTube, adjust audio and playback speed, and keep useful player tools close by.
```

### Manifest Description (117 characters, limit 132)
```text
Ambient lighting, audio EQ & booster, playback speed, cinema tools, screenshots, and live stats — built into YouTube.
```

### Single Purpose Declaration
```text
Customise YouTube viewing with ambient lighting and related playback, audio, display, and player controls.
```

---

## 2. Release Notes / "What's New in v2.2.0" (for Reviewers & Users)

```text
Version 2.2.0 Major Update:
• Redesigned Quiet Popup Interface: Streamlined compact card layout, clean Glow controls, and active toggle indicators.
• Quick Tab Reload Button: One-click refresh button in the popup header for instant runtime synchronization.
• Letterbox Auto-Crop Engine: Automatic cinematic black bar detection with smooth 21:9 scaling.
• Studio Audio Suite: 5-band graphic equalizer, dedicated bass and vocal presence boosters, and dynamics audio normalization.
• Real-time Telemetry HUD: Draggable canvas frame-timing graph, dropped frame tracking, and codec diagnostics.
• Player Toolbar: Dedicated vertical controls for Picture-in-Picture, high-res frame capture (PNG), and native recording.
• Store Assets & Media: Full-resolution store screenshots (1.5 MB – 2.5 MB) and 1080p narrated demonstration video.
```

---

## 3. Permissions Justifications (CWS Submission Form)

| Permission / Host | Type | Justification to Enter in Developer Dashboard |
|---|---|---|
| `storage` | Permission | Required to save user display settings, audio equalizer presets, and ad-skip counters via `chrome.storage.sync` and cache annotation XML locally. |
| `declarativeNetRequest` | Permission | Required to apply high-efficiency bundled network rules for tracker blocking and video CDN download header handling without inspecting request payloads. |
| `scripting` | Permission | Required to register dynamic MAIN-world scripts for user-selected video codec preferences (AV1, VP9) and 60 FPS stream limits. |
| `downloads` | Permission | Required to save high-resolution lossless PNG frame snapshots and video recordings directly to the user's Downloads folder upon request. |
| `*://*.youtube.com/*` | Host Permission | Required to inject the ambient glow rendering canvas, audio processor graph, and player control toolbar into YouTube watch pages. |
| `*://*.googlevideo.com/*` | Host Permission | Required for declarative net request rule evaluation and CORS header adjustment during direct media downloads. |
| `https://returnyoutubedislikeapi.com/*` | Host Permission | Optional feature: fetches public community dislike counts from the official Return YouTube Dislike API when enabled by the user. |
| `https://storage.googleapis.com/*` | Host Permission | Optional feature: fetches archived community annotation XML files when the Classic Annotations toggle is enabled by the user. |

---

## 4. Store Assets Checklist

| Asset Type | Required Dimensions | Recommended Size | Project File Path |
|---|---|---|---|
| **Store Icon** | 128 × 128 px (PNG) | < 50 KB | [`icons/icon-128.png`](file:///Users/girimanoharv/Downloads/Misc/aura-ambient-light/icons/icon-128.png) |
| **Small Promo Tile** | 440 × 280 px (PNG) | < 500 KB | [`store_assets/promo_tile_440x280.png`](file:///Users/girimanoharv/Downloads/Misc/aura-ambient-light/store_assets/promo_tile_440x280.png) |
| **Marquee Promo Tile** | 1400 × 560 px (PNG) | 1.5 – 2.5 MB | [`store_assets/marquee_promo_1400x560.png`](file:///Users/girimanoharv/Downloads/Misc/aura-ambient-light/store_assets/marquee_promo_1400x560.png) (2.24 MB) |
| **Screenshot 1: Ambient Lighting** | 1894 × 1141 px (PNG) | 1.5 – 2.5 MB | [`store_assets/screenshot_1_ambient_lighting.png`](file:///Users/girimanoharv/Downloads/Misc/aura-ambient-light/store_assets/screenshot_1_ambient_lighting.png) (2.12 MB) |
| **Screenshot 2: Playback Settings** | 1395 × 756 px (PNG) | 1.5 – 2.5 MB | [`store_assets/screenshot_2_playback_settings.png`](file:///Users/girimanoharv/Downloads/Misc/aura-ambient-light/store_assets/screenshot_2_playback_settings.png) (1.99 MB) |
| **Screenshot 3: Quality Stats HUD** | 1561 × 846 px (PNG) | 1.5 – 2.5 MB | [`store_assets/screenshot_3_stats_overlay.png`](file:///Users/girimanoharv/Downloads/Misc/aura-ambient-light/store_assets/screenshot_3_stats_overlay.png) (2.17 MB) |
| **Screenshot 4: Clean Theater Mode** | 1561 × 846 px (PNG) | 1.5 – 2.5 MB | [`store_assets/screenshot_4_theatre_mode.png`](file:///Users/girimanoharv/Downloads/Misc/aura-ambient-light/store_assets/screenshot_4_theatre_mode.png) (1.77 MB) |
| **Screenshot 5: Frame Snap & Tools** | 1395 × 757 px (PNG) | 1.5 – 2.5 MB | [`store_assets/screenshot_5_frame_snap.png`](file:///Users/girimanoharv/Downloads/Misc/aura-ambient-light/store_assets/screenshot_5_frame_snap.png) (1.96 MB) |
| **Screenshot 6: Auto-Crop Black Bars** | 1395 × 757 px (PNG) | 1.5 – 2.5 MB | [`store_assets/screenshot_autocrop_blackbars.png`](file:///Users/girimanoharv/Downloads/Misc/aura-ambient-light/store_assets/screenshot_autocrop_blackbars.png) (1.94 MB) |
| **Demonstration Video** | 1920 × 1080 px (MP4, 4.2+ Mbps) | < 100 MB | [`YouTube_CineGlow_Pro_Demo.mp4`](file:///Users/girimanoharv/Downloads/Misc/aura-ambient-light/YouTube_CineGlow_Pro_Demo.mp4) (25.59 MB) |

---

## 5. Developer & Publisher Attribution
- **Publisher:** Giri Manohar Vemula
- **Contact:** girimanohar.v@gmail.com
- **LinkedIn Profile:** https://www.linkedin.com/in/manoharv511
- **GitHub Repository:** https://github.com/ManoharVit/YouTube-CineGlow
- **Privacy Policy:** https://github.com/ManoharVit/YouTube-CineGlow/blob/main/PRIVACY.md

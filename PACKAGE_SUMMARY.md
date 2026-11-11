# Chrome Web Store Package Summary — CineGlow Pro for YouTube v2.3.0

**Release Version:** `2.3.0`  
**Manifest Version:** `3` (Manifest V3 compliant)  
**Package Archive:** [`YouTube-CineGlow-v2.3.0.zip`](file:///Users/girimanoharv/Downloads/Misc/aura-ambient-light/YouTube-CineGlow-v2.3.0.zip)  
**Package Size:** `112 KB`  
**File Count:** 42 entries (36 files, 6 directories)  
**SHA-256 Checksum:** `565e5ea223cc6eeb4a4ffbdbbc27706ff8f8fcc92023cc46c50432f9096d54d4`  
**Last Updated:** November 12, 2026  

---

## 1. Quick Copy-Paste for Chrome Web Store Dashboard

### Extension Identity
| Field | Value | Constraints |
|---|---|---|
| **Extension Name** | `CineGlow Pro for YouTube` | Max 45 chars (Current: 24 chars) |
| **Short Name** | `CineGlow Pro` | Max 12 chars (Current: 12 chars) |
| **Version** | `2.3.0` | Matches `manifest.json` & `package.json` |
| **Category** | `Photos` / `Accessibility` | Single primary category |
| **Primary Language** | `English` | |

### Short Description / Summary (125 characters, limit 132)
```text
Soft ambient lighting, balanced audio with EQ and volume boost, cleaner cinema layouts, and quick playback tools for YouTube.
```

### Manifest Description (125 characters, limit 132)
```text
Soft ambient lighting, balanced audio with EQ and volume boost, cleaner cinema layouts, and quick playback tools for YouTube.
```

### Single Purpose Declaration
```text
Customise YouTube viewing with ambient lighting and related playback, audio, display, and player controls.
```

---

## 2. Release Notes / "What's New in v2.3.0" (for Reviewers & Users)

```text
Version 2.3.0:
• Updated extension name to "CineGlow Pro for YouTube" to comply strictly with Chrome Web Store trademark policies.
• Removed unused downloads permission and internal video streaming host permissions to adhere to minimum privilege.
• Refined video ad controller to preserve user-muted video preferences, bound unmuting strictly to modified video elements, and restore playback speed/mute when AdBlock is disabled mid-ad.
• Added dynamic audio headroom scaling across all volume levels when heavy EQ or bass boost is applied to prevent distortion.
• Fixed Web Audio node retention so re-navigating to an existing video element seamlessly reconnects its audio source.
• Fixed classic annotations to default to disabled and load settings prior to initializing or dispatching network requests.
• Aligned Auto-HD quality defaults with shared configuration so HD resolution is active on fresh installs.
• Enhanced video recording lifecycle to capture recording format settings at start, derive extensions from actual containers, and prevent mid-recording format mislabeling.
• Added a 550ms trailing-edge throttle to popup settings sync, and cancelled pending writes on section resets to guarantee default preservation.
• Corrected accessibility label attributes across settings toggles for seamless screen reader navigation.
```

---

## 3. Permissions Justifications (CWS Submission Form)

| Permission / Host | Type | Justification to Enter in Developer Dashboard |
|---|---|---|
| `storage` | Permission | Required to save user display settings, audio equalizer presets, and ad-skip counters via `chrome.storage.sync` and cache annotation XML locally. |
| `declarativeNetRequest` | Permission | Required to apply high-efficiency bundled network rules for tracker blocking without inspecting request payloads. |
| `scripting` | Permission | Required to register dynamic MAIN-world scripts for user-selected video codec preferences (AV1, VP9) and 60 FPS stream limits. |
| `https://*.youtube.com/*` | Host Permission | Required to inject the ambient glow rendering canvas, audio processor graph, and player control toolbar into YouTube watch pages. Enforces pure HTTPS transport. |
| `https://returnyoutubedislikeapi.com/*` | Host Permission | Optional feature: fetches public community dislike counts from the official Return YouTube Dislike API when enabled by the user (subject to enterprise policy override). |
| `https://biggest_bucket.storage.googleapis.com/*` | Host Permission | Optional feature: fetches archived community annotation XML files from isolated bucket origin when Classic Annotations is enabled (subject to enterprise policy override). |

---

## 4. Store Assets Checklist

| Asset Type | Required Dimensions | Recommended Size | Project File Path |
|---|---|---|---|
| **Store Icon** | 128 × 128 px (PNG) | < 50 KB | [`icons/icon-128.png`](file:///Users/girimanoharv/Downloads/Misc/aura-ambient-light/icons/icon-128.png) |
| **Small Promo Tile** | 440 × 280 px (PNG) | < 500 KB | [`store_assets/promo_tile_440x280.png`](file:///Users/girimanoharv/Downloads/Misc/aura-ambient-light/store_assets/promo_tile_440x280.png) |
| **Marquee Promo Tile** | 1400 × 560 px (PNG) | 1.5 – 2.5 MB | [`store_assets/marquee_promo_1400x560.png`](file:///Users/girimanoharv/Downloads/Misc/aura-ambient-light/store_assets/marquee_promo_1400x560.png) (2.24 MB) |
| **Screenshot 1: Ambient Lighting** | 1280 × 800 px (PNG) | 0.9 – 2.0 MB | [`store_assets/screenshot_1_ambient_lighting.png`](file:///Users/girimanoharv/Downloads/Misc/aura-ambient-light/store_assets/screenshot_1_ambient_lighting.png) (985 KB) |
| **Screenshot 2: Playback Settings** | 1280 × 800 px (PNG) | 0.9 – 2.0 MB | [`store_assets/screenshot_2_playback_settings.png`](file:///Users/girimanoharv/Downloads/Misc/aura-ambient-light/store_assets/screenshot_2_playback_settings.png) (1.4 MB) |
| **Screenshot 3: Quality Stats HUD** | 1280 × 800 px (PNG) | 0.9 – 2.0 MB | [`store_assets/screenshot_3_stats_overlay.png`](file:///Users/girimanoharv/Downloads/Misc/aura-ambient-light/store_assets/screenshot_3_stats_overlay.png) (1.3 MB) |
| **Screenshot 4: Clean Theater Mode** | 1280 × 800 px (PNG) | 0.9 – 2.0 MB | [`store_assets/screenshot_4_theatre_mode.png`](file:///Users/girimanoharv/Downloads/Misc/aura-ambient-light/store_assets/screenshot_4_theatre_mode.png) (1.1 MB) |
| **Screenshot 5: Frame Snap & Tools** | 1280 × 800 px (PNG) | 0.9 – 2.0 MB | [`store_assets/screenshot_5_frame_snap.png`](file:///Users/girimanoharv/Downloads/Misc/aura-ambient-light/store_assets/screenshot_5_frame_snap.png) (1.4 MB) |
| **Alternate / Crop Black Bars** | 1280 × 800 px (PNG) | 0.9 – 2.0 MB | [`store_assets/screenshot_autocrop_blackbars.png`](file:///Users/girimanoharv/Downloads/Misc/aura-ambient-light/store_assets/screenshot_autocrop_blackbars.png) (1.2 MB) |
| **Demonstration Video** | 1920 × 1080 px (MP4, 4.2+ Mbps) | < 100 MB | [`store_assets/YouTube_CineGlow_Pro_Demo.mp4`](file:///Users/girimanoharv/Downloads/Misc/aura-ambient-light/store_assets/YouTube_CineGlow_Pro_Demo.mp4) (26.8 MB) |

---

## 5. Developer & Publisher Attribution
- **Publisher:** Giri Manohar Vemula
- **Contact:** girimanohar.v@gmail.com
- **LinkedIn Profile:** https://www.linkedin.com/in/manoharv511
- **GitHub Repository:** https://github.com/ManoharVit/YouTube-CineGlow
- **Privacy Policy:** https://github.com/ManoharVit/YouTube-CineGlow/blob/main/PRIVACY.md

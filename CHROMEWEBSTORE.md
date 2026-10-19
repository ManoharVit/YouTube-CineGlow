# Chrome Web Store listing: YouTube CineGlow Pro

Updated: October 20, 2026

## Listing copy

**Extension name**  
YouTube CineGlow Pro

**Short description**  
Add ambient lighting to YouTube, adjust audio and playback speed, and keep useful player tools close by.

**Detailed description**

CineGlow adds a soft glow around the YouTube player that follows the colours in the video. Keep it faint for a little background light, or increase the spread and saturation for a more noticeable effect.

It also brings together playback controls that would otherwise need separate tools: an equaliser, volume and vocal controls, a speed menu, screenshots, video recording, and a cleaner theatre layout. Adjust them from the extension popup or use the floating toolbar while watching.

AMBIENT LIGHTING

- Adjust opacity, spread, blur, saturation, contrast, brightness, and smoothness.
- Turn the glow on or off for each edge of the player.
- Let bass energy change the glow's size and brightness with audio-reactive mode.
- Optionally keep the glow on the original page while the video is in picture-in-picture.

VIDEO AND LAYOUT

- Centre the player and hide the surrounding header and recommendations in cinema theatre mode.
- Dim the page around the player with Lights Out.
- Detect and crop black borders, or use the separate zoom option for 21:9 displays. Cropping can remove part of the image.
- Adjust video brightness, contrast, and sepia warmth.
- Choose 720p, 1080p, 1440p, 4K, or the maximum available quality for each video.
- Hide the watch-page scrollbar.

AUDIO CONTROLS

- Use the Audio Normaliser's compression to reduce differences between quieter and louder passages.
- Raise volume from 100% to 300% of the normal level.
- Add bass with up to 15 dB of boost, or bring vocals forward with up to 12 dB of presence boost.
- Adjust five EQ bands: 60 Hz, 250 Hz, 1 kHz, 4 kHz, and 12 kHz, each with a ±12 dB range.
- Start with Flat, Bass, Vocal, Rock, Pop, or EDM presets, then make your own adjustments.

PLAYBACK AND PLAYER TOOLS

- Set playback speed from 0.1× to 10× in the floating speed menu.
- Jump to 0.25×, 0.5×, 1×, 1.5×, 2×, or 5× with the quick presets.
- Open picture-in-picture from the player toolbar.
- Save the current video frame as a PNG at its source resolution.
- Record the video image and available video audio, with MKV, WebM, and MP4 format preferences at 30 or 60 fps. Recordings fit within 1080p; available formats depend on browser support. The recorder captures the video, not the whole tab or desktop.
- Pause playback when you leave the tab or Chrome window, according to your auto-pause setting.

STATS AND OPTIONAL TWEAKS

The draggable stats panel shows frame rates, dropped frames, glow update rate, video dimensions, codec details, and a frame-timing graph. Colour-depth and SDR/HDR labels use the metadata available from YouTube.

You can also hide Shorts, end screens, and cards; request alternatives to AV1, VP9, or 60 fps streams; and enable ad skipping with bundled ad and tracker request rules. Ad skipping and page changes depend on YouTube's current layout and may need updates.

Two optional features fetch information from outside YouTube: Return YouTube Dislike retrieves community vote counts, and Restore Classic Annotations loads archived notes and speech bubbles where available. Both are off by default.

STORAGE AND PRIVACY

Lighting and audio processing run in the browser. Screenshots and recordings save to your computer. Preferences use Chrome Sync, so they can follow your signed-in account when sync is enabled; archived annotations are cached locally.

The optional dislike and annotation features send the public video ID to the relevant service. CineGlow does not include developer-run analytics or telemetry. Read the privacy policy for the storage and request details.

GET STARTED

1. Install CineGlow and open a YouTube video.
2. Click the CineGlow toolbar icon to adjust lighting, audio, and other options.
3. Try YouTube's dark theme if you want the glow to stand out more.

The manifest declares Chrome 105 as the minimum version. Media formats and individual features depend on the browser's available APIs and codecs.

SOURCE CODE

https://github.com/ManoharVit/YouTube-CineGlow

**Category**  
Photos

**Single purpose**  
Customise YouTube viewing with ambient lighting and related playback, audio, display, and player controls.

**Primary language**  
English

## Graphics and assets

| Asset | Current file dimensions | File |
|---|---|---|
| Store icon | 128×128 | `icons/icon-128.png` |
| Small icon | 48×48 | `icons/icon-48.png` |
| Toolbar icon | 16×16 | `icons/icon-16.png` |
| Ambient lighting screenshot | 1894×1141 | `store_assets/screenshot_1_ambient_lighting.png` |
| Playback settings screenshot | 1395×756 | `store_assets/screenshot_2_playback_settings.png` |
| Stats screenshot | 1561×846 | `store_assets/screenshot_3_stats_overlay.png` |
| Theatre screenshot | 1561×846 | `store_assets/screenshot_4_theatre_mode.png` |
| Toolbar screenshot | 1395×757 | `store_assets/screenshot_5_frame_snap.png` |
| Letterbox auto-crop screenshot | 1395×757 | `store_assets/screenshot_autocrop_blackbars.png` |
| Small promo tile | 440×280 | `store_assets/promo_tile_440x280.png` |
| Marquee promo | 1400×560 | `store_assets/marquee_promo_1400x560.png` |

## Permission explanations

This table follows the permissions in the current `manifest.json`.

| Permission or host | Type | Use |
|---|---|---|
| `storage` | Permission | Save preferences and the ad-skip counter through Chrome Sync; cache annotation XML locally. |
| `declarativeNetRequest` | Permission | Apply bundled ad/tracker rules and the download-header rule without logging request bodies. |
| `scripting` | Permission | Register page-context scripts for the selected codec and frame-rate blocking options. |
| `downloads` | Permission | Save screenshots and recordings, and handle download requests. |
| `*://*.youtube.com/*` | Host permission | Run the player, glow, audio, and control scripts on YouTube pages. |
| `*://*.googlevideo.com/*` | Host permission | Apply the network-rule and download-header handling for YouTube's video CDN. |
| `https://returnyoutubedislikeapi.com/*` | Host permission | Retrieve community vote counts when dislike restoration is enabled. |
| `https://storage.googleapis.com/*` | Host permission | Retrieve archived annotation XML when annotation restoration is enabled. |

The current manifest does not request `tabCapture`. Recording uses the video element and a canvas stream.

## Data use

The extension handles synced preferences, an ad-skip counter, optional video-ID lookups, an annotation cache, and user-requested media downloads. The privacy policy describes these separately rather than treating all of them as local-only storage.

The project's data-use declarations are:

- Data is not sold to third parties.
- Data is not used for purposes unrelated to the extension's functionality.
- Data is not used for creditworthiness or lending purposes.

## Privacy policy and distribution

**Privacy policy URL:** https://github.com/ManoharVit/YouTube-CineGlow/blob/main/PRIVACY.md  
**Visibility:** Public  
**Regions:** All regions

## Developer details

**Publisher:** Giri Manohar Vemula  
**Contact:** girimanohar.v@gmail.com  
**Source and support:** https://github.com/ManoharVit/YouTube-CineGlow  
**LinkedIn:** https://www.linkedin.com/in/manoharv511

## Project version history

| Version | Date | Changes | Listing status |
|---|---|---|---|
| 2.2.0 | 2026-10-20 | Quiet compact UI redesign with Glow controls, quick tab reload button, calibrated high-res store assets (1.5–2.5 MB), letterbox auto-crop screenshot, narrated 1080p demo video, and documentation overhaul | Ready to Submit |
| 2.1.2 | 2026-10-17 | Smaller popup, store screenshots, and black-border crop fixes | Archived |
| 2.1.0 | 2026-10-15 | Popup redesign, auto-pause, floating toolbar, audio normaliser, video filters, and MIT licence | Archived |
| 2.0.0 | 2026-10-09 | Stats overlay and PiP controls | Archived |
| 1.0.0 | 2026-10-05 | Initial release | Archived |

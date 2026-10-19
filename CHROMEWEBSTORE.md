# Chrome Web Store listing: YouTube CineGlow Pro

Updated: October 20, 2026

## Listing copy

**Extension name**  
YouTube CineGlow Pro

**Short description**  
Soft ambient lighting, balanced audio with EQ and volume boost, cleaner cinema layouts, and quick playback tools for YouTube.

**Detailed description**

Turn your YouTube sessions into a comfortable, theater-like experience. 

CineGlow wraps your video player in a soft, responsive ambient glow that matches the colors on screen in real time. It softens the harsh contrast between your bright monitor and a dark room, cutting down on eye fatigue while making movies, music videos, and gaming streams feel much more immersive. Keep the glow faint and gentle for casual watching, or crank up the spread and saturation for a full living-room atmosphere.

Beyond lighting, CineGlow brings together the everyday controls you usually have to hunt down in three different extensions: an audio leveler that saves your ears from sudden volume spikes, a graphic equalizer, a clean floating speed dial, one-click screenshot capture, and a distraction-free theater mode.

---

AMBIENT LIGHTING THAT FITS YOUR ROOM

• Smooth Color Matching: The glow updates fluidly with on-screen action, gently blending colors behind the player.
• Independent Edge Controls: Turn lighting on or off for the top, bottom, left, or right sides. (Great if you want light on the wall, but not reflecting off your desk.)
• Customizable Look: Dial in exactly how much blur, spread, brightness, saturation, and contrast you want.
• Audio-Reactive Mode: Watch the lighting subtly pulse and expand with the rhythm of the bass in music videos and concerts.
• Picture-in-Picture Friendly: Keep the ambient mood on your main tab even when popping the video out into a floating window.

SOUND CONTROLS THAT ACTUALLY WORK

• Audio Normalizer: Say goodbye to quiet whispers followed by deafening explosions or loud ads. The normalizer evens out volume peaks so you can set your volume once and relax.
• Volume Boost: Running on quiet laptop speakers? Safely boost audio up to 300% without nasty distortion.
• Bass & Vocal Boosters: Add warmth and punch to music with dedicated bass boost, or bring vocals forward for crisp speech on podcasts, audiobooks, and tutorials.
• 5-Band Graphic Equalizer: Fine-tune 60 Hz, 250 Hz, 1 kHz, 4 kHz, and 12 kHz with ±12 dB sliders, or jump straight to curated presets (Rock, Pop, EDM, Bass, Vocal, or Flat).

CLEANER VIDEO & CINEMA LAYOUTS

• Centered Cinema Theater Mode: Gives your video the spotlight by centering the player and hiding the cluttered sidebar, recommendations, and header.
• Lights Out: Dims the surrounding web page so your focus stays right on the content.
• Auto-Crop Black Bars: Automatically detects cinematic letterboxing on movies and widescreen trailers, expanding the picture to use your whole display.
• Ultrawide Zoom-to-Fit: Fills 21:9 ultrawide screens smoothly with one toggle.
• Video Filter Sliders: Tweak brightness, contrast, or warm up the color temperature with a soothing sepia night filter to help you wind down before sleep.
• Quality Memory: Automatically defaults each video to your preferred resolution (720p, 1080p, 1440p, or 4K) whenever available.

HANDY PLAYER TOOLS RIGHT WHERE YOU NEED THEM

• Pristine Frame Snap: Save high-resolution PNG screenshots from any video at its native source quality—no paused icons, scrub bars, or subtitles getting in the way.
• Floating Player Toolbar: Quick, unobtrusive vertical buttons for Picture-in-Picture, speed control, snapshots, and direct video recording.
• Precision Speed Control: Go from 0.1× slow motion all the way to 10× high-speed scrubbing, with quick one-tap buttons for 0.25×, 0.5×, 1×, 1.5×, 2×, and 5×.
• Smart Auto-Pause: Automatically pauses when you switch tabs or minimize Chrome, and picks right back up when you return.

REAL-TIME PLAYBACK TELEMETRY

• Curious about performance? Open the draggable stats panel to see real-time frame rates, dropped frame counts, stream resolution, active codecs (AV1, VP9, H.264), and a live visual frame-timing graph.

PRIVACY FIRST & BUILT TO STAY QUIET

• Everything processes locally on your computer.
• No account required, no remote trackers, and no third-party telemetry.
• Your preferences sync smoothly across your signed-in Chrome browsers using standard Google sync storage.
• Clean, lightweight code that rests when the video is paused to save battery and CPU cycles.

HOW TO GET STARTED

1. Install CineGlow and open any YouTube video.
2. Click the CineGlow icon in your browser toolbar to open your controls.
3. Switch YouTube to dark mode for the best lighting effect, pick your favorite glow and audio preset, and enjoy the show!

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
| 2.2.0 | 2026-10-20 | Redesigned the settings popup with a clean, quiet card layout; added a one-click tab reload button; improved black bar auto-crop for widescreen movies; refreshed store visuals to high-res; and added a narrated 1080p demo walkthrough | Ready to Submit |
| 2.1.2 | 2026-10-17 | Tuned popup sizing for small screens, improved black border detection accuracy, and upgraded the store screenshot gallery | Archived |
| 2.1.0 | 2026-10-15 | Introduced the floating player toolbar, audio normalizer to curb volume spikes, eye-care video night filters, and smart auto-pause on tab switch | Archived |
| 2.0.0 | 2026-10-09 | Added real-time playback telemetry HUD with a frame-timing graph, plus ambient lighting support in Picture-in-Picture | Archived |
| 1.0.0 | 2026-10-05 | Initial release with reactive real-time ambient lighting and custom color controls | Archived |

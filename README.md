# Aura – Ambient Light for YouTube

A lightweight Chrome extension (Manifest V3) that adds a soft, color-matched glow around YouTube videos.

## Install (developer mode)

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top-right)
3. Click **Load unpacked** and select this `aura-ambient-light` folder
4. Open any YouTube video. For the best effect, use YouTube's **dark theme**.

Click the toolbar icon to change intensity, blur, spread, saturation, brightness, smoothness, and frame rate. Changes apply right away.

After you edit the code, click the ↻ reload button on the extension card, then refresh the YouTube tab.

## How it works

| Step | What happens |
|------|--------------|
| Sample | Each frame, the video is drawn into a tiny 64×36 canvas (cheap to do) |
| Smooth | New frames are blended over old ones, so colors change gradually |
| Scale & blur | The canvas is stretched past the video's edges and blurred/saturated with CSS filters on the GPU |
| Place | The canvas sits behind the page (`z-index: -1`) and follows the video's position every frame |

To save power, it stops drawing when the video is paused, runs only on `/watch` pages, and turns off in fullscreen and the miniplayer.

## Project layout

```
manifest.json          MV3 manifest (only the "storage" permission)
shared/defaults.js     Default settings, used by the content script and popup
content/content.js     Glow engine
content/content.css    Glow layer + transparency overrides used while active
popup/                 Settings UI
icons/                 Generated PNG icons
tools/generate_icons.py  Rebuilds the icons (standard library only)
```

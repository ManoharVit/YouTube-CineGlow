# Privacy Policy — YouTube CineGlow Pro

Last updated: October 17, 2026

YouTube CineGlow Pro is developed by Giri Manohar Vemula. This document explains what data the extension accesses and how it handles that data.

## No Data Collection

The extension does not collect, store, or transmit any personal information. It does not track browsing history, record keystrokes, or assign user identifiers.

## What Gets Stored Locally

Your settings — glow intensity, blur radius, audio boost level, preferred resolution, auto-pause mode, and similar preferences — are saved using `chrome.storage.sync`. This keeps your configuration consistent across Chrome sessions on the same Google account. Nothing leaves Chrome's built-in sync mechanism.

## How Network and Media Are Handled

- **Ad blocking** uses `declarativeNetRequest` rules. The browser engine evaluates these rules internally. The extension never reads or logs your network traffic.
- **Frame sampling** for the ambient glow copies pixels from the `<video>` element into a small in-memory canvas. No frames are saved, uploaded, or sent anywhere.
- **Audio normalization** connects Web Audio API nodes to the video element in local memory. No audio data is recorded or transmitted.
- **Screenshots** render a single video frame to a `<canvas>`, convert it to PNG, and trigger a download to your local machine. The image data never leaves your browser.

## Third-Party Services & Network Requests

The extension operates locally by default. When specific optional features are enabled by the user, the background service worker communicates with the following external endpoints:

1. **Return YouTube Dislike API (`returnyoutubedislikeapi.com`)**:
   - **Feature**: Restore Dislike Counter (`returnDislikes`).
   - **Data Transmitted**: Only the public 11-character YouTube video ID (e.g., `?videoId=dQw4w9WgXcQ`).
   - **Purpose**: Retrieves public community like/dislike statistics.
   - **Privacy Guarantee**: No cookies, authentication tokens, personal identifiers, or browsing history are sent.

2. **Classic YouTube Annotations Archive (`storage.googleapis.com`)**:
   - **Feature**: Restore Annotations (`restoreAnnotations`).
   - **Data Transmitted**: The public YouTube video ID in the archive file path.
   - **Purpose**: Fetches public archived XML annotation files created prior to YouTube's 2019 annotation deprecation.
   - **Privacy Guarantee**: No user accounts, credentials, or tracking metrics are transmitted. Downloaded XML is cached locally in `chrome.storage.local`.

The extension contains zero advertising libraries, zero behavioral tracking scripts, and zero telemetry analytics SDKs.

## Contact

- **Developer / Lead Architect**: Giri Manohar Vemula
- **Email**: girimanohar.v@gmail.com
- **LinkedIn**: [https://www.linkedin.com/in/manoharv511](https://www.linkedin.com/in/manoharv511)
- **GitHub**: [https://github.com/ManoharVit/YouTube-CineGlow](https://github.com/ManoharVit/YouTube-CineGlow)

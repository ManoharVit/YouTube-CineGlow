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

## Third-Party Services

None. The extension contains no analytics SDKs, advertising libraries, or external telemetry of any kind.

## Contact

- **Developer**: Giri Manohar Vemula
- **Email**: girimanohar.v@gmail.com
- **GitHub**: [https://github.com/ManoharVit/YouTube-CineGlow](https://github.com/ManoharVit/YouTube-CineGlow)

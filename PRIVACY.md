# Privacy Policy for YouTube CineGlow Pro

Last updated: October 15, 2026

YouTube CineGlow Pro ("we", "our", or "the extension") is developed by Giri Manohar Vemula. We respect your privacy and are committed to protecting it.

## 1. No Personal Data Collection

YouTube CineGlow Pro does not collect, track, log, or sell any personal information, browsing history, keystrokes, or user identifiers.

## 2. Local Data Storage

The extension uses `chrome.storage.sync` strictly to persist your customized preferences across your browser sessions, including:
- Ambient lighting settings (glow intensity, spread, blur, saturation, brightness)
- Directional glow toggles
- Audio normalization and boost levels
- Preferred video resolution settings
- Smart Auto-Pause mode selection
- Quality overlay and toolbar display preferences
- Total skipped ad counter

All stored preferences remain entirely on your device and are synchronized solely through your personal Google Account via standard Chrome synchronization. No data is ever transmitted to external servers or third-party databases.

## 3. Network and Content Handling

- **Declarative Network Requests**: The extension uses declarative network filtering rules to block known video advertising and analytics requests directly within the browser engine without reading or logging your network payload.
- **Local Media Processing**: Frame sampling for ambient lighting and audio normalization via the Web Audio API operate entirely in real-time in your local browser memory. No audio, video, or image data is ever recorded, stored, or sent off-device.
- **Local Screenshots**: Video screenshots captured using the toolbar are converted to PNG in your browser's local memory and downloaded directly to your computer.

## 4. Third-Party Services

The extension does not integrate any third-party analytics (such as Google Analytics or Mixpanel), advertising networks, or external telemetry libraries.

## 5. Contact

If you have any questions or feedback regarding this privacy policy, you can contact the developer:
- **Developer**: Giri Manohar Vemula
- **Email**: girimanohar.v@gmail.com
- **GitHub**: [https://github.com/ManoharVit/YouTube-CineGlow](https://github.com/ManoharVit/YouTube-CineGlow)

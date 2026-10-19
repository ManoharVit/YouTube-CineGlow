# Privacy policy: YouTube CineGlow Pro

Last updated: October 20, 2026

YouTube CineGlow Pro is developed by Giri Manohar Vemula. This policy describes the extension's storage, media processing, and optional network requests.

## Information saved by the extension

CineGlow saves your preferences, including lighting levels, audio settings, preferred quality, playback speed, and enabled tools, through `chrome.storage.sync`. It also stores the counter used for skipped ads. Chrome may sync these values across your signed-in devices when sync is enabled; they are not restricted to storage on one computer.

If you enable classic annotations, downloaded annotation XML is cached in `chrome.storage.local`. Cache keys include the YouTube video ID, so the cache can identify videos for which annotations were requested. This cache is separate from synced preferences. The preferred-quality feature also writes the selected resolution to YouTube's `yt-player-quality` local-storage entry.

CineGlow does not maintain a separate browsing-history log or add analytics, advertising SDKs, or a developer-run telemetry service.

## Video, audio, and downloads

The ambient-lighting feature samples video frames into an in-memory canvas. Audio controls process the video's sound through Web Audio nodes in the browser. These features do not upload the sampled frames or audio.

When you choose to take a screenshot or record a video, CineGlow creates a media file for download to your computer. The recorder captures the video element and available audio; it does not record the desktop or request the microphone. Media downloads are separate from Chrome's settings sync.

Ad blocking uses Chrome's `declarativeNetRequest` rules. Chrome applies the rules without the extension logging request bodies. The extension also checks player elements so it can attempt to skip ads.

## Optional third-party requests

Two features make requests outside YouTube when enabled:

| Feature | Service | Information included | Use |
|---|---|---|---|
| Return YouTube Dislike | `returnyoutubedislikeapi.com` | The public video ID in the request URL | Retrieve community like/dislike statistics |
| Restore Classic Annotations | `storage.googleapis.com` | The public video ID in the archive path | Retrieve archived annotation XML; a cached copy is reused when available |

These features are off by default. Their requests do not add account credentials, authentication tokens, or a user profile. As with other HTTPS requests, the receiving service can see connection information such as your IP address. The requested video ID identifies the video being looked up.

## Your choices

You can turn off either lookup feature in the extension popup. Preferences remain in Chrome's storage, and the annotation cache remains in local extension storage, until you change or remove them. Downloaded screenshots and recordings remain as files on your computer and can be deleted separately.

## Contact

Giri Manohar Vemula

- Email: girimanohar.v@gmail.com
- LinkedIn: [manoharv511](https://www.linkedin.com/in/manoharv511)
- Source and support: [YouTube CineGlow](https://github.com/ManoharVit/YouTube-CineGlow)

(() => {
  'use strict';

  function installSharedCodecGuard() {
    if (window.__cineglowCodecGuard) return window.__cineglowCodecGuard;

    const predicates = new Map();
    let isKilled = false;

    const origCanPlayType = HTMLMediaElement.prototype.canPlayType;
    const origIsTypeSupported = window.MediaSource?.isTypeSupported;
    const origDecodingInfo = navigator.mediaCapabilities?.decodingInfo?.bind(navigator.mediaCapabilities);

    const isBlocked = (mime, videoConfig) => {
      if (isKilled) return false;
      for (const fn of predicates.values()) {
        if (fn(mime, videoConfig)) return true;
      }
      return false;
    };

    if (typeof origCanPlayType === 'function') {
      HTMLMediaElement.prototype.canPlayType = function canPlayType(type) {
        if (isBlocked(type, null)) return '';
        return origCanPlayType.call(this, type);
      };
    }

    if (typeof origIsTypeSupported === 'function') {
      window.MediaSource.isTypeSupported = function isTypeSupported(type) {
        if (isBlocked(type, null)) return false;
        return origIsTypeSupported.call(this, type);
      };
    }

    if (typeof origDecodingInfo === 'function') {
      navigator.mediaCapabilities.decodingInfo = function decodingInfo(config) {
        const videoCfg = config?.video || null;
        const contentType = videoCfg?.contentType || config?.audio?.contentType || '';
        if (isBlocked(contentType, videoCfg)) {
          return Promise.resolve({
            supported: false,
            smooth: false,
            powerEfficient: false,
            keySystemAccess: null
          });
        }
        return origDecodingInfo(config);
      };
    }

    window.addEventListener('cineglow:kill-switch', () => {
      isKilled = true;
      predicates.clear();
      if (typeof origCanPlayType === 'function') HTMLMediaElement.prototype.canPlayType = origCanPlayType;
      if (typeof origIsTypeSupported === 'function' && window.MediaSource) {
        window.MediaSource.isTypeSupported = origIsTypeSupported;
      }
      if (typeof origDecodingInfo === 'function' && navigator.mediaCapabilities) {
        navigator.mediaCapabilities.decodingInfo = origDecodingInfo;
      }
      delete window.__cineglowCodecGuard;
    }, { once: true });

    window.__cineglowCodecGuard = { predicates };
    return window.__cineglowCodecGuard;
  }

  const guard = installSharedCodecGuard();
  guard.predicates.set('block-60fps', (mime, videoCfg) => {
    if (videoCfg && typeof videoCfg.framerate === 'number' && videoCfg.framerate > 30) {
      return true;
    }
    if (typeof mime === 'string') {
      const match = mime.match(/framerate\s*=\s*([0-9.]+)/i);
      if (match && parseFloat(match[1]) > 30) return true;
    }
    return false;
  });
})();

(() => {
  if (window.HTMLMediaElement && typeof window.HTMLMediaElement.prototype.canPlayType === 'function') {
    const originalCanPlayType = window.HTMLMediaElement.prototype.canPlayType;
    window.HTMLMediaElement.prototype.canPlayType = function(type) {
      if (type && (type.toLowerCase().includes('framerate=60') || type.toLowerCase().includes('framerate=50'))) return '';
      return originalCanPlayType.call(this, type);
    };
  }
  if (window.MediaSource && typeof window.MediaSource.isTypeSupported === 'function') {
    const originalIsTypeSupported = window.MediaSource.isTypeSupported;
    window.MediaSource.isTypeSupported = function(type) {
      if (type && (type.toLowerCase().includes('framerate=60') || type.toLowerCase().includes('framerate=50'))) return false;
      return originalIsTypeSupported.call(this, type);
    };
  }
})();

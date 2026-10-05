(() => {
  if (window.HTMLMediaElement && typeof window.HTMLMediaElement.prototype.canPlayType === 'function') {
    const originalCanPlayType = window.HTMLMediaElement.prototype.canPlayType;
    window.HTMLMediaElement.prototype.canPlayType = function(type) {
      if (type && type.toLowerCase().includes('av01')) return '';
      return originalCanPlayType.call(this, type);
    };
  }
  if (window.MediaSource && typeof window.MediaSource.isTypeSupported === 'function') {
    const originalIsTypeSupported = window.MediaSource.isTypeSupported;
    window.MediaSource.isTypeSupported = function(type) {
      if (type && type.toLowerCase().includes('av01')) return false;
      return originalIsTypeSupported.call(this, type);
    };
  }
})();

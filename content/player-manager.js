(() => {
  'use strict';

  class PlayerManager extends EventTarget {
    constructor() {
      super();
      this.video = null;
      this.player = null;
      this.app = null;
      this.isWatchPage = location.pathname === '/watch';
      this.videoId = new URLSearchParams(window.location.search).get('v');
      this.isFullscreen = !!document.fullscreenElement;
      this.isMiniplayer = false;
      this.isAdShowing = false;
      
      this.playerObserver = new MutationObserver(() => this.checkState());
      this.appObserver = new MutationObserver(() => this.checkState());
      
      this.initListeners();
      
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => this.startInitialSearch());
      } else {
        this.startInitialSearch();
      }
    }

    startInitialSearch() {
      this.checkState();
    }

    initListeners() {
      const handleEvent = () => this.checkState();
      document.addEventListener('yt-navigate-finish', handleEvent);
      document.addEventListener('yt-page-data-updated', handleEvent);
      document.addEventListener('fullscreenchange', handleEvent);
      document.addEventListener('visibilitychange', handleEvent);
    }

    checkState() {
      const isWatchPage = location.pathname === '/watch';
      const videoId = new URLSearchParams(window.location.search).get('v');
      const player = document.querySelector('#movie_player');
      const video = player ? player.querySelector('video.html5-main-video') : document.querySelector('video.html5-main-video');
      const app = document.querySelector('ytd-app');
      
      const isFullscreen = !!document.fullscreenElement;
      const isMiniplayer = app ? app.hasAttribute('miniplayer-is-active') : false;
      const isAdShowing = player ? player.classList.contains('ad-showing') : false;

      let changed = false;

      if (this.isWatchPage !== isWatchPage) { this.isWatchPage = isWatchPage; changed = true; }
      if (this.videoId !== videoId) { this.videoId = videoId; changed = true; }
      if (this.isFullscreen !== isFullscreen) { this.isFullscreen = isFullscreen; changed = true; }
      if (this.isMiniplayer !== isMiniplayer) { this.isMiniplayer = isMiniplayer; changed = true; }
      if (this.isAdShowing !== isAdShowing) { this.isAdShowing = isAdShowing; changed = true; }
      
      if (this.app !== app) {
        this.app = app;
        this.appObserver.disconnect();
        if (app) {
          this.appObserver.observe(app, { attributes: true, attributeFilter: ['miniplayer-is-active'] });
        }
      }

      if (this.player !== player || this.video !== video) {
        this.video = video;
        this.player = player;
        changed = true;
        this.playerObserver.disconnect();
        if (player) {
          this.playerObserver.observe(player, { attributes: true, attributeFilter: ['class'] });
        }
      }

      if (isWatchPage && (!app || !player || !video) && !this.searchInterval) {
        this.searchInterval = setInterval(() => this.checkState(), 500);
      } else if ((!isWatchPage || (app && player && video)) && this.searchInterval) {
        clearInterval(this.searchInterval);
        this.searchInterval = null;
      }

      if (changed) {
        this.dispatchEvent(new CustomEvent('state-change', { detail: this }));
      }
    }
  }

  window.CineGlowPlayer = new PlayerManager();
})();

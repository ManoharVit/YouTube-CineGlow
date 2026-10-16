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
      this.isPiP = false;
      this.isPlaying = false;
      
      this.handlePiP = (e) => {
        const isPiP = e.type === 'enterpictureinpicture';
        if (this.isPiP !== isPiP) {
          this.isPiP = isPiP;
          this.dispatchEvent(new CustomEvent('state-change', { detail: this }));
        }
      };

      this.handlePlayState = () => {
        const isPlaying = this.video ? (!this.video.paused && !this.video.ended && this.video.readyState > 1) : false;
        if (this.isPlaying !== isPlaying) {
          this.isPlaying = isPlaying;
          this.dispatchEvent(new CustomEvent('state-change', { detail: this }));
        }
      };
      
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
      const isAdShowing = !!(
        (player && (player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting'))) ||
        document.querySelector('.ytp-ad-player-overlay, .ytp-ad-player-overlay-layout, .ytp-ad-skip-button-slot') ||
        (document.querySelector('.video-ads.ytp-ad-module')?.childElementCount > 0)
      );
      const isPiP = video ? document.pictureInPictureElement === video : false;
      const isPlaying = video ? (!video.paused && !video.ended && video.readyState > 1) : false;

      let changed = false;

      if (this.isWatchPage !== isWatchPage) { this.isWatchPage = isWatchPage; changed = true; }
      if (this.videoId !== videoId) { this.videoId = videoId; changed = true; }
      if (this.isFullscreen !== isFullscreen) { this.isFullscreen = isFullscreen; changed = true; }
      if (this.isMiniplayer !== isMiniplayer) { this.isMiniplayer = isMiniplayer; changed = true; }
      if (this.isAdShowing !== isAdShowing) { this.isAdShowing = isAdShowing; changed = true; }
      if (this.isPiP !== isPiP) { this.isPiP = isPiP; changed = true; }
      if (this.isPlaying !== isPlaying) { this.isPlaying = isPlaying; changed = true; }
      
      if (this.app !== app) {
        this.app = app;
        this.appObserver.disconnect();
        if (app) {
          this.appObserver.observe(app, { attributes: true, attributeFilter: ['miniplayer-is-active'] });
        }
      }

      if (this.player !== player || this.video !== video) {
        if (this.video) {
          this.video.removeEventListener('enterpictureinpicture', this.handlePiP);
          this.video.removeEventListener('leavepictureinpicture', this.handlePiP);
          this.video.removeEventListener('play', this.handlePlayState);
          this.video.removeEventListener('playing', this.handlePlayState);
          this.video.removeEventListener('pause', this.handlePlayState);
          this.video.removeEventListener('waiting', this.handlePlayState);
          this.video.removeEventListener('ended', this.handlePlayState);
        }
        this.video = video;
        this.player = player;
        changed = true;
        this.playerObserver.disconnect();
        if (player) {
          this.playerObserver.observe(player, { attributes: true, attributeFilter: ['class'], childList: true });
        }
        if (this.video) {
          this.video.addEventListener('enterpictureinpicture', this.handlePiP);
          this.video.addEventListener('leavepictureinpicture', this.handlePiP);
          this.video.addEventListener('play', this.handlePlayState, { passive: true });
          this.video.addEventListener('playing', this.handlePlayState, { passive: true });
          this.video.addEventListener('pause', this.handlePlayState, { passive: true });
          this.video.addEventListener('waiting', this.handlePlayState, { passive: true });
          this.video.addEventListener('ended', this.handlePlayState, { passive: true });
          this.isPlaying = !this.video.paused && !this.video.ended && this.video.readyState > 1;
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

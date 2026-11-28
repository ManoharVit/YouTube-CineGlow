// Player lifecycle manager for CineGlow Pro
// Author: Giri Manohar Vemula (https://www.linkedin.com/in/manoharv511)
(() => {
  'use strict';

  if (typeof window !== 'undefined' && window.CineGlowKilled) return;

  function extractVideoInfo(loc = window.location) {
    const path = loc.pathname || '';
    if (path === '/watch' || path.startsWith('/watch/')) {
      return {
        isWatchPage: true,
        videoId: new URLSearchParams(loc.search).get('v')
      };
    }
    const liveMatch = path.match(/^\/live\/([a-zA-Z0-9_-]{11})/);
    if (liveMatch) {
      return { isWatchPage: true, videoId: liveMatch[1] };
    }
    return { isWatchPage: false, videoId: null };
  }

  class PlayerManager extends EventTarget {
    constructor() {
      super();
      const initial = extractVideoInfo();
      this.video = null;
      this.player = null;
      this.app = null;
      this.isWatchPage = initial.isWatchPage;
      this.videoId = initial.videoId;
      this.isFullscreen = !!document.fullscreenElement;
      this.isMiniplayer = false;
      this.isTheater = false;
      this.isAdShowing = false;
      this.isPiP = false;
      this.isPlaying = false;
      this.isKilled = false;
      this.watchFlexy = null;
      this.searchInterval = null;
      this.theaterDebounceTimer = null;
      this._lastTheaterAttrState = null;

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
      this.watchFlexyObserver = new MutationObserver(() => this.checkState());
      this.htmlAttrObserver = new MutationObserver(() => this.checkState());

      this.handleStateEvent = () => this.checkState();
      this.handleSizeButtonClick = (e) => {
        if (e.target?.closest?.('.ytp-size-button')) {
          this.scheduleTheaterCheck();
        }
      };
      this.handleTheaterKeydown = (e) => {
        if (e.key === 't' || e.key === 'T') {
          if (e.target?.matches?.('input, textarea, [contenteditable]') || e.target?.closest?.('ytd-searchbox, ytd-commentbox, yt-searchbox')) return;
          this.scheduleTheaterCheck();
        }
      };

      this.initListeners();

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => this.startInitialSearch(), { once: true });
      } else {
        this.startInitialSearch();
      }
    }

    scheduleTheaterCheck() {
      clearTimeout(this.theaterDebounceTimer);
      this.theaterDebounceTimer = setTimeout(() => this.checkState(), 120);
    }

    startInitialSearch() {
      if (this.isKilled || window.CineGlowKilled) return;
      this.checkState();
    }

    initListeners() {
      window.addEventListener('resize', this.handleStateEvent, { passive: true });
      window.addEventListener('popstate', this.handleStateEvent);
      document.addEventListener('yt-navigate-start', this.handleStateEvent);
      document.addEventListener('yt-navigate-finish', this.handleStateEvent);
      document.addEventListener('yt-page-data-updated', this.handleStateEvent);
      document.addEventListener('fullscreenchange', this.handleStateEvent);
      document.addEventListener('visibilitychange', this.handleStateEvent);
      document.addEventListener('click', this.handleSizeButtonClick, { passive: true });
      document.addEventListener('keydown', this.handleTheaterKeydown, { passive: true });

      if (document.documentElement) {
        this.htmlAttrObserver.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ['data-cineglow-theater']
        });
      }
    }

    checkState() {
      if (this.isKilled || window.CineGlowKilled) return;
      const { isWatchPage, videoId } = extractVideoInfo();
      const player = document.querySelector('#movie_player');
      const video = (player && (player.querySelector('video.html5-main-video') || player.querySelector('video'))) || document.querySelector('video.html5-main-video') || document.querySelector('video');
      const app = document.querySelector('ytd-app');

      const isFullscreen = !!document.fullscreenElement;
      const isMiniplayer = app ? app.hasAttribute('miniplayer-is-active') : false;
      const watchFlexy = document.querySelector('ytd-watch-flexy, ytd-watch-grid');

      let isTheater = false;
      if (watchFlexy) {
        isTheater = watchFlexy.hasAttribute('theater') ||
                    watchFlexy.hasAttribute('theater-requested_') ||
                    Boolean(watchFlexy.theater);
      }
      if (!isTheater && !watchFlexy) {
        isTheater = document.documentElement?.getAttribute('data-cineglow-theater') === 'true';
      }
      if (!isTheater && isWatchPage && !isFullscreen) {
        const theaterContainer = document.querySelector(
          '#player-theater-container #movie_player, [id*="theater-container"] #movie_player'
        );
        if (theaterContainer) isTheater = true;
      }

      const isAdShowing = !!(
        player && (player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting'))
      );
      const isPiP = video ? document.pictureInPictureElement === video : false;
      const isPlaying = video ? (!video.paused && !video.ended && video.readyState > 1) : false;

      let changed = false;

      if (this.isWatchPage !== isWatchPage) {
        this.isWatchPage = isWatchPage;
        changed = true;
      }
      if (this.videoId !== videoId) {
        this.videoId = videoId;
        changed = true;
      }
      if (this.isFullscreen !== isFullscreen) {
        this.isFullscreen = isFullscreen;
        changed = true;
      }
      if (this.isMiniplayer !== isMiniplayer) {
        this.isMiniplayer = isMiniplayer;
        changed = true;
      }
      if (this.isTheater !== isTheater) {
        this.isTheater = isTheater;
        changed = true;
      }
      if (this.isAdShowing !== isAdShowing) {
        this.isAdShowing = isAdShowing;
        changed = true;
      }
      if (this.isPiP !== isPiP) {
        this.isPiP = isPiP;
        changed = true;
      }
      if (this.isPlaying !== isPlaying) {
        this.isPlaying = isPlaying;
        changed = true;
      }

      const inTheaterMode = !!(this.isTheater && this.isWatchPage && !this.isFullscreen);
      if (this._lastTheaterAttrState !== inTheaterMode && document.documentElement) {
        this._lastTheaterAttrState = inTheaterMode;
        document.documentElement.classList.toggle('aura-in-theater', inTheaterMode);
        document.documentElement.classList.toggle('aura-theater-mode', inTheaterMode);
        if (inTheaterMode) {
          document.documentElement.setAttribute('data-cineglow-theater', 'true');
        } else {
          document.documentElement.removeAttribute('data-cineglow-theater');
        }
      }

      if (this.watchFlexy !== watchFlexy) {
        this.watchFlexy = watchFlexy;
        this.watchFlexyObserver.disconnect();
        if (watchFlexy) {
          this.watchFlexyObserver.observe(watchFlexy, {
            attributes: true,
            attributeFilter: ['theater', 'theater-requested_', 'default-layout', 'class']
          });
        }
      }

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
        if (this.searchInterval && typeof this.searchInterval.unref === 'function') {
          this.searchInterval.unref();
        }
      } else if ((!isWatchPage || (app && player && video)) && this.searchInterval) {
        clearInterval(this.searchInterval);
        this.searchInterval = null;
      }

      if (player && typeof player.querySelectorAll === 'function') {
        try {
          const watermarks = player.querySelectorAll(
            '.iv-branding, .branding-img-container, .branding-context-container, .ytp-featured-watermark, [class*="branding-img"], [class*="branding-context"]'
          );
          if (watermarks && typeof watermarks.forEach === 'function') {
            watermarks.forEach((el) => {
              try { el.remove(); } catch (_) {}
            });
          }
        } catch (_) {}
      }

      if (changed) {
        this.dispatchEvent(new CustomEvent('state-change', { detail: this }));
      }
    }

    teardownKillSwitch() {
      if (this.isKilled) return;
      this.isKilled = true;
      window.CineGlowKilled = true;

      clearTimeout(this.theaterDebounceTimer);
      if (this.searchInterval) {
        clearInterval(this.searchInterval);
        this.searchInterval = null;
      }

      window.removeEventListener('resize', this.handleStateEvent);
      window.removeEventListener('popstate', this.handleStateEvent);
      document.removeEventListener('yt-navigate-start', this.handleStateEvent);
      document.removeEventListener('yt-navigate-finish', this.handleStateEvent);
      document.removeEventListener('yt-page-data-updated', this.handleStateEvent);
      document.removeEventListener('fullscreenchange', this.handleStateEvent);
      document.removeEventListener('visibilitychange', this.handleStateEvent);
      document.removeEventListener('click', this.handleSizeButtonClick);
      document.removeEventListener('keydown', this.handleTheaterKeydown);

      if (document.documentElement) {
        document.documentElement.classList.remove('aura-in-theater', 'aura-theater-mode');
        document.documentElement.removeAttribute('data-cineglow-theater');
      }

      this.htmlAttrObserver?.disconnect();
      this.htmlAttrObserver = null;
      this.playerObserver?.disconnect();
      this.playerObserver = null;
      this.appObserver?.disconnect();
      this.appObserver = null;
      this.watchFlexyObserver?.disconnect();
      this.watchFlexyObserver = null;

      if (this.video) {
        this.video.removeEventListener('enterpictureinpicture', this.handlePiP);
        this.video.removeEventListener('leavepictureinpicture', this.handlePiP);
        this.video.removeEventListener('play', this.handlePlayState);
        this.video.removeEventListener('playing', this.handlePlayState);
        this.video.removeEventListener('pause', this.handlePlayState);
        this.video.removeEventListener('waiting', this.handlePlayState);
        this.video.removeEventListener('ended', this.handlePlayState);
        this.video = null;
      }
      this.player = null;
      this.app = null;
      this.watchFlexy = null;

      window.dispatchEvent(new CustomEvent('cineglow:kill-switch'));
    }
  }

  const playerManager = new PlayerManager();
  window.CineGlowPlayer = playerManager;

  const handleStorageChange = (changes, area) => {
    if (area === 'managed' && changes.KillSwitch?.newValue === true) {
      playerManager.teardownKillSwitch();
    }
    if (area === 'local' && changes.auraKillSwitchActive?.newValue === true) {
      playerManager.teardownKillSwitch();
    }
  };

  if (typeof chrome !== 'undefined' && chrome.storage) {
    chrome.storage.local?.get(['auraKillSwitchActive']).then((local) => {
      if (local?.auraKillSwitchActive) playerManager.teardownKillSwitch();
    }).catch(() => {});

    chrome.storage.managed?.get(['KillSwitch']).then((managed) => {
      if (managed?.KillSwitch) playerManager.teardownKillSwitch();
    }).catch(() => {});

    chrome.storage.onChanged?.addListener(handleStorageChange);
  }

  let onKillSwitchMessage = null;
  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage?.addListener) {
    onKillSwitchMessage = (message, _sender, sendResponse) => {
      if (message?.type === 'AURA_EMERGENCY_KILL_SWITCH') {
        try { chrome.storage?.onChanged?.removeListener(handleStorageChange); } catch (_) {}
        try { chrome.runtime?.onMessage?.removeListener(onKillSwitchMessage); } catch (_) {}
        playerManager.teardownKillSwitch();
        if (typeof sendResponse === 'function') {
          sendResponse({ success: true, script: 'player-manager.js' });
        }
      }
    };
    chrome.runtime.onMessage.addListener(onKillSwitchMessage);
  }

  window.addEventListener('cineglow:kill-switch', () => {
    try { chrome.storage?.onChanged?.removeListener(handleStorageChange); } catch (_) {}
    if (onKillSwitchMessage) {
      try { chrome.runtime?.onMessage?.removeListener(onKillSwitchMessage); } catch (_) {}
    }
    playerManager.teardownKillSwitch();
  }, { once: true });
})();

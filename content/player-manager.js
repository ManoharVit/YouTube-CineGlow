(() => {
  'use strict';

  if (typeof window !== 'undefined' && window.CineGlowKilled) return;

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
      this.isTheater = false;
      this.isAdShowing = false;
      this.isPiP = false;
      this.isPlaying = false;
      this.isKilled = false;
      this.watchFlexy = null;
      
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
      
      this.initListeners();
      
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => this.startInitialSearch());
      } else {
        this.startInitialSearch();
      }
    }

    startInitialSearch() {
      if (this.isKilled || (typeof window !== 'undefined' && window.CineGlowKilled)) return;
      this.checkState();
    }

    initListeners() {
      const handleEvent = () => this.checkState();
      window.addEventListener('resize', handleEvent);
      window.addEventListener('popstate', handleEvent);
      document.addEventListener('yt-navigate-finish', handleEvent);
      document.addEventListener('yt-page-data-updated', handleEvent);
      document.addEventListener('fullscreenchange', handleEvent);
      document.addEventListener('visibilitychange', handleEvent);
      document.addEventListener('click', (e) => {
        if (e.target?.closest?.('.ytp-size-button')) {
          setTimeout(handleEvent, 50);
          setTimeout(handleEvent, 150);
          setTimeout(handleEvent, 350);
          setTimeout(handleEvent, 600);
        }
      }, { passive: true });
      document.addEventListener('keydown', (e) => {
        if (e.key === 't' || e.key === 'T') {
          setTimeout(handleEvent, 50);
          setTimeout(handleEvent, 150);
          setTimeout(handleEvent, 350);
          setTimeout(handleEvent, 600);
        }
      }, { passive: true });
      document.addEventListener('yt-action', handleEvent, { passive: true });
    }

    checkState() {
      if (this.isKilled || (typeof window !== 'undefined' && window.CineGlowKilled)) return;
      const isWatchPage = location.pathname === '/watch';
      const videoId = new URLSearchParams(window.location.search).get('v');
      const player = document.querySelector('#movie_player');
      const video = player ? player.querySelector('video.html5-main-video') : document.querySelector('video.html5-main-video');
      const app = document.querySelector('ytd-app');
      
      const isFullscreen = !!document.fullscreenElement;
      const isMiniplayer = app ? app.hasAttribute('miniplayer-is-active') : false;
      const watchFlexy = document.querySelector('ytd-watch-flexy, ytd-watch-grid');
      let isTheater = false;
      if (watchFlexy) {
        isTheater = watchFlexy.hasAttribute('theater') ||
                    watchFlexy.hasAttribute('theater-requested_') ||
                    watchFlexy.hasAttribute('full-bleed-player') ||
                    watchFlexy.hasAttribute('full-bleed') ||
                    watchFlexy.classList.contains('theater') ||
                    watchFlexy.classList.contains('theater-mode') ||
                    watchFlexy.classList.contains('full-bleed-player');
      }
      if (!isTheater && isWatchPage && !isFullscreen) {
        const fullBleed = document.querySelector(
          '#full-bleed-container #movie_player, #player-full-bleed-container #movie_player, #player-theater-container #movie_player, [id*="full-bleed"] #movie_player, [id*="theater-container"] #movie_player'
        );
        if (fullBleed) {
          isTheater = true;
        }
      }
      if (!isTheater && isWatchPage && !isFullscreen && !isMiniplayer && player) {
        const columns = document.querySelector('#columns');
        if (columns && !columns.contains(player)) {
          isTheater = true;
        }
      }
      if (!isTheater && isWatchPage && !isFullscreen) {
        const sizeBtn = document.querySelector('.ytp-size-button');
        if (sizeBtn) {
          const btnTitle = (sizeBtn.getAttribute('title') || sizeBtn.getAttribute('aria-label') || sizeBtn.getAttribute('data-title-no-tooltip') || '').toLowerCase();
          if (btnTitle.includes('default view') || btnTitle.includes('default-view') || btnTitle.includes('exit theater') || btnTitle.includes('exit theatre')) {
            isTheater = true;
          }
        }
      }
      if (!isTheater && isWatchPage && !isFullscreen && player && typeof window !== 'undefined' && window.innerWidth > 0) {
        try {
          const rect = player.getBoundingClientRect();
          if (rect.width >= window.innerWidth * 0.90) {
            isTheater = true;
          }
        } catch (_) {}
      }
      const isAdShowing = !!(
        player && (player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting'))
      );
      const isPiP = video ? document.pictureInPictureElement === video : false;
      const isPlaying = video ? (!video.paused && !video.ended && video.readyState > 1) : false;

      let changed = false;

      if (this.isWatchPage !== isWatchPage) { this.isWatchPage = isWatchPage; changed = true; }
      if (this.videoId !== videoId) { this.videoId = videoId; changed = true; }
      if (this.isFullscreen !== isFullscreen) { this.isFullscreen = isFullscreen; changed = true; }
      if (this.isMiniplayer !== isMiniplayer) { this.isMiniplayer = isMiniplayer; changed = true; }
      if (this.isTheater !== isTheater) {
        this.isTheater = isTheater;
        changed = true;
        setTimeout(() => {
          if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
            window.dispatchEvent(new Event('resize'));
          }
        }, 60);
      }
      if (this.isAdShowing !== isAdShowing) { this.isAdShowing = isAdShowing; changed = true; }
      if (this.isPiP !== isPiP) { this.isPiP = isPiP; changed = true; }
      if (this.isPlaying !== isPlaying) { this.isPlaying = isPlaying; changed = true; }

      const inTheaterMode = !!(this.isTheater && this.isWatchPage && !this.isFullscreen);
      if (document.documentElement) {
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
            attributeFilter: ['theater', 'theater-requested_', 'full-bleed-player', 'full-bleed', 'class', 'style', 'default-layout']
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

      if (typeof ResizeObserver !== 'undefined' && player && this.playerResizeTarget !== player) {
        if (this.playerResizeObserver) {
          this.playerResizeObserver.disconnect();
        }
        this.playerResizeTarget = player;
        this.playerResizeObserver = new ResizeObserver(() => this.checkState());
        this.playerResizeObserver.observe(player);
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

      if (changed) {
        this.dispatchEvent(new CustomEvent('state-change', { detail: this }));
      }
    }

    teardownKillSwitch() {
      if (this.isKilled) return;
      this.isKilled = true;
      if (typeof window !== 'undefined') {
        window.CineGlowKilled = true;
      }

      // 1. Clear search interval
      if (this.searchInterval) {
        clearInterval(this.searchInterval);
        this.searchInterval = null;
      }

      if (document.documentElement) {
        document.documentElement.classList.remove('aura-in-theater', 'aura-theater-mode');
      }

      // 2. Disconnect observers
      if (this.playerObserver) { this.playerObserver.disconnect(); this.playerObserver = null; }
      if (this.appObserver) { this.appObserver.disconnect(); this.appObserver = null; }
      if (this.watchFlexyObserver) { this.watchFlexyObserver.disconnect(); this.watchFlexyObserver = null; }
      if (this.playerResizeObserver) { this.playerResizeObserver.disconnect(); this.playerResizeObserver = null; this.playerResizeTarget = null; }

      // 3. Detach video listeners
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

      // 4. Broadcast in-tab event to ensure any uncoupled scripts receive notification
      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        window.dispatchEvent(new CustomEvent('cineglow:kill-switch'));
      }
    }
  }

  const playerManager = new PlayerManager();
  window.CineGlowPlayer = playerManager;

  // Early startup checks for managed and local kill-switch policies
  if (typeof chrome !== 'undefined' && chrome.storage) {
    if (chrome.storage.local) {
      chrome.storage.local.get(['auraKillSwitchActive']).then((local) => {
        if (local && local.auraKillSwitchActive) {
          playerManager.teardownKillSwitch();
        }
      }).catch(() => {});
    }
    if (chrome.storage.managed) {
      chrome.storage.managed.get(['KillSwitch']).then((managed) => {
        if (managed && managed.KillSwitch) {
          playerManager.teardownKillSwitch();
        }
      }).catch(() => {});
    }
    if (chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'managed' && changes.KillSwitch?.newValue === true) {
          playerManager.teardownKillSwitch();
        }
        if (area === 'local' && changes.auraKillSwitchActive?.newValue === true) {
          playerManager.teardownKillSwitch();
        }
      });
    }
  }

  // Dual listener registration: Direct runtime message + In-tab fallback event
  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage?.addListener) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message && message.type === 'AURA_EMERGENCY_KILL_SWITCH') {
        playerManager.teardownKillSwitch();
        if (typeof sendResponse === 'function') {
          sendResponse({ success: true, script: 'player-manager.js' });
        }
      }
    });
  }

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('cineglow:kill-switch', () => {
      playerManager.teardownKillSwitch();
    }, { once: true });
  }
})();

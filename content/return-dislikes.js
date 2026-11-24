// content/return-dislikes.js
// Author: Giri Manohar Vemula (https://www.linkedin.com/in/manoharv511)
(() => {
  'use strict';

  const DISLIKE_COUNT_CLASS = 'cineglow-dislike-count';
  const HAS_DISLIKES_CLASS = 'cineglow-has-dislikes';
  const RATIO_BAR_CLASS = 'cineglow-ratio-bar';

  let isEnabled = false;
  let currentVideoId = null;
  const votesCache = new Map();
  let domObserver = null;
  let bootstrapObserver = null;
  let observedRoot = null;
  let mutationQueued = false;
  let isUpdating = false;
  let isKilled = false;

  function formatCount(num) {
    if (num == null || isNaN(num)) return '';
    if (num < 1000) return String(num);
    try {
      return new Intl.NumberFormat(navigator.language || 'en', {
        notation: 'compact',
        compactDisplay: 'short',
        maximumFractionDigits: 1
      }).format(num);
    } catch {
      if (num >= 1e6) return (num / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
      if (num >= 1e3) return (num / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
      return String(num);
    }
  }

  function getVideoId() {
    const urlParams = new URLSearchParams(window.location.search);
    const v = urlParams.get('v');
    if (v) return v;

    if (window.location.pathname.startsWith('/shorts/')) {
      const parts = window.location.pathname.split('/shorts/');
      if (parts[1]) return parts[1].split('/')[0].split('?')[0];
    }

    return window.CineGlowPlayer?.videoId || null;
  }

  async function fetchVotes(videoId) {
    if (isKilled || window.CineGlowKilled || !videoId) return null;

    if (votesCache.has(videoId)) {
      return votesCache.get(videoId);
    }

    try {
      const result = await new Promise((resolve) => {
        try {
          if (!chrome.runtime?.id) {
            resolve(null);
            return;
          }
          chrome.runtime.sendMessage({ type: 'FETCH_DISLIKES', videoId }, (res) => {
            try {
              if (chrome.runtime?.lastError || !res?.success) {
                resolve(null);
              } else {
                resolve(res.data);
              }
            } catch (_) {
              resolve(null);
            }
          });
        } catch (_) {
          resolve(null);
        }
      });

      if (!result || typeof result.dislikes !== 'number') return null;

      const voteRecord = {
        id: videoId,
        likes: Number(result.likes) || 0,
        dislikes: Number(result.dislikes) || 0,
        rating: Number(result.rating) || 5,
        viewCount: Number(result.viewCount) || 0,
        userVote: 0
      };

      votesCache.set(videoId, voteRecord);
      if (votesCache.size > 100) {
        const oldestKey = votesCache.keys().next().value;
        votesCache.delete(oldestKey);
      }

      return voteRecord;
    } catch (_) {
      return null;
    }
  }

  function findDislikeElements() {
    if (window.location.pathname.startsWith('/shorts/')) {
      const activeVideoId = getVideoId();
      let activeReel = null;

      if (activeVideoId) {
        const reels = document.querySelectorAll('ytd-reel-video-renderer');
        const reelList = (reels && reels.length > 0) ? reels : (document.body?.querySelectorAll ? document.body.querySelectorAll('ytd-reel-video-renderer') : []);
        for (const reel of reelList) {
          const reelVid = reel.getAttribute('data-video-id') || reel.dataset?.videoId || reel.videoId;
          if (reelVid === activeVideoId || reel.querySelector?.(`a[href*="${activeVideoId}"]`)) {
            activeReel = reel;
            break;
          }
        }
      }

      if (!activeReel) {
        activeReel = document.querySelector('ytd-reel-video-renderer[is-active]') ||
                     document.querySelector('ytd-reel-video-renderer') ||
                     (document.body?.querySelector ? (document.body.querySelector('ytd-reel-video-renderer[is-active]') || document.body.querySelector('ytd-reel-video-renderer')) : null);
      }

      if (activeReel) {
        const shortsDislike = activeReel.querySelector('#dislike-button');
        if (shortsDislike) {
          const shortsBtn = shortsDislike.querySelector('button') || shortsDislike;
          const shortsLike = activeReel.querySelector('#like-button');
          return {
            dislikeBtn: shortsBtn,
            likeBtn: shortsLike ? (shortsLike.querySelector('button') || shortsLike) : null,
            wrapper: shortsDislike,
            isShorts: true,
            videoId: activeVideoId
          };
        }
      }
      return null;
    }

    const segmentedWrapper = document.querySelector('.ytSegmentedLikeDislikeButtonViewModelSegmentedButtonsWrapper') ||
                             document.querySelector('segmented-like-dislike-button-view-model');

    if (segmentedWrapper) {
      const dislikeBtn = segmentedWrapper.querySelector('dislike-button-view-model button') ||
                         segmentedWrapper.querySelector('#dislike-button button') ||
                         segmentedWrapper.querySelector('button:last-of-type');
      const likeBtn = segmentedWrapper.querySelector('like-button-view-model button') ||
                      segmentedWrapper.querySelector('#like-button button') ||
                      segmentedWrapper.querySelector('button:first-of-type');
      if (dislikeBtn) {
        return { dislikeBtn, likeBtn, wrapper: segmentedWrapper, isShorts: false };
      }
    }

    const dislikeVm = document.querySelector('dislike-button-view-model button');
    if (dislikeVm) {
      const likeVm = document.querySelector('like-button-view-model button');
      return {
        dislikeBtn: dislikeVm,
        likeBtn: likeVm,
        wrapper: dislikeVm.closest('segmented-like-dislike-button-view-model') || dislikeVm.parentElement,
        isShorts: false
      };
    }

    const legacyDislike = document.querySelector('#segmented-dislike-button button, ytd-segmented-like-dislike-button-renderer #dislike-button button');
    if (legacyDislike) {
      const legacyLike = document.querySelector('#segmented-like-button button, ytd-segmented-like-dislike-button-renderer #like-button button');
      return {
        dislikeBtn: legacyDislike,
        likeBtn: legacyLike,
        wrapper: legacyDislike.closest('ytd-segmented-like-dislike-button-renderer') || legacyDislike.parentElement,
        isShorts: false
      };
    }

    return null;
  }

  function renderDislikes(voteRecord) {
    if (!isEnabled || !voteRecord) return;
    const elements = findDislikeElements();
    if (!elements?.dislikeBtn) return;

    const { dislikeBtn, likeBtn, wrapper, isShorts } = elements;
    const formattedExact = voteRecord.dislikes.toLocaleString();
    const formattedCompact = formatCount(voteRecord.dislikes);

    dislikeBtn.title = `${formattedExact} dislikes`;
    dislikeBtn.setAttribute('aria-label', `Dislike this video along with ${formattedExact} other people`);
    dislikeBtn.classList.add(HAS_DISLIKES_CLASS);
    dislikeBtn.classList.remove('ytSpecButtonShapeNextIconButton', 'yt-spec-button-shape-next--icon-button');

    let countEl = dislikeBtn.querySelector(`.${DISLIKE_COUNT_CLASS}`);
    if (!countEl) {
      countEl = document.createElement('div');
      countEl.className = `ytSpecButtonShapeNextButtonTextContent ytSpecButtonShapeNextElevatedContent ${DISLIKE_COUNT_CLASS}`;
      countEl.setAttribute('aria-hidden', 'true');

      const feedback = dislikeBtn.querySelector('yt-touch-feedback-shape');
      if (feedback) {
        dislikeBtn.insertBefore(countEl, feedback);
      } else {
        dislikeBtn.appendChild(countEl);
      }
    }

    dislikeBtn.setAttribute('data-cineglow-video-id', voteRecord.id);
    countEl.setAttribute('data-cineglow-video-id', voteRecord.id);

    if (countEl.textContent !== formattedCompact) {
      countEl.textContent = formattedCompact;
    }

    if (!isShorts && wrapper) {
      renderRatioBar(wrapper, voteRecord.likes, voteRecord.dislikes);
    }

    attachVoteListeners(dislikeBtn, likeBtn, voteRecord);
  }

  function renderRatioBar(wrapper, likes, dislikes) {
    const parentContainer = wrapper.parentElement || wrapper;
    let ratioBar = parentContainer.querySelector(`.${RATIO_BAR_CLASS}`);

    if (!ratioBar) {
      ratioBar = document.createElement('div');
      ratioBar.className = RATIO_BAR_CLASS;

      const likesBar = document.createElement('div');
      likesBar.className = 'cineglow-ratio-likes';

      const dislikesBar = document.createElement('div');
      dislikesBar.className = 'cineglow-ratio-dislikes';

      ratioBar.appendChild(likesBar);
      ratioBar.appendChild(dislikesBar);
      parentContainer.appendChild(ratioBar);
    }

    const total = likes + dislikes;
    const likePercent = total > 0 ? (likes / total) * 100 : 50;

    const likesBar = ratioBar.querySelector('.cineglow-ratio-likes');
    if (likesBar) {
      likesBar.style.width = `${likePercent.toFixed(1)}%`;
    }

    ratioBar.title = `${likes.toLocaleString()} likes / ${dislikes.toLocaleString()} dislikes (${likePercent.toFixed(1)}%)`;
  }

  function attachVoteListeners(dislikeBtn, likeBtn, voteRecord) {
    if (dislikeBtn) {
      dislikeBtn._currentVoteRecord = voteRecord;
      if (!dislikeBtn._cineglowDislikeBound) {
        const dislikeHandler = () => {
          const record = dislikeBtn._currentVoteRecord || voteRecord;
          if (!isEnabled || !record) return;

          setTimeout(() => {
            const isPressed = dislikeBtn.getAttribute('aria-pressed') === 'true';
            if (isPressed && record.userVote !== -1) {
              if (record.userVote === 1) record.likes = Math.max(0, record.likes - 1);
              record.dislikes += 1;
              record.userVote = -1;
            } else if (!isPressed && record.userVote === -1) {
              record.dislikes = Math.max(0, record.dislikes - 1);
              record.userVote = 0;
            }
            renderDislikes(record);
          }, 50);
        };
        dislikeBtn._cineglowDislikeHandler = dislikeHandler;
        dislikeBtn._cineglowDislikeBound = true;
        dislikeBtn.addEventListener('click', dislikeHandler);
      }
    }

    if (likeBtn) {
      likeBtn._currentVoteRecord = voteRecord;
      if (!likeBtn._cineglowLikeBound) {
        const likeHandler = () => {
          const record = likeBtn._currentVoteRecord || voteRecord;
          if (!isEnabled || !record) return;

          setTimeout(() => {
            const isPressed = likeBtn.getAttribute('aria-pressed') === 'true';
            if (isPressed && record.userVote !== 1) {
              if (record.userVote === -1) record.dislikes = Math.max(0, record.dislikes - 1);
              record.likes += 1;
              record.userVote = 1;
            } else if (!isPressed && record.userVote === 1) {
              record.likes = Math.max(0, record.likes - 1);
              record.userVote = 0;
            }
            renderDislikes(record);
          }, 50);
        };
        likeBtn._cineglowLikeHandler = likeHandler;
        likeBtn._cineglowLikeBound = true;
        likeBtn.addEventListener('click', likeHandler);
      }
    }
  }

  function teardown() {
    if (bootstrapObserver) {
      bootstrapObserver.disconnect();
      bootstrapObserver = null;
    }
    if (domObserver) {
      domObserver.disconnect();
      domObserver = null;
    }
    observedRoot = null;

    document.querySelectorAll(`.${DISLIKE_COUNT_CLASS}`).forEach((el) => el.remove());
    document.querySelectorAll(`.${RATIO_BAR_CLASS}`).forEach((el) => el.remove());

    document.querySelectorAll(`.${HAS_DISLIKES_CLASS}`).forEach((btn) => {
      btn.classList.remove(HAS_DISLIKES_CLASS);
      btn.removeAttribute('title');
      btn.removeAttribute('data-cineglow-video-id');
      btn.setAttribute('aria-label', 'Dislike this video');
      if (btn._cineglowDislikeHandler) {
        btn.removeEventListener('click', btn._cineglowDislikeHandler);
      }
      delete btn._cineglowDislikeHandler;
      delete btn._currentVoteRecord;
      delete btn._cineglowDislikeBound;
    });

    document.querySelectorAll('dislike-button-view-model button, #dislike-button button').forEach((btn) => {
      btn.removeAttribute('data-cineglow-video-id');
      if (btn._cineglowDislikeHandler) {
        btn.removeEventListener('click', btn._cineglowDislikeHandler);
      }
      delete btn._cineglowDislikeHandler;
      delete btn._currentVoteRecord;
      delete btn._cineglowDislikeBound;
    });

    document.querySelectorAll('like-button-view-model button, #like-button button').forEach((btn) => {
      if (btn._cineglowLikeHandler) {
        btn.removeEventListener('click', btn._cineglowLikeHandler);
      }
      delete btn._cineglowLikeHandler;
      delete btn._currentVoteRecord;
      delete btn._cineglowLikeBound;
    });
  }

  async function updateForCurrentVideo() {
    if (isKilled || window.CineGlowKilled || !isEnabled || isUpdating) return;
    isUpdating = true;

    try {
      const videoId = getVideoId();
      if (!videoId) return;

      currentVideoId = videoId;
      const voteData = await fetchVotes(videoId);

      if (voteData && getVideoId() === videoId) {
        renderDislikes(voteData);
      }
      startObserver();
    } finally {
      isUpdating = false;
    }
  }

  function handleScopedMutation() {
    mutationQueued = false;
    if (isKilled || window.CineGlowKilled || !isEnabled) return;

    const vid = getVideoId();
    if (vid && vid !== currentVideoId) {
      currentVideoId = vid;
      updateForCurrentVideo();
      return;
    }

    const elements = findDislikeElements();
    if (elements?.dislikeBtn) {
      const existingCount = elements.dislikeBtn.querySelector(`.${DISLIKE_COUNT_CLASS}`);
      const renderedVid = elements.dislikeBtn.getAttribute('data-cineglow-video-id');
      const isStale = currentVideoId && renderedVid !== currentVideoId;
      if (!existingCount || isStale) {
        if (currentVideoId && votesCache.has(currentVideoId)) {
          renderDislikes(votesCache.get(currentVideoId));
        } else {
          updateForCurrentVideo();
        }
      }
    }
  }

  // Route-aware target selection prevents Watch -> Shorts SPA transitions from locking onto hidden watch metadata
  function getObserverTarget() {
    if (window.location.pathname.startsWith('/shorts/')) {
      return document.querySelector('ytd-shorts, ytd-reel-video-renderer') || (document.body?.querySelector ? document.body.querySelector('ytd-shorts, ytd-reel-video-renderer') : null);
    }
    if (window.location.pathname === '/watch') {
      return document.querySelector('#above-the-fold, ytd-watch-metadata') || (document.body?.querySelector ? document.body.querySelector('#above-the-fold, ytd-watch-metadata') : null);
    }
    return null;
  }

  function startObserver() {
    if (isKilled || window.CineGlowKilled || !isEnabled) return;

    const target = getObserverTarget();
    if (target) {
      if (bootstrapObserver) {
        bootstrapObserver.disconnect();
        bootstrapObserver = null;
      }
      if (observedRoot === target && domObserver) return;
      if (!domObserver) {
        domObserver = new MutationObserver(() => {
          if (!mutationQueued) {
            mutationQueued = true;
            queueMicrotask(handleScopedMutation);
          }
        });
      }
      domObserver.disconnect();
      observedRoot = target;
      domObserver.observe(target, { childList: true, subtree: true });
      return;
    }

    if (!bootstrapObserver && document.body && (window.location.pathname === '/watch' || window.location.pathname.startsWith('/shorts/'))) {
      bootstrapObserver = new MutationObserver(() => {
        if (getObserverTarget()) {
          startObserver();
          handleScopedMutation();
        }
      });
      bootstrapObserver.observe(document.body, { childList: true, subtree: true });
    }
  }

  function initialize() {
    if (isKilled || window.CineGlowKilled || !isEnabled) return;
    updateForCurrentVideo();
    startObserver();
  }

  const onNavigateFinish = () => {
    if (isEnabled && !isKilled) {
      observedRoot = null;
      startObserver();
      updateForCurrentVideo();
    }
  };

  const onPopstate = () => {
    if (isEnabled && !isKilled) {
      observedRoot = null;
      startObserver();
      const vid = getVideoId();
      if (vid && vid !== currentVideoId) {
        updateForCurrentVideo();
      }
    }
  };

  const onPlayerStateChange = () => {
    if (isEnabled && !isKilled) {
      const vid = getVideoId();
      if (vid && vid !== currentVideoId) {
        updateForCurrentVideo();
      }
    }
  };

  const handleStorageChange = (changes, area) => {
    if (isKilled || window.CineGlowKilled) return;
    if (area === 'managed' && changes.KillSwitch?.newValue === true) {
      teardownKillSwitch();
      return;
    }
    if (area === 'local' && changes.auraKillSwitchActive?.newValue === true) {
      teardownKillSwitch();
      return;
    }
    if (area === 'sync' && 'returnDislikes' in changes) {
      isEnabled = Boolean(changes.returnDislikes.newValue);
      if (isEnabled) {
        initialize();
      } else {
        teardown();
      }
    }
  };

  function teardownKillSwitch() {
    if (isKilled) return;
    isKilled = true;
    isEnabled = false;
    window.CineGlowKilled = true;

    chrome.storage?.onChanged?.removeListener(handleStorageChange);
    document.removeEventListener('yt-navigate-finish', onNavigateFinish);
    window.removeEventListener('popstate', onPopstate);
    window.CineGlowPlayer?.removeEventListener?.('state-change', onPlayerStateChange);

    teardown();
    votesCache.clear();
  }

  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage?.addListener) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === 'AURA_EMERGENCY_KILL_SWITCH') {
        teardownKillSwitch();
        if (!window._cineglowKillEventFired) {
          window._cineglowKillEventFired = true;
          window.dispatchEvent(new CustomEvent('cineglow:kill-switch', { detail: message }));
        }
        if (typeof sendResponse === 'function') {
          sendResponse({ success: true, script: 'return-dislikes.js' });
        }
      }
    });
  }

  window.addEventListener('cineglow:kill-switch', () => {
    teardownKillSwitch();
  }, { once: true });

  window.CineGlowDislikesTeardown = teardownKillSwitch;

  document.addEventListener('yt-navigate-finish', onNavigateFinish, { passive: true });
  window.addEventListener('popstate', onPopstate, { passive: true });
  window.CineGlowPlayer?.addEventListener('state-change', onPlayerStateChange);

  if (typeof chrome !== 'undefined' && chrome.storage) {
    chrome.storage.sync?.get({ returnDislikes: false }, (stored) => {
      if (isKilled) return;
      isEnabled = Boolean(stored?.returnDislikes);
      if (isEnabled) {
        initialize();
      }
    });
    chrome.storage.managed?.get(['KillSwitch'], (managed) => {
      if (managed?.KillSwitch) teardownKillSwitch();
    });
    chrome.storage.local?.get(['auraKillSwitchActive'], (local) => {
      if (local?.auraKillSwitchActive) teardownKillSwitch();
    });
    chrome.storage?.onChanged?.addListener(handleStorageChange);
  }
})();

(() => {
  'use strict';

  const API_ENDPOINT = 'https://returnyoutubedislikeapi.com/votes?videoId=';
  const DISLIKE_COUNT_CLASS = 'cineglow-dislike-count';
  const HAS_DISLIKES_CLASS = 'cineglow-has-dislikes';
  const RATIO_BAR_CLASS = 'cineglow-ratio-bar';

  let isEnabled = false;
  let currentVideoId = null;
  let votesCache = new Map(); // videoId -> { id, likes, dislikes, rating, viewCount, userVote }
  let domObserver = null;
  let fetchAbortController = null;
  let isUpdating = false;

  // Compact number formatting (e.g. 521K, 1.4M, 245)
  function formatCount(num) {
    if (num == null || isNaN(num)) return '';
    if (num < 1000) return String(num);

    try {
      const formatter = new Intl.NumberFormat(navigator.language || 'en', {
        notation: 'compact',
        compactDisplay: 'short',
        maximumFractionDigits: 1
      });
      return formatter.format(num);
    } catch {
      if (num >= 1e6) return (num / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
      if (num >= 1e3) return (num / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
      return String(num);
    }
  }

  // Extract current video ID from URL or player state
  function getVideoId() {
    // 1. Standard watch page: /watch?v=...
    const urlParams = new URLSearchParams(window.location.search);
    const v = urlParams.get('v');
    if (v) return v;

    // 2. Shorts: /shorts/...
    if (window.location.pathname.startsWith('/shorts/')) {
      const parts = window.location.pathname.split('/shorts/');
      if (parts[1]) {
        return parts[1].split('/')[0].split('?')[0];
      }
    }

    // 3. Fallback: window.CineGlowPlayer state
    if (window.CineGlowPlayer && window.CineGlowPlayer.videoId) {
      return window.CineGlowPlayer.videoId;
    }

    return null;
  }

  // Fetch votes from Return YouTube Dislike API
  async function fetchVotes(videoId) {
    if (!videoId) return null;

    if (votesCache.has(videoId)) {
      return votesCache.get(videoId);
    }

    if (fetchAbortController) {
      fetchAbortController.abort();
    }
    fetchAbortController = new AbortController();

    try {
      const response = await fetch(`${API_ENDPOINT}${encodeURIComponent(videoId)}`, {
        signal: fetchAbortController.signal,
        cache: 'no-cache'
      });

      if (!response.ok) return null;

      const data = await response.json();
      if (data && typeof data.dislikes === 'number') {
        const voteRecord = {
          id: videoId,
          likes: Number(data.likes) || 0,
          dislikes: Number(data.dislikes) || 0,
          rating: Number(data.rating) || 5,
          viewCount: Number(data.viewCount) || 0,
          userVote: 0 // 0 = none, 1 = liked, -1 = disliked
        };

        votesCache.set(videoId, voteRecord);

        // Keep cache bounded to 100 entries
        if (votesCache.size > 100) {
          const oldestKey = votesCache.keys().next().value;
          votesCache.delete(oldestKey);
        }

        return voteRecord;
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        // Silently handle network/API errors without disrupting YouTube playback
      }
    }

    return null;
  }

  // Locate like & dislike button elements across modern Polymer and legacy templates
  function findDislikeElements() {
    // Modern segmented like/dislike buttons
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
        return {
          dislikeBtn,
          likeBtn,
          wrapper: segmentedWrapper,
          isShorts: false
        };
      }
    }

    // Direct dislike-button-view-model query
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

    // Legacy segmented button renderer
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

    // YouTube Shorts dislike button
    if (window.location.pathname.startsWith('/shorts/')) {
      const activeReel = document.querySelector('ytd-reel-video-renderer[is-active]') || document.querySelector('ytd-reel-video-renderer');
      if (activeReel) {
        const shortsDislike = activeReel.querySelector('#dislike-button');
        if (shortsDislike) {
          const shortsBtn = shortsDislike.querySelector('button') || shortsDislike;
          const shortsLike = activeReel.querySelector('#like-button');
          return {
            dislikeBtn: shortsBtn,
            likeBtn: shortsLike ? (shortsLike.querySelector('button') || shortsLike) : null,
            wrapper: shortsDislike,
            isShorts: true
          };
        }
      }
    }

    return null;
  }

  // Render dislike count and ratio bar safely into the DOM (Trusted Types compliant)
  function renderDislikes(voteRecord) {
    if (!isEnabled || !voteRecord) return;

    const elements = findDislikeElements();
    if (!elements || !elements.dislikeBtn) return;

    const { dislikeBtn, likeBtn, wrapper, isShorts } = elements;

    const formattedExact = voteRecord.dislikes.toLocaleString();
    const formattedCompact = formatCount(voteRecord.dislikes);

    // Update dislike button attributes
    dislikeBtn.title = `${formattedExact} dislikes`;
    dislikeBtn.setAttribute('aria-label', `Dislike this video along with ${formattedExact} other people`);
    dislikeBtn.classList.add(HAS_DISLIKES_CLASS);
    dislikeBtn.classList.remove('ytSpecButtonShapeNextIconButton');

    // Update or create dislike count element
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

    if (countEl.textContent !== formattedCompact) {
      countEl.textContent = formattedCompact;
    }

    // Render Like/Dislike Ratio Bar on watch page
    if (!isShorts && wrapper) {
      renderRatioBar(wrapper, voteRecord.likes, voteRecord.dislikes);
    }

    // Attach optimistic voting listeners
    attachVoteListeners(dislikeBtn, likeBtn, voteRecord);
  }

  // Render or update rating ratio bar underneath the segmented buttons
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

  // Optimistic click feedback for like and dislike buttons
  function attachVoteListeners(dislikeBtn, likeBtn, voteRecord) {
    if (dislikeBtn && !dislikeBtn._cineglowDislikeBound) {
      dislikeBtn._cineglowDislikeBound = true;
      dislikeBtn.addEventListener('click', () => {
        if (!isEnabled || !voteRecord) return;

        setTimeout(() => {
          const isPressed = dislikeBtn.getAttribute('aria-pressed') === 'true';
          if (isPressed && voteRecord.userVote !== -1) {
            if (voteRecord.userVote === 1) {
              voteRecord.likes = Math.max(0, voteRecord.likes - 1);
            }
            voteRecord.dislikes += 1;
            voteRecord.userVote = -1;
          } else if (!isPressed && voteRecord.userVote === -1) {
            voteRecord.dislikes = Math.max(0, voteRecord.dislikes - 1);
            voteRecord.userVote = 0;
          }
          renderDislikes(voteRecord);
        }, 50);
      });
    }

    if (likeBtn && !likeBtn._cineglowLikeBound) {
      likeBtn._cineglowLikeBound = true;
      likeBtn.addEventListener('click', () => {
        if (!isEnabled || !voteRecord) return;

        setTimeout(() => {
          const isPressed = likeBtn.getAttribute('aria-pressed') === 'true';
          if (isPressed && voteRecord.userVote !== 1) {
            if (voteRecord.userVote === -1) {
              voteRecord.dislikes = Math.max(0, voteRecord.dislikes - 1);
            }
            voteRecord.likes += 1;
            voteRecord.userVote = 1;
          } else if (!isPressed && voteRecord.userVote === 1) {
            voteRecord.likes = Math.max(0, voteRecord.likes - 1);
            voteRecord.userVote = 0;
          }
          renderDislikes(voteRecord);
        }, 50);
      });
    }
  }

  // Clean teardown when user disables Return YouTube Dislike
  function teardown() {
    if (domObserver) {
      domObserver.disconnect();
      domObserver = null;
    }

    if (fetchAbortController) {
      fetchAbortController.abort();
      fetchAbortController = null;
    }

    // Remove injected dislike counters
    document.querySelectorAll(`.${DISLIKE_COUNT_CLASS}`).forEach(el => el.remove());

    // Remove ratio bars
    document.querySelectorAll(`.${RATIO_BAR_CLASS}`).forEach(el => el.remove());

    // Restore dislike button styling & attributes
    document.querySelectorAll(`.${HAS_DISLIKES_CLASS}`).forEach(btn => {
      btn.classList.remove(HAS_DISLIKES_CLASS);
      btn.removeAttribute('title');
      btn.setAttribute('aria-label', 'Dislike this video');
      delete btn._cineglowDislikeBound;
    });

    document.querySelectorAll('like-button-view-model button, #like-button button').forEach(btn => {
      delete btn._cineglowLikeBound;
    });
  }

  // Update dislikes for currently playing video
  async function updateForCurrentVideo() {
    if (!isEnabled || isUpdating) return;
    isUpdating = true;

    try {
      const videoId = getVideoId();
      if (!videoId) return;

      currentVideoId = videoId;
      const voteData = await fetchVotes(videoId);

      // Verify video didn't change while fetch was in-flight
      if (voteData && getVideoId() === videoId) {
        renderDislikes(voteData);
      }
    } finally {
      isUpdating = false;
    }
  }

  // Watch DOM mutations to ensure dislike counter stays rendered across Polymer updates
  function startObserver() {
    if (domObserver || !isEnabled) return;

    domObserver = new MutationObserver(() => {
      if (!isEnabled) return;

      const vid = getVideoId();
      if (vid && vid !== currentVideoId) {
        currentVideoId = vid;
        updateForCurrentVideo();
        return;
      }

      // Check if dislike button exists but is missing our counter
      const elements = findDislikeElements();
      if (elements && elements.dislikeBtn) {
        if (!elements.dislikeBtn.querySelector(`.${DISLIKE_COUNT_CLASS}`)) {
          if (currentVideoId && votesCache.has(currentVideoId)) {
            renderDislikes(votesCache.get(currentVideoId));
          } else {
            updateForCurrentVideo();
          }
        }
      }
    });

    domObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  function initialize() {
    if (!isEnabled) return;
    updateForCurrentVideo();
    startObserver();
  }

  // YouTube SPA Navigation listeners
  document.addEventListener('yt-navigate-finish', () => {
    if (isEnabled) {
      updateForCurrentVideo();
    }
  });

  if (window.CineGlowPlayer) {
    window.CineGlowPlayer.addEventListener('state-change', () => {
      if (isEnabled) {
        const vid = getVideoId();
        if (vid !== currentVideoId) {
          updateForCurrentVideo();
        }
      }
    });
  }

  // Load setting from storage (default: false)
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
    chrome.storage.sync.get({ returnDislikes: false }, (items) => {
      isEnabled = !!items.returnDislikes;
      if (isEnabled) {
        initialize();
      }
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' && 'returnDislikes' in changes) {
        isEnabled = !!changes.returnDislikes.newValue;
        if (isEnabled) {
          initialize();
        } else {
          teardown();
        }
      }
    });
  }

  // Initial check when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      if (isEnabled) initialize();
    });
  } else {
    if (isEnabled) initialize();
  }
})();

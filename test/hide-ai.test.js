const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { setupMockEnvironment, MockElement, MockVideoElement, MockMutationObserver } = require('./helpers/mock-dom');

const REPO_ROOT = path.resolve(__dirname, '..');
const defaultsCode = fs.readFileSync(path.join(REPO_ROOT, 'shared/defaults.js'), 'utf8');
const hideAiCode = fs.readFileSync(path.join(REPO_ROOT, 'content/hide-ai.js'), 'utf8');
const mainWorldCode = fs.readFileSync(path.join(REPO_ROOT, 'content/main-world.js'), 'utf8');

function loadDefaults() {
  const ctx = { globalThis: {} };
  new Function('globalThis', `${defaultsCode}; globalThis.AURA_DEFAULTS = AURA_DEFAULTS;`)(ctx.globalThis);
  return ctx.globalThis.AURA_DEFAULTS;
}

describe('Hide AI Videos (Option 1: YouTube Official Disclosures)', () => {
  let env;
  let origGlobals;

  beforeEach(() => {
    env = setupMockEnvironment();
    origGlobals = {
      window: globalThis.window,
      document: globalThis.document,
      chrome: globalThis.chrome,
      MutationObserver: globalThis.MutationObserver
    };
    globalThis.window = env.window;
    globalThis.document = env.document;
    globalThis.chrome = env.chrome;
    globalThis.MutationObserver = class {
      observe() {}
      disconnect() {}
    };
    globalThis.AURA_DEFAULTS = loadDefaults();
  });

  afterEach(() => {
    try {
      globalThis.window?.CineGlowHideAi?.teardownKillSwitch?.();
    } catch (_) {}
    delete globalThis.AURA_DEFAULTS;
    globalThis.window = origGlobals.window;
    globalThis.document = origGlobals.document;
    globalThis.chrome = origGlobals.chrome;
    globalThis.MutationObserver = origGlobals.MutationObserver;
  });

  test('defaults.js keeps hideAiVideos false by default', () => {
    const defaults = loadDefaults();
    assert.strictEqual(defaults.hideAiVideos, false);
  });

  test('hides feed cards with official disclosure badge while sparing tech/AI title false positives', async () => {
    const disclosedCard = new MockElement('ytd-rich-item-renderer');
    const disclosedTitle = new MockElement('a', { id: 'video-title' });
    disclosedTitle.textContent = 'Short Film';
    const badge = new MockElement('yt-badge-view-model');
    badge.textContent = 'Altered or synthetic content';
    disclosedCard.appendChild(disclosedTitle);
    disclosedCard.appendChild(badge);

    const tutorialCard = new MockElement('ytd-rich-item-renderer');
    const tutorialTitle = new MockElement('a', { id: 'video-title' });
    tutorialTitle.textContent = 'Build an AI Agent — Made with AI Tools? Honest Review';
    const cleanBadge = new MockElement('yt-badge-view-model');
    cleanBadge.textContent = '4K';
    tutorialCard.appendChild(tutorialTitle);
    tutorialCard.appendChild(cleanBadge);

    env.document.body.appendChild(disclosedCard);
    env.document.body.appendChild(tutorialCard);

    env.chrome.storage.sync._data = { hideAiVideos: true };
    new Function(hideAiCode)();
    await new Promise(r => setTimeout(r, 15));

    assert.strictEqual(disclosedCard.getAttribute('data-cineglow-ai-hidden'), 'true');
    assert.strictEqual(tutorialCard.hasAttribute('data-cineglow-ai-hidden'), false);

    // Toggling off restores cards cleanly
    for (const listener of env.chrome.storage.onChanged._listeners) {
      listener({ hideAiVideos: { newValue: false } }, 'sync');
    }
    assert.strictEqual(disclosedCard.hasAttribute('data-cineglow-ai-hidden'), false);
  });

  test('detects Watch Page official disclosure DOM panel while ignoring description prose', async () => {
    env.window.location.href = 'https://www.youtube.com/watch?v=aiVid123456';
    env.window.location.pathname = '/watch';
    env.window.location.search = '?v=aiVid123456';

    const player = new MockElement('div', { id: 'movie_player' });
    const video = new MockVideoElement();
    video.paused = false;
    let pauseCount = 0;
    video.pause = () => {
      pauseCount += 1;
      video.paused = true;
    };
    player.appendChild(video);

    // Prose inside #description must NOT trigger hiding
    const descWrapper = new MockElement('div', { id: 'description' });
    const expander = new MockElement('ytd-text-inline-expander');
    const fakeAttrInsideDesc = new MockElement('yt-attribute-view-model');
    fakeAttrInsideDesc.textContent = 'This video discusses Altered or synthetic content policies';
    expander.appendChild(fakeAttrInsideDesc);
    descWrapper.appendChild(expander);

    env.document.body.appendChild(player);
    env.document.body.appendChild(descWrapper);
    env.elements.set('#movie_player', player);

    env.chrome.storage.sync._data = { hideAiVideos: true };
    new Function(hideAiCode)();
    await new Promise(r => setTimeout(r, 15));

    assert.strictEqual(env.document.documentElement.hasAttribute('cineglow-ai-watch-hidden'), false);
    assert.strictEqual(pauseCount, 0);

    // Now mount official structured YouTube disclosure panel outside #description
    const panel = new MockElement('ytd-video-attributes-renderer');
    panel.textContent = 'How this content was made · Altered or synthetic content';
    env.document.body.appendChild(panel);
    globalThis.window.CineGlowHideAi.scanWatchDisclosure();

    assert.strictEqual(env.document.documentElement.getAttribute('cineglow-ai-watch-hidden'), 'true');
    assert.strictEqual(video.paused, true);
    const overlay = env.document.getElementById('cineglow-ai-disclosure-overlay');
    assert.ok(overlay, 'Disclosure overlay must be mounted on watch page');

    // Clicking Watch Anyway dismisses overlay for this video ID and resumes video
    let playCount = 0;
    video.play = () => {
      playCount += 1;
      video.paused = false;
      return Promise.resolve();
    };
    const watchAnywayBtn = overlay.querySelector('.cineglow-ai-btn-secondary');
    assert.ok(watchAnywayBtn, 'Watch Anyway button must exist');
    watchAnywayBtn.click();

    assert.strictEqual(env.document.documentElement.hasAttribute('cineglow-ai-watch-hidden'), false);
    assert.strictEqual(env.document.getElementById('cineglow-ai-disclosure-overlay'), null);
    assert.strictEqual(playCount, 1);
  });

  test('responds to MAIN world disclosure bridge and ignores stale videoId messages', async () => {
    env.window.location.href = 'https://www.youtube.com/watch?v=curr1234567';
    env.window.location.pathname = '/watch';
    env.window.location.search = '?v=curr1234567';

    const player = new MockElement('div', { id: 'movie_player' });
    const video = new MockVideoElement();
    video.paused = false;
    player.appendChild(video);
    env.document.body.appendChild(player);
    env.elements.set('#movie_player', player);

    env.chrome.storage.sync._data = { hideAiVideos: true };
    new Function(hideAiCode)();
    await new Promise(r => setTimeout(r, 15));

    // Stale response for another video ID must be ignored
    env.window.dispatchEvent(Object.assign(new Event('message'), {
      source: env.window,
      origin: env.window.location.origin,
      data: {
        type: 'CINEGLOW_AI_DISCLOSURE_RESPONSE',
        videoId: 'old00000000',
        disclosed: true,
        reason: 'Made with AI'
      }
    }));
    assert.strictEqual(env.document.documentElement.hasAttribute('cineglow-ai-watch-hidden'), false);

    // Matching video ID response blocks player
    env.window.dispatchEvent(Object.assign(new Event('message'), {
      source: env.window,
      origin: env.window.location.origin,
      data: {
        type: 'CINEGLOW_AI_DISCLOSURE_RESPONSE',
        videoId: 'curr1234567',
        disclosed: true,
        reason: 'Made with AI'
      }
    }));
    assert.strictEqual(env.document.documentElement.getAttribute('cineglow-ai-watch-hidden'), 'true');
    assert.ok(env.document.getElementById('cineglow-ai-disclosure-overlay'));

    // Kill switch removes overlay and restores attributes
    for (const fn of env.chrome.runtime.onMessage._listeners) {
      fn({ type: 'AURA_EMERGENCY_KILL_SWITCH' }, {}, () => {});
    }
    assert.strictEqual(env.document.documentElement.hasAttribute('cineglow-ai-watch-hidden'), false);
    assert.strictEqual(env.document.getElementById('cineglow-ai-disclosure-overlay'), null);
  });

  test('hides cards with badge-style AI_DISCLOSURE attribute even without disclosure text', async () => {
    const aiCard = new MockElement('ytd-rich-item-renderer');
    const badge = new MockElement('yt-badge-shape');
    badge.setAttribute('badge-style', 'BADGE_STYLE_TYPE_AI_DISCLOSURE');
    badge.textContent = '';  // No readable text, just the attribute
    aiCard.appendChild(badge);

    const normalCard = new MockElement('ytd-rich-item-renderer');
    const normalBadge = new MockElement('yt-badge-shape');
    normalBadge.setAttribute('badge-style', 'BADGE_STYLE_TYPE_SIMPLE');
    normalBadge.textContent = 'New';
    normalCard.appendChild(normalBadge);

    env.document.body.appendChild(aiCard);
    env.document.body.appendChild(normalCard);

    env.chrome.storage.sync._data = { hideAiVideos: true };
    new Function(hideAiCode)();
    await new Promise(r => setTimeout(r, 15));

    assert.strictEqual(aiCard.getAttribute('data-cineglow-ai-hidden'), 'true',
      'Card with badge-style AI_DISCLOSURE must be hidden');
    assert.strictEqual(normalCard.hasAttribute('data-cineglow-ai-hidden'), false,
      'Card with badge-style SIMPLE must not be hidden');
  });

  test('main-world.js detects newer isAiGenerated and hasAiDisclosure flag keys', () => {
    const posted = [];
    const listeners = [];
    const flexy = new MockElement('ytd-watch-flexy', { 'video-id': 'flagVid00001' });
    flexy.data = {
      currentVideoEndpoint: { watchEndpoint: { videoId: 'flagVid00001' } },
      engagementPanels: []
    };

    const player = new MockElement('div', { id: 'movie_player' });
    player.getPlayerResponse = () => ({
      videoDetails: { videoId: 'flagVid00001' },
      microformat: {
        playerMicroformatRenderer: {
          externalVideoId: 'flagVid00001',
          isAiGenerated: true
        }
      }
    });

    const mwWindow = {
      location: {
        href: 'https://www.youtube.com/watch?v=flagVid00001',
        pathname: '/watch',
        search: '?v=flagVid00001',
        origin: 'https://www.youtube.com'
      },
      ytInitialData: null,
      ytInitialPlayerResponse: null,
      addEventListener: (type, fn) => listeners.push({ type, fn }),
      removeEventListener: () => {},
      postMessage: (data, origin) => posted.push({ data, origin })
    };

    const mwDoc = {
      readyState: 'complete',
      hidden: false,
      documentElement: new MockElement('html'),
      addEventListener: () => {},
      removeEventListener: () => {},
      getElementById: (id) => (id === 'movie_player' ? player : null),
      querySelector: (sel) => (sel === 'ytd-watch-flexy' ? flexy : null)
    };

    const fn = new Function('window', 'document', 'JSON', 'Function', 'setTimeout', 'setInterval', 'clearInterval', mainWorldCode);
    fn(mwWindow, mwDoc, JSON, Function, setTimeout, setInterval, clearInterval);

    const checkListener = listeners.find(l => l.type === 'message' && l.fn.name === 'handleAiDisclosureMessage');
    assert.ok(checkListener);

    checkListener.fn({
      source: mwWindow,
      origin: mwWindow.location.origin,
      data: { type: 'CINEGLOW_CHECK_AI_DISCLOSURE' }
    });

    const msg = posted.find(p => p.data?.type === 'CINEGLOW_AI_DISCLOSURE_RESPONSE');
    assert.ok(msg, 'Should emit disclosure response');
    assert.strictEqual(msg.data.videoId, 'flagVid00001');
    assert.strictEqual(msg.data.disclosed, true, 'isAiGenerated: true must trigger disclosure');
  });

  test('main-world.js inspects howThisContentWasMade structured blocks while ignoring shortDescription and stale payloads', () => {
    const posted = [];
    const listeners = [];
    const doc = new MockElement('document');
    const flexy = new MockElement('ytd-watch-flexy', { 'video-id': 'vidCurr11111' });
    flexy.data = {
      currentVideoEndpoint: { watchEndpoint: { videoId: 'vidCurr11111' } },
      engagementPanels: [
        {
          engagementPanelSectionListRenderer: {
            content: {
              structuredDescriptionContentRenderer: {
                items: [
                  {
                    videoAttributesSectionViewModel: {
                      howThisContentWasMade: {
                        title: { content: 'How this content was made' },
                        subtitle: { content: 'Altered or synthetic content' }
                      }
                    }
                  }
                ]
              }
            }
          }
        }
      ]
    };

    const player = new MockElement('div', { id: 'movie_player' });
    player.getPlayerResponse = () => ({
      videoDetails: {
        videoId: 'vidCurr11111',
        shortDescription: 'We talk about Altered or synthetic content rules.'
      }
    });

    const mwWindow = {
      location: {
        href: 'https://www.youtube.com/watch?v=vidCurr11111',
        pathname: '/watch',
        search: '?v=vidCurr11111',
        origin: 'https://www.youtube.com'
      },
      ytInitialData: {
        currentVideoEndpoint: { watchEndpoint: { videoId: 'stale9999999' } },
        howThisContentWasMade: { title: 'How this content was made' }
      },
      addEventListener: (type, fn) => listeners.push({ type, fn }),
      removeEventListener: () => {},
      postMessage: (data, origin) => posted.push({ data, origin })
    };

    const mwDoc = {
      readyState: 'complete',
      hidden: false,
      documentElement: new MockElement('html'),
      addEventListener: () => {},
      removeEventListener: () => {},
      getElementById: (id) => (id === 'movie_player' ? player : null),
      querySelector: (sel) => (sel === 'ytd-watch-flexy' ? flexy : null)
    };

    const fn = new Function('window', 'document', 'JSON', 'Function', 'setTimeout', 'setInterval', 'clearInterval', mainWorldCode);
    fn(mwWindow, mwDoc, JSON, Function, setTimeout, setInterval, clearInterval);

    const checkListener = listeners.find(l => l.type === 'message' && l.fn.name === 'handleAiDisclosureMessage');
    assert.ok(checkListener, 'handleAiDisclosureMessage must register on window');

    checkListener.fn({
      source: mwWindow,
      origin: mwWindow.location.origin,
      data: { type: 'CINEGLOW_CHECK_AI_DISCLOSURE' }
    });

    let msg = posted.find(p => p.data?.type === 'CINEGLOW_AI_DISCLOSURE_RESPONSE');
    assert.ok(msg, 'Should emit disclosure response');
    assert.strictEqual(msg.data.videoId, 'vidCurr11111');
    assert.strictEqual(msg.data.disclosed, true);

    // Clear structured disclosure while keeping shortDescription text mentioning AI + stale ytInitialData
    posted.length = 0;
    flexy.data = {
      currentVideoEndpoint: { watchEndpoint: { videoId: 'vidCurr11111' } },
      engagementPanels: []
    };
    checkListener.fn({
      source: mwWindow,
      origin: mwWindow.location.origin,
      data: { type: 'CINEGLOW_CHECK_AI_DISCLOSURE' }
    });
    msg = posted.find(p => p.data?.type === 'CINEGLOW_AI_DISCLOSURE_RESPONSE');
    assert.strictEqual(msg.data.disclosed, false, 'shortDescription & mismatched stale ytInitialData must not false-positive');
  });

  test('hides feed cards from CINEGLOW_FEED_AI_DISCLOSURES_RESPONSE while ignoring untrusted origins', async () => {
    const mwCard = new MockElement('ytd-rich-item-renderer');
    const mwLink = new MockElement('a', { href: '/watch?v=mwFeed00001' });
    mwLink.textContent = 'Synthetic Reveal Without Badge';
    mwCard.appendChild(mwLink);

    const cleanCard = new MockElement('ytd-rich-item-renderer');
    const cleanLink = new MockElement('a', { href: '/watch?v=mwClean0002' });
    cleanLink.textContent = 'Regular Tutorial';
    cleanCard.appendChild(cleanLink);

    env.document.body.appendChild(mwCard);
    env.document.body.appendChild(cleanCard);

    env.chrome.storage.sync._data = { hideAiVideos: true };
    new Function(hideAiCode)();
    await new Promise(r => setTimeout(r, 15));

    // Untrusted origin must be ignored
    env.window.dispatchEvent(Object.assign(new Event('message'), {
      source: env.window,
      origin: 'https://evil.example',
      data: {
        type: 'CINEGLOW_FEED_AI_DISCLOSURES_RESPONSE',
        videoIds: ['mwClean0002']
      }
    }));
    assert.strictEqual(cleanCard.hasAttribute('data-cineglow-ai-hidden'), false);

    // Trusted same-origin response hides disclosed card via knownDisclosedVideoIds
    env.window.dispatchEvent(Object.assign(new Event('message'), {
      source: env.window,
      origin: env.window.location.origin,
      data: {
        type: 'CINEGLOW_FEED_AI_DISCLOSURES_RESPONSE',
        videoIds: ['mwFeed00001']
      }
    }));
    assert.strictEqual(mwCard.getAttribute('data-cineglow-ai-hidden'), 'true');
    assert.strictEqual(cleanCard.hasAttribute('data-cineglow-ai-hidden'), false);
  });

  test('hides disclosed Shorts cards (ytd-reel-item-renderer, ytm-shorts-lockup-view-model, v2) and extracts card.data in main-world.js', async () => {
    const reelCard = new MockElement('ytd-reel-item-renderer');
    const reelBadge = new MockElement('yt-badge-shape');
    reelBadge.setAttribute('badge-style', 'BADGE_STYLE_TYPE_AI_DISCLOSURE');
    reelCard.appendChild(reelBadge);

    const lockupCard = new MockElement('ytm-shorts-lockup-view-model');
    const lockupLink = new MockElement('a', { href: '/shorts/aiShort0002' });
    lockupCard.appendChild(lockupLink);
    lockupCard.data = {
      shortsLockupViewModel: {
        onTap: { innertubeCommand: { reelWatchEndpoint: { videoId: 'aiShort0002' } } },
        badges: [{ badgeViewModel: { badgeStyle: 'BADGE_STYLE_TYPE_AI_DISCLOSURE' } }]
      }
    };

    const lockupV2Card = new MockElement('ytm-shorts-lockup-view-model-v2');
    const v2Badge = new MockElement('yt-badge-view-model');
    v2Badge.textContent = 'Altered or synthetic content';
    lockupV2Card.appendChild(v2Badge);

    const cleanShort = new MockElement('ytm-shorts-lockup-view-model');
    const cleanShortLink = new MockElement('a', { href: '/shorts/cleanSh0003' });
    cleanShort.appendChild(cleanShortLink);
    cleanShort.data = {
      shortsLockupViewModel: {
        onTap: { innertubeCommand: { reelWatchEndpoint: { videoId: 'cleanSh0003' } } }
      }
    };

    env.document.body.appendChild(reelCard);
    env.document.body.appendChild(lockupCard);
    env.document.body.appendChild(lockupV2Card);
    env.document.body.appendChild(cleanShort);

    env.chrome.storage.sync._data = { hideAiVideos: true };
    new Function(hideAiCode)();
    await new Promise(r => setTimeout(r, 15));

    assert.strictEqual(reelCard.getAttribute('data-cineglow-ai-hidden'), 'true');
    assert.strictEqual(lockupV2Card.getAttribute('data-cineglow-ai-hidden'), 'true');
    assert.strictEqual(lockupCard.hasAttribute('data-cineglow-ai-hidden'), false);

    // Run main-world.js feed inspector against the Shorts cards
    const posted = [];
    const listeners = [];
    const mwWindow = {
      location: { href: 'https://www.youtube.com/', pathname: '/', search: '', origin: 'https://www.youtube.com' },
      ytInitialData: null,
      ytInitialPlayerResponse: null,
      addEventListener: (type, fn) => listeners.push({ type, fn }),
      removeEventListener: () => {},
      postMessage: (data, origin) => posted.push({ data, origin })
    };
    const mwDoc = {
      readyState: 'complete',
      hidden: false,
      documentElement: new MockElement('html'),
      addEventListener: () => {},
      removeEventListener: () => {},
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: (sel) => (sel.includes('ytm-shorts-lockup-view-model') ? [lockupCard, cleanShort] : [])
    };
    new Function('window', 'document', 'JSON', 'Function', 'setTimeout', 'setInterval', 'clearInterval', mainWorldCode)(
      mwWindow, mwDoc, JSON, Function, setTimeout, setInterval, clearInterval
    );
    const mwListener = listeners.find(l => l.type === 'message' && l.fn.name === 'handleAiDisclosureMessage');
    mwListener.fn({
      source: mwWindow,
      origin: mwWindow.location.origin,
      data: { type: 'CINEGLOW_CHECK_FEED_AI_DISCLOSURES' }
    });
    const feedResp = posted.find(p => p.data?.type === 'CINEGLOW_FEED_AI_DISCLOSURES_RESPONSE');
    assert.ok(feedResp, 'main-world.js must emit CINEGLOW_FEED_AI_DISCLOSURES_RESPONSE');
    assert.ok(feedResp.data.videoIds.includes('aiShort0002'), 'main-world.js must extract disclosed Shorts videoId');
    assert.strictEqual(feedResp.data.videoIds.includes('cleanSh0003'), false);

    // Forward MAIN world response to hide-ai.js
    env.window.dispatchEvent(Object.assign(new Event('message'), {
      source: env.window,
      origin: env.window.location.origin,
      data: feedResp.data
    }));
    assert.strictEqual(lockupCard.getAttribute('data-cineglow-ai-hidden'), 'true');
    assert.strictEqual(cleanShort.hasAttribute('data-cineglow-ai-hidden'), false);
  });

  test('detects structured panels inside #description and empty AI_DISCLOSURE badges while ignoring sidebar cards', async () => {
    env.window.location.href = 'https://www.youtube.com/watch?v=descPanel01';
    env.window.location.pathname = '/watch';
    env.window.location.search = '?v=descPanel01';

    const player = new MockElement('div', { id: 'movie_player' });
    player.appendChild(new MockVideoElement());
    env.document.body.appendChild(player);
    env.elements.set('#movie_player', player);

    // Sidebar card with AI_DISCLOSURE badge must NOT block the watch page itself
    const related = new MockElement('div', { id: 'related' });
    const sidebarCard = new MockElement('ytd-compact-video-renderer');
    const sidebarBadge = new MockElement('yt-badge-shape');
    sidebarBadge.setAttribute('badge-style', 'BADGE_STYLE_TYPE_AI_DISCLOSURE');
    sidebarCard.appendChild(sidebarBadge);
    related.appendChild(sidebarCard);
    env.document.body.appendChild(related);

    // Description expander prose must also be ignored
    const descWrapper = new MockElement('div', { id: 'description' });
    const expander = new MockElement('ytd-text-inline-expander', { id: 'description-inline-expander' });
    const proseAttr = new MockElement('yt-attribute-view-model');
    proseAttr.textContent = 'Altered or synthetic content commentary';
    expander.appendChild(proseAttr);
    descWrapper.appendChild(expander);
    env.document.body.appendChild(descWrapper);

    env.chrome.storage.sync._data = { hideAiVideos: true };
    new Function(hideAiCode)();
    await new Promise(r => setTimeout(r, 15));

    assert.strictEqual(sidebarCard.getAttribute('data-cineglow-ai-hidden'), 'true', 'Sidebar card must still be hidden');
    assert.strictEqual(env.document.documentElement.hasAttribute('cineglow-ai-watch-hidden'), false,
      'Sidebar AI_DISCLOSURE badge must NOT trigger watch-page blocking');

    // Structured panel inside #description (sibling to expander) MUST trigger watch-page detection
    const structured = new MockElement('ytd-structured-description-content-renderer');
    const panel = new MockElement('ytd-video-attributes-renderer');
    panel.textContent = 'How this content was made · Altered or synthetic content';
    structured.appendChild(panel);
    descWrapper.appendChild(structured);
    globalThis.window.CineGlowHideAi.scanWatchDisclosure();

    assert.strictEqual(env.document.documentElement.getAttribute('cineglow-ai-watch-hidden'), 'true');
    assert.ok(env.document.getElementById('cineglow-ai-disclosure-overlay'));

    // Also verify empty-text [badge-style*="AI_DISCLOSURE"] on watch page uses fallback reason
    env.window.location.href = 'https://www.youtube.com/watch?v=emptyBadge2';
    env.window.location.search = '?v=emptyBadge2';
    panel.remove();
    const watchBadge = new MockElement('yt-badge-shape');
    watchBadge.setAttribute('badge-style', 'BADGE_STYLE_TYPE_AI_DISCLOSURE');
    watchBadge.textContent = '';
    structured.appendChild(watchBadge);
    globalThis.window.CineGlowHideAi.scanWatchDisclosure();

    assert.strictEqual(env.document.documentElement.getAttribute('cineglow-ai-watch-hidden'), 'true');
    assert.strictEqual(globalThis.window.CineGlowHideAi.getState().disclosureReason, 'Altered or synthetic content');
  });

  test('MutationObserver infinite scroll throttles MAIN-world feed re-queries and ignores overlay-only mutations', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    globalThis.MutationObserver = MockMutationObserver;

    const posted = [];
    const origPostMessage = env.window.postMessage.bind(env.window);
    env.window.postMessage = (data, origin) => {
      posted.push(data);
      return origPostMessage(data, origin);
    };

    env.chrome.storage.sync._data = { hideAiVideos: true };
    new Function(hideAiCode)();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    const observer = MockMutationObserver.instances[0];
    assert.ok(observer, 'HideAI must attach a MutationObserver');
    const initialFeedQueries = posted.filter(m => m?.type === 'CINEGLOW_CHECK_FEED_AI_DISCLOSURES').length;
    assert.strictEqual(initialFeedQueries, 1);

    // Infinite scroll appends a new feed card within cooldown window -> trailing timer fires once
    const lateCard = new MockElement('ytd-rich-item-renderer');
    lateCard.appendChild(new MockElement('a', { href: '/watch?v=lateInf0001' }));
    env.document.body.appendChild(lateCard);
    observer.trigger([{ target: env.document.body, addedNodes: [lateCard], removedNodes: [] }]);

    t.mock.timers.tick(50);
    assert.strictEqual(posted.filter(m => m?.type === 'CINEGLOW_CHECK_FEED_AI_DISCLOSURES').length, initialFeedQueries);
    t.mock.timers.tick(2500);
    assert.strictEqual(
      posted.filter(m => m?.type === 'CINEGLOW_CHECK_FEED_AI_DISCLOSURES').length,
      initialFeedQueries + 1,
      'Trailing timer must re-query MAIN world after infinite-scroll batch'
    );

    // After cooldown elapsed, overlay-only mutation must still be ignored
    t.mock.timers.tick(2600);
    const fakeOverlay = new MockElement('div', { id: 'cineglow-ai-disclosure-overlay' });
    observer.trigger([{ target: env.document.body, addedNodes: [fakeOverlay], removedNodes: [] }]);
    t.mock.timers.tick(100);
    assert.strictEqual(
      posted.filter(m => m?.type === 'CINEGLOW_CHECK_FEED_AI_DISCLOSURES').length,
      initialFeedQueries + 1,
      'Overlay-only mutations must be ignored even after cooldown expires'
    );

    // Next scroll batch with cooldown elapsed fires leading-edge immediately
    const secondCard = new MockElement('ytd-rich-item-renderer');
    secondCard.appendChild(new MockElement('a', { href: '/watch?v=lateInf0002' }));
    env.document.body.appendChild(secondCard);
    observer.trigger([{ target: env.document.body, addedNodes: [secondCard], removedNodes: [] }]);
    assert.strictEqual(
      posted.filter(m => m?.type === 'CINEGLOW_CHECK_FEED_AI_DISCLOSURES').length,
      initialFeedQueries + 2,
      'Leading-edge query must fire immediately once throttle cooldown elapses'
    );

    // Deliver MAIN-world response -> both appended cards hidden
    env.window.dispatchEvent(Object.assign(new Event('message'), {
      source: env.window,
      origin: env.window.location.origin,
      data: { type: 'CINEGLOW_FEED_AI_DISCLOSURES_RESPONSE', videoIds: ['lateInf0001', 'lateInf0002'] }
    }));
    assert.strictEqual(lateCard.getAttribute('data-cineglow-ai-hidden'), 'true');
    assert.strictEqual(secondCard.getAttribute('data-cineglow-ai-hidden'), 'true');
  });

  test('syncWatchBlockingUi avoids rewriting identical overlay text and html attribute on repeated scans', async () => {
    env.window.location.href = 'https://www.youtube.com/watch?v=repeatScan1';
    env.window.location.pathname = '/watch';
    env.window.location.search = '?v=repeatScan1';

    const player = new MockElement('div', { id: 'movie_player' });
    player.appendChild(new MockVideoElement());
    const panel = new MockElement('ytd-video-attributes-renderer');
    panel.textContent = 'How this content was made · Altered or synthetic content';
    env.document.body.appendChild(player);
    env.document.body.appendChild(panel);
    env.elements.set('#movie_player', player);

    env.chrome.storage.sync._data = { hideAiVideos: true };
    new Function(hideAiCode)();
    await new Promise(r => setTimeout(r, 15));

    const overlay = env.document.getElementById('cineglow-ai-disclosure-overlay');
    assert.ok(overlay);
    const subtitle = overlay.querySelector('.cineglow-ai-reason');
    let textWrites = 0;
    let currentText = subtitle.textContent;
    Object.defineProperty(subtitle, 'textContent', {
      configurable: true,
      get: () => currentText,
      set: (val) => {
        textWrites += 1;
        currentText = val;
      }
    });

    let attrWrites = 0;
    const origSetAttr = env.document.documentElement.setAttribute.bind(env.document.documentElement);
    env.document.documentElement.setAttribute = (k, v) => {
      attrWrites += 1;
      return origSetAttr(k, v);
    };

    globalThis.window.CineGlowHideAi.scanWatchDisclosure();
    globalThis.window.CineGlowHideAi.scanWatchDisclosure();

    assert.strictEqual(textWrites, 0, 'Unchanged subtitle textContent must not be reassigned');
    assert.strictEqual(attrWrites, 0, 'Unchanged cineglow-ai-watch-hidden attr must not be rewritten');
  });
});

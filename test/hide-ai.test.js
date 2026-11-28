const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { setupMockEnvironment, MockElement, MockVideoElement } = require('./helpers/mock-dom');

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
});

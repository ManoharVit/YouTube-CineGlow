// test/shorts-dislikes-remediation.test.js
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setupMockEnvironment, MockElement } = require('./helpers/mock-dom');

const hideShortsCode = fs.readFileSync(path.join(__dirname, '../content/hide-shorts.js'), 'utf8');
const returnDislikesCode = fs.readFileSync(path.join(__dirname, '../content/return-dislikes.js'), 'utf8');
const defaultsCode = fs.readFileSync(path.join(__dirname, '../shared/defaults.js'), 'utf8');

describe('Remediations FP-8.1, FP-8.2, FP-8.3, FP-8.4', () => {
  let env;
  let originalWindow;
  let originalDocument;
  let originalChrome;

  beforeEach(() => {
    env = setupMockEnvironment('https://www.youtube.com/watch?v=testVid123');
    originalWindow = globalThis.window;
    originalDocument = globalThis.document;
    originalChrome = globalThis.chrome;

    globalThis.window = env.window;
    globalThis.document = env.document;
    globalThis.chrome = env.chrome;
    globalThis.window.chrome = env.chrome;
  });

  afterEach(() => {
    if (globalThis.window.CineGlowShortsTeardown) {
      try { globalThis.window.CineGlowShortsTeardown(); } catch (_) {}
    }
    if (globalThis.window.CineGlowDislikesTeardown) {
      try { globalThis.window.CineGlowDislikesTeardown(); } catch (_) {}
    }

    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
    globalThis.chrome = originalChrome;
  });

  test('FP-8.2: shared/defaults.js defaults hideEndCards to true', () => {
    const fn = new Function(`${defaultsCode}; return AURA_DEFAULTS;`);
    const defaults = fn();
    assert.strictEqual(defaults.hideEndCards, true, 'hideEndCards must default to true');
  });

  test('FP-8.1: click capture ignores external links with /shorts/ and only intercepts YouTube shorts links', () => {
    env.chrome.storage.sync._data = { hideShorts: true };
    new Function(hideShortsCode)();

    // 1. External link with /shorts/ in description
    const externalAnchor = new MockElement('a');
    externalAnchor.setAttribute('href', 'https://example.com/shorts/cool-video');
    externalAnchor.hostname = 'example.com';
    env.document.body.appendChild(externalAnchor);

    const externalEvent = new Event('click', { bubbles: true, cancelable: true });
    Object.defineProperty(externalEvent, 'target', { value: externalAnchor });
    env.document.dispatchEvent(externalEvent);

    assert.strictEqual(externalEvent.defaultPrevented, false, 'External link must NOT be prevented');

    // 2. YouTube shorts link
    const ytAnchor = new MockElement('a');
    ytAnchor.setAttribute('href', 'https://www.youtube.com/shorts/xyz123');
    ytAnchor.hostname = 'www.youtube.com';
    env.document.body.appendChild(ytAnchor);

    const ytEvent = new Event('click', { bubbles: true, cancelable: true });
    Object.defineProperty(ytEvent, 'target', { value: ytAnchor });
    env.document.dispatchEvent(ytEvent);

    assert.strictEqual(ytEvent.defaultPrevented, true, 'YouTube shorts link must be prevented');
  });

  test('FP-8.3: direct shorts link /shorts/<id> redirects to /watch?v=${shortId}', () => {
    let replacedUrl = null;
    env.window.location = {
      href: 'https://www.youtube.com/shorts/dQw4w9WgXcQ',
      pathname: '/shorts/dQw4w9WgXcQ',
      search: '',
      hostname: 'www.youtube.com',
      replace: (url) => { replacedUrl = url; }
    };

    env.chrome.storage.sync._data = { hideShorts: true };
    new Function(hideShortsCode)();

    assert.strictEqual(replacedUrl, '/watch?v=dQw4w9WgXcQ', 'Must redirect direct Shorts link to /watch?v=ID');
  });

  test('FP-8.3: bare /shorts path without video ID redirects to root /', () => {
    let replacedUrl = null;
    env.window.location = {
      href: 'https://www.youtube.com/shorts',
      pathname: '/shorts',
      search: '',
      hostname: 'www.youtube.com',
      replace: (url) => { replacedUrl = url; }
    };

    env.chrome.storage.sync._data = { hideShorts: true };
    new Function(hideShortsCode)();

    assert.strictEqual(replacedUrl, '/', 'Must redirect bare /shorts to /');
  });

  test('FP-8.4: dislike count rendering is keyed to active slide video ID across recycled Shorts DOM nodes', async () => {
    env.window.location = {
      href: 'https://www.youtube.com/shorts/shortSlide1',
      pathname: '/shorts/shortSlide1',
      search: '',
      hostname: 'www.youtube.com'
    };

    env.chrome.storage.sync._data = { returnDislikes: true };

    // Setup mock chrome runtime message handler for FETCH_DISLIKES
    const votesDb = {
      shortSlide1: { likes: 5000, dislikes: 120, rating: 4.8, viewCount: 50000 },
      shortSlide2: { likes: 100, dislikes: 2500, rating: 2.1, viewCount: 3000 }
    };

    env.chrome.runtime.sendMessage = (msg, callback) => {
      if (msg.type === 'FETCH_DISLIKES') {
        const data = votesDb[msg.videoId] || null;
        callback({ success: !!data, data });
      }
    };

    // Create a recycled reel video renderer
    const reel = new MockElement('ytd-reel-video-renderer', { 'data-video-id': 'shortSlide1', 'is-active': 'true' });
    const shortsDislike = new MockElement('div', { id: 'dislike-button' });
    const dislikeButton = new MockElement('button');
    shortsDislike.appendChild(dislikeButton);
    reel.appendChild(shortsDislike);
    env.document.body.appendChild(reel);

    new Function(returnDislikesCode)();

    // Allow promise resolution
    await new Promise(resolve => setTimeout(resolve, 50));

    // Verify slide 1 rendering and keying
    assert.strictEqual(dislikeButton.getAttribute('data-cineglow-video-id'), 'shortSlide1');
    const countEl = dislikeButton.querySelector('.cineglow-dislike-count');
    assert.ok(countEl, 'Dislike count element should be injected');
    assert.strictEqual(countEl.getAttribute('data-cineglow-video-id'), 'shortSlide1');
    assert.strictEqual(countEl.textContent, '120');

    // Now simulate slide transition to shortSlide2 on the RECYCLED DOM node
    reel.setAttribute('data-video-id', 'shortSlide2');
    env.window.location.pathname = '/shorts/shortSlide2';
    env.window.location.href = 'https://www.youtube.com/shorts/shortSlide2';

    // Dispatch popstate event to simulate Shorts scroll navigation
    env.window.dispatchEvent(new Event('popstate'));

    // Allow promise resolution
    await new Promise(resolve => setTimeout(resolve, 50));

    // Verify slide 2 rendering has updated the recycled node and re-keyed to shortSlide2
    assert.strictEqual(dislikeButton.getAttribute('data-cineglow-video-id'), 'shortSlide2');
    assert.strictEqual(countEl.getAttribute('data-cineglow-video-id'), 'shortSlide2');
    assert.strictEqual(countEl.textContent, '2.5K');
  });
});

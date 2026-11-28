// test/shorts-dislikes-remediation.test.js
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setupMockEnvironment, MockElement } = require('./helpers/mock-dom');

const hideShortsCode = fs.readFileSync(path.join(__dirname, '../content/hide-shorts.js'), 'utf8');
const hideEndcardsCode = fs.readFileSync(path.join(__dirname, '../content/hide-endcards.js'), 'utf8');
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

  test('hide-endcards hides top-right info card teaser and button when enabled and restores on disable', async () => {
    const player = new MockElement('div', { id: 'movie_player' });
    const teaser = new MockElement('div', { class: 'ytp-cards-teaser' });
    const cardBtn = new MockElement('button', { class: 'ytp-cards-button' });
    player.appendChild(teaser);
    player.appendChild(cardBtn);
    env.document.body.appendChild(player);
    env.elements.set('#movie_player', player);

    env.chrome.storage.sync._data = { hideEndCards: true };
    new Function(hideEndcardsCode)();
    await new Promise(resolve => setTimeout(resolve, 20));

    assert.strictEqual(env.document.documentElement.getAttribute('cineglow-hide-endcards'), 'true');
    assert.strictEqual(teaser.style.display, 'none');
    assert.strictEqual(cardBtn.style.display, 'none');

    for (const listener of env.chrome.storage.onChanged._listeners) {
      listener({ hideEndCards: { newValue: false } }, 'sync');
    }

    assert.strictEqual(env.document.documentElement.getAttribute('cineglow-hide-endcards'), null);
    assert.strictEqual(teaser.style.display, '');
    assert.strictEqual(cardBtn.style.display, '');

    globalThis.window.CineGlowEndCardsTeardown?.();
  });

  test('hide-shorts DOM fallback hides Home shelf without [is-shorts] and Shorts sidebar entry, restores on disable, and spares @shorts handles', async () => {
    const guideShorts = new MockElement('ytd-guide-entry-renderer');
    const guideText = new MockElement('yt-formatted-string', { class: 'title' });
    guideText.textContent = 'Shorts';
    guideShorts.appendChild(guideText);

    const shelfSection = new MockElement('ytd-rich-section-renderer');
    const richShelf = new MockElement('ytd-rich-shelf-renderer');
    const shelfTitle = new MockElement('span', { id: 'title' });
    shelfTitle.textContent = 'Shorts';
    const shortCard = new MockElement('ytm-shorts-lockup-view-model');
    richShelf.appendChild(shelfTitle);
    richShelf.appendChild(shortCard);
    shelfSection.appendChild(richShelf);

    const creatorVideo = new MockElement('ytd-rich-item-renderer');
    const creatorLink = new MockElement('a', { href: 'https://www.youtube.com/@shortsCreator' });
    creatorVideo.appendChild(creatorLink);

    env.document.body.appendChild(guideShorts);
    env.document.body.appendChild(shelfSection);
    env.document.body.appendChild(creatorVideo);

    env.chrome.storage.sync._data = { hideShorts: true };
    new Function(hideShortsCode)();
    await new Promise(resolve => setTimeout(resolve, 15));

    assert.strictEqual(env.document.documentElement.getAttribute('cineglow-hide-shorts'), 'true');
    assert.strictEqual(guideShorts.getAttribute('data-cineglow-shorts-hidden'), 'true');
    assert.strictEqual(shelfSection.getAttribute('data-cineglow-shorts-hidden'), 'true');
    assert.strictEqual(creatorVideo.hasAttribute('data-cineglow-shorts-hidden'), false);

    for (const listener of env.chrome.storage.onChanged._listeners) {
      listener({ hideShorts: { newValue: false } }, 'sync');
    }

    assert.strictEqual(env.document.documentElement.getAttribute('cineglow-hide-shorts'), null);
    assert.strictEqual(guideShorts.hasAttribute('data-cineglow-shorts-hidden'), false);
    assert.strictEqual(shelfSection.hasAttribute('data-cineglow-shorts-hidden'), false);
  });

  test('hide-shorts un-hides recycled items converted to regular videos and spares query-string /shorts/ links', () => {
    env.chrome.storage.sync._data = { hideShorts: true };

    const recycledItem = new MockElement('ytd-rich-item-renderer');
    const shortLink = new MockElement('a', { href: '/shorts/shortABC12' });
    recycledItem.appendChild(shortLink);
    env.document.body.appendChild(recycledItem);

    new Function(hideShortsCode)();
    assert.strictEqual(recycledItem.getAttribute('data-cineglow-shorts-hidden'), 'true');

    // Polymer recycles the card into a normal watch video
    shortLink.setAttribute('href', '/watch?v=normalVid99');
    env.window.dispatchEvent(new Event('popstate'));
    assert.strictEqual(recycledItem.hasAttribute('data-cineglow-shorts-hidden'), false, 'Recycled card must un-hide');

    // Click on watch link whose query string mentions /shorts/ must NOT be intercepted
    const watchWithQuery = new MockElement('a', { href: 'https://www.youtube.com/watch?v=normalVid99&next=/shorts/shortABC12' });
    watchWithQuery.hostname = 'www.youtube.com';
    env.document.body.appendChild(watchWithQuery);
    const clickEvt = new Event('click', { bubbles: true, cancelable: true });
    Object.defineProperty(clickEvt, 'target', { value: watchWithQuery });
    env.document.dispatchEvent(clickEvt);
    assert.strictEqual(clickEvt.defaultPrevented, false);
  });

  test('content.css contains no nested :has() inside :has() or :is() and isolates Shorts JS fallback rule', () => {
    const css = fs.readFileSync(path.join(__dirname, '../content/content.css'), 'utf8');
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');

    function findNestedPseudoHas(source) {
      const violations = [];
      for (const kw of [':has(', ':is(']) {
        let idx = 0;
        while ((idx = source.indexOf(kw, idx)) !== -1) {
          let depth = 1;
          let j = idx + kw.length;
          while (j < source.length && depth > 0) {
            if (source[j] === '(') depth++;
            else if (source[j] === ')') depth--;
            j++;
          }
          const inner = source.slice(idx + kw.length, j - 1);
          if (inner.includes(':has(')) {
            violations.push(`${kw}${inner})`);
          }
          idx = idx + kw.length;
        }
      }
      return violations;
    }

    const nestedViolations = findNestedPseudoHas(stripped);
    assert.deepStrictEqual(nestedViolations, [], 'Chromium drops CSS rules with :has() nested inside :has() or :is()');
    assert.ok(
      /html\[cineglow-hide-shorts="true"\]\s+\[data-cineglow-shorts-hidden="true"\]\s*\{/.test(stripped),
      'data-cineglow-shorts-hidden rule must remain standalone so compound selectors never invalidate it'
    );
  });
});

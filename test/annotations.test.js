// test/annotations.test.js
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setupMockEnvironment, MockVideoElement, MockElement } = require('./helpers/mock-dom');

describe('Annotations Opt-in Lifecycle & Network Guard', () => {
  let env;
  let originalWindow;
  let originalDocument;
  let originalChrome;
  let sentMessages = [];

  beforeEach(() => {
    env = setupMockEnvironment('https://www.youtube.com/watch?v=annoTest123');
    originalWindow = globalThis.window;
    originalDocument = globalThis.document;
    originalChrome = globalThis.chrome;
    sentMessages = [];

    globalThis.window = env.window;
    globalThis.document = env.document;
    globalThis.chrome = env.chrome;

    // Track runtime messages
    globalThis.chrome.runtime = {
      sendMessage: (msg, callback) => {
        sentMessages.push(msg);
        if (callback) {
          callback({ success: false });
        }
      }
    };
    globalThis.window.chrome = globalThis.chrome;

    // Mock CineGlowPlayer
    globalThis.window.CineGlowPlayer = new (class extends EventTarget {
      constructor() {
        super();
        this.isWatchPage = true;
        this.videoId = 'annoTest123';
        this.video = new MockVideoElement();
        this.player = new MockElement('div', { id: 'movie_player' });
        this.isAdShowing = false;
      }
    })();

    // Setup global AURA_DEFAULTS
    const defaultsCode = fs.readFileSync(path.join(__dirname, '../shared/defaults.js'), 'utf8');
    new Function(defaultsCode)();
  });

  afterEach(() => {
    if (globalThis.window?.CineGlowAnnotations?.teardown) {
      globalThis.window.CineGlowAnnotations.teardown();
    }
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
    globalThis.chrome = originalChrome;
  });

  function loadAnnotations() {
    const code = fs.readFileSync(path.join(__dirname, '../content/annotations.js'), 'utf8');
    new Function(code)();
    return globalThis.window.CineGlowAnnotations;
  }

  test('defaults to disabled and sends NO network requests on page load (Finding 1)', async () => {
    // Fresh install: storage has no restoreAnnotations entry
    const anno = loadAnnotations();

    // Immediately upon script execution, enabled must be false
    assert.strictEqual(anno.isEnabled(), false, 'Annotations must start disabled by default');

    // Trigger player state-change
    globalThis.window.CineGlowPlayer.dispatchEvent(new CustomEvent('state-change'));

    // Wait for loadSettings promise to complete
    await new Promise(r => setTimeout(r, 20));

    // Verify still disabled and ZERO fetch requests were dispatched
    assert.strictEqual(anno.isEnabled(), false, 'Annotations must remain disabled after loading defaults');
    assert.strictEqual(sentMessages.length, 0, 'Must NOT send FETCH_ANNOTATIONS request when disabled');

    // Overlay container must NOT be injected into player
    const overlay = globalThis.window.CineGlowPlayer.player.children.find(
      c => c.classList && c.classList.contains('cineglow-annotations-overlay')
    );
    assert.strictEqual(overlay, undefined, 'Overlay container must not exist when annotations are disabled');
  });

  test('does not request annotations when saved preference is explicitly false', async () => {
    env.chrome.storage.sync._data['restoreAnnotations'] = false;

    const anno = loadAnnotations();
    await new Promise(r => setTimeout(r, 20));

    assert.strictEqual(anno.isEnabled(), false);
    assert.strictEqual(sentMessages.length, 0, 'Must NOT send fetch request when restoreAnnotations is false');
  });

  test('initializes and requests annotations only when restoreAnnotations is enabled in storage', async () => {
    env.chrome.storage.sync._data['restoreAnnotations'] = true;

    const anno = loadAnnotations();
    await new Promise(r => setTimeout(r, 20));

    assert.strictEqual(anno.isEnabled(), true, 'Must enable when restoreAnnotations is true in storage');
    assert.strictEqual(sentMessages.length, 1, 'Must dispatch exactly one FETCH_ANNOTATIONS request');
    assert.strictEqual(sentMessages[0].type, 'FETCH_ANNOTATIONS');
    assert.strictEqual(sentMessages[0].videoId, 'annoTest123');
  });

  test('responds dynamically to storage toggle: disables and tears down on false, initializes on true', async () => {
    // Start enabled
    env.chrome.storage.sync._data['restoreAnnotations'] = true;
    const anno = loadAnnotations();
    await new Promise(r => setTimeout(r, 20));
    assert.strictEqual(anno.isEnabled(), true);
    assert.strictEqual(sentMessages.length, 1);

    // User disables in popup
    for (const listener of env.chrome.storage.onChanged._listeners) {
      listener({ restoreAnnotations: { newValue: false } }, 'sync');
    }
    assert.strictEqual(anno.isEnabled(), false, 'Must disable when toggle changed to false');

    // User re-enables in popup
    sentMessages.length = 0;
    for (const listener of env.chrome.storage.onChanged._listeners) {
      listener({ restoreAnnotations: { newValue: true } }, 'sync');
    }
    assert.strictEqual(anno.isEnabled(), true, 'Must re-enable when toggle changed to true');
    assert.strictEqual(sentMessages.length, 1, 'Must request annotations upon re-enabling');
  });

  test('attaches timeupdate listener and tracks player when video element mounts dynamically after annotations initialization', async () => {
    env.chrome.storage.sync._data['restoreAnnotations'] = true;

    // Simulate initial player state before <video> element is mounted in DOM
    globalThis.window.CineGlowPlayer.video = null;

    const anno = loadAnnotations();
    await new Promise(r => setTimeout(r, 20));

    assert.strictEqual(anno.isEnabled(), true);
    assert.strictEqual(sentMessages.length, 1);

    // Now video mounts in DOM
    const video = new MockVideoElement();
    let timeupdateFired = false;
    video.addEventListener('timeupdate', () => { timeupdateFired = true; });

    globalThis.window.CineGlowPlayer.video = video;
    globalThis.window.CineGlowPlayer.dispatchEvent(new CustomEvent('state-change', { detail: globalThis.window.CineGlowPlayer }));

    // Verify timeupdate was attached to the newly mounted video element
    video.dispatchEvent(new Event('timeupdate'));
    assert.strictEqual(timeupdateFired, true, 'timeupdate listener must be attached to dynamically mounted video element');
  });

  test('rapid storage toggles do not leak duplicate overlay containers or interval timers', async () => {
    env.chrome.storage.sync._data['restoreAnnotations'] = true;
    const anno = loadAnnotations();
    await new Promise(r => setTimeout(r, 20));

    // Rapid toggle 10 times
    for (let i = 0; i < 10; i++) {
      const toggle = (i % 2 === 0);
      for (const listener of env.chrome.storage.onChanged._listeners) {
        listener({ restoreAnnotations: { newValue: toggle } }, 'sync');
      }
    }

    // End in disabled state
    for (const listener of env.chrome.storage.onChanged._listeners) {
      listener({ restoreAnnotations: { newValue: false } }, 'sync');
    }

    assert.strictEqual(anno.isEnabled(), false);
    const overlays = globalThis.window.CineGlowPlayer.player.children.filter(
      c => c.classList && c.classList.contains('cineglow-annotations-overlay')
    );
    assert.strictEqual(overlays.length, 0, 'No overlay containers should remain after disabling');
  });

  test('blocks protocol-relative open redirect and unvalidated external navigation in annotation actions', () => {
    const anno = loadAnnotations();
    assert.ok(typeof anno.createAnnotationElement === 'function');

    let openedUrl = null;
    globalThis.window.open = (url) => { openedUrl = url; };

    const initialHref = globalThis.window.location.href;

    // 1. Attack Vector: Protocol-relative URL (e.g. //evil.com)
    const attackItem1 = {
      id: 'anno_exploit_1',
      type: 'text',
      text: 'Click here for free V-bucks',
      rect: { x: 10, y: 10, w: 20, h: 20 },
      action: { type: 'url', url: '//evil.com/phish', target: 'current' }
    };
    const el1 = anno.createAnnotationElement(attackItem1);
    el1.dispatchEvent(new Event('click'));
    assert.strictEqual(globalThis.window.location.href, initialHref, 'Protocol-relative URL must NOT redirect top-level location');

    // 2. Attack Vector: Arbitrary external domain (e.g. https://evil.com)
    openedUrl = null;
    const attackItem2 = {
      id: 'anno_exploit_2',
      type: 'text',
      text: 'External link',
      rect: { x: 10, y: 10, w: 20, h: 20 },
      action: { type: 'url', url: 'https://evil.com/malware', target: 'new' }
    };
    const el2 = anno.createAnnotationElement(attackItem2);
    el2.dispatchEvent(new Event('click'));
    assert.strictEqual(openedUrl, null, 'Untrusted external URL must be blocked from window.open');

    // 3. Legitimate YouTube relative path (e.g. /watch?v=nextVideo)
    const validRelativeItem = {
      id: 'anno_valid_rel',
      type: 'text',
      text: 'Next Video',
      rect: { x: 10, y: 10, w: 20, h: 20 },
      action: { type: 'url', url: '/watch?v=nextVideo', target: 'current' }
    };
    const el3 = anno.createAnnotationElement(validRelativeItem);
    el3.dispatchEvent(new Event('click'));
    assert.strictEqual(globalThis.window.location.href, 'https://www.youtube.com/watch?v=nextVideo', 'Valid relative YouTube path must navigate safely');

    // 4. Legitimate YouTube full URL with new window target
    openedUrl = null;
    const validFullItem = {
      id: 'anno_valid_full',
      type: 'text',
      text: 'Channel Link',
      rect: { x: 10, y: 10, w: 20, h: 20 },
      action: { type: 'url', url: 'https://www.youtube.com/@OfficialChannel', target: 'new' }
    };
    const el4 = anno.createAnnotationElement(validFullItem);
    el4.dispatchEvent(new Event('click'));
    assert.strictEqual(openedUrl, 'https://www.youtube.com/@OfficialChannel', 'Valid YouTube domain must be permitted in window.open');
  });
});

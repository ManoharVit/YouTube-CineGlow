// test/blackbar.test.js
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setupMockEnvironment, MockVideoElement } = require('./helpers/mock-dom');

describe('Aura Black Bar Detection & Auto-Crop (FP-5.1, FP-5.2, FP-5.3)', () => {
  let env;
  let originalWindow;
  let originalDocument;
  let originalChrome;
  let originalSetInterval;
  let originalClearInterval;
  let originalDateNow;
  let video;
  let mockCtx;
  let framePixelBuffer;
  let drawImageCount = 0;
  let intervalCallbacks = [];
  let simulatedTime = 1000000;

  function setRowPixels(buffer, width, y, r, g, b, startX = 0, endX = width) {
    for (let x = startX; x < endX; x++) {
      const idx = (y * width + x) * 4;
      buffer[idx] = r;
      buffer[idx + 1] = g;
      buffer[idx + 2] = b;
      buffer[idx + 3] = 255;
    }
  }

  function fillLetterboxFrame(buffer, width, height, topBarHeight, bottomBarHeight) {
    buffer.fill(0);
    for (let y = topBarHeight; y < height - bottomBarHeight; y++) {
      setRowPixels(buffer, width, y, 200, 200, 200, 0, width);
    }
  }

  function tick() {
    for (const item of intervalCallbacks) {
      item.cb();
    }
  }

  beforeEach(() => {
    env = setupMockEnvironment('https://www.youtube.com/watch?v=cinematicMovie');
    originalWindow = globalThis.window;
    originalDocument = globalThis.document;
    originalChrome = globalThis.chrome;
    originalSetInterval = globalThis.setInterval;
    originalClearInterval = globalThis.clearInterval;
    originalDateNow = Date.now;

    intervalCallbacks = [];
    simulatedTime = 1000000;
    Date.now = () => simulatedTime;

    globalThis.setInterval = (cb, ms) => {
      const id = intervalCallbacks.length + 1;
      intervalCallbacks.push({ id, cb, ms });
      return id;
    };
    globalThis.clearInterval = (id) => {
      intervalCallbacks = intervalCallbacks.filter(item => item.id !== id);
    };

    globalThis.window = env.window;
    globalThis.document = env.document;
    globalThis.chrome = env.chrome;
    globalThis.window.chrome = env.chrome;

    video = new MockVideoElement();
    video.readyState = 4;
    video.paused = false;

    // 64x64 RGBA buffer
    framePixelBuffer = new Uint8ClampedArray(64 * 64 * 4);
    drawImageCount = 0;

    mockCtx = {
      drawImage: () => {
        drawImageCount++;
      },
      getImageData: (_x, _y, w, h) => ({
        data: framePixelBuffer,
        width: w,
        height: h
      })
    };

    const origCreateElement = env.document.createElement.bind(env.document);
    env.document.createElement = (tag) => {
      const el = origCreateElement(tag);
      if (tag === 'canvas') {
        el.getContext = () => mockCtx;
      }
      return el;
    };

    globalThis.window.CineGlowPlayer = new (class extends EventTarget {
      constructor() {
        super();
        this.isWatchPage = true;
        this.videoId = 'cinematicMovie';
        this.video = video;
      }
    })();

    const defaultsCode = fs.readFileSync(path.join(__dirname, '../shared/defaults.js'), 'utf8');
    const fnDef = new Function(`'use strict'; ${defaultsCode}; return AURA_DEFAULTS;`);
    globalThis.AURA_DEFAULTS = fnDef();
    globalThis.window.AURA_DEFAULTS = globalThis.AURA_DEFAULTS;
  });

  afterEach(() => {
    if (globalThis.window?.CineGlowCropTeardown) {
      globalThis.window.CineGlowCropTeardown();
    }
    delete globalThis.AURA_DEFAULTS;
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
    globalThis.chrome = originalChrome;
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
    Date.now = originalDateNow;
  });

  function loadBlackBarScript() {
    const code = fs.readFileSync(path.join(__dirname, '../content/blackbar.js'), 'utf8');
    const fn = new Function(code);
    fn();
  }

  describe('FP-5.1: Row Sampling & Stability Threshold', () => {
    test('widened 90% row sampling detects edge cinematic content and prevents false-positive letterbox detection', () => {
      // Create a 64x64 frame where rows 0-7 have black in center (16-48)
      // but rows 6 and 7 have stars/lights at x=6 (0.09*width) and x=58 (0.90*width),
      // well outside the center 50% (x=16..48)
      framePixelBuffer.fill(0);
      for (let y = 8; y < 56; y++) {
        setRowPixels(framePixelBuffer, 64, y, 220, 220, 220, 0, 64);
      }
      // Add stars/lights in row 6 outside the center 50%
      setRowPixels(framePixelBuffer, 64, 6, 255, 255, 255, 5, 10);
      setRowPixels(framePixelBuffer, 64, 57, 255, 255, 255, 55, 60);

      loadBlackBarScript();

      // Run 8 ticks
      for (let i = 0; i < 8; i++) {
        tick();
      }

      // With 90% sampling, rows 6 and 57 are recognized as containing active content.
      // Top bar is detected as 6 rows rather than 8 rows.
      // 6 rows on 64px = 6/64 = 0.09375 + 0.006 = 0.09975
      // Verify crop reflects content detection at row 6
      assert.ok(globalThis.window.CineGlowCrop, 'Crop should be applied');
      assert.ok(globalThis.window.CineGlowCrop.top < 0.12, `Top crop must account for star at row 6, got ${globalThis.window.CineGlowCrop.top}`);
    });

    test('STABLE_THRESHOLD requires 8 stable frames before applying crop (does not crop at 7)', () => {
      // 8 rows top, 8 rows bottom letterbox = 12.5% bars
      fillLetterboxFrame(framePixelBuffer, 64, 64, 8, 8);

      loadBlackBarScript();

      // Trigger state change to start scanning and attach video
      globalThis.window.CineGlowPlayer.dispatchEvent(new CustomEvent('state-change', {
        detail: { isWatchPage: true, video }
      }));

      // Simulate 7 ticks
      for (let i = 0; i < 7; i++) {
        tick();
        assert.strictEqual(video.style.clipPath || '', '', `Must not crop on frame ${i + 1}`);
        assert.strictEqual(video.style.transform || '', '', `Must not transform on frame ${i + 1}`);
      }

      // 8th tick reaches STABLE_THRESHOLD = 8
      tick();
      assert.ok(video.style.clipPath.includes('inset'), 'Must apply clipPath on 8th frame');
      assert.strictEqual(video.style.transform || '', '', 'Cropping must preserve video size');
    });
  });

  describe('Cropping preserves player framing', () => {
    test('clips detected bars without replacing the player transform or transition', () => {
      video.style.transform = 'translateX(3px)';
      video.style.transformOrigin = 'left top';
      video.style.transition = 'opacity 0.2s';
      fillLetterboxFrame(framePixelBuffer, 64, 64, 8, 8);
      loadBlackBarScript();
      for (let i = 0; i < 8; i++) tick();
      assert.ok(video.style.clipPath.includes('inset'));
      assert.strictEqual(video.style.transform, 'translateX(3px)');
      assert.strictEqual(video.style.transformOrigin, 'left top');
      assert.strictEqual(video.style.transition, 'opacity 0.2s');
    });

    test('clears its crop when bars disappear and preserves the player transform', () => {
      video.style.transform = 'translateX(3px)';
      fillLetterboxFrame(framePixelBuffer, 64, 64, 8, 8);
      loadBlackBarScript();
      for (let i = 0; i < 8; i++) tick();
      assert.ok(video.style.clipPath.includes('inset'));

      // Now video switches to full screen content (0 bars)
      fillLetterboxFrame(framePixelBuffer, 64, 64, 0, 0);

      // Run 8 ticks of full screen content (scale <= 1.01 triggers resetCrop)
      for (let i = 0; i < 8; i++) {
        tick();
      }

      assert.strictEqual(video.style.clipPath, '', 'clipPath must be restored to empty');
      assert.strictEqual(video.style.transform, 'translateX(3px)');
      assert.strictEqual(video.style.transformOrigin || '', '');
      assert.strictEqual(globalThis.window.CineGlowCrop, null, 'CineGlowCrop must be null');
    });
  });

  describe('FP-5.3: Secondary Monitor Non-Focused Scanning Cadence', () => {
    test('continues scanning at 2000ms cadence when unfocused but visible, and halts when document is hidden', () => {
      fillLetterboxFrame(framePixelBuffer, 64, 64, 8, 8);
      loadBlackBarScript();

      // Focused tab scans on every tick
      globalThis.document.hasFocus = () => true;
      globalThis.document.hidden = false;

      drawImageCount = 0;
      tick();
      assert.strictEqual(drawImageCount, 1, 'First focused tick scans');
      simulatedTime += 500;
      tick();
      assert.strictEqual(drawImageCount, 2, 'Second focused tick at 500ms scans');

      // Now simulate secondary monitor: window loses focus (!document.hasFocus()), but remains visible (!document.hidden)
      globalThis.document.hasFocus = () => false;
      globalThis.document.hidden = false;

      // Tick at t = 1000ms: unfocused scan executes because lastUnfocusedScan was 0
      simulatedTime += 500;
      tick();
      assert.strictEqual(drawImageCount, 3, 'First unfocused tick scans and records lastUnfocusedScan');

      // Tick at t = 1500ms (500ms elapsed < 2000ms cadence): should NOT scan
      simulatedTime += 500;
      tick();
      assert.strictEqual(drawImageCount, 3, 'Unfocused tick before 2000ms cadence does not scan');

      // Tick at t = 2000ms (1000ms elapsed < 2000ms): should NOT scan
      simulatedTime += 500;
      tick();
      assert.strictEqual(drawImageCount, 3, 'Unfocused tick before 2000ms cadence does not scan');

      // Tick at t = 2500ms (1500ms elapsed < 2000ms): should NOT scan
      simulatedTime += 500;
      tick();
      assert.strictEqual(drawImageCount, 3, 'Unfocused tick before 2000ms cadence does not scan');

      // Tick at t = 3000ms (2000ms elapsed >= 2000ms cadence): should scan!
      simulatedTime += 500;
      tick();
      assert.strictEqual(drawImageCount, 4, 'Unfocused tick after 2000ms cadence scans');

      // Now simulate tab hidden (minimized or background tab): document.hidden = true
      globalThis.document.hidden = true;
      simulatedTime += 5000; // even after 5 seconds
      tick();
      assert.strictEqual(drawImageCount, 4, 'Hidden document must not scan even after 5000ms');
    });
  });

  describe('Asymmetric Corner Overlay & Guardrails', () => {
    test('crops symmetrical 21:9 letterbox bars when promo text watermark sits in top-left black bar', () => {
      // 8 rows top, 8 rows bottom (12.5% letterbox) + white promo text in rows 1..5 at x=4..16 (~19% width)
      fillLetterboxFrame(framePixelBuffer, 64, 64, 8, 8);
      for (let y = 1; y <= 5; y++) {
        setRowPixels(framePixelBuffer, 64, y, 255, 255, 255, 4, 16);
      }

      loadBlackBarScript();
      for (let i = 0; i < 8; i++) tick();

      assert.ok(globalThis.window.CineGlowCrop, 'Symmetric crop should ignore localized top-left promo overlay');
      assert.ok(Math.abs(globalThis.window.CineGlowCrop.top - 0.131) < 0.01);
      assert.ok(Math.abs(globalThis.window.CineGlowCrop.bottom - 0.131) < 0.01);
      assert.ok(video.style.clipPath.includes('inset'), 'Video clipPath must remove letterbox bars');
    });

    test('crops symmetrical letterbox bars when subtitle text sits inside bottom black bar', () => {
      fillLetterboxFrame(framePixelBuffer, 64, 64, 8, 8);
      for (let y = 58; y <= 61; y++) {
        setRowPixels(framePixelBuffer, 64, y, 240, 240, 240, 22, 42);
      }

      loadBlackBarScript();
      for (let i = 0; i < 8; i++) tick();

      assert.ok(globalThis.window.CineGlowCrop, 'Symmetric crop should tolerate subtitle inside bottom letterbox');
      assert.ok(Math.abs(globalThis.window.CineGlowCrop.bottom - 0.131) < 0.01);
    });

    test('does NOT falsely crop 16:9 frame that has bright active content on top and dark floor on bottom', () => {
      // Full-width bright scene on rows 0..55, dark shadow on bottom rows 56..63
      fillLetterboxFrame(framePixelBuffer, 64, 64, 0, 8);

      loadBlackBarScript();
      for (let i = 0; i < 8; i++) tick();

      assert.strictEqual(globalThis.window.CineGlowCrop, null, 'Must never crop active bright top picture');
      assert.strictEqual(video.style.clipPath || '', '');
    });
  });
});

// test/recording-and-media.test.js
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setupMockEnvironment, MockVideoElement } = require('./helpers/mock-dom');

describe('Media Recording & Codec Selection Pipeline', () => {
  let env;
  let originalWindow;
  let originalDocument;
  let originalChrome;
  let originalMediaRecorder;

  beforeEach(() => {
    env = setupMockEnvironment('https://www.youtube.com/watch?v=recTest123');
    originalWindow = globalThis.window;
    originalDocument = globalThis.document;
    originalChrome = globalThis.chrome;
    originalMediaRecorder = globalThis.MediaRecorder;

    globalThis.window = env.window;
    globalThis.document = env.document;
    globalThis.chrome = env.chrome;
    if (!globalThis.requestAnimationFrame) {
      globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 16);
    }
    if (!globalThis.cancelAnimationFrame) {
      globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
    }

    // Set up mock MediaRecorder constructor
    globalThis.MediaRecorder = class MockMediaRecorder extends EventTarget {
      constructor(stream, options = {}) {
        super();
        this.stream = stream;
        this.mimeType = options.mimeType || 'video/webm';
        this.state = 'inactive';
        this.ondataavailable = null;
        this.onstop = null;
      }
      start(_timeslice) {
        this.state = 'recording';
      }
      stop() {
        this.state = 'inactive';
        if (this.onstop) this.onstop();
      }
      static isTypeSupported(_type) {
        return false;
      }
    };
    globalThis.window.MediaRecorder = globalThis.MediaRecorder;
  });

  afterEach(() => {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
    globalThis.chrome = originalChrome;
    globalThis.MediaRecorder = originalMediaRecorder;
  });

  function loadRecorder() {
    const code = fs.readFileSync(path.join(__dirname, '../content/record-button.js'), 'utf8');
    const fn = new Function(code);
    fn();
    return globalThis.window.CineGlowRecorder;
  }

  test('FORMAT_CONFIGS defines valid configurations for mp4, mkv, and webm', () => {
    const recorder = loadRecorder();
    const configs = recorder.FORMAT_CONFIGS;

    assert.ok(configs.mp4, 'mp4 configuration must exist');
    assert.strictEqual(configs.mp4.ext, 'mp4');
    assert.strictEqual(configs.mp4.badge, 'MP4');

    assert.ok(configs.mkv, 'mkv configuration must exist');
    assert.strictEqual(configs.mkv.ext, 'mkv');
    assert.strictEqual(configs.mkv.badge, 'MKV');

    assert.ok(configs.webm, 'webm configuration must exist');
    assert.strictEqual(configs.webm.ext, 'webm');
    assert.strictEqual(configs.webm.badge, 'WEBM');
  });

  test('selects preferred AVC1 + AAC MIME type when mp4 is requested and supported', () => {
    const supported = new Set(['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4']);
    globalThis.MediaRecorder.isTypeSupported = (t) => supported.has(t);

    const recorder = loadRecorder();
    const selected = recorder.selectMimeType('mp4');
    assert.strictEqual(selected, 'video/mp4;codecs=avc1,mp4a.40.2');
  });

  test('falls back gracefully to webm when browser does not support mp4 recording', () => {
    const supported = new Set(['video/webm;codecs=vp9,opus', 'video/webm']);
    globalThis.MediaRecorder.isTypeSupported = (t) => supported.has(t);

    const recorder = loadRecorder();
    const selected = recorder.selectMimeType('mp4');
    assert.strictEqual(selected, 'video/webm;codecs=vp9,opus');
  });

  test('selects Matroska AVC1 or VP9/Opus for MKV recordings', () => {
    const supported = new Set(['video/x-matroska;codecs=avc1', 'video/webm;codecs=vp9,opus']);
    globalThis.MediaRecorder.isTypeSupported = (t) => supported.has(t);

    const recorder = loadRecorder();
    const selected = recorder.selectMimeType('mkv');
    assert.strictEqual(selected, 'video/x-matroska;codecs=avc1');
  });

  test('defaults to plain video/webm when no specialized codecs are supported', () => {
    globalThis.MediaRecorder.isTypeSupported = () => false;

    const recorder = loadRecorder();
    const selected = recorder.selectMimeType('webm');
    assert.strictEqual(selected, 'video/webm');
  });

  test('deriveContainerExtension derives extension from container type and requested format', () => {
    const recorder = loadRecorder();

    // Actual MP4 mime overrides whatever was requested
    assert.strictEqual(recorder.deriveContainerExtension('video/mp4;codecs=avc1,mp4a.40.2', 'mp4'), 'mp4');
    assert.strictEqual(recorder.deriveContainerExtension('video/mp4', 'webm'), 'mp4');

    // Matroska container
    assert.strictEqual(recorder.deriveContainerExtension('video/x-matroska;codecs=avc1', 'mkv'), 'mkv');

    // MKV requested with WebM fallback (EBML DocType rewrite)
    assert.strictEqual(recorder.deriveContainerExtension('video/webm;codecs=vp9,opus', 'mkv'), 'mkv');

    // WebM requested
    assert.strictEqual(recorder.deriveContainerExtension('video/webm;codecs=vp9,opus', 'webm'), 'webm');

    // MP4 requested but fell back to WebM
    assert.strictEqual(recorder.deriveContainerExtension('video/webm;codecs=vp9,opus', 'mp4'), 'webm');
  });

  test('generates clean recording download filenames using production sanitizer', () => {
    const recorder = loadRecorder();
    const rawTitle = 'Lo-Fi Chill Beats / 24/7 Stream | Relax & Study! - YouTube';
    const cleanTitle = recorder.sanitizeRecordingTitle(rawTitle);
    const durationSec = 45;
    const ext = 'mkv';

    assert.strictEqual(cleanTitle, 'Lo-Fi Chill Beats  247 Stream  Relax & Study!');
    assert.ok(!cleanTitle.includes('/'), 'Title must not contain illegal slashes');
    assert.ok(!cleanTitle.includes('|'), 'Title must not contain pipe symbols');
    assert.ok(!cleanTitle.endsWith('- YouTube'), 'Title must strip - YouTube suffix');

    const filename = recorder.getRecordingFilename(rawTitle, durationSec, ext);
    assert.strictEqual(filename, 'Recording_Lo-Fi Chill Beats  247 Stream  Relax & Study!_45s.mkv');

    // Title consisting only of stripped or illegal characters falls back to 'YouTube'
    assert.strictEqual(recorder.sanitizeRecordingTitle(' - YouTube'), 'YouTube');
    assert.strictEqual(recorder.sanitizeRecordingTitle('///:::***???'), 'YouTube');
    assert.strictEqual(recorder.sanitizeRecordingTitle(''), 'YouTube');
    assert.strictEqual(recorder.getRecordingFilename(' - YouTube', 10, 'mp4'), 'Recording_YouTube_10s.mp4');
  });

  test('MediaRecorder constructor fallback to default options updates activeRecordedMimeType and derives correct webm extension', () => {
    const recorder = loadRecorder();

    // Mock MediaRecorder constructor throwing on specialized MIME options
    const originalMR = globalThis.MediaRecorder;
    class ThrowingMediaRecorder extends EventTarget {
      constructor(stream, options) {
        super();
        if (options && options.mimeType) {
          throw new Error('NotSupportedError: MIME type not supported');
        }
        this.stream = stream;
        this.mimeType = 'video/webm;codecs=vp8,opus';
        this.state = 'recording';
      }
      start() {}
      stop() {}
      static isTypeSupported() { return true; }
    }
    globalThis.MediaRecorder = ThrowingMediaRecorder;
    globalThis.window.MediaRecorder = ThrowingMediaRecorder;

    try {
      const mockVideo = new MockVideoElement();
      mockVideo.videoWidth = 1280;
      mockVideo.videoHeight = 720;

      recorder.setCurrentFormat('mp4');
      recorder.startRecording(mockVideo);

      // Verify activeRecordedMimeType was updated from mediaRecorder.mimeType fallback
      assert.strictEqual(recorder.getActiveRecordedMimeType(), 'video/webm;codecs=vp8,opus');

      // Verify deriveContainerExtension derives 'webm', NOT 'mp4'
      const ext = recorder.deriveContainerExtension(recorder.getActiveRecordedMimeType(), recorder.getActiveRecordingFormat());
      assert.strictEqual(ext, 'webm', 'Must derive webm extension when constructor fell back to default WebM');
    } finally {
      recorder.stopRecording();
      globalThis.MediaRecorder = originalMR;
      globalThis.window.MediaRecorder = originalMR;
    }
  });

  test('recording finalization preserves actual container and extension even when user preference changes mid-recording (remedy for Finding 6)', async () => {
    const recorder = loadRecorder();
    globalThis.document.title = 'Epic Video - YouTube';

    // Track downloaded files
    const downloadedFiles = [];
    const origAppendChild = globalThis.document.body.appendChild.bind(globalThis.document.body);
    globalThis.document.body.appendChild = (child) => {
      origAppendChild(child);
      if (child.tagName === 'A' && child.download) {
        downloadedFiles.push({
          download: child.download,
          href: child.href
        });
      }
      return child;
    };

    // 1. Simulate starting an MP4 recording
    recorder.setActiveRecordingFormat('mp4');
    recorder.setActiveRecordedMimeType('video/mp4;codecs=avc1,mp4a.40.2');
    recorder.setRecordingStartTime(Date.now() - 5000); // 5s ago
    recorder.setRecordedChunks([new Blob(['mock-mp4-data'], { type: 'video/mp4' })]);

    // 2. Mid-recording, user switches preference to 'webm' via popup
    recorder.setCurrentFormat('webm');

    // 3. Finalize recording
    await recorder.finalizeRecording();

    assert.strictEqual(downloadedFiles.length, 1, 'Should trigger download link');
    const dl = downloadedFiles[0];
    assert.ok(dl.download.endsWith('.mp4'), `Download filename must end in .mp4, got: ${dl.download}`);
    assert.strictEqual(dl.download, 'Recording_Epic Video_5s.mp4');

    // 4. Test MKV recording whose preference is switched to 'mp4' mid-recording
    downloadedFiles.length = 0;
    recorder.setActiveRecordingFormat('mkv');
    recorder.setActiveRecordedMimeType('video/webm;codecs=vp9,opus');
    recorder.setRecordingStartTime(Date.now() - 10000); // 10s ago
    recorder.setRecordedChunks([new Blob(['mock-webm-chunks'], { type: 'video/webm' })]);

    recorder.setCurrentFormat('mp4'); // changed mid-recording

    await recorder.finalizeRecording();

    assert.strictEqual(downloadedFiles.length, 1);
    const dlMkv = downloadedFiles[0];
    assert.ok(dlMkv.download.endsWith('.mkv'), `Download filename must end in .mkv, got: ${dlMkv.download}`);
    assert.strictEqual(dlMkv.download, 'Recording_Epic Video_10s.mkv');

    // Allow revokeObjectURL timeouts to settle cleanly
    await new Promise(r => setTimeout(r, 1050));
  });
});

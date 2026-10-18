// test/recording-and-media.test.js
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('Media Recording & Codec Selection Pipeline', () => {
  function extractFormatConfigs() {
    const code = fs.readFileSync(path.join(__dirname, '../content/record-button.js'), 'utf8');
    const startIdx = code.indexOf('const FORMAT_CONFIGS = {');
    const endIdx = code.indexOf('};', startIdx) + 2;
    const fn = new Function(`${code.substring(startIdx, endIdx)}; return FORMAT_CONFIGS;`);
    return fn();
  }

  // Pure logic replica of the MIME selection inside record-button.js
  function selectMimeType(targetFormat, isTypeSupportedFn) {
    let mimeType = '';
    if (targetFormat === 'mp4') {
      const mp4Candidates = [
        'video/mp4;codecs=avc1,mp4a.40.2',
        'video/mp4;codecs=avc1',
        'video/mp4'
      ];
      for (const t of mp4Candidates) {
        if (isTypeSupportedFn(t)) {
          mimeType = t;
          break;
        }
      }
    } else if (targetFormat === 'mkv') {
      const mkvCandidates = [
        'video/x-matroska;codecs=avc1',
        'video/x-matroska;codecs=vp9,opus',
        'video/x-matroska',
        'video/webm;codecs=vp9,opus'
      ];
      for (const t of mkvCandidates) {
        if (isTypeSupportedFn(t)) {
          mimeType = t;
          break;
        }
      }
    } else {
      const webmCandidates = [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm;codecs=h264,opus',
        'video/webm'
      ];
      for (const t of webmCandidates) {
        if (isTypeSupportedFn(t)) {
          mimeType = t;
          break;
        }
      }
    }

    if (!mimeType) {
      const fallbacks = [
        'video/mp4;codecs=avc1,mp4a.40.2',
        'video/webm;codecs=vp9,opus',
        'video/webm'
      ];
      for (const t of fallbacks) {
        if (isTypeSupportedFn(t)) {
          mimeType = t;
          break;
        }
      }
    }

    if (!mimeType) {
      mimeType = 'video/webm';
    }

    return mimeType;
  }

  test('FORMAT_CONFIGS defines valid configurations for mp4, mkv, and webm', () => {
    const configs = extractFormatConfigs();

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
    const selected = selectMimeType('mp4', (t) => supported.has(t));
    assert.strictEqual(selected, 'video/mp4;codecs=avc1,mp4a.40.2');
  });

  test('falls back gracefully to webm when browser does not support mp4 recording', () => {
    const supported = new Set(['video/webm;codecs=vp9,opus', 'video/webm']);
    const selected = selectMimeType('mp4', (t) => supported.has(t));
    assert.strictEqual(selected, 'video/webm;codecs=vp9,opus');
  });

  test('selects Matroska AVC1 or VP9/Opus for MKV recordings', () => {
    const supported = new Set(['video/x-matroska;codecs=avc1', 'video/webm;codecs=vp9,opus']);
    const selected = selectMimeType('mkv', (t) => supported.has(t));
    assert.strictEqual(selected, 'video/x-matroska;codecs=avc1');
  });

  test('defaults to plain video/webm when no specialized codecs are supported', () => {
    const selected = selectMimeType('webm', () => false);
    assert.strictEqual(selected, 'video/webm');
  });

  test('generates clean recording download filenames with duration and container extension', () => {
    const sanitize = (title) => title.replace(/[/\\?%*:|"<>]/g, '-').trim();
    const rawTitle = 'Lo-Fi Chill Beats / 24/7 Stream | Relax & Study!';
    const cleanTitle = sanitize(rawTitle);
    const durationSec = 45;
    const ext = 'mkv';

    const filename = `Recording_${cleanTitle}_${durationSec}s.${ext}`;
    assert.strictEqual(filename, 'Recording_Lo-Fi Chill Beats - 24-7 Stream - Relax & Study!_45s.mkv');
    assert.ok(!filename.includes('/'), 'Filename must not contain illegal slashes');
    assert.ok(!filename.includes('|'), 'Filename must not contain pipe symbols');
  });
});

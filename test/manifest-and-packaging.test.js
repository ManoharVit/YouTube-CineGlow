const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(REPO_ROOT, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
const ZIP_PATH = path.join(REPO_ROOT, `YouTube-CineGlow-v${manifest.version}.zip`);

const APPROVED_PERMISSIONS = [
  'alarms',
  'declarativeNetRequest',
  'scripting',
  'storage'
];

const APPROVED_HOST_PERMISSIONS = [
  'https://*.youtube.com/*',
  'https://returnyoutubedislikeapi.com/*',
  'https://sponsor.ajay.app/*',
  'https://storage.googleapis.com/*'
];

function collectReferencedManifestFiles(m) {
  const files = new Set();
  if (m.background?.service_worker) files.add(m.background.service_worker);
  if (m.storage?.managed_schema) files.add(m.storage.managed_schema);
  if (m.action?.default_popup) files.add(m.action.default_popup);
  for (const iconPath of Object.values(m.action?.default_icon || {})) files.add(iconPath);
  for (const iconPath of Object.values(m.icons || {})) files.add(iconPath);
  for (const cs of m.content_scripts || []) {
    for (const js of cs.js || []) files.add(js);
    for (const css of cs.css || []) files.add(css);
  }
  for (const res of m.declarative_net_request?.rule_resources || []) {
    if (res.path) files.add(res.path);
  }
  for (const war of m.web_accessible_resources || []) {
    for (const r of war.resources || []) {
      if (!r.includes('*')) files.add(r);
    }
  }
  return Array.from(files);
}

function readPngDimensions(filePath) {
  const buf = fs.readFileSync(filePath);
  assert.ok(buf.length >= 24, `PNG too small: ${filePath}`);
  assert.strictEqual(buf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `Invalid PNG signature: ${filePath}`);
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20)
  };
}

function walkFiles(dir, exts) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(full, exts));
    } else if (exts.some((ext) => entry.name.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

describe('Manifest & Packaging QA Checks (MAN-01 through MAN-06)', () => {
  test('MAN-01: manifest.json is MV3, valid semver, and fits Chrome Web Store metadata limits', () => {
    assert.strictEqual(manifest.manifest_version, 3);
    assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
    assert.ok(manifest.name && manifest.name.length <= 75, 'name must fit Web Store 75-char limit');
    assert.ok(manifest.description && manifest.description.length <= 132, 'description must fit Web Store 132-char limit');
  });

  test('MAN-02: every file referenced in manifest.json exists on disk and in the release zip', () => {
    const referenced = collectReferencedManifestFiles(manifest);
    assert.ok(referenced.length > 0);
    for (const rel of referenced) {
      assert.ok(fs.existsSync(path.join(REPO_ROOT, rel)), `Missing referenced file on disk: ${rel}`);
    }
    assert.ok(fs.existsSync(ZIP_PATH), `Release zip missing: ${path.basename(ZIP_PATH)}`);
    const zipEntries = new Set(
      execFileSync('unzip', ['-Z1', ZIP_PATH], { encoding: 'utf8' })
        .split(/\r?\n/)
        .filter(Boolean)
    );
    for (const rel of referenced) {
      assert.ok(zipEntries.has(rel), `Missing referenced file inside release zip: ${rel}`);
    }
  });

  test('MAN-03: permissions and host_permissions strictly match approved allowlists', () => {
    assert.deepStrictEqual([...(manifest.permissions || [])].sort(), [...APPROVED_PERMISSIONS].sort());
    assert.deepStrictEqual([...(manifest.host_permissions || [])].sort(), [...APPROVED_HOST_PERMISSIONS].sort());
  });

  test('MAN-04: production scripts and HTML contain no dynamic code execution or remote scripts', () => {
    const dirs = ['background', 'content', 'popup', 'shared'];
    const dynamicEvalRe = new RegExp('\\beval\\s*\\(');
    const dynamicFnRe = new RegExp('\\bnew\\s+Func' + 'tion\\s*\\(');
    const remoteScriptRe = /<script[^>]+src\s*=\s*["']https?:\/\//i;

    for (const d of dirs) {
      for (const file of walkFiles(path.join(REPO_ROOT, d), ['.js', '.html'])) {
        const rel = path.relative(REPO_ROOT, file);
        const src = fs.readFileSync(file, 'utf8');
        if (file.endsWith('.js')) {
          assert.strictEqual(dynamicEvalRe.test(src), false, `Disallowed eval() in ${rel}`);
          assert.strictEqual(dynamicFnRe.test(src), false, `Disallowed dynamic Function constructor in ${rel}`);
        } else {
          assert.strictEqual(remoteScriptRe.test(src), false, `Remote script tag in ${rel}`);
        }
      }
    }
  });

  test('MAN-05: release zip excludes source maps, .env files, test fixtures, node_modules, and .DS_Store', () => {
    assert.ok(fs.existsSync(ZIP_PATH), `Release zip missing: ${path.basename(ZIP_PATH)}`);
    const zipEntries = execFileSync('unzip', ['-Z1', ZIP_PATH], { encoding: 'utf8' })
      .split(/\r?\n/)
      .filter(Boolean);

    const forbiddenPatterns = [
      /\.map$/i,
      /(^|\/)\.env(\.|$)/i,
      /\.DS_Store$/,
      /^test\//,
      /^node_modules\//,
      /^\.git\//,
      /^tools\//
    ];

    for (const entry of zipEntries) {
      for (const rx of forbiddenPatterns) {
        assert.strictEqual(rx.test(entry), false, `Forbidden entry in release zip: ${entry}`);
      }
    }
  });

  test('MAN-06: icons exist at 16, 32, 48, and 128 px with matching PNG dimensions', () => {
    for (const size of ['16', '32', '48', '128']) {
      const rel = manifest.icons?.[size];
      assert.ok(rel, `manifest.icons missing ${size}px entry`);
      const actionRel = manifest.action?.default_icon?.[size];
      assert.strictEqual(actionRel, rel, `manifest.action.default_icon[${size}] should match manifest.icons[${size}]`);
      const dims = readPngDimensions(path.join(REPO_ROOT, rel));
      assert.strictEqual(dims.width, Number(size), `${rel} width must be ${size}px`);
      assert.strictEqual(dims.height, Number(size), `${rel} height must be ${size}px`);
    }
  });
});

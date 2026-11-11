// test/enterprise-coexistence-and-vapt.test.js
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('Enterprise Co-existence & InfoSec VAPT Suite', () => {
  const rootDir = path.join(__dirname, '..');
  const manifestPath = path.join(rootDir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  test('Phase 2: Content script matches strictly isolate to YouTube origins and reject enterprise SaaS domains', () => {
    const enterpriseDomains = [
      'https://myworkday.com/corporate/home',
      'https://company.my.salesforce.com/lightning/page/home',
      'https://fiori.corp.sap.com/sap/bc/ui5_ui5/ui2/ushell/shells/abap/FioriLaunchpad.html',
      'https://service-now.com/navpage.do',
      'https://jira.atlassian.net/jira/software/projects',
      'https://portal.office.com',
      'https://sharepoint.com/sites/intranet',
      'https://login.microsoftonline.com',
      'https://google.com',
      'https://slack.com'
    ];

    const contentScripts = manifest.content_scripts || [];
    assert.ok(contentScripts.length > 0, 'manifest must define content_scripts');

    for (const entry of contentScripts) {
      for (const pattern of entry.matches) {
        assert.ok(
          pattern.includes('youtube.com'),
          `Match pattern '${pattern}' must be restricted to YouTube domains`
        );
        assert.strictEqual(
          pattern.includes('<all_urls>'),
          false,
          'Content scripts must never match <all_urls>'
        );
      }
    }

    // Verify regex matching logic against enterprise domains
    for (const domain of enterpriseDomains) {
      const url = new URL(domain);
      for (const entry of contentScripts) {
        for (const pattern of entry.matches) {
          // Standard chrome match pattern test: e.g. *://*.youtube.com/*
          const regexStr = '^' + pattern
            .replace(/\./g, '\\.')
            .replace(/\*/g, '.*')
            .replace(/\//g, '\\/') + '$';
          const rx = new RegExp(regexStr);
          assert.strictEqual(
            rx.test(url.href),
            false,
            `Enterprise SaaS URL '${url.href}' must NEVER match extension pattern '${pattern}'`
          );
        }
      }
    }
  });

  test('Phase 2: Host permissions strictly isolate network scope and forbid enterprise SaaS interception', () => {
    const hostPerms = manifest.host_permissions || [];
    const allowedHosts = [
      'https://*.youtube.com/*',
      'https://returnyoutubedislikeapi.com/*',
      'https://biggest_bucket.storage.googleapis.com/*'
    ];

    assert.deepStrictEqual(hostPerms.sort(), allowedHosts.sort());

    for (const host of hostPerms) {
      assert.strictEqual(host.includes('<all_urls>'), false, 'Cannot include <all_urls>');
      assert.strictEqual(host.includes('http://'), false, 'All host permissions must enforce HTTPS');
    }
  });

  test('Phase 2: Managed schema conforms to Chrome Enterprise storage.managed Draft 3/4 spec', () => {
    const schemaPath = path.join(rootDir, 'managed-schema.json');
    assert.ok(fs.existsSync(schemaPath), 'managed-schema.json must exist in root directory');

    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    assert.strictEqual(schema.$schema, 'http://json-schema.org/draft-03/schema#');
    assert.strictEqual(schema.type, 'object');
    assert.ok(schema.properties, 'schema must declare properties');

    const requiredKeys = ['DisableAdBlock', 'DisableRecording', 'DisableThirdPartyAPIs', 'ForceDefaultQuality'];
    for (const key of requiredKeys) {
      assert.ok(schema.properties[key], `managed-schema must define property '${key}'`);
      assert.ok(schema.properties[key].type, `Property '${key}' must define type`);
      assert.ok(schema.properties[key].title, `Property '${key}' must define title`);
      assert.ok(schema.properties[key].description, `Property '${key}' must define description`);
    }
  });

  test('Phase 3: Grey-Box VAPT - Zero plaintext tokens, credentials, or PII written to storage', () => {
    // Scan all js files in content, background, popup, shared
    const scanDirs = ['content', 'background', 'popup', 'shared'];
    const forbiddenPatterns = [
      /password/i,
      /secret/i,
      /token\s*[:=]\s*['"`][a-zA-Z0-9_\-]{16,}['"`]/,
      /jwt/i,
      /api_key\s*[:=]/i,
      /auth_header/i,
      /cookie\s*[:=]/i
    ];

    for (const dir of scanDirs) {
      const fullDir = path.join(rootDir, dir);
      if (!fs.existsSync(fullDir)) continue;
      const files = fs.readdirSync(fullDir).filter(f => f.endsWith('.js'));
      for (const file of files) {
        const content = fs.readFileSync(path.join(fullDir, file), 'utf8');
        for (const pattern of forbiddenPatterns) {
          const match = content.match(pattern);
          assert.strictEqual(
            match,
            null,
            `Security Alert: Hardcoded sensitive secret or credential keyword matched '${pattern}' in ${dir}/${file}`
          );
        }
      }
    }
  });

  test('Phase 3: Grey-Box VAPT - Zero cross-world message broadcasts using wildcard targetOrigin ("*")', () => {
    const mainWorldFiles = [
      'content/main-world.js',
      'content/youtube-quality.js',
      'content/stats-overlay.js'
    ];

    for (const relPath of mainWorldFiles) {
      const filePath = path.join(rootDir, relPath);
      const code = fs.readFileSync(filePath, 'utf8');

      // Check for window.postMessage(..., '*')
      const wildcardPostMessageRegex = /window\.postMessage\([^)]*['"]\*['"]\)/g;
      const matches = code.match(wildcardPostMessageRegex);
      assert.strictEqual(
        matches,
        null,
        `File ${relPath} must not use wildcard targetOrigin '*' in postMessage calls. Found: ${matches}`
      );
    }
  });

  test('Phase 3: Compliance & Privacy - Zero third-party telemetry, tracking pixels, or external beacon SDKs', () => {
    const trackingSignatures = [
      'google-analytics.com',
      'googletagmanager.com',
      'analytics.js',
      'gtag',
      'mixpanel',
      'amplitude',
      'hotjar',
      'sentry.io',
      'datadoghq',
      'segment.io',
      'facebook.net'
    ];

    const scanDirs = ['content', 'background', 'popup', 'shared'];
    for (const dir of scanDirs) {
      const fullDir = path.join(rootDir, dir);
      if (!fs.existsSync(fullDir)) continue;
      const files = fs.readdirSync(fullDir).filter(f => f.endsWith('.js') || f.endsWith('.html'));
      for (const file of files) {
        const content = fs.readFileSync(path.join(fullDir, file), 'utf8');
        for (const sig of trackingSignatures) {
          assert.strictEqual(
            content.includes(sig),
            false,
            `DPIA Violation: Prohibited third-party tracker or telemetry signature '${sig}' found in ${dir}/${file}`
          );
        }
      }
    }
  });
});

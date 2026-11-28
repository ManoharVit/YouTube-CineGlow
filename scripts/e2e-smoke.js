#!/usr/bin/env node
// scripts/e2e-smoke.js
// Real-Chromium MV3 E2E smoke check exercising CineGlow against the local YouTube SPA fixture.
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer');

const REPO_ROOT = path.resolve(__dirname, '..');
const FIXTURE_PATH = path.join(REPO_ROOT, 'test/fixtures/youtube-spa-fixture.html');
const FAILURE_DIR = path.join(REPO_ROOT, 'test-results/e2e-failures');
const EXT_ENTRIES = [
  'manifest.json',
  'managed-schema.json',
  'background',
  'content',
  'popup',
  'shared',
  'icons',
  'rules'
];

function stageExtensionCopy() {
  const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cineglow-e2e-ext-'));
  for (const rel of EXT_ENTRIES) {
    const src = path.join(REPO_ROOT, rel);
    const dest = path.join(stageDir, rel);
    if (fs.existsSync(src)) {
      fs.cpSync(src, dest, { recursive: true });
    }
  }
  return stageDir;
}

function assertTruthy(condition, message) {
  assert.ok(condition, message);
}

async function runSmoke() {
  const fixtureHtml = fs.readFileSync(FIXTURE_PATH, 'utf8');
  const stageDir = stageExtensionCopy();
  const launchArgs = [];
  if (process.env.CI || process.platform === 'linux') {
    launchArgs.push('--no-sandbox', '--disable-setuid-sandbox');
  }

  const browser = await puppeteer.launch({
    headless: 'new',
    enableExtensions: true,
    protocolTimeout: 15000,
    args: launchArgs
  });

  const pageErrors = [];
  let page = null;

  try {
    const extId = await browser.installExtension(stageDir);
    assertTruthy(extId, 'Extension ID must be assigned when installing unpacked extension');

    const swTarget = await browser.waitForTarget(
      (target) => target.type() === 'service_worker' && target.url().includes(extId),
      { timeout: 10000 }
    );
    const sw = await swTarget.worker();

    // 1. Verify popup opens and toggle works without runtime errors
    const popupPage = await browser.newPage();
    popupPage.on('pageerror', (err) => pageErrors.push(`popup: ${err.message}`));
    await popupPage.goto(`chrome-extension://${extId}/popup/popup.html`, {
      waitUntil: 'domcontentloaded',
      timeout: 10000
    });
    const hasHideAiToggle = await popupPage.$('#hideAiVideos');
    assertTruthy(hasHideAiToggle, 'Popup must render #hideAiVideos toggle');
    await popupPage.close();

    // Enable opt-in Hide AI Videos for E2E verification
    await sw.evaluate(() => chrome.storage.sync.set({ hideAiVideos: true }));

    // 2. Load local YouTube SPA fixture offline at https://www.youtube.com origin
    page = await browser.newPage();
    page.on('pageerror', (err) => pageErrors.push(`watch: ${err.message}`));
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (req.url().startsWith('https://www.youtube.com/')) {
        req.respond({ status: 200, contentType: 'text/html', body: fixtureHtml });
      } else {
        req.respond({ status: 200, contentType: 'text/css', body: '' });
      }
    });

    await page.goto('https://www.youtube.com/watch?v=clean000001', {
      waitUntil: 'domcontentloaded',
      timeout: 10000
    });

    // Wait for isolated-world HideAI scan to mark disclosed feed cards
    await page.waitForSelector('[data-testid="card-disclosed-badge"][data-cineglow-ai-hidden="true"]', {
      timeout: 8000
    });

    const initialState = await page.evaluate(() => ({
      badgeHidden: document.querySelector('[data-testid="card-disclosed-badge"]')?.getAttribute('data-cineglow-ai-hidden'),
      textHidden: document.querySelector('[data-testid="card-disclosed-text"]')?.getAttribute('data-cineglow-ai-hidden'),
      cleanHidden: document.querySelector('[data-testid="card-tutorial-clean"]')?.hasAttribute('data-cineglow-ai-hidden'),
      watchHidden: document.documentElement.hasAttribute('cineglow-ai-watch-hidden'),
      overlayPresent: Boolean(document.getElementById('cineglow-ai-disclosure-overlay'))
    }));

    assert.strictEqual(initialState.badgeHidden, 'true', 'AI_DISCLOSURE badge card must be hidden');
    assert.strictEqual(initialState.textHidden, 'true', 'Official text badge card must be hidden');
    assert.strictEqual(initialState.cleanHidden, false, 'Clean AI tutorial card must NOT be hidden');
    assert.strictEqual(initialState.watchHidden, false, 'Clean watch video must NOT false-positive from expander prose or feed cards');
    assert.strictEqual(initialState.overlayPresent, false, 'Clean watch video must NOT mount blocking overlay');

    // 3. SPA navigate to MAIN-world disclosed video (flexy.data)
    await page.evaluate(() => {
      window.fixtureNavigate('/watch?v=aiWatch0001', { disclosed: true });
    });

    await page.waitForSelector('html[cineglow-ai-watch-hidden="true"]', { timeout: 8000 });
    await page.waitForSelector('#cineglow-ai-disclosure-overlay', { timeout: 8000 });

    // Confirm event loop remains responsive (no MutationObserver infinite loop) & Watch Anyway works
    await page.click('#cineglow-ai-disclosure-overlay .cineglow-ai-btn-secondary');
    await page.waitForFunction(
      () => !document.documentElement.hasAttribute('cineglow-ai-watch-hidden') &&
        !document.getElementById('cineglow-ai-disclosure-overlay'),
      { timeout: 5000 }
    );

    // 4. SPA navigate to DOM structured disclosure panel video
    await page.evaluate(() => {
      window.fixtureNavigate('/watch?v=domWatch002', { domPanel: true });
    });
    await page.waitForSelector('#cineglow-ai-disclosure-overlay', { timeout: 8000 });

    // Navigate back cleanly
    await page.evaluate(() => {
      window.fixtureNavigate('/watch?v=clean000003', { disclosed: false });
    });
    await page.waitForFunction(
      () => !document.documentElement.hasAttribute('cineglow-ai-watch-hidden'),
      { timeout: 5000 }
    );

    // 5. Append dynamic Shorts card (MutationObserver infinite scroll)
    await page.evaluate(() => {
      const feed = document.querySelector('.feed');
      const shortCard = document.createElement('ytm-shorts-lockup-view-model');
      shortCard.setAttribute('data-testid', 'card-shorts-disclosed');
      const link = document.createElement('a');
      link.setAttribute('href', '/shorts/aiShort0099');
      link.textContent = 'AI Short';
      const badge = document.createElement('yt-badge-shape');
      badge.setAttribute('badge-style', 'BADGE_STYLE_TYPE_AI_DISCLOSURE');
      shortCard.appendChild(link);
      shortCard.appendChild(badge);
      feed.appendChild(shortCard);
    });
    await page.waitForSelector('[data-testid="card-shorts-disclosed"][data-cineglow-ai-hidden="true"]', {
      timeout: 5000
    });

    assert.deepStrictEqual(pageErrors, [], `Unexpected Chromium page errors: ${pageErrors.join('; ')}`);
    console.log('Chromium E2E smoke test PASSED (popup + MV3 content/main-world + Hide AI watch/feed/Shorts SPA transitions).');
  } catch (err) {
    if (page) {
      try {
        fs.mkdirSync(FAILURE_DIR, { recursive: true });
        await page.screenshot({ path: path.join(FAILURE_DIR, 'e2e-smoke-failure.png') });
      } catch (_) {}
    }
    throw err;
  } finally {
    await browser.close();
    fs.rmSync(stageDir, { recursive: true, force: true });
  }
}

runSmoke().catch((err) => {
  console.error('FAILED Chromium E2E smoke test:', err);
  process.exit(1);
});

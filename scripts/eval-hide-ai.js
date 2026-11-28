#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { MockElement } = require('../test/helpers/mock-dom');

const REPO_ROOT = path.resolve(__dirname, '..');
const DATASET_PATH = path.join(REPO_ROOT, 'test/eval/hide-ai-dataset.json');
const MAIN_WORLD_CODE = fs.readFileSync(path.join(REPO_ROOT, 'content/main-world.js'), 'utf8');

function evaluateCase(testCase) {
  const posted = [];
  const listeners = [];

  const isWatch = testCase.surface === 'watch';
  const urlHref = isWatch
    ? `https://www.youtube.com/watch?v=${testCase.videoId}`
    : 'https://www.youtube.com/';

  const flexy = new MockElement('ytd-watch-flexy', { 'video-id': testCase.videoId });
  flexy.data = testCase.flexyData || {
    currentVideoEndpoint: { watchEndpoint: { videoId: testCase.videoId } },
    engagementPanels: []
  };

  const player = new MockElement('div', { id: 'movie_player' });
  player.getPlayerResponse = () => testCase.playerResponse || {
    videoDetails: { videoId: testCase.videoId }
  };

  const feedCards = [];
  if (testCase.feedCardData) {
    const card = new MockElement('ytd-rich-item-renderer');
    card.data = testCase.feedCardData;
    feedCards.push(card);
  }

  const mwWindow = {
    location: {
      href: urlHref,
      pathname: isWatch ? '/watch' : '/',
      search: isWatch ? `?v=${testCase.videoId}` : '',
      origin: 'https://www.youtube.com'
    },
    ytInitialData: testCase.ytInitialData || null,
    ytInitialPlayerResponse: testCase.ytInitialPlayerResponse || null,
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
    querySelector: (sel) => (sel === 'ytd-watch-flexy' ? flexy : null),
    querySelectorAll: () => feedCards
  };

  vm.runInNewContext(MAIN_WORLD_CODE, {
    window: mwWindow,
    document: mwDoc,
    URL,
    JSON,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval
  });

  const handler = listeners.find((l) => l.type === 'message' && l.fn.name === 'handleAiDisclosureMessage');
  if (!handler) {
    throw new Error('handleAiDisclosureMessage listener not registered in content/main-world.js');
  }

  if (isWatch) {
    handler.fn({
      source: mwWindow,
      origin: mwWindow.location.origin,
      data: { type: 'CINEGLOW_CHECK_AI_DISCLOSURE' }
    });
    const resp = posted.find((p) => p.data?.type === 'CINEGLOW_AI_DISCLOSURE_RESPONSE');
    return Boolean(resp?.data?.disclosed);
  }

  handler.fn({
    source: mwWindow,
    origin: mwWindow.location.origin,
    data: { type: 'CINEGLOW_CHECK_FEED_AI_DISCLOSURES' }
  });
  const resp = posted.find((p) => p.data?.type === 'CINEGLOW_FEED_AI_DISCLOSURES_RESPONSE');
  const ids = Array.isArray(resp?.data?.videoIds) ? resp.data.videoIds : [];
  return ids.includes(testCase.videoId);
}

function runEvaluation(datasetPath = DATASET_PATH) {
  const dataset = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));
  const overall = { tp: 0, fp: 0, tn: 0, fn: 0 };
  const byCategory = {};
  const failures = [];

  for (const tc of dataset.cases) {
    const predicted = evaluateCase(tc);
    const expected = Boolean(tc.expected);
    if (!byCategory[tc.category]) {
      byCategory[tc.category] = { tp: 0, fp: 0, tn: 0, fn: 0, total: 0 };
    }
    const cat = byCategory[tc.category];
    cat.total += 1;

    if (expected && predicted) {
      overall.tp += 1;
      cat.tp += 1;
    } else if (!expected && predicted) {
      overall.fp += 1;
      cat.fp += 1;
      failures.push({ id: tc.id, category: tc.category, type: 'FALSE_POSITIVE' });
    } else if (!expected && !predicted) {
      overall.tn += 1;
      cat.tn += 1;
    } else {
      overall.fn += 1;
      cat.fn += 1;
      failures.push({ id: tc.id, category: tc.category, type: 'FALSE_NEGATIVE' });
    }
  }

  const precision = (overall.tp + overall.fp) > 0 ? overall.tp / (overall.tp + overall.fp) : 1;
  const recall = (overall.tp + overall.fn) > 0 ? overall.tp / (overall.tp + overall.fn) : 1;
  const falsePositiveRate = (overall.fp + overall.tn) > 0 ? overall.fp / (overall.fp + overall.tn) : 0;

  return {
    schemaVersion: dataset.schemaVersion,
    policy: dataset.policy,
    totalCases: dataset.cases.length,
    confusionMatrix: overall,
    precision,
    recall,
    falsePositiveRate,
    byCategory,
    failures,
    passed: falsePositiveRate <= dataset.policy.falsePositiveBudget &&
      recall >= dataset.policy.minRecallOnConfirmedDisclosures
  };
}

if (require.main === module) {
  const report = runEvaluation();
  console.log('Hide AI Detector Evaluation Report (Section 6B)');
  console.log(`Cases: ${report.totalCases} | TP: ${report.confusionMatrix.tp} | FP: ${report.confusionMatrix.fp} | TN: ${report.confusionMatrix.tn} | FN: ${report.confusionMatrix.fn}`);
  console.log(`Precision: ${(report.precision * 100).toFixed(2)}% | Recall: ${(report.recall * 100).toFixed(2)}% | FPR: ${(report.falsePositiveRate * 100).toFixed(2)}% (budget <= ${(report.policy.falsePositiveBudget * 100).toFixed(2)}%)`);
  for (const [cat, stats] of Object.entries(report.byCategory)) {
    const catFpr = (stats.fp + stats.tn) > 0 ? ((stats.fp / (stats.fp + stats.tn)) * 100).toFixed(1) + '%' : 'n/a';
    console.log(`  - ${cat}: total=${stats.total} tp=${stats.tp} fp=${stats.fp} tn=${stats.tn} fn=${stats.fn} fpr=${catFpr}`);
  }
  if (!report.passed) {
    console.error('FAILED Hide AI detector evaluation gate:', report.failures);
    process.exit(1);
  }
}

module.exports = { runEvaluation };

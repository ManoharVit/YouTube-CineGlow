const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { runEvaluation } = require('../scripts/eval-hide-ai');

describe('Hide AI Detector Quality Evaluation Gate (Section 6B)', () => {
  test('meets false-positive budget (<= 1%) and 100% recall on confirmed official disclosures across all categories', () => {
    const report = runEvaluation();
    assert.ok(report.totalCases >= 15, 'Evaluation dataset must cover positive and hard-negative categories');
    assert.strictEqual(report.confusionMatrix.fp, 0, `Unexpected false positives: ${JSON.stringify(report.failures)}`);
    assert.strictEqual(report.confusionMatrix.fn, 0, `Unexpected false negatives: ${JSON.stringify(report.failures)}`);
    assert.ok(
      report.falsePositiveRate <= report.policy.falsePositiveBudget,
      `FPR ${report.falsePositiveRate} exceeded budget ${report.policy.falsePositiveBudget}`
    );
    assert.ok(
      report.recall >= report.policy.minRecallOnConfirmedDisclosures,
      `Recall ${report.recall} fell below ${report.policy.minRecallOnConfirmedDisclosures}`
    );
    assert.strictEqual(report.passed, true);
  });
});

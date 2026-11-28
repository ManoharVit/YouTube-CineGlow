#!/usr/bin/env node
// scripts/lint-check.js
// Static syntax, MV3 safety, and JSON schema checks (Guide Section 2 & SEC-03)
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const JS_DIRS = ['background', 'content', 'popup', 'shared', 'scripts'];
const JSON_FILES = [
  'manifest.json',
  'managed-schema.json',
  'package.json',
  'rules/adblock.json',
  'test/eval/hide-ai-dataset.json'
];

function walkJs(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkJs(full));
    else if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs')) out.push(full);
  }
  return out;
}

const errors = [];
let checkedJs = 0;

for (const rel of JSON_FILES) {
  const full = path.join(REPO_ROOT, rel);
  try {
    JSON.parse(fs.readFileSync(full, 'utf8'));
  } catch (err) {
    errors.push(`Invalid JSON in ${rel}: ${err.message}`);
  }
}

const evalRe = new RegExp('\\beval\\s*\\(');
const fnCtorRe = new RegExp('\\bnew\\s+Func' + 'tion\\s*\\(');
const docWriteRe = /\bdocument\.write\s*\(/;
const swIntervalRe = /\bsetInterval\s*\(/;

for (const dir of JS_DIRS) {
  for (const file of walkJs(path.join(REPO_ROOT, dir))) {
    const rel = path.relative(REPO_ROOT, file);
    checkedJs += 1;
    try {
      execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    } catch (err) {
      errors.push(`Syntax error in ${rel}: ${err.stderr?.toString() || err.message}`);
    }

    if (dir !== 'scripts') {
      const src = fs.readFileSync(file, 'utf8');
      if (evalRe.test(src)) errors.push(`Disallowed eval() in ${rel}`);
      if (fnCtorRe.test(src)) errors.push(`Disallowed Function constructor in ${rel}`);
      if (docWriteRe.test(src)) errors.push(`Disallowed document.write() in ${rel}`);
      if (rel === 'background/background.js' && swIntervalRe.test(src)) {
        errors.push(`Disallowed setInterval() in MV3 service worker ${rel} (use chrome.alarms)`);
      }
    }
  }
}

if (errors.length > 0) {
  console.error('Lint check FAILED:');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(`Lint check PASSED: ${checkedJs} JS/MJS files and ${JSON_FILES.length} JSON files verified.`);

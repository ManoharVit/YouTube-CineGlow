#!/usr/bin/env node
// scripts/bundle-size-check.js
// Tracks unpacked extension and release zip size against growth budgets (PERF-05)
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'manifest.json'), 'utf8'));
const ZIP_NAME = `YouTube-CineGlow-v${manifest.version}.zip`;
const ZIP_PATH = path.join(REPO_ROOT, ZIP_NAME);

const MAX_CODE_BYTES = 750 * 1024; // 750 KB unpacked JS + CSS + HTML + JSON budget
const MAX_ZIP_BYTES = 512 * 1024;  // 512 KB release zip budget

const CODE_DIRS = ['background', 'content', 'popup', 'shared', 'rules'];

function dirSize(dir) {
  let total = 0;
  if (!fs.existsSync(dir)) return 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += dirSize(full);
    else if (entry.name !== '.DS_Store') total += fs.statSync(full).size;
  }
  return total;
}

const breakdown = {};
let codeBytes = fs.statSync(path.join(REPO_ROOT, 'manifest.json')).size +
  fs.statSync(path.join(REPO_ROOT, 'managed-schema.json')).size;

for (const d of CODE_DIRS) {
  const bytes = dirSize(path.join(REPO_ROOT, d));
  breakdown[d] = bytes;
  codeBytes += bytes;
}

const zipBytes = fs.existsSync(ZIP_PATH) ? fs.statSync(ZIP_PATH).size : 0;

console.log('Bundle Size Report (PERF-05):');
for (const [k, v] of Object.entries(breakdown)) {
  console.log(`  - ${k}/: ${(v / 1024).toFixed(1)} KB`);
}
console.log(`  - Unpacked code total: ${(codeBytes / 1024).toFixed(1)} KB (budget <= ${(MAX_CODE_BYTES / 1024).toFixed(0)} KB)`);
if (zipBytes > 0) {
  console.log(`  - ${ZIP_NAME}: ${(zipBytes / 1024).toFixed(1)} KB (budget <= ${(MAX_ZIP_BYTES / 1024).toFixed(0)} KB)`);
}

let failed = false;
if (codeBytes > MAX_CODE_BYTES) {
  console.error(`FAIL: Unpacked code size ${codeBytes} exceeded budget ${MAX_CODE_BYTES}`);
  failed = true;
}
if (zipBytes > MAX_ZIP_BYTES) {
  console.error(`FAIL: Release zip size ${zipBytes} exceeded budget ${MAX_ZIP_BYTES}`);
  failed = true;
}
if (failed) process.exit(1);

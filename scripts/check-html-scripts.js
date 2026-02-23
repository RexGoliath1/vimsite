#!/usr/bin/env node
// Extracts <script type="module"> blocks from HTML files and syntax-checks
// them with acorn. Exits 1 if any block fails to parse.
// Usage: node scripts/check-html-scripts.js gnss.html [other.html ...]

'use strict';

const fs = require('fs');
const path = require('path');
const { parse } = require('acorn');

const files = process.argv.slice(2);
if (!files.length) {
  console.error('Usage: check-html-scripts.js <file.html> [...]');
  process.exit(1);
}

let failed = false;
const SCRIPT_RE = /<script\s+type="module">([\s\S]*?)<\/script>/g;

for (const file of files) {
  let html;
  try {
    html = fs.readFileSync(file, 'utf8');
  } catch (e) {
    console.error(`✗ cannot read ${file}: ${e.message}`);
    failed = true;
    continue;
  }

  let match;
  let i = 0;
  SCRIPT_RE.lastIndex = 0;
  while ((match = SCRIPT_RE.exec(html))) {
    i++;
    const src = match[1];
    const label = `${path.basename(file)} script #${i}`;
    try {
      parse(src, { ecmaVersion: 2022, sourceType: 'module' });
      console.log(`✓ ${label}: OK`);
    } catch (e) {
      // Report line/col relative to the script block
      console.error(`✗ ${label}: ${e.message}`);
      failed = true;
    }
  }

  if (i === 0) {
    console.log(`  ${path.basename(file)}: no module scripts found`);
  }
}

process.exit(failed ? 1 : 0);

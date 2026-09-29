// Development-only verification; not a dependency of the static website.
const fs = require('fs');
const path = require('path');
const {execFileSync} = require('child_process');
const html = fs.readFileSync('source/index.html', 'utf8');
const missing = [];
for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  const url = match[1];
  if (!/^(https?:|#|mailto:|tel:)/.test(url) && !fs.existsSync(path.join('source', url))) missing.push(url);
}
const record = JSON.parse(fs.readFileSync('output/playwright/restored-regression-results.json', 'utf8'));
const motion = JSON.parse(fs.readFileSync('output/playwright/restored-motion-results.json', 'utf8'));
const scroll = JSON.parse(fs.readFileSync('output/playwright/scroll-motion-results.json', 'utf8'));
const result = {
  missingLocalReferences: missing,
  runtimeScripts: [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map(match => match[1]),
  originalIndexUnmodified: execFileSync('git', ['diff', '--', 'index.html'], {encoding:'utf8'}).length === 0,
  browserChecksPassed: record.checks.filter(check => check.passed).length,
  browserChecksTotal: record.checks.length,
  motionChecksPassed: motion.checks.filter(check => check.passed).length,
  motionChecksTotal: motion.checks.length,
  scrollChecksPassed: scroll.checks.filter(check => check.passed).length,
  scrollChecksTotal: scroll.checks.length,
};
console.log(JSON.stringify(result, null, 2));
if (missing.length || !result.originalIndexUnmodified || result.browserChecksPassed !== result.browserChecksTotal || result.motionChecksPassed !== result.motionChecksTotal || result.scrollChecksPassed !== result.scrollChecksTotal) process.exitCode = 1;

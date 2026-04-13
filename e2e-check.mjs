// End-to-end smoke check: open the actual UI, upload each fixture via the
// file input, capture the generated download Blob contents by intercepting
// URL.createObjectURL, and validate each output with xmllint.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright/index.mjs'
);

const base = process.argv[2] || 'http://localhost:8765/';
const url = base.replace(/\/$/, '') + '/index.html';
const fixtures = readdirSync('./fixtures').filter((f) => f.endsWith('.gpx')).sort();

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('[pageerror]', e.message));

await page.goto(url, { waitUntil: 'load' });

const tmp = mkdtempSync(join(tmpdir(), 'gpxtotrack-e2e-'));
let failures = 0;

for (const name of fixtures) {
  await page.setInputFiles('#file', './fixtures/' + name);
  await page.waitForSelector('.download', { state: 'visible', timeout: 5000 });
  const href = await page.$eval('.download', (a) => a.href);
  const downloaded = await page.evaluate(async (h) => {
    const r = await fetch(h);
    return r.text();
  }, href);
  const outPath = join(tmp, name.replace(/\.gpx$/, '-track.gpx'));
  writeFileSync(outPath, downloaded);
  try {
    execFileSync('xmllint', ['--noout', outPath]);
    console.log('  ', name, '->', outPath, '(xmllint ok)');
  } catch (e) {
    failures++;
    console.error('FAIL', name, e.stderr?.toString() || e.message);
  }
  // Clear before next file.
  await page.evaluate(() => {
    document.querySelectorAll('#resultList li').forEach((e) => e.remove());
    document.getElementById('results').hidden = true;
  });
}

await browser.close();
if (failures) {
  console.error(failures + ' file(s) failed xmllint');
  process.exit(1);
}
console.log('All ' + fixtures.length + ' fixtures converted and xmllint-clean.');
rmSync(tmp, { recursive: true, force: true });

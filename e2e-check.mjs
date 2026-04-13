// End-to-end smoke check: open the actual UI, upload each fixture via the
// file input, wait for the preview + Convert button to appear, click Convert,
// capture the Playwright download, and validate with xmllint.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright/index.mjs'
);

const base = process.argv[2] || 'http://localhost:8765/';
const url = base.replace(/\/$/, '') + '/index.html';
const fixtures = readdirSync('./fixtures').filter((f) => f.endsWith('.gpx')).sort();

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ acceptDownloads: true });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.error('[pageerror]', e.message));

await page.goto(url, { waitUntil: 'load' });

const tmp = mkdtempSync(join(tmpdir(), 'gpxtotrack-e2e-'));
let failures = 0;

for (const name of fixtures) {
  await page.setInputFiles('#file', './fixtures/' + name);
  // Wait for the per-file card with its Convert button (preview computed).
  await page.waitForSelector('button.convert:not([disabled])', { timeout: 5000 });

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('button.convert'),
  ]);

  const suggested = download.suggestedFilename();
  const expectedSuffix = '- normalized.gpx';
  if (!suggested.endsWith(expectedSuffix)) {
    failures++;
    console.error('FAIL', name, 'download filename', suggested, 'does not end with', expectedSuffix);
  }

  const outPath = join(tmp, suggested);
  await download.saveAs(outPath);

  try {
    execFileSync('xmllint', ['--noout', outPath]);
    console.log('  ', name, '->', outPath, '(xmllint ok)');
  } catch (e) {
    failures++;
    console.error('FAIL', name, e.stderr?.toString() || e.message);
  }

  // Reset for the next fixture: reload wipes the in-memory cards cleanly.
  await page.goto(url, { waitUntil: 'load' });
}

await browser.close();
if (failures) {
  console.error(failures + ' file(s) failed');
  process.exit(1);
}
console.log('All ' + fixtures.length + ' fixtures converted and xmllint-clean.');
rmSync(tmp, { recursive: true, force: true });

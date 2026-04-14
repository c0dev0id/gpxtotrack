// Headless test runner: starts nothing itself — expects an HTTP server serving
// the repo root on the URL in argv[2] (defaults to http://localhost:8000/).
// Navigates Chromium to test.html, waits for the in-page summary, prints the
// per-test results, and exits non-zero on any failure.

// Resolve playwright from the user's global install to avoid requiring a
// local node_modules just for tests.
const playwrightEntry = process.env.PLAYWRIGHT_MODULE
  || new URL('./node_modules/playwright/index.mjs', import.meta.url).pathname;
const { chromium } = await import(playwrightEntry);

const base = process.argv[2] || 'http://localhost:8000/';
const url = base.replace(/\/$/, '') + '/test.html';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

const logs = [];
page.on('console', (msg) => logs.push('[' + msg.type() + '] ' + msg.text()));
page.on('pageerror', (err) => logs.push('[pageerror] ' + err.message));

await page.goto(url, { waitUntil: 'load' });
try {
  await page.waitForFunction(() => {
    const s = document.getElementById('summary');
    return s && /\d+ passed, \d+ failed/.test(s.textContent);
  }, { timeout: 20000 });
} catch (e) {
  console.error('Timed out waiting for tests to finish.');
  for (const l of logs) console.error(l);
  await browser.close();
  process.exit(2);
}

const results = await page.$$eval('.test', (els) => els.map((el) => ({
  text: el.textContent,
  pass: el.classList.contains('pass'),
})));
const summary = await page.$eval('#summary', (el) => el.textContent);

for (const r of results) process.stdout.write((r.pass ? '  ' : '\u2717 ') + r.text + '\n');
process.stdout.write('\n' + summary + '\n');
if (logs.length) {
  process.stdout.write('\n--- browser console ---\n');
  for (const l of logs) process.stdout.write(l + '\n');
}

await browser.close();
process.exit(/0 failed/.test(summary) ? 0 : 1);

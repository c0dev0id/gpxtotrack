import { convert, summarizeInput, analyzeInput, GPX_NS, GPXX_NS, TRP_NS, WPTX1_NS, CTX_NS } from './gpxtotrack.js';
import { tests } from './tests.js';

const output = document.getElementById('output');
const summary = document.getElementById('summary');

let passes = 0, fails = 0;

function log(name, ok, msg) {
  const div = document.createElement('div');
  div.className = 'test ' + (ok ? 'pass' : 'fail');
  div.textContent = (ok ? 'PASS ' : 'FAIL ') + name + (msg ? ' — ' + msg : '');
  output.appendChild(div);
  if (ok) passes++; else fails++;
}

async function loadFixture(name) {
  const r = await fetch('fixtures/' + name);
  if (!r.ok) throw new Error('fetch ' + name + ': ' + r.status);
  return r.text();
}

const ctx = {
  log,
  convert,
  summarizeInput,
  analyzeInput,
  parse(xml) { return new DOMParser().parseFromString(xml, 'application/xml'); },
  loadFixture,
  GPX_NS, GPXX_NS, TRP_NS, WPTX1_NS, CTX_NS,
};

(async () => {
  for (const t of tests) {
    try {
      await t(ctx);
    } catch (err) {
      log(t.name || '(anonymous)', false, 'threw: ' + (err && err.message || err));
    }
  }
  summary.textContent = passes + ' passed, ' + fails + ' failed';
  summary.className = fails ? 'test fail' : 'test pass';
})();

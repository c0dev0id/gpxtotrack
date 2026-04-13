import { convert, summarizeInput } from './gpxtotrack.js';

const TOLERANCE_STOPS_M = [10, 20, 50, 100, 250, 500, 750, 1000];
const DEFAULT_INDEX = 0;

const fileInput    = document.getElementById('file');
const dropZone     = document.getElementById('drop');
const tolerance    = document.getElementById('tolerance');
const toleranceOut = document.getElementById('toleranceOut');
const keepWpts     = document.getElementById('keepRteptWaypoints');
const controlsSec  = document.getElementById('controls');
const resultsSec   = document.getElementById('results');
const resultList   = document.getElementById('resultList');
const errorsSec    = document.getElementById('errors');
const errorList    = document.getElementById('errorList');

// In-memory state for every file currently on screen.
const cards = [];

// Union of feature flags across all currently loaded files.
let unifiedFeatures = {
  hasDisplayColor:  false,
  hasRoutingMeta:   false,
  hasThirdPartyExt: false,
  anyRouteOrTrack:  false,  // true if any file has routes or existing tracks
};

tolerance.value = String(DEFAULT_INDEX);
updateToleranceLabel();

tolerance.addEventListener('input', onOptionsChanged);
keepWpts.addEventListener('change', onOptionsChanged);

for (const name of ['displayColor', 'routingMeta', 'thirdPartyExt']) {
  for (const el of document.querySelectorAll(`input[name="${name}"]`)) {
    el.addEventListener('change', onOptionsChanged);
  }
}

fileInput.addEventListener('change', (e) => handleFiles(e.target.files));

['dragenter', 'dragover'].forEach((ev) => dropZone.addEventListener(ev, (e) => {
  e.preventDefault();
  dropZone.classList.add('dragging');
}));
['dragleave', 'drop'].forEach((ev) => dropZone.addEventListener(ev, (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragging');
}));
dropZone.addEventListener('drop', (e) => {
  if (e.dataTransfer && e.dataTransfer.files) handleFiles(e.dataTransfer.files);
});

function currentOptions() {
  const radioVal = (name) => {
    const el = document.querySelector(`input[name="${name}"]:checked`);
    return el ? el.value : null;
  };
  return {
    toleranceM:          TOLERANCE_STOPS_M[parseInt(tolerance.value, 10)] ?? TOLERANCE_STOPS_M[DEFAULT_INDEX],
    keepRteptWaypoints:  keepWpts.checked,
    displayColor:        radioVal('displayColor')  ?? 'keep',
    routingMeta:         radioVal('routingMeta')   ?? 'remove',
    thirdPartyExt:       radioVal('thirdPartyExt') ?? 'remove',
  };
}

function formatTolerance(m) {
  return m >= 1000 ? (m / 1000) + ' km' : m + ' m';
}

function updateToleranceLabel() {
  toleranceOut.textContent = formatTolerance(currentOptions().toleranceM);
}

function onOptionsChanged() {
  updateToleranceLabel();
  for (const entry of cards) recomputePreview(entry);
}

function updateControlVisibility() {
  document.getElementById('colorOption').hidden       = !unifiedFeatures.hasDisplayColor;
  document.getElementById('routingMetaOption').hidden = !unifiedFeatures.hasRoutingMeta;
  document.getElementById('thirdPartyExtOption').hidden = !unifiedFeatures.hasThirdPartyExt;

  // Hide the entire controls section for pure wpt-only files with no option-gated features.
  const isPureWptOnly = !unifiedFeatures.anyRouteOrTrack;
  const hasAnyOption  = unifiedFeatures.hasDisplayColor || unifiedFeatures.hasRoutingMeta || unifiedFeatures.hasThirdPartyExt;
  controlsSec.hidden = cards.length === 0 || (isPureWptOnly && !hasAnyOption);
}

async function handleFiles(files) {
  clearAll();
  for (const f of files) await handleFile(f);
  if (cards.length || errorList.childElementCount) {
    resultsSec.hidden = cards.length === 0;
    updateControlVisibility();
  }
}

async function handleFile(file) {
  let sourceText;
  try {
    sourceText = await file.text();
  } catch (err) {
    renderError(file, err);
    return;
  }

  let inputSummary;
  try {
    inputSummary = summarizeInput(sourceText);
  } catch (err) {
    renderError(file, err);
    return;
  }

  // Accumulate feature flags from this file into the union.
  const f = inputSummary.features;
  if (f) {
    if (f.hasDisplayColor)  unifiedFeatures.hasDisplayColor  = true;
    if (f.hasRoutingMeta)   unifiedFeatures.hasRoutingMeta   = true;
    if (f.hasThirdPartyExt) unifiedFeatures.hasThirdPartyExt = true;
    if (!f.routeOnly || f.hasExistingTrack) unifiedFeatures.anyRouteOrTrack = true;
  }

  const entry = {
    file,
    sourceText,
    inputSummary,
    lastPreview: null,
    lastPreviewError: null,
    cardEl: null,
    outputEl: null,
    convertBtn: null,
  };
  renderCard(entry);
  cards.push(entry);
  recomputePreview(entry);
}

function recomputePreview(entry) {
  try {
    entry.lastPreview = convert(entry.sourceText, currentOptions());
    entry.lastPreviewError = null;
  } catch (err) {
    entry.lastPreview = null;
    entry.lastPreviewError = err.message || String(err);
  }
  paintOutput(entry);
}

function renderCard(entry) {
  const li = document.createElement('li');
  li.className = 'card';

  const head = document.createElement('div');
  head.className = 'file';
  head.textContent = entry.file.name;
  li.appendChild(head);

  const grid = document.createElement('div');
  grid.className = 'summary-grid';

  const inCol = document.createElement('div');
  inCol.className = 'summary';
  inCol.innerHTML = '<h3>Input</h3>' + inputSummaryHtml(entry.inputSummary);
  grid.appendChild(inCol);

  const outCol = document.createElement('div');
  outCol.className = 'summary';
  outCol.innerHTML = '<h3>Output (preview)</h3><div class="stats">&hellip;</div>';
  grid.appendChild(outCol);

  li.appendChild(grid);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'convert';
  btn.textContent = 'Convert';
  btn.addEventListener('click', () => onConvert(entry));
  li.appendChild(btn);

  entry.cardEl   = li;
  entry.outputEl = outCol.querySelector('.stats');
  entry.convertBtn = btn;
  resultList.appendChild(li);
}

function paintOutput(entry) {
  if (!entry.outputEl) return;
  if (entry.lastPreviewError) {
    entry.outputEl.innerHTML = '<span class="err">' + escape(entry.lastPreviewError) + '</span>';
    entry.convertBtn.disabled = true;
    return;
  }
  const s = entry.lastPreview.stats;
  entry.outputEl.innerHTML = outputSummaryHtml(s, entry.inputSummary);
  entry.convertBtn.disabled = false;
}

function inputSummaryHtml(s) {
  return '<ul class="stats">' +
    row(count(s.routes, 'route', 'routes')) +
    row(count(s.rtepts, 'route point', 'route points')) +
    row(count(s.rpts, 'shaping point', 'shaping points')) +
    row(count(s.waypoints, 'waypoint', 'waypoints')) +
    (s.tracks ? row(count(s.tracks, 'existing track', 'existing tracks') + ' (' + s.trkpts + ' points)') : '') +
    (s.bounds ? row(bboxStr(s.bounds)) : '') +
    '</ul>';
}

function outputSummaryHtml(s, input) {
  return '<ul class="stats">' +
    row(count(s.routes, 'route', 'routes')) +
    row(input.rtepts + ' → ' + s.outputRtepts + ' route points') +
    row(s.outputTrkpts + ' track points') +
    row(count(s.outputWaypoints, 'waypoint', 'waypoints')) +
    (s.bounds ? row(bboxStr(s.bounds)) : '') +
    '</ul>';
}

function row(text) { return '<li>' + escape(text) + '</li>'; }

function count(n, singular, plural) {
  return n + ' ' + (n === 1 ? singular : plural);
}

function bboxStr(b) {
  return 'bbox ' + fmtCoord(b.minLat) + ',' + fmtCoord(b.minLon)
       + ' → ' + fmtCoord(b.maxLat) + ',' + fmtCoord(b.maxLon);
}

function onConvert(entry) {
  if (!entry.lastPreview) recomputePreview(entry);
  if (!entry.lastPreview) return;

  const gpxString = entry.lastPreview.gpx;
  const blob = new Blob([gpxString], { type: 'application/gpx+xml' });
  const url  = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = normalizedFilename(entry.file.name);
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 0);
}

function normalizedFilename(name) {
  const m = name.match(/^(.*?)(\.gpx)?$/i);
  return (m ? m[1] : name) + '- normalized.gpx';
}

function renderError(file, err) {
  errorsSec.hidden = false;
  const li = document.createElement('li');
  li.innerHTML = '<strong>' + escape(file.name) + '</strong>: ' + escape(err.message || String(err));
  errorList.appendChild(li);
}

function clearAll() {
  for (const c of cards) c.cardEl.remove();
  cards.length = 0;
  unifiedFeatures = {
    hasDisplayColor:  false,
    hasRoutingMeta:   false,
    hasThirdPartyExt: false,
    anyRouteOrTrack:  false,
  };
  resultList.innerHTML = '';
  errorList.innerHTML  = '';
  resultsSec.hidden  = true;
  errorsSec.hidden   = true;
  controlsSec.hidden = true;
}

function fmtCoord(n) { return n.toFixed(5); }

function escape(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

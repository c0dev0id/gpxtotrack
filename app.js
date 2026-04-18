import { convert, analyzeInput, GPXX_NS, TRP_NS, CTX_NS, WPTX1_NS, RUMO_NS } from './gpxtotrack.js';

const TOLERANCE_STOPS_M = [10, 20, 50, 100, 250, 500, 750, 1000];
const DEFAULT_TOLERANCE_INDEX = 4; // 250 m

// DOM elements
const upload      = document.getElementById('upload');
const fileInput   = document.getElementById('file');
const contentEl   = document.getElementById('content');
const inputBody   = document.getElementById('input-body');
const optionsBody = document.getElementById('options-body');
const outputBody  = document.getElementById('output-body');
const convertBtn  = document.getElementById('convertBtn');
const downloadBar = document.getElementById('download-bar');
const downloadBtn = document.getElementById('downloadBtn');
const errorsSec   = document.getElementById('errors');
const errorList   = document.getElementById('errorList');

// State
let sourceText = null;
let analysis   = null;
let lastResult = null;
let fileName   = null;

// ── Upload handlers ──────────────────────────

fileInput.addEventListener('change', (e) => {
  if (e.target.files.length) handleFile(e.target.files[0]);
});

['dragenter', 'dragover'].forEach(ev => upload.addEventListener(ev, (e) => {
  e.preventDefault();
  upload.classList.add('dragging');
}));
['dragleave', 'drop'].forEach(ev => upload.addEventListener(ev, (e) => {
  e.preventDefault();
  upload.classList.remove('dragging');
}));
upload.addEventListener('drop', (e) => {
  if (e.dataTransfer && e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
});

convertBtn.addEventListener('click', onConvert);
downloadBtn.addEventListener('click', onDownload);

// ── File handling ────────────────────────────

async function handleFile(file) {
  clearAll();
  fileName = file.name;

  try {
    sourceText = await file.text();
  } catch (err) {
    renderError(file.name, err);
    return;
  }

  try {
    analysis = analyzeInput(sourceText);
  } catch (err) {
    renderError(file.name, err);
    return;
  }

  renderInputColumn(analysis);
  renderOptionsColumn(analysis);
  outputBody.innerHTML = '<p class="placeholder">Click Convert to see results.</p>';

  contentEl.hidden = false;
  downloadBar.hidden = true;
  downloadBtn.disabled = true;
  lastResult = null;

  upload.classList.add('compact');
  upload.querySelector('.drop-msg').textContent = file.name;
  document.getElementById('browseLabel').textContent = 'Replace\u2026';
}

// ── Input column ─────────────────────────────

function renderInputColumn(a) {
  inputBody.innerHTML = '';
  for (const r of a.routes) {
    const block = el('div', 'section-block');
    block.dataset.routeIndex = r.index;
    block.appendChild(elText('div', r.name, 'section-title'));
    block.appendChild(elText('p', r.rteptCount + ' route points', 'section-detail'));
    if (r.hasShapingPoints) {
      block.appendChild(elText('p', r.shapingPointCount + ' shaping points', 'section-detail'));
    }
    if (r.isTrip) block.appendChild(elText('p', 'Trip route', 'section-detail'));
    if (r.isRoutePointExt) block.appendChild(elText('p', 'RoutePoint Extension format', 'section-detail'));
    if (r.extensions.length) {
      block.appendChild(elText('p', r.extensions.length + ' extension' + (r.extensions.length === 1 ? '' : 's'), 'section-detail'));
    }
    inputBody.appendChild(block);
  }
  for (const t of a.tracks) {
    const block = el('div', 'section-block');
    block.dataset.trackIndex = t.index;
    block.appendChild(elText('div', t.name, 'section-title'));
    block.appendChild(elText('p', t.trkptCount + ' track points', 'section-detail'));
    if (t.extensions.length) {
      block.appendChild(elText('p', t.extensions.length + ' extension' + (t.extensions.length === 1 ? '' : 's'), 'section-detail'));
    }
    inputBody.appendChild(block);
  }
  if (a.waypoints.count > 0) {
    const block = el('div', 'section-block');
    block.appendChild(elText('div', 'Waypoints', 'section-title'));
    block.appendChild(elText('p', a.waypoints.count + ' waypoint' + (a.waypoints.count === 1 ? '' : 's'), 'section-detail'));
    inputBody.appendChild(block);
  }
  if (a.bounds) {
    const block = el('div', 'section-block');
    block.appendChild(elText('div', 'Bounds', 'section-title'));
    block.appendChild(elText('p',
      fmtCoord(a.bounds.minLat) + ',' + fmtCoord(a.bounds.minLon) +
      ' \u2192 ' + fmtCoord(a.bounds.maxLat) + ',' + fmtCoord(a.bounds.maxLon),
      'section-detail'));
    inputBody.appendChild(block);
  }
}

// ── Options column ───────────────────────────

function renderOptionsColumn(a) {
  optionsBody.innerHTML = '';

  if (a.routes.length > 1 || a.tracks.length > 1) {
    const btn = el('button', 'sync-btn');
    btn.type = 'button';
    btn.textContent = 'Sync options from first';
    btn.addEventListener('click', syncOptionsFromFirst);
    optionsBody.appendChild(btn);
  }

  for (const r of a.routes) {
    const group = el('div', 'opt-group');
    group.dataset.routeIndex = r.index;
    group.appendChild(elText('div', r.name, 'opt-group-title'));

    const removeId = 'route-remove-' + r.index;
    const removeRow = el('div', 'opt-row remove-row');
    const removeLbl = document.createElement('label');
    const removeInp = document.createElement('input');
    removeInp.type = 'checkbox';
    removeInp.id = removeId;
    removeInp.addEventListener('change', () => applyRouteRemoved(group, removeInp.checked));
    removeLbl.appendChild(removeInp);
    removeLbl.appendChild(document.createTextNode(' Remove route'));
    removeRow.appendChild(removeLbl);
    group.appendChild(removeRow);

    if (r.hasShapingPoints) {
      // Conversion options
      group.appendChild(makeCheckbox('route-track-' + r.index, 'Create track from shaping points', true, false));
      group.appendChild(makeCheckbox('route-dense-' + r.index, 'Create dense route', true, false));
      group.appendChild(makeToleranceSlider('route-tol-' + r.index));
      group.appendChild(makeCheckbox('route-wpts-' + r.index, 'Add all route points to waypoints', false, false));
      if (r.hasViaPoints) {
        group.appendChild(makeCheckbox('route-viawpts-' + r.index, 'Add via-points to waypoints list', false, false));
      }
      group.appendChild(makeCheckbox('route-rumoshaping-' + r.index, 'Translate shaping points to Rumo format', false, false));
    }

    if (r.extensions.some(e => e.localName === 'DisplayColor' && e.ns === GPXX_NS)) {
      group.appendChild(makeCheckbox('route-rumocolor-' + r.index, 'Convert Garmin color to Rumo format', false, false));
    }

    // Extensions
    if (r.extensions.length) {
      group.appendChild(elText('div', 'Extensions', 'ext-section-label'));
      for (const ext of r.extensions) {
        group.appendChild(makeExtRow('rext-' + r.index, ext));
      }
    }

    optionsBody.appendChild(group);
  }

  for (const t of a.tracks) {
    const group = el('div', 'opt-group');
    group.dataset.trackIndex = t.index;
    group.appendChild(elText('div', t.name, 'opt-group-title'));

    group.appendChild(makeCheckbox('track-keep-' + t.index, 'Keep track', true, false));

    if (t.extensions.some(e => e.localName === 'DisplayColor' && e.ns === GPXX_NS)) {
      group.appendChild(makeCheckbox('track-rumocolor-' + t.index, 'Convert Garmin color to Rumo format', false, false));
    }

    if (t.extensions.length) {
      group.appendChild(elText('div', 'Extensions', 'ext-section-label'));
      for (const ext of t.extensions) {
        group.appendChild(makeExtRow('text-' + t.index, ext));
      }
    }

    optionsBody.appendChild(group);
  }

  if (a.waypoints.extensions.length) {
    const group = el('div', 'opt-group');
    group.appendChild(elText('div', 'Waypoint extensions', 'opt-group-title'));
    if (a.waypoints.extensions.some(e => e.localName === 'Categories' && e.ns === GPXX_NS)) {
      group.appendChild(makeCheckbox('wext-rumo-categories', 'Convert Garmin categories to Rumo waypoint tags', false, false));
    }
    for (const ext of a.waypoints.extensions) {
      group.appendChild(makeExtRow('wext', ext));
    }
    optionsBody.appendChild(group);
  }
}

// ── Gather options from DOM ──────────────────

function gatherOptions() {
  const routes = [];
  for (const r of analysis.routes) {
    if (checkboxVal('route-remove-' + r.index)) {
      routes.push({ keep: false, createTrack: false, createDenseRoute: false, addRteptsToWaypoints: false, addViaPointsToWaypoints: false });
      continue;
    }

    let createTrack = false;
    let createDenseRoute = false;
    let toleranceM = 10;
    let addRteptsToWaypoints = false;

    if (r.hasShapingPoints) {
      createTrack = checkboxVal('route-track-' + r.index);
      createDenseRoute = checkboxVal('route-dense-' + r.index);
      toleranceM = TOLERANCE_STOPS_M[parseInt(
        document.getElementById('route-tol-' + r.index)?.value || '0', 10
      )] ?? TOLERANCE_STOPS_M[DEFAULT_TOLERANCE_INDEX];
      addRteptsToWaypoints = checkboxVal('route-wpts-' + r.index);
    }

    const addViaPointsToWaypoints = checkboxVal('route-viawpts-' + r.index);

    const convertToRumoColor   = checkboxVal('route-rumocolor-' + r.index);
    const convertToRumoShaping = checkboxVal('route-rumoshaping-' + r.index);

    const extensions = {};
    for (const ext of r.extensions) {
      const key = ext.ns + '|' + ext.localName;
      const val = radioVal('rext-' + r.index + '-' + key);
      extensions[key] = val || ext.defaultAction;
    }

    routes.push({ addRteptsToWaypoints, addViaPointsToWaypoints, convertToRumoColor, convertToRumoShaping, createDenseRoute, toleranceM, createTrack, extensions });
  }

  const tracks = [];
  for (const t of analysis.tracks) {
    const keep = checkboxVal('track-keep-' + t.index);

    const extensions = {};
    for (const ext of t.extensions) {
      const key = ext.ns + '|' + ext.localName;
      const val = radioVal('text-' + t.index + '-' + key);
      extensions[key] = val || ext.defaultAction;
    }

    const convertToRumoColor = checkboxVal('track-rumocolor-' + t.index);
    tracks.push({ keep, convertToRumoColor, extensions });
  }

  const waypointExtensions = {};
  if (analysis.waypoints.extensions.length) {
    for (const ext of analysis.waypoints.extensions) {
      const key = ext.ns + '|' + ext.localName;
      const val = radioVal('wext-' + key);
      waypointExtensions[key] = val || ext.defaultAction;
    }
  }

  const convertCategoriesToRumoTags = checkboxVal('wext-rumo-categories');
  return { routes, tracks, waypointExtensions, convertCategoriesToRumoTags };
}

function applyRouteRemoved(groupEl, removed) {
  groupEl.classList.toggle('removed', removed);
  for (const inp of groupEl.querySelectorAll('input')) {
    if (!inp.closest('.remove-row')) inp.disabled = removed;
  }
}

// ── Sync options ─────────────────────────────

function syncOptionsFromFirst() {
  if (!analysis) return;

  if (analysis.routes.length > 1) {
    const first = analysis.routes[0];
    const removeVal = checkboxVal('route-remove-' + first.index);
    let trackVal, denseVal, tolVal, wptsVal, rumoShapingVal;
    if (first.hasShapingPoints) {
      trackVal       = checkboxVal('route-track-' + first.index);
      denseVal       = checkboxVal('route-dense-' + first.index);
      tolVal         = document.getElementById('route-tol-' + first.index)?.value;
      wptsVal        = checkboxVal('route-wpts-' + first.index);
      rumoShapingVal = checkboxVal('route-rumoshaping-' + first.index);
    }
    const viaWptsVal   = checkboxVal('route-viawpts-' + first.index);
    const rumoColorVal = checkboxVal('route-rumocolor-' + first.index);
    const extVals = {};
    for (const ext of first.extensions) {
      const key = ext.ns + '|' + ext.localName;
      extVals[key] = radioVal('rext-' + first.index + '-' + key);
    }

    for (let i = 1; i < analysis.routes.length; i++) {
      const r = analysis.routes[i];
      const removeId = 'route-remove-' + r.index;
      setCheckboxVal(removeId, removeVal);
      const group = optionsBody.querySelector('[data-route-index="' + r.index + '"]');
      if (group) applyRouteRemoved(group, removeVal);
      if (r.hasShapingPoints && first.hasShapingPoints) {
        setCheckboxVal('route-track-' + r.index, trackVal);
        setCheckboxVal('route-dense-' + r.index, denseVal);
        const slider = document.getElementById('route-tol-' + r.index);
        if (slider && tolVal !== undefined) {
          slider.value = tolVal;
          slider.dispatchEvent(new Event('input'));
        }
        setCheckboxVal('route-wpts-' + r.index, wptsVal);
        setCheckboxVal('route-rumoshaping-' + r.index, rumoShapingVal);
      }
      setCheckboxVal('route-viawpts-' + r.index, viaWptsVal);
      setCheckboxVal('route-rumocolor-' + r.index, rumoColorVal);
      for (const ext of r.extensions) {
        const key = ext.ns + '|' + ext.localName;
        if (extVals[key] != null) setRadioVal('rext-' + r.index + '-' + key, extVals[key]);
      }
    }
  }

  if (analysis.tracks.length > 1) {
    const first = analysis.tracks[0];
    const keepVal = checkboxVal('track-keep-' + first.index);
    const trackRumoColorVal = checkboxVal('track-rumocolor-' + first.index);
    const extVals = {};
    for (const ext of first.extensions) {
      const key = ext.ns + '|' + ext.localName;
      extVals[key] = radioVal('text-' + first.index + '-' + key);
    }

    for (let i = 1; i < analysis.tracks.length; i++) {
      const t = analysis.tracks[i];
      setCheckboxVal('track-keep-' + t.index, keepVal);
      setCheckboxVal('track-rumocolor-' + t.index, trackRumoColorVal);
      for (const ext of t.extensions) {
        const key = ext.ns + '|' + ext.localName;
        if (extVals[key] != null) setRadioVal('text-' + t.index + '-' + key, extVals[key]);
      }
    }
  }
}

function setRadioVal(name, value) {
  for (const r of document.querySelectorAll('input[name="' + name + '"]')) {
    r.checked = (r.value === value);
  }
}

function setCheckboxVal(id, checked) {
  const cb = document.getElementById(id);
  if (cb) cb.checked = checked;
}

// ── Convert ──────────────────────────────────

function onConvert() {
  if (!sourceText || !analysis) return;
  try {
    lastResult = convert(sourceText, gatherOptions());
  } catch (err) {
    renderError('Conversion', err);
    return;
  }

  // Render output column by analyzing the converted GPX
  try {
    const outputAnalysis = analyzeInput(lastResult.gpx);
    renderOutputColumn(outputAnalysis, lastResult.stats);
  } catch (err) {
    renderError('Output analysis', err);
    return;
  }

  downloadBar.hidden = false;
  downloadBtn.disabled = false;
  downloadBtn.textContent = 'Download';
  downloadBtn.classList.remove('done');
}

// ── Output column ────────────────────────────

function renderOutputColumn(a, stats) {
  outputBody.innerHTML = '';

  // Route stats
  for (const rs of stats.routes) {
    const block = el('div', 'section-block');
    block.appendChild(elText('div', rs.name, 'section-title'));
    if (rs.kept) {
      block.appendChild(elText('p', rs.inputRtepts + ' \u2192 ' + rs.outputRtepts + ' route points'
        + (rs.denseRouteCreated ? ' (densified)' : ''), 'section-detail'));
    } else {
      block.appendChild(elText('p', 'Original route removed', 'section-detail'));
    }
    if (rs.trackCreated) {
      block.appendChild(elText('p', rs.trackTrkpts + ' track points (new track)', 'section-detail'));
    }
    if (rs.rumoExtensions?.length) {
      block.appendChild(elText('p', 'Rumo: ' + rs.rumoExtensions.join(', '), 'section-detail'));
    }
    outputBody.appendChild(block);
  }

  // Track stats
  for (const ts of stats.tracks) {
    const block = el('div', 'section-block');
    block.appendChild(elText('div', ts.name, 'section-title'));
    block.appendChild(elText('p', ts.kept ? ts.trkpts + ' track points' : 'Removed', 'section-detail'));
    if (ts.rumoExtensions?.length) {
      block.appendChild(elText('p', 'Rumo: ' + ts.rumoExtensions.join(', '), 'section-detail'));
    }
    outputBody.appendChild(block);
  }

  // Output routes/tracks/wpts from analysis
  if (a.routes.length || a.tracks.length || a.waypoints.count
      || stats.rumoWaypointTagsCount || stats.viaPointsPromoted) {
    const block = el('div', 'section-block');
    block.appendChild(elText('div', 'Summary', 'section-title'));
    if (a.routes.length)
      block.appendChild(elText('p', a.routes.length + ' route' + (a.routes.length === 1 ? '' : 's'), 'section-detail'));
    if (a.tracks.length)
      block.appendChild(elText('p', a.tracks.length + ' track' + (a.tracks.length === 1 ? '' : 's'), 'section-detail'));
    if (a.waypoints.count)
      block.appendChild(elText('p', a.waypoints.count + ' waypoint' + (a.waypoints.count === 1 ? '' : 's'), 'section-detail'));
    if (stats.viaPointsPromoted) {
      const n = stats.viaPointsPromoted;
      block.appendChild(elText('p', n + ' via-point' + (n !== 1 ? 's' : '') + ' added as waypoints', 'section-detail'));
    }
    if (stats.rumoWaypointTagsCount) {
      const n = stats.rumoWaypointTagsCount;
      block.appendChild(elText('p', n + ' waypoint' + (n !== 1 ? 's' : '') + ' with Rumo tags', 'section-detail'));
    }
    if (stats.bounds)
      block.appendChild(elText('p',
        fmtCoord(stats.bounds.minLat) + ',' + fmtCoord(stats.bounds.minLon) +
        ' \u2192 ' + fmtCoord(stats.bounds.maxLat) + ',' + fmtCoord(stats.bounds.maxLon),
        'section-detail'));
    outputBody.appendChild(block);
  }
}

// ── Download ─────────────────────────────────

function onDownload() {
  if (!lastResult) return;
  const blob = new Blob([lastResult.gpx], { type: 'application/gpx+xml' });
  const url  = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = normalizedFilename(fileName);
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);

  downloadBtn.textContent = '\u2713 Downloaded';
  downloadBtn.classList.add('done');
  setTimeout(() => {
    downloadBtn.textContent = 'Download';
    downloadBtn.classList.remove('done');
  }, 2000);
}

// ── Helpers ──────────────────────────────────

function normalizedFilename(name) {
  const m = name.match(/^(.*?)(\.gpx)?$/i);
  return (m ? m[1] : name) + ' - normalized.gpx';
}

function clearAll() {
  sourceText = null;
  analysis = null;
  lastResult = null;
  fileName = null;
  inputBody.innerHTML = '';
  optionsBody.innerHTML = '';
  outputBody.innerHTML = '<p class="placeholder">Click Convert to see results.</p>';
  errorList.innerHTML = '';
  contentEl.hidden = true;
  downloadBar.hidden = true;
  downloadBtn.disabled = true;
  errorsSec.hidden = true;
}

function renderError(context, err) {
  errorsSec.hidden = false;
  const li = document.createElement('li');
  li.innerHTML = '<strong>' + esc(context) + '</strong>: ' + esc(err.message || String(err));
  errorList.appendChild(li);
}

function formatTolerance(m) {
  return m >= 1000 ? (m / 1000) + ' km' : m + ' m';
}

function fmtCoord(n) { return n.toFixed(5); }

function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function el(tag, cls) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

function elText(tag, text, cls) {
  const e = el(tag, cls);
  e.textContent = text;
  return e;
}

function radioVal(name) {
  const checked = document.querySelector('input[name="' + name + '"]:checked');
  return checked ? checked.value : null;
}

function checkboxVal(id) {
  const cb = document.getElementById(id);
  return cb ? cb.checked : false;
}

// ── Option builders ──────────────────────────

function makeRadioRow(name, options) {
  const row = el('div', 'opt-row');
  for (const o of options) {
    const lbl = document.createElement('label');
    const inp = document.createElement('input');
    inp.type = 'radio';
    inp.name = name;
    inp.value = o.value;
    if (o.checked) inp.checked = true;
    lbl.appendChild(inp);
    lbl.appendChild(document.createTextNode(' ' + o.label));
    row.appendChild(lbl);
  }
  return row;
}

function makeCheckbox(id, label, checked, indent = true) {
  const row = el('div', indent ? 'opt-row opt-indent' : 'opt-row');
  const lbl = document.createElement('label');
  const inp = document.createElement('input');
  inp.type = 'checkbox';
  inp.id = id;
  if (checked) inp.checked = true;
  lbl.appendChild(inp);
  lbl.appendChild(document.createTextNode(' ' + label));
  row.appendChild(lbl);
  return row;
}

function makeToleranceSlider(id) {
  const row = el('div', 'opt-slider-row');
  const label = document.createElement('span');
  label.className = 'opt-slider-label';
  label.textContent = 'Tolerance';

  const range = document.createElement('input');
  range.type = 'range';
  range.id = id;
  range.min = '0';
  range.max = String(TOLERANCE_STOPS_M.length - 1);
  range.step = '1';
  range.value = String(DEFAULT_TOLERANCE_INDEX);

  const output = document.createElement('span');
  output.className = 'opt-slider-label';
  output.textContent = formatTolerance(TOLERANCE_STOPS_M[DEFAULT_TOLERANCE_INDEX]);

  range.addEventListener('input', () => {
    output.textContent = formatTolerance(TOLERANCE_STOPS_M[parseInt(range.value, 10)] ?? TOLERANCE_STOPS_M[0]);
  });

  row.appendChild(label);
  row.appendChild(range);
  row.appendChild(output);
  return row;
}

function makeExtRow(prefix, ext) {
  const key = ext.ns + '|' + ext.localName;
  const name = prefix + '-' + key;

  const row = el('div', 'ext-row');
  row.appendChild(elText('span', ext.label, 'ext-label'));

  const radios = el('span', 'ext-radios');
  for (const action of ['keep', 'remove']) {
    const lbl = document.createElement('label');
    const inp = document.createElement('input');
    inp.type = 'radio';
    inp.name = name;
    inp.value = action;
    if (ext.defaultAction === action) inp.checked = true;
    lbl.appendChild(inp);
    lbl.appendChild(document.createTextNode(' ' + action.charAt(0).toUpperCase() + action.slice(1)));
    radios.appendChild(lbl);
  }

  row.appendChild(radios);
  return row;
}

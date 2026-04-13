import { convert } from './gpxtotrack.js';

const fileInput  = document.getElementById('file');
const dropZone   = document.getElementById('drop');
const tolerance  = document.getElementById('tolerance');
const toleranceOut = document.getElementById('toleranceOut');
const keepWpts   = document.getElementById('keepRteptWaypoints');
const resultsSec = document.getElementById('results');
const resultList = document.getElementById('resultList');
const errorsSec  = document.getElementById('errors');
const errorList  = document.getElementById('errorList');

tolerance.addEventListener('input', () => { toleranceOut.textContent = tolerance.value + ' m'; });

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

async function handleFiles(files) {
  clearResults();
  for (const f of files) await handleFile(f);
}

async function handleFile(file) {
  try {
    const text = await file.text();
    const opts = {
      toleranceM: parseInt(tolerance.value, 10),
      keepRteptWaypoints: keepWpts.checked,
    };
    const { gpx, stats } = convert(text, opts);
    renderSuccess(file, gpx, stats);
  } catch (err) {
    renderError(file, err);
  }
}

function renderSuccess(file, gpxString, stats) {
  resultsSec.hidden = false;
  const li = document.createElement('li');

  const blob = new Blob([gpxString], { type: 'application/gpx+xml' });
  const url  = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = trackFilename(file.name);
  a.textContent = 'Download ' + a.download;
  a.className = 'download';

  const s = document.createElement('div');
  s.className = 'stats';
  s.innerHTML =
    '<span>' + stats.routes + ' route' + (stats.routes === 1 ? '' : 's') + '</span>' +
    '<span>' + stats.inputRtepts + ' → ' + stats.outputRtepts + ' route points</span>' +
    '<span>' + stats.inputRpts + ' shaping points expanded</span>' +
    '<span>' + stats.outputTrkpts + ' track points</span>' +
    '<span>' + stats.outputWaypoints + ' waypoints</span>' +
    (stats.bounds
      ? '<span>bbox ' + fmtCoord(stats.bounds.minLat) + ',' + fmtCoord(stats.bounds.minLon)
        + ' → ' + fmtCoord(stats.bounds.maxLat) + ',' + fmtCoord(stats.bounds.maxLon) + '</span>'
      : '');

  const head = document.createElement('div');
  head.className = 'file';
  head.textContent = file.name;

  li.append(head, a, s);
  resultList.appendChild(li);
}

function renderError(file, err) {
  errorsSec.hidden = false;
  const li = document.createElement('li');
  li.innerHTML = '<strong>' + escape(file.name) + '</strong>: ' + escape(err.message || String(err));
  errorList.appendChild(li);
}

function clearResults() {
  resultList.innerHTML = '';
  errorList.innerHTML = '';
  resultsSec.hidden = true;
  errorsSec.hidden = true;
}

function trackFilename(name) {
  const m = name.match(/^(.*?)(\.gpx)?$/i);
  return (m ? m[1] : name) + '-track.gpx';
}

function fmtCoord(n) { return n.toFixed(5); }

function escape(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

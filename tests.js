// Test suite for gpxtotrack, usable from either the browser harness (test.js)
// or a Node runner (run-tests.mjs). Each test receives a ctx object with:
//   { log(name, ok, msg), convert, parse(xml) -> Document, loadFixture(name) -> Promise<string>, GPX_NS, GPXX_NS }

function qsaNS(root, ns, local) {
  return Array.from(root.getElementsByTagNameNS(ns, local));
}

function hasAnyNS(root, ns) {
  const it = root.getElementsByTagNameNS(ns, '*');
  return it.length > 0;
}

function firstChildElNS(el, ns, local) {
  if (!el) return null;
  for (let c = el.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === 1 && c.namespaceURI === ns && c.localName === local) return c;
  }
  return null;
}

export const tests = [

  async function minimal_pipeline({ log, convert, parse, loadFixture, GPX_NS }) {
    const src = await loadFixture('minimal-route.gpx');
    const { gpx, stats } = convert(src);
    const doc = parse(gpx);
    const root = doc.documentElement;
    log('minimal: root is <gpx 1.1>', root.localName === 'gpx' && root.getAttribute('version') === '1.1');
    log('minimal: one <rte> in output', qsaNS(root, GPX_NS, 'rte').length === 1);
    log('minimal: one <trk> in output', qsaNS(root, GPX_NS, 'trk').length === 1);
    const rtepts = qsaNS(root, GPX_NS, 'rtept');
    const trkpts = qsaNS(root, GPX_NS, 'trkpt');
    log('minimal: rtept count == 2', rtepts.length === 2, 'got ' + rtepts.length);
    log('minimal: trkpt count == 2', trkpts.length === 2, 'got ' + trkpts.length);
    log('minimal: stats reflect counts',
        stats.inputRtepts === 2 && stats.outputRtepts === 2 && stats.outputTrkpts === 2,
        JSON.stringify(stats));
  },

  async function basecamp_flatten({ log, convert, parse, loadFixture, GPX_NS, GPXX_NS }) {
    const src = await loadFixture('basecamp-route.gpx');
    const { gpx, stats } = convert(src);
    const doc = parse(gpx);
    const root = doc.documentElement;
    // Input: 3 rtepts + (3 + 2 + 0) rpts = 8 merged points, no consecutive duplicates expected.
    log('basecamp: 8 trkpts emitted', qsaNS(root, GPX_NS, 'trkpt').length === 8, 'got ' + qsaNS(root, GPX_NS, 'trkpt').length);
    log('basecamp: stats.inputRpts == 5', stats.inputRpts === 5, 'got ' + stats.inputRpts);
    log('basecamp: no gpxx:RoutePointExtension in output', qsaNS(root, GPXX_NS, 'RoutePointExtension').length === 0);
    // Original named rtepts Start/Turn/End must be preserved as rtepts.
    const rtepts = qsaNS(root, GPX_NS, 'rtept');
    const names = rtepts.map((r) => firstChildElNS(r, GPX_NS, 'name')?.textContent).filter(Boolean);
    log('basecamp: named rtepts Start/Turn/End preserved',
        names.includes('Start') && names.includes('Turn') && names.includes('End'),
        'names=' + JSON.stringify(names));
    // Sym preserved on Start.
    const startRte = rtepts.find((r) => firstChildElNS(r, GPX_NS, 'name')?.textContent === 'Start');
    log('basecamp: <sym> preserved on Start',
        firstChildElNS(startRte, GPX_NS, 'sym')?.textContent === 'Flag, Blue');
    // No gpxtpx namespace in output.
    log('basecamp: no gpxtpx anywhere',
        !hasAnyNS(root, 'http://www.garmin.com/xmlschemas/TrackPointExtension/v1'));
  },

  async function colored_passthrough({ log, convert, parse, loadFixture, GPX_NS, GPXX_NS }) {
    const src = await loadFixture('colored-route.gpx');
    const { gpx } = convert(src);
    const doc = parse(gpx);
    const root = doc.documentElement;
    const rte = qsaNS(root, GPX_NS, 'rte')[0];
    const trk = qsaNS(root, GPX_NS, 'trk')[0];
    const routeColor = qsaNS(rte, GPXX_NS, 'DisplayColor')[0];
    const trackColor = qsaNS(trk, GPXX_NS, 'DisplayColor')[0];
    log('colored: route has DisplayColor', routeColor && routeColor.textContent === 'DarkRed');
    log('colored: track has DisplayColor', trackColor && trackColor.textContent === 'DarkRed');
    // IsAutoNamed dropped.
    log('colored: IsAutoNamed dropped', qsaNS(root, GPXX_NS, 'IsAutoNamed').length === 0);
    // Only xmlns and xmlns:gpxx declared on root.
    const declared = Array.from(root.attributes).map((a) => a.name).filter((n) => n === 'xmlns' || n.startsWith('xmlns:'));
    log('colored: only xmlns + xmlns:gpxx declared',
        declared.length === 2 && declared.includes('xmlns') && declared.includes('xmlns:gpxx'),
        'got ' + declared.join(', '));
  },

  async function waypoints_cleaned({ log, convert, parse, loadFixture, GPX_NS, GPXX_NS }) {
    const src = await loadFixture('route-with-waypoints.gpx');
    const { gpx, stats } = convert(src);
    const doc = parse(gpx);
    const root = doc.documentElement;
    const wpts = qsaNS(root, GPX_NS, 'wpt');
    log('route-with-waypoints: 1 wpt preserved (toggle off)', wpts.length === 1, 'got ' + wpts.length);
    // Core fields preserved.
    log('route-with-waypoints: wpt core <name> preserved',
        firstChildElNS(wpts[0], GPX_NS, 'name')?.textContent === 'Coffee stop');
    log('route-with-waypoints: wpt <sym> preserved',
        firstChildElNS(wpts[0], GPX_NS, 'sym')?.textContent === 'Restaurant');
    log('route-with-waypoints: wpt <time> preserved',
        firstChildElNS(wpts[0], GPX_NS, 'time')?.textContent === '2024-06-01T12:00:00Z');
    // Garmin wpt extension stripped.
    log('route-with-waypoints: no gpxx:WaypointExtension in output',
        qsaNS(root, GPXX_NS, 'WaypointExtension').length === 0);
    log('route-with-waypoints: no gpxx:Proximity in output',
        qsaNS(root, GPXX_NS, 'Proximity').length === 0);
    log('route-with-waypoints: stats.outputWaypoints == 1', stats.outputWaypoints === 1, 'got ' + stats.outputWaypoints);
  },

  async function waypoints_toggle_on({ log, convert, parse, loadFixture, GPX_NS }) {
    const src = await loadFixture('route-with-waypoints.gpx');
    const { gpx, stats } = convert(src, { keepRteptWaypoints: true });
    const doc = parse(gpx);
    const root = doc.documentElement;
    const wpts = qsaNS(root, GPX_NS, 'wpt');
    // 1 original + 2 labeled rtepts (Start and End have names; middle rtept has none).
    log('toggle-on: 3 wpts (1 original + 2 from named rtepts)', wpts.length === 3, 'got ' + wpts.length);
    const names = wpts.map((w) => firstChildElNS(w, GPX_NS, 'name')?.textContent);
    log('toggle-on: includes Start and End wpts',
        names.includes('Start') && names.includes('End'),
        'names=' + JSON.stringify(names));
    log('toggle-on: stats.outputWaypoints == 3', stats.outputWaypoints === 3, 'got ' + stats.outputWaypoints);
  },

  async function mixed_preserves_existing_trk_strips_ext({ log, convert, parse, loadFixture, GPX_NS }) {
    const src = await loadFixture('mixed.gpx');
    const { gpx } = convert(src);
    const doc = parse(gpx);
    const root = doc.documentElement;
    // When the input already has a <trk>, no synthesis: only the pre-existing track is kept.
    const trks = qsaNS(root, GPX_NS, 'trk');
    log('mixed: 1 <trk> in output (existing only, no synthesis)', trks.length === 1, 'got ' + trks.length);
    // Pre-existing trkpt survives.
    const preTrk = trks.find((t) => firstChildElNS(t, GPX_NS, 'name')?.textContent === 'Pre-existing track');
    log('mixed: pre-existing track is kept by name', !!preTrk);
    // gpxtpx scrubbed everywhere.
    log('mixed: no gpxtpx elements',
        !hasAnyNS(root, 'http://www.garmin.com/xmlschemas/TrackPointExtension/v1'));
    // xmlns:gpxtpx declaration scrubbed.
    log('mixed: xmlns:gpxtpx removed from root',
        !root.hasAttribute('xmlns:gpxtpx'));
    // <time> on pre-existing trkpt preserved.
    const preTrkpts = qsaNS(preTrk, GPX_NS, 'trkpt');
    log('mixed: <time> on pre-existing trkpt preserved',
        firstChildElNS(preTrkpts[0], GPX_NS, 'time')?.textContent === '2024-06-01T10:00:00Z');
  },

  async function schema_order_is_canonical({ log, convert, parse, loadFixture, GPX_NS }) {
    const src = await loadFixture('route-with-waypoints.gpx');
    const { gpx } = convert(src, { keepRteptWaypoints: true });
    const doc = parse(gpx);
    const root = doc.documentElement;
    const order = [];
    for (let c = root.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 1 && c.namespaceURI === GPX_NS) order.push(c.localName);
    }
    // Drop repetitions for comparison.
    const pattern = /^(metadata)?(wpt)*(rte)*(trk)*(extensions)?$/;
    const squashed = order.join(',').replace(/(wpt,)+/g, 'wpt,').replace(/(rte,)+/g, 'rte,').replace(/(trk,)+/g, 'trk,');
    const flat = squashed.split(',').filter(Boolean).join('');
    log('schema order canonical', pattern.test(flat), 'got [' + order.join(', ') + ']');
  },

  async function rte_density_respects_tolerance({ log, convert, parse, loadFixture, GPX_NS }) {
    const src = await loadFixture('basecamp-route.gpx');
    const tight = convert(src, { toleranceM: 1 });
    const loose = convert(src, { toleranceM: 1000 });
    const tightCount = qsaNS(parse(tight.gpx).documentElement, GPX_NS, 'rtept').length;
    const looseCount = qsaNS(parse(loose.gpx).documentElement, GPX_NS, 'rtept').length;
    log('RDP: tighter tolerance keeps at least as many rtepts',
        tightCount >= looseCount,
        'tight=' + tightCount + ' loose=' + looseCount);
    log('RDP: loose tolerance keeps all named rtepts (3)',
        looseCount >= 3,
        'got ' + looseCount);
  },

  async function rejects_non_gpx({ log, convert }) {
    let threw = false;
    try { convert('<notgpx/>'); } catch (e) { threw = true; }
    log('rejects non-<gpx> root', threw);
  },

  async function empty_gpx_succeeds({ log, convert }) {
    // A file with no routes, tracks, or waypoints should succeed (pass-through path).
    let threw = false, result = null;
    try {
      result = convert('<?xml version="1.0"?><gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="x"/>');
    } catch (e) { threw = true; }
    log('empty gpx succeeds without throwing', !threw && result !== null);
  },

  async function summarizeInput_basecamp({ log, summarizeInput, loadFixture }) {
    const src = await loadFixture('basecamp-route.gpx');
    const s = summarizeInput(src);
    log('summarizeInput basecamp: 1 route',       s.routes === 1,    'got ' + s.routes);
    log('summarizeInput basecamp: 3 rtepts',      s.rtepts === 3,    'got ' + s.rtepts);
    log('summarizeInput basecamp: 5 rpts',        s.rpts === 5,      'got ' + s.rpts);
    log('summarizeInput basecamp: 0 waypoints',   s.waypoints === 0, 'got ' + s.waypoints);
    log('summarizeInput basecamp: 0 tracks',      s.tracks === 0,    'got ' + s.tracks);
    log('summarizeInput basecamp: bounds present', !!s.bounds);
  },

  async function summarizeInput_mixed_counts_existing_tracks({ log, summarizeInput, loadFixture }) {
    const src = await loadFixture('mixed.gpx');
    const s = summarizeInput(src);
    log('summarizeInput mixed: 1 route',          s.routes === 1,   'got ' + s.routes);
    log('summarizeInput mixed: 1 existing track', s.tracks === 1,   'got ' + s.tracks);
    log('summarizeInput mixed: trkpts > 0',       s.trkpts > 0,     'got ' + s.trkpts);
  },

  async function summarizeInput_rejects_non_gpx({ log, summarizeInput }) {
    let threw = false;
    try { summarizeInput('<notgpx/>'); } catch (e) { threw = true; }
    log('summarizeInput rejects non-<gpx> root', threw);
  },

  // ---- New tests for extension-aware conversion ----

  async function routing_meta_removed_by_default({ log, convert, parse, loadFixture }) {
    const src = await loadFixture('routing-meta.gpx');
    const { gpx } = convert(src);
    const doc = parse(gpx);
    const TRP_NS = 'http://www.garmin.com/xmlschemas/TripExtensions/v1';
    const trpEls = doc.documentElement.getElementsByTagNameNS(TRP_NS, '*');
    log('routing-meta: trp: elements absent by default', trpEls.length === 0, 'got ' + trpEls.length);
  },

  async function routing_meta_kept({ log, convert, parse, loadFixture }) {
    const src = await loadFixture('routing-meta.gpx');
    const { gpx } = convert(src, { routingMeta: 'keep' });
    const doc = parse(gpx);
    const TRP_NS = 'http://www.garmin.com/xmlschemas/TripExtensions/v1';
    const trpEls = doc.documentElement.getElementsByTagNameNS(TRP_NS, '*');
    log('routing-meta: trp: elements survive with routingMeta=keep', trpEls.length > 0, 'got ' + trpEls.length);
  },

  async function display_color_removed({ log, convert, parse, loadFixture, GPX_NS, GPXX_NS }) {
    const src = await loadFixture('colored-route.gpx');
    const { gpx } = convert(src, { displayColor: 'remove' });
    const doc = parse(gpx);
    const root = doc.documentElement;
    const dc = root.getElementsByTagNameNS(GPXX_NS, 'DisplayColor');
    log('display-color-removed: no DisplayColor in output', dc.length === 0, 'got ' + dc.length);
    log('display-color-removed: no xmlns:gpxx declared', !root.hasAttribute('xmlns:gpxx'));
  },

  async function track_only_passthrough({ log, convert, parse, loadFixture, GPX_NS }) {
    const src = await loadFixture('track-only.gpx');
    let result = null, threw = false;
    try { result = convert(src); } catch (e) { threw = true; }
    log('track-only: no error thrown', !threw);
    if (threw) return;
    const doc = parse(result.gpx);
    const root = doc.documentElement;
    log('track-only: 1 trk preserved', root.getElementsByTagNameNS(GPX_NS, 'trk').length === 1,
        'got ' + root.getElementsByTagNameNS(GPX_NS, 'trk').length);
    log('track-only: 2 trkpts preserved', root.getElementsByTagNameNS(GPX_NS, 'trkpt').length === 2,
        'got ' + root.getElementsByTagNameNS(GPX_NS, 'trkpt').length);
    log('track-only: gpxtpx elements stripped',
        !hasAnyNS(root, 'http://www.garmin.com/xmlschemas/TrackPointExtension/v1'));
    log('track-only: stats.outputTrkpts == 2', result.stats.outputTrkpts === 2, 'got ' + result.stats.outputTrkpts);
    log('track-only: stats.routes == 0', result.stats.routes === 0, 'got ' + result.stats.routes);
  },

  async function no_synthesis_when_track_exists({ log, convert, parse, loadFixture, GPX_NS }) {
    const src = await loadFixture('mixed.gpx');
    const { gpx, stats } = convert(src);
    const doc = parse(gpx);
    const root = doc.documentElement;
    log('no-synthesis: 1 trk (existing), not 2',
        root.getElementsByTagNameNS(GPX_NS, 'trk').length === 1,
        'got ' + root.getElementsByTagNameNS(GPX_NS, 'trk').length);
    log('no-synthesis: stats.routes == 1', stats.routes === 1, 'got ' + stats.routes);
    log('no-synthesis: stats.outputTrkpts from existing track', stats.outputTrkpts === 2, 'got ' + stats.outputTrkpts);
  },

  async function wpt_address_auto_converted({ log, convert, parse, loadFixture, GPX_NS }) {
    const src = await loadFixture('route-with-waypoints.gpx');
    const { gpx } = convert(src);
    const doc = parse(gpx);
    const root = doc.documentElement;
    const wpts = root.getElementsByTagNameNS(GPX_NS, 'wpt');
    const wpt  = wpts[0];
    const desc = wpt ? firstChildElNS(wpt, GPX_NS, 'desc') : null;
    log('wpt-address: <desc> auto-filled from gpxx:Address',
        !!(desc && desc.textContent.includes('Main St 1')),
        'desc=' + (desc ? desc.textContent : 'null'));
  },

  async function summarizeInput_features({ log, summarizeInput, loadFixture }) {
    const s1 = summarizeInput(await loadFixture('routing-meta.gpx'));
    log('features routing-meta: hasRoutingMeta',    s1.features.hasRoutingMeta    === true);
    log('features routing-meta: !hasDisplayColor',  s1.features.hasDisplayColor   === false);
    log('features routing-meta: !hasThirdPartyExt', s1.features.hasThirdPartyExt  === false);

    const s2 = summarizeInput(await loadFixture('colored-route.gpx'));
    log('features colored: hasDisplayColor', s2.features.hasDisplayColor === true);

    const s3 = summarizeInput(await loadFixture('third-party-ext.gpx'));
    log('features third-party: hasThirdPartyExt', s3.features.hasThirdPartyExt === true);

    const s4 = summarizeInput(await loadFixture('track-only.gpx'));
    log('features track-only: routeOnly',        s4.features.routeOnly        === true);
    log('features track-only: hasExistingTrack', s4.features.hasExistingTrack === true);
  },

  async function third_party_ext_removed_by_default({ log, convert, parse, loadFixture }) {
    const src = await loadFixture('third-party-ext.gpx');
    const { gpx } = convert(src);
    const doc = parse(gpx);
    const RUMO_NS = 'https://www.rumoadventures.com/xmlschemas/GpxExtensions/v1';
    const rumoEls = doc.documentElement.getElementsByTagNameNS(RUMO_NS, '*');
    log('third-party: rumo: elements absent by default', rumoEls.length === 0, 'got ' + rumoEls.length);
    log('third-party: xmlns:rumo removed', !doc.documentElement.hasAttribute('xmlns:rumo'));
  },

  async function third_party_ext_kept({ log, convert, parse, loadFixture }) {
    const src = await loadFixture('third-party-ext.gpx');
    const { gpx } = convert(src, { thirdPartyExt: 'keep' });
    const doc = parse(gpx);
    const RUMO_NS = 'https://www.rumoadventures.com/xmlschemas/GpxExtensions/v1';
    const rumoEls = doc.documentElement.getElementsByTagNameNS(RUMO_NS, '*');
    log('third-party: rumo: elements survive with thirdPartyExt=keep', rumoEls.length > 0, 'got ' + rumoEls.length);
  },

];

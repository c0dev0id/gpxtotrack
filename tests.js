// Test suite for gpxtotrack, usable from either the browser harness (test.js)
// or a Node runner (run-tests.mjs). Each test receives a ctx object with:
//   { log, convert, analyzeInput, summarizeInput, parse, loadFixture, GPX_NS, GPXX_NS, TRP_NS, WPTX1_NS, CTX_NS }

function qsaNS(root, ns, local) {
  return Array.from(root.getElementsByTagNameNS(ns, local));
}

function hasAnyNS(root, ns) {
  return root.getElementsByTagNameNS(ns, '*').length > 0;
}

function firstChildElNS(el, ns, local) {
  if (!el) return null;
  for (let c = el.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === 1 && c.namespaceURI === ns && c.localName === local) return c;
  }
  return null;
}

export const tests = [

  // ================================================================
  // analyzeInput tests
  // ================================================================

  async function analyzeInput_basecamp({ log, analyzeInput, loadFixture, GPXX_NS }) {
    const src = await loadFixture('basecamp-route.gpx');
    const a = analyzeInput(src);
    log('analyzeInput basecamp: 1 route', a.routes.length === 1, 'got ' + a.routes.length);
    log('analyzeInput basecamp: 3 rtepts', a.routes[0].rteptCount === 3, 'got ' + a.routes[0].rteptCount);
    log('analyzeInput basecamp: 5 shaping points', a.routes[0].shapingPointCount === 5, 'got ' + a.routes[0].shapingPointCount);
    const extNames = a.routes[0].extensions.map(e => e.localName);
    log('analyzeInput basecamp: has RoutePointExtension ext',
        extNames.includes('RoutePointExtension'), 'got ' + JSON.stringify(extNames));
    // Subclass is inside RPE, not separately enumerable — removing RPE removes Subclass too.
    // RPE defaults to remove
    const rpe = a.routes[0].extensions.find(e => e.localName === 'RoutePointExtension');
    log('analyzeInput basecamp: RPE defaults to remove',
        rpe && rpe.defaultAction === 'remove', rpe ? rpe.defaultAction : 'not found');
  },

  async function analyzeInput_colored({ log, analyzeInput, loadFixture, GPXX_NS }) {
    const src = await loadFixture('colored-route.gpx');
    const a = analyzeInput(src);
    const extNames = a.routes[0].extensions.map(e => e.localName);
    log('analyzeInput colored: has DisplayColor', extNames.includes('DisplayColor'),
        'got ' + JSON.stringify(extNames));
    log('analyzeInput colored: has IsAutoNamed', extNames.includes('IsAutoNamed'),
        'got ' + JSON.stringify(extNames));
    const dc = a.routes[0].extensions.find(e => e.localName === 'DisplayColor');
    log('analyzeInput colored: DisplayColor defaults to keep',
        dc && dc.defaultAction === 'keep', dc ? dc.defaultAction : 'not found');
    const ian = a.routes[0].extensions.find(e => e.localName === 'IsAutoNamed');
    log('analyzeInput colored: IsAutoNamed defaults to remove',
        ian && ian.defaultAction === 'remove', ian ? ian.defaultAction : 'not found');
  },

  async function analyzeInput_routing_meta({ log, analyzeInput, loadFixture, TRP_NS }) {
    const src = await loadFixture('routing-meta.gpx');
    const a = analyzeInput(src);
    log('analyzeInput routing-meta: isTrip', a.routes[0].isTrip === true);
    const extNames = a.routes[0].extensions.map(e => e.localName);
    log('analyzeInput routing-meta: has ViaPoint', extNames.includes('ViaPoint'),
        'got ' + JSON.stringify(extNames));
    log('analyzeInput routing-meta: has ShapingPoint', extNames.includes('ShapingPoint'),
        'got ' + JSON.stringify(extNames));
    // TRP extensions default to keep
    const vp = a.routes[0].extensions.find(e => e.localName === 'ViaPoint');
    log('analyzeInput routing-meta: ViaPoint defaults to keep',
        vp && vp.defaultAction === 'keep', vp ? vp.defaultAction : 'not found');
  },

  async function analyzeInput_duplicate_routes({ log, analyzeInput, loadFixture }) {
    const src = await loadFixture('duplicate-routes.gpx');
    const a = analyzeInput(src);
    log('analyzeInput duplicate-routes: 3 routes (no auto-dedup)',
        a.routes.length === 3, 'got ' + a.routes.length);
    // Check isTrip/isRoutePointExt flags
    const plain = a.routes[0];
    const trip = a.routes[1];
    const rpe = a.routes[2];
    log('analyzeInput duplicate-routes: plain is not isTrip', !plain.isTrip);
    log('analyzeInput duplicate-routes: plain is not isRoutePointExt', !plain.isRoutePointExt);
    log('analyzeInput duplicate-routes: trip isTrip', trip.isTrip === true);
    log('analyzeInput duplicate-routes: rpe isRoutePointExt', rpe.isRoutePointExt === true);
  },

  async function analyzeInput_track_only({ log, analyzeInput, loadFixture }) {
    const src = await loadFixture('track-only.gpx');
    const a = analyzeInput(src);
    log('analyzeInput track-only: 0 routes', a.routes.length === 0);
    log('analyzeInput track-only: 1 track', a.tracks.length === 1, 'got ' + a.tracks.length);
    log('analyzeInput track-only: 2 trkpts', a.tracks[0].trkptCount === 2, 'got ' + a.tracks[0].trkptCount);
    // Track has TrackPointExtension
    const extNames = a.tracks[0].extensions.map(e => e.localName);
    log('analyzeInput track-only: has TrackPointExtension',
        extNames.includes('TrackPointExtension'),
        'got ' + JSON.stringify(extNames));
  },

  async function analyzeInput_waypoints({ log, analyzeInput, loadFixture }) {
    const src = await loadFixture('route-with-waypoints.gpx');
    const a = analyzeInput(src);
    log('analyzeInput waypoints: 1 wpt', a.waypoints.count === 1, 'got ' + a.waypoints.count);
    const extNames = a.waypoints.extensions.map(e => e.localName);
    log('analyzeInput waypoints: has wpt extensions',
        extNames.length > 0, 'got ' + JSON.stringify(extNames));
  },

  // ================================================================
  // convert tests (new per-route/track API)
  // ================================================================

  async function minimal_pipeline({ log, convert, parse, loadFixture, GPX_NS }) {
    const src = await loadFixture('minimal-route.gpx');
    const { gpx, stats } = convert(src, {
      routes: [{ keep: true, createTrack: true, createDenseRoute: true, toleranceM: 10 }],
    });
    const doc = parse(gpx);
    const root = doc.documentElement;
    log('minimal: root is <gpx 1.1>', root.localName === 'gpx' && root.getAttribute('version') === '1.1');
    log('minimal: one <rte> in output', qsaNS(root, GPX_NS, 'rte').length === 1);
    log('minimal: one <trk> in output', qsaNS(root, GPX_NS, 'trk').length === 1);
    const rtepts = qsaNS(root, GPX_NS, 'rtept');
    const trkpts = qsaNS(root, GPX_NS, 'trkpt');
    log('minimal: rtept count == 2', rtepts.length === 2, 'got ' + rtepts.length);
    log('minimal: trkpt count == 2', trkpts.length === 2, 'got ' + trkpts.length);
    log('minimal: stats.routes[0] reflects counts',
        stats.routes[0].inputRtepts === 2 && stats.routes[0].outputRtepts === 2 && stats.routes[0].trackTrkpts === 2,
        JSON.stringify(stats.routes[0]));
  },

  async function basecamp_flatten({ log, convert, parse, loadFixture, GPX_NS, GPXX_NS }) {
    const src = await loadFixture('basecamp-route.gpx');
    const { gpx, stats } = convert(src, {
      routes: [{
        keep: true, createTrack: true, createDenseRoute: true, toleranceM: 10,
        extensions: {
          [GPXX_NS + '|RoutePointExtension']: 'remove',
          [GPXX_NS + '|Subclass']: 'remove',
        },
      }],
    });
    const doc = parse(gpx);
    const root = doc.documentElement;
    // Input: 3 rtepts + (3 + 2 + 0) rpts = 8 merged points
    log('basecamp: 8 trkpts emitted',
        qsaNS(root, GPX_NS, 'trkpt').length === 8,
        'got ' + qsaNS(root, GPX_NS, 'trkpt').length);
    log('basecamp: no gpxx:RoutePointExtension in output',
        qsaNS(root, GPXX_NS, 'RoutePointExtension').length === 0);
    // Named rtepts preserved
    const rtepts = qsaNS(root, GPX_NS, 'rtept');
    const names = rtepts.map(r => firstChildElNS(r, GPX_NS, 'name')?.textContent).filter(Boolean);
    log('basecamp: named rtepts Start/Turn/End preserved',
        names.includes('Start') && names.includes('Turn') && names.includes('End'),
        'names=' + JSON.stringify(names));
    // Sym preserved on Start
    const startRte = rtepts.find(r => firstChildElNS(r, GPX_NS, 'name')?.textContent === 'Start');
    log('basecamp: <sym> preserved on Start',
        firstChildElNS(startRte, GPX_NS, 'sym')?.textContent === 'Flag, Blue');
  },

  async function colored_passthrough({ log, convert, parse, loadFixture, GPX_NS, GPXX_NS }) {
    const src = await loadFixture('colored-route.gpx');
    const { gpx } = convert(src, {
      routes: [{
        keep: true, createTrack: true, createDenseRoute: true, toleranceM: 10,
        extensions: {
          [GPXX_NS + '|DisplayColor']: 'keep',
          [GPXX_NS + '|IsAutoNamed']: 'remove',
          [GPXX_NS + '|RoutePointExtension']: 'remove',
        },
      }],
    });
    const doc = parse(gpx);
    const root = doc.documentElement;
    const rte = qsaNS(root, GPX_NS, 'rte')[0];
    const trk = qsaNS(root, GPX_NS, 'trk')[0];
    const routeColor = qsaNS(rte, GPXX_NS, 'DisplayColor')[0];
    const trackColor = qsaNS(trk, GPXX_NS, 'DisplayColor')[0];
    log('colored: route has DisplayColor', routeColor && routeColor.textContent === 'DarkRed');
    log('colored: track has DisplayColor', trackColor && trackColor.textContent === 'DarkRed');
    log('colored: IsAutoNamed dropped', qsaNS(root, GPXX_NS, 'IsAutoNamed').length === 0);
  },

  async function display_color_removed({ log, convert, parse, loadFixture, GPX_NS, GPXX_NS }) {
    const src = await loadFixture('colored-route.gpx');
    const { gpx } = convert(src, {
      routes: [{
        keep: true, createTrack: true, createDenseRoute: true, toleranceM: 10,
        extensions: {
          [GPXX_NS + '|DisplayColor']: 'remove',
          [GPXX_NS + '|IsAutoNamed']: 'remove',
          [GPXX_NS + '|RoutePointExtension']: 'remove',
        },
      }],
    });
    const doc = parse(gpx);
    const root = doc.documentElement;
    const dc = root.getElementsByTagNameNS(GPXX_NS, 'DisplayColor');
    log('display-color-removed: no DisplayColor', dc.length === 0, 'got ' + dc.length);
    log('display-color-removed: no xmlns:gpxx', !root.hasAttribute('xmlns:gpxx'));
  },

  async function route_keep_verbatim({ log, convert, parse, loadFixture, GPX_NS }) {
    const src = await loadFixture('minimal-route.gpx');
    const { gpx } = convert(src, {
      routes: [{ keep: true, createDenseRoute: false, createTrack: false }],
    });
    const doc = parse(gpx);
    const root = doc.documentElement;
    const rtes = qsaNS(root, GPX_NS, 'rte');
    log('verbatim: 1 rte', rtes.length === 1);
    log('verbatim: 0 trk', qsaNS(root, GPX_NS, 'trk').length === 0);
    const rtepts = qsaNS(root, GPX_NS, 'rtept');
    log('verbatim: 2 rtepts (original)', rtepts.length === 2, 'got ' + rtepts.length);
  },

  async function route_remove_with_track({ log, convert, parse, loadFixture, GPX_NS }) {
    const src = await loadFixture('minimal-route.gpx');
    const { gpx } = convert(src, {
      routes: [{ keep: false, createTrack: true, createDenseRoute: false }],
    });
    const doc = parse(gpx);
    const root = doc.documentElement;
    log('remove+track: 0 rte', qsaNS(root, GPX_NS, 'rte').length === 0);
    log('remove+track: 1 trk', qsaNS(root, GPX_NS, 'trk').length === 1);
  },

  async function route_remove_no_options({ log, convert, parse, loadFixture, GPX_NS }) {
    const src = await loadFixture('minimal-route.gpx');
    const { gpx } = convert(src, {
      routes: [{ keep: false, createTrack: false, addRteptsToWaypoints: false }],
    });
    const doc = parse(gpx);
    const root = doc.documentElement;
    log('remove-all: 0 rte', qsaNS(root, GPX_NS, 'rte').length === 0);
    log('remove-all: 0 trk', qsaNS(root, GPX_NS, 'trk').length === 0);
  },

  async function waypoints_cleaned({ log, convert, parse, loadFixture, GPX_NS, GPXX_NS }) {
    const src = await loadFixture('route-with-waypoints.gpx');
    const { gpx, stats } = convert(src, {
      routes: [{ keep: true, createTrack: true, createDenseRoute: true, toleranceM: 10,
        extensions: { [GPXX_NS + '|RoutePointExtension']: 'remove' },
      }],
      waypointExtensions: {
        [GPXX_NS + '|WaypointExtension']: 'remove',
      },
    });
    const doc = parse(gpx);
    const root = doc.documentElement;
    const wpts = qsaNS(root, GPX_NS, 'wpt');
    log('waypoints-cleaned: 1 wpt preserved', wpts.length === 1, 'got ' + wpts.length);
    log('waypoints-cleaned: wpt core <name> preserved',
        firstChildElNS(wpts[0], GPX_NS, 'name')?.textContent === 'Coffee stop');
    log('waypoints-cleaned: wpt <sym> preserved',
        firstChildElNS(wpts[0], GPX_NS, 'sym')?.textContent === 'Restaurant');
    // Garmin wpt extension stripped
    log('waypoints-cleaned: no gpxx:WaypointExtension in output',
        qsaNS(root, GPXX_NS, 'WaypointExtension').length === 0);
    // Auto-conversion still fills desc
    const desc = firstChildElNS(wpts[0], GPX_NS, 'desc');
    log('waypoints-cleaned: desc auto-filled from address',
        !!(desc && desc.textContent.includes('Main St 1')),
        'desc=' + (desc ? desc.textContent : 'null'));
    log('waypoints-cleaned: stats.outputWaypoints == 1',
        stats.outputWaypoints === 1, 'got ' + stats.outputWaypoints);
  },

  async function waypoints_toggle_on({ log, convert, parse, loadFixture, GPX_NS, GPXX_NS }) {
    const src = await loadFixture('route-with-waypoints.gpx');
    const { gpx, stats } = convert(src, {
      routes: [{
        keep: true, createTrack: true, createDenseRoute: true, toleranceM: 10,
        addRteptsToWaypoints: true,
        extensions: { [GPXX_NS + '|RoutePointExtension']: 'remove' },
      }],
      waypointExtensions: { [GPXX_NS + '|WaypointExtension']: 'remove' },
    });
    const doc = parse(gpx);
    const root = doc.documentElement;
    const wpts = qsaNS(root, GPX_NS, 'wpt');
    // 1 original + 2 labeled rtepts (Start and End have names)
    log('toggle-on: 3 wpts', wpts.length === 3, 'got ' + wpts.length);
    const names = wpts.map(w => firstChildElNS(w, GPX_NS, 'name')?.textContent);
    log('toggle-on: includes Start and End',
        names.includes('Start') && names.includes('End'),
        'names=' + JSON.stringify(names));
    log('toggle-on: stats.outputWaypoints == 3',
        stats.outputWaypoints === 3, 'got ' + stats.outputWaypoints);
  },

  async function routing_meta_kept({ log, convert, parse, loadFixture, GPXX_NS }) {
    const src = await loadFixture('routing-meta.gpx');
    const TRP_NS = 'http://www.garmin.com/xmlschemas/TripExtensions/v1';
    const { gpx } = convert(src, {
      routes: [{
        keep: true, createTrack: true, createDenseRoute: true, toleranceM: 10,
        extensions: {
          [TRP_NS + '|Trip']: 'keep',
          [TRP_NS + '|ViaPoint']: 'keep',
          [TRP_NS + '|ShapingPoint']: 'keep',
          [GPXX_NS + '|RoutePointExtension']: 'remove',
          [GPXX_NS + '|Subclass']: 'remove',
        },
      }],
    });
    const doc = parse(gpx);
    const trpEls = doc.documentElement.getElementsByTagNameNS(TRP_NS, '*');
    log('routing-meta-kept: trp: elements survive', trpEls.length > 0, 'got ' + trpEls.length);
  },

  async function routing_meta_removed({ log, convert, parse, loadFixture, GPXX_NS }) {
    const src = await loadFixture('routing-meta.gpx');
    const TRP_NS = 'http://www.garmin.com/xmlschemas/TripExtensions/v1';
    const { gpx } = convert(src, {
      routes: [{
        keep: true, createTrack: true, createDenseRoute: true, toleranceM: 10,
        extensions: {
          [TRP_NS + '|Trip']: 'remove',
          [TRP_NS + '|ViaPoint']: 'remove',
          [TRP_NS + '|ShapingPoint']: 'remove',
          [GPXX_NS + '|RoutePointExtension']: 'remove',
          [GPXX_NS + '|Subclass']: 'remove',
        },
      }],
    });
    const doc = parse(gpx);
    const trpEls = doc.documentElement.getElementsByTagNameNS(TRP_NS, '*');
    log('routing-meta-removed: trp: elements absent', trpEls.length === 0, 'got ' + trpEls.length);
  },

  async function third_party_kept({ log, convert, parse, loadFixture }) {
    const src = await loadFixture('third-party-ext.gpx');
    const RUMO_NS = 'https://www.rumoadventures.com/xmlschemas/GpxExtensions/v1';
    const { gpx } = convert(src, {
      routes: [{
        keep: true, createTrack: true, createDenseRoute: true, toleranceM: 10,
        extensions: {}, // defaults: unknown → keep
      }],
    });
    const doc = parse(gpx);
    const rumoEls = doc.documentElement.getElementsByTagNameNS(RUMO_NS, '*');
    log('third-party-kept: rumo: elements survive', rumoEls.length > 0, 'got ' + rumoEls.length);
  },

  async function third_party_removed({ log, convert, parse, loadFixture }) {
    const src = await loadFixture('third-party-ext.gpx');
    const RUMO_NS = 'https://www.rumoadventures.com/xmlschemas/GpxExtensions/v1';
    const { gpx } = convert(src, {
      routes: [{
        keep: true, createTrack: true, createDenseRoute: true, toleranceM: 10,
        extensions: { [RUMO_NS + '|RouteExtension']: 'remove' },
      }],
    });
    const doc = parse(gpx);
    const rumoEls = doc.documentElement.getElementsByTagNameNS(RUMO_NS, '*');
    log('third-party-removed: rumo: elements absent', rumoEls.length === 0, 'got ' + rumoEls.length);
    log('third-party-removed: xmlns:rumo removed',
        !doc.documentElement.hasAttribute('xmlns:rumo'));
  },

  async function track_keep({ log, convert, parse, loadFixture, GPX_NS }) {
    const src = await loadFixture('track-only.gpx');
    const { gpx, stats } = convert(src, {
      tracks: [{ keep: true }],
    });
    const doc = parse(gpx);
    const root = doc.documentElement;
    log('track-keep: 1 trk', qsaNS(root, GPX_NS, 'trk').length === 1);
    log('track-keep: 2 trkpts', qsaNS(root, GPX_NS, 'trkpt').length === 2,
        'got ' + qsaNS(root, GPX_NS, 'trkpt').length);
    log('track-keep: stats.tracks[0].kept', stats.tracks[0].kept === true);
  },

  async function track_remove({ log, convert, parse, loadFixture, GPX_NS }) {
    const src = await loadFixture('track-only.gpx');
    const { gpx, stats } = convert(src, {
      tracks: [{ keep: false }],
    });
    const doc = parse(gpx);
    const root = doc.documentElement;
    log('track-remove: 0 trk', qsaNS(root, GPX_NS, 'trk').length === 0);
    log('track-remove: stats.tracks[0].kept == false', stats.tracks[0].kept === false);
  },

  async function rte_density_respects_tolerance({ log, convert, parse, loadFixture, GPX_NS, GPXX_NS }) {
    const src = await loadFixture('basecamp-route.gpx');
    const tight = convert(src, {
      routes: [{ keep: true, createDenseRoute: true, toleranceM: 1, createTrack: false,
        extensions: { [GPXX_NS + '|RoutePointExtension']: 'remove', [GPXX_NS + '|Subclass']: 'remove' },
      }],
    });
    const loose = convert(src, {
      routes: [{ keep: true, createDenseRoute: true, toleranceM: 1000, createTrack: false,
        extensions: { [GPXX_NS + '|RoutePointExtension']: 'remove', [GPXX_NS + '|Subclass']: 'remove' },
      }],
    });
    const tightCount = qsaNS(parse(tight.gpx).documentElement, GPX_NS, 'rtept').length;
    const looseCount = qsaNS(parse(loose.gpx).documentElement, GPX_NS, 'rtept').length;
    log('RDP: tighter tolerance keeps more rtepts',
        tightCount >= looseCount,
        'tight=' + tightCount + ' loose=' + looseCount);
    log('RDP: loose tolerance keeps all named rtepts (3)',
        looseCount >= 3, 'got ' + looseCount);
  },

  async function schema_order_is_canonical({ log, convert, parse, loadFixture, GPX_NS, GPXX_NS }) {
    const src = await loadFixture('route-with-waypoints.gpx');
    const { gpx } = convert(src, {
      routes: [{
        keep: true, createTrack: true, createDenseRoute: true, toleranceM: 10,
        addRteptsToWaypoints: true,
        extensions: { [GPXX_NS + '|RoutePointExtension']: 'remove' },
      }],
      waypointExtensions: { [GPXX_NS + '|WaypointExtension']: 'remove' },
    });
    const doc = parse(gpx);
    const root = doc.documentElement;
    const order = [];
    for (let c = root.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 1 && c.namespaceURI === GPX_NS) order.push(c.localName);
    }
    const pattern = /^(metadata)?(wpt)*(rte)*(trk)*(extensions)?$/;
    const squashed = order.join(',').replace(/(wpt,)+/g, 'wpt,').replace(/(rte,)+/g, 'rte,').replace(/(trk,)+/g, 'trk,');
    const flat = squashed.split(',').filter(Boolean).join('');
    log('schema order canonical', pattern.test(flat), 'got [' + order.join(', ') + ']');
  },

  async function rejects_non_gpx({ log, convert }) {
    let threw = false;
    try { convert('<notgpx/>'); } catch (e) { threw = true; }
    log('rejects non-<gpx> root', threw);
  },

  async function empty_gpx_succeeds({ log, convert }) {
    let threw = false, result = null;
    try {
      result = convert('<?xml version="1.0"?><gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="x"/>');
    } catch (e) { threw = true; }
    log('empty gpx succeeds without throwing', !threw && result !== null);
  },

  // ================================================================
  // Legacy summarizeInput tests (kept for backward compat during transition)
  // ================================================================

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

];

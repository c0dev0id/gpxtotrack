// gpxtotrack — convert a Garmin GPX route file into an enriched GPX containing
// a clean GPX 1.1 route (densified from Garmin's shaping points), a dense track
// flattened from RoutePointExtension, and the waypoints.
//
// Pure function: no DOM side effects, runs in any environment that provides
// DOMParser and XMLSerializer.

export const GPX_NS   = 'http://www.topografix.com/GPX/1/1';
export const GPXX_NS  = 'http://www.garmin.com/xmlschemas/GpxExtensions/v3';
export const XSI_NS   = 'http://www.w3.org/2001/XMLSchema-instance';
export const TRP_NS   = 'http://www.garmin.com/xmlschemas/TripExtensions/v1';
export const CTX_NS   = 'http://www.garmin.com/xmlschemas/CreationTimeExtension/v1';
export const WPTX1_NS = 'http://www.garmin.com/xmlschemas/WaypointExtension/v1';
export const RUMO_NS  = 'https://www.rumoadventures.com/xmlschemas/GpxExtensions/v1';

// Namespaces whose elements are always stripped from the output (no user choice).
const DROP_NAMESPACES = new Set([
  'http://www.garmin.com/xmlschemas/TrackPointExtension/v1',
  'http://www.garmin.com/xmlschemas/TrackPointExtension/v2',
  'http://www.garmin.com/xmlschemas/TrackStatsExtension/v1',
  'http://www.garmin.com/xmlschemas/PowerExtension/v1',
  'http://www.garmin.com/xmlschemas/AccelerationExtension/v1',
  WPTX1_NS,  // address/phone auto-converted to <desc> before strip
  CTX_NS,    // CreationTime auto-converted to <time> before strip
  'http://www.garmin.com/xmlschemas/AdventuresExtensions/v1',
  'http://www.garmin.com/xmlschemas/TripMetaDataExtensions/v1',
  'http://www.garmin.com/xmlschemas/ViaPointTransportationModeExtensions/v1',
  'http://www.garmin.com/xmlschemas/PressureExtension/v1',
  'http://www.garmin.com/xmlschemas/VideoExtension/v1',
]);

// All Garmin + standard GPX namespaces. Anything outside this set is third-party.
const KNOWN_NAMESPACES = new Set([
  GPX_NS, GPXX_NS, XSI_NS, TRP_NS, CTX_NS, WPTX1_NS, RUMO_NS,
  ...DROP_NAMESPACES,
]);


/**
 * Convert a Garmin GPX route file to an enriched GPX.
 *
 * @param {string} gpxString - input GPX XML.
 * @param {object} [options]
 * @param {Array}  [options.routes]  - per-route options, indexed by input order.
 * @param {Array}  [options.tracks]  - per-track options, indexed by input order.
 * @param {object} [options.waypointExtensions] - { 'ns|localName': 'keep'|'remove' }
 * @param {DOMParser}     [options.DOMParserImpl]
 * @param {XMLSerializer} [options.XMLSerializerImpl]
 * @returns {{ gpx: string, stats: object }}
 */
export function convert(gpxString, options = {}) {
  const Parser     = options.DOMParserImpl    || (typeof DOMParser    !== 'undefined' ? DOMParser    : null);
  const Serializer = options.XMLSerializerImpl || (typeof XMLSerializer !== 'undefined' ? XMLSerializer : null);
  if (!Parser || !Serializer) {
    throw new Error('DOMParser / XMLSerializer not available in this environment');
  }

  const doc = new Parser().parseFromString(gpxString, 'application/xml');
  const parseErr = doc.getElementsByTagName('parsererror')[0];
  if (parseErr) throw new Error('Failed to parse GPX: ' + parseErr.textContent.trim());

  const gpx = doc.documentElement;
  if (!gpx || gpx.localName !== 'gpx') throw new Error('Root element is not <gpx>');

  const routeOpts = options.routes || [];
  const trackOpts = options.tracks || [];
  const wptExtDecisions = options.waypointExtensions || {};
  const convertCategoriesToRumoTags = !!options.convertCategoriesToRumoTags;
  const convertRumoTagsToCategories = !!options.convertRumoTagsToCategories;

  const inputRtes = Array.from(childrenByNS(gpx, GPX_NS, 'rte'));
  const inputTrks = Array.from(childrenByNS(gpx, GPX_NS, 'trk'));

  // Detach all original routes and tracks from the DOM.
  for (const rte of inputRtes) if (rte.parentNode) rte.parentNode.removeChild(rte);
  for (const trk of inputTrks) if (trk.parentNode) trk.parentNode.removeChild(trk);

  const stats = {
    routes: [],
    tracks: [],
    outputWaypoints: 0,
    bounds: null,
    rumoWaypointTagsCount: 0,
    garminCategoriesCount: 0,
    viaPointsPromoted: 0,
    namedRteptsPromoted: 0,
  };

  // Auto-convert wpt extension data before any extension filtering.
  for (const wpt of childrenByNS(gpx, GPX_NS, 'wpt')) {
    convertWptExtensionData(wpt, doc);
    if (convertCategoriesToRumoTags && convertGarminCategoriesToRumoTags(wpt, doc)) {
      stats.rumoWaypointTagsCount++;
    }
    if (convertRumoTagsToCategories && convertRumoTagsToGarminCategories(wpt, doc)) {
      stats.garminCategoriesCount++;
    }
  }

  // Apply waypoint extension decisions to existing waypoints.
  for (const wpt of childrenByNS(gpx, GPX_NS, 'wpt')) {
    applyExtensionDecisions(wpt, wptExtDecisions);
  }

  const newWaypoints = [];
  const newTracks    = [];
  const newRoutes    = [];

  // --- Per-route processing ---
  for (let ri = 0; ri < inputRtes.length; ri++) {
    const rte = inputRtes[ri];
    const opts = routeOpts[ri] || {};
    const keep = opts.keep !== false;
    const addRteptsToWaypoints   = !!opts.addRteptsToWaypoints;
    const addViaPointsToWaypoints = !!opts.addViaPointsToWaypoints;
    const convertToRumoColor     = !!opts.convertToRumoColor;
    const convertToRumoShaping    = !!opts.convertToRumoShaping;
    const convertRumoColorToGarmin   = !!opts.convertRumoColorToGarmin;
    const convertRumoShapingToGarmin = !!opts.convertRumoShapingToGarmin;
    const createDenseRoute = opts.createDenseRoute !== false;
    const toleranceM = opts.toleranceM ?? 10;
    const createTrack = opts.createTrack !== false;
    const extDecisions = opts.extensions || {};

    const rteName = firstChildText(rte, GPX_NS, 'name') || ('Route ' + (ri + 1));
    const rteptEls = Array.from(childrenByNS(rte, GPX_NS, 'rtept'));
    const inputRtepts = rteptEls.length;

    const routeStat = {
      name: rteName,
      kept: keep,
      inputRtepts,
      outputRtepts: 0,
      denseRouteCreated: false,
      trackCreated: false,
      trackTrkpts: 0,
      extensions: [],
      trackExtensions: [],
    };

    // Skip entirely if not kept and no derived outputs requested.
    if (!keep && !createTrack && !addRteptsToWaypoints && !addViaPointsToWaypoints) {
      stats.routes.push(routeStat);
      continue;
    }

    // Build merged ordered point list (rtepts + shaping points).
    const merged = [];
    for (let i = 0; i < rteptEls.length; i++) {
      const rt = rteptEls[i];
      const lat = parseFloat(rt.getAttribute('lat'));
      const lon = parseFloat(rt.getAttribute('lon'));
      const ele  = firstChildText(rt, GPX_NS, 'ele');
      const time = firstChildText(rt, GPX_NS, 'time');
      const named = hasAnyNamedField(rt);
      merged.push({
        lat, lon, ele, time,
        fromRtept: true,
        rteptEl: rt,
        anchor: named || i === 0 || i === rteptEls.length - 1,
      });

      const rpe = firstChildElNS(firstChildElNS(rt, GPX_NS, 'extensions'), GPXX_NS, 'RoutePointExtension');
      if (rpe) {
        for (const rpt of childrenByNS(rpe, GPXX_NS, 'rpt')) {
          merged.push({
            lat: parseFloat(rpt.getAttribute('lat')),
            lon: parseFloat(rpt.getAttribute('lon')),
            ele: null, time: null,
            fromRtept: false, rteptEl: null, anchor: false,
          });
        }
      }
    }

    // Dedupe consecutive identical coords (firmware quirk).
    const deduped = [];
    for (const p of merged) {
      const last = deduped[deduped.length - 1];
      if (!last || last.lat !== p.lat || last.lon !== p.lon) {
        deduped.push(p);
      } else if (p.fromRtept && !last.fromRtept) {
        last.fromRtept = true;
        last.rteptEl   = p.rteptEl;
        last.ele       = last.ele  || p.ele;
        last.time      = last.time || p.time;
        last.anchor    = last.anchor || p.anchor;
      }
    }

    // Create track from merged points.
    if (createTrack) {
      const trk = doc.createElementNS(GPX_NS, 'trk');
      copyChildren(rte, trk, GPX_NS, ['name', 'desc', 'cmt', 'src', 'link', 'type', 'number']);
      const trkseg = doc.createElementNS(GPX_NS, 'trkseg');
      for (const p of deduped) {
        const trkpt = doc.createElementNS(GPX_NS, 'trkpt');
        trkpt.setAttribute('lat', formatCoord(p.lat));
        trkpt.setAttribute('lon', formatCoord(p.lon));
        if (p.ele)  trkpt.appendChild(textEl(doc, GPX_NS, 'ele',  p.ele));
        if (p.time) trkpt.appendChild(textEl(doc, GPX_NS, 'time', p.time));
        trkseg.appendChild(trkpt);
      }
      trk.appendChild(trkseg);
      routeStat.trackTrkpts = deduped.length;
      routeStat.trackCreated = true;

      // Copy DisplayColor to track if kept; also translate to Rumo if requested.
      const dcKey = GPXX_NS + '|DisplayColor';
      const color = readRouteDisplayColor(rte);
      if (color) {
        if (extDecisions[dcKey] !== 'remove') {
          trk.appendChild(buildColorExtensions(doc, 'TrackExtension', color));
        }
        if (convertToRumoColor) {
          const exts = ensureExtensions(doc, trk);
          exts.appendChild(doc.createComment(' Rumo: color ' + rumoColorValue(color) + ' converted from gpxx:TrackExtension/DisplayColor "' + color + '" '));
          exts.appendChild(buildRumoColorExt(doc, 'TrackExtension', color));
        }
      }

      routeStat.trackExtensions = enumerateExtensions(collectTrackElements(trk)).map(classifyExtension);
      newTracks.push(trk);
    }

    // Build route output.
    if (keep) {
      let newRte;
      if (createDenseRoute) {
        // Densify via RDP from merged points.
        const keepFlags = rdpWithAnchors(deduped, toleranceM);
        newRte = doc.createElementNS(GPX_NS, 'rte');
        copyChildren(rte, newRte, GPX_NS, ['name', 'desc', 'cmt', 'src', 'link', 'type', 'number']);
        // Clone route-level extensions from original, then filter.
        cloneExtensions(rte, newRte);

        for (let i = 0; i < deduped.length; i++) {
          if (!keepFlags[i]) continue;
          const p = deduped[i];
          const rtept = doc.createElementNS(GPX_NS, 'rtept');
          rtept.setAttribute('lat', formatCoord(p.lat));
          rtept.setAttribute('lon', formatCoord(p.lon));
          if (p.ele)  rtept.appendChild(textEl(doc, GPX_NS, 'ele',  p.ele));
          if (p.time) rtept.appendChild(textEl(doc, GPX_NS, 'time', p.time));
          if (p.fromRtept && p.rteptEl) {
            copyChildren(p.rteptEl, rtept, GPX_NS, ['name', 'desc', 'cmt', 'sym', 'type', 'link']);
            // Clone extensions from original rtept, then filter.
            cloneExtensions(p.rteptEl, rtept);
            applyExtensionDecisions(rtept, extDecisions);
          }
          if (p.fromRtept && p.rteptEl) {
            const vp = addViaPointsToWaypoints && isViaPoint(p.rteptEl);
            if ((addRteptsToWaypoints && hasAnyNamedField(p.rteptEl)) || vp) {
              newWaypoints.push(buildWaypointFromRtept(doc, p));
              if (vp) stats.viaPointsPromoted++;
              else     stats.namedRteptsPromoted++;
            }
          }
          newRte.appendChild(rtept);
          routeStat.outputRtepts++;
        }
        routeStat.denseRouteCreated = true;
      } else {
        // Clone original route verbatim, then filter extensions.
        newRte = rte.cloneNode(true);
        // Apply extension decisions to each rtept in the clone.
        for (const rtept of childrenByNS(newRte, GPX_NS, 'rtept')) {
          const vp = addViaPointsToWaypoints && isViaPoint(rtept);
          applyExtensionDecisions(rtept, extDecisions);
          if ((addRteptsToWaypoints && hasAnyNamedField(rtept)) || vp) {
            const lat = parseFloat(rtept.getAttribute('lat'));
            const lon = parseFloat(rtept.getAttribute('lon'));
            newWaypoints.push(buildWaypointFromRtept(doc, {
              lat, lon,
              ele: firstChildText(rtept, GPX_NS, 'ele'),
              time: firstChildText(rtept, GPX_NS, 'time'),
              rteptEl: rtept,
            }));
            if (vp) stats.viaPointsPromoted++;
            else     stats.namedRteptsPromoted++;
          }
        }
        routeStat.outputRtepts = childrenByNS(newRte, GPX_NS, 'rtept').length;
      }

      // Apply extension decisions to route-level extensions.
      applyExtensionDecisions(newRte, extDecisions);

      if (convertToRumoColor) {
        const color = readRouteDisplayColor(rte);
        if (color) {
          const exts = ensureExtensions(doc, newRte);
          exts.appendChild(doc.createComment(' Rumo: color ' + rumoColorValue(color) + ' converted from gpxx:RouteExtension/DisplayColor "' + color + '" '));
          exts.appendChild(buildRumoColorExt(doc, 'RouteExtension', color));
        }
      }
      if (convertToRumoShaping) {
        const rumoShaping = buildRumoShapingExt(doc, rteptEls);
        if (rumoShaping) {
          const spCount = rumoShaping.firstChild
            ? rumoShaping.firstChild.childNodes.length : 0;
          const exts = ensureExtensions(doc, newRte);
          exts.appendChild(doc.createComment(' Rumo: ' + spCount + ' shaping point(s) translated from gpxx:RoutePointExtension/rpt '));
          exts.appendChild(rumoShaping);
        }
      }
      if (convertRumoColorToGarmin) {
        const rumoColor = readRumoRouteColor(rte);
        if (rumoColor) {
          const garminName = nearestGarminName(rumoColor);
          if (garminName) {
            const exts = ensureExtensions(doc, newRte);
            exts.appendChild(doc.createComment(' Garmin: color "' + garminName + '" matched from rumo:RouteExtension/DisplayColor "' + rumoColor + '" '));
            const rext = doc.createElementNS(GPXX_NS, 'gpxx:RouteExtension');
            const dc   = doc.createElementNS(GPXX_NS, 'gpxx:DisplayColor');
            dc.textContent = garminName;
            rext.appendChild(dc);
            exts.appendChild(rext);
          }
        }
      }
      if (convertRumoShapingToGarmin) {
        const shapingPts = readRumoShapingPoints(rte);
        const outRtepts  = Array.from(childrenByNS(newRte, GPX_NS, 'rtept'));
        if (shapingPts.length && outRtepts.length >= 2) {
          const coords = outRtepts.map(rt => ({
            lat: parseFloat(rt.getAttribute('lat')),
            lon: parseFloat(rt.getAttribute('lon')),
          }));
          const partitions = assignShapingToRtepts(shapingPts, coords);
          for (const [segIdx, pts] of partitions.entries()) {
            const parent = outRtepts[segIdx];
            const exts = ensureExtensions(doc, parent);
            exts.appendChild(doc.createComment(' Garmin: ' + pts.length + ' shaping coord(s) from rumo:ShapingPoints between rtept ' + segIdx + ' and ' + (segIdx + 1) + ' '));
            const rpe = doc.createElementNS(GPXX_NS, 'gpxx:RoutePointExtension');
            for (const p of pts) {
              const rpt = doc.createElementNS(GPXX_NS, 'gpxx:rpt');
              rpt.setAttribute('lat', formatCoord(p.lat));
              rpt.setAttribute('lon', formatCoord(p.lon));
              rpe.appendChild(rpt);
            }
            exts.appendChild(rpe);
          }
        }
      }

      routeStat.extensions = enumerateExtensions(collectRouteElements(newRte)).map(classifyExtension);
      newRoutes.push(newRte);
    } else if (addRteptsToWaypoints || addViaPointsToWaypoints) {
      // Route not kept, but waypoints requested.
      for (const rt of rteptEls) {
        const vp = addViaPointsToWaypoints && isViaPoint(rt);
        if ((addRteptsToWaypoints && hasAnyNamedField(rt)) || vp) {
          const lat = parseFloat(rt.getAttribute('lat'));
          const lon = parseFloat(rt.getAttribute('lon'));
          newWaypoints.push(buildWaypointFromRtept(doc, {
            lat, lon,
            ele: firstChildText(rt, GPX_NS, 'ele'),
            time: firstChildText(rt, GPX_NS, 'time'),
            rteptEl: rt,
          }));
          if (vp) stats.viaPointsPromoted++;
          else     stats.namedRteptsPromoted++;
        }
      }
    }

    stats.routes.push(routeStat);
  }

  // --- Per-track processing ---
  for (let ti = 0; ti < inputTrks.length; ti++) {
    const trk = inputTrks[ti];
    const opts = trackOpts[ti] || {};
    const keep = opts.keep !== false;
    const extDecisions = opts.extensions || {};
    const convertToRumoColor       = !!opts.convertToRumoColor;
    const convertRumoColorToGarmin = !!opts.convertRumoColorToGarmin;
    const trkName = firstChildText(trk, GPX_NS, 'name') || ('Track ' + (ti + 1));
    const trkpts = trk.getElementsByTagNameNS(GPX_NS, 'trkpt').length;

    const trackStat = { name: trkName, kept: keep, trkpts, extensions: [] };
    if (keep) {
      const color = convertToRumoColor ? readTrackDisplayColor(trk) : null;
      const cloned = trk.cloneNode(true);
      // Apply extension decisions to track-level, trkseg-level, and trkpt-level.
      applyExtensionDecisions(cloned, extDecisions);
      for (const seg of childrenByNS(cloned, GPX_NS, 'trkseg')) {
        for (const pt of childrenByNS(seg, GPX_NS, 'trkpt')) {
          applyExtensionDecisions(pt, extDecisions);
        }
      }
      if (color) {
        const exts = ensureExtensions(doc, cloned);
        exts.appendChild(doc.createComment(' Rumo: color ' + rumoColorValue(color) + ' converted from gpxx:TrackExtension/DisplayColor "' + color + '" '));
        exts.appendChild(buildRumoColorExt(doc, 'TrackExtension', color));
      }
      if (convertRumoColorToGarmin) {
        const rumoColor = readRumoTrackColor(trk);
        if (rumoColor) {
          const garminName = nearestGarminName(rumoColor);
          if (garminName) {
            const exts = ensureExtensions(doc, cloned);
            exts.appendChild(doc.createComment(' Garmin: color "' + garminName + '" matched from rumo:TrackExtension/DisplayColor "' + rumoColor + '" '));
            const text = doc.createElementNS(GPXX_NS, 'gpxx:TrackExtension');
            const dc   = doc.createElementNS(GPXX_NS, 'gpxx:DisplayColor');
            dc.textContent = garminName;
            text.appendChild(dc);
            exts.appendChild(text);
          }
        }
      }
      trackStat.extensions = enumerateExtensions(collectTrackElements(cloned)).map(classifyExtension);
      newTracks.push(cloned);
    }
    stats.tracks.push(trackStat);
  }

  removeEmptyExtensions(gpx);

  // Insert new elements; existing wpts survive via insertInOrder's bucket sort.
  insertInOrder(gpx, newWaypoints, newRoutes, newTracks);
  stats.outputWaypoints = childrenByNS(gpx, GPX_NS, 'wpt').length;

  // Namespace / metadata hygiene.
  gpx.setAttribute('version', '1.1');
  gpx.setAttribute('creator', 'gpxtotrack');
  refreshMetadataTime(gpx, doc);
  scrubNamespaceDeclarations(gpx);

  stats.bounds = computeBounds(gpx);
  stats.waypointExtensions = enumerateExtensions(
    Array.from(childrenByNS(gpx, GPX_NS, 'wpt'))
  ).map(classifyExtension);

  prettyPrint(gpx, 0);

  const xml = new Serializer().serializeToString(doc);
  const out = xml.startsWith('<?xml')
    ? xml
    : '<?xml version="1.0" encoding="UTF-8"?>\n' + xml;
  return { gpx: out, stats };
}

/**
 * Clone the <extensions> subtree from src to dst (if src has one).
 */
function cloneExtensions(src, dst) {
  const ext = firstChildElNS(src, GPX_NS, 'extensions');
  if (ext) dst.appendChild(ext.cloneNode(true));
}

/**
 * Apply extension keep/remove decisions to an element's <extensions> subtree.
 * For known wrappers (RouteExtension, etc.), checks each child individually.
 * If the wrapper itself is marked 'remove', removes it entirely.
 * Unknown extensions (not in decisions) are kept by default.
 */
function applyExtensionDecisions(element, decisions) {
  const ext = firstChildElNS(element, GPX_NS, 'extensions');
  if (!ext) return;

  const toRemove = [];
  for (let c = ext.firstChild; c; c = c.nextSibling) {
    if (c.nodeType !== 1) continue;
    const wrapperKey = (c.namespaceURI || '') + '|' + c.localName;
    if (EXTENSION_WRAPPERS.has(wrapperKey)) {
      // If the wrapper itself is marked 'remove', remove it entirely.
      if (decisions[wrapperKey] === 'remove') { toRemove.push(c); continue; }
      // Otherwise check each child of the wrapper.
      const wrapperVictims = [];
      for (let gc = c.firstChild; gc; gc = gc.nextSibling) {
        if (gc.nodeType !== 1) continue;
        const key = (gc.namespaceURI || '') + '|' + gc.localName;
        if (decisions[key] === 'remove') wrapperVictims.push(gc);
      }
      for (const v of wrapperVictims) c.removeChild(v);
      // Remove wrapper if now empty.
      let hasChild = false;
      for (let gc = c.firstChild; gc; gc = gc.nextSibling) {
        if (gc.nodeType === 1) { hasChild = true; break; }
      }
      if (!hasChild) toRemove.push(c);
    } else {
      const key = (c.namespaceURI || '') + '|' + c.localName;
      if (decisions[key] === 'remove') toRemove.push(c);
    }
  }
  for (const el of toRemove) ext.removeChild(el);

  // Remove <extensions> wrapper if now empty.
  let hasChild = false;
  for (let c = ext.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === 1) { hasChild = true; break; }
  }
  if (!hasChild && ext.parentNode) ext.parentNode.removeChild(ext);
}

/**
 * Compute a lightweight summary of the input GPX without converting.
 *
 * @param {string} gpxString
 * @param {object} [options]
 * @param {DOMParser} [options.DOMParserImpl]
 * @returns {{
 *   routes: number,
 *   rtepts: number,
 *   rpts: number,
 *   waypoints: number,
 *   tracks: number,
 *   trkpts: number,
 *   bounds: {minLat:number,minLon:number,maxLat:number,maxLon:number}|null,
 *   features: {
 *     hasDisplayColor: boolean,
 *     hasRoutingMeta: boolean,
 *     hasThirdPartyExt: boolean,
 *     hasExistingTrack: boolean,
 *     hasShapingPts: boolean,
 *     routeOnly: boolean,
 *   },
 * }}
 */
export function summarizeInput(gpxString, options = {}) {
  const Parser = options.DOMParserImpl || (typeof DOMParser !== 'undefined' ? DOMParser : null);
  if (!Parser) throw new Error('DOMParser not available in this environment');

  const doc = new Parser().parseFromString(gpxString, 'application/xml');
  const parseErr = doc.getElementsByTagName('parsererror')[0];
  if (parseErr) throw new Error('Failed to parse GPX: ' + parseErr.textContent.trim());

  const gpx = doc.documentElement;
  if (!gpx || gpx.localName !== 'gpx') throw new Error('Root element is not <gpx>');

  const routes    = gpx.getElementsByTagNameNS(GPX_NS,  'rte').length;
  const rtepts    = gpx.getElementsByTagNameNS(GPX_NS,  'rtept').length;
  const rpts      = gpx.getElementsByTagNameNS(GPXX_NS, 'rpt').length;
  const waypoints = gpx.getElementsByTagNameNS(GPX_NS,  'wpt').length;
  const tracks    = gpx.getElementsByTagNameNS(GPX_NS,  'trk').length;
  const trkpts    = gpx.getElementsByTagNameNS(GPX_NS,  'trkpt').length;

  let minLat = Infinity, minLon = Infinity, maxLat = -Infinity, maxLon = -Infinity;
  const scanCoords = (list) => {
    for (const el of list) {
      const lat = parseFloat(el.getAttribute('lat'));
      const lon = parseFloat(el.getAttribute('lon'));
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
    }
  };
  scanCoords(gpx.getElementsByTagNameNS(GPX_NS,  'wpt'));
  scanCoords(gpx.getElementsByTagNameNS(GPX_NS,  'rtept'));
  scanCoords(gpx.getElementsByTagNameNS(GPXX_NS, 'rpt'));
  scanCoords(gpx.getElementsByTagNameNS(GPX_NS,  'trkpt'));
  const bounds = minLat === Infinity ? null : { minLat, minLon, maxLat, maxLon };

  const features = {
    hasDisplayColor:  gpx.getElementsByTagNameNS(GPXX_NS, 'DisplayColor').length > 0,
    hasRoutingMeta:   gpx.getElementsByTagNameNS(TRP_NS,  '*').length > 0,
    hasThirdPartyExt: hasThirdPartyExtension(gpx),
    hasExistingTrack: tracks > 0,
    hasShapingPts:    rpts > 0,
    routeOnly:        routes === 0,
  };

  return { routes, rtepts, rpts, waypoints, tracks, trkpts, bounds, features };
}

// ---------------------------------------------------------------------------
// Extension analysis helpers

// Known extension wrappers: enumerate their children, not the wrapper itself.
const EXTENSION_WRAPPERS = new Set([
  GPXX_NS + '|RouteExtension',
  GPXX_NS + '|TrackExtension',
  GPXX_NS + '|WaypointExtension',
  WPTX1_NS + '|WaypointExtension',
]);

function camelToLabel(s) {
  return s.replace(/([a-z])([A-Z])/g, '$1 $2')
          .replace(/^./, c => c.toUpperCase());
}

function enumerateExtensions(elements) {
  const seen = new Map();
  const record = (node) => {
    const key = (node.namespaceURI || '') + '|' + node.localName;
    let entry = seen.get(key);
    if (!entry) {
      entry = { ns: node.namespaceURI || '', localName: node.localName, instances: [] };
      seen.set(key, entry);
    }
    entry.instances.push(node);
  };
  for (const el of elements) {
    const ext = firstChildElNS(el, GPX_NS, 'extensions');
    if (!ext) continue;
    for (let c = ext.firstChild; c; c = c.nextSibling) {
      if (c.nodeType !== 1) continue;
      const wrapperKey = (c.namespaceURI || '') + '|' + c.localName;
      if (EXTENSION_WRAPPERS.has(wrapperKey)) {
        for (let gc = c.firstChild; gc; gc = gc.nextSibling) {
          if (gc.nodeType === 1) record(gc);
        }
      } else {
        record(c);
      }
    }
  }
  return Array.from(seen.values());
}

function classifyExtension(entry) {
  const { ns, localName } = entry;
  const prefix = nsPrefix(ns);
  const displayName = camelToLabel(localName);
  const label = prefix ? prefix + ': ' + displayName : displayName;
  const vendor = extensionVendor(ns);
  const summary = summarizeExtension(entry);
  return { ns, localName, label, vendor, displayName, summary, defaultAction: 'remove' };
}

// Derive a short, human-facing value summary for the extension based on its
// DOM instances (e.g. "Red" for DisplayColor, "4550 shaping points" for
// RoutePointExtension, "Food, Lodging" for Categories). Returns '' when there's
// no short way to summarise — callers should then just render the name.
function summarizeExtension(entry) {
  const { ns, localName, instances } = entry;
  if (!instances || !instances.length) return '';

  if (localName === 'DisplayColor' && (ns === GPXX_NS || ns === RUMO_NS)) {
    return (instances[0].textContent || '').trim();
  }

  if (ns === GPXX_NS && localName === 'RoutePointExtension') {
    let n = 0;
    for (const inst of instances) n += childrenByNS(inst, GPXX_NS, 'rpt').length;
    return n ? n + ' shaping point' + (n === 1 ? '' : 's') : '';
  }

  if (ns === RUMO_NS && localName === 'ShapingPoints') {
    let n = 0;
    for (const inst of instances) n += childrenByNS(inst, RUMO_NS, 'ShapingPoint').length;
    return n ? n + ' shaping point' + (n === 1 ? '' : 's') : '';
  }

  if (ns === GPXX_NS && localName === 'Categories') {
    const tags = new Set();
    for (const inst of instances) {
      for (const c of childrenByNS(inst, GPXX_NS, 'Category')) {
        const v = (c.textContent || '').trim();
        if (v) tags.add(v);
      }
    }
    return tags.size ? summarizeList(Array.from(tags), 4) : '';
  }

  if (ns === RUMO_NS && localName === 'WaypointTags') {
    const tags = new Set();
    for (const inst of instances) {
      for (const t of (inst.textContent || '').split(',')) {
        const v = t.trim();
        if (v) tags.add(v);
      }
    }
    return tags.size ? summarizeList(Array.from(tags), 4) : '';
  }

  if (ns === TRP_NS && localName === 'ViaPoint') {
    return instances.length + ' point' + (instances.length === 1 ? '' : 's');
  }

  if (instances.length > 1) return instances.length + ' occurrences';
  return '';
}

function summarizeList(arr, max) {
  if (arr.length <= max) return arr.join(', ');
  return arr.slice(0, max).join(', ') + ', \u2026 (+' + (arr.length - max) + ' more)';
}

function collectRouteElements(rte) {
  return [rte, ...childrenByNS(rte, GPX_NS, 'rtept')];
}

function collectTrackElements(trk) {
  const out = [trk];
  for (const seg of childrenByNS(trk, GPX_NS, 'trkseg')) {
    out.push(seg);
    for (const pt of childrenByNS(seg, GPX_NS, 'trkpt')) out.push(pt);
  }
  return out;
}

function nsPrefix(ns) {
  if (ns === GPXX_NS)  return 'gpxx';
  if (ns === TRP_NS)   return 'trp';
  if (ns === CTX_NS)   return 'ctx';
  if (ns === WPTX1_NS) return 'wptx1';
  if (ns === RUMO_NS)  return 'rumo';
  // For unknown namespaces, extract a short prefix from the URL
  const m = ns.match(/\/([^/]+?)(?:\/v\d+)?$/);
  return m ? m[1] : '';
}

// Classify a namespace URI into a human-facing vendor label. Used by the UI
// to group extensions and make the Garmin vs Rumo/DMD distinction explicit.
export function extensionVendor(ns) {
  if (ns === RUMO_NS) return 'Rumo/DMD';
  if (ns && ns.includes('garmin.com')) return 'Garmin';
  return 'Other';
}

/**
 * Analyze a GPX string and return structured info about its contents
 * for the UI to render per-route/track options.
 *
 * @param {string} gpxString
 * @param {object} [options]
 * @param {DOMParser} [options.DOMParserImpl]
 * @returns {{ routes, tracks, waypoints, bounds }}
 */
export function analyzeInput(gpxString, options = {}) {
  const Parser = options.DOMParserImpl || (typeof DOMParser !== 'undefined' ? DOMParser : null);
  if (!Parser) throw new Error('DOMParser not available in this environment');

  const doc = new Parser().parseFromString(gpxString, 'application/xml');
  const parseErr = doc.getElementsByTagName('parsererror')[0];
  if (parseErr) throw new Error('Failed to parse GPX: ' + parseErr.textContent.trim());

  const gpx = doc.documentElement;
  if (!gpx || gpx.localName !== 'gpx') throw new Error('Root element is not <gpx>');

  const rteEls = Array.from(childrenByNS(gpx, GPX_NS, 'rte'));
  const trkEls = Array.from(childrenByNS(gpx, GPX_NS, 'trk'));
  const wptEls = Array.from(childrenByNS(gpx, GPX_NS, 'wpt'));

  const routes = rteEls.map((rte, index) => {
    const rteptEls = Array.from(childrenByNS(rte, GPX_NS, 'rtept'));
    const name = firstChildText(rte, GPX_NS, 'name') || ('Route ' + (index + 1));

    let shapingPointCount = 0;
    let hasShapingPoints = false;
    let hasViaPoints = false;
    let isTrip = false;
    let isRoutePointExt = false;

    for (const rtept of rteptEls) {
      const ext = firstChildElNS(rtept, GPX_NS, 'extensions');
      if (!ext) continue;
      const rpe = firstChildElNS(ext, GPXX_NS, 'RoutePointExtension');
      if (rpe) {
        isRoutePointExt = true;
        shapingPointCount += childrenByNS(rpe, GPXX_NS, 'rpt').length;
        hasShapingPoints = true;
      }
      if (!hasViaPoints && isViaPoint(rtept)) hasViaPoints = true;
      // Check for TRP extensions on rtepts
      for (let c = ext.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 1 && c.namespaceURI === TRP_NS) { isTrip = true; break; }
      }
    }
    // Also check route-level extensions for TRP
    const rteExt = firstChildElNS(rte, GPX_NS, 'extensions');
    if (rteExt) {
      for (let c = rteExt.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 1 && c.namespaceURI === TRP_NS) { isTrip = true; break; }
      }
    }

    // Enumerate extensions from all rtepts + route-level
    const extensions = enumerateExtensions(collectRouteElements(rte)).map(classifyExtension);

    const hasRumoColor   = readRumoRouteColor(rte) !== null;
    const hasRumoShaping = readRumoShapingPoints(rte).length > 0;

    return {
      index, name,
      rteptCount: rteptEls.length,
      shapingPointCount,
      hasShapingPoints,
      hasViaPoints,
      isTrip,
      isRoutePointExt,
      hasRumoColor,
      hasRumoShaping,
      extensions,
    };
  });

  const tracks = trkEls.map((trk, index) => {
    const name = firstChildText(trk, GPX_NS, 'name') || ('Track ' + (index + 1));
    const trkpts = trk.getElementsByTagNameNS(GPX_NS, 'trkpt');
    const trkptCount = trkpts.length;

    // Enumerate extensions from all trkpts + trkseg + trk-level
    const extensions = enumerateExtensions(collectTrackElements(trk)).map(classifyExtension);
    const hasRumoColor = readRumoTrackColor(trk) !== null;

    return { index, name, trkptCount, hasRumoColor, extensions };
  });

  const wptExtensions = enumerateExtensions(wptEls).map(classifyExtension);
  const hasRumoWaypointTags = wptEls.some(w => readRumoWaypointTags(w).length > 0);

  // Bounds
  let minLat = Infinity, minLon = Infinity, maxLat = -Infinity, maxLon = -Infinity;
  const scanCoords = (list) => {
    for (const el of list) {
      const lat = parseFloat(el.getAttribute('lat'));
      const lon = parseFloat(el.getAttribute('lon'));
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
    }
  };
  scanCoords(wptEls);
  scanCoords(gpx.getElementsByTagNameNS(GPX_NS, 'rtept'));
  scanCoords(gpx.getElementsByTagNameNS(GPXX_NS, 'rpt'));
  scanCoords(gpx.getElementsByTagNameNS(GPX_NS, 'trkpt'));
  const bounds = minLat === Infinity ? null : { minLat, minLon, maxLat, maxLon };

  return {
    routes,
    tracks,
    waypoints: { count: wptEls.length, extensions: wptExtensions, hasRumoWaypointTags },
    bounds,
  };
}

// ---------------------------------------------------------------------------
// DOM helpers

function childrenByNS(el, ns, localName) {
  const out = [];
  if (!el) return out;
  for (let c = el.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === 1 && c.namespaceURI === ns && c.localName === localName) out.push(c);
  }
  return out;
}

function firstChildElNS(el, ns, localName) {
  if (!el) return null;
  for (let c = el.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === 1 && c.namespaceURI === ns && c.localName === localName) return c;
  }
  return null;
}

function firstChildText(el, ns, localName) {
  const c = firstChildElNS(el, ns, localName);
  return c ? c.textContent : null;
}

function copyChildren(src, dst, ns, localNames) {
  for (const n of localNames) {
    const c = firstChildElNS(src, ns, n);
    if (c) dst.appendChild(c.cloneNode(true));
  }
}

function textEl(doc, ns, localName, text) {
  const el = doc.createElementNS(ns, localName);
  el.textContent = text;
  return el;
}

function hasAnyNamedField(el) {
  return !!(firstChildElNS(el, GPX_NS, 'name')
         || firstChildElNS(el, GPX_NS, 'desc')
         || firstChildElNS(el, GPX_NS, 'cmt')
         || firstChildElNS(el, GPX_NS, 'sym'));
}

function isViaPoint(rteptEl) {
  const ext = firstChildElNS(rteptEl, GPX_NS, 'extensions');
  if (!ext) return false;
  if (firstChildElNS(ext, TRP_NS, 'ViaPoint')) return true;
  const rpe = firstChildElNS(ext, TRP_NS, 'RoutePointExtension');
  return rpe ? !!firstChildElNS(rpe, TRP_NS, 'ViaPoint') : false;
}

function formatCoord(n) {
  if (!Number.isFinite(n)) return String(n);
  return n.toFixed(7).replace(/\.?0+$/, '');
}

function buildWaypointFromRtept(doc, p) {
  const wpt = doc.createElementNS(GPX_NS, 'wpt');
  wpt.setAttribute('lat', formatCoord(p.lat));
  wpt.setAttribute('lon', formatCoord(p.lon));
  if (p.ele)  wpt.appendChild(textEl(doc, GPX_NS, 'ele',  p.ele));
  if (p.time) wpt.appendChild(textEl(doc, GPX_NS, 'time', p.time));
  copyChildren(p.rteptEl, wpt, GPX_NS, ['name', 'desc', 'cmt', 'sym', 'type', 'link']);
  return wpt;
}

// Canonical VGA-palette RGB for each Garmin DisplayColor_t enum value.
// Transparent is deliberately omitted: it has no RGB, so it can never be a
// nearest-match target — it passes through by name only.
const GARMIN_COLOR_RGB = {
  Black:       [0x00, 0x00, 0x00],
  DarkRed:     [0x80, 0x00, 0x00],
  DarkGreen:   [0x00, 0x80, 0x00],
  DarkYellow:  [0x80, 0x80, 0x00],
  DarkBlue:    [0x00, 0x00, 0x80],
  DarkMagenta: [0x80, 0x00, 0x80],
  DarkCyan:    [0x00, 0x80, 0x80],
  LightGray:   [0xC0, 0xC0, 0xC0],
  DarkGray:    [0x80, 0x80, 0x80],
  Red:         [0xFF, 0x00, 0x00],
  Green:       [0x00, 0xFF, 0x00],
  Yellow:      [0xFF, 0xFF, 0x00],
  Blue:        [0x00, 0x00, 0xFF],
  Magenta:     [0xFF, 0x00, 0xFF],
  Cyan:        [0x00, 0xFF, 0xFF],
  White:       [0xFF, 0xFF, 0xFF],
};

function garminNameToHex(name) {
  const rgb = GARMIN_COLOR_RGB[name];
  if (!rgb) return null;
  const h = n => n.toString(16).padStart(2, '0').toUpperCase();
  return '#' + h(rgb[0]) + h(rgb[1]) + h(rgb[2]);
}

function parseColorToRgb(value) {
  if (!value) return null;
  const s = String(value).trim();
  let m = /^#?([0-9a-f]{6})$/i.exec(s);
  if (m) return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)];
  m = /^#?([0-9a-f]{3})$/i.exec(s);
  if (m) return [0x11 * parseInt(m[1][0], 16), 0x11 * parseInt(m[1][1], 16), 0x11 * parseInt(m[1][2], 16)];
  m = /^rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i.exec(s);
  if (m) return [+m[1], +m[2], +m[3]].map(n => Math.max(0, Math.min(255, n)));
  const lower = s.toLowerCase();
  for (const name of Object.keys(GARMIN_COLOR_RGB)) {
    if (name.toLowerCase() === lower) return GARMIN_COLOR_RGB[name];
  }
  return null;
}

// Map any color value (Garmin name, CSS-like hex, rgb()) to the nearest Garmin
// enum name by weighted-Euclidean RGB distance. 'Transparent' passes through.
function nearestGarminName(value) {
  const s = String(value || '').trim();
  if (!s) return null;
  if (/^Transparent$/i.test(s)) return 'Transparent';
  for (const name of Object.keys(GARMIN_COLOR_RGB)) {
    if (name.toLowerCase() === s.toLowerCase()) return name;
  }
  const rgb = parseColorToRgb(s);
  if (!rgb) return null;
  let bestName = null, bestD = Infinity;
  for (const [name, [r, g, b]] of Object.entries(GARMIN_COLOR_RGB)) {
    const dr = rgb[0] - r, dg = rgb[1] - g, db = rgb[2] - b;
    const d = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
    if (d < bestD) { bestD = d; bestName = name; }
  }
  return bestName;
}

function readRouteDisplayColor(rte) {
  const ext  = firstChildElNS(rte, GPX_NS, 'extensions');
  const rext = firstChildElNS(ext, GPXX_NS, 'RouteExtension');
  const dc   = firstChildElNS(rext, GPXX_NS, 'DisplayColor');
  return dc ? dc.textContent : null;
}

function readTrackDisplayColor(trk) {
  const ext  = firstChildElNS(trk, GPX_NS, 'extensions');
  const text = firstChildElNS(ext, GPXX_NS, 'TrackExtension');
  const dc   = firstChildElNS(text, GPXX_NS, 'DisplayColor');
  return dc ? dc.textContent : null;
}

function readRumoRouteColor(rte) {
  const ext  = firstChildElNS(rte, GPX_NS, 'extensions');
  const rext = firstChildElNS(ext, RUMO_NS, 'RouteExtension');
  const dc   = firstChildElNS(rext, RUMO_NS, 'DisplayColor');
  return dc ? dc.textContent.trim() : null;
}

function readRumoTrackColor(trk) {
  const ext  = firstChildElNS(trk, GPX_NS, 'extensions');
  const text = firstChildElNS(ext, RUMO_NS, 'TrackExtension');
  const dc   = firstChildElNS(text, RUMO_NS, 'DisplayColor');
  return dc ? dc.textContent.trim() : null;
}

function readRumoShapingPoints(rte) {
  const ext  = firstChildElNS(rte, GPX_NS, 'extensions');
  const rext = firstChildElNS(ext, RUMO_NS, 'RouteExtension');
  const list = firstChildElNS(rext, RUMO_NS, 'ShapingPoints');
  if (!list) return [];
  const out = [];
  for (const sp of childrenByNS(list, RUMO_NS, 'ShapingPoint')) {
    const lat = parseFloat(sp.getAttribute('lat'));
    const lon = parseFloat(sp.getAttribute('lon'));
    if (Number.isFinite(lat) && Number.isFinite(lon)) out.push({ lat, lon });
  }
  return out;
}

function readRumoWaypointTags(wpt) {
  const ext    = firstChildElNS(wpt, GPX_NS, 'extensions');
  const wptExt = firstChildElNS(ext, RUMO_NS, 'WaypointExtension');
  const tagsEl = firstChildElNS(wptExt, RUMO_NS, 'WaypointTags');
  if (!tagsEl) return [];
  return tagsEl.textContent.split(',').map(s => s.trim()).filter(Boolean);
}

function buildColorExtensions(doc, localName, color) {
  const wrap = doc.createElementNS(GPX_NS, 'extensions');
  const ext  = doc.createElementNS(GPXX_NS, 'gpxx:' + localName);
  const dc   = doc.createElementNS(GPXX_NS, 'gpxx:DisplayColor');
  dc.textContent = color;
  ext.appendChild(dc);
  wrap.appendChild(ext);
  return wrap;
}

function ensureExtensions(doc, el) {
  let ext = firstChildElNS(el, GPX_NS, 'extensions');
  if (!ext) {
    ext = doc.createElementNS(GPX_NS, 'extensions');
    el.appendChild(ext);
  }
  return ext;
}

// Rumo schema accepts name-or-hex. Emit hex so any Rumo-aware consumer
// parses the color deterministically without relying on an implicit name set.
// Fall back to the canonical name when there's no RGB (Transparent).
function rumoColorValue(color) {
  const canonical = nearestGarminName(color);
  return garminNameToHex(canonical) || canonical || color;
}

function buildRumoColorExt(doc, wrapperName, color) {
  const ext = doc.createElementNS(RUMO_NS, 'rumo:' + wrapperName);
  const dc  = doc.createElementNS(RUMO_NS, 'rumo:DisplayColor');
  dc.textContent = rumoColorValue(color);
  ext.appendChild(dc);
  return ext;
}

function buildRumoShapingExt(doc, rteptEls) {
  const shaping = doc.createElementNS(RUMO_NS, 'rumo:ShapingPoints');
  for (const rtept of rteptEls) {
    const rpe = firstChildElNS(firstChildElNS(rtept, GPX_NS, 'extensions'), GPXX_NS, 'RoutePointExtension');
    if (!rpe) continue;
    for (const rpt of childrenByNS(rpe, GPXX_NS, 'rpt')) {
      const sp = doc.createElementNS(RUMO_NS, 'rumo:ShapingPoint');
      sp.setAttribute('lat', rpt.getAttribute('lat'));
      sp.setAttribute('lon', rpt.getAttribute('lon'));
      shaping.appendChild(sp);
    }
  }
  if (!shaping.firstChild) return null;
  const rext = doc.createElementNS(RUMO_NS, 'rumo:RouteExtension');
  rext.appendChild(shaping);
  return rext;
}

function convertRumoTagsToGarminCategories(wpt, doc) {
  const tags = readRumoWaypointTags(wpt);
  if (!tags.length) return false;
  const wptExt = doc.createElementNS(GPXX_NS, 'gpxx:WaypointExtension');
  const cats   = doc.createElementNS(GPXX_NS, 'gpxx:Categories');
  for (const t of tags) {
    const c = doc.createElementNS(GPXX_NS, 'gpxx:Category');
    c.textContent = t;
    cats.appendChild(c);
  }
  wptExt.appendChild(cats);
  const exts = ensureExtensions(doc, wpt);
  exts.appendChild(doc.createComment(' Garmin: categories from rumo:WaypointTags [' + tags.join(', ') + '] '));
  exts.appendChild(wptExt);
  return true;
}

function convertGarminCategoriesToRumoTags(wpt, doc) {
  const ext    = firstChildElNS(wpt, GPX_NS, 'extensions');
  const wptExt = firstChildElNS(ext, GPXX_NS, 'WaypointExtension');
  const cats   = firstChildElNS(wptExt, GPXX_NS, 'Categories');
  if (!cats) return false;
  const tags = childrenByNS(cats, GPXX_NS, 'Category')
    .map(c => c.textContent.trim()).filter(Boolean);
  if (!tags.length) return false;
  const rumoWptExt = doc.createElementNS(RUMO_NS, 'rumo:WaypointExtension');
  const rumoTags   = doc.createElementNS(RUMO_NS, 'rumo:WaypointTags');
  rumoTags.textContent = tags.join(',');
  rumoWptExt.appendChild(rumoTags);
  const exts = ensureExtensions(doc, wpt);
  exts.appendChild(doc.createComment(' Rumo: waypoint tags from gpxx:WaypointExtension/Categories [' + tags.join(', ') + '] '));
  exts.appendChild(rumoWptExt);
  return true;
}

/**
 * Auto-convert wpt extension data to core GPX 1.1 fields before stripping:
 *   gpxx:Address / wptx1:Address → <desc> if absent
 *   ctx:CreationTime → <wpt><time> if absent
 */
function convertWptExtensionData(wpt, doc) {
  const ext = firstChildElNS(wpt, GPX_NS, 'extensions');
  if (!ext) return;

  // Address → desc
  const gpxxWptExt  = firstChildElNS(ext, GPXX_NS,  'WaypointExtension');
  const wptx1WptExt = firstChildElNS(ext, WPTX1_NS, 'WaypointExtension');
  const wptExt = gpxxWptExt || wptx1WptExt;
  if (wptExt) {
    const extNS   = gpxxWptExt ? GPXX_NS : WPTX1_NS;
    const addrEl  = firstChildElNS(wptExt, extNS, 'Address');
    if (addrEl) {
      const street  = firstChildText(addrEl, extNS, 'StreetAddress');
      const city    = firstChildText(addrEl, extNS, 'City');
      const zip     = firstChildText(addrEl, extNS, 'PostalCode');
      const country = firstChildText(addrEl, extNS, 'Country');
      const parts   = [];
      if (street) parts.push(street);
      if (city && zip)   parts.push(city + ' ' + zip);
      else if (city)     parts.push(city);
      else if (zip)      parts.push(zip);
      if (country) parts.push(country);
      const phoneEl = firstChildElNS(wptExt, extNS, 'PhoneNumber');
      if (phoneEl && phoneEl.textContent.trim()) parts.push(phoneEl.textContent.trim());

      if (parts.length) {
        const descEl = firstChildElNS(wpt, GPX_NS, 'desc');
        if (!descEl || !descEl.textContent.trim()) {
          if (descEl) {
            descEl.textContent = parts.join(', ');
          } else {
            wpt.insertBefore(textEl(doc, GPX_NS, 'desc', parts.join(', ')), ext);
          }
        }
      }
    }
  }

  // ctx:CreationTime → <time> if absent
  const ctxExt = firstChildElNS(ext, CTX_NS, 'CreationTimeExtension');
  if (ctxExt) {
    const ctTime = firstChildText(ctxExt, CTX_NS, 'CreationTime');
    if (ctTime && !firstChildElNS(wpt, GPX_NS, 'time')) {
      wpt.insertBefore(textEl(doc, GPX_NS, 'time', ctTime), wpt.firstChild);
    }
  }
}

// ---------------------------------------------------------------------------
// Tree scrubbing

function walkElements(root, fn) {
  const stack = [root];
  while (stack.length) {
    const el = stack.pop();
    for (let c = el.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 1) stack.push(c);
    }
    fn(el);
  }
}


function hasThirdPartyExtension(root) {
  let found = false;
  walkElements(root, (el) => {
    if (!found && el.namespaceURI && !KNOWN_NAMESPACES.has(el.namespaceURI)) found = true;
  });
  return found;
}

function removeElementsByNS(root, ns, localName) {
  const list = Array.from(root.getElementsByTagNameNS(ns, localName));
  for (const el of list) if (el.parentNode) el.parentNode.removeChild(el);
}

function removeEmptyExtensions(root) {
  const victims = [];
  walkElements(root, (el) => {
    if (el.namespaceURI === GPX_NS && el.localName === 'extensions') {
      let hasChildEl = false;
      for (let c = el.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 1) { hasChildEl = true; break; }
      }
      if (!hasChildEl) victims.push(el);
    }
  });
  for (const el of victims) if (el.parentNode) el.parentNode.removeChild(el);
}

// ---------------------------------------------------------------------------
// Schema-ordered child insertion

function insertInOrder(gpx, newWpts, newRtes, newTrks) {
  for (const w of newWpts) gpx.appendChild(w);
  for (const r of newRtes) gpx.appendChild(r);
  for (const t of newTrks) gpx.appendChild(t);

  // Reorder all children into the canonical GPX 1.1 schema sequence:
  //   metadata, wpt*, rte*, trk*, extensions*
  const buckets = { metadata: [], wpt: [], rte: [], trk: [], extensions: [], other: [] };
  const kids = Array.from(gpx.childNodes);
  for (const k of kids) {
    if (k.nodeType !== 1) continue;
    const key = k.namespaceURI === GPX_NS && buckets[k.localName] ? k.localName : 'other';
    buckets[key].push(k);
    gpx.removeChild(k);
  }
  const doc = gpx.ownerDocument;
  for (const m of buckets.metadata)   gpx.appendChild(m);
  if (buckets.wpt.length) gpx.appendChild(doc.createComment(' Waypoints '));
  for (const w of buckets.wpt)        gpx.appendChild(w);
  if (buckets.rte.length) gpx.appendChild(doc.createComment(' Routes '));
  for (const r of buckets.rte)        gpx.appendChild(r);
  if (buckets.trk.length) gpx.appendChild(doc.createComment(' Tracks '));
  for (const t of buckets.trk)        gpx.appendChild(t);
  for (const o of buckets.other)      gpx.appendChild(o);
  for (const e of buckets.extensions) gpx.appendChild(e);
}

function refreshMetadataTime(gpx, doc) {
  let metadata = firstChildElNS(gpx, GPX_NS, 'metadata');
  if (!metadata) {
    metadata = doc.createElementNS(GPX_NS, 'metadata');
    gpx.insertBefore(metadata, gpx.firstChild);
  }
  let t = firstChildElNS(metadata, GPX_NS, 'time');
  if (!t) {
    t = doc.createElementNS(GPX_NS, 'time');
    metadata.appendChild(t);
  }
  t.textContent = new Date().toISOString();
}

function prettyPrint(node, depth) {
  const indent = '\n' + '  '.repeat(depth);
  const childIndent = '\n' + '  '.repeat(depth + 1);
  const doc = node.ownerDocument || node;

  // Collect child nodes, skipping existing whitespace-only text nodes.
  const children = Array.from(node.childNodes).filter(
    c => !(c.nodeType === 3 && c.textContent.trim() === '')
  );
  if (!children.length) return;

  // Mixed-content check: if any child is a non-whitespace text node, don't indent.
  const hasMixedText = children.some(c => c.nodeType === 3);
  if (hasMixedText) return;

  // Remove existing whitespace text children, then re-insert with indentation.
  while (node.firstChild) node.removeChild(node.firstChild);

  for (const child of children) {
    node.appendChild(doc.createTextNode(childIndent));
    node.appendChild(child);
    if (child.nodeType === 1) prettyPrint(child, depth + 1);
  }
  node.appendChild(doc.createTextNode(indent));
}

function scrubNamespaceDeclarations(gpx) {
  // Collect all namespace URIs actually used in the output tree.
  const usedNS = new Set();
  walkElements(gpx, (el) => { if (el.namespaceURI) usedNS.add(el.namespaceURI); });

  // Ensure default namespace.
  gpx.setAttribute('xmlns', GPX_NS);

  // Ensure xmlns:gpxx and xmlns:rumo are present/absent based on usage.
  if (usedNS.has(GPXX_NS)) gpx.setAttribute('xmlns:gpxx', GPXX_NS);
  else if (gpx.hasAttribute('xmlns:gpxx')) gpx.removeAttribute('xmlns:gpxx');

  if (usedNS.has(RUMO_NS)) gpx.setAttribute('xmlns:rumo', RUMO_NS);
  else if (gpx.hasAttribute('xmlns:rumo')) gpx.removeAttribute('xmlns:rumo');

  // For all other xmlns:* declarations: keep only those whose namespace is used.
  const attrs = Array.from(gpx.attributes);
  for (const a of attrs) {
    if (!a.name.startsWith('xmlns:')) continue;
    const prefix = a.name.slice(6);
    if (prefix === 'gpxx') continue; // handled above
    if (prefix === 'xsi')  continue; // handled below
    if (!usedNS.has(a.value)) gpx.removeAttributeNode(a);
  }

  // schemaLocation: keep only tokens whose namespace is still referenced.
  const schemaLoc = gpx.getAttributeNS(XSI_NS, 'schemaLocation')
                 || gpx.getAttribute('xsi:schemaLocation');
  if (schemaLoc) {
    const toks = schemaLoc.trim().split(/\s+/);
    const kept = [];
    for (let i = 0; i + 1 < toks.length; i += 2) {
      if (usedNS.has(toks[i])) kept.push(toks[i], toks[i + 1]);
    }
    if (kept.length) {
      gpx.setAttribute('xsi:schemaLocation', kept.join(' '));
      gpx.setAttribute('xmlns:xsi', XSI_NS);
    } else {
      if (gpx.hasAttribute('xsi:schemaLocation')) gpx.removeAttribute('xsi:schemaLocation');
      gpx.removeAttributeNS(XSI_NS, 'schemaLocation');
      if (gpx.hasAttribute('xmlns:xsi')) gpx.removeAttribute('xmlns:xsi');
    }
  } else if (gpx.hasAttribute('xmlns:xsi')) {
    gpx.removeAttribute('xmlns:xsi');
  }
}

function computeBounds(gpx) {
  let minLat = Infinity, minLon = Infinity, maxLat = -Infinity, maxLon = -Infinity;
  const scan = (el) => {
    const lat = parseFloat(el.getAttribute('lat'));
    const lon = parseFloat(el.getAttribute('lon'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
  };
  for (const el of gpx.getElementsByTagNameNS(GPX_NS, 'wpt'))   scan(el);
  for (const el of gpx.getElementsByTagNameNS(GPX_NS, 'rtept')) scan(el);
  for (const el of gpx.getElementsByTagNameNS(GPX_NS, 'trkpt')) scan(el);
  if (minLat === Infinity) return null;
  return { minLat, minLon, maxLat, maxLon };
}

// ---------------------------------------------------------------------------
// Ramer–Douglas–Peucker with forced anchors

export function rdpWithAnchors(points, toleranceM) {
  const keep = new Array(points.length).fill(false);
  if (points.length === 0) return keep;
  if (points.length === 1) { keep[0] = true; return keep; }

  const anchorIdx = [];
  for (let i = 0; i < points.length; i++) if (points[i].anchor) anchorIdx.push(i);
  if (anchorIdx[0] !== 0)                         anchorIdx.unshift(0);
  if (anchorIdx[anchorIdx.length - 1] !== points.length - 1) anchorIdx.push(points.length - 1);
  for (const i of anchorIdx) keep[i] = true;

  for (let i = 0; i < anchorIdx.length - 1; i++) {
    rdpSegment(points, anchorIdx[i], anchorIdx[i + 1], toleranceM, keep);
  }
  return keep;
}

function rdpSegment(points, lo, hi, tol, keep) {
  if (hi - lo < 2) return;
  const stack = [[lo, hi]];
  while (stack.length) {
    const [a, b] = stack.pop();
    if (b - a < 2) continue;
    let maxD = 0, maxI = -1;
    for (let i = a + 1; i < b; i++) {
      const d = perpDistanceM(points[i], points[a], points[b]);
      if (d > maxD) { maxD = d; maxI = i; }
    }
    if (maxD > tol && maxI > 0) {
      keep[maxI] = true;
      stack.push([a, maxI], [maxI, b]);
    }
  }
}

// Equirectangular projection to local meters, then perpendicular distance
// from p to segment a-b. Accurate enough for the scale of a single leg.
// Assign each shaping point (in order) to the rtept-to-rtept segment it fits
// best, with forward-only advancement: once a later shape picks segment S, no
// later shape picks a segment before S. Returns a Map of rteptIndex → coords[].
// The shape attaches to the rtept at the *start* of the chosen segment, which
// matches Garmin's convention (rtept N owns the shape between N and N+1).
function assignShapingToRtepts(shapingPts, rteptCoords) {
  const partitions = new Map();
  const segCount = rteptCoords.length - 1;
  if (segCount < 1 || !shapingPts.length) return partitions;

  let minSeg = 0;
  for (const p of shapingPts) {
    let bestSeg = minSeg, bestD = Infinity;
    for (let i = minSeg; i < segCount; i++) {
      const d = perpDistanceM(p, rteptCoords[i], rteptCoords[i + 1]);
      if (d < bestD) { bestD = d; bestSeg = i; }
    }
    if (!partitions.has(bestSeg)) partitions.set(bestSeg, []);
    partitions.get(bestSeg).push(p);
    minSeg = bestSeg;
  }
  return partitions;
}

function perpDistanceM(p, a, b) {
  const R = 6371008.8;
  const lat0 = (a.lat + b.lat) * 0.5 * Math.PI / 180;
  const cosLat0 = Math.cos(lat0);
  const toXY = (pt) => [
    (pt.lon * Math.PI / 180) * R * cosLat0,
    (pt.lat * Math.PI / 180) * R,
  ];
  const [ax, ay] = toXY(a);
  const [bx, by] = toXY(b);
  const [px, py] = toXY(p);
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

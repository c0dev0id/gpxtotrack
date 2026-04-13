// gpxtotrack — convert a Garmin GPX route file into an enriched GPX containing
// a clean GPX 1.1 route (densified from Garmin's shaping points), a dense track
// flattened from RoutePointExtension, and the waypoints.
//
// Pure function: no DOM side effects, runs in any environment that provides
// DOMParser and XMLSerializer.

export const GPX_NS  = 'http://www.topografix.com/GPX/1/1';
export const GPXX_NS = 'http://www.garmin.com/xmlschemas/GpxExtensions/v3';
const XSI_NS   = 'http://www.w3.org/2001/XMLSchema-instance';
const TRP_NS   = 'http://www.garmin.com/xmlschemas/TripExtensions/v1';
const CTX_NS   = 'http://www.garmin.com/xmlschemas/CreationTimeExtension/v1';
const WPTX1_NS = 'http://www.garmin.com/xmlschemas/WaypointExtension/v1';

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
  GPX_NS, GPXX_NS, XSI_NS, TRP_NS, CTX_NS, WPTX1_NS,
  ...DROP_NAMESPACES,
]);

// Within the gpxx namespace only these local names are ever kept in the output.
const GPXX_KEEP = new Set(['RouteExtension', 'TrackExtension', 'DisplayColor']);

/**
 * Convert a Garmin GPX route file to an enriched GPX.
 *
 * @param {string} gpxString - input GPX XML.
 * @param {object} [options]
 * @param {number}  [options.toleranceM=10]           - RDP tolerance in meters for the output route.
 * @param {boolean} [options.keepRteptWaypoints=false] - also emit labeled rtepts as <wpt>.
 * @param {'keep'|'remove'} [options.displayColor='keep']    - keep or remove gpxx:DisplayColor.
 * @param {'keep'|'remove'} [options.routingMeta='remove']   - keep or remove trp: routing metadata.
 * @param {'keep'|'remove'} [options.thirdPartyExt='remove'] - keep or remove non-Garmin extensions.
 * @param {DOMParser}     [options.DOMParserImpl]
 * @param {XMLSerializer} [options.XMLSerializerImpl]
 * @returns {{ gpx: string, stats: object }}
 */
export function convert(gpxString, options = {}) {
  const toleranceM       = options.toleranceM ?? 10;
  const keepRteptWaypoints = !!options.keepRteptWaypoints;
  const displayColor     = options.displayColor   ?? 'keep';
  const routingMeta      = options.routingMeta    ?? 'remove';
  const thirdPartyExt    = options.thirdPartyExt  ?? 'remove';

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

  const stats = {
    routes: 0,
    inputRtepts: 0,
    inputRpts: 0,
    outputRtepts: 0,
    outputTrkpts: 0,
    inputWaypoints: 0,
    outputWaypoints: 0,
    bounds: null,
  };

  const inputRtes      = Array.from(childrenByNS(gpx, GPX_NS, 'rte'));
  const hasExistingTrks = childrenByNS(gpx, GPX_NS, 'trk').length > 0;

  stats.inputWaypoints = childrenByNS(gpx, GPX_NS, 'wpt').length;

  // Auto-convert wpt extension data (address → desc, ctx:CreationTime → time)
  // before any stripping so the data isn't lost.
  for (const wpt of childrenByNS(gpx, GPX_NS, 'wpt')) {
    convertWptExtensionData(wpt, doc);
  }

  const newWaypoints = [];
  const newTracks    = [];
  const newRoutes    = [];

  for (const rte of inputRtes) {
    stats.routes++;
    const rteptEls = Array.from(childrenByNS(rte, GPX_NS, 'rtept'));
    stats.inputRtepts += rteptEls.length;

    // Build merged ordered point list with metadata.
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
        const rpts = Array.from(childrenByNS(rpe, GPXX_NS, 'rpt'));
        stats.inputRpts += rpts.length;
        for (const rpt of rpts) {
          merged.push({
            lat: parseFloat(rpt.getAttribute('lat')),
            lon: parseFloat(rpt.getAttribute('lon')),
            ele: null, time: null,
            fromRtept: false, rteptEl: null, anchor: false,
          });
        }
      }
    }

    // Dedupe consecutive identical coords.
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

    // Build the new track only when the input has no pre-existing tracks.
    if (!hasExistingTrks) {
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
      stats.outputTrkpts += deduped.length;

      if (displayColor === 'keep') {
        const color = readRouteDisplayColor(rte);
        if (color) trk.appendChild(buildColorExtensions(doc, 'TrackExtension', color));
      }

      newTracks.push(trk);
    }

    // Route densification via Ramer–Douglas–Peucker.
    const keepFlags = rdpWithAnchors(deduped, toleranceM);
    const newRte = doc.createElementNS(GPX_NS, 'rte');
    copyChildren(rte, newRte, GPX_NS, ['name', 'desc', 'cmt', 'src', 'link', 'type', 'number']);

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
        // Optionally copy trp: extensions from original rtept to output rtept.
        if (routingMeta === 'keep') {
          copyNsChildren(p.rteptEl, rtept, doc, GPX_NS, TRP_NS);
        }
        if (keepRteptWaypoints && hasAnyNamedField(p.rteptEl)) {
          newWaypoints.push(buildWaypointFromRtept(doc, p));
        }
      }
      newRte.appendChild(rtept);
      stats.outputRtepts++;
    }

    // Collect route-level extensions to attach to the new <rte>.
    const rteExts = [];
    if (displayColor === 'keep') {
      const color = readRouteDisplayColor(rte);
      if (color) {
        const rext = doc.createElementNS(GPXX_NS, 'gpxx:RouteExtension');
        const dc   = doc.createElementNS(GPXX_NS, 'gpxx:DisplayColor');
        dc.textContent = color;
        rext.appendChild(dc);
        rteExts.push(rext);
      }
    }
    if (routingMeta === 'keep') {
      collectNsChildren(rte, GPX_NS, TRP_NS, rteExts);
    }
    if (thirdPartyExt === 'keep') {
      collectThirdPartyChildren(rte, GPX_NS, rteExts);
    }
    if (rteExts.length) {
      const wrap = doc.createElementNS(GPX_NS, 'extensions');
      for (const el of rteExts) wrap.appendChild(el);
      newRte.appendChild(wrap);
    }

    newRoutes.push(newRte);
    rte.parentNode.removeChild(rte);
  }

  // Strip routing metadata from preserved elements (wpts etc.) unless keeping.
  if (routingMeta === 'remove') stripNamespace(gpx, TRP_NS);

  // Strip always-drop namespaces (TrackPointExtension, WaypointExtension, ctx:, etc.).
  stripDropNamespaces(gpx);

  // Strip gpxx elements; conditionally keep color-related ones.
  const gpxxKeep = displayColor === 'keep' ? GPXX_KEEP : new Set();
  stripGpxxExcept(gpx, gpxxKeep);

  // Defensive: remove any leftover RoutePointExtension.
  removeElementsByNS(gpx, GPXX_NS, 'RoutePointExtension');

  // Strip third-party extensions from preserved elements unless keeping.
  if (thirdPartyExt === 'remove') stripThirdPartyExtensions(gpx);

  removeEmptyExtensions(gpx);

  // Insert new elements; existing tracks survive via insertInOrder's bucket sort.
  insertInOrder(gpx, newWaypoints, newRoutes, newTracks);
  stats.outputWaypoints = childrenByNS(gpx, GPX_NS, 'wpt').length;

  // Count trkpts for the existing-track path (synthesis path already counted above).
  if (hasExistingTrks) {
    for (const trk of childrenByNS(gpx, GPX_NS, 'trk')) {
      stats.outputTrkpts += trk.getElementsByTagNameNS(GPX_NS, 'trkpt').length;
    }
  }

  // Namespace / metadata hygiene.
  gpx.setAttribute('version', '1.1');
  gpx.setAttribute('creator', 'gpxtotrack');
  refreshMetadataTime(gpx, doc);
  scrubNamespaceDeclarations(gpx);

  stats.bounds = computeBounds(gpx);

  const xml = new Serializer().serializeToString(doc);
  const out = xml.startsWith('<?xml')
    ? xml
    : '<?xml version="1.0" encoding="UTF-8"?>\n' + xml;
  return { gpx: out, stats };
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

function readRouteDisplayColor(rte) {
  const ext  = firstChildElNS(rte, GPX_NS, 'extensions');
  const rext = firstChildElNS(ext, GPXX_NS, 'RouteExtension');
  const dc   = firstChildElNS(rext, GPXX_NS, 'DisplayColor');
  return dc ? dc.textContent : null;
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

/**
 * Copy direct children of srcEl's <extensions> that match `childNS` into
 * dstEl's <extensions> (creating the wrapper if absent).
 */
function copyNsChildren(srcEl, dstEl, doc, wrapNS, childNS) {
  const srcExt = firstChildElNS(srcEl, wrapNS, 'extensions');
  if (!srcExt) return;
  const toAdd = [];
  for (let c = srcExt.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === 1 && c.namespaceURI === childNS) toAdd.push(c);
  }
  if (!toAdd.length) return;
  let dstExt = firstChildElNS(dstEl, wrapNS, 'extensions');
  if (!dstExt) {
    dstExt = doc.createElementNS(wrapNS, 'extensions');
    dstEl.appendChild(dstExt);
  }
  for (const el of toAdd) dstExt.appendChild(el.cloneNode(true));
}

/**
 * Collect clones of direct children of el's <extensions> that match `childNS`
 * into an output array (used to build route-level extensions before attaching).
 */
function collectNsChildren(el, wrapNS, childNS, out) {
  const ext = firstChildElNS(el, wrapNS, 'extensions');
  if (!ext) return;
  for (let c = ext.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === 1 && c.namespaceURI === childNS) out.push(c.cloneNode(true));
  }
}

/**
 * Collect clones of direct children of el's <extensions> whose namespace is
 * not in KNOWN_NAMESPACES (third-party elements).
 */
function collectThirdPartyChildren(el, wrapNS, out) {
  const ext = firstChildElNS(el, wrapNS, 'extensions');
  if (!ext) return;
  for (let c = ext.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === 1 && c.namespaceURI && !KNOWN_NAMESPACES.has(c.namespaceURI)) {
      out.push(c.cloneNode(true));
    }
  }
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

function stripDropNamespaces(root) {
  const victims = [];
  walkElements(root, (el) => {
    if (el.namespaceURI && DROP_NAMESPACES.has(el.namespaceURI)) victims.push(el);
  });
  for (const el of victims) if (el.parentNode) el.parentNode.removeChild(el);
}

function stripGpxxExcept(root, allowedLocalNames) {
  const victims = [];
  walkElements(root, (el) => {
    if (el.namespaceURI === GPXX_NS && !allowedLocalNames.has(el.localName)) victims.push(el);
  });
  for (const el of victims) if (el.parentNode) el.parentNode.removeChild(el);
}

function stripNamespace(root, ns) {
  const list = Array.from(root.getElementsByTagNameNS(ns, '*'));
  for (const el of list) if (el.parentNode) el.parentNode.removeChild(el);
}

function stripThirdPartyExtensions(root) {
  const victims = [];
  walkElements(root, (el) => {
    if (el.namespaceURI && !KNOWN_NAMESPACES.has(el.namespaceURI)) victims.push(el);
  });
  for (const el of victims) if (el.parentNode) el.parentNode.removeChild(el);
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
  for (const m of buckets.metadata)   gpx.appendChild(m);
  for (const w of buckets.wpt)        gpx.appendChild(w);
  for (const r of buckets.rte)        gpx.appendChild(r);
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

function scrubNamespaceDeclarations(gpx) {
  // Collect all namespace URIs actually used in the output tree.
  const usedNS = new Set();
  walkElements(gpx, (el) => { if (el.namespaceURI) usedNS.add(el.namespaceURI); });

  // Ensure default namespace.
  gpx.setAttribute('xmlns', GPX_NS);

  // Ensure xmlns:gpxx is present/absent based on usage
  // (buildColorExtensions uses createElementNS so we always need an explicit declaration).
  if (usedNS.has(GPXX_NS)) gpx.setAttribute('xmlns:gpxx', GPXX_NS);
  else if (gpx.hasAttribute('xmlns:gpxx')) gpx.removeAttribute('xmlns:gpxx');

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

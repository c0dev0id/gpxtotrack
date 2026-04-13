# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project intent

`gpxtotrack` takes a Garmin GPX route file and produces an enriched GPX containing:

- a clean GPX 1.1 `<rte>` with a sensible number of extra `<rtept>` elements promoted from `gpxx:RoutePointExtension/<rpt>` so the shape survives without needing a Garmin extension,
- a dense GPX 1.1 `<trk>` built by flattening every rtept + rpt in order,
- the `<wpt>` list (preserved; optionally augmented with labeled rtepts via a UI toggle).

Constraints:

- **Pure client-side JavaScript.** No server, no build step, no runtime deps. Served as-is from GitHub Pages.
- **Generic GPX 1.1 storage.** A Garmin extension is retained only when GPX 1.1 cannot express the feature. In practice that is just `gpxx:RouteExtension/DisplayColor` on `<rte>` and `gpxx:TrackExtension/DisplayColor` on `<trk>` (color has no GPX 1.1 equivalent). Waypoint icon/color is encoded in core `<sym>` per Garmin's symbol-name convention (e.g. `"Flag, Blue"`). Everything else Garmin (`gpxtpx`, `gpxtrkx`, `gpxpx`, `gpxacc`, `gpxwptx1`, `gpxx:WaypointExtension`, `gpxx:RoutePointExtension`, `gpxx:RouteExtension/IsAutoNamed`) is stripped from output.

## Project layout

- `index.html`, `app.js`, `style.css` — the static UI. ES module, no bundler.
- `gpxtotrack.js` — the conversion library. Exports `convert(gpxString, options)` as a pure function returning `{ gpx: string, stats: object }`. No DOM side effects — safe to import in tests or any DOM-capable environment. Also exports `rdpWithAnchors` for unit testing the simplifier.
- `test.html`, `test.js`, `tests.js` — in-browser test harness. `tests.js` holds the test definitions; `test.js` is the browser glue.
- `run-tests.mjs` — headless runner (Playwright → Chromium) that drives `test.html` and exits non-zero on failure.
- `e2e-check.mjs` — end-to-end smoke test: drives the real UI at `index.html`, converts each fixture, validates output with `xmllint`.
- `fixtures/*.gpx` — test inputs (minimal, BaseCamp-style, colored, with-waypoints, mixed rte+trk).

## Running and testing

There is no `package.json`. The tool runs by serving the repo root statically:

```
http-server -p 8000 .           # any static server works
# open http://localhost:8000/
```

Tests (require Playwright with a Chromium install — globally installed in the dev env here, otherwise `npm i playwright && npx playwright install chromium`):

```
http-server -p 8765 -s . &
SERVER_PID=$!
node run-tests.mjs http://localhost:8765/    # unit-style assertions
node e2e-check.mjs  http://localhost:8765/   # UI flow + xmllint validation
kill $SERVER_PID
```

The runners auto-resolve Playwright from `/opt/node22/lib/node_modules/playwright/index.mjs`; override with `PLAYWRIGHT_MODULE` env var if needed.

## Conversion algorithm (where to look when changing behavior)

All core logic is in `gpxtotrack.js` as a single `convert()` pipeline:

1. **Track synthesis** (per `<rte>`): merge rtepts + each rtept's `gpxx:rpt` list, dedupe consecutive identical lat/lon (firmware quirk — some devices repeat the rtept as the first rpt of its segment), emit `<trkpt>` for each.
2. **Route densification**: run Ramer–Douglas–Peucker simplification (`rdpWithAnchors`, equirectangular perpendicular distance in meters) with named rtepts pinned as anchors, write survivors as the output `<rte>`'s `<rtept>` chain.
3. **Color passthrough**: read `gpxx:RouteExtension/DisplayColor` once, emit it on both the new `<rte>` (as `RouteExtension`) and the new `<trk>` (as `TrackExtension`).
4. **Extension filter**: delete every element in any namespace on the drop list and every `gpxx:*` element whose local name is not `RouteExtension`, `TrackExtension`, or `DisplayColor`. Remove empty `<extensions>` parents.
5. **Schema-order reshuffle**: sort `<gpx>` children into the canonical order `metadata, wpt*, rte*, trk*, extensions*`.
6. **Namespace scrub**: decide whether `xmlns:gpxx` is still needed by walking the output; drop every other `xmlns:*` declaration, trim `xsi:schemaLocation` to only the namespaces still referenced.

## Branching

Development for Claude-driven work happens on `claude/init-project-nwage`. `main` is the GitHub Pages source — do not push experimental commits there.

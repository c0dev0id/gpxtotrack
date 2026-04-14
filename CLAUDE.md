# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project intent

`gpxtotrack` takes a Garmin GPX file and produces a cleaned GPX with per-route/track control:

- Each route can be kept (verbatim or densified) or removed, with optional track synthesis.
- Each track can be kept or removed.
- Extensions are individually toggleable per-route/track with sensible defaults.
- Waypoints are preserved with optional address auto-conversion.

Constraints:

- **Pure client-side JavaScript.** No server, no build step, no runtime deps. Served as-is from GitHub Pages.
- **User-driven extension control.** Extensions that the tool actively converts (RPE, Subclass, IsAutoNamed, WaypointExtension, CreationTimeExtension) default to remove. Everything else (DisplayColor, TRP extensions, third-party, unknown) defaults to keep. Users can override any default.

## Project layout

- `index.html`, `app.js`, `style.css` — the static UI. ES module, no bundler.
- `gpxtotrack.js` — the conversion library. Exports `convert(gpxString, options)`, `analyzeInput(gpxString)`, and `rdpWithAnchors` as pure functions. `convert()` takes per-route/track options arrays. No DOM side effects — safe to import in tests or any DOM-capable environment.
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

The runners auto-resolve Playwright from `./node_modules/playwright/index.mjs`; override with `PLAYWRIGHT_MODULE` env var if needed.

## Conversion algorithm (where to look when changing behavior)

All core logic is in `gpxtotrack.js`. Two main exports:

### `analyzeInput(gpxString)` — input analysis
Returns structured info: per-route (name, rteptCount, shapingPointCount, isTrip, isRoutePointExt, extensions[]), per-track (name, trkptCount, extensions[]), waypoint extensions, bounds. Extension enumeration unwraps known wrappers (RouteExtension, TrackExtension, WaypointExtension) to expose individual extensions.

### `convert(gpxString, options)` — per-route/track pipeline
For each route (using `options.routes[i]`):
1. **Merge + dedupe**: rtepts + gpxx:rpt shaping points, dedupe consecutive identical coords.
2. **Track synthesis** (if `createTrack`): flatten merged points to `<trkpt>`. Copy DisplayColor if kept.
3. **Route output** (if `keep`): either densify via RDP (`createDenseRoute`) or clone original verbatim. Clone extensions, then apply `applyExtensionDecisions()`.
4. **Waypoint promotion** (if `addRteptsToWaypoints`): named rtepts become `<wpt>`.

For each track (using `options.tracks[i]`): keep or remove, with extension decisions.

Global steps:
5. **Wpt auto-conversion**: Address → desc, CreationTime → time (before extension filtering).
6. **Schema-order reshuffle**: metadata, wpt*, rte*, trk*, extensions.
7. **Namespace scrub**: keep only used xmlns:* declarations.

## Branching

Development for Claude-driven work happens on `claude/init-project-nwage`. `main` is the GitHub Pages source — do not push experimental commits there.

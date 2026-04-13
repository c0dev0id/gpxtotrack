# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project intent

`gpxtotrack` is a converter that takes Garmin GPX route files and produces GPX track files. Per the README:

- It must be a **pure JavaScript** tool (client-side only — no server, no build step required for runtime).
- It is **hosted on GitHub Pages**, so the default branch must be servable as a static site (typically `index.html` + JS at the repo root, or under `/docs`).
- It must support Garmin's **route point extension** (`<gpxx:RoutePointExtension>` inside `<rtept>`) as well as other common Garmin extensions — these carry the intermediate shaping points that turn a sparse route into a dense track.

## Current state

The repository is effectively empty: only `README.md` exists on the default branch. There is no source code, no `package.json`, no tests, and no build tooling yet. Any "how to build/test/run" instructions would be fabricated — do not invent them. When adding the first implementation:

- Prefer a zero-build static site (plain `.html` + `.js`) so GitHub Pages can serve it directly. Only introduce a bundler if a concrete need forces it.
- Keep the conversion logic as a pure function over the parsed GPX DOM so it can be unit-tested independently of the page UI.

## GPX conversion domain notes

When implementing the converter, the core transformation is:

- Input: a `<rte>` containing `<rtept>` elements. Each `<rtept>` may contain a Garmin `<extensions><gpxx:RoutePointExtension><gpxx:rpt>` list of shaping points (lat/lon only, no time).
- Output: a `<trk>` / `<trkseg>` with one `<trkpt>` per shaping point (and per route point), in order. Route point `<rtept>` coordinates themselves are included as track points at the appropriate positions.
- Namespaces to preserve/declare on output: `http://www.topografix.com/GPX/1/1` and `http://www.garmin.com/xmlschemas/GpxExtensions/v3` (prefix `gpxx`). Other Garmin namespaces (TrackPointExtension v1/v2, TrackStatsExtension) may appear on input and should be tolerated.
- Parse with `DOMParser` and serialise with `XMLSerializer` — both are available in the browser, which keeps the "pure JS, no dependencies" constraint.

## Branching

Development for Claude-driven work happens on `claude/init-project-nwage`. `main` is the GitHub Pages source — do not push experimental commits there.

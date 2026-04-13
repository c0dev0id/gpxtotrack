# Development Journal

## Software Stack

- **Runtime**: Pure browser ES modules — no build step, no bundler, no runtime deps.
- **Deployment**: GitHub Pages (serves repo root directly).
- **Test runner**: In-browser test harness (`test.html` + `test.js` + `tests.js`).
  Headless execution via Chrome CDP (custom runner in `/tmp/run-tests-node.mjs`) since
  Playwright does not support OpenBSD.
- **XML**: Browser `DOMParser` / `XMLSerializer`. Validation via `xmllint`.
- **GPX spec**: GPX 1.1 (Topografix). Garmin extensions: `gpxx:` (GpxExtensions/v3).

## Key Decisions

### No server, no bundler (initial)
Static files served as-is. Keeps complexity minimal and deployment trivial.
All code must run in a browser environment.

### Two-step UI flow (commit f859964)
File load → summarize input (fast) → preview conversion → Convert button.
Avoids re-running conversion on every option change without explicit action.
Actually changed to: preview is live (recomputed on option change), Convert downloads.

### RDP simplifier with anchors (initial)
Ramer–Douglas–Peucker with named rtepts pinned as anchors. Equirectangular perpendicular
distance in meters. Accurate enough at route-leg scale.

### Extension-aware conversion with user choices (2026-04-13)
The goal is "as clean as possible GPX 1.1" with user control over the few items that have
no lossless GPX 1.1 equivalent:
- `displayColor` ('keep'|'remove'): only feature with no GPX 1.1 equivalent.
- `routingMeta` ('keep'|'remove'): trp: via-point/shaping-point markers; Garmin-only.
- `thirdPartyExt` ('keep'|'remove'): e.g. rumo: routing profile from DMD Hub.

**Why defaults are keep/remove/remove**: Color is visible and users expect it; routing
metadata and third-party extensions are invisible to non-Garmin tools.

### No track synthesis when existing tracks present (2026-04-13)
If the input has `<trk>` elements, do not synthesize a new one from the route. The existing
track is presumed to be the authoritative recording; synthesizing a second one is confusing.
The route pipeline still runs to produce a cleaned `<rte>`.

**Why**: The old behavior (always synthesize) produced duplicate geometry in the mixed case,
which confused receiving devices.

### Pass-through for track-only and wpt-only files (2026-04-13)
Instead of throwing "No <rte> elements", files with only tracks or waypoints are cleaned
(Garmin extensions stripped) and returned. This makes the tool useful for extension-cleaning
even on non-route files.

### KNOWN_NAMESPACES allowlist for third-party detection (2026-04-13)
Rather than a growing denylist, any namespace URI not in KNOWN_NAMESPACES is third-party.
This correctly handles novel namespaces from any tool without explicit enumeration.

### Wpt address auto-conversion (2026-04-13)
gpxx:Address / wptx1:Address → `<desc>` if absent; ctx:CreationTime → `<time>` if absent.
This preserves data that would otherwise be silently lost when stripping extensions.
Runs before any stripping so the source elements are still present.

### Namespace scrub generalization (2026-04-13)
`scrubNamespaceDeclarations` now walks the output tree to collect used namespace URIs,
then keeps xmlns:* declarations only for those URIs. This correctly handles the
`thirdPartyExt='keep'` case where third-party namespace declarations must survive.

## Core Features

1. **Route densification**: Merge `<rtept>` + `<gpxx:rpt>` shaping points, dedupe, run RDP.
   Named rtepts are anchors (always kept). Output `<rte>` has clean route points.
2. **Track synthesis**: Flatten all merged points to `<trkpt>`. Skipped if existing tracks
   are present in the input.
3. **Color passthrough**: `gpxx:DisplayColor` on route → both output `<rte>` and `<trk>`.
   User-controlled via `displayColor` option.
4. **Extension filter**: Drop-list (always); gpxx selective keep; conditional trp: strip;
   conditional third-party strip.
5. **Wpt extension auto-conversion**: Address → desc; CreationTime → time.
6. **Schema-order reorder**: metadata, wpt*, rte*, trk*, extensions (GPX 1.1 canonical).
7. **Namespace scrub**: Remove unused xmlns:* declarations, trim xsi:schemaLocation.
8. **Feature detection**: `summarizeInput()` returns `features` object for UI visibility.

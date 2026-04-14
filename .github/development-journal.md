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

### Per-route/track control with 3-column layout (2026-04-14)
Full UI redesign: upload → `analyzeInput()` → render input & options columns → user
configures per-route/track options → Convert → `convert(sourceText, perElementOptions)`
→ `analyzeInput(output)` → render output column → Download.

**Why**: The old global options couldn't distinguish between routes that should be kept vs
removed (e.g. duplicate exports from Scenic with plain/Trip/RPE variants). Per-element
control lets users decide individually, with smart defaults (Trip/RPE variants default to
Remove). Dynamic extension listing means new extension types are automatically surfaced.

### Two-step UI flow (superseded by per-route/track control above)
Originally: File load → summarize input → preview conversion → Convert button.
Changed to live preview, then redesigned again with explicit Convert button and
per-element options (2026-04-14).

### RDP simplifier with anchors (initial)
Ramer–Douglas–Peucker with named rtepts pinned as anchors. Equirectangular perpendicular
distance in meters. Accurate enough at route-leg scale.

### Extension-aware conversion with per-element decisions (2026-04-14, supersedes 2026-04-13)
Each extension is individually toggleable. Classification rules:
- **Default remove**: Extensions the tool actively converts/discards (RPE, Subclass,
  IsAutoNamed, WaypointExtension, CreationTimeExtension).
- **Default keep**: Everything else (DisplayColor, TRP extensions, third-party, unknown).

Wrapper unwrapping: RouteExtension, TrackExtension, WaypointExtension are "wrappers" —
their children are enumerated individually. RoutePointExtension is NOT a wrapper (it's
removed as a whole since its data is merged into route/track points).

`applyExtensionDecisions()` replaces all namespace-level strip functions with a single
decision-driven filter that works at the individual extension element level.

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

1. **Per-route/track control**: Each route and track gets individual keep/remove, conversion
   options, and per-extension decisions. No automatic deduplication.
2. **Route densification**: Merge `<rtept>` + `<gpxx:rpt>` shaping points, dedupe, run RDP.
   Named rtepts are anchors (always kept). Per-route tolerance control.
3. **Track synthesis**: Flatten all merged points to `<trkpt>`. Per-route opt-in.
4. **Dynamic extension discovery**: `analyzeInput()` enumerates all extensions with smart
   defaults. `applyExtensionDecisions()` filters per user choices.
5. **Wpt extension auto-conversion**: Address → desc; CreationTime → time. Runs before
   extension filtering to preserve data.
6. **Schema-order reorder**: metadata, wpt*, rte*, trk*, extensions (GPX 1.1 canonical).
7. **Namespace scrub**: Remove unused xmlns:* declarations, trim xsi:schemaLocation.
8. **3-column UI**: Input analysis, per-element options, output preview. Explicit Convert
   and Download flow.

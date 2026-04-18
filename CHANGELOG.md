# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- **Pretty-printed XML output**: Converted GPX files are now indented with 2-space nesting for
  readability. Mixed-content elements (e.g. `<name>`) are left untouched.
- **Section separator comments**: `<!-- Waypoints -->`, `<!-- Routes -->`, and `<!-- Tracks -->`
  comments are inserted before each non-empty section in the output GPX.
- **Extension conversion comments**: Each Rumo extension element is preceded by an XML comment
  explaining its origin (e.g. `<!-- Rumo: color converted from gpxx:RouteExtension/DisplayColor "Red" -->`).

### Added
- **Per-route/track control**: Each route and track in the file gets individual keep/remove,
  conversion options (create track, create dense route, tolerance), and per-extension keep/remove
  toggles. Replaces the old global options panel.
- **Dynamic extension discovery**: Extensions are enumerated from the actual file content and
  presented as individual toggles with sensible defaults (processed extensions default to remove,
  everything else defaults to keep).
- **3-column layout**: Full-width input/options/output layout replaces the narrow single-column
  card design. Explicit Convert button with separate Download button.
- **`analyzeInput()` export**: New pure function returning structured per-route/track analysis
  including extension lists, point counts, isTrip/isRoutePointExt flags.

### Changed
- **`convert()` API redesigned**: Now takes per-route and per-track options arrays with individual
  `keep`, `createTrack`, `createDenseRoute`, `toleranceM`, `addRteptsToWaypoints`, and extension
  decision maps. Backward-incompatible change.
- **No automatic deduplication**: Duplicate routes are no longer auto-removed. All routes are
  shown to the user with appropriate default actions (Trip/RPE variants default to Remove).
- **Single-file focus**: Multi-file upload removed; one file at a time with full per-element control.
- Extension filtering uses per-element decisions instead of namespace-level strip functions.
- Stats return value now contains per-route and per-track arrays instead of flat counters.

### Removed
- Automatic route deduplication (`deduplicateRoutes()`).
- Global conversion options (`displayColor`, `routingMeta`, `thirdPartyExt` parameters).
- Namespace-level strip functions (`stripDropNamespaces`, `stripGpxxExcept`, etc.).
- Live preview on option change (now uses explicit Convert button).
- Multi-file support.

### Added (earlier)
- **Redesigned site header**: Full-width dark slate header with monospace app name, replacing the
  plain-text-on-gray treatment. Page footer also moved outside the content column.
- **Upload icon in drop zone**: SVG upload arrow displayed when no files are loaded; hidden in the
  compact post-load state.

### Changed
- **Controls panel shows all options or none**: Previously, the color / waypoint-type / third-party
  fieldsets were conditionally shown based on whether the loaded file contained those features,
  while the tolerance slider was always shown — a confusing mix. Now all options are always visible
  when the controls panel is shown.
- **Renamed "Route simplification" to "Tolerance"**: The previous label was misleading for files
  with shaping points, where the tool first densifies the route before simplifying. "Tolerance" is
  the neutral, accurate name for the RDP parameter.
- Controls panel remains hidden for waypoint-only files (no routes or tracks to configure).

### Added
- **Extension-aware conversion options**: `displayColor`, `routingMeta`, `thirdPartyExt` on `convert()`.
  Defaults: keep color, remove routing meta, remove third-party extensions.
- **UI option controls**: Three conditional fieldsets appear in the controls panel only when the
  loaded file contains the relevant feature (display color, trp: routing metadata, or non-Garmin
  third-party extensions).
- **Track-only / wpt-only pass-through**: Files with no `<rte>` no longer throw an error;
  extensions are stripped and the file is passed through cleanly.
- **No duplicate track synthesis**: When the input already contains `<trk>` elements, no new
  track is synthesized from the route. The pre-existing tracks are preserved as-is (after
  stripping extensions).
- **Waypoint address auto-conversion**: `gpxx:Address` / `wptx1:Address` extension data is
  automatically copied to `<desc>` (if absent) before stripping. `ctx:CreationTime` is copied
  to `<wpt><time>` if absent.
- **Third-party extension detection**: `summarizeInput()` now returns a `features` object with
  `hasDisplayColor`, `hasRoutingMeta`, `hasThirdPartyExt`, `hasExistingTrack`, `hasShapingPts`,
  `routeOnly` flags.
- Three new test fixtures: `routing-meta.gpx`, `track-only.gpx`, `third-party-ext.gpx`.
- Nine new unit tests covering all new behaviors.

### Changed
- Files with both `<rte>` and `<trk>` now produce one output track (the pre-existing one),
  not two (previously a duplicate was synthesized from the route).
- `scrubNamespaceDeclarations` now generalizes to any namespace: it walks the output tree and
  keeps `xmlns:*` declarations only for namespaces that are actually used, supporting
  third-party namespace passthrough when `thirdPartyExt='keep'`.
- Added to always-drop namespaces: `adv:` (Adventures), `tmd:` (TripMetaData), `vptm:`
  (ViaPointTransportationMode), `prs:` (Pressure), `vidx1:` (Video).

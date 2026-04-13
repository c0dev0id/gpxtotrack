# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
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

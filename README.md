# Converts GPX to GPX

Garmin GPX normalizer

Pure Javascript hosted on Github Pages

## App Flow

1. User Uploads GPX file
2. Examine Uploaded GPX file
3. Show file information
  - List of routes (names, extensions used, number of route points, number of shaping points)
  - List of tracks (names, extensions used, number of track points)
  - Number of Waypoints (extensions used)
4. Show conversion options for the user to check for each route (checkboxes)
  - Keep Route
    - IF route has shaping points:
      - Add Route Points to Waypoints
      - Create dense route from shaping points:
        - Show tolerance slider
      - Create track from shaping points
      - Show a list of used extensions with Keep and Remove options (radio buttons)
        The default is "Keep" for all Extensions that cannot be expressed in GPX 1.1, and Remove for all Extensions that can be converted. The list must be created dynamically to cover future and unknown extensions (default them to Keep)
        Example:
        GarminColorExtension: (X) Keep ( ) Remove
        GarminHeartrateExtension: ( ) Keep (X) Remove
        ThirtPartySomethingExtension: ( ) Keep (X) Remove
  - Remove Route (checked per default for "Garmin Trip Extension" and "Garmin RoutePoint Extension" routes)
5. Show the following options for each track:
    - Keep track
      - Show a list of used extensions with Keep and Remove options (radio buttons)
        The default is "Keep" for all Extensions that cannot be expressed in GPX 1.1, and Remove for all Extensions that can be converted. The list must be created dynamically to cover future and unknown extensions (default them to Keep). Same concept as for routes.
    - Remove track
6. Show options for waypoints (not for each waypoint, this option applies to all waypoints)
    - Show a list of used extensions with Keep and Remove options (radio buttons)
      The default is "Keep" for all Extensions that cannot be expressed in GPX 1.1, and Remove for all Extensions that can be converted. The list must be created dynamically to cover future and unknown extensions (default them to Keep). Same concept as for routes.
7. Show a "Convert" button, when clicked, apply the conversion
8. Show file information of the output file:
  - List of routes (names, extensions used, number of route points, number of shaping points)
  - List of tracks (names, extensions used, number of track points)
  - Number of Waypoints (extensions used)
9. Show a Download button, which will send the converted file to the browser for download

General behavior:
- The user always change option and press "Convert" again, which will perform the conversion again from the original file and update the output file information. He can do so until he's satisfied with the stats and then download the file.
- The "Keep Route" and "Keep Track" options will either:
  - retain the original route or track verbatim, when no conversion option for the same type are selected
  - only keep the modified route or track, when no conversion options for the same type are selected

  Note: "same type" means route or track. Examples:
  - If a route is marked as keep with the create track from shaping point option, then the route is kept verbatim and the track is added.
  - If the route is marked as remove with the create track from shaping point option, then the track is created, but the route will not be in the output file
  - If the route is marked as keep, and create dense route form shaping point is marked, the output route will be the dense route, without shaping points.


## UI considerations

The application is mostly about comparing input data with output data and make informed decisions.
The information about input and output should be displayed next to each other (left/right). Information of the same type should visually align.

Screens are usually wider than high. So ideally we can use the full screen width. Maybe it makes sense to structure the screen from left to right in a 3 column layout.

Above content area: Upload button and general information

Content area:
1st column: input file information
2nd column: options + convert button
3rd column: output file information

Below content area: Download Button (deactivated until a conversion has been performed

If the screen width does not allow the horizontal layout, the 3 column areas can be stacked vertically.

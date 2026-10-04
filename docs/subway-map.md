# Subway and streetcar map

The rail map imports the TTC [Complete GTFS](https://open.toronto.ca/dataset/merged-gtfs-ttc-routes-and-schedules/), keeping streetcars plus Lines **1, 2, 4, 5 and 6**. Line 3 and bus routes are excluded. Lines 5 and 6 use GTFS light-rail type 0; Lines 1, 2 and 4 use type 1. Their shapes and station sequences come from the feed, not hand-drawn overlays. Each rapid-transit line has separate graph nodes so crossings do not create streetcar or inter-line switches.

The existing `/api/v1/map/streetcar` and `/api/v1/vehicles/streetcar` URLs remain compatible. The map includes the combined rail network; vehicle snapshots retain `vehicles` for Flexity GPS reports and add `subwayPredictions`, `subwayStatus`, `surfaceStatus`, and `subwaySource`. The two upstream snapshots share one browser poll and cache cadence. Either source can fail independently; successful empty feeds clear the corresponding mode. Both sources failing produces the existing retry response.

Subway realtime comes from the TTC's [Subway Trip Updates](https://gtfsrt.ttc.ca/trips/subway?format=text). It provides train identifiers and upcoming station predictions, **not train GPS positions**. Markers are anchored to the first upcoming station as of the feed timestamp. Their direction follows the reported station order; they do not animate inferred travel between stations. Details and exports identify these as next-station predictions, and old reports fade. Identifiers are namespaced by line to avoid collisions with streetcars. A missing train number is labelled with its trip ID. Lines with no reports display routes/stations only. The inspected October 4 snapshot contained reports for Lines 1, 2 and 4, with none for 5 or 6; no synthetic service is generated for missing lines.

Train markers use six longer, square-ended sections, retaining the directional cab. Streetcars retain five articulated sections. Both show route and vehicle numbers at detailed zoom and when selected, and can be found by number in search. The streetcar journal remains limited to streetcars. Fleet CSVs include position kind, predicted station, arrival time, and the appropriate source URL.

## Local preview

Download Complete GTFS once from the catalogue above, then reuse the ZIP:

```sh
npm run map:import -- /path/to/completegtfs.zip
npm run dev:viewer
```

`map:import` requires `unzip`, uses the production parser/generator, and writes `.wrangler/preview/rail-map.json`. Vite uses that file when present. `MAP_INPUT` overrides it; without either, the existing streetcar fixture is used. Source fixtures remain unchanged. Importing and previewing do not publish anything.

Run `npm run test:subway` against the preview after importing. It checks all requested routes, fixture predictions, train/streetcar labels, directional cabs, vehicle details, and phone layout without live upstream requests. `CHROMIUM_PATH` can select an installed browser. Unit tests cover parsing, feed failures, cancelled/skipped reports, staleness, and grade-separated topology.

## Production rollout

Build the API assets, deploy both Workers, then run the authenticated static sync (or wait for the nightly sync). Merely regenerating the old surface import cannot add subway geometry. The configured source now points to Complete GTFS; changing source URL clears old conditional-request validators but keeps the active map until the new import and generation succeed. Complete GTFS imports must contain geometry for all five lines to activate. The database source key and public map mode retain their historical names for compatibility; no schema migration is needed.

`REALTIME_SUBWAY_URL` configures the official binary subway trip-update endpoint. Static sync keeps its existing conditional fetch and R2 retention policy. Realtime acquisition stores no vehicle history.

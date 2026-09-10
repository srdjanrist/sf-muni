# San Francisco basemap

This regional PMTiles extract is derived from Protomaps' 2026-09-08 OpenStreetMap/Natural Earth build (schema 4.15.2). It covers `[-122.535, 37.69, -122.345, 37.84]`, zooms 0–15, and overzooms for close views. It is geographic vector data, not a screenshot.

Reproduce with the official [PMTiles CLI](https://docs.protomaps.com/pmtiles/cli):

```sh
pmtiles extract https://build.protomaps.com/20260908.pmtiles sf.pmtiles \
  --bbox=-122.535,37.69,-122.345,37.84 --maxzoom=15
```

Protomaps retains selected builds; if this URL expires, select an available build from https://maps.protomaps.com/builds/ and record its date here. The bundled extract is sufficient for normal offline startup and does not require this download.

Attribution: © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), [Natural Earth](https://www.naturalearthdata.com/), [Protomaps](https://protomaps.com/). OpenStreetMap data is available under ODbL. Map labels use Noto Sans (SIL Open Font License), with glyphs from https://protomaps.github.io/basemaps-assets/fonts/.

The backend copies these public assets into its ignored `data/` cache on first startup. It exposes only the map archive and validated font paths, never its transit caches or environment files.

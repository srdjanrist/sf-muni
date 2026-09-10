# Verification record

## Verified in this workspace

- Official SFMTA/DataSF GTFS: 68 routes, 3,240 stops, 34,668 trips, 287 shapes, zero import validation warnings.
- 40 unit/integration checks passed, including complete ZIP import and protobuf→trip→vehicle→next-stop association, smooth stop transitions, non-rewinding stale motion, trailing ZIP bytes, overnight service-date reconciliation, exact-origin CORS, map range requests, and raw SSE CORS headers.
- Four Chromium/Playwright tests passed: map rendering and count agreement; selections/follow/station boards/URL restoration; search, filtering, modes and mobile; observed motion, picking, disconnect retention; and the renderer benchmark.
- TypeScript, ESLint, and the production build passed.
- A separate compiled-server smoke test passed: bundled MapLibre worker, vector tiles, vehicle selection, console checks, and absence of 511 endpoint references in browser requests/client assets. No real token was available; request-error sanitization was exercised with a test token.
- Desktop overview, 3D vehicle view, and 390×844 mobile screenshots were inspected. No page exceptions occurred in the tested paths.

## Vercel / Traefik deployment preparation

The backend Docker image builds and runs on local Docker/Linux ARM64 as uid 1000
with a read-only root and persistent data volume. It contains no `.env` or frontend
bundle. Compose validates against the development-network / websecure / myresolver
configuration read from the existing devops repository.

`scripts/verify-split.ts` passed against a compiled frontend on port 5180 and a
fixture-mode Docker backend on port 3101: API calls, SSE, PMTiles range reads,
glyphs, vehicle selection, stop arrivals, and browser console. This test does not
use a Vite proxy or consume the 511 token allowance. Vercel deployment, GHCR image
publication, and public DNS/Traefik verification remain deployment steps; no VPS
containers or shared Traefik settings were changed by this local verification.

## Renderer measurement

Chromium 153 via Playwright, local macOS ARM64 host, 14 reported logical cores, 1440×1000 viewport, device scale factor 1, ANGLE/Metal. Synthetic load duplicates network vehicle observations; this measures vehicle rendering load, not 1,000 independently sourced live entities.

| Instances | Measured FPS | Vehicle draw calls | Vehicle triangles | Sample custom-layer CPU frame time |
| --------: | -----------: | -----------------: | ----------------: | ---------------------------------: |
|       500 |           60 |                 12 |            18,000 |                             0.5 ms |
|     1,000 |           60 |                 12 |            36,000 |                             1.0 ms |

MapLibre's basemap draw calls are additional. These results are not a guarantee for integrated graphics, mobile devices, extreme zoom, or other browsers. Reproduce with `npm run test:e2e`; the test attaches `performance.json` to the HTML report.

## Actual 511 verification — September 10, 2026

The server-only token is configured in ignored `.env` with file permissions 0600. All three feeds report healthy in live mode. The static feed imported 68 routes, 3,240 stops, 34,668 trips, and 287 shapes with zero validation warnings. Observed realtime counts ranged around 314–326 vehicles, 134–144 trip updates, and four alerts; these are changing observations, not fixed expected counts.

`npm run test:live` checks all received vehicles render, live labels, vehicle selection, a stop board with realtime arrivals, stable IDs and changed positions across feed updates, page errors, browser request destinations, and the configured token's absence from compiled client assets. One run observed 326 stable IDs and 133 changed positions across snapshots, with zero page exceptions. Actual Metro and bus records matched static trips and shapes where the upstream provided descriptors. Many overnight positions lack trip/route descriptors and correctly remain unknown.

Live ingestion uncovered two upstream compatibility details: passing `format=protobuf` returned HTTP 200 with `"No Data Found"`, whereas requesting protobuf through the Accept header worked; the static ZIP included trailing bytes beyond unzipper's default end-record search. Both are fixed and covered by regression checks. Static downloads now have a separate 120-second timeout.

Overnight 511 descriptors can use the civil date for GTFS 24+ hour trips. Predictions preserve raw descriptors and reconcile the service date only when absolute stop times and reported delays corroborate the prior active service day (allowing two minutes for intermediate-time differences). Vehicle-only schedule fallback uses the observation timestamp to disambiguate 24+ hour times. An offline check of an actual live response compared 5,036 predicted stops after reconciliation with no day-sized erroneous delays.

The live smoke test does not constitute extended operational monitoring. Controlled upstream outage recovery remains covered by automated fixture/transport tests rather than deliberately disconnecting this live session. Terrain, underground rendering, and historical replay remain documented future work.

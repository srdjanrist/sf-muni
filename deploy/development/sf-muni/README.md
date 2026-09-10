# SF Muni API — development VPS

Runs one continuously polling Muni backend behind the existing development Traefik.
The React frontend runs on Vercel's default `<project>.vercel.app` domain.
No cron jobs, database, published API port, or new Traefik installation are needed.

## Existing infrastructure

- External Docker network: `development-network`
- HTTPS entrypoint: `websecure`
- Certificate resolver: `myresolver`
- Default backend hostname: `sf-muni-api.tempserver.click`
- Backend container port: `3001`
- Persistent named volume: `sf_muni_data` mounted at `/app/data`

Use the VPS running `development/docker-compose.yml`, not the production stack.
Point the chosen hostname's DNS A record to that VPS (or use its existing wildcard).
Only add an AAAA record if IPv6 reaches the same server. Ports 80/443 must reach Traefik.

## Publish the application image

The Muni application repository contains a multi-stage `Dockerfile` and
`.github/workflows/backend-image.yml`. Push the application source to its own
GitHub repository on `master` or `main`. The workflow publishes:

```text
ghcr.io/<repository-owner>/sf-muni-api:latest
ghcr.io/<repository-owner>/sf-muni-api:sha-<commit>
```

This compose file defaults to owner `srdjanrist`. Set `MUNI_IMAGE` to the actual
owner or a pinned SHA tag. For private GHCR packages, authenticate the VPS with
`docker login ghcr.io` using a token with package read permission; do not put it
in this compose file. The workflow uses GitHub's built-in token for publishing.

## Configure the frontend on Vercel

Import the application repository. Its `vercel.json` builds only the frontend
with `npm run build:web` and publishes `dist/client`. Set this public build variable:

```env
VITE_API_ORIGIN=https://sf-muni-api.tempserver.click
```

Use the domain chosen in `API_DOMAIN` if different. Keep Vercel's generated
production URL; no frontend DNS changes are required. Do not add the 511 token
to Vercel. Rebuild the frontend whenever the backend origin changes.

## Configure and start the backend

In this directory on the development VPS:

```bash
cp .env.example .env
chmod 600 .env
```

Edit `.env`: enter `511_API_KEY`, replace `CORS_ORIGINS` with the exact production
Vercel origin, and choose `API_DOMAIN` / `MUNI_IMAGE`. Origins have no trailing
slash. Multiple exact origins can be comma-separated; all of `*.vercel.app` is
intentionally not allowed. Named preview deployments need their own explicit
entry. Read-only API endpoints remain public; CORS controls browser access and
is not API authentication.

Confirm the shared network and Traefik already exist. Stop any local live Muni
poller using this token before starting the VPS service so their budgets do not
compete. Then run:

```bash
docker compose config --quiet
docker compose pull
docker compose up -d
docker compose logs --tail=100 -f sf-muni-api
```

Use `config --quiet`: full compose output includes interpolated environment
secrets. Do not scale this service or run another ingestion container with the
same token. The persisted request budget and GTFS cache survive recreation.

## Verify

Substitute your selected domain and exact Vercel origin:

```bash
curl -fsS https://sf-muni-api.tempserver.click/api/health
curl -I -H 'Origin: https://your-muni-project.vercel.app' https://sf-muni-api.tempserver.click/api/system/status
curl -N --max-time 20 -H 'Origin: https://your-muni-project.vercel.app' https://sf-muni-api.tempserver.click/api/realtime/stream
```

The stream should immediately send `initial_snapshot`, then deltas/heartbeats.
The last command intentionally times out after 20 seconds. Health reports
`source: live`, static counts, feed health, and request usage without secrets.
Startup can take a few minutes while the initial GTFS download/import runs.
Container health checks use `/api/system/status` to keep the cached network
accessible during upstream outages rather than removing the service from Traefik.

Open the Vercel page and verify map tiles, fonts, arrivals, and the event stream
load directly from the backend hostname with HTTPS and the expected CORS origin.
SSE's raw response explicitly preserves CORS headers. Map responses expose ETag,
Content-Range, and Accept-Ranges for PMTiles range requests.

## Updates and rollback

```bash
docker compose pull
docker compose up -d
```

For rollback, set `MUNI_IMAGE` to a previous SHA tag and run the same commands.
Keep the named volume; do not use `docker compose down -v` when updating. The
container runs as the Node user with a read-only root filesystem and writable
data volume. The image contains map assets and official fixture geometry, but
never `.env`, credentials, or a saved live cache.

Changing the backend hostname requires updating its DNS, `API_DOMAIN`, and
Vercel's `VITE_API_ORIGIN`, then recreating the backend and rebuilding the frontend.
No changes to the shared Traefik configuration are required.

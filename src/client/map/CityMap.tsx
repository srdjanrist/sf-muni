import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import mapWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { type GeoJSONSource, type Map as LibreMap } from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import type { FeatureCollection, Point, LineString } from 'geojson';
import { cityStyle } from './style';
import { VehicleLayer, renderMetrics } from './VehicleLayer';
import { simulation } from '../simulation/VehicleSimulation';
import { connectRealtime, api } from '../state/api';
import { matchesVehicle, useTransit } from '../state/store';
import type { NetworkPayload, TransitShape } from '../../shared/types';
import { theme, delayLabel } from '../theme';
const protocol = new Protocol();
maplibregl.setWorkerUrl(mapWorkerUrl);
maplibregl.addProtocol('pmtiles', protocol.tile);
export let cityMap: LibreMap | undefined;
export function resetCityView() {
  useTransit.setState({ following: null });
  const bounds = useTransit.getState().network?.bounds;
  if (cityMap && bounds) {
    const width = cityMap.getContainer().clientWidth;
    const fitted = cityMap.cameraForBounds(
      [
        [bounds[0], bounds[1]],
        [bounds[2], bounds[3]],
      ],
      {
        padding: 30,
        bearing: -22,
      },
    );
    // Mercator bounds fitting is planar. Compensate for the pitched overview so the city fills the working surface.
    cityMap.flyTo({
      center: [
        (bounds[0] + bounds[2]) / 2,
        (bounds[1] + bounds[3]) / 2 - (bounds[3] - bounds[1]) * 0.03,
      ],
      zoom: Math.min(12.6, (fitted?.zoom ?? 12) + (width > 900 ? 0.9 : 0.35)),
      pitch: 55,
      bearing: -22,
      duration: 1200,
      padding: { top: 0, bottom: 0, left: 0, right: 0 },
    });
    return;
  }
  if (cityMap)
    cityMap.flyTo({
      center: [-122.435, 37.764],
      zoom: 12.6,
      pitch: 55,
      bearing: -22,
      duration: 1500,
      padding: { top: 0, bottom: 0, left: 0, right: 0 },
    });
}
export function CityMap() {
  const container = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    let closed = false;
    const pending = new Set<string>();
    const controller = new AbortController();
    const disconnect = connectRealtime((vehicles, removed) => {
      removed?.forEach((id) => simulation.remove(id));
      for (const v of vehicles) {
        simulation.updateNetworkState(v, Date.now() + useTransit.getState().offset);
        if (v.shapeId && !simulation.shapes.has(v.shapeId) && !pending.has(v.shapeId)) {
          const id = v.shapeId;
          pending.add(id);
          void api<TransitShape>(`/shapes/${encodeURIComponent(id)}`, controller.signal)
            .then((s) => {
              simulation.setShape(s);
            })
            .catch(() => undefined)
            .finally(() => pending.delete(id));
        }
      }
    });
    const map = new maplibregl.Map({
      container: container.current!,
      style: cityStyle(),
      center: [-122.435, 37.764],
      zoom: 12.6,
      pitch: 55,
      bearing: -22,
      maxPitch: 75,
      maxZoom: 19,
      minZoom: 10,
      attributionControl: { compact: true },
      canvasContextAttributes: { antialias: true, preserveDrawingBuffer: true },
    });
    cityMap = map;
    const layer = new VehicleLayer();
    let networkVersion = '';
    let lastLabels = 0;
    let followFrame = 0;
    const popup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      className: 'map-tooltip',
      offset: 16,
    });
    function putNetwork(network: NetworkPayload) {
      const routes: FeatureCollection<LineString> = {
        type: 'FeatureCollection',
        features: network.shapes.map((s) => ({
          type: 'Feature',
          properties: {
            id: s.routeId,
            shapeId: s.id,
            color: network.routes.find((r) => r.id === s.routeId)?.color ?? theme.routeDefault,
          },
          geometry: { type: 'LineString', coordinates: s.coordinates },
        })),
      };
      const stops: FeatureCollection<Point> = {
        type: 'FeatureCollection',
        features: network.stops.map((s) => ({
          type: 'Feature',
          properties: {
            id: s.id,
            name: s.name,
            station: s.locationType === 1 || /station/i.test(s.name) ? 1 : 0,
            routes: s.routeIds,
          },
          geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
        })),
      };
      if (map.getSource('muni-routes')) {
        (map.getSource('muni-routes') as GeoJSONSource).setData(routes);
        (map.getSource('muni-stops') as GeoJSONSource).setData(stops);
        return;
      }
      map.addSource('muni-routes', { type: 'geojson', data: routes });
      map.addSource('muni-stops', { type: 'geojson', data: stops });
      map.addLayer({
        id: 'route-lines',
        type: 'line',
        source: 'muni-routes',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-opacity': 0.5,
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.7, 14, 1.5, 17, 4],
        },
      });
      map.addLayer({
        id: 'route-highlight',
        type: 'line',
        source: 'muni-routes',
        filter: ['==', ['get', 'id'], ''],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': theme.selected, 'line-opacity': 0.95, 'line-width': 3 },
      });
      map.addLayer({
        id: 'stop-dots',
        type: 'circle',
        source: 'muni-stops',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 0.4, 13, 1.3, 16, 3.5],
          'circle-color': '#cad2b6',
          'circle-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0.15, 14, 0.8],
          'circle-stroke-width': 0.5,
          'circle-stroke-color': theme.land,
        },
      });
      map.addLayer({
        id: 'stop-labels',
        type: 'symbol',
        source: 'muni-stops',
        minzoom: 15.2,
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 10,
          'text-offset': [0, 1.2],
          'text-anchor': 'top',
          'text-max-width': 16,
        },
        paint: { 'text-color': '#d3dbc6', 'text-halo-color': theme.land, 'text-halo-width': 2 },
      });
      map.addLayer({
        id: 'stop-selected',
        type: 'circle',
        source: 'muni-stops',
        filter: ['==', ['get', 'id'], ''],
        paint: {
          'circle-radius': 8,
          'circle-color': theme.selected,
          'circle-stroke-color': theme.land,
          'circle-stroke-width': 3,
        },
      });
      map.addLayer({
        id: 'stop-alerts',
        type: 'circle',
        source: 'muni-stops',
        filter: ['==', ['get', 'id'], ''],
        paint: {
          'circle-radius': 5,
          'circle-color': theme.delay.severe,
          'circle-stroke-width': 1.5,
          'circle-stroke-color': theme.land,
        },
      });
      map.addSource('vehicle-labels', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'vehicle-labels',
        type: 'symbol',
        source: 'vehicle-labels',
        minzoom: 13.3,
        layout: {
          'text-field': ['get', 'label'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 10,
          'text-offset': [0, -1.6],
          'text-padding': 5,
        },
        paint: { 'text-color': '#f1f2df', 'text-halo-color': '#142322', 'text-halo-width': 2 },
      });
      map.addLayer(layer);
    }
    function sync() {
      if (closed || !map.isStyleLoaded()) return;
      const state = useTransit.getState(),
        n = state.network;
      if (n && n.version !== networkVersion) {
        const firstNetwork = !networkVersion;
        putNetwork(n);
        networkVersion = n.version;
        if (firstNetwork && !state.selection) resetCityView();
      }
      if (!map.getLayer('route-lines')) return;
      const selectedRoute =
        state.selection?.type === 'route'
          ? state.selection.id
          : state.selection?.type === 'vehicle'
            ? state.vehicles.get(state.selection.id)?.routeId
            : undefined;
      map.setPaintProperty(
        'route-lines',
        'line-opacity',
        selectedRoute ? 0.12 : state.mode === 'routes' ? 0.8 : 0.4,
      );
      map.setFilter('route-highlight', ['==', ['get', 'id'], selectedRoute ?? '']);
      map.setFilter('stop-selected', [
        '==',
        ['get', 'id'],
        state.selection?.type === 'stop' ? state.selection.id : '',
      ]);
      map.setFilter(
        'route-lines',
        state.filters.routes.length
          ? ['in', ['get', 'id'], ['literal', state.filters.routes]]
          : null,
      );
      const alertRoutes = state.snapshot?.alerts.flatMap((a) => a.affectedRoutes) ?? [],
        alertStops = state.snapshot?.alerts.flatMap((a) => a.affectedStops) ?? [];
      map.setPaintProperty(
        'route-lines',
        'line-color',
        state.mode === 'alerts'
          ? [
              'case',
              ['in', ['get', 'id'], ['literal', alertRoutes]],
              theme.delay.severe,
              theme.unknown,
            ]
          : ['get', 'color'],
      );
      map.setFilter('stop-alerts', ['in', ['get', 'id'], ['literal', alertStops]]);
      for (const [id, visible] of [
        ['buildings-3d', state.settings.buildings && !state.settings.reduced],
        ['route-lines', state.settings.routes],
        ['route-highlight', state.settings.routes],
        ['stop-dots', state.settings.stops],
        ['stop-labels', state.settings.stops && !state.settings.reduced],
        ['vehicle-labels', state.settings.labels && !state.settings.reduced],
      ] as const)
        map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
    }
    const unsubscribe = useTransit.subscribe((state, previous) => {
      sync();
      if (
        (state.selection !== previous.selection || state.network !== previous.network) &&
        state.selection
      ) {
        const s = state.selection,
          n = state.network;
        const width = map.getContainer().clientWidth,
          height = map.getContainer().clientHeight;
        const offset: [number, number] = width <= 600 ? [0, -height * 0.22] : [-60, 0];
        if (s.type === 'vehicle') {
          const v = state.vehicles.get(s.id);
          if (v)
            map.flyTo({ center: [v.lon, v.lat], zoom: 15.7, pitch: 60, duration: 1200, offset });
        }
        if (s.type === 'stop') {
          const stop = n?.stops.find((t) => t.id === s.id);
          if (stop)
            map.flyTo({
              center: [stop.lon, stop.lat],
              zoom: 16,
              pitch: 50,
              duration: 1200,
              offset,
            });
        }
        if (s.type === 'route') {
          const shapes = n?.shapes.filter((t) => t.routeId === s.id);
          const bounds = new maplibregl.LngLatBounds();
          shapes?.forEach((s) => s.coordinates.forEach((p) => bounds.extend(p)));
          if (!bounds.isEmpty())
            map.fitBounds(bounds, {
              padding:
                width <= 600
                  ? { top: 140, left: 25, right: 25, bottom: height * 0.58 }
                  : { top: 150, left: width > 900 ? 320 : 30, right: 380, bottom: 130 },
              pitch: 50,
              bearing: -15,
              duration: 1400,
              maxZoom: 15,
            });
        }
      }
    });
    map.on('load', () => {
      setReady(true);
      sync();
      if (useTransit.getState().selection) {
        const selection = useTransit.getState().selection;
        useTransit.setState({ selection: selection ? { ...selection } : null });
      }
    });
    map.on('error', (e) => {
      if (!closed)
        setError(
          e.error.message.includes('404')
            ? 'Map assets are not ready. Run npm run map:prepare.'
            : 'Some map data could not load. The transit network remains available.',
        );
    });
    map.on('click', (e) => {
      const vehicle = map.getLayer(layer.id) ? layer.pick(e.point.x, e.point.y) : undefined;
      if (vehicle) {
        useTransit.getState().select({ type: 'vehicle', id: vehicle });
        popup.remove();
        return;
      }
      const features = map.queryRenderedFeatures(
        [
          [e.point.x - 5, e.point.y - 5],
          [e.point.x + 5, e.point.y + 5],
        ],
        { layers: ['stop-dots', 'route-lines'].filter((id) => map.getLayer(id)) },
      );
      const stop = features.find((f) => f.layer.id === 'stop-dots');
      const f = stop ?? features[0];
      if (f)
        useTransit
          .getState()
          .select({ type: stop ? 'stop' : 'route', id: String(f.properties.id) });
    });
    map.on('mousemove', (e) => {
      if (!map.getLayer(layer.id)) return;
      const id = layer.pick(e.point.x, e.point.y);
      if (id) {
        const v = useTransit.getState().vehicles.get(id);
        if (v) {
          const r = useTransit.getState().network?.routes.find((r) => r.id === v.routeId);
          const div = document.createElement('div');
          div.textContent = `${r?.shortName ?? 'Muni'} ${r?.longName ?? ''} · ${v.destination ?? 'Destination unavailable'}\n${delayLabel(v.delaySeconds)}`;
          popup.setLngLat([v.lon, v.lat]).setDOMContent(div).addTo(map);
          map.getCanvas().style.cursor = 'pointer';
          return;
        }
      }
      popup.remove();
      map.getCanvas().style.cursor = '';
    });
    map.on('dragstart', () => useTransit.setState({ following: null }));
    map.on('render', () => {
      const timestamp = performance.now(),
        state = useTransit.getState();
      if (
        timestamp - lastLabels > 500 &&
        map.getSource('vehicle-labels') &&
        state.settings.labels &&
        map.getZoom() > 13.3
      ) {
        lastLabels = timestamp;
        const alertRoutes = new Set(state.snapshot?.alerts.flatMap((a) => a.affectedRoutes));
        const features: FeatureCollection<Point> = {
          type: 'FeatureCollection',
          features: [...simulation.tracks.values()]
            .filter((t) => matchesVehicle(t.network, state.filters, alertRoutes))
            .map((t) => ({
              type: 'Feature',
              properties: {
                label:
                  state.network?.routes.find((r) => r.id === t.network.routeId)?.shortName ?? '?',
              },
              geometry: { type: 'Point', coordinates: [t.render.lon, t.render.lat] },
            })),
        };
        (map.getSource('vehicle-labels') as GeoJSONSource).setData(features);
      }
      if (state.following && timestamp - followFrame > 100) {
        followFrame = timestamp;
        const v = simulation.getVehicleState(state.following);
        if (v)
          map.easeTo({
            center: [v.lon, v.lat],
            zoom: 16.5,
            pitch: 62,
            bearing: v.bearing,
            duration: 160,
            essential: true,
            offset:
              map.getContainer().clientWidth <= 600
                ? [0, -map.getContainer().clientHeight * 0.22]
                : [-60, 0],
          });
      }
    });
    if (import.meta.env.DEV)
      Object.assign(window, {
        __muni: {
          simulation,
          renderMetrics,
          getMap: () => map,
          getState: () => useTransit.getState(),
        },
      });
    return () => {
      closed = true;
      controller.abort();
      disconnect();
      unsubscribe();
      popup.remove();
      map.remove();
      cityMap = undefined;
      simulation.tracks.clear();
    };
  }, []);
  return (
    <>
      <div
        ref={container}
        className="city-map"
        aria-label="Interactive 3D map of San Francisco"
        data-testid="city-map"
        data-ready={ready}
      />
      {!ready && (
        <div className="map-loading">
          <span className="loading-orbit" />
          <strong>Loading San Francisco</strong>
          <span>Preparing the city and Muni network…</span>
        </div>
      )}
      {error && (
        <div className="map-error" role="status">
          {error}
          <button onClick={() => setError('')} aria-label="Dismiss map message">
            ×
          </button>
        </div>
      )}
    </>
  );
}

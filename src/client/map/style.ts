import type { StyleSpecification } from 'maplibre-gl';
import { theme } from '../theme';
import { backendAbsoluteUrl } from '../config';
export function cityStyle(): StyleSpecification {
  return {
    version: 8,
    glyphs: backendAbsoluteUrl('/map-assets/fonts/{fontstack}/{range}.pbf'),
    sources: {
      city: {
        type: 'vector',
        url: `pmtiles://${backendAbsoluteUrl('/map-assets/sf.pmtiles')}`,
        attribution:
          '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> · <a href="https://protomaps.com" target="_blank">Protomaps</a>',
      },
    },
    light: { anchor: 'viewport', color: '#d1ded2', intensity: 0.5, position: [1.5, 210, 40] },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': theme.water } },
      {
        id: 'land',
        type: 'fill',
        source: 'city',
        'source-layer': 'earth',
        paint: { 'fill-color': theme.land },
      },
      {
        id: 'landuse',
        type: 'fill',
        source: 'city',
        'source-layer': 'landuse',
        paint: {
          'fill-color': [
            'match',
            ['get', 'kind'],
            [
              'park',
              'forest',
              'wood',
              'nature_reserve',
              'golf_course',
              'grass',
              'recreation_ground',
              'cemetery',
            ],
            theme.park,
            ['hospital', 'school', 'university'],
            '#2a3533',
            theme.land,
          ],
          'fill-opacity': 0.9,
        },
      },
      {
        id: 'water',
        type: 'fill',
        source: 'city',
        'source-layer': 'water',
        paint: { 'fill-color': theme.water },
      },
      {
        id: 'roads-casing',
        type: 'line',
        source: 'city',
        'source-layer': 'roads',
        minzoom: 11,
        paint: {
          'line-color': '#152222',
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.6, 16, 8, 19, 24],
        },
      },
      {
        id: 'roads',
        type: 'line',
        source: 'city',
        'source-layer': 'roads',
        paint: {
          'line-color': [
            'match',
            ['get', 'kind'],
            ['highway', 'major_road'],
            '#596259',
            theme.roads,
          ],
          'line-opacity': 0.6,
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.3, 13, 0.6, 16, 4, 19, 15],
        },
      },
      {
        id: 'buildings-flat',
        type: 'fill',
        source: 'city',
        'source-layer': 'buildings',
        minzoom: 12,
        paint: { 'fill-color': '#2a3735', 'fill-outline-color': '#364440' },
      },
      {
        id: 'buildings-3d',
        type: 'fill-extrusion',
        source: 'city',
        'source-layer': 'buildings',
        minzoom: 13,
        paint: {
          'fill-extrusion-color': theme.buildings,
          'fill-extrusion-height': ['coalesce', ['get', 'height'], 5],
          'fill-extrusion-base': ['coalesce', ['get', 'min_height'], 0],
          'fill-extrusion-opacity': 0.75,
        },
      },
      {
        id: 'street-labels',
        type: 'symbol',
        source: 'city',
        'source-layer': 'roads',
        minzoom: 14,
        layout: {
          'symbol-placement': 'line',
          'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name'], ''],
          'text-font': ['Noto Sans Regular'],
          'text-size': 10,
          'symbol-spacing': 350,
        },
        paint: {
          'text-color': '#9ba69c',
          'text-halo-color': theme.land,
          'text-halo-width': 1.5,
          'text-opacity': 0.75,
        },
      },
      {
        id: 'neighborhoods',
        type: 'symbol',
        source: 'city',
        'source-layer': 'places',
        filter: [
          'in',
          ['get', 'kind'],
          ['literal', ['neighbourhood', 'neighborhood', 'suburb', 'quarter']],
        ],
        minzoom: 11,
        maxzoom: 15,
        layout: {
          'text-field': ['upcase', ['coalesce', ['get', 'name:en'], ['get', 'name'], '']],
          'text-font': ['Noto Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 11, 10, 14, 13],
          'text-letter-spacing': 0.15,
          'text-padding': 25,
        },
        paint: {
          'text-color': '#a4ada0',
          'text-halo-color': theme.land,
          'text-halo-width': 2,
          'text-opacity': 0.65,
        },
      },
    ],
  };
}

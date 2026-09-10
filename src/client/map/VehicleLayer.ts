import * as THREE from 'three';
import {
  MercatorCoordinate,
  type CustomLayerInterface,
  type Map as LibreMap,
  type CustomRenderMethodInput,
} from 'maplibre-gl';
import { ORIGIN } from '../../shared/geo';
import type { VehicleCategory } from '../../shared/types';
import { simulation } from '../simulation/VehicleSimulation';
import { matchesVehicle, transitNow, useTransit } from '../state/store';
import { delayColor, theme } from '../theme';
interface Batch {
  category: VehicleCategory;
  body: THREE.InstancedMesh;
  roof: THREE.InstancedMesh;
  glass: THREE.InstancedMesh;
  length: number;
  width: number;
  height: number;
  count: number;
}
export const renderMetrics = { fps: 0, drawCalls: 0, triangles: 0, vehicles: 0, frameMs: 0 };
export class VehicleLayer implements CustomLayerInterface {
  id = 'vehicles-3d';
  type = 'custom' as const;
  renderingMode = '3d' as const;
  private map!: LibreMap;
  private renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.Camera();
  private batches: Batch[] = [];
  private matrix = new THREE.Matrix4();
  private transform = new THREE.Matrix4();
  private object = new THREE.Object3D();
  private color = new THREE.Color();
  private ring!: THREE.Mesh;
  private previous = 0;
  private frames = 0;
  private frameStart = 0;
  private capacity = 0;
  onAdd(map: LibreMap, gl: WebGL2RenderingContext) {
    this.map = map;
    this.renderer = new THREE.WebGLRenderer({
      canvas: map.getCanvas(),
      context: gl,
      antialias: true,
    });
    this.renderer.autoClear = false;
    const origin = MercatorCoordinate.fromLngLat([ORIGIN.lon, ORIGIN.lat]),
      scale = origin.meterInMercatorCoordinateUnits();
    this.transform
      .makeTranslation(origin.x, origin.y, origin.z)
      .multiply(new THREE.Matrix4().makeScale(scale, -scale, scale))
      .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
    this.scene.add(new THREE.AmbientLight(0xffffff, 2));
    const light = new THREE.DirectionalLight(0xffffff, 2.4);
    light.position.set(-100, 200, 100);
    this.scene.add(light);
    this.allocate(1024);
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(9, 11, 40),
      new THREE.MeshBasicMaterial({
        color: theme.selected,
        side: THREE.DoubleSide,
        depthTest: false,
        transparent: true,
        opacity: 0.9,
      }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.scene.add(this.ring);
  }
  private allocate(capacity: number) {
    for (const b of this.batches)
      for (const mesh of [b.body, b.roof, b.glass]) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      }
    this.capacity = capacity;
    this.batches = (
      ['light_rail', 'streetcar', 'cable_car', 'bus', 'trolleybus', 'unknown'] as VehicleCategory[]
    ).map((category) => {
      const length =
          category === 'light_rail'
            ? 24
            : category === 'streetcar'
              ? 14
              : category === 'cable_car'
                ? 9
                : 12,
        width = category === 'light_rail' ? 3.4 : 3,
        height = 3.3;
      const make = (w: number, h: number, l: number, color: string) => {
        const mesh = new THREE.InstancedMesh(
          new THREE.BoxGeometry(w, h, l),
          new THREE.MeshStandardMaterial({ color, roughness: 0.65, metalness: 0.15 }),
          capacity,
        );
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.frustumCulled = false;
        mesh.count = 0;
        this.scene.add(mesh);
        return mesh;
      };
      return {
        category,
        length,
        width,
        height,
        count: 0,
        body: make(width, height, length, '#ffffff'),
        roof: make(width * 0.82, 0.55, length * 0.8, '#dbe1d5'),
        glass: make(width * 1.02, 1.25, length * 0.84, '#152d30'),
      };
    });
  }
  render(_gl: WebGL2RenderingContext, input: CustomRenderMethodInput) {
    const start = performance.now(),
      now = transitNow(),
      dt = this.previous ? Math.min((start - this.previous) / 1000, 0.1) : 1 / 60;
    this.previous = start;
    simulation.tick(now, dt);
    const state = useTransit.getState(),
      selection = state.selection,
      focus = selection?.type === 'route' ? selection.id : null;
    const alertRoutes = new Set(state.snapshot?.alerts.flatMap((a) => a.affectedRoutes));
    if (simulation.tracks.size > this.capacity)
      this.allocate(2 ** Math.ceil(Math.log2(simulation.tracks.size)));
    for (const b of this.batches) b.count = 0;
    const scale = Math.max(1, Math.min(7, 2 ** (15.1 - this.map.getZoom())));
    let count = 0;
    for (const track of simulation.tracks.values()) {
      const v = track.render;
      if (!matchesVehicle(v.network, state.filters, alertRoutes)) continue;
      const batch = this.batches.find((b) => b.category === v.network.category)!;
      const i = batch.count++;
      const selected = selection?.type === 'vehicle' && selection.id === v.id;
      let color =
        state.mode === 'delay'
          ? delayColor(v.network.delaySeconds)
          : state.mode === 'speed'
            ? v.network.speedMps === undefined
              ? theme.unknown
              : v.network.speedMps > 10
                ? '#c4ef7a'
                : v.network.speedMps > 3
                  ? '#75b4b0'
                  : '#d3b783'
            : state.mode === 'alerts' && v.network.routeId && alertRoutes.has(v.network.routeId)
              ? theme.delay.severe
              : (state.network?.routes.find((r) => r.id === v.network.routeId)?.color ??
                theme.routeDefault);
      if (state.mode === 'live' && ['bus', 'trolleybus'].includes(v.network.category))
        color = '#e2d5b0';
      this.color.set(selected ? theme.selected : color);
      if (v.network.stale) this.color.lerp(new THREE.Color(theme.stale), 0.65);
      if (focus && v.network.routeId !== focus) this.color.multiplyScalar(0.35);
      batch.body.setColorAt(i, this.color);
      this.object.rotation.set(0, (-v.bearing * Math.PI) / 180, 0);
      this.object.scale.setScalar(scale);
      this.object.position.set(v.x, 4 + (batch.height * scale) / 2, v.z);
      this.object.updateMatrix();
      batch.body.setMatrixAt(i, this.object.matrix);
      this.object.position.y = 4 + batch.height * scale;
      this.object.updateMatrix();
      batch.roof.setMatrixAt(i, this.object.matrix);
      this.object.position.y = 4 + batch.height * scale * 0.6;
      this.object.updateMatrix();
      batch.glass.setMatrixAt(i, this.object.matrix);
      count++;
    }
    for (const b of this.batches)
      for (const mesh of [b.body, b.roof, b.glass]) {
        mesh.count = b.count;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    const selected =
      selection?.type === 'vehicle' ? simulation.getVehicleState(selection.id) : undefined;
    this.ring.visible = Boolean(selected);
    if (selected) {
      this.ring.position.set(selected.x, 3, selected.z);
      this.ring.scale.setScalar(scale * (1 + Math.sin(start / 500) * 0.05));
    }
    this.camera.projectionMatrix.copy(
      this.matrix.fromArray(input.defaultProjectionData.mainMatrix).multiply(this.transform),
    );
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
    this.renderer.resetState();
    this.renderer.render(this.scene, this.camera);
    this.renderer.resetState();
    renderMetrics.drawCalls = this.renderer.info.render.calls;
    renderMetrics.triangles = this.renderer.info.render.triangles;
    renderMetrics.vehicles = count;
    renderMetrics.frameMs = performance.now() - start;
    this.frames++;
    if (start - this.frameStart > 1000) {
      renderMetrics.fps = Math.round((this.frames * 1000) / (start - this.frameStart));
      this.frames = 0;
      this.frameStart = start;
    }
    if (!document.hidden) this.map.triggerRepaint();
  }
  pick(x: number, y: number) {
    let best: string | undefined,
      distance = 18;
    const state = useTransit.getState(),
      alertRoutes = new Set(state.snapshot?.alerts.flatMap((a) => a.affectedRoutes));
    for (const track of simulation.tracks.values()) {
      const v = track.render;
      if (!matchesVehicle(v.network, state.filters, alertRoutes)) continue;
      const p = this.map.project([v.lon, v.lat]);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < distance) {
        distance = d;
        best = v.id;
      }
    }
    return best;
  }
  onRemove() {
    for (const b of this.batches)
      for (const mesh of [b.body, b.roof, b.glass]) {
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      }
    this.ring.geometry.dispose();
    (this.ring.material as THREE.Material).dispose();
    this.renderer.dispose();
  }
}

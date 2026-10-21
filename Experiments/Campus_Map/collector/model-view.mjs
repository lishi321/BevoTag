import * as THREE from './vendor/three.module.js';
import { OrbitControls } from './vendor/OrbitControls.js';
import { toFrame, fromFrame, floorElevation, interpolate, signalColor, signalAt } from './signal-model.mjs';
import { roomAt } from './architecture.mjs';
import { wallGeometry, roomGeometry } from './architecture-geometry.mjs';
import { exteriorBand } from './exterior-model.mjs';

const rgb = values => new THREE.Color(`rgb(${values.join(',')})`);
const dispose = group => group.traverse(object => {
  object.geometry?.dispose();
  for (const material of [].concat(object.material || [])) { material.map?.dispose(); material.dispose(); }
});

export class BuildingView {
  constructor(container, labelContainer, onPick, onStatus, onRoomPick) {
    this.container = container; this.labels = labelContainer; this.onPick = onPick; this.onStatus = onStatus; this.onRoomPick = onRoomPick;
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color('#edf1f1');
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#74888c', 2.4));
    const light = new THREE.DirectionalLight('#fff6e7', 2.2); light.position.set(-200, 450, 200); this.scene.add(light);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.5, 12000);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.12;
    this.controls.minDistance = 10; this.controls.maxDistance = 4000;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.addEventListener('change', () => this.invalidate());
    this.buildingGroup = new THREE.Group(); this.scene.add(this.buildingGroup);
    this.floorGroups = new Map(); this.generation = 0; this.points = [];
    this.options = { spacing: 14, separation: 1, wallHeight: 10, exterior: true, walls: true, rooms: true, plans: false, heat: true, points: true, isolate: true, bssid: '*' };
    this.raycaster = new THREE.Raycaster();
    const floorHit = event => {
      const floor = this.floorGroups.get(this.floor);
      if (!floor?.group.visible) return null;
      const rect = this.renderer.domElement.getBoundingClientRect();
      this.raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2), this.camera);
      const point = this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -floor.group.position.y), new THREE.Vector3());
      if (!point) return null;
      const pixel = fromFrame(floor.config, point.x, -point.z), [x0, y0, x1, y1] = floor.config.fit;
      return pixel && pixel.x >= x0 && pixel.x <= x1 && pixel.y >= y0 && pixel.y <= y1 ? { point, pixel, floor } : null;
    };
    this.renderer.domElement.addEventListener('pointerdown', event => { this.pointerStart = [event.clientX, event.clientY]; });
    this.renderer.domElement.addEventListener('click', event => {
      if (!this.pointerStart || Math.hypot(event.clientX - this.pointerStart[0], event.clientY - this.pointerStart[1]) > 5) return;
      const hit = floorHit(event);
      if (hit) this.onRoomPick?.(roomAt(hit.floor.model, hit.point.x, -hit.point.z));
    });
    this.renderer.domElement.addEventListener('dblclick', event => {
      const hit = floorHit(event);
      if (hit) this.onPick(this.floor, hit.pixel);
    });
    this.renderer.domElement.addEventListener('webglcontextlost', event => {
      event.preventDefault(); this.onStatus('3D graphics paused. Reload the page to restore them, or use 2D survey.');
    });
    this.resizeObserver = new ResizeObserver(() => this.resize()); this.resizeObserver.observe(container);
    this.resize();
  }

  resize() {
    const { width, height } = this.container.getBoundingClientRect();
    if (!width || !height) return;
    const oldAspect = this.camera.aspect;
    this.camera.aspect = width / height; this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    if (this.bounds && Math.abs(oldAspect - this.camera.aspect) > 0.25) this.fit(this.topView || false);
    this.invalidate();
  }

  invalidate() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      const changed = this.controls.update();
      this.scene.updateMatrixWorld(); this.renderer.render(this.scene, this.camera); this.positionLabels();
      if (changed) this.invalidate();
    });
  }

  geometry(floor) {
    const [x0, y0, x1, y1] = floor.fit;
    const vertices = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].flatMap(([x, y]) => { const p = toFrame(floor, x, y); return [p.x, 0, -p.y]; });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2));
    geometry.setIndex([0, 2, 1, 0, 3, 2]); geometry.computeVertexNormals();
    return geometry;
  }

  clearBuilding() {
    this.generation++;
    dispose(this.buildingGroup); this.buildingGroup.clear(); this.labels.replaceChildren(); this.floorGroups.clear();
    if (this.grid) { this.scene.remove(this.grid); dispose(this.grid); this.grid = null; }
    this.building = null; this.architecture = null; this.bounds = null; this.invalidate();
  }

  async setBuilding(building, selectedFloor, architecture) {
    this.clearBuilding();
    const generation = this.generation;
    this.building = building; this.floor = selectedFloor; this.architecture = architecture; this.selectedRoom = null;
    const box = new THREE.Box3(); let missing = 0;
    const loads = [];
    for (const floor of building.floors) {
      if (!floor.to_frame || !floor.fit) { missing++; continue; }
      const group = new THREE.Group(), geometry = this.geometry(floor);
      const plan = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: '#fbfcfa', transparent: true, side: THREE.DoubleSide, depthWrite: false }));
      plan.position.y = 0.08;
      const outline = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color: '#87a6a8', transparent: true, opacity: 0.6 }));
      const heat = new THREE.Mesh(geometry.clone(), new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide, depthWrite: false, opacity: 0.62 }));
      heat.position.y = 0.18; heat.visible = false;
      const markers = new THREE.Group(), overlay = new THREE.Group();
      const walls = new THREE.Group(), contextWalls = new THREE.Group(), exterior = new THREE.Group(), rooms = new THREE.Group(), architectureGroup = new THREE.Group();
      const model = architecture?.floors.find(f => f.id === floor.id);
      for (const wall of model?.walls || []) {
        const geometry = wallGeometry(wall); geometry.rotateX(-Math.PI / 2);
        const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: '#e3e4df', roughness: 0.9 }));
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 25), new THREE.LineBasicMaterial({ color: '#7d9191', transparent: true, opacity: 0.6 }));
        walls.add(mesh, edges);
      }
      for (const wall of model?.envelope?.context_walls || []) {
        const geometry = wallGeometry(wall); geometry.rotateX(-Math.PI / 2);
        contextWalls.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: '#e3e4df', roughness: 0.9 })));
      }
      for (const profile of model?.envelope?.walls || []) {
        const geometry = wallGeometry(profile); geometry.rotateX(-Math.PI / 2);
        const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: '#c5d2ce', roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 25), new THREE.LineBasicMaterial({ color: '#718c88', transparent: true, opacity: 0.5 }));
        exterior.add(mesh, edges);
      }
      for (const room of model?.rooms || []) {
        const geometry = roomGeometry(room); geometry.rotateX(-Math.PI / 2);
        const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: '#d2dcd9', roughness: 1, side: THREE.DoubleSide }));
        mesh.position.y = 0.04; mesh.userData.room = room; rooms.add(mesh);
      }
      architectureGroup.add(walls, contextWalls, exterior, rooms);
      group.add(plan, outline, architectureGroup, heat, markers, overlay); this.buildingGroup.add(group);
      const label = document.createElement('div'); label.className = 'floor-label'; label.textContent = `LEVEL ${floor.id}`; this.labels.appendChild(label);
      const anchor = toFrame(floor, floor.fit[0], floor.fit[3]);
      this.floorGroups.set(floor.id, { group, plan, outline, heat, markers, overlay, label, anchor, config: floor, model, walls, contextWalls, exterior, rooms, architectureGroup });
      box.expandByObject(model?.walls.length ? architectureGroup : plan);
      loads.push(new Promise(resolve => {
        const image = new Image();
        image.onload = () => {
          if (generation !== this.generation) { resolve(); return; }
          const [x0, y0, x1, y1] = floor.fit, scale = Math.min(1, 1300 / Math.max(x1 - x0, y1 - y0));
          const canvas = document.createElement('canvas'); canvas.width = Math.ceil((x1 - x0) * scale); canvas.height = Math.ceil((y1 - y0) * scale);
          const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(image, x0, y0, x1 - x0, y1 - y0, 0, 0, canvas.width, canvas.height);
          const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
          texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
          plan.material.map = texture; plan.material.needsUpdate = true; this.invalidate(); resolve();
        };
        image.onerror = () => { if (generation === this.generation) missing++; resolve(); };
        image.src = `buildings/${building.id}/${floor.image}`;
      }));
    }
    if (box.isEmpty()) { this.onStatus('No registered floor plans are available for this building.'); return; }
    this.bounds = box;
    const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    const gridSize = Math.ceil(Math.max(size.x, size.z) / 100) * 100 + 100;
    this.grid = new THREE.GridHelper(gridSize, gridSize / 25, '#b3c6c7', '#d8e1e1');
    this.grid.position.set(center.x, -25, center.z); this.grid.material.transparent = true; this.grid.material.opacity = 0.65; this.scene.add(this.grid);
    this.updateLayout(); this.fit();
    await Promise.all(loads);
    if (generation === this.generation) this.onStatus(missing ? `${missing} floor plan(s) could not be loaded or registered.` : '');
  }

  updateLayout() {
    if (!this.building) return;
    let lowest = Infinity;
    for (const [id, f] of this.floorGroups) {
      const active = id === this.floor;
      const assembledExterior = this.options.exterior && !this.options.isolate;
      const referenceOnly = ['internal', 'reference'].includes(f.model?.envelope?.role);
      const useContextWalls = assembledExterior && Array.isArray(f.model?.envelope?.context_walls);
      const band = exteriorBand(this.architecture, this.building, id, this.options);
      f.group.position.y = floorElevation(this.building, id, this.options.spacing) * this.options.separation;
      f.group.visible = (!this.options.isolate || active) && !(assembledExterior && referenceOnly);
      if (f.group.visible) lowest = Math.min(lowest, f.group.position.y);
      f.walls.visible = this.options.walls && !useContextWalls;
      f.walls.scale.y = this.options.wallHeight;
      f.contextWalls.visible = this.options.walls && useContextWalls;
      f.contextWalls.scale.y = this.options.wallHeight;
      f.exterior.visible = this.options.exterior && !!band;
      f.exterior.scale.y = band?.heightFt || 1;
      f.exteriorBand = band;
      f.rooms.visible = this.options.rooms;
      f.plan.visible = this.options.plans;
      f.outline.visible = this.options.plans;
      for (const mesh of f.rooms.children) mesh.material.color.set(mesh.userData.room.id === this.selectedRoom ? '#57b6a7' : '#d2dcd9');
      f.plan.material.opacity = active ? 0.95 : 0.23;
      f.outline.material.color.set(active ? '#386b6e' : '#87a6a8');
      f.heat.material.opacity = active ? 0.64 : 0.26;
      f.heat.visible = this.options.heat && !!f.heat.material.map;
      f.markers.visible = this.options.points;
      f.label.classList.toggle('active', active);
    }
    if (this.grid) this.grid.position.y = this.options.isolate ? (this.floorGroups.get(this.floor)?.group.position.y || 0) - 1 : lowest - 1;
    this.drawOverlay(); this.invalidate();
  }

  setFloor(id, selectedPoint) { const changed = this.floor !== id; this.floor = id; this.selectedPoint = selectedPoint; if (changed) this.selectedRoom = null; this.updateLayout(); if (changed && this.options.isolate) this.fit(this.topView); }

  selectRoom(id) { this.selectedRoom = id; this.updateLayout(); }

  setOptions(options) {
    const heatChanged = options.bssid !== this.options.bssid;
    Object.assign(this.options, options); this.updateLayout();
    if (heatChanged) this.setData(this.points);
  }

  setData(points) {
    this.points = points;
    for (const [id, floor] of this.floorGroups) {
      dispose(floor.markers); floor.markers.clear();
      const local = points.filter(p => p.floor === id), supported = local.filter(p => signalAt(p, this.options.bssid) != null);
      for (const point of supported) {
        const color = rgb(signalColor(signalAt(point, this.options.bssid)));
        const marker = new THREE.Mesh(new THREE.SphereGeometry(1.9, 10, 8), new THREE.MeshBasicMaterial({ color }));
        marker.position.set(point.x, 1.9, -point.y); floor.markers.add(marker);
      }
      floor.heat.material.map?.dispose(); floor.heat.material.map = null;
      if (supported.length) {
        const resolution = 100, canvas = document.createElement('canvas'); canvas.width = canvas.height = resolution;
        const ctx = canvas.getContext('2d'), image = ctx.createImageData(resolution, resolution);
        const [x0, y0, x1, y1] = floor.config.fit;
        for (let row = 0; row < resolution; row++) for (let col = 0; col < resolution; col++) {
          const p = toFrame(floor.config, x0 + (x1 - x0) * (col + 0.5) / resolution, y0 + (y1 - y0) * (row + 0.5) / resolution);
          const value = interpolate(local, id, p.x, p.y, this.options.bssid);
          if (value == null) continue;
          const color = signalColor(value), offset = (row * resolution + col) * 4;
          image.data.set([...color, 220], offset);
        }
        ctx.putImageData(image, 0, 0);
        if (floor.model?.rooms.length) {
          // Mask the display to reconstructed spaces. This does not alter signal values
          // or constrain the fingerprint estimator; unsupported/open regions stay blank.
          const mask = document.createElement('canvas'); mask.width = mask.height = resolution;
          const maskContext = mask.getContext('2d');
          for (const room of floor.model.rooms) {
            const path = new Path2D();
            for (const ring of [room.outline, ...room.holes]) {
              ring.forEach(([x, y], i) => {
                const p = fromFrame(floor.config, x, y), px = (p.x - x0) / (x1 - x0) * resolution, py = (p.y - y0) / (y1 - y0) * resolution;
                if (i) path.lineTo(px, py); else path.moveTo(px, py);
              });
              path.closePath();
            }
            maskContext.fill(path, 'evenodd');
          }
          ctx.globalCompositeOperation = 'destination-in'; ctx.drawImage(mask, 0, 0);
        }
        floor.heat.material.map = new THREE.CanvasTexture(canvas); floor.heat.material.map.colorSpace = THREE.SRGBColorSpace;
      }
      floor.heat.material.needsUpdate = true;
    }
    this.updateLayout();
  }

  setEstimate(estimate) { this.estimate = estimate?.ok ? estimate : null; this.drawOverlay(); this.invalidate(); }

  drawOverlay() {
    for (const f of this.floorGroups.values()) { dispose(f.overlay); f.overlay.clear(); }
    const current = this.floorGroups.get(this.floor);
    if (current && this.selectedPoint) {
      const p = toFrame(current.config, this.selectedPoint.x, this.selectedPoint.y);
      const marker = new THREE.Mesh(new THREE.SphereGeometry(3, 16, 10), new THREE.MeshBasicMaterial({ color: '#b95016' }));
      marker.position.set(p.x, 3.5, -p.y); current.overlay.add(marker);
      const ring = new THREE.Mesh(new THREE.RingGeometry(5, 5.8, 32), new THREE.MeshBasicMaterial({ color: '#b95016', side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(p.x, 0.8, -p.y); current.overlay.add(ring);
    }
    const e = this.estimate, f = e && this.floorGroups.get(e.floor);
    if (!f) return;
    const marker = new THREE.Mesh(new THREE.OctahedronGeometry(5), new THREE.MeshBasicMaterial({ color: '#1a8f8d' }));
    marker.position.set(e.x, 6, -e.y); f.overlay.add(marker);
    const radius = Math.max(3, e.spread);
    const ringPoints = Array.from({ length: 65 }, (_, i) => new THREE.Vector3(e.x + Math.cos(i / 64 * Math.PI * 2) * radius, 0.7, -e.y + Math.sin(i / 64 * Math.PI * 2) * radius));
    f.overlay.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(ringPoints), new THREE.LineBasicMaterial({ color: '#248b87', transparent: true, opacity: 0.75 })));
    for (const n of e.neighbors) {
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(e.x, 4, -e.y), new THREE.Vector3(n.x, 2, -n.y)]), new THREE.LineDashedMaterial({ color: '#248b87', dashSize: 3, gapSize: 2 }));
      line.computeLineDistances(); f.overlay.add(line);
    }
  }

  fit(top = false) {
    if (!this.bounds) return;
    this.topView = top;
    this.scene.updateMatrixWorld(true);
    const active = this.floorGroups.get(this.floor);
    const bounds = (top || this.options.isolate) && active ? new THREE.Box3().setFromObject(active.model?.walls.length ? active.architectureGroup : active.plan) : this.bounds.clone();
    if (!top && !this.options.isolate) {
      const visible = [...this.floorGroups.values()].filter(f => f.group.visible);
      bounds.min.y = Math.min(...visible.map(f => f.group.position.y));
      bounds.max.y = Math.max(...visible.map(f => f.group.position.y + Math.max(this.options.wallHeight, f.exterior.visible ? f.exteriorBand.heightFt : 0)));
    }
    const center = bounds.getCenter(new THREE.Vector3()), size = bounds.getSize(new THREE.Vector3());
    const halfFov = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const horizontalHalfFov = Math.atan(Math.tan(halfFov) * this.camera.aspect);
    // Fit the whole bounding sphere in perspective, including depth and stack height.
    // A max-axis heuristic clips rotated buildings in tall/narrow viewports.
    const margin = this.container.clientWidth < 600 ? 1.3 : 1.16;
    const distance = margin * (top
      ? Math.max(size.z / (2 * Math.tan(halfFov)), size.x / (2 * Math.tan(horizontalHalfFov)))
      : size.length() / (2 * Math.sin(Math.min(halfFov, horizontalHalfFov))));
    this.controls.target.copy(center);
    const direction = top ? new THREE.Vector3(0, 1, 0.00001) : new THREE.Vector3(0.85, 0.95, 1.15).normalize();
    this.camera.position.copy(center).addScaledVector(direction, Math.max(20, distance));
    this.controls.update(); this.invalidate();
  }

  focusRoom(room) {
    const f = this.floorGroups.get(this.floor);
    const mesh = f?.rooms.children.find(m => m.userData.room.id === room?.id);
    if (!mesh) return;
    this.scene.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(mesh), center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const distance = Math.max(55, size.length() * 2.2 / Math.min(1, this.camera.aspect));
    this.controls.target.copy(center); this.camera.position.copy(center).addScaledVector(new THREE.Vector3(.5, 1.3, 1).normalize(), distance);
    this.topView = false; this.controls.update(); this.invalidate();
  }

  positionLabels() {
    const { width, height } = this.container.getBoundingClientRect();
    for (const f of this.floorGroups.values()) {
      const p = new THREE.Vector3(f.anchor.x - 5, f.group.position.y, -f.anchor.y).project(this.camera);
      f.label.hidden = !f.group.visible || p.z > 1 || p.z < -1 || Math.abs(p.x) > 1 || Math.abs(p.y) > 1;
      f.label.style.left = `${(p.x + 1) * width / 2}px`; f.label.style.top = `${(1 - p.y) * height / 2}px`;
    }
  }

  destroy() {
    this.generation++; cancelAnimationFrame(this.frame); this.resizeObserver.disconnect(); this.controls.dispose();
    dispose(this.buildingGroup); if (this.grid) dispose(this.grid); this.renderer.dispose(); this.renderer.domElement.remove(); this.labels.replaceChildren();
  }
}

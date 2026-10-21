import * as THREE from './vendor/three.module.js';
import { floorElevation } from './signal-model.mjs';

export function polygonShape(polygon) {
  const trace = (path, ring) => {
    path.moveTo(...ring[0]);
    for (const p of ring.slice(1)) path.lineTo(...p);
    path.closePath(); return path;
  };
  const shape = trace(new THREE.Shape(), polygon.outline);
  shape.holes = (polygon.holes || []).map(ring => trace(new THREE.Path(), ring));
  return shape;
}

export function wallGeometry(wall, height = 1) {
  return new THREE.ExtrudeGeometry(polygonShape(wall), { depth: height, steps: 1, bevelEnabled: false });
}

export function roomGeometry(room) { return new THREE.ShapeGeometry(polygonShape(room)); }

// OBJ keeps building x/y, z-up and physical feet. Visual explosion is deliberately absent.
export function exportArchitectureOBJ(architecture, building, { wallHeight = 10, spacing = 14 } = {}) {
  if (!Number.isFinite(wallHeight) || wallHeight <= 0 || !Number.isFinite(spacing) || spacing <= 0) throw new Error('Model heights must be positive');
  const lines = ['# BevoTag room and wall model', '# Units: feet; X/Y: registered building frame; Z: up', '# Plan-derived reconstruction; heights approximate unless measured.'];
  let offset = 1;
  const safe = name => String(name).replace(/[^a-zA-Z0-9_.-]/g, '_');
  const write = (geometry, name, z) => {
    const p = geometry.getAttribute('position'), index = geometry.index;
    lines.push(`o ${safe(name)}`);
    for (let i = 0; i < p.count; i++) lines.push(`v ${p.getX(i).toFixed(4)} ${p.getY(i).toFixed(4)} ${(p.getZ(i) + z).toFixed(4)}`);
    const count = index?.count ?? p.count;
    for (let i = 0; i < count; i += 3) lines.push(`f ${[i, i + 1, i + 2].map(j => offset + (index ? index.getX(j) : j)).join(' ')}`);
    offset += p.count; geometry.dispose();
  };
  for (const floor of architecture.floors) {
    const z = floorElevation(building, floor.id, spacing);
    floor.walls.forEach((wall, i) => write(wallGeometry(wall, wallHeight), `${building.id}_${floor.id}_wall_${i + 1}`, z));
    floor.rooms.forEach(room => write(roomGeometry(room), `${building.id}_${floor.id}_${room.label}_${room.id}`, z));
  }
  return lines.join('\n') + '\n';
}

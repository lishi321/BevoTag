import * as THREE from './vendor/three.module.js';
import { floorElevation } from './signal-model.mjs';
import { verticalSummary } from './vertical-model.mjs';
import { exteriorBand, roofSurfaces, selectExteriorContextWalls } from './exterior-model.mjs';

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

// OBJ keeps building x/y and z-up in feet. Unknown Z values remain schematic.
export function exportArchitectureOBJ(architecture, building, { wallHeight = 10, spacing = 14, exterior = true, roofs = exterior } = {}) {
  if (!Number.isFinite(wallHeight) || wallHeight <= 0 || !Number.isFinite(spacing) || spacing <= 0) throw new Error('Model heights must be positive');
  const heights = verticalSummary(building, spacing);
  const comment = value => String(value).replace(/[\r\n]/g, ' ');
  const lines = ['# BevoTag room and wall model', '# Units: feet; X/Y: registered building frame; Z: up',
    '# Plan-derived reconstruction; no as-built accuracy implied.',
    `# Vertical datum: ${comment(typeof heights.datum === 'string' ? heights.datum : heights.datum.description)}`,
    `# Elevation provenance: ${heights.counts.documented} documented, ${heights.counts.estimated} source estimates, ${heights.counts.unverified} unverified entries, ${heights.counts.assumed} unknown (schematic placement).`,
    `# Wall display height: ${wallHeight} ft; unverified, not a measured clear height or storey height.`,
    '# Exploded-view separation is excluded.'];
  if (heights.counts.assumed) lines.push('# Unknown floor elevations use display spacing only. Do not use these Z values as surveyed building elevations.');
  if (building.vertical?.note) lines.push(`# Height research: ${comment(building.vertical.note)}`);
  if ((exterior || roofs) && architecture.envelope_review) {
    lines.push('# Exterior envelopes are separate inferred enclosure objects, not surveyed wall solids.',
      `# Envelope review: ${comment(JSON.stringify(architecture.envelope_review))}`);
  }
  for (const source of building.vertical?.sources || []) {
    lines.push(`# Research source (not a floor elevation): ${comment(source.title)}; ${comment(source.url)}; ${comment(source.evidence)}`);
  }
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
    const info = heights.rows.find(row => row.floorId === floor.id);
    lines.push(`# Level ${comment(floor.id)}: Z=${z} ft; status=${info.status}; ${comment(info.note)}`);
    if (info.source) lines.push(`# Height source: ${comment(info.source.title)}; ${comment(info.source.url)}; ${comment(info.source.evidence)}`);
    selectExteriorContextWalls(floor, exterior).forEach((wall, i) => write(wallGeometry(wall, wallHeight), `${building.id}_${floor.id}_wall_${i + 1}`, z));
    const referenceOnly = exterior && ['internal', 'reference'].includes(floor.envelope?.role);
    if (!referenceOnly) floor.rooms.forEach(room => write(roomGeometry(room), `${building.id}_${floor.id}_${room.label}_${room.id}`, z));
    if (referenceOnly) lines.push(`# Level ${comment(floor.id)}: ${floor.envelope.role} source geometry omitted from assembled exterior; export with exterior=false for all original wall/room geometry.`);
    if (exterior && floor.envelope?.context_walls) lines.push(`# Level ${comment(floor.id)}: context walls clipped to the reviewed exterior footprint; original source walls remain available with exterior=false.`);
    const band = exterior && exteriorBand(architecture, building, floor.id, { wallHeight, spacing });
    if (band) {
      lines.push(`# Exterior envelope ${comment(floor.id)}: base=${band.baseFt} ft; top=${band.topFt} ft; span status=${band.status}; geometry=inferred.`,
        `# ${comment(band.note)}`, `# Envelope top evidence: ${comment(JSON.stringify(band.top))}`);
      floor.envelope.walls.forEach((wall, i) => write(wallGeometry(wall, band.heightFt), `${building.id}_${floor.id}_inferred_envelope_${i + 1}`, band.baseFt));
    }
    if (roofs) for (const roof of roofSurfaces(architecture, building, floor.id, { wallHeight, spacing })) {
      lines.push(`# Roof surface ${comment(roof.label)}: type=${roof.kind}; surface=${roof.elevationFt} ft; base=${roof.baseFt} ft; display thickness=${roof.heightFt} ft (assumed); geometry=inferred.`,
        `# ${comment(roof.note)}`, `# Roof elevation evidence: ${comment(JSON.stringify(roof.elevation))}`,
        `# Roof geometry review: ${comment(JSON.stringify(roof.review || {}))}`);
      write(wallGeometry(roof, roof.heightFt), `${building.id}_${floor.id}_inferred_${roof.kind}_${roof.id}`, roof.baseFt);
    }
  }
  return lines.join('\n') + '\n';
}

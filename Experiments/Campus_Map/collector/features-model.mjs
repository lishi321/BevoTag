// Hand-traced stairs and bridge structure (buildings/<id>/features.json).
// Plan coordinates are building-frame feet. Heights are fractions of the floor-to-floor
// rise, so they follow whatever elevations the building displays. This module has no
// rendering dependency: it returns vertical prisms (plan ring + z range) and line segments.
import { pointInRing } from './architecture.mjs';

const finite = v => typeof v === 'number' && Number.isFinite(v);
const point = p => Array.isArray(p) && p.length === 2 && p.every(finite);
const edge = e => Array.isArray(e) && e.length === 2 && e.every(point);
const fraction = v => finite(v) && v >= 0 && v <= 1;
export const FINISHES = ['stair', 'wood', 'steel'];

export function validateFeatures(data, building) {
  if (data?.schema !== 1 || data.units !== 'ft' || data.building !== building.id) throw new Error('Unsupported building features');
  const order = building.floors.map(f => f.id), ids = new Set();
  const floor = id => order.includes(id);
  const fail = (what, id) => { throw new Error(`Invalid ${what}: ${id ?? '(no id)'}`); };
  const unique = item => { if (typeof item.id !== 'string' || !item.id || ids.has(item.id)) fail('feature id', item.id); ids.add(item.id); };
  for (const stair of data.stairs || []) {
    unique(stair);
    if (!floor(stair.from) || !floor(stair.to) || order.indexOf(stair.to) <= order.indexOf(stair.from)) fail('stair levels', stair.id);
    if (stair.kind === 'spiral') {
      const ok = point(stair.center) && finite(stair.inner_radius) && stair.inner_radius >= 0 && finite(stair.outer_radius)
        && stair.outer_radius > stair.inner_radius && finite(stair.start_deg) && finite(stair.sweep_deg) && stair.sweep_deg !== 0
        && Number.isInteger(stair.steps) && stair.steps >= 3;
      const column = stair.column;
      if (!ok || (column && (!floor(column.to) || order.indexOf(column.to) < order.indexOf(stair.from) || !(column.radius > 0)
        || (column.above_ft !== undefined && !(finite(column.above_ft) && column.above_ft >= 0))))) fail('spiral stair', stair.id);
    } else if (stair.kind === 'straight') {
      if (!Array.isArray(stair.flights) || !stair.flights.length) fail('stair flights', stair.id);
      for (const f of stair.flights) {
        if (!edge(f.start) || !edge(f.end) || !Array.isArray(f.rise) || f.rise.length !== 2 || !f.rise.every(fraction) || f.rise[1] <= f.rise[0]
          || !Number.isInteger(f.steps) || f.steps < 1 || (f.finish !== undefined && !FINISHES.includes(f.finish))) fail('stair flight', stair.id);
      }
      for (const l of stair.landings || []) if (!Array.isArray(l.outline) || l.outline.length < 3 || !l.outline.every(point) || !fraction(l.rise)) fail('stair landing', stair.id);
    } else fail('stair kind', stair.id);
  }
  for (const bridge of data.bridges || []) {
    unique(bridge);
    if (!floor(bridge.floor) || !Array.isArray(bridge.edges) || !bridge.edges.length || !bridge.edges.every(edge)
      || !(bridge.rail_height > 0) || !Number.isInteger(bridge.panels) || bridge.panels < 1) fail('bridge', bridge.id);
    const mask = bridge.hide_walls_within;
    if (mask !== undefined && (!Array.isArray(mask) || mask.length < 3 || !mask.every(point))) fail('bridge wall mask', bridge.id);
  }
  return data;
}

// A plan-derived wall that a bridge entry replaces with its own (lower) truss rails.
// Only walls lying entirely inside the reviewed mask are hidden; partial overlaps are kept.
export function hiddenByFeature(data, floorId, wall) {
  return (data?.bridges || []).some(bridge => bridge.floor === floorId && bridge.hide_walls_within
    && wall.outline.every(([x, y]) => pointInRing(bridge.hide_walls_within, x, y)));
}

const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const signedArea = ring => ring.reduce((sum, p, i) => { const q = ring[(i + 1) % ring.length]; return sum + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;
const ccw = ring => signedArea(ring) < 0 ? [...ring].reverse() : ring;
const polar = (c, r, deg) => [c[0] + r * Math.cos(deg * Math.PI / 180), c[1] + r * Math.sin(deg * Math.PI / 180)];

// A plan-view band of width w centered on segment a-b.
function band(a, b, w) {
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1, nx = -dy / len * w / 2, ny = dx / len * w / 2;
  return [[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny]];
}
const post = (p, w) => [[p[0] - w / 2, p[1] - w / 2], [p[0] + w / 2, p[1] - w / 2], [p[0] + w / 2, p[1] + w / 2], [p[0] - w / 2, p[1] + w / 2]];

/**
 * Solids for the features anchored on one floor.
 * riseFt(fromId, toId) returns the displayed height of toId above fromId, in feet.
 * Returns { prisms: [{ ring, z0, z1, finish, feature }], lines: [{ points: [[x,y,z], ...], feature }] }.
 */
export function featureSolids(data, floorId, riseFt) {
  const prisms = [], lines = [];
  const add = (feature, ring, z0, z1, finish = 'stair') => { if (z1 - z0 > 1e-3) prisms.push({ ring: ccw(ring), z0, z1, finish, feature }); };
  for (const stair of data?.stairs || []) {
    if (stair.from !== floorId) continue;
    const height = riseFt(stair.from, stair.to);
    if (!(height > 0.5)) continue;
    if (stair.kind === 'straight') {
      for (const f of stair.flights) {
        const za = f.rise[0] * height, zb = f.rise[1] * height, riser = (zb - za) / f.steps;
        const slab = Math.max(0.5, riser) + 0.35;
        for (let i = 0; i < f.steps; i++) {
          const t0 = i / f.steps, t1 = (i + 1) / f.steps, top = za + riser * (i + 1);
          const ring = [lerp(f.start[0], f.end[0], t0), lerp(f.start[1], f.end[1], t0), lerp(f.start[1], f.end[1], t1), lerp(f.start[0], f.end[0], t1)];
          add(stair.id, ring, f.solid ? 0 : Math.max(0, top - slab), top, f.finish);
        }
        if (!f.solid) for (const side of [0, 1]) {
          // Guard rail along each open side of a flying flight.
          lines.push({ feature: stair.id, points: [[...f.start[side], za + 3.4], [...f.end[side], zb + 3.4]] });
        }
      }
      for (const l of stair.landings || []) add(stair.id, l.outline, Math.max(0, l.rise * height - 0.85), l.rise * height);
    } else {
      const { center, inner_radius: r0, outer_radius: r1, start_deg: a0, sweep_deg: sweep, steps } = stair, riser = height / steps;
      const rail = [];
      for (let i = 0; i < steps; i++) {
        const b0 = a0 + sweep * i / steps, b1 = a0 + sweep * (i + 1) / steps, top = riser * (i + 1);
        add(stair.id, [polar(center, r0, b0), polar(center, r1, b0), polar(center, r1, (b0 + b1) / 2), polar(center, r1, b1), polar(center, r0, b1)],
          Math.max(0, top - riser - 0.4), top);
        rail.push([...polar(center, r1, b0), top - riser + 3.4], [...polar(center, r1, (b0 + b1) / 2), top - riser / 2 + 3.4]);
      }
      rail.push([...polar(center, r1, a0 + sweep), height + 3.4]);
      lines.push({ feature: stair.id, points: rail });
      if (stair.column) {
        const top = riseFt(stair.from, stair.column.to) + (stair.column.above_ft || 0);
        add(stair.id, Array.from({ length: 24 }, (_, i) => polar(center, stair.column.radius, i * 15)), 0, Math.max(top, height), 'steel');
        // Viewers may draw this as a perforated tube instead of a solid prism.
        if (stair.column.perforated) prisms.at(-1).tube = { center, radius: stair.column.radius };
      }
    }
  }
  for (const bridge of data?.bridges || []) {
    if (bridge.floor !== floorId) continue;
    const h = bridge.rail_height, n = bridge.panels;
    for (const [a, b] of bridge.edges) {
      add(bridge.id, band(a, b, 0.45), -1.2, 0.3, 'steel');      // bottom chord / deck edge beam
      add(bridge.id, band(a, b, 0.35), h - 0.3, h, 'steel');     // top chord
      const diagonal = [];
      for (let i = 0; i <= n; i++) {
        const p = lerp(a, b, i / n);
        add(bridge.id, post(p, 0.3), 0.3, h - 0.3, 'steel');
        diagonal.push([...p, i % 2 ? h - 0.3 : 0.3]);
      }
      lines.push({ feature: bridge.id, points: diagonal });
    }
  }
  return { prisms, lines };
}

// Flat-shaded triangle soup for vertical prisms with convex, counter-clockwise plan rings.
// Output is building-frame xyz (z up); the viewer rotates it into its y-up scene.
export function prismTriangles(prisms) {
  const out = [];
  const tri = (a, b, c) => out.push(...a, ...b, ...c);
  for (const { ring, z0, z1 } of prisms) {
    const top = ring.map(([x, y]) => [x, y, z1]), bottom = ring.map(([x, y]) => [x, y, z0]);
    for (let i = 1; i < ring.length - 1; i++) { tri(top[0], top[i], top[i + 1]); tri(bottom[0], bottom[i + 1], bottom[i]); }
    for (let i = 0; i < ring.length; i++) {
      const j = (i + 1) % ring.length;
      tri(bottom[i], bottom[j], top[j]); tri(bottom[i], top[j], top[i]);
    }
  }
  return out;
}

// Multi-wall path-loss simulation over the reconstructed room-and-wall model.
// AP positions are an input: the default is one assumed AP at every modeled space's center,
// so surveyed/real AP positions can replace the list later without other changes.
// Units: model frame feet. Not calibrated against measurements.
import { fromFrame } from './signal-model.mjs';

export const SIM_DEFAULTS = Object.freeze({
  p1m: -40,          // RSSI at 1 m, typical 2.4 GHz AP
  exponent: 2,       // free-space; walls are counted explicitly
  wallLoss: 5,       // dB per interior wall crossed
  floorLoss: 15,     // dB per floor slab
  floorHeight: 14,   // ft, schematic storey spacing
  floorRange: 1,     // neighboring floors included
  candidates: 24,    // nearest APs evaluated for wall loss per point
  keep: 16,          // strongest APs reported per simulated scan
  floor: -95,        // receiver sensitivity cutoff, dBm
  spacing: 10,       // ft, survey grid spacing inside spaces
});

const FT_PER_M = 3.28084;
const mac = (floorIndex, i) => `02:51:${floorIndex.toString(16).padStart(2, '0')}:${(i >> 8).toString(16).padStart(2, '0')}:${(i & 255).toString(16).padStart(2, '0')}:00`;

// One assumed AP at the center of every modeled space on every floor.
export function roomCenterAps(building, architecture) {
  const aps = [];
  for (const [fi, floor] of building.floors.entries()) {
    const rooms = architecture?.floors.find(f => f.id === floor.id)?.rooms || [];
    rooms.forEach((room, i) => aps.push({ bssid: mac(fi, i), ssid: `Sim AP · ${floor.id} ${room.label}`,
      floor: floor.id, x: room.center[0], y: room.center[1], room: room.label }));
  }
  return aps;
}

function segmentsCross(ax, ay, bx, by, cx, cy, dx, dy) {
  const d1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax), d2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  const d3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx), d4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

function prepareWalls(walls) {
  return (walls || []).map(w => {
    const xs = w.outline.map(p => p[0]), ys = w.outline.map(p => p[1]);
    return { ring: w.outline, minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  });
}

// Number of wall polygons the straight path between two points passes through.
export function wallsCrossed(walls, ax, ay, bx, by) {
  const minX = Math.min(ax, bx), maxX = Math.max(ax, bx), minY = Math.min(ay, by), maxY = Math.max(ay, by);
  let count = 0;
  for (const w of walls) {
    if (w.maxX < minX || w.minX > maxX || w.maxY < minY || w.minY > maxY) continue;
    const r = w.ring;
    for (let i = 0; i < r.length; i++) {
      const [cx, cy] = r[i], [dx, dy] = r[(i + 1) % r.length];
      if (segmentsCross(ax, ay, bx, by, cx, cy, dx, dy)) { count++; break; }
    }
  }
  return count;
}

export function pathLoss({ distanceFt, walls = 0, floors = 0 }, o = SIM_DEFAULTS) {
  const meters = Math.max(1, distanceFt / FT_PER_M);
  return o.p1m - 10 * o.exponent * Math.log10(meters) - walls * o.wallLoss - floors * o.floorLoss;
}

export function createSimulation(building, architecture, aps = roomCenterAps(building, architecture), options = {}) {
  const o = { ...SIM_DEFAULTS, ...options };
  const index = new Map(building.floors.map((f, i) => [f.id, i]));
  const walls = new Map((architecture?.floors || []).map(f => [f.id, prepareWalls(f.walls)]));
  const placed = aps.filter(ap => index.has(ap.floor));
  return {
    options: o, aps: placed,
    scan(floorId, x, y) {
      const fi = index.get(floorId);
      if (fi == null) return { type: 'scan', aps: [] };
      const near = [];
      for (const ap of placed) {
        const df = Math.abs(index.get(ap.floor) - fi);
        if (df > o.floorRange) continue;
        const distanceFt = Math.hypot(ap.x - x, ap.y - y, df * o.floorHeight);
        near.push({ ap, df, distanceFt, upper: pathLoss({ distanceFt, floors: df }, o) });
      }
      near.sort((a, b) => b.upper - a.upper);
      const out = [];
      for (const c of near.slice(0, o.candidates)) {
        if (c.upper < o.floor) break;
        // Cross-floor paths: slab loss only; wall counts need a resolved 3D path.
        const crossed = c.df ? 0 : wallsCrossed(walls.get(floorId) || [], c.ap.x, c.ap.y, x, y);
        const rssi = Math.round(pathLoss({ distanceFt: c.distanceFt, walls: crossed, floors: c.df }, o));
        if (rssi >= o.floor) out.push({ bssid: c.ap.bssid, ssid: c.ap.ssid, rssi, ch: [1, 6, 11][out.length % 3] });
      }
      out.sort((a, b) => b.rssi - a.rssi);
      return { type: 'scan', aps: out.slice(0, o.keep) };
    },
  };
}

function inRing(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Simulated survey samples: a grid inside every modeled space plus each space's center.
export function simulateSurvey(building, architecture, sim = createSimulation(building, architecture)) {
  const samples = [], step = sim.options.spacing;
  for (const floor of building.floors) {
    const rooms = architecture?.floors.find(f => f.id === floor.id)?.rooms;
    if (!floor.to_frame || !rooms?.length) continue;
    const add = (x, y, label) => {
      const p = fromFrame(floor, x, y);
      if (p) samples.push({ building: building.id, floor: floor.id, room: `Sim · ${label}`, x_px: p.x, y_px: p.y,
        scan: sim.scan(floor.id, x, y), source: 'sim' });
    };
    for (const room of rooms) {
      add(room.center[0], room.center[1], room.label);
      const xs = room.outline.map(p => p[0]), ys = room.outline.map(p => p[1]);
      for (let x = Math.ceil(Math.min(...xs) / step) * step; x <= Math.max(...xs); x += step) {
        for (let y = Math.ceil(Math.min(...ys) / step) * step; y <= Math.max(...ys); y += step) {
          if (inRing(room.outline, x, y) && !room.holes.some(h => inRing(h, x, y))) add(x, y, room.label);
        }
      }
    }
  }
  return samples;
}

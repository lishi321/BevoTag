// Architecture coordinates use the same horizontal feet as the survey registration.
export function pointInRing(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[j], [bx, by] = ring[i];
    const cross = (x - ax) * (by - ay) - (y - ay) * (bx - ax);
    if (Math.abs(cross) < 1e-7 && x >= Math.min(ax, bx) - 1e-7 && x <= Math.max(ax, bx) + 1e-7 && y >= Math.min(ay, by) - 1e-7 && y <= Math.max(ay, by) + 1e-7) return true;
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

export function containsPoint(space, x, y) {
  return Number.isFinite(x) && Number.isFinite(y) && pointInRing(space.outline, x, y) && !(space.holes || []).some(h => pointInRing(h, x, y));
}

export function roomAt(floor, x, y) {
  return (floor?.rooms || []).filter(room => containsPoint(room, x, y)).sort((a, b) => a.area_ft2 - b.area_ft2)[0] || null;
}

export function validateArchitecture(data, building) {
  if (data?.schema !== 1 || data.units !== 'ft' || data.building !== building.id || !Array.isArray(data.floors)) throw new Error('Unsupported building geometry');
  const expected = new Set(building.floors.map(f => f.id)), seen = new Set();
  for (const floor of data.floors) {
    if (!expected.has(floor.id) || seen.has(floor.id) || !Array.isArray(floor.walls) || !Array.isArray(floor.rooms)) throw new Error('Invalid model floor');
    seen.add(floor.id);
    for (const polygon of [...floor.walls, ...floor.rooms]) {
      for (const ring of [polygon.outline, ...(polygon.holes || [])]) {
        if (!Array.isArray(ring) || ring.length < 3 || ring.some(p => !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite))) throw new Error('Invalid model polygon');
      }
    }
    const ids = new Set();
    for (const room of floor.rooms) {
      if (!room.id || ids.has(room.id) || typeof room.label !== 'string' || !(room.area_ft2 > 0) || !Array.isArray(room.center) || !containsPoint(room, ...room.center)) throw new Error('Invalid model space');
      ids.add(room.id);
    }
  }
  if (seen.size !== expected.size) throw new Error('Building model is missing floors');
  return data;
}

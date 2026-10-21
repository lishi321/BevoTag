// Pure geometry, CSV and fingerprint routines. Shared by the UI and Node tests.
export const MISSING_RSSI = -100;
export const finite = value => value !== '' && value != null && Number.isFinite(Number(value));

export function toFrame(floor, x, y) {
  if (!floor?.to_frame || !finite(x) || !finite(y)) return null;
  const [a, b, c, d, e, f] = floor.to_frame;
  return { x: a * Number(x) + b * Number(y) + c, y: d * Number(x) + e * Number(y) + f };
}

export function fromFrame(floor, x, y) {
  if (!floor?.to_frame) return null;
  const [a, b, c, d, e, f] = floor.to_frame, det = a * e - b * d;
  if (Math.abs(det) < 1e-12) return null;
  return { x: (e * (x - c) - b * (y - f)) / det, y: (-d * (x - c) + a * (y - f)) / det };
}

export function floorElevation(building, floorId, spacing = 14) {
  const i = building.floors.findIndex(f => f.id === floorId);
  const ground = Math.max(0, building.floors.findIndex(f => f.id === '1'));
  return finite(building.floors[i]?.elevation_ft) ? Number(building.floors[i].elevation_ft) : (i - ground) * spacing;
}

export function fingerprint(aps) {
  const values = new Map();
  for (const ap of aps || []) {
    if (!ap || typeof ap.bssid !== 'string' || !finite(ap.rssi)) continue;
    const bssid = ap.bssid.trim().toLowerCase(), rssi = Number(ap.rssi);
    if (!/^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(bssid) || rssi > 0 || rssi < -120) continue;
    const prev = values.get(bssid);
    if (!prev || rssi > prev.rssi) values.set(bssid, { bssid, rssi, ssid: String(ap.ssid ?? '') });
  }
  return [...values.values()];
}

// RFC 4180 quoted fields, escaped quotes and embedded line breaks; reject broken files.
export function parseCSV(text) {
  text = text.replace(/^\uFEFF/, '');
  const rows = []; let row = [], field = '', quoted = false, closed = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else field += c;
    } else if (c === '"' && !field && !closed) quoted = true;
    else if (c === ',') { row.push(field); field = ''; closed = false; }
    else if (c === '\r' || c === '\n') {
      row.push(field); if (row.some(v => v !== '')) rows.push(row);
      row = []; field = ''; closed = false;
      if (c === '\r' && text[i + 1] === '\n') i++;
    } else {
      if (closed || c === '"') throw new Error('Invalid CSV quoting. Import an original BevoTag CSV.');
      field += c;
    }
  }
  if (quoted) throw new Error('Incomplete CSV: an opening quote has no closing quote.');
  if (field || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) throw new Error('The CSV is empty.');
  const header = rows.shift();
  for (const key of ['session', 'building', 'floor', 'room', 'x_px', 'y_px', 'collecting', 'batch', 'dir', 'type', 'line']) {
    if (!header.includes(key)) throw new Error(`Missing CSV column: ${key}`);
  }
  if (new Set(header).size !== header.length) throw new Error('Duplicate CSV column names.');
  return rows.map((cells, i) => {
    if (cells.length !== header.length) throw new Error(`CSV row ${i + 2} has ${cells.length} fields; expected ${header.length}.`);
    return Object.fromEntries(header.map((key, j) => [key, cells[j]]));
  });
}

export function importSurvey(rows, buildings) {
  const bad = new Set(), simulated = new Set();
  const batchKey = r => JSON.stringify([r.session, r.batch]);
  for (const r of rows) {
    if (r.type === 'discard') bad.add(batchKey(r));
    if (r.type === 'hello' || r.type === 'session') {
      try { const m = JSON.parse(r.line); if (m.chip === 'SIMULATOR' || m.source === 'sim') simulated.add(r.session); } catch { /* raw debug line */ }
    }
  }
  const samples = [], seen = new Set(); let skipped = 0, simulatorRows = 0;
  for (const r of rows) {
    if (r.type !== 'scan' || r.dir !== 'in') continue;
    if (simulated.has(r.session)) { simulatorRows++; continue; }
    if (r.collecting !== '1' || !r.batch || !r.room.trim() || bad.has(batchKey(r))) { skipped++; continue; }
    const building = buildings[r.building], floor = building?.floors.find(f => f.id === r.floor);
    const p = toFrame(floor, r.x_px, r.y_px);
    if (!p || Number(r.x_px) < 0 || Number(r.y_px) < 0) { skipped++; continue; }
    try {
      const m = JSON.parse(r.line);
      if (!Array.isArray(m.aps)) { skipped++; continue; }
      const aps = fingerprint(m.aps);
      if (!aps.length) { skipped++; continue; }
      const key = JSON.stringify([r.session, r.batch, r.host_time, r.line]);
      if (seen.has(key)) continue;
      seen.add(key);
      samples.push({ key, building: r.building, floor: r.floor, room: r.room,
        x_px: Number(r.x_px), y_px: Number(r.y_px), x: p.x, y: p.y,
        batch: r.batch, session: r.session, scan: { aps }, source: 'import' });
    } catch { skipped++; }
  }
  return { samples, skipped, simulatorRows };
}

// Average repeat scans at the same physical point so dwell time cannot bias the estimate.
export function surveyPoints(samples, building) {
  const groups = new Map();
  for (const sample of samples) {
    if (sample.building !== building.id) continue;
    const floor = building.floors.find(f => f.id === sample.floor);
    const p = toFrame(floor, sample.x_px, sample.y_px);
    if (!p) continue;
    const key = `${sample.floor}|${Math.round(sample.x_px)}|${Math.round(sample.y_px)}`;
    if (!groups.has(key)) groups.set(key, { ...sample, ...p, key, count: 0, values: new Map() });
    const g = groups.get(key); g.count++;
    for (const ap of fingerprint(sample.scan?.aps)) {
      const v = g.values.get(ap.bssid) || { total: 0, n: 0, ssid: ap.ssid };
      v.total += ap.rssi; v.n++; g.values.set(ap.bssid, v);
    }
  }
  return [...groups.values()].map(g => ({ ...g,
    aps: [...g.values].map(([bssid, v]) => ({ bssid, ssid: v.ssid, rssi: v.total / v.n })) }));
}

export function signalAt(point, bssid = '*') {
  if (!point.aps.length) return null;
  return bssid === '*' ? Math.max(...point.aps.map(a => a.rssi)) : point.aps.find(a => a.bssid === bssid)?.rssi ?? null;
}

// A local interpolation, with a radius cutoff. Empty/unsurveyed areas stay transparent.
export function interpolate(points, floor, x, y, bssid = '*', radius = 60) {
  let weighted = 0, weight = 0;
  for (const point of points) {
    if (point.floor !== floor) continue;
    const value = signalAt(point, bssid), distance = Math.hypot(point.x - x, point.y - y);
    if (value == null || distance > radius) continue;
    if (distance < 0.01) return value;
    const w = (1 - distance / radius) ** 2 / Math.max(1, distance * distance);
    weighted += value * w; weight += w;
  }
  return weight ? weighted / weight : null;
}

export function signalColor(rssi) {
  const stops = [[83, 74, 151], [54, 141, 168], [57, 182, 156], [231, 192, 87], [224, 101, 52]];
  const t = Math.max(0, Math.min(1, (rssi + 95) / 60)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(t)), f = t - i;
  return stops[i].map((c, j) => Math.round(c + (stops[i + 1][j] - c) * f));
}

export function estimatePosition(points, rawAps, { k = 5, minShared = 3, maxDistance = 22 } = {}) {
  const query = new Map(fingerprint(rawAps).sort((a, b) => b.rssi - a.rssi).slice(0, 32).map(a => [a.bssid, a.rssi]));
  if (query.size < minShared) return { ok: false, reason: 'At least 3 valid BSSIDs are needed in the new scan.' };
  const candidates = [];
  for (const point of points) {
    const ref = new Map(point.aps.map(a => [a.bssid, a.rssi]));
    const common = [...query.keys()].filter(id => ref.has(id));
    if (common.length < minShared || common.length / query.size < 0.25) continue;
    const union = new Set([...query.keys(), ...ref.keys()]);
    let square = 0;
    for (const id of union) square += ((query.get(id) ?? MISSING_RSSI) - (ref.get(id) ?? MISSING_RSSI)) ** 2;
    const distance = Math.sqrt(square / union.size);
    if (distance <= maxDistance) candidates.push({ ...point, distance, shared: common.length, weight: 1 / Math.max(1, distance) ** 2 });
  }
  candidates.sort((a, b) => a.distance - b.distance);
  if (candidates.length < 3) return { ok: false, reason: 'Not enough overlap: survey at least 3 distinct points with matching BSSIDs.' };
  const nearest = candidates.slice(0, k), votes = new Map();
  for (const c of nearest) votes.set(c.floor, (votes.get(c.floor) || 0) + c.weight);
  const floor = [...votes].sort((a, b) => b[1] - a[1])[0][0];
  // Never average coordinates across floors; that can put the marker between storeys.
  const neighbors = nearest.filter(c => c.floor === floor);
  const total = neighbors.reduce((sum, c) => sum + c.weight, 0);
  const x = neighbors.reduce((sum, c) => sum + c.x * c.weight, 0) / total;
  const y = neighbors.reduce((sum, c) => sum + c.y * c.weight, 0) / total;
  const spread = Math.sqrt(neighbors.reduce((sum, c) => sum + c.weight * ((c.x - x) ** 2 + (c.y - y) ** 2), 0) / total);
  return { ok: true, floor, x, y, spread, neighbors, shared: neighbors[0].shared,
    distance: neighbors[0].distance, room: neighbors[0].room,
    floorSupport: votes.get(floor) / nearest.reduce((sum, c) => sum + c.weight, 0) };
}

// Deterministic demo field, deliberately separate from real CSVs and collection state.
export function demoScan(building, floorId, x, y) {
  const index = building.floors.findIndex(f => f.id === floorId), aps = [];
  for (const [fi, floor] of building.floors.entries()) {
    const box = floor.fit;
    if (!floor.to_frame || !box) continue;
    for (let i = 0; i < 6; i++) {
      const p = toFrame(floor, box[0] + (box[2] - box[0]) * (0.2 + (i % 3) * 0.3), box[1] + (box[3] - box[1]) * (0.28 + Math.floor(i / 3) * 0.44));
      const distance = Math.max(3, Math.hypot(p.x - x, p.y - y));
      const rssi = Math.round(-30 - 23 * Math.log10(distance / 3) - Math.abs(fi - index) * 17);
      if (rssi > -95) aps.push({ bssid: `02:be:00:${fi.toString(16).padStart(2, '0')}:00:${i.toString(16).padStart(2, '0')}`, ssid: 'Demo campus Wi-Fi', rssi, ch: [1, 6, 11][i % 3] });
    }
  }
  return { type: 'scan', aps };
}

export function demoSurvey(building) {
  const samples = [];
  for (const floor of building.floors) {
    if (!floor.to_frame || !floor.fit) continue;
    const [x0, y0, x1, y1] = floor.fit;
    for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) {
      const x_px = x0 + (x1 - x0) * (0.16 + col * 0.22), y_px = y0 + (y1 - y0) * (0.16 + row * 0.22);
      const p = toFrame(floor, x_px, y_px);
      samples.push({ building: building.id, floor: floor.id, room: `Demo ${floor.id}.${row + 1}${col + 1}`,
        x_px, y_px, scan: demoScan(building, floor.id, p.x, p.y), source: 'demo' });
    }
  }
  return samples;
}

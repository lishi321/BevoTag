import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { toFrame, fromFrame, floorElevation, fingerprint, parseCSV, importSurvey, surveyPoints,
  interpolate, signalColor, estimatePosition, demoScan, demoSurvey } from '../signal-model.mjs';

const buildings = Object.fromEntries(['EER', 'ASE', 'ECJ'].map(id => [id, JSON.parse(readFileSync(new URL(`../buildings/${id}/building.json`, import.meta.url)))]));
const aps = [1, 2, 3, 4].map(i => ({ bssid: `aa:bb:cc:dd:ee:0${i}`, ssid: 'Campus, "Wi-Fi"\nlab', rssi: -45 - i * 3 }));
const row = (extra = {}) => ({ host_time: '2026-10-21T01:00:00Z', session: 'session-a', building: 'EER', floor: '2', room: '2.610', x_px: '1200', y_px: '2000', collecting: '1', batch: 'batch-a', dir: 'in', type: 'scan', line: JSON.stringify({ type: 'scan', aps }), ...extra });
const csv = rows => {
  const keys = Object.keys(row());
  const quote = v => `"${String(v ?? '').replaceAll('"', '""')}"`;
  return '\uFEFF' + keys.join(',') + '\r\n' + rows.map(r => keys.map(k => quote(r[k])).join(',')).join('\r\n') + '\r\n';
};

test('all 31 floor registrations round-trip image coordinates, including rotated plans', () => {
  let count = 0;
  for (const building of Object.values(buildings)) for (const floor of building.floors) {
    for (const [x, y] of [[floor.fit[0], floor.fit[1]], [floor.fit[2], floor.fit[3]], [1320.3, 2111.7]]) {
      const p = toFrame(floor, x, y), back = fromFrame(floor, p.x, p.y);
      assert.ok(Math.abs(back.x - x) < 1e-8 && Math.abs(back.y - y) < 1e-8, `${building.id} ${floor.id}`);
    }
    count++;
  }
  assert.equal(count, 31);
  assert.equal(toFrame({}, 10, 20), null);
  assert.equal(fromFrame({ to_frame: [0, 0, 0, 0, 0, 0] }, 1, 1), null);
});

test('floor heights respect ordering, basement, spacing, and measured overrides', () => {
  assert.equal(floorElevation(buildings.EER, 'B'), -14);
  assert.equal(floorElevation(buildings.EER, '1'), 0);
  assert.equal(floorElevation(buildings.EER, '3', 16), 32);
  assert.equal(floorElevation({ floors: [{ id: '1', elevation_ft: 8 }] }, '1'), 8);
});

test('fingerprints normalize and deduplicate BSSIDs and reject invalid measurements', () => {
  assert.deepEqual(fingerprint([{ ...aps[0], bssid: 'AA:BB:CC:DD:EE:01', rssi: -80 }, aps[0],
    { ...aps[1], rssi: null }, { ...aps[1], rssi: '' }, { ...aps[1], rssi: 1 },
    { ...aps[1], rssi: -121 }, { bssid: 'not-a-mac', rssi: -50 }]), [aps[0]]);
});

test('CSV round-trip preserves commas, escaped quotes, embedded newlines, CRLF and BOM', () => {
  const data = [row({ room: 'Room, "A"\nannex' }), row({ host_time: 'second' })];
  assert.deepEqual(parseCSV(csv(data)), data);
  assert.equal(importSurvey(parseCSV(csv(data)), buildings).samples.length, 2);
});

test('CSV rejects missing/duplicate columns, truncated quotes and uneven rows', () => {
  assert.throws(() => parseCSV('foo,bar\n1,2'), /Missing/);
  assert.throws(() => parseCSV(csv([row()]).slice(0, -4)), /Incomplete/);
  assert.throws(() => parseCSV(csv([]) + 'a,b\n'), /fields/);
  assert.throws(() => parseCSV(csv([]).trimEnd() + ',session\n'), /Duplicate/);
  assert.throws(() => parseCSV(csv([]) + '"value"x'), /quoting/);
});

test('import excludes unlabelled, outgoing, malformed and unregistered scans', () => {
  const rows = [row(), row({ collecting: '0' }), row({ dir: 'out' }), row({ batch: '' }),
    row({ room: ' ' }), row({ floor: 'unknown' }), row({ x_px: '' }), row({ x_px: '-1' }),
    row({ line: 'invalid JSON' }), row({ line: '{"aps":[]}' }), row({ line: '{"aps":{}}' })];
  const result = importSurvey(rows, buildings);
  assert.equal(result.samples.length, 1);
  assert.equal(result.skipped, 9);
  const p = toFrame(buildings.EER.floors[2], 1200, 2000);
  assert.equal(result.samples[0].x, p.x);
});

test('discard is scoped by session and works when imported after the original CSV', () => {
  const a = row(), b = row({ session: 'session-b' });
  const discard = row({ type: 'discard', dir: 'app', collecting: '0', line: '{"type":"discard"}' });
  assert.equal(importSurvey([a, b], buildings).samples.length, 2);
  assert.deepEqual(importSurvey([a, b, discard], buildings).samples.map(s => s.session), ['session-b']);
});

test('simulator hello or session metadata excludes that session regardless of row order', () => {
  for (const meta of [{ type: 'hello', chip: 'SIMULATOR' }, { type: 'session', source: 'sim' }]) {
    const result = importSurvey([row(), row({ type: meta.type, line: JSON.stringify(meta), dir: 'app' })], buildings);
    assert.equal(result.samples.length, 0);
    assert.equal(result.simulatorRows, 1);
  }
});

test('repeated imports deduplicate scans and repeat scans average at distinct physical points', () => {
  const a = row(), b = row({ host_time: 'second', line: JSON.stringify({ aps: aps.map(a => ({ ...a, rssi: a.rssi - 10 })) }) });
  const samples = importSurvey([a, b, a, b], buildings).samples;
  assert.equal(samples.length, 2);
  const points = surveyPoints(samples, buildings.EER);
  assert.equal(points.length, 1);
  assert.equal(points[0].count, 2);
  assert.equal(points[0].aps[0].rssi, aps[0].rssi - 5);
});

test('heatmap never crosses floors or invents support beyond its radius', () => {
  const points = [{ floor: '2', x: 0, y: 0, aps }];
  assert.equal(interpolate(points, '2', 0, 0), -48);
  assert.equal(interpolate(points, '1', 0, 0), null);
  assert.equal(interpolate(points, '2', 61, 0), null);
  assert.equal(interpolate(points, '2', 5, 0, 'unknown'), null);
  assert.deepEqual(signalColor(-150), signalColor(-95));
  assert.deepEqual(signalColor(0), signalColor(-35));
});

test('estimator rejects sparse, novel and strongly mismatched fingerprints', () => {
  const points = [0, 1, 2].map(x => ({ floor: '2', x, y: 0, aps }));
  assert.equal(estimatePosition(points, aps.slice(0, 2)).ok, false);
  assert.equal(estimatePosition(points.slice(0, 2), aps).ok, false);
  assert.equal(estimatePosition(points, aps.map(a => ({ ...a, bssid: a.bssid.replace('aa:', 'bb:') }))).ok, false);
  assert.equal(estimatePosition(points, aps.map(a => ({ ...a, rssi: -110 }))).ok, false);
});

test('floor vote never averages horizontal coordinates between storeys', () => {
  const points = [0, 10, 20].map(x => ({ floor: '2', x, y: 5, aps }));
  points.push(...[1000, 1100].map(x => ({ floor: '3', x, y: 1000, aps: aps.map(a => ({ ...a, rssi: a.rssi - 5 })) })));
  const result = estimatePosition(points, aps);
  assert.equal(result.ok, true); assert.equal(result.floor, '2');
  assert.equal(result.x, 10); assert.equal(result.y, 5);
  assert.ok(result.neighbors.every(p => p.floor === '2'));
  assert.ok(result.spread > 0 && result.floorSupport > 0.9);
});

test('independent demo queries locate all 31 floors without modifying the reference data', () => {
  for (const building of Object.values(buildings)) {
    const samples = demoSurvey(building), points = surveyPoints(samples, building), before = JSON.stringify(points);
    assert.equal(samples.length, building.floors.length * 16);
    for (const floor of building.floors) {
      const [x0, y0, x1, y1] = floor.fit, p = toFrame(floor, x0 + (x1-x0)*0.47, y0 + (y1-y0)*0.51);
      const estimate = estimatePosition(points, demoScan(building, floor.id, p.x, p.y).aps);
      assert.equal(estimate.ok, true, `${building.id} ${floor.id}`);
      assert.equal(estimate.floor, floor.id, `${building.id} ${floor.id}`);
      assert.ok(Number.isFinite(estimate.spread));
    }
    assert.equal(JSON.stringify(points), before);
  }
});

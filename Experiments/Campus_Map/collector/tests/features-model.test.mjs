import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateFeatures, featureSolids, prismTriangles, hiddenByFeature } from '../features-model.mjs';
import { containsPoint } from '../architecture.mjs';

const read = path => JSON.parse(readFileSync(new URL(`../buildings/EER/${path}`, import.meta.url)));
const building = read('building.json'), features = read('features.json'), architecture = read('architecture.json');
const rise = (from, to) => 14 * (building.floors.findIndex(f => f.id === to) - building.floors.findIndex(f => f.id === from));

test('EER stairs and bridge validate and cite sources', () => {
  validateFeatures(features, building);
  assert.deepEqual(features.stairs.map(s => s.id), ['eer-stair-g', 'eer-stair-f', 'eer-stair-h']);
  for (const source of features.sources) assert.ok(source.evidence && (source.url || source.file));
});

test('malformed features are rejected', () => {
  const broken = structuredClone(features);
  broken.stairs[0].to = 'B';
  assert.throws(() => validateFeatures(broken, building), /stair levels/);
  const duplicate = structuredClone(features);
  duplicate.bridges[0].id = duplicate.stairs[0].id;
  assert.throws(() => validateFeatures(duplicate, building), /feature id/);
  assert.throws(() => validateFeatures({ ...features, building: 'ECJ' }, building), /Unsupported/);
});

test('each flight climbs monotonically from its start floor to the next level', () => {
  const { prisms } = featureSolids(features, 'B', rise);
  const g = prisms.filter(p => p.feature === 'eer-stair-g');
  assert.equal(g.length, 70);
  assert.equal(Math.max(...g.map(p => p.z1)), 14);
  const tops = g.filter(p => p.finish === 'stair').slice(0, 30).map(p => p.z1);
  assert.ok(tops.every((z, i) => !i || z > tops[i - 1]));
  // Stair F lands on its landing at 64% and finishes on Level 2.
  const f = featureSolids(features, '1', rise).prisms.filter(p => p.feature === 'eer-stair-f');
  assert.equal(Math.max(...f.map(p => p.z1)), 14);
  assert.ok(f.some(p => Math.abs(p.z1 - 0.64 * 14) < 1e-9 && p.ring.length === 5));
});

test('spiral stair spans B to 2 and its perforated tube reaches above Level 3', () => {
  const { prisms, lines } = featureSolids(features, 'B', rise);
  const h = prisms.filter(p => p.feature === 'eer-stair-h');
  const tube = h.find(p => p.tube);
  assert.equal(h.length, 55);
  assert.equal(Math.max(...h.filter(p => !p.tube).map(p => p.z1)), 28);
  assert.equal(tube.z1, 14 * 3 + 3);
  assert.ok(lines.some(l => l.feature === 'eer-stair-h'));
  // Everything on other floors is anchored elsewhere.
  assert.equal(featureSolids(features, '4', rise).prisms.length, 0);
});

test('bridge truss sits on the reconstructed 2.705 floor', () => {
  const room = architecture.floors.find(f => f.id === '2').rooms.find(r => r.label === '2.705');
  const bridge = features.bridges[0];
  // Points between the two truss lines, along the whole span, are on the bridge deck.
  const [[a0, a1], [b0, b1]] = bridge.edges;
  for (const t of [0.1, 0.5, 0.9]) {
    const x = ((a0[0] + (a1[0] - a0[0]) * t) + (b0[0] + (b1[0] - b0[0]) * t)) / 2;
    const y = ((a0[1] + (a1[1] - a0[1]) * t) + (b0[1] + (b1[1] - b0[1]) * t)) / 2;
    assert.ok(containsPoint(room, x, y), `${x},${y} inside 2.705`);
  }
  const { prisms } = featureSolids(features, '2', rise);
  assert.equal(prisms.filter(p => p.feature === bridge.id).length, 2 * (2 + bridge.panels + 1));
});

test('the bridge mask hides only the full-height wall loop traced along the bridge', () => {
  const walls = architecture.floors.find(f => f.id === '2').walls;
  const hidden = walls.map((wall, i) => hiddenByFeature(features, '2', wall) ? i : -1).filter(i => i >= 0);
  assert.deepEqual(hidden, [57]);
  for (const floor of architecture.floors.filter(f => f.id !== '2')) assert.ok(!floor.walls.some(w => hiddenByFeature(features, floor.id, w)));
});

test('prisms triangulate to closed, outward-facing solids', () => {
  const ring = [[0, 0], [2, 0], [2, 1], [0, 1]];
  const tris = prismTriangles([{ ring, z0: 0, z1: 3 }]);
  assert.equal(tris.length, (2 * 2 + 4 * 2) * 9);
  let volume = 0;
  for (let i = 0; i < tris.length; i += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = tris.slice(i, i + 9);
    volume += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  assert.ok(Math.abs(volume - 6) < 1e-9);
});

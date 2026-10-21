import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { containsPoint, roomAt, validateArchitecture } from '../architecture.mjs';
import { roomGeometry, wallGeometry, exportArchitectureOBJ } from '../architecture-geometry.mjs';
import { toFrame, fromFrame, demoSurvey } from '../signal-model.mjs';

const load = (id, file) => JSON.parse(readFileSync(new URL(`../buildings/${id}/${file}`, import.meta.url)));
const fixtures = ['EER', 'ASE', 'ECJ'].map(id => ({ building: load(id, 'building.json'), model: load(id, 'architecture.json') }));
const ringArea = ring => Math.abs(ring.reduce((sum, p, i) => { const q = ring[(i + 1) % ring.length]; return sum + p[0] * q[1] - q[0] * p[1]; }, 0) / 2);
const area = p => ringArea(p.outline) - (p.holes || []).reduce((sum, h) => sum + ringArea(h), 0);
const square = { outline: [[0, 0], [12, 0], [12, 8], [0, 8]], holes: [[[2, 2], [2, 4], [4, 4], [4, 2]]] };

test('room picking excludes holes, concave exterior gaps and unmatched locations', () => {
  const room = { ...square, id: 'test', area_ft2: 92 };
  assert.equal(roomAt({ rooms: [room] }, 6, 4), room);
  assert.equal(roomAt({ rooms: [room] }, 3, 3), null);
  assert.equal(roomAt({ rooms: [room] }, 20, 4), null);
  assert.equal(containsPoint(room, NaN, 1), false);
  assert.equal(containsPoint({ outline: [[0, 0], [6, 0], [6, 2], [2, 2], [2, 6], [0, 6]] }, 4, 4), false);
});

test('all 31 model floors match source plans and share the DAQ coordinate frame', () => {
  let floors = 0;
  for (const { building, model } of fixtures) {
    assert.equal(validateArchitecture(model, building), model);
    const pdf = readFileSync(new URL(`../buildings/${building.id}/${building.plan.pdf}`, import.meta.url));
    assert.equal(model.source.sha256, createHash('sha256').update(pdf).digest('hex'));
    for (const floor of model.floors) {
      floors++;
      const config = building.floors.find(f => f.id === floor.id);
      assert.equal(floor.source_page, config.page);
      assert.ok(floor.walls.length > 0 && floor.rooms.length > 0);
      for (const room of floor.rooms) {
        const px = fromFrame(config, ...room.center), back = toFrame(config, px.x, px.y);
        assert.ok(containsPoint(room, back.x, back.y), `${building.id}/${floor.id}/${room.id}`);
        assert.ok(Math.abs(area(room) - room.area_ft2) < 1, 'reported area agrees with the polygon');
      }
    }
  }
  assert.equal(floors, 31);
});

test('validation rejects cross-building models, missing floors and non-finite coordinates', () => {
  const { building, model } = fixtures[0];
  assert.throws(() => validateArchitecture({ ...model, building: 'ASE' }, building));
  assert.throws(() => validateArchitecture({ ...model, floors: model.floors.slice(1) }, building));
  const bad = structuredClone(model); bad.floors[0].walls[0].outline[0][0] = Infinity;
  assert.throws(() => validateArchitecture(bad, building));
});

test('architectural demo measurements are synthetic and land inside modeled rooms', () => {
  for (const { building, model } of fixtures) {
    const samples = demoSurvey(building, model);
    for (const floor of model.floors) assert.ok(samples.some(s => s.floor === floor.id));
    for (const sample of samples) {
      assert.equal(sample.source, 'demo');
      const floor = building.floors.find(f => f.id === sample.floor), p = toFrame(floor, sample.x_px, sample.y_px);
      assert.ok(roomAt(model.floors.find(f => f.id === sample.floor), p.x, p.y));
    }
  }
});

function triangleArea(geometry) {
  const p = geometry.getAttribute('position'), ix = geometry.index;
  let total = 0;
  for (let i = 0; i < (ix?.count ?? p.count); i += 3) {
    const [a, b, c] = [i, i + 1, i + 2].map(j => ix ? ix.getX(j) : j);
    total += Math.abs((p.getX(b) - p.getX(a)) * (p.getY(c) - p.getY(a)) - (p.getY(b) - p.getY(a)) * (p.getX(c) - p.getX(a))) / 2;
  }
  return total;
}

test('triangulation preserves room and wall holes on every modeled floor', () => {
  for (const { building, model } of fixtures) for (const floor of model.floors) {
    for (const polygon of [...floor.rooms, ...floor.walls]) {
      const geometry = roomGeometry(polygon), expected = area(polygon);
      assert.ok(expected > 0, `${building.id}/${floor.id}: positive polygon area`);
      assert.ok(Math.abs(triangleArea(geometry) - expected) < Math.max(.2, expected * .001), `${building.id}/${floor.id}: no filled holes or lost room surfaces`);
      geometry.dispose();
    }
  }
});

test('walls have physical volume with open holes, and exported OBJ uses z-up feet', () => {
  const geometry = wallGeometry(square, 10), p = geometry.getAttribute('position');
  let volume = 0;
  for (let i = 0; i < p.count; i += 3) {
    const a = [p.getX(i), p.getY(i), p.getZ(i)], b = [p.getX(i+1), p.getY(i+1), p.getZ(i+1)], c = [p.getX(i+2), p.getY(i+2), p.getZ(i+2)];
    volume += (a[0] * (b[1]*c[2]-b[2]*c[1]) + a[1]*(b[2]*c[0]-b[0]*c[2]) + a[2]*(b[0]*c[1]-b[1]*c[0])) / 6;
  }
  assert.ok(Math.abs(Math.abs(volume) - 920) < 1e-6); geometry.dispose();
  const model = { floors: [{ id: 'B', walls: [square], rooms: [] }, { id: '2', walls: [square], rooms: [] }] };
  const building = { id: 'TEST', floors: [{ id: 'B' }, { id: '1' }, { id: '2' }] };
  const obj = exportArchitectureOBJ(model, building, { wallHeight: 9, spacing: 16, separation: 5 });
  const vertices = obj.split('\n').filter(line => line.startsWith('v ')).map(line => line.split(' ').slice(1).map(Number));
  const heights = [...new Set(vertices.map(p => p[2]))].sort((a,b) => a-b);
  assert.deepEqual(heights, [-16, -7, 16, 25], 'visual separation must not affect physical export');
  assert.ok(vertices.every(p => p[0] >= 0 && p[0] <= 12 && p[1] >= 0 && p[1] <= 8));
  for (const face of obj.split('\n').filter(line => line.startsWith('f '))) assert.ok(face.split(' ').slice(1).every(n => Number(n) >= 1 && Number(n) <= vertices.length));
});

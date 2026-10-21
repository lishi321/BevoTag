import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { containsPoint, roomAt, validateArchitecture } from '../architecture.mjs';
import { toFrame, fromFrame } from '../signal-model.mjs';

const load = (id, name) => JSON.parse(readFileSync(new URL(`../buildings/${id}/${name}`, import.meta.url)));
const pdfHash = (id, file) => createHash('sha256').update(readFileSync(new URL(`../buildings/${id}/${file}`, import.meta.url))).digest('hex');

test('ECJ level 4 geometry covers the rotated source sheet and resolves rooms across all four corners', () => {
  const building = load('ECJ', 'building.json'), model = load('ECJ', 'architecture.json');
  validateArchitecture(model, building);
  // PDF page 6 is stored at 270 degrees. These registered plan locations exposed
  // the former unrotated clipping defect (16 rooms covering only 2,318 ft²).
  assert.equal(model.source.sha256, '5ad3f1f17a2201f3e1226ebb9fbe1e615b66fb22e57607446502bb8524acd4c4');
  assert.equal(pdfHash('ECJ', building.plan.pdf), model.source.sha256);
  const floor = model.floors.find(f => f.id === '4'), config = building.floors.find(f => f.id === '4');
  assert.equal(floor.source_page, 6);
  assert.ok(floor.rooms.length >= 45, 'the complete sheet should recover at least 45 spaces, not the cropped 16');
  assert.ok(floor.walls.length >= 70, 'retain the wall geometry on both sides of the sheet');
  assert.ok(floor.rooms.reduce((sum, room) => sum + room.area_ft2, 0) > 10000, 'recover the whole floor footprint');
  const points = floor.walls.flatMap(wall => wall.outline);
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  assert.ok(Math.min(...xs) < 1 && Math.max(...xs) > 136, 'east/west perimeter agrees with registered sheet');
  assert.ok(Math.min(...ys) < 1 && Math.max(...ys) > 104, 'north/south perimeter agrees with registered sheet');
  for (const [x, y, label] of [[41, 98, '4.406'], [123, 97, '4.726'], [13, 8, '4.202A'], [124, 8, '4.712'], [68, 70, '4.304']]) {
    assert.equal(roomAt(floor, x, y)?.label, label, `${label} remains at its reviewed source-plan position`);
    const pixel = fromFrame(config, x, y), registered = toFrame(config, pixel.x, pixel.y);
    assert.equal(roomAt(floor, registered.x, registered.y)?.label, label, '2D plan and 3D room selection share the same frame');
  }
});

test('EER room selection excludes reviewed atrium and roof projections without filling them as rooms', () => {
  const building = load('EER', 'building.json'), model = load('EER', 'architecture.json'), review = load('EER', 'geometry-review.json');
  validateArchitecture(model, building);
  const digest = pdfHash('EER', building.plan.pdf);
  assert.equal(review.source_sha256, digest);
  assert.equal(model.geometry_review.source_sha256, digest);
  assert.equal(model.source.sha256, digest);
  const sampleXs = [65, 100, 133, 180, 200], sampleYs = [65, 90, 120];
  for (const id of ['3', '6', '8']) {
    const floor = model.floors.find(f => f.id === id);
    const exclusion = review.exclusions.find(e => e.floor_id === id);
    assert.ok(floor.geometry_exclusions.some(e => e.id === exclusion.id));
    for (const x of sampleXs) for (const y of sampleYs) {
      assert.ok(containsPoint(exclusion, x, y), 'regression samples are inside the reviewed region');
      assert.equal(roomAt(floor, x, y), null, `EER ${id}: (${x},${y}) is not a reconstructed occupied floor`);
      if (exclusion.remove.includes('walls')) assert.ok(!floor.walls.some(wall => containsPoint(wall, x, y)), 'roof members must not become full-height walls');
    }
  }
});

test('EER west bridge stays selectable and registered while the adjacent atrium remains empty', () => {
  const building = load('EER', 'building.json'), model = load('EER', 'architecture.json');
  const floor = model.floors.find(f => f.id === '6'), config = building.floors.find(f => f.id === '6');
  for (const [x, y] of [[34, 60], [34, 92], [34, 125]]) {
    const room = roomAt(floor, x, y);
    assert.equal(room?.id, '6-reviewed-west-bridge');
    assert.equal(room.label, 'West bridge');
    assert.equal(room.label_source, 'plan-review');
    assert.equal(room.review.source_page, 7);
    assert.ok(room.review.evidence.includes('eer-local-plan'));
    assert.ok(!floor.walls.some(wall => containsPoint(wall, x, y)), 'walkable bridge interior is not extruded as wall');
    const pixel = fromFrame(config, x, y), registered = toFrame(config, pixel.x, pixel.y);
    assert.equal(roomAt(floor, registered.x, registered.y)?.id, room.id);
  }
  assert.equal(roomAt(floor, 100, 92), null, 'bridge repair must not refill the atrium');
  assert.ok(roomAt(floor, 160, 145)?.label.includes('6.614'), 'the north tower room remains selectable');
});

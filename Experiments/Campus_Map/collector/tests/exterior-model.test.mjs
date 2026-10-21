import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { exteriorBand, roofSurfaces, selectExteriorContextWalls } from '../exterior-model.mjs';
import { exportArchitectureOBJ, wallGeometry } from '../architecture-geometry.mjs';

const square = { outline: [[0, 0], [12, 0], [12, 8], [0, 8]], holes: [] };
const shell = { ...square, holes: [[[.5, .5], [.5, 7.5], [11.5, 7.5], [11.5, .5]]] };
const source = { id: 'section', title: 'Historical elevation drawing', url: 'https://example.org/section.pdf', evidence: 'Storey elevations and roof elevation are dimensioned; wall construction is not defined.' };
function fixture() {
  const configs = [['B', -16], ['1', 0], ['2', 16], ['2M', null], ['3', 30], ['R', null]];
  const building = { id: 'TEST', vertical: { datum: { floor_id: '1' }, sources: [source] }, floors: configs.map(([id, z]) => ({
    id, ...(z === null ? {} : { elevation_ft: z, elevation_source: { source_id: source.id, status: 'documented' } }),
  })) };
  const model = { schema: 1, building: building.id, units: 'ft', envelope_review: { sources: [source] }, floors: configs.map(([id], index) => ({
    id, source_page: index + 1, walls: [structuredClone(square)], rooms: [],
    envelope: { role: id === '2M' ? 'internal' : id === 'R' ? 'reference' : 'storey',
      footprints: [structuredClone(square)], walls: [structuredClone(shell)],
      ...(id === '3' ? { top: { elevation_ft: 47, status: 'documented', source_id: source.id, note: 'Penthouse roof is a separate documented elevation.' } } : {}),
    },
  })) };
  return { model, building };
}

test('exterior bands meet the next full storey, skip internal mezzanines and ignore exploded separation', () => {
  const { model, building } = fixture();
  const bands = ['B', '1', '2', '3'].map(id => exteriorBand(model, building, id));
  assert.deepEqual(bands.map(band => [band.baseFt, band.topFt]), [[-16, 0], [0, 16], [16, 30], [30, 47]]);
  assert.ok(bands.slice(0, -1).every((band, i) => band.topFt === bands[i + 1].baseFt));
  assert.equal(bands[2].top.floorId, '3');
  assert.equal(exteriorBand(model, building, '2M'), null);
  assert.equal(exteriorBand(model, building, 'R'), null);
  assert.deepEqual(exteriorBand(model, building, '2', { separation: 5 }), bands[2]);
  for (const band of bands) {
    assert.equal(band.geometryStatus, 'inferred');
    assert.equal(band.status, 'documented', 'only span bounds are documented');
    assert.match(band.note, /not surveyed facade geometry/);
  }
});

test('unknown spacing moves only schematic bounds and does not move a cited roof top', () => {
  const { model, building } = fixture();
  delete building.floors[0].elevation_ft;
  for (const spacing of [6, 14, 40]) {
    const bottom = exteriorBand(model, building, 'B', { spacing });
    assert.equal(bottom.baseFt, -spacing); assert.equal(bottom.topFt, 0); assert.equal(bottom.status, 'assumed');
    assert.deepEqual(['1', '2', '3'].map(id => {
      const band = exteriorBand(model, building, id, { spacing }); return [band.baseFt, band.topFt];
    }), [[0, 16], [16, 30], [30, 47]]);
  }
  delete model.floors.find(f => f.id === '3').envelope.top;
  const final = exteriorBand(model, building, '3', { wallHeight: 9 });
  assert.equal(final.topFt, 39); assert.equal(final.top.kind, 'display-height'); assert.equal(final.status, 'assumed');
});

test('explicit envelope tops need a complete unambiguous citation and positive finite height', () => {
  const { model, building } = fixture(), top = model.floors.find(f => f.id === '3').envelope.top;
  assert.equal(exteriorBand(model, building, '3').top.source, source);
  model.envelope_review.sources.push(source);
  assert.equal(exteriorBand(model, building, '3').top.status, 'unverified');
  model.envelope_review.sources = [{ ...source, evidence: '' }];
  assert.equal(exteriorBand(model, building, '3').top.status, 'unverified');
  for (const value of [NaN, Infinity, '47', 30, 20]) {
    top.elevation_ft = value;
    assert.throws(() => exteriorBand(model, building, '3'));
  }
  for (const value of [NaN, Infinity, 0, -1, '14']) assert.throws(() => exteriorBand(model, building, '1', { spacing: value }));
});

test('context selection retains original walls and excludes internal/reference walls only in exterior mode', () => {
  const { model } = fixture(), floor = model.floors[1];
  floor.envelope.context_walls = [shell];
  assert.equal(selectExteriorContextWalls(floor), floor.envelope.context_walls);
  assert.equal(selectExteriorContextWalls(floor, false), floor.walls);
  for (const reference of [model.floors[3], model.floors[5]]) {
    assert.deepEqual(selectExteriorContextWalls(reference), []);
    assert.equal(selectExteriorContextWalls(reference, false), reference.walls);
  }
  const invalid = structuredClone(floor); invalid.envelope.context_walls[0].outline[0][0] = NaN;
  assert.throws(() => selectExteriorContextWalls(invalid));
});

function objects(obj) {
  const result = new Map(); let current;
  for (const line of obj.split('\n')) {
    if (line.startsWith('o ')) { current = []; result.set(line.slice(2), current); }
    if (line.startsWith('v ')) current.push(line.slice(2).split(' ').map(Number));
  }
  return result;
}
test('OBJ exports separate inferred enclosure bands at unexpanded foot elevations with source evidence', () => {
  const { model, building } = fixture();
  const text = exportArchitectureOBJ(model, building, { wallHeight: 9, separation: 4 });
  assert.equal(text, exportArchitectureOBJ(model, building, { wallHeight: 9, separation: 1 }));
  const modelObjects = objects(text);
  for (const id of ['B', '1', '2', '3']) {
    const band = exteriorBand(model, building, id);
    assert.deepEqual([...new Set(modelObjects.get(`TEST_${id}_inferred_envelope_1`).map(point => point[2]))].sort((a, b) => a - b), [band.baseFt, band.topFt]);
    assert.deepEqual([...new Set(modelObjects.get(`TEST_${id}_wall_1`).map(point => point[2]))].sort((a, b) => a - b), [band.baseFt, band.baseFt + 9]);
  }
  assert.ok(![...modelObjects.keys()].some(key => /TEST_(2M|R)_/.test(key)));
  assert.match(text, /span status=documented; geometry=inferred/);
  assert.ok(text.includes(source.url));
  const original = objects(exportArchitectureOBJ(model, building, { exterior: false }));
  assert.ok(original.has('TEST_2M_wall_1') && original.has('TEST_R_wall_1'));
  assert.ok(![...original.keys()].some(key => key.includes('envelope')));
});

test('real EER and ECJ bands join consecutively while the ECJ penthouse ends at the separately cited 159 ft roof', () => {
  for (const id of ['EER', 'ECJ']) {
    const load = file => JSON.parse(readFileSync(new URL(`../buildings/${id}/${file}`, import.meta.url)));
    const model = load('architecture.json'), building = load('building.json');
    const before = JSON.stringify({ model, building });
    for (const spacing of [6, 14, 40]) {
      const bands = building.floors.map(floor => exteriorBand(model, building, floor.id, { spacing })).filter(Boolean);
      assert.equal(bands.length, id === 'EER' ? 9 : 13);
      assert.ok(bands.slice(0, -1).every((band, i) => band.topFt === bands[i + 1].baseFt), `${id}: no missing vertical enclosure band`);
      assert.ok(bands.every(band => band.geometryStatus === 'inferred'));
      const roofs = building.floors.flatMap(floor => roofSurfaces(model, building, floor.id, { spacing }));
      assert.equal(roofs.length, id === 'EER' ? 22 : 5);
      assert.ok(roofs.every(roof => roof.heightFt === .5 && roof.baseFt + roof.heightFt === roof.elevationFt));
      if (id === 'ECJ') {
        const penthouse = bands.at(-1);
        assert.equal(penthouse.floorId, '11');
        assert.equal(penthouse.baseFt, 142);
        assert.equal(penthouse.topFt, 159);
        assert.equal(penthouse.heightFt, 17);
        assert.equal(penthouse.top.status, 'documented');
        assert.match(penthouse.top.source.evidence, /711/);
        assert.equal(exteriorBand(model, building, '11M', { spacing }), null);
        assert.equal(exteriorBand(model, building, 'R', { spacing }), null);
        assert.deepEqual(bands.slice(1, 4).map(band => [band.baseFt, band.topFt]), [[-16, 0], [0, 16], [16, 30]]);
        assert.equal(roofs.find(roof => roof.id === 'ecj-lower-roof').elevationFt, 142);
        assert.equal(roofs.find(roof => roof.id === 'ecj-penthouse-roof').elevationFt, 159);
        assert.deepEqual(roofSurfaces(model, building, 'R', { spacing }), []);
      }
    }
    assert.equal(JSON.stringify({ model, building }), before, 'display spans never modify source footprints, rooms or evidence');
  }
});

function withRoofs() {
  const result = fixture();
  result.model.envelope_review.roof_thickness_ft = .5;
  result.model.floors.find(f => f.id === '3').envelope.roofs = [
    { ...structuredClone(shell), id: 'upper-roof', label: 'Upper roof', kind: 'roof', anchor: 'top', status: 'inferred', review: { note: 'Reviewed upper footprint with an opening.', evidence: ['section'] } },
    { ...structuredClone(square), id: 'terrace', label: 'Terrace', kind: 'terrace', anchor: 'base', status: 'inferred', review: { note: 'Reviewed setback surface.', evidence: ['section'] } },
  ];
  return result;
}

test('roof surfaces extend an assumed thickness below the anchored elevation without changing cited tops', () => {
  const { model, building } = withRoofs();
  const before = JSON.stringify({ model, building });
  for (const spacing of [6, 14, 40]) {
    const roofs = roofSurfaces(model, building, '3', { spacing, separation: 5 });
    assert.deepEqual(roofs.map(roof => [roof.elevationFt, roof.baseFt, roof.heightFt]), [[47, 46.5, .5], [30, 29.5, .5]]);
    assert.ok(roofs.every(roof => roof.elevationStatus === 'documented' && roof.geometryStatus === 'inferred' && roof.thicknessStatus === 'assumed'));
    assert.equal(roofs[0].elevation.source.id, source.id);
    assert.deepEqual(roofs, roofSurfaces(model, building, '3', { spacing, separation: 1 }));
  }
  delete model.envelope_review.roof_thickness_ft;
  assert.equal(roofSurfaces(model, building, '3')[0].heightFt, .5, 'missing thickness uses an explicit display assumption');
  model.envelope_review.roof_thickness_ft = .5;
  assert.equal(JSON.stringify({ model, building }), before, 'roof geometry/evidence is never changed in place');
  model.floors.find(f => f.id === 'R').envelope.roofs = model.floors.find(f => f.id === '3').envelope.roofs;
  assert.deepEqual(roofSurfaces(model, building, 'R'), [], 'a composite roof reference cannot acquire one invented roof elevation');
});

test('roof surface validation rejects ambiguous identities, unsupported anchors and invalid thickness or profiles', () => {
  const { model, building } = withRoofs(), roofs = model.floors.find(f => f.id === '3').envelope.roofs;
  const original = structuredClone(roofs[0]);
  for (const patch of [{ id: '' }, { id: 'terrace' }, { label: '' }, { kind: 'ceiling' }, { anchor: 'middle' }, { status: 'documented' }, { outline: [[0, 0], [1, 0], [2, 0]], holes: [] }, { outline: [[0, NaN], [1, 0], [2, 1]], holes: [] }]) {
    roofs[0] = { ...structuredClone(original), ...patch };
    assert.throws(() => roofSurfaces(model, building, '3'));
  }
  roofs[0] = original;
  for (const value of [0, -1, NaN, Infinity, '0.5']) {
    model.envelope_review.roof_thickness_ft = value;
    assert.throws(() => roofSurfaces(model, building, '3'));
  }
});

test('removable OBJ roofs preserve openings and are independent of exterior visibility', () => {
  const { model, building } = withRoofs();
  const enabled = objects(exportArchitectureOBJ(model, building));
  const roofName = 'TEST_3_inferred_roof_upper-roof';
  assert.deepEqual([...new Set(enabled.get(roofName).map(point => point[2]))].sort((a, b) => a - b), [46.5, 47]);
  assert.ok(!objects(exportArchitectureOBJ(model, building, { roofs: false })).has(roofName));
  assert.ok(!objects(exportArchitectureOBJ(model, building, { exterior: false })).has(roofName));
  const independent = objects(exportArchitectureOBJ(model, building, { exterior: false, roofs: true }));
  assert.ok(independent.has(roofName));
  assert.ok(![...independent.keys()].some(key => key.includes('_envelope_')));
  assert.equal(exportArchitectureOBJ(model, building, { separation: 4 }), exportArchitectureOBJ(model, building, { separation: 1 }));
  const roof = roofSurfaces(model, building, '3')[0], geometry = wallGeometry(roof, roof.heightFt), p = geometry.getAttribute('position');
  let volume = 0;
  for (let i = 0; i < p.count; i += 3) {
    const a = [p.getX(i), p.getY(i), p.getZ(i)], b = [p.getX(i + 1), p.getY(i + 1), p.getZ(i + 1)], c = [p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2)];
    volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  geometry.dispose();
  assert.ok(Math.abs(Math.abs(volume) - 9.5) < 1e-8, 'roof opening survives triangulation: (96 − 77) sq ft × 0.5 ft');
});

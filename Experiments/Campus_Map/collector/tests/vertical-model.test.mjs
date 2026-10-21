import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { elevationInfo, verticalSummary } from '../vertical-model.mjs';
import { floorElevation } from '../signal-model.mjs';

const loadBuilding = id => JSON.parse(readFileSync(new URL(`../buildings/${id}/building.json`, import.meta.url)));

const source = {
  id: 'section-a', title: 'Example dimensioned building section',
  url: 'https://example.org/section-a.pdf', evidence: 'Level 1 = 0 ft; level 2 = 16 ft.',
};
const building = () => ({
  id: 'test',
  vertical: { datum: { floor_id: '1', description: 'Project datum at level 1' }, sources: [source] },
  floors: [{ id: 'B' }, { id: '1' }, { id: 'M' }, { id: '2' }],
});

test('documented zero and negative elevations retain values and citations', () => {
  const b = building();
  Object.assign(b.floors[1], { elevation_ft: 0, elevation_source: { source_id: source.id, status: 'documented', note: 'Drawing datum.' } });
  Object.assign(b.floors[0], { elevation_ft: '-12.5', elevation_source: { source_id: source.id, status: 'documented' } });
  assert.deepEqual(elevationInfo(b, '1'), { elevationFt: 0, status: 'documented', source, note: 'Drawing datum.' });
  assert.equal(elevationInfo(b, 'B').elevationFt, -12.5);
  assert.equal(elevationInfo(b, 'B').status, 'documented');
});

test('fallback basement and mezzanine spacing remains explicitly assumed', () => {
  const b = building();
  assert.equal(elevationInfo(b, 'B', 12).elevationFt, -12);
  assert.equal(elevationInfo(b, '1', 12).elevationFt, 0);
  assert.equal(elevationInfo(b, 'M', 12).elevationFt, 12);
  assert.equal(elevationInfo(b, '2', 12).elevationFt, 24);
  for (const floor of b.floors) {
    const info = elevationInfo(b, floor.id, 12);
    assert.equal(info.status, 'assumed');
    assert.equal(info.source, null);
    assert.match(info.note, /actual elevation is unknown/);
  }
  const noGround = { floors: [{ id: 'G' }, { id: 'M' }] };
  assert.equal(elevationInfo(noGround, 'G').elevationFt, 0);
  assert.equal(elevationInfo(noGround, 'M').elevationFt, 14);
});

test('declared datum floor controls fallback spacing and must resolve', () => {
  const b = building();
  b.vertical.datum = { floor_id: 'B', description: 'Basement project datum' };
  assert.equal(elevationInfo(b, 'B', 12).elevationFt, 0);
  assert.equal(elevationInfo(b, '1', 12).elevationFt, 12);
  assert.equal(elevationInfo(b, 'M', 12).elevationFt, 24);
  assert.match(elevationInfo(b, 'M', 12).note, /from floor B/);
  assert.equal(verticalSummary(b, 12).datum.floor_id, 'B');
  b.vertical.datum.floor_id = 'missing';
  assert.throws(() => elevationInfo(b, '1'), /Unknown datum floor/);
  assert.throws(() => verticalSummary(b), /Unknown datum floor/);
  b.floors[1].elevation_ft = 0;
  assert.throws(() => elevationInfo(b, '1'), /Unknown datum floor/, 'explicit values cannot conceal an invalid datum');
});

test('explicit values without complete citations never become documented', () => {
  const b = building();
  b.floors[3].elevation_ft = 16;
  assert.equal(elevationInfo(b, '2').status, 'unverified');
  b.floors[3].elevation_source = { source_id: 'missing', status: 'documented' };
  assert.equal(elevationInfo(b, '2').status, 'unverified');
  b.floors[3].elevation_source.source_id = source.id;
  for (const missing of ['title', 'url', 'evidence']) {
    b.vertical.sources = [{ ...source, [missing]: '' }];
    assert.equal(elevationInfo(b, '2').status, 'unverified', `missing ${missing}`);
  }
  b.vertical.sources = [source, { ...source }];
  assert.equal(elevationInfo(b, '2').status, 'unverified', 'ambiguous source IDs');
  b.vertical.sources = [source];
  delete b.floors[3].elevation_source.status;
  assert.equal(elevationInfo(b, '2').status, 'unverified', 'citation does not itself assert measured heights');
});

test('source-based estimates stay estimated and legacy evidence fields are supported', () => {
  const b = building();
  Object.assign(b.floors[3], { elevation_ft: 16, elevation_source: { source_id: source.id, status: 'estimated' } });
  assert.equal(elevationInfo(b, '2').status, 'estimated');
  assert.equal(elevationInfo(b, '2').source, source);
  b.floors[3].elevation_source = { id: source.id, verification: 'documented' };
  assert.equal(elevationInfo(b, '2').status, 'documented');
  b.floors[3].elevation_source.status = 'estimated';
  assert.equal(elevationInfo(b, '2').status, 'estimated', 'canonical status wins');
});

test('invalid values cannot silently supply zero or trusted elevations', () => {
  const b = building();
  b.floors[3].elevation_source = { source_id: source.id, status: 'documented' };
  for (const invalid of [null, undefined, '', '  ', false, true, [], {}, 'unknown', NaN, Infinity, -Infinity]) {
    b.floors[3].elevation_ft = invalid;
    const info = elevationInfo(b, '2', 12);
    assert.equal(info.status, 'assumed');
    assert.equal(info.elevationFt, 24);
    assert.equal(info.source, null);
  }
  for (const invalid of [null, '', '  ', false, true, [], {}, 0, -1, NaN, Infinity, 'invalid']) {
    assert.throws(() => elevationInfo(b, '1', invalid), /spacing/);
    assert.throws(() => verticalSummary(b, invalid), /spacing/);
  }
  assert.throws(() => elevationInfo(b, 'missing'), /Unknown floor/);
  assert.throws(() => elevationInfo({}, '1'), /at least one floor/);
  assert.throws(() => verticalSummary({ floors: [] }), /at least one floor/);
  assert.equal(elevationInfo(b, '1', '12').elevationFt, 0, 'numeric strings remain valid');
});

test('summary reports mixed provenance and preserves the source datum without mutation', () => {
  const b = building();
  Object.assign(b.floors[0], { elevation_ft: -12, elevation_source: { source_id: source.id, status: 'estimated' } });
  Object.assign(b.floors[1], { elevation_ft: 0, elevation_source: { source_id: source.id, status: 'documented' } });
  b.floors[3].elevation_ft = 16;
  const before = JSON.stringify(b), summary = verticalSummary(b);
  assert.deepEqual(summary.counts, { documented: 1, estimated: 1, unverified: 1, assumed: 1 });
  assert.deepEqual(summary.rows.map(row => row.floorId), ['B', '1', 'M', '2']);
  assert.equal(summary.datum, b.vertical.datum);
  assert.equal(JSON.stringify(b), before);
  const fallback = verticalSummary({ floors: [{ id: 'B' }, { id: '1' }] });
  assert.equal(fallback.datum.floor_id, '1');
  assert.match(fallback.datum.description, /assumed display reference/);
});

test('EER and ASE remain unknown despite background research citations', () => {
  let total = 0;
  for (const id of ['EER', 'ASE']) {
    const b = loadBuilding(id), summary = verticalSummary(b);
    assert.equal(b.vertical.research_status, 'no-documented-elevations', id);
    assert.ok(b.vertical.sources.length > 0, `${id}: research evidence is retained`);
    assert.deepEqual(summary.counts, { documented: 0, estimated: 0, unverified: 0, assumed: b.floors.length });
    assert.equal(summary.datum.floor_id, '1');
    for (const row of summary.rows) {
      assert.equal(row.status, 'assumed', `${id}/${row.floorId}`);
      assert.equal(row.source, null, 'background sources do not verify per-floor elevations');
      assert.equal(floorElevation(b, row.floorId), row.elevationFt, 'renderer/DAQ adapter preserves the same placement');
      total++;
    }
  }
  assert.equal(total, 16);
});

test('ECJ overall 175 ft context never establishes roof or mezzanine elevations', () => {
  const b = loadBuilding('ECJ'), context = b.vertical.overall_height_context;
  assert.equal(context.height_ft, 175);
  assert.ok(b.vertical.sources.some(source => source.id === context.source_id));
  const before = verticalSummary(b);
  const roof = elevationInfo(b, 'R'), mezzanine = elevationInfo(b, '11M');
  assert.equal(roof.status, 'assumed');
  assert.equal(mezzanine.status, 'assumed');
  assert.notEqual(roof.elevationFt, 175, 'overall height has no documented level-1 datum');
  assert.notEqual(elevationInfo(b, 'R', 10).elevationFt, roof.elevationFt, 'unknown roof uses only schematic spacing');
  context.height_ft = 999;
  assert.deepEqual(verticalSummary(b), before, 'overall context must not feed per-level placements');
});

test('documented elevation remains fixed when display spacing changes through the DAQ adapter', () => {
  const b = building();
  Object.assign(b.floors[3], {
    elevation_ft: 16,
    elevation_source: { source_id: source.id, status: 'documented' },
  });
  for (const spacing of [8, 14, 25]) {
    assert.equal(elevationInfo(b, '2', spacing).elevationFt, 16);
    assert.equal(elevationInfo(b, '2', spacing).status, 'documented');
    assert.equal(floorElevation(b, '2', spacing), 16);
    assert.equal(floorElevation(b, 'M', spacing), 8, 'unknown level stays between the datum and a fixed elevation');
    assert.match(elevationInfo(b, 'M', spacing).note, /Schematic interpolation/);
  }
});


test('ECJ historical record elevations reconcile to Level 1 without concealing the Level 6 conflict', () => {
  const b = loadBuilding('ECJ'), summary = verticalSummary(b);
  assert.deepEqual(summary.counts, { documented: 11, estimated: 1, unverified: 0, assumed: 3 });
  const documented = { B: -16, 1: 0, 2: 16, 3: 30, 4: 44, 5: 58, 7: 86, 8: 100, 9: 114, 10: 128, 11: 142 };
  for (const [id, value] of Object.entries(documented)) {
    const info = elevationInfo(b, id, 6);
    assert.equal(info.elevationFt, value);
    assert.equal(info.status, 'documented');
    assert.equal(info.source.id, 'ecj-sarlo-record-elevations');
    assert.equal(elevationInfo(b, id, 40).elevationFt, value, 'display step cannot change record elevations');
  }
  const six = elevationInfo(b, '6');
  assert.equal(six.elevationFt, 72);
  assert.equal(six.status, 'estimated');
  assert.match(six.note, /536/);
  // Independent sensor table C.1 uses Level 2 as its zero, not our Level 1 datum.
  for (const [id, relative] of Object.entries({ B: -32, 5: 42, 7: 70, 9: 98, 11: 126 })) {
    assert.equal(floorElevation(b, id) - floorElevation(b, '2'), relative);
  }
});

test('unknown ECJ levels stay ordered around fixed levels at every allowed display step', () => {
  const b = loadBuilding('ECJ');
  for (const spacing of [6, 10, 14, 25, 40]) {
    const summary = verticalSummary(b, spacing);
    assert.ok(summary.rows.every((row, i) => !i || row.elevationFt > summary.rows[i - 1].elevationFt));
    for (const id of ['SB', '11M', 'R']) assert.equal(elevationInfo(b, id, spacing).status, 'assumed');
    assert.equal(floorElevation(b, 'SB', spacing), -16 - spacing);
    assert.equal(floorElevation(b, '11M', spacing), 142 + spacing);
    assert.equal(floorElevation(b, 'R', spacing), 142 + 2 * spacing);
  }
});

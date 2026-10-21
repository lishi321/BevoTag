import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { exportArchitectureIFC } from '../architecture-ifc.mjs';
import { elevationInfo } from '../vertical-model.mjs';
import { exteriorBand, selectExteriorContextWalls } from '../exterior-model.mjs';

// Small STEP argument reader used to inspect relationships and actual measures,
// including nested aggregates and quoted commas/apostrophes in evidence.
function args(value) {
  const result = []; let depth = 0, quoted = false, start = 0;
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (char === "'") {
      if (quoted && value[i + 1] === "'") { i++; continue; }
      quoted = !quoted;
    } else if (!quoted) {
      if (char === '(') depth++;
      if (char === ')') depth--;
      if (char === ',' && depth === 0) { result.push(value.slice(start, i)); start = i + 1; }
    }
  }
  result.push(value.slice(start)); return result;
}
function parse(text) {
  const entities = new Map();
  for (const line of text.split('\n')) {
    const match = line.match(/^(#\d+)=(\w+)\((.*)\);$/);
    if (match) entities.set(match[1], { id: match[1], type: match[2], args: args(match[3]) });
  }
  return { entities, of: type => [...entities.values()].filter(e => e.type === type), get: ref => entities.get(ref) };
}
const refs = aggregate => args(aggregate.slice(1, -1));
const square = { outline: [[0, 0], [12, 0], [12, 8], [0, 8]], holes: [[[2, 2], [2, 4], [4, 4], [4, 2]]] };
function fixture() {
  const source = { id: 'section', title: 'Example signed section', url: 'https://example.org/section.pdf', evidence: 'Level 2 = 17.25 ft. Basement inferred as -11 ft.' };
  const building = {
    id: 'TEST', name: 'Test building', plan: { pdf: 'plan.pdf' },
    vertical: { datum: { floor_id: '1', description: 'Level 1 model datum; not surveyed altitude' }, sources: [source], note: 'Incomplete vertical evidence.' },
    geometry_review: { note: 'Unresolved recent renovations.', sources: [{ id: 'renovation', title: 'Renovation registry', url: 'https://example.org/renovation', evidence: 'Replacement partitions unavailable.' }] },
    floors: [{ id: 'B' }, { id: '1' }, { id: '2' }],
  };
  const model = {
    schema: 1, building: 'TEST', units: 'ft', coordinate_frame: 'building XY, Z up',
    source: { file: 'plan.pdf', sha256: 'a'.repeat(64), status: 'Plan-derived; needs review', method: 'Vector reconstruction' },
    geometry_review: { source_sha256: 'a'.repeat(64), sources: [{ id: 'plan', title: 'Reviewed plan', file: 'plan.pdf', evidence: 'Roof graphics on page 7.' }], applied: [{ id: 'atrium', reason: 'Exclude non-room roof graphics' }] },
    floors: building.floors.map((f, index) => ({
      id: f.id, source_page: index + 1, evidence: { geometry: 'PDF plan only' },
      geometry_exclusions: [{ id: 'atrium', reason: 'Reviewed atrium exclusion' }],
      geometry_additions: [{ id: 'bridge', reason: 'Reviewed bridge addition' }],
      walls: [structuredClone(square)],
      rooms: [{ ...structuredClone(square), id: `${f.id}-space`, label: `${f.id}.101`, label_source: 'plan-ocr', area_ft2: 92, center: [6, 4], review: { reason: 'Room polygon traced from plan', evidence: ['plan'] } }],
    })),
  };
  return { model, building };
}
function coordinates(parsed, pointRef) { return refs(parsed.get(pointRef).args[0]).map(Number); }
function worldZ(parsed, localPlacement) {
  const location = parsed.get(localPlacement);
  const axes = parsed.get(location.args[1]);
  return coordinates(parsed, axes.args[0])[2] + (location.args[0] === '$' ? 0 : worldZ(parsed, location.args[0]));
}
function productShape(parsed, product) {
  return refs(parsed.get(product.args[6]).args[2]).map(ref => parsed.get(ref));
}

test('IFC exports metric analytic walls and unexpanded storey placements with unknown elevation unset', () => {
  const { model, building } = fixture();
  const text = exportArchitectureIFC(model, building, { wallHeight: 9, spacing: 16, separation: 8 });
  const parsed = parse(text);
  assert.match(text, /^ISO-10303-21;/);
  assert.match(text, /FILE_SCHEMA\(\('IFC4'\)\)/);
  assert.deepEqual(parsed.of('IFCSIUNIT').map(e => e.args[3]), ['.METRE.', '.SQUARE_METRE.']);
  assert.deepEqual(parsed.of('IFCBUILDINGSTOREY').map(e => worldZ(parsed, e.args[5])), [-4.8768, 0, 4.8768]);
  assert.ok(parsed.of('IFCBUILDINGSTOREY').every(e => e.args[9] === '$'), 'schematic coordinates must not populate semantic elevations');
  assert.deepEqual(parsed.of('IFCWALL').map(e => worldZ(parsed, e.args[5])), [-4.8768, 0, 4.8768]);
  assert.ok(parsed.of('IFCEXTRUDEDAREASOLID').every(e => Number(e.args[3]) === 2.7432));
  const profile = parsed.of('IFCARBITRARYPROFILEDEFWITHVOIDS')[0];
  const outer = parsed.get(profile.args[2]), points = refs(outer.args[0]);
  assert.equal(points[0], points.at(-1), 'profile explicitly closes to its first point');
  assert.deepEqual(coordinates(parsed, points[2]), [3.6576, 2.4384]);
  assert.deepEqual(text.split('DATA;\n')[1], exportArchitectureIFC(model, building, { wallHeight: 9, spacing: 16, separation: 1 }).split('DATA;\n')[1]);
});

test('IFC preserves holes and uses footprint-only spaces with a navigable spatial hierarchy', () => {
  const { model, building } = fixture(), parsed = parse(exportArchitectureIFC(model, building));
  assert.equal(parsed.of('IFCARBITRARYPROFILEDEFWITHVOIDS').length, 3);
  for (const profile of parsed.of('IFCARBITRARYPROFILEDEFWITHVOIDS')) {
    const inner = parsed.get(refs(profile.args[3])[0]);
    const ring = refs(inner.args[0]).map(ref => coordinates(parsed, ref));
    const signedArea = ring.slice(0, -1).reduce((s, p, i) => s + p[0] * ring[i + 1][1] - ring[i + 1][0] * p[1], 0) / 2;
    assert.ok(Math.abs(signedArea + 4 * 0.3048 ** 2) < 1e-10, 'hole area and clockwise orientation survive export');
  }
  assert.equal(parsed.of('IFCEXTRUDEDAREASOLID').length, parsed.of('IFCWALL').length, 'spaces must not gain invented solids');
  for (const space of parsed.of('IFCSPACE')) {
    assert.equal(space.args[10], '$', 'unknown finished-floor height remains unset');
    const [shape] = productShape(parsed, space);
    assert.equal(shape.args[1], "'FootPrint'");
    assert.equal(shape.args[2], "'GeometricCurveSet'");
    const curves = parsed.get(refs(shape.args[3])[0]);
    assert.equal(refs(curves.args[0]).length, 2, 'space footprint retains outer and inner boundaries');
  }
  const project = parsed.of('IFCPROJECT')[0], buildingProduct = parsed.of('IFCBUILDING')[0];
  const aggregates = parsed.of('IFCRELAGGREGATES');
  assert.ok(aggregates.some(e => e.args[4] === project.id && refs(e.args[5]).includes(buildingProduct.id)));
  assert.ok(aggregates.some(e => e.args[4] === buildingProduct.id && refs(e.args[5]).length === 3));
  for (const storey of parsed.of('IFCBUILDINGSTOREY')) {
    assert.ok(aggregates.some(e => e.args[4] === storey.id && parsed.get(refs(e.args[5])[0]).type === 'IFCSPACE'));
    assert.ok(parsed.of('IFCRELCONTAINEDINSPATIALSTRUCTURE').some(e => e.args[5] === storey.id && parsed.get(refs(e.args[4])[0]).type === 'IFCWALL'));
  }
});

test('IFC distinguishes documented, estimated and unknown elevations while retaining evidence', () => {
  const { model, building } = fixture();
  Object.assign(building.floors[0], { elevation_ft: -11, elevation_source: { source_id: 'section', status: 'estimated' } });
  Object.assign(building.floors[2], { elevation_ft: 17.25, elevation_source: { source_id: 'section', status: 'documented' } });
  const text = exportArchitectureIFC(model, building, { spacing: 30 });
  const parsed = parse(text), storeys = parsed.of('IFCBUILDINGSTOREY');
  assert.deepEqual(storeys.map(e => e.args[9]), ['$', '$', '5.2578']);
  assert.deepEqual(storeys.map(e => worldZ(parsed, e.args[5])), [-3.3528, 0, 5.2578]);
  for (const fragment of ['assumed', 'estimated', 'documented', 'section.pdf', 'Level 1 model datum', 'not surveyed altitude', 'Exclude non-room roof graphics', 'PDF plan only', 'a'.repeat(64), 'Wall heights are display assumptions', 'Unresolved recent renovations.', 'Reviewed atrium exclusion', 'Reviewed bridge addition', 'Room polygon traced from plan']) assert.ok(text.includes(fragment), fragment);
  assert.equal(parsed.of('IFCDOCUMENTREFERENCE')[0].args[0], "'https://example.org/section.pdf'");
  assert.deepEqual(parsed.of('IFCDOCUMENTREFERENCE').map(e => e.args[0]), ["'https://example.org/section.pdf'", "'https://example.org/renovation'", "'plan.pdf'"]);
  assert.equal(parsed.of('IFCBUILDING')[0].args[9], '$', 'no absolute building elevation is invented');
});

test('IFC object GUIDs are valid, unique, deterministic and independent of display height', () => {
  const { model, building } = fixture();
  const ids = text => [...text.matchAll(/=IFC\w+\('([0-3][0-9A-Za-z_$]{21})',\$/g)].map(match => match[1]);
  const first = ids(exportArchitectureIFC(model, building));
  const second = ids(exportArchitectureIFC(model, building, { wallHeight: 14, spacing: 18 }));
  assert.ok(first.length > 20);
  assert.equal(new Set(first).size, first.length);
  assert.deepEqual(first, second);
  const other = structuredClone(building); other.id = 'OTHER';
  const otherModel = structuredClone(model); otherModel.building = 'OTHER';
  assert.ok(ids(exportArchitectureIFC(otherModel, other)).every(id => !first.includes(id)), 'building identity namespaces all roots');
});

test('IFC safely serializes apostrophes, Unicode, backslashes and line breaks in source text', () => {
  const { model, building } = fixture();
  building.vertical.sources[0].title = "Architect's café 🧭 \\ section\n);ENDSEC;";
  const text = exportArchitectureIFC(model, building);
  assert.ok(text.includes("Architect''s caf\\X2\\00E9\\X0\\"));
  assert.ok(text.includes('\\X4\\0001F9ED\\X0\\'));
  assert.ok(text.includes('\\X2\\005C\\X0\\'));
  assert.ok(text.includes('\\X2\\000A\\X0\\'));
  assert.match(text, /^[\x00-\x7F]+$/);
  assert.equal(text.split('\n').filter(line => line === 'ENDSEC;').length, 2);
  assert.equal(parse(text).of('IFCDOCUMENTREFERENCE').length, 3);
});

test('IFC rejects invalid geometry, duplicate floors and invalid measures', () => {
  const { model, building } = fixture();
  for (const value of [0, -1, NaN, Infinity, '10']) {
    assert.throws(() => exportArchitectureIFC(model, building, { wallHeight: value }));
    assert.throws(() => exportArchitectureIFC(model, building, { spacing: value }));
  }
  const invalid = structuredClone(model); invalid.floors[0].walls[0].outline[0][0] = NaN;
  assert.throws(() => exportArchitectureIFC(invalid, building));
  assert.throws(() => exportArchitectureIFC({ ...model, floors: model.floors.slice(1) }, building));
  assert.throws(() => exportArchitectureIFC(model, { ...building, floors: [...building.floors, building.floors[0]] }));
  const flat = structuredClone(model); flat.floors[0].walls[0] = { outline: [[0, 0], [1, 0], [2, 0]], holes: [] };
  assert.throws(() => exportArchitectureIFC(flat, building));
});

test('all real building exports retain each level, selected context wall and space reference', () => {
  for (const id of ['EER', 'ECJ', 'ASE']) {
    const load = file => JSON.parse(readFileSync(new URL(`../buildings/${id}/${file}`, import.meta.url)));
    const model = load('architecture.json'), building = load('building.json');
    const before = JSON.stringify({ model, building });
    const parsed = parse(exportArchitectureIFC(model, building));
    assert.equal(JSON.stringify({ model, building }), before, 'export does not mutate source geometry or evidence');
    assert.equal(parsed.of('IFCBUILDINGSTOREY').length, building.floors.length);
    assert.equal(parsed.of('IFCWALL').length, model.floors.reduce((n, floor) => n + selectExteriorContextWalls(floor).length, 0));
    assert.equal(parsed.of('IFCSPACE').length, model.floors.reduce((n, floor) => n + floor.rooms.length, 0));
    const roofProxies = parsed.of('IFCBUILDINGELEMENTPROXY').filter(product => /surface'/.test(product.args[4]));
    assert.equal(roofProxies.length, { EER: 22, ECJ: 5, ASE: 0 }[id], 'all authored removable roof objects reach the default IFC export');
    for (const [index, storey] of parsed.of('IFCBUILDINGSTOREY').entries()) {
      const info = elevationInfo(building, model.floors[index].id);
      if (info.status === 'documented') assert.ok(Math.abs(Number(storey.args[9]) - info.elevationFt * 0.3048) < 1e-8);
      else assert.equal(storey.args[9], '$', 'uncited elevations and estimates remain unset');
    }
  }
});

test('IFC inferred envelope proxies use metric unexpanded spans and preserve partition heights', () => {
  const { model, building } = fixture();
  const source = building.vertical.sources[0];
  model.envelope_review = { sources: [source], source_sha256: model.source.sha256, sha256: 'c'.repeat(64) };
  for (const floor of model.floors) floor.envelope = {
    role: 'storey', source_page: floor.source_page, footprints: [square], walls: [square],
    review: { note: 'Inferred enclosure follows reviewed footprint.' },
    ...(floor.id === '2' ? { top: { elevation_ft: 43, status: 'documented', source_id: source.id, note: 'Separate roof elevation.' } } : {}),
  };
  const text = exportArchitectureIFC(model, building, { wallHeight: 9, spacing: 16, separation: 7 });
  const parsed = parse(text), proxies = parsed.of('IFCBUILDINGELEMENTPROXY');
  assert.equal(proxies.length, 3);
  assert.deepEqual(proxies.map(product => worldZ(parsed, product.args[5])), [-4.8768, 0, 4.8768]);
  const depth = product => Number(parsed.get(refs(productShape(parsed, product)[0].args[3])[0]).args[3]);
  assert.deepEqual(proxies.map(depth), [4.8768, 4.8768, 8.2296]);
  assert.ok(parsed.of('IFCWALL').every(product => depth(product) === 2.7432), 'interior wall height remains independent of enclosure span');
  for (const [index, product] of proxies.entries()) {
    const band = exteriorBand(model, building, model.floors[index].id, { spacing: 16, wallHeight: 9 });
    assert.ok(Math.abs(worldZ(parsed, product.args[5]) + depth(product) - band.topFt * .3048) < 1e-8);
  }
  for (const fragment of ['BevoTag_InferredEnvelopeEvidence', "IFCTEXT('inferred')", 'Separate roof elevation.', 'a'.repeat(64), 'c'.repeat(64), 'not a surveyed wall']) assert.ok(text.includes(fragment), fragment);
  assert.equal(text.split('DATA;\n')[1], exportArchitectureIFC(model, building, { wallHeight: 9, spacing: 16, separation: 1 }).split('DATA;\n')[1]);
  assert.equal(parse(exportArchitectureIFC(model, building, { exterior: false })).of('IFCBUILDINGELEMENTPROXY').length, 0);
});

test('IFC exterior mode omits internal and reference wall solids, while retaining their cited source hierarchy', () => {
  const { model, building } = fixture();
  model.floors[0].envelope = { role: 'internal', source_page: 1, walls: [], footprints: [] };
  model.floors[1].envelope = { role: 'storey', source_page: 2, walls: [square], footprints: [square], context_walls: [square, square] };
  model.floors[2].envelope = { role: 'reference', source_page: 3, walls: [], footprints: [] };
  const text = exportArchitectureIFC(model, building), parsed = parse(text);
  assert.equal(parsed.of('IFCWALL').length, 2, 'only the selected storey context walls are retained');
  assert.equal(parsed.of('IFCBUILDINGELEMENTPROXY').length, 1);
  assert.equal(parsed.of('IFCBUILDINGSTOREY').length, 3);
  assert.equal(parsed.of('IFCSPACE').length, 3, 'reference space curves remain inspectable, without volumes');
  assert.ok(text.includes('Composite reference sheet retained for source inspection.'));
  assert.ok(text.includes('Wall footprints clipped to the reviewed enclosure boundary'));
  const original = parse(exportArchitectureIFC(model, building, { exterior: false }));
  assert.equal(original.of('IFCWALL').length, 3);
  assert.equal(original.of('IFCBUILDINGELEMENTPROXY').length, 0);
});

test('IFC removable roofs keep metric surface elevations, openings and evidence independent of enclosure visibility', () => {
  const { model, building } = fixture(), source = building.vertical.sources[0];
  model.envelope_review = { sources: [source], source_sha256: model.source.sha256, roof_thickness_ft: .5 };
  for (const floor of model.floors) floor.envelope = { role: 'storey', source_page: floor.source_page, footprints: [square], walls: [square] };
  model.floors[2].envelope.top = { elevation_ft: 43, status: 'documented', source_id: source.id, note: 'Separate roof surface elevation.' };
  model.floors[2].envelope.roofs = [
    { ...square, id: 'roof-top', label: 'Upper skylight', kind: 'skylight', anchor: 'top', status: 'inferred', review: { note: 'Retain plan opening.', evidence: ['section'] } },
    { ...square, id: 'terrace-base', label: 'Lower terrace', kind: 'terrace', anchor: 'base', status: 'inferred', review: { note: 'Setback footprint.', evidence: ['section'] } },
  ];
  const text = exportArchitectureIFC(model, building, { separation: 3 }), parsed = parse(text);
  const roofs = parsed.of('IFCBUILDINGELEMENTPROXY').filter(product => /surface'/.test(product.args[4]));
  assert.equal(roofs.length, 2);
  const solid = product => parsed.get(refs(productShape(parsed, product)[0].args[3])[0]);
  const depth = product => Number(solid(product).args[3]);
  const top = roofs.find(product => product.args[4] === "'Inferred skylight surface'");
  const terrace = roofs.find(product => product.args[4] === "'Inferred terrace surface'");
  assert.ok(Math.abs(worldZ(parsed, top.args[5]) - 42.5 * .3048) < 1e-8);
  assert.ok(Math.abs(worldZ(parsed, top.args[5]) + depth(top) - 43 * .3048) < 1e-8, 'assumed thickness does not raise documented roof surface');
  assert.ok(Math.abs(worldZ(parsed, terrace.args[5]) + depth(terrace) - 14 * .3048) < 1e-8, 'base-anchored terrace uses its floor elevation');
  assert.ok(roofs.every(product => depth(product) === .1524));
  for (const roof of roofs) {
    const profile = parsed.get(solid(roof).args[0]);
    assert.equal(profile.type, 'IFCARBITRARYPROFILEDEFWITHVOIDS');
    assert.equal(refs(profile.args[3]).length, 1, 'roof opening remains an analytic void');
  }
  for (const fragment of ['BevoTag_InferredRoofEvidence', 'DisplayThicknessMetres', 'ThicknessStatus', "IFCTEXT('assumed')", 'Separate roof surface elevation.', 'Retain plan opening.']) assert.ok(text.includes(fragment), fragment);
  assert.equal(text.split('DATA;\n')[1], exportArchitectureIFC(model, building, { separation: 1 }).split('DATA;\n')[1]);
  const count = options => parse(exportArchitectureIFC(model, building, options)).of('IFCBUILDINGELEMENTPROXY').length;
  assert.equal(count({ roofs: false }), 3, 'enclosure stays visible while roof objects are omitted');
  assert.equal(count({ exterior: false }), 0, 'original export defaults to no inferred roofs');
  assert.equal(count({ exterior: false, roofs: true }), 2, 'roof visibility is independently selectable');
});

import { validateArchitecture } from './architecture.mjs';
import { elevationInfo, verticalSummary } from './vertical-model.mjs';

// IFC4 subset: spatial hierarchy, swept wall profiles and room footprint curves.
// No slab thickness, room volume, material, opening height or surveyed datum is invented.
// Schema references:
// https://standards.buildingsmart.org/IFC/RELEASE/IFC4/ADD2_TC1/HTML/schema/ifcgeometricmodelresource/lexical/ifcextrudedareasolid.htm
// https://standards.buildingsmart.org/IFC/RELEASE/IFC4/ADD2_TC1/HTML/schema/ifcproductextension/lexical/ifcspace.htm
const METRES_PER_FOOT = 0.3048;
const IFC_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';

function stepText(value) {
  let result = '';
  for (const char of String(value)) {
    const code = char.codePointAt(0);
    if (code >= 0xD800 && code <= 0xDFFF) throw new Error('Invalid Unicode in IFC text');
    if (char === "'") result += "''";
    else if (code >= 32 && code <= 126 && char !== '\\') result += char;
    else if (code <= 0xFFFF) result += `\\X2\\${code.toString(16).toUpperCase().padStart(4, '0')}\\X0\\`;
    else result += `\\X4\\${code.toString(16).toUpperCase().padStart(8, '0')}\\X0\\`;
  }
  return `'${result}'`;
}

function real(value) {
  if (!Number.isFinite(value)) throw new Error('IFC coordinates and measures must be finite');
  const text = Number(value.toFixed(9)).toString();
  if (/[eE]/.test(text)) return text.replace('e', 'E').replace(/^(-?\d+)E/, '$1.E');
  return text.includes('.') ? text : `${text}.`;
}

// A deterministic 128-bit FNV-1a namespace hash, encoded with IFC's 22-character
// compressed-GUID alphabet. IDs stay fixed when display heights change. These
// identify this reconstruction's objects, not surveyed asset identities.
function guid(key) {
  let value = 0x6c62272e07bb014262b821756295c58dn;
  for (const byte of new TextEncoder().encode(`BevoTag/IFC4/${key}`)) {
    value = BigInt.asUintN(128, (value ^ BigInt(byte)) * 0x1000000000000000000013bn);
  }
  let encoded = '';
  for (let i = 0; i < 22; i++) {
    encoded = IFC_ALPHABET[Number(value & 63n)] + encoded;
    value >>= 6n;
  }
  return encoded;
}

const signedArea = ring => ring.reduce((sum, p, i) => {
  const q = ring[(i + 1) % ring.length];
  return sum + p[0] * q[1] - q[0] * p[1];
}, 0) / 2;

function orientedRing(points, clockwise = false) {
  const ring = points.slice();
  if (ring.length > 1 && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1]) ring.pop();
  const area = signedArea(ring);
  if (ring.length < 3 || Math.abs(area) < 1e-9) throw new Error('IFC polygon has no area');
  if ((area < 0) !== clockwise) ring.reverse();
  return ring;
}

/** Export reconstructed geometry, retaining source evidence and unknown heights. */
export function exportArchitectureIFC(architecture, building, { wallHeight = 10, spacing = 14 } = {}) {
  if (!Number.isFinite(wallHeight) || wallHeight <= 0 || !Number.isFinite(spacing) || spacing <= 0) {
    throw new Error('Model heights must be positive finite numbers');
  }
  validateArchitecture(architecture, building);
  if (new Set(building.floors.map(f => f.id)).size !== building.floors.length) throw new Error('Duplicate building floor IDs');
  const summary = verticalSummary(building, spacing);
  const lines = [], ids = new Set();
  const add = (type, ...values) => {
    const reference = `#${lines.length + 1}`;
    lines.push(`${reference}=${type.toUpperCase()}(${values.join(',')});`);
    return reference;
  };
  const list = values => `(${values.join(',')})`;
  const rootId = key => {
    const id = guid(JSON.stringify([building.id, key]));
    if (ids.has(id)) throw new Error('Duplicate IFC object identity');
    ids.add(id); return stepText(id);
  };
  const root = (type, key, name, description, ...rest) => add(type, rootId(key), '$', stepText(name), description ? stepText(description) : '$', ...rest);
  const point = coords => add('IfcCartesianPoint', list(coords.map(real)));
  const origin = point([0, 0, 0]);
  const zDirection = add('IfcDirection', '(0.,0.,1.)');
  const originAxes = add('IfcAxis2Placement3D', origin, '$', '$');
  const placement = (parent = '$', z = 0) => add('IfcLocalPlacement', parent,
    z === 0 ? originAxes : add('IfcAxis2Placement3D', point([0, 0, z]), '$', '$'));
  const modelContext = add('IfcGeometricRepresentationContext', '$', stepText('Model'), '3', '0.000001', originAxes, '$');
  const bodyContext = add('IfcGeometricRepresentationSubContext', stepText('Body'), stepText('Model'), '*', '*', '*', '*', modelContext, '$', '.MODEL_VIEW.', '$');
  const footprintContext = add('IfcGeometricRepresentationSubContext', stepText('FootPrint'), stepText('Model'), '*', '*', '*', '*', modelContext, '$', '.PLAN_VIEW.', '$');
  const lengthUnit = add('IfcSIUnit', '*', '.LENGTHUNIT.', '$', '.METRE.');
  const areaUnit = add('IfcSIUnit', '*', '.AREAUNIT.', '$', '.SQUARE_METRE.');
  const units = add('IfcUnitAssignment', list([lengthUnit, areaUnit]));
  const project = root('IfcProject', 'project', `${building.id} room and wall model`,
    'Plan-derived reconstruction. See BevoTag evidence property sets before using dimensions.',
    '$', '$', '$', list([modelContext]), units);
  const buildingPlacement = placement();
  const ifcBuilding = root('IfcBuilding', 'building', building.id, building.name || building.id,
    '$', buildingPlacement, '$', stepText(building.name || building.id), '.ELEMENT.', '$', '$', '$');
  root('IfcRelAggregates', 'project-building', 'Project building', '', project, list([ifcBuilding]));

  const textValue = value => `IFCTEXT(${stepText(value)})`;
  const lengthValue = value => `IFCLENGTHMEASURE(${real(value)})`;
  const json = value => value === undefined || value === null ? '' : JSON.stringify(value);
  const propertySet = (targets, key, name, entries) => {
    if (!targets.length) return;
    const properties = Object.entries(entries).map(([label, value]) => add('IfcPropertySingleValue', stepText(label), '$', value, '$'));
    const set = root('IfcPropertySet', `${key}/set`, name, '', list(properties));
    root('IfcRelDefinesByProperties', `${key}/relation`, name, '', list(targets), set);
  };
  propertySet([ifcBuilding], 'building-evidence', 'BevoTag_ModelEvidence', {
    GeometryStatus: textValue(architecture.source?.status || 'Plan-derived reconstruction; not an as-built survey'),
    SourceFile: textValue(architecture.source?.file || building.plan?.pdf || ''),
    SourceSHA256: textValue(architecture.source?.sha256 || ''),
    SourceMethod: textValue(architecture.source?.method || ''),
    SourceMetadata: textValue(json(architecture.source)),
    CoordinateFrame: textValue(architecture.coordinate_frame || 'Registered building X/Y, Z up'),
    Units: textValue('Metres. Source feet converted using exactly 0.3048 metres per foot.'),
    VerticalDatum: textValue(typeof summary.datum === 'string' ? summary.datum : summary.datum.description || json(summary.datum)),
    VerticalDatumMetadata: textValue(json(summary.datum)),
    ElevationStatusCounts: textValue(json(summary.counts)),
    HeightResearch: textValue(building.vertical?.note || ''),
    HeightSources: textValue(json(building.vertical?.sources || [])),
    GeometryReview: textValue(json(architecture.geometry_review ?? architecture.review)),
    GeometrySourceRegistry: textValue(json(building.geometry_review)),
    ExplodedView: textValue('Excluded. Placement uses unexpanded model coordinates; unknown Z values remain schematic.'),
    Limitations: textValue('Wall heights are display assumptions. Spaces are footprints only. No room volume, slab thickness, ceiling, opening height, or material assignment is inferred.'),
  });
  // Navigable references retain the actual evidence URL; a project reference does
  // not turn an unsupported height into a documented storey elevation.
  const sources = [
    ...(building.vertical?.sources || []),
    ...(building.geometry_review?.sources || []),
    ...(architecture.geometry_review?.sources || []),
  ];
  const seenSources = new Set();
  const uniqueSources = sources.filter(source => {
    const key = json(source);
    if (seenSources.has(key)) return false;
    seenSources.add(key); return true;
  });
  for (const [index, source] of uniqueSources.entries()) {
    const document = add('IfcDocumentReference', source.url || source.file ? stepText(source.url || source.file) : '$',
      stepText(source.id || `source-${index + 1}`), stepText(source.title || 'Research source'),
      stepText(source.evidence || ''), '$');
    root('IfcRelAssociatesDocument', `document/${index}`, source.title || 'Research source', source.evidence || '', list([ifcBuilding]), document);
  }

  const polyline = (ring, dimensions = 2) => {
    const points = ring.map(p => point(dimensions === 3 ? [p[0] * METRES_PER_FOOT, p[1] * METRES_PER_FOOT, 0] : p.map(v => v * METRES_PER_FOOT)));
    return add('IfcPolyline', list([...points, points[0]]));
  };
  const rings = polygon => {
    const outer = orientedRing(polygon.outline);
    const holes = (polygon.holes || []).map(hole => orientedRing(hole, true));
    const area = Math.abs(signedArea(outer)) - holes.reduce((sum, hole) => sum + Math.abs(signedArea(hole)), 0);
    if (!(area > 0)) throw new Error('IFC polygon holes exceed the exterior area');
    return { outer, holes, area };
  };
  const productShape = representation => add('IfcProductDefinitionShape', '$', '$', list([representation]));
  const storeys = [], allWalls = [];
  for (const floor of architecture.floors) {
    const info = elevationInfo(building, floor.id, spacing);
    const config = building.floors.find(f => f.id === floor.id);
    const floorKey = `floor/${floor.id}`, z = info.elevationFt * METRES_PER_FOOT;
    const storeyPlacement = placement(buildingPlacement, z);
    // The semantic Elevation attribute is left unset for assumptions, estimates
    // and uncited values. Their placement is explicitly documented as schematic.
    const elevation = info.status === 'documented' ? real(z) : '$';
    const storey = root('IfcBuildingStorey', floorKey, floor.id,
      `${info.status === 'documented' ? 'Documented' : 'Unverified'} level placement: ${info.note}`,
      '$', storeyPlacement, '$', stepText(config.name || floor.id), '.ELEMENT.', elevation);
    storeys.push(storey);
    propertySet([storey], `${floorKey}/evidence`, 'BevoTag_StoreyEvidence', {
      ElevationStatus: textValue(info.status),
      PlacementElevationMetres: lengthValue(z),
      ElevationNote: textValue(info.note),
      ElevationSource: textValue(json(info.source)),
      ElevationMetadata: textValue(json(config.elevation_source)),
      SourcePlanPage: textValue(floor.source_page ?? config.page ?? ''),
      FloorEvidence: textValue(json(floor.evidence)),
      FloorReview: textValue(json(floor.review)),
      GeometryExclusions: textValue(json(floor.geometry_exclusions)),
      GeometryAdditions: textValue(json(floor.geometry_additions)),
      PlacementInterpretation: textValue(info.status === 'documented' ? 'Source-documented elevation relative to the project datum.' : 'Unverified model placement; do not use as a surveyed building elevation.'),
    });
    const floorWalls = [];
    for (const [index, wall] of floor.walls.entries()) {
      const polygon = rings(wall), outer = polyline(polygon.outer), inner = polygon.holes.map(hole => polyline(hole));
      const profile = inner.length
        ? add('IfcArbitraryProfileDefWithVoids', '.AREA.', '$', outer, list(inner))
        : add('IfcArbitraryClosedProfileDef', '.AREA.', '$', outer);
      const solid = add('IfcExtrudedAreaSolid', profile, originAxes, zDirection, real(wallHeight * METRES_PER_FOOT));
      const representation = add('IfcShapeRepresentation', bodyContext, stepText('Body'), stepText('SweptSolid'), list([solid]));
      const wallKey = `${floorKey}/wall/${index + 1}`;
      const product = root('IfcWall', wallKey, `${building.id} ${floor.id} wall ${index + 1}`,
        'Reconstructed wall footprint extruded to an unverified display height.',
        stepText('Plan-derived wall solid'), placement(storeyPlacement), productShape(representation), stepText(wallKey), '.NOTDEFINED.');
      floorWalls.push(product); allWalls.push(product);
    }
    if (floorWalls.length) root('IfcRelContainedInSpatialStructure', `${floorKey}/walls`, 'Storey walls', '', list(floorWalls), storey);
    const spaces = [];
    for (const room of floor.rooms) {
      const polygon = rings(room), curves = [polygon.outer, ...polygon.holes].map(ring => polyline(ring, 3));
      const curveSet = add('IfcGeometricCurveSet', list(curves));
      const representation = add('IfcShapeRepresentation', footprintContext, stepText('FootPrint'), stepText('GeometricCurveSet'), list([curveSet]));
      const spaceKey = `${floorKey}/space/${room.id}`;
      const space = root('IfcSpace', spaceKey, room.label,
        'Reconstructed footprint only. Inner boundary curves retain holes; no space volume or ceiling height is inferred.',
        stepText('Plan-derived space footprint'), placement(storeyPlacement), productShape(representation), stepText(room.label), '.ELEMENT.', '.NOTDEFINED.', '$');
      spaces.push(space);
      propertySet([space], `${spaceKey}/evidence`, 'BevoTag_SpaceEvidence', {
        SourceRoomId: textValue(room.id),
        LabelSource: textValue(room.label_source || 'unspecified'),
        FootprintAreaSquareMetres: `IFCAREAMEASURE(${real(polygon.area * METRES_PER_FOOT ** 2)})`,
        AreaStatus: textValue('Reconstructed plan footprint area; not a surveyed or certified floor area.'),
        Representation: textValue('Footprint boundary curves only, including holes. No room volume.'),
        GeometryEvidence: textValue(json(room.evidence)),
        GeometryReview: textValue(json(room.review)),
      });
    }
    if (spaces.length) root('IfcRelAggregates', `${floorKey}/spaces`, 'Storey spaces', '', storey, list(spaces));
  }
  root('IfcRelAggregates', 'building-storeys', 'Building levels', '', ifcBuilding, list(storeys));
  propertySet(allWalls, 'wall-evidence', 'BevoTag_WallEvidence', {
    DisplayHeightMetres: lengthValue(wallHeight * METRES_PER_FOOT),
    HeightStatus: textValue('Unverified display height; not a measured clear height, ceiling height, or storey height.'),
    GeometryStatus: textValue('Vector-plan reconstruction. Doors, glazing, symbols and wall boundaries still require review.'),
  });
  const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, '');
  return [
    'ISO-10303-21;', 'HEADER;',
    "FILE_DESCRIPTION(('BevoTag reconstructed walls and space footprints; evidence and schematic heights included'),'2;1');",
    `FILE_NAME(${stepText(`${building.id}-rooms-walls.ifc`)},${stepText(timestamp)},('BevoTag'),('BevoTag'),'BevoTag IFC4 exporter','BevoTag DAQ Studio','');`,
    "FILE_SCHEMA(('IFC4'));", 'ENDSEC;', 'DATA;', ...lines, 'ENDSEC;', 'END-ISO-10303-21;', '',
  ].join('\n');
}

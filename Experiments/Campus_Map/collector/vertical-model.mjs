// Elevations and their evidence are independent of exploded-view separation.
// Canonical floor metadata: elevation_ft and
// elevation_source: { source_id, status: 'documented' | 'estimated', note }.
// Sources live in building.vertical.sources as { id, title, url, evidence }.
const finite = value => (typeof value === 'number' || typeof value === 'string' && value.trim() !== '') && Number.isFinite(Number(value));
const text = value => typeof value === 'string' && value.trim().length > 0;

function floorList(building) {
  if (!Array.isArray(building?.floors) || !building.floors.length) {
    throw new Error('Building must contain at least one floor.');
  }
  return building.floors;
}

function validSpacing(spacing) {
  if (!finite(spacing) || Number(spacing) <= 0) {
    throw new Error('Floor spacing must be a positive finite number.');
  }
  return Number(spacing);
}

function datumFloorIndex(building, floors) {
  const reference = building.vertical?.datum?.floor_id;
  if (reference !== undefined) {
    const index = floors.findIndex(floor => floor.id === reference);
    if (index < 0) throw new Error(`Unknown datum floor: ${reference}`);
    return index;
  }
  return Math.max(0, floors.findIndex(floor => floor.id === '1'));
}

function sourceFor(building, reference) {
  const id = reference?.source_id ?? reference?.id;
  if (!text(id) || !Array.isArray(building.vertical?.sources)) return null;
  // Duplicate IDs are ambiguous, so neither entry can establish provenance.
  const matches = building.vertical.sources.filter(source => source?.id === id);
  if (matches.length !== 1) return null;
  const source = matches[0];
  return text(source.title) && text(source.url) && text(source.evidence) ? source : null;
}

export function elevationInfo(building, floorId, spacing = 14) {
  const step = validSpacing(spacing), floors = floorList(building);
  const ground = datumFloorIndex(building, floors);
  const index = floors.findIndex(floor => floor.id === floorId);
  if (index < 0) throw new Error(`Unknown floor: ${floorId}`);
  const floor = floors[index], reference = floor.elevation_source;
  if (finite(floor.elevation_ft)) {
    const source = sourceFor(building, reference);
    // Accept the earlier id/verification spelling when canonical fields are absent.
    const declared = reference?.status ?? reference?.verification;
    const status = source && ['documented', 'estimated'].includes(declared) ? declared : 'unverified';
    return {
      elevationFt: Number(floor.elevation_ft), status, source,
      note: text(reference?.note) ? reference.note : status === 'unverified'
        ? 'Entered elevation has no complete, resolved height citation.'
        : status === 'estimated' ? 'Source-based estimate; not a documented floor elevation.'
          : 'Elevation documented in the cited source.',
    };
  }
  // Keep schematic levels in order when a building mixes sourced and unknown heights.
  // The model datum is only an anchor for display, never evidence of an actual elevation.
  const anchors = floors.flatMap((item, i) => finite(item.elevation_ft)
    ? [{ index: i, id: item.id, z: Number(item.elevation_ft) }]
    : i === ground ? [{ index: i, id: item.id, z: 0 }] : []);
  const atDatum = anchors.find(anchor => anchor.index === index);
  const below = anchors.filter(anchor => anchor.index < index).at(-1);
  const above = anchors.find(anchor => anchor.index > index);
  let elevationFt, placement;
  if (atDatum) {
    elevationFt = atDatum.z; placement = `Local model reference at floor ${atDatum.id}`;
  } else if (below && above) {
    elevationFt = below.z + (above.z - below.z) * (index - below.index) / (above.index - below.index);
    placement = `Schematic interpolation between entered floors ${below.id} and ${above.id}`;
  } else {
    const anchor = below || above;
    elevationFt = anchor.z + (index - anchor.index) * step;
    placement = `Schematic ${step} ft display spacing from floor ${anchor.id}`;
  }
  return { elevationFt, status: 'assumed', source: null, note: `${placement}; actual elevation is unknown.` };
}

export function verticalSummary(building, spacing = 14) {
  validSpacing(spacing);
  const floors = floorList(building);
  const rows = floors.map(floor => ({
    floorId: floor.id, name: floor.name ?? floor.id,
    ...elevationInfo(building, floor.id, spacing),
  }));
  const counts = { documented: 0, estimated: 0, unverified: 0, assumed: 0 };
  for (const row of rows) counts[row.status]++;
  const ground = floors[datumFloorIndex(building, floors)];
  return {
    counts, rows,
    datum: building.vertical?.datum ?? {
      floor_id: ground.id,
      description: `Floor ${ground.id} = 0 ft is the assumed display reference; no surveyed datum is supplied.`,
    },
  };
}

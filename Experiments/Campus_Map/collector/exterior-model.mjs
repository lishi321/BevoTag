import { elevationInfo } from './vertical-model.mjs';

const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
const text = value => typeof value === 'string' && value.trim().length > 0;
const ringArea = ring => Math.abs(ring.reduce((sum, p, i) => {
  const q = ring[(i + 1) % ring.length];
  return sum + p[0] * q[1] - q[0] * p[1];
}, 0) / 2);

function validatePolygon(polygon) {
  for (const ring of [polygon?.outline, ...(polygon?.holes || [])]) {
    if (!Array.isArray(ring) || ring.length < 3 || ring.some(point => !Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite))) {
      throw new Error('Invalid exterior envelope polygon');
    }
  }
  if (!(ringArea(polygon.outline) - (polygon.holes || []).reduce((sum, ring) => sum + ringArea(ring), 0) > 0)) {
    throw new Error('Exterior envelope polygon must have positive area');
  }
}

function explicitTop(architecture, top) {
  if (typeof top.elevation_ft !== 'number' || !Number.isFinite(top.elevation_ft)) throw new Error('Invalid exterior envelope top elevation');
  const candidates = (architecture.envelope_review?.sources || []).filter(source => source.id === top.source_id);
  const candidate = candidates.length === 1 ? candidates[0] : null;
  const source = candidate && text(candidate.title) && text(candidate.url) && text(candidate.evidence) ? candidate : null;
  const status = source && ['documented', 'estimated'].includes(top.status) ? top.status : 'unverified';
  return {
    elevationFt: top.elevation_ft, status, source, kind: 'explicit-top', floorId: null,
    note: `${text(top.note) ? top.note : 'Explicit envelope top.'}${status === 'unverified' ? ' Complete, unambiguous top-elevation evidence is unavailable.' : ''}`,
  };
}

/** Context walls for an assembled exterior view; source geometry stays intact. */
export function selectExteriorContextWalls(floor, exterior = true) {
  if (!exterior) return floor.walls;
  if (['internal', 'reference'].includes(floor.envelope?.role)) return [];
  const walls = floor.envelope?.context_walls ?? floor.walls;
  if (!Array.isArray(walls)) throw new Error('Invalid exterior context walls');
  if (floor.envelope?.context_walls) for (const polygon of walls) validatePolygon(polygon);
  return walls;
}

/**
 * Unexpanded exterior display span. Bounds may be sourced; the enclosure itself
 * remains inferred. Internal mezzanines and composite reference sheets do not
 * create a facade or interrupt the band below them.
 */
export function exteriorBand(architecture, building, floorId, { spacing = 14, wallHeight = 10 } = {}) {
  if (!positive(spacing) || !positive(wallHeight)) throw new Error('Model heights must be positive finite numbers');
  const floor = architecture.floors.find(item => item.id === floorId);
  if (!floor?.envelope) return null;
  const envelope = floor.envelope;
  if (!['storey', 'internal', 'reference'].includes(envelope.role)) throw new Error('Invalid exterior envelope role');
  if (envelope.role !== 'storey') return null;
  if (!Array.isArray(envelope.walls) || !Array.isArray(envelope.footprints)) throw new Error('Exterior envelope polygons are missing');
  for (const polygon of [...envelope.footprints, ...envelope.walls]) validatePolygon(polygon);
  if (!envelope.walls.length) return null;
  const index = building.floors.findIndex(item => item.id === floorId);
  if (index < 0) throw new Error(`Unknown envelope floor: ${floorId}`);
  const base = { ...elevationInfo(building, floorId, spacing), kind: 'floor', floorId };
  const next = building.floors.slice(index + 1).find(config => architecture.floors.find(item => item.id === config.id)?.envelope?.role === 'storey');
  const top = envelope.top ? explicitTop(architecture, envelope.top) : next
    ? { ...elevationInfo(building, next.id, spacing), kind: 'floor', floorId: next.id }
    : { elevationFt: base.elevationFt + wallHeight, status: 'assumed', source: null, kind: 'display-height', floorId: null,
      note: `No resolved envelope top; ${wallHeight} ft display height above the final envelope level.` };
  const heightFt = top.elevationFt - base.elevationFt;
  if (!positive(heightFt)) throw new Error(`Exterior envelope top must be above its base on level ${floorId}`);
  const statuses = [base.status, top.status];
  const status = ['unverified', 'assumed', 'estimated', 'documented'].find(value => statuses.includes(value));
  const note = `Inferred exterior enclosure; footprint, thickness and opening treatment are not surveyed facade geometry. Base: ${base.note} Top: ${top.note}`;
  return {
    floorId, baseFt: base.elevationFt, topFt: top.elevationFt, heightFt,
    status, geometryStatus: 'inferred', base, top, note,
  };
}

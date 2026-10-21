"""Apply separate, explicitly inferred exterior massing to reviewed plan geometry.

The room/wall reconstruction is never changed. Closed profiles represent a coarse
enclosure, including unmodeled glazing/doors; their thickness is schematic.
"""
import copy
import hashlib
import json
import math

from shapely.geometry import Polygon
from shapely.geometry.polygon import orient
from shapely.ops import unary_union


def _polygons(shape):
    if shape.is_empty:
        return []
    if shape.geom_type == 'Polygon':
        return [shape]
    return [p for part in getattr(shape, 'geoms', []) for p in _polygons(part)]


def _polygon(value):
    for ring in [value.get('outline', []), *value.get('holes', [])]:
        if len(ring) < 3 or any(len(p) != 2 or not all(isinstance(v, (int, float)) and math.isfinite(v) for v in p) for p in ring):
            raise ValueError('Invalid exterior profile ring')
    result = Polygon(value['outline'], value.get('holes', []))
    if not result.is_valid or result.area <= 0:
        raise ValueError('Invalid exterior profile polygon')
    return result


def _rings(shape):
    shape = orient(shape, sign=1)
    ring = lambda r: [[round(x, 4), round(y, 4)] for x, y in list(r.coords)[:-1]]
    return {'outline': ring(shape.exterior), 'holes': [ring(r) for r in shape.interiors]}


def apply_exterior_review(data, review, source_sha256=None):
    """Return an amended copy; selected-floor inputs and repeat application are safe.

    Every input floor must have a matching reviewed source page. A digest mismatch
    fails closed so the traces cannot silently survive replacement source plans.
    """
    if review.get('schema') != 1 or data.get('schema') != 1 or data.get('building') != review.get('building'):
        raise ValueError('Exterior review building/schema mismatch')
    expected = review.get('source_sha256')
    actual = source_sha256 or data.get('source', {}).get('sha256')
    if not expected or actual != expected or data.get('source', {}).get('sha256', expected) != expected:
        raise ValueError('Exterior review source PDF digest mismatch')
    thickness = review.get('wall_thickness_ft')
    if not isinstance(thickness, (int, float)) or not math.isfinite(thickness) or thickness <= 0:
        raise ValueError('Exterior wall thickness must be positive')
    roof_thickness = review.get('roof_thickness_ft', .5)
    if not isinstance(roof_thickness, (int, float)) or not math.isfinite(roof_thickness) or roof_thickness <= 0:
        raise ValueError('Roof display thickness must be positive')
    levels = {row['floor_id']: row for row in review['levels']}
    if len(levels) != len(review['levels']):
        raise ValueError('Duplicate exterior review floor')
    profiles = {key: _polygon(value) for key, value in review['profiles'].items()}
    roof_ids = set()
    source_ids = {source['id'] for source in review['sources']}
    for spec in review['levels']:
        for roof in spec.get('roofs', []):
            if (not roof.get('id') or roof['id'] in roof_ids or not isinstance(roof.get('label'), str)
                    or not roof['label'] or roof.get('kind') not in ('roof', 'terrace', 'skylight')
                    or roof.get('anchor') not in ('base', 'top') or roof.get('status') != 'inferred'
                    or spec['role'] != 'storey' or not roof.get('review', {}).get('note')
                    or not roof.get('review', {}).get('evidence')
                    or not set(roof['review']['evidence']).issubset(source_ids)):
                raise ValueError('Invalid reviewed roof metadata')
            roof_ids.add(roof['id'])
            _polygon(roof)
        for i, roof in enumerate(spec.get('roofs', [])):
            for other in spec['roofs'][i + 1:]:
                if roof['anchor'] == other['anchor'] and _polygon(roof).intersection(_polygon(other)).area > .001:
                    raise ValueError('Reviewed roofs overlap at the same anchor')
    result = copy.deepcopy(data)
    digest = hashlib.sha256(json.dumps(review, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    result['envelope_review'] = {
        'file': 'exterior-review.json', 'source_sha256': expected, 'sha256': digest,
        'reviewed': review['reviewed'], 'status': 'inferred', 'method': review['method'],
        'wall_thickness_ft': thickness, 'wall_thickness_status': 'assumed',
        'roof_thickness_ft': roof_thickness, 'roof_thickness_status': 'assumed',
        'sources': copy.deepcopy(review['sources']), 'limitations': review['limitations'],
    }
    for floor in result['floors']:
        spec = levels.get(floor['id'])
        if not spec or floor.get('source_page') != spec.get('source_page'):
            raise ValueError('Exterior review source page/floor mismatch')
        role = spec.get('role')
        if role not in ('storey', 'internal', 'reference'):
            raise ValueError('Invalid exterior review level role')
        ids = spec.get('profile_ids', [])
        if role != 'storey' and ids:
            raise ValueError('Internal/reference level cannot define an exterior storey')
        if role == 'storey' and not ids:
            raise ValueError('Exterior storey needs a reviewed profile')
        shape = unary_union([profiles[key] for key in ids])
        band = shape.difference(shape.buffer(-thickness, join_style=2)) if ids else shape
        envelope = {
            'role': role, 'status': 'inferred', 'source_page': spec['source_page'],
            'footprints': [_rings(p) for p in _polygons(shape)],
            'walls': [_rings(p) for p in _polygons(band)],
            'wall_thickness_ft': thickness, 'wall_thickness_status': 'assumed',
            'roofs': [{**copy.deepcopy(roof), **_rings(_polygon(roof))} for roof in spec.get('roofs', [])],
            'review': {'note': spec['note'], 'evidence': spec['evidence'], 'profile_ids': ids,
                       'profile_notes': [review['profiles'][key]['note'] for key in ids]},
        }
        if 'top' in spec:
            top = spec['top']
            if role != 'storey' or not isinstance(top.get('elevation_ft'), (int, float)) or not math.isfinite(top['elevation_ft']):
                raise ValueError('Invalid exterior top elevation')
            envelope['top'] = copy.deepcopy(top)
        if spec.get('clip_context_walls'):
            envelope['context_walls'] = [_rings(p) for wall in floor['walls']
                                         for p in _polygons(_polygon(wall).intersection(shape)) if p.area > .0001]
        floor['envelope'] = envelope
    return result

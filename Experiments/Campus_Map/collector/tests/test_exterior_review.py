import copy
import hashlib
import json
import sys
import unittest
from pathlib import Path

from shapely.geometry import Point, Polygon
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from exterior_review import apply_exterior_review


def load(building, name):
    return json.loads((ROOT / 'buildings' / building / name).read_text())


def shape(values):
    return unary_union([Polygon(p['outline'], p.get('holes', [])) for p in values])


class ExteriorReviewTests(unittest.TestCase):
    def test_generated_assets_preserve_original_room_and_wall_geometry(self):
        for building in ['EER', 'ECJ']:
            data = load(building, 'architecture.json')
            review = load(building, 'exterior-review.json')
            result = apply_exterior_review(data, review)
            self.assertEqual(result, apply_exterior_review(result, review))
            for before, after in zip(data['floors'], result['floors']):
                self.assertEqual(before['walls'], after['walls'])
                self.assertEqual(before['rooms'], after['rooms'])
                env = after['envelope']
                footprint, band = shape(env['footprints']), shape(env['walls'])
                self.assertTrue(footprint.is_valid)
                self.assertTrue(band.is_valid)
                self.assertLess(band.difference(footprint).area, .001)
                if env['role'] == 'storey':
                    self.assertGreater(band.area, 0)
                    self.assertAlmostEqual(band.area, footprint.difference(footprint.buffer(-.5, join_style=2)).area, delta=.02)
                    self.assertGreater(footprint.area, band.area * 10)

    def test_digest_building_page_and_duplicate_floor_fail_closed(self):
        data, review = load('ECJ', 'architecture.json'), load('ECJ', 'exterior-review.json')
        mutations = [lambda r: r.update(source_sha256='wrong'), lambda r: r.update(building='EER'),
                     lambda r: r['levels'][0].update(source_page=99),
                     lambda r: r['levels'].append(copy.deepcopy(r['levels'][0]))]
        for mutate in mutations:
            invalid = copy.deepcopy(review)
            mutate(invalid)
            with self.assertRaises(ValueError):
                apply_exterior_review(data, invalid)

    def test_partial_regeneration_uses_only_the_selected_source_page(self):
        data, review = load('EER', 'architecture.json'), load('EER', 'exterior-review.json')
        data['floors'] = [f for f in data['floors'] if f['id'] == '6']
        result = apply_exterior_review(data, review)
        self.assertEqual(len(result['floors']), 1)
        self.assertGreater(len(result['floors'][0]['envelope']['walls']), 0)

    def test_eer_atrium_and_external_notches_are_not_filled(self):
        data = apply_exterior_review(load('EER', 'architecture.json'), load('EER', 'exterior-review.json'))
        for fid in ['3', '4', '5', '6', '7', '8']:
            env = next(f for f in data['floors'] if f['id'] == fid)['envelope']
            footprint, walls = shape(env['footprints']), shape(env['walls'])
            self.assertFalse(footprint.covers(Point(130, 90)))
            self.assertFalse(walls.covers(Point(130, 90)))
            self.assertTrue(footprint.covers(Point(130, 160)))
            self.assertTrue(footprint.covers(Point(130, 20)))
            if fid in ['4', '5', '6', '7']:
                self.assertFalse(footprint.covers(Point(15, 90)))
                self.assertTrue(footprint.covers(Point(34, 90)))
                self.assertTrue(footprint.covers(Point(238, 90)))
        # These lowest atrium floors remain inside the building enclosure.
        for fid in ['B', '1', '2']:
            env = next(f for f in data['floors'] if f['id'] == fid)['envelope']
            self.assertTrue(shape(env['footprints']).covers(Point(130, 90)))

    def test_ecj_podium_setback_mezzanine_and_penthouse_projection(self):
        data = apply_exterior_review(load('ECJ', 'architecture.json'), load('ECJ', 'exterior-review.json'))
        floors = {f['id']: f for f in data['floors']}
        tower = shape(floors['2']['envelope']['footprints'])
        self.assertTrue(tower.covers(Point(20, 90)))  # Missing lobby detection does not punch the facade.
        self.assertTrue(shape(floors['B']['envelope']['footprints']).covers(Point(-70, 60)))
        self.assertFalse(tower.covers(Point(-70, 60)))
        env = floors['11']['envelope']
        penthouse = shape(env['footprints'])
        self.assertTrue(tower.contains(penthouse))
        self.assertEqual(env['top']['elevation_ft'], 159)
        self.assertEqual(env['top']['status'], 'documented')
        self.assertLess(shape(env['context_walls']).difference(penthouse).area, .001)
        self.assertLess(shape(env['context_walls']).area, shape(floors['11']['walls']).area)
        for fid, role in [('11M', 'internal'), ('R', 'reference')]:
            self.assertEqual(floors[fid]['envelope']['role'], role)
            self.assertEqual(floors[fid]['envelope']['walls'], [])
            self.assertEqual(floors[fid]['envelope']['footprints'], [])

    def test_review_is_tied_to_the_current_local_pdf(self):
        for building in ['EER', 'ECJ']:
            data = load(building, 'architecture.json')
            source = ROOT / 'buildings' / building / data['source']['file']
            digest = hashlib.sha256(source.read_bytes()).hexdigest()
            self.assertEqual(digest, load(building, 'exterior-review.json')['source_sha256'])


if __name__ == '__main__':
    unittest.main()

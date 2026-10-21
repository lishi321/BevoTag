"""Offline generator regressions; requires its documented Python dependencies."""
import importlib.util
from pathlib import Path
import unittest
import sys

import numpy as np
import pymupdf


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
SPEC = importlib.util.spec_from_file_location(
    'build_architecture', Path(__file__).resolve().parents[1] / 'build_architecture.py')
builder = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(builder)


class RenderedPageCoordinatesTest(unittest.TestCase):
    def make_page(self, rotation):
        doc = pymupdf.open()
        width, height = (200, 300) if rotation in (90, 270) else (300, 200)
        page = doc.new_page(width=width, height=height)
        page.set_rotation(rotation)
        unrotate = page.derotation_matrix
        point = lambda xy: pymupdf.Point(*xy) * unrotate
        # Long paired walls, a rectangle, a quadrilateral and a quarter-circle door.
        for a, b in [((30, 40), (250, 40)), ((30, 41), (250, 41)),
                     ((20, 20), (20, 180)), ((21, 20), (21, 180)),
                     ((0, 0), (300, 0))]:
            page.draw_line(point(a), point(b))
        page.draw_rect(pymupdf.Rect(point((50, 70)), point((130, 110))).normalize())
        page.draw_quad(pymupdf.Quad(*[point(p) for p in
                                    [(170, 70), (200, 75), (170, 90), (200, 95)]]))
        page.draw_bezier(*[point(p) for p in
                           [(80, 100), (81.656854, 100), (83, 101.343146), (83, 103)]])
        return doc, page

    def test_rotated_sheet_preserves_walls_door_and_clip(self):
        floor = {'fit': [20, 20, 280, 180], 'to_frame': [1, 0, 0, 0, -1, 200]}
        canonical = lambda groups: {
            angle: [tuple(round(v, 3) for v in span) for span in spans]
            for angle, spans in groups.items()}
        reference_doc, reference_page = self.make_page(0)
        expected_groups, expected_doors = builder.extract_vectors(reference_page, floor, 72)
        self.assertEqual(len(expected_doors), 1)
        self.assertFalse(any(offset == 200 for offset, _, _ in expected_groups.get(0, [])))
        for rotation in (90, 180, 270):
            with self.subTest(rotation=rotation):
                doc, page = self.make_page(rotation)
                groups, doors = builder.extract_vectors(page, floor, 72)
                self.assertEqual(canonical(groups), canonical(expected_groups))
                np.testing.assert_allclose(doors, expected_doors, atol=0.001)
                actual_walls = builder.reconstruct_walls(groups)
                expected_walls = builder.reconstruct_walls(expected_groups)
                self.assertLess(actual_walls.symmetric_difference(expected_walls).area, 0.01)
                doc.close()
        reference_doc.close()


if __name__ == '__main__':
    unittest.main()

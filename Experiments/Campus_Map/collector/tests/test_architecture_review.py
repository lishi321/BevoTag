"""Regression checks for reviewed atrium/skylight classification."""
import copy
import hashlib
import json
from pathlib import Path
import sys
import unittest

from shapely.geometry import Point, Polygon

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from architecture_review import apply_geometry_review


def rectangle(x0, y0, x1, y1, identifier="room"):
    return {"id": identifier, "label": identifier, "label_source": "plan-ocr",
            "outline": [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], "holes": [],
            "area_ft2": (x1-x0)*(y1-y0), "center": [(x0+x1)/2, (y0+y1)/2]}


def fixture():
    data = {"building": "TEST", "source": {"sha256": "known-plan"}, "floors": [
        {"id": "6", "source_page": 7, "rooms": [rectangle(0, 0, 20, 20)],
         "walls": [rectangle(20, 0, 21, 20)]}]}
    review = {"schema": 1, "building": "TEST", "source_sha256": "known-plan", "reviewed": "2026-10-21",
              "sources": [{"id": "plan"}], "exclusions": [{
                  "id": "opening", "floor_id": "6", "source_page": 7,
                  "classification": "open-to-below", "remove": ["rooms"],
                  "reason": "Reviewed drawing opening", "evidence": ["plan"],
                  "outline": [[5, 5], [15, 5], [15, 15], [5, 15]], "holes": []}]}
    return data, review


class ReviewTests(unittest.TestCase):
    def test_source_mismatch_rejected_before_mutation(self):
        data, review = fixture()
        before = copy.deepcopy(data)
        with self.assertRaisesRegex(ValueError, "source hash mismatch"):
            apply_geometry_review(data, review, "updated-pdf")
        self.assertEqual(data, before)
        data["source"]["sha256"] = "another-generated-plan"
        with self.assertRaisesRegex(ValueError, "source hash mismatch"):
            apply_geometry_review(data, review)

    def test_building_and_page_mismatch_rejected(self):
        data, review = fixture()
        data["building"] = "OTHER"
        with self.assertRaisesRegex(ValueError, "building mismatch"):
            apply_geometry_review(data, review)
        data["building"] = "TEST"
        data["floors"][0]["source_page"] = 8
        with self.assertRaisesRegex(ValueError, "source page mismatch"):
            apply_geometry_review(data, review)

    def test_cutout_preserves_hole_and_recomputes_room_center(self):
        data, review = fixture()
        result = apply_geometry_review(data, review, "known-plan")
        room = result["floors"][0]["rooms"][0]
        shape = Polygon(room["outline"], room["holes"])
        self.assertTrue(shape.is_valid)
        self.assertEqual(shape.area, 300)
        self.assertFalse(shape.covers(Point(10, 10)))
        self.assertTrue(shape.covers(Point(room["center"])))
        self.assertEqual(result["floors"][0]["walls"], data["floors"][0]["walls"])
        self.assertNotIn("geometry_review", data)

    def test_bridge_and_adjacent_room_survive_void_removal(self):
        data, review = fixture()
        bridge = rectangle(31, 57.5, 38, 126.8, "bridge")
        void = rectangle(38.733, 57.525, 227.733, 126.775, "false-atrium-floor")
        adjacent = rectangle(230, 57, 250, 127, "east-room")
        data["floors"][0]["rooms"] = [bridge, void, adjacent]
        review["exclusions"][0]["outline"] = [[38.7,57.5],[227.8,57.5],[227.8,126.8],[38.7,126.8]]
        result = apply_geometry_review(data, review)
        self.assertEqual(result["floors"][0]["rooms"], [bridge, adjacent])

    def test_repeat_is_idempotent_and_changed_review_requires_regeneration(self):
        data, review = fixture()
        result = apply_geometry_review(data, review)
        self.assertEqual(result, apply_geometry_review(result, review))
        review["exclusions"][0]["reason"] = "Updated review"
        with self.assertRaisesRegex(ValueError, "regenerate"):
            apply_geometry_review(result, review)

    def test_reviewed_connector_is_clipped_to_wall_face(self):
        data, review = fixture()
        review["added_spaces"] = [{**rectangle(20.5, 0, 25, 20, "reviewed-bridge"),
                                    "floor_id": "6", "source_page": 7,
                                    "reason": "Connector traced from plan", "evidence": ["plan"]}]
        result = apply_geometry_review(data, review)
        bridge = result["floors"][0]["rooms"][-1]
        shape = Polygon(bridge["outline"], bridge["holes"])
        self.assertEqual(shape.bounds, (21, 0, 25, 20))
        self.assertEqual(shape.area, 80)
        self.assertEqual(bridge["label_source"], "plan-review")
        self.assertTrue(shape.covers(Point(bridge["center"])))

    def test_addition_cannot_refill_a_reviewed_void(self):
        data, review = fixture()
        review["added_spaces"] = [{**rectangle(6, 6, 14, 14, "bad-bridge"),
                                    "floor_id": "6", "source_page": 7,
                                    "reason": "Incorrect proposal", "evidence": ["plan"]}]
        with self.assertRaisesRegex(ValueError, "excluded floor region"):
            apply_geometry_review(data, review)

    def test_committed_eer_review_matches_pdf_and_excludes_only_reviewed_regions(self):
        folder = ROOT / "buildings" / "EER"
        data = json.loads((folder / "architecture.json").read_text())
        review = json.loads((folder / "geometry-review.json").read_text())
        digest = hashlib.sha256((folder / "plan.pdf").read_bytes()).hexdigest()
        self.assertEqual(digest, review["source_sha256"])
        self.assertEqual(data, apply_geometry_review(data, review, digest))
        floors = {f["id"]: f for f in data["floors"]}
        for exclusion in review["exclusions"]:
            mask = Polygon(exclusion["outline"], exclusion["holes"])
            for target in exclusion["remove"]:
                for item in floors[exclusion["floor_id"]][target]:
                    shape = Polygon(item["outline"], item["holes"])
                    self.assertLess(shape.intersection(mask).area, .005)
        self.assertNotIn("6-space-030", {r["id"] for r in floors["6"]["rooms"]})
        bridge = next(r for r in floors["6"]["rooms"] if r["id"] == "6-reviewed-west-bridge")
        bridge_shape = Polygon(bridge["outline"], bridge["holes"])
        traced = Polygon(review["added_spaces"][0]["outline"])
        self.assertTrue(traced.covers(bridge_shape))
        self.assertTrue(bridge_shape.covers(Point(34, 92)))
        self.assertEqual(bridge["label"], "West bridge")
        self.assertEqual(bridge["label_source"], "plan-review")
        for wall in floors["6"]["walls"]:
            self.assertLess(bridge_shape.intersection(Polygon(wall["outline"], wall["holes"])).area, 1e-8)
        for fid, ids in {"3": ["3-space-042", "3-space-043"],
                         "8": ["8-space-003", "8-space-024", "8-space-026"]}.items():
            self.assertTrue(set(ids) <= {r["id"] for r in floors[fid]["rooms"]})
        for floor in data["floors"]:
            for kind in ["rooms", "walls"]:
                for item in floor[kind]:
                    shape = Polygon(item["outline"], item["holes"])
                    self.assertTrue(shape.is_valid, (floor["id"], kind))
                    self.assertFalse(shape.is_empty)
                    if kind == "rooms":
                        self.assertTrue(shape.covers(Point(item["center"])), item["id"])
            if floor["id"] not in ("3", "6", "8"):
                self.assertNotIn("geometry_exclusions", floor)


if __name__ == "__main__":
    unittest.main()

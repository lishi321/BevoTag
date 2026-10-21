"""Apply explicit, source-bound plan reviews to generated architecture.

Masks describe manually inspected drawing regions, never a generic size heuristic.
The original PDF digest and sheet number must match before any correction is used.
This changes XY classification only; it does not establish building elevations.
"""
import copy
import hashlib
import json

from shapely import set_precision
from shapely.geometry import Point, Polygon
from shapely.geometry.polygon import orient
from shapely.ops import unary_union


def _parts(shape):
    if shape.is_empty:
        return []
    if shape.geom_type == "Polygon":
        return [shape]
    return [p for item in getattr(shape, "geoms", []) for p in _parts(item)]


def _shape(item):
    shape = Polygon(item["outline"], item.get("holes", []))
    if not shape.is_valid or shape.is_empty:
        raise ValueError("Geometry review requires valid, nonempty polygons")
    return shape


def _rings(shape):
    shape = orient(shape, sign=1)
    points = lambda ring: [[round(x, 3), round(y, 3)] for x, y in list(ring.coords)[:-1]]
    return {"outline": points(shape.exterior), "holes": [points(ring) for ring in shape.interiors]}


def _subtract(items, mask, rooms=False):
    output = []
    removed_area = 0
    changed_ids = []
    for item in items:
        shape = _shape(item)
        if shape.intersection(mask).area < 1e-8:
            output.append(item)
            continue
        remaining = set_precision(shape.difference(mask), .001)
        removed_area += shape.area - remaining.area
        pieces = sorted(_parts(remaining), key=lambda p: (-p.area, p.bounds))
        if rooms:
            changed_ids.append(item["id"])
        for index, piece in enumerate(pieces):
            updated = {**item, **_rings(piece)}
            if rooms:
                if index:
                    updated["id"] = f'{item["id"]}-review-{index + 1}'
                updated["area_ft2"] = round(piece.area, 1)
                center = Point(item["center"])
                if not piece.covers(center):
                    center = piece.representative_point()
                updated["center"] = [round(center.x, 3), round(center.y, 3)]
            output.append(updated)
    return output, round(removed_area, 3), changed_ids


def apply_geometry_review(data, review, source_sha256=None):
    """Return a corrected copy; callers should pass the actual input PDF digest.

    Generated asset metadata is also checked, preventing a mask for one PDF or
    building from silently applying to another. Repeating an identical review is
    idempotent; changing the review requires fresh, unreviewed generated input.
    """
    if review.get("schema") != 1 or data.get("building") != review.get("building"):
        raise ValueError("Geometry review schema or building mismatch")
    expected = review.get("source_sha256")
    if not expected or data.get("source", {}).get("sha256") != expected:
        raise ValueError("Geometry review source hash mismatch; inspect the updated PDF")
    if source_sha256 is not None and source_sha256 != expected:
        raise ValueError("Geometry review source hash mismatch; inspect the updated PDF")
    signature = hashlib.sha256(json.dumps(review, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    previous = data.get("geometry_review")
    if previous:
        if previous.get("sha256") == signature:
            return copy.deepcopy(data)
        raise ValueError("Geometry review changed; regenerate from the source plan first")
    result = copy.deepcopy(data)
    sources = {source["id"] for source in review.get("sources", [])}
    floor_by_id = {floor["id"]: floor for floor in result["floors"]}
    applied = []
    identifiers = set()
    for exclusion in review.get("exclusions", []):
        eid = exclusion["id"]
        if eid in identifiers:
            raise ValueError("Duplicate geometry review exclusion ID")
        identifiers.add(eid)
        if not exclusion.get("reason") or not exclusion.get("evidence"):
            raise ValueError("Geometry review requires a reason and evidence")
        if not set(exclusion["evidence"]) <= sources:
            raise ValueError("Geometry review references an unknown evidence source")
        targets = exclusion.get("remove", [])
        if not targets or not set(targets) <= {"rooms", "walls"}:
            raise ValueError("Geometry review can remove only rooms or walls")
        mask = _shape(exclusion)
        floor = floor_by_id.get(exclusion["floor_id"])
        # Partial generation is useful for inspection; skip other levels.
        if floor is None:
            continue
        if floor["source_page"] != exclusion["source_page"]:
            raise ValueError("Geometry review source page mismatch")
        record = {"id": eid, "floor_id": floor["id"], "source_page": floor["source_page"],
                  "classification": exclusion["classification"], "reason": exclusion["reason"],
                  "evidence": exclusion["evidence"], **_rings(mask)}
        for target in targets:
            floor[target], area, changed = _subtract(floor[target], mask, rooms=target == "rooms")
            record[f"removed_{target}_area_ft2"] = area
            if target == "rooms":
                record["affected_room_ids"] = changed
        floor.setdefault("geometry_exclusions", []).append(record)
        applied.append({k: v for k, v in record.items() if k not in ("outline", "holes")})
    added = []
    for addition in review.get("added_spaces", []):
        aid = addition["id"]
        if aid in identifiers:
            raise ValueError("Duplicate geometry review ID")
        identifiers.add(aid)
        if not addition.get("reason") or not addition.get("evidence") or not addition.get("label"):
            raise ValueError("Reviewed space requires a label, reason and evidence")
        if not set(addition["evidence"]) <= sources:
            raise ValueError("Reviewed space references an unknown evidence source")
        shape = _shape(addition)
        floor = floor_by_id.get(addition["floor_id"])
        if floor is None:
            continue
        if floor["source_page"] != addition["source_page"]:
            raise ValueError("Geometry review source page mismatch")
        if any(room["id"] == aid for room in floor["rooms"]):
            raise ValueError("Reviewed space duplicates an existing room ID")
        for exclusion in review.get("exclusions", []):
            if exclusion["floor_id"] == floor["id"] and "rooms" in exclusion["remove"]:
                if shape.intersection(_shape(exclusion)).area > 1e-8:
                    raise ValueError("Reviewed space overlaps an excluded floor region")
        if any(shape.intersection(_shape(room)).area > 1e-8 for room in floor["rooms"]):
            raise ValueError("Reviewed space overlaps an existing floor surface")
        # Keep the traced floor inside the existing reconstructed wall faces.
        walls = unary_union([_shape(wall) for wall in floor["walls"]])
        pieces = _parts(set_precision(shape.difference(walls), .001))
        if len(pieces) != 1:
            raise ValueError("Reviewed space must remain one connected floor surface")
        piece = pieces[0]
        center = piece.representative_point()
        room = {"id": aid, "label": addition["label"], "label_source": "plan-review",
                "area_ft2": round(piece.area, 1), "center": [round(center.x,3), round(center.y,3)],
                "review": {"source_page": floor["source_page"], "reason": addition["reason"],
                           "evidence": addition["evidence"]}, **_rings(piece)}
        floor["rooms"].append(room)
        record = {"id": aid, "floor_id": floor["id"], "source_page": floor["source_page"],
                  "label": addition["label"], "area_ft2": room["area_ft2"],
                  "reason": addition["reason"], "evidence": addition["evidence"]}
        floor.setdefault("geometry_additions", []).append(record)
        added.append(record)
    result["geometry_review"] = {"file": "geometry-review.json", "sha256": signature,
                                 "source_sha256": expected, "reviewed": review["reviewed"],
                                 "sources": copy.deepcopy(review.get("sources", [])), "applied": applied,
                                 "added_spaces": added}
    return result

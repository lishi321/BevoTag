"""Reconstruct coarse wall solids and enclosed spaces from the registered vector plans.

Offline authoring utility; the browser only loads the generated architecture.json files.
Dependencies: pymupdf, numpy, opencv-python, shapely. Optional room-label OCR: rapidocr_onnxruntime.
Coordinates are building-frame feet. This is a reviewable reconstruction, not an as-built CAD survey.
"""
import argparse
import collections
import json
import math
import re
import hashlib
from pathlib import Path

import cv2
import numpy as np
import pymupdf
from shapely.geometry import LineString, Point, Polygon
from shapely.geometry.polygon import orient
from shapely.ops import unary_union
from shapely import set_precision
from architecture_review import apply_geometry_review
from exterior_review import apply_exterior_review

ROOT = Path(__file__).resolve().parent


def polygons(shape):
    if shape.is_empty:
        return []
    if shape.geom_type == 'Polygon':
        return [shape]
    return [p for part in getattr(shape, 'geoms', []) for p in polygons(part)]


def rings(poly):
    poly = orient(poly, sign=1)
    points = lambda ring: [[round(x, 3), round(y, 3)] for x, y in list(ring.coords)[:-1]]
    return {'outline': points(poly.exterior), 'holes': [points(r) for r in poly.interiors]}


def transform(floor, dpi):
    a, b, c, d, e, f = floor['to_frame']
    scale = dpi / 72
    return lambda p: np.array([a*p[0]*scale + b*p[1]*scale + c, d*p[0]*scale + e*p[1]*scale + f])


def extract_vectors(page, floor, dpi):
    project = transform(floor, dpi)
    clip = pymupdf.Rect([v * 72 / dpi for v in floor['fit']])
    # get_drawings() returns unrotated page coordinates. Registration and fit use
    # the rendered sheet, so rotate every primitive before clipping/projecting.
    # ECJ level 4 is stored as a portrait page with a 270-degree display rotation.
    rotation = page.rotation_matrix
    groups = collections.defaultdict(list)
    doors = []
    for drawing in page.get_drawings():
        if drawing['type'] not in ('s', 'fs') or drawing.get('dashes') != '[] 0':
            continue
        for item in drawing['items']:
            kind = item[0]
            lines = []
            if kind == 'l':
                lines = [(item[1] * rotation, item[2] * rotation)]
            elif kind == 're':
                r = item[1]; corners = [p * rotation for p in [r.tl, r.tr, r.br, r.bl]]
                lines = list(zip(corners, corners[1:] + corners[:1]))
            elif kind == 'qu':
                q = item[1]; corners = [p * rotation for p in [q.ul, q.ur, q.lr, q.ll]]
                lines = list(zip(corners, corners[1:] + corners[:1]))
            elif kind == 'c':
                rendered = [p * rotation for p in item[1:]]
                if not all(clip.contains(p) for p in [rendered[0], rendered[3]]):
                    continue
                pts = [project(p) for p in rendered]
                start, end = pts[0], pts[3]
                mid = (pts[0] + 3*pts[1] + 3*pts[2] + pts[3]) / 8
                # Circle through the curve endpoints and midpoint recovers a door hinge.
                mat = 2*np.array([mid-start, end-start])
                if abs(np.linalg.det(mat)) > 1e-5:
                    center = np.linalg.solve(mat, np.array([mid@mid-start@start, end@end-start@start]))
                    radius = np.linalg.norm(start-center)
                    angle = math.degrees(math.acos(np.clip((start-center)@(end-center)/max(radius**2, 1e-8), -1, 1)))
                    if 2.0 <= radius <= 4.5 and 65 <= angle <= 115:
                        doors.append([center, start, end])
            for p0, p1 in lines:
                if not clip.contains(p0) or not clip.contains(p1):
                    continue
                a, b = project(p0), project(p1)
                if np.linalg.norm(b-a) < 1.0:
                    continue  # lettering and small fixtures
                deg = round(math.degrees(math.atan2(*(b-a)[::-1])) % 180 * 4) / 4 % 180
                rad = math.radians(deg); u = np.array([math.cos(rad), math.sin(rad)]); n = np.array([-u[1], u[0]])
                offset = round(float(((a+b)/2)@n) / .04) * .04
                lo, hi = sorted([float(a@u), float(b@u)])
                groups[deg].append((offset, lo, hi))
    merged = {}
    for deg, lines in groups.items():
        by_offset = collections.defaultdict(list)
        for offset, lo, hi in lines:
            by_offset[offset].append((lo, hi))
        result = []
        for offset, spans in by_offset.items():
            for lo, hi in sorted(spans):
                if result and result[-1][0] == offset and lo <= result[-1][2] + .12:
                    result[-1] = (offset, result[-1][1], max(hi, result[-1][2]))
                else:
                    result.append((offset, lo, hi))
        merged[deg] = sorted(result)
    return merged, doors


def reconstruct_walls(groups):
    long, short, faces = [], [], []
    for deg, lines in groups.items():
        rad = math.radians(deg); u = np.array([math.cos(rad), math.sin(rad)]); n = np.array([-u[1], u[0]])
        # Repeated equal-length parallel treads are stairs, not full-height partitions.
        stairs = set()
        for i, (offset, lo, hi) in enumerate(lines):
            repeated = [j for j, (off2, lo2, hi2) in enumerate(lines)
                        if abs(off2-offset) < 7 and abs(lo-lo2) < .3 and abs(hi-hi2) < .3]
            if len(repeated) >= 6:
                stairs.update(repeated)
        for i, (offset, lo, hi) in enumerate(lines):
            if i in stairs:
                continue
            if hi-lo >= 4 and min(abs(deg),abs(deg-90),abs(deg-180)) < 1:
                faces.append(LineString([u*lo+n*offset,u*hi+n*offset]))
            for j in range(i+1, len(lines)):
                off2, lo2, hi2 = lines[j]
                gap = off2-offset
                if gap > 3.0:
                    break
                if gap < .24 or j in stairs:
                    continue
                start, end = max(lo, lo2), min(hi, hi2)
                if end-start < .65:
                    continue
                if gap > 1.2 and end-start < 5:
                    continue
                if gap > 1.2 and min(abs(deg),abs(deg-90),abs(deg-180)) >= 1:
                    continue
                poly = Polygon([u*start+n*offset, u*end+n*offset, u*end+n*off2, u*start+n*off2])
                (long if end-start >= 1.8 else short).append(poly)
    base = unary_union(long)
    joined = long + [p for p in short if p.distance(base) < .12]
    # Retain long architectural edges where a second face is missing (glazing, thin partitions).
    # Door leaves and text are shorter; repeated stair treads were removed above.
    joined += [line.buffer(.12, cap_style=2, join_style=2) for line in faces]
    return unary_union(joined).buffer(.055, join_style=2).buffer(-.055, join_style=2)


def reconstruct_rooms(walls, doors, groups, bounds, resolution=4):
    x0, y0, x1, y1 = bounds
    pad = 5; x0 -= pad; y0 -= pad; x1 += pad; y1 += pad
    shape = (math.ceil((y1-y0)*resolution)+1, math.ceil((x1-x0)*resolution)+1)
    mask = np.zeros(shape, dtype=np.uint8)
    pixel = lambda coords: np.rint((np.asarray(coords)-[x0,y0])*resolution).astype(np.int32)
    for p in polygons(walls):
        component = np.zeros(shape, dtype=np.uint8)
        cv2.fillPoly(component, [pixel(p.exterior.coords)], 255)
        for hole in p.interiors:
            cv2.fillPoly(component, [pixel(hole.coords)], 0)
        mask |= component
    accepted_doors = []
    for center, a, b in doors:
        if Point(center).distance(walls) > 1.2:
            continue
        # Close only the leaf whose far endpoint touches a wall jamb; the other is the open leaf.
        # Two closed leaves of a double door meet in the opening, not at a wall.
        endpoints = [p for p in [a,b] if Point(p).distance(walls) < 1.2 or any(
            np.linalg.norm(center-other_center) > 2 and min(np.linalg.norm(p-other_a),np.linalg.norm(p-other_b)) < .75
            for other_center,other_a,other_b in doors)]
        if not endpoints:
            continue
        for endpoint in endpoints:
            delta=(endpoint-center)/np.linalg.norm(endpoint-center)*.35
            cv2.line(mask, tuple(pixel(center-delta)), tuple(pixel(endpoint+delta)), 255, 3)
            accepted_doors.append([center, endpoint])
    # Seal short gaps along the same wall face for space detection only. These virtual
    # doorway/glazing closures are never extruded into physical walls.
    for deg, lines in groups.items():
        if min(abs(deg),abs(deg-90),abs(deg-180)) >= 1: continue
        rad=math.radians(deg);u=np.array([math.cos(rad),math.sin(rad)]);n=np.array([-u[1],u[0]])
        by_offset=collections.defaultdict(list)
        for off,lo,hi in lines:
            if hi-lo>=2:by_offset[off].append((lo,hi))
        for off,spans in by_offset.items():
            spans.sort()
            for prev,nxt in zip(spans,spans[1:]):
                if .12 < nxt[0]-prev[1] <= 7:
                    a=u*prev[1]+n*off;b=u*nxt[0]+n*off
                    if Point(a).distance(walls)<.4 and Point(b).distance(walls)<.4:
                        cv2.line(mask,tuple(pixel(a)),tuple(pixel(b)),255,3)
    barrier = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((9,9), np.uint8))
    count, labels, stats, _ = cv2.connectedComponentsWithStats(255-barrier, connectivity=4)
    rooms = []
    for label in range(1, count):
        left, top, width, height, area = stats[label]
        if left == 0 or top == 0 or left+width >= shape[1] or top+height >= shape[0] or area/resolution**2 < 25:
            continue
        local = np.uint8(labels[top:top+height, left:left+width] == label)*255
        contours, hierarchy = cv2.findContours(local, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
        for idx, contour in enumerate(contours):
            if hierarchy[0][idx][3] != -1:
                continue
            coords = lambda c: (c[:,0,:] + [left,top])/resolution + [x0,y0]
            holes=[]; child=hierarchy[0][idx][2]
            while child != -1:
                if len(contours[child]) >= 3: holes.append(coords(contours[child]))
                child=hierarchy[0][child][0]
            if len(contour) < 3:
                continue
            poly = Polygon(coords(contour), holes).buffer(0).simplify(.16, preserve_topology=True)
            for p in polygons(poly):
                if p.area >= 25: rooms.append(p)
    return sorted(rooms, key=lambda p: (-round(p.centroid.y/5), p.centroid.x)), accepted_doors


def read_labels(page, cfg, floor, ocr, cache):
    key=f'{cfg["id"]}-{floor["id"]}'
    path=cache/f'{key}-labels.json' if cache else None
    if path and path.exists():return json.loads(path.read_text())
    clip=pymupdf.Rect([v*72/cfg['plan']['dpi'] for v in floor['fit']]);scale=3
    pix=page.get_pixmap(matrix=pymupdf.Matrix(scale,scale),clip=clip,colorspace=pymupdf.csRGB);pix.gamma_with(12)
    image=np.frombuffer(pix.samples,np.uint8).reshape(pix.height,pix.width,3)
    project=transform(floor,cfg['plan']['dpi']);labels=[]
    # Tiles preserve the small outlined room digits instead of shrinking a whole sheet.
    for top in range(0,pix.height,1000):
        for left in range(0,pix.width,1000):
            result,_=ocr(image[top:top+1120,left:left+1120])
            for box,text,score in result or []:
                text=text.strip().replace(' ','').upper()
                if score < .8 or not re.fullmatch(r'[BR0-9]{1,3}\.[0-9A-Z]{2,6}',text):continue
                pixel_center=np.mean(box,axis=0)+[left,top]
                p=project((pixel_center+[pix.x,pix.y])/scale)
                if not any(x['label']==text and np.linalg.norm(np.array(x['center'])-p)<3 for x in labels):
                    labels.append({'label':text,'center':[round(float(v),3) for v in p],'confidence':round(float(score),3)})
    if path:
        cache.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(labels),encoding='utf-8')
    return labels


def build_floor(page, cfg, floor, labels=None):
    groups, doors = extract_vectors(page, floor, cfg['plan']['dpi'])
    walls = reconstruct_walls(groups)
    project = transform(floor, cfg['plan']['dpi'])
    x0,y0,x1,y1 = [v*72/cfg['plan']['dpi'] for v in floor['fit']]
    footprint = Polygon([project(p) for p in [(x0,y0),(x1,y0),(x1,y1),(x0,y1)]])
    rooms, openings = reconstruct_rooms(walls, doors, groups, footprint.bounds)
    # Keep the architecture attached to enclosed spaces, not isolated scale bars,
    # external dashed references or tiny furniture islands in the drawing margins.
    spaces=unary_union(rooms)
    # A large wall may border an open/unresolved room. Never discard that wall simply
    # because room closure failed; only prune small isolated drawing artifacts.
    wall_parts=[p for p in polygons(walls) if p.area >= 15 or p.distance(spaces) <= 1] if rooms else polygons(walls)
    walls=set_precision(unary_union(wall_parts).simplify(.025, preserve_topology=True), .001)
    room_data = []
    for i, p in enumerate(rooms):
        center = p.representative_point()
        matches=[label for label in labels or [] if p.covers(Point(label['center']))]
        name=' / '.join(sorted(set(x['label'] for x in matches))) if matches else f'Space {i+1:03}'
        room_data.append({'id': f'{floor["id"]}-space-{i+1:03}', 'label': name,
                          'label_source': 'plan-ocr' if matches else 'generated', 'area_ft2': round(p.area,1),
                          'center': [round(center.x,3),round(center.y,3)], **rings(p)})
    return {'id':floor['id'], 'source_page':floor['page'], 'walls':[rings(p) for p in polygons(walls) if p.area>.12],
            'rooms':room_data, 'room_labels':labels or [], 'openings': [[[round(float(v),3) for v in p] for p in pair] for pair in openings]}


def preview_model(data, path):
    points=np.array([p for wall in data['walls'] for p in wall['outline']]); low=points.min(axis=0)-5;high=points.max(axis=0)+5
    scale=1700/max(high-low); size=np.ceil((high-low)*scale).astype(int)
    canvas=np.full((size[1]+50,size[0],3),255,np.uint8)
    pixel=lambda pts:np.rint((np.asarray(pts)*[1,-1]-[low[0],-high[1]])*scale+[0,50]).astype(np.int32)
    for room in data['rooms']:
        cv2.fillPoly(canvas,[pixel(room['outline'])],(230,235,215))
        cv2.putText(canvas,room['label'],tuple(pixel(room['center'])),cv2.FONT_HERSHEY_SIMPLEX,.3,(70,80,70),1)
    for wall in data['walls']:
        component=np.zeros(canvas.shape[:2],np.uint8)
        cv2.fillPoly(component,[pixel(wall['outline'])],255)
        for hole in wall['holes']:cv2.fillPoly(component,[pixel(hole)],0)
        canvas[component>0]=(90,80,65)
    for a,b in data['openings']:cv2.line(canvas,tuple(pixel(a)),tuple(pixel(b)),(50,150,230),2)
    cv2.putText(canvas,f"Floor {data['id']}: {len(data['rooms'])} spaces / {len(data['walls'])} wall solids",(10,25),cv2.FONT_HERSHEY_SIMPLEX,.5,(60,60,60),1)
    cv2.imwrite(str(path),canvas)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('buildings',nargs='*',default=['EER','ASE','ECJ']);parser.add_argument('--floor');parser.add_argument('--preview-dir',type=Path)
    parser.add_argument('--ocr',action='store_true');parser.add_argument('--ocr-cache',type=Path)
    args=parser.parse_args()
    ocr=None
    if args.ocr:
        from rapidocr_onnxruntime import RapidOCR
        ocr=RapidOCR(det_limit_side_len=1280)
    for bid in args.buildings:
        folder=ROOT/'buildings'/bid; cfg=json.loads((folder/'building.json').read_text());doc=pymupdf.open(folder/cfg['plan']['pdf'])
        data={'schema':1,'building':bid,'units':'ft','coordinate_frame':'building xy, z up',
              'source':{'file':cfg['plan']['pdf'],'sha256':hashlib.sha256((folder/cfg['plan']['pdf']).read_bytes()).hexdigest(),'method':'paired vector wall faces and enclosed-space reconstruction','status':'plan-derived; review before using as an as-built model'},
              'default_wall_height_ft':10,'floors':[]}
        for floor in cfg['floors']:
            if args.floor and floor['id']!=args.floor:continue
            page=doc[floor['page']-1]
            labels=read_labels(page,cfg,floor,ocr,args.ocr_cache) if ocr else []
            result=build_floor(page,cfg,floor,labels);data['floors'].append(result)
            print(f"{bid} {floor['id']}: {len(result['walls'])} walls, {len(result['rooms'])} spaces, {len(result['openings'])} door closures",flush=True)
        review_path = folder/'geometry-review.json'
        if review_path.exists():
            data = apply_geometry_review(data, json.loads(review_path.read_text(encoding='utf-8')),
                                         source_sha256=data['source']['sha256'])
        exterior_path = folder/'exterior-review.json'
        if exterior_path.exists():
            data = apply_exterior_review(data, json.loads(exterior_path.read_text(encoding='utf-8')),
                                         source_sha256=data['source']['sha256'])
        if args.preview_dir:
            args.preview_dir.mkdir(parents=True, exist_ok=True)
            for result in data['floors']:
                preview_model(result, args.preview_dir/f'{bid}-{result["id"]}-architecture.png')
        # Partial runs are diagnostic only; never replace a whole building with a single floor.
        target=(args.preview_dir/f'{bid}-{args.floor}-architecture.json') if args.floor and args.preview_dir else folder/'architecture.json'
        if not args.floor or args.preview_dir: target.write_text(json.dumps(data,separators=(',',':'))+'\n',encoding='utf-8')


if __name__=='__main__': main()

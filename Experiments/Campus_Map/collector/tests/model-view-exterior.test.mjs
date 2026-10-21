import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from '../vendor/three.module.js';
import { BuildingView } from '../model-view.mjs';
import { wallGeometry } from '../architecture-geometry.mjs';

const ecj = JSON.parse(readFileSync(new URL('../buildings/ECJ/building.json', import.meta.url)));
const eer = JSON.parse(readFileSync(new URL('../buildings/EER/building.json', import.meta.url)));
const rectangle = x => ({ outline: [[x, 0], [x + 8, 0], [x + 8, 1], [x, 1]], holes: [] });
const roof = (id, anchor) => ({ ...rectangle(0), id, label: id, kind: 'roof', anchor, status: 'inferred' });
const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-6, `${message}: ${actual} vs ${expected}`);

function wallGroup(polygons) {
  const group = new THREE.Group();
  for (const polygon of polygons) {
    const geometry = wallGeometry(polygon);
    geometry.rotateX(-Math.PI / 2);
    group.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()));
  }
  return group;
}

// Exercise the real layout method with actual Three.js transforms and meshes.
// Only WebGL, DOM labels and repaint scheduling are replaced: neither is needed
// to measure the geometry that would reach the renderer.
function fixture(building = ecj) {
  const view = Object.create(BuildingView.prototype);
  view.building = structuredClone(building);
  view.architecture = {
    envelope_review: { roof_thickness_ft: .5 },
    floors: building.floors.map(config => ({
      id: config.id,
      walls: [rectangle(0), rectangle(12)], rooms: [],
      envelope: {
        role: config.id === '11M' ? 'internal' : config.id === 'R' ? 'reference' : 'storey',
        footprints: [rectangle(0)], walls: [rectangle(0)],
        ...(config.id === '11' ? {
          context_walls: [rectangle(100)],
          top: { elevation_ft: 159, status: 'unverified', note: 'Fixture envelope top.' },
          roofs: [roof('penthouse-top', 'top'), roof('lower-roof', 'base')],
        } : {}),
        ...(building.id === 'EER' && config.id === '8' ? { roofs: [roof('tower-top', 'top')] } : {}),
      },
    })),
  };
  view.options = {
    spacing: 14, separation: 1, wallHeight: 10, exterior: true, roofs: false,
    walls: true, rooms: true, plans: false, heat: false, points: false, isolate: false,
  };
  view.floor = '11';
  view.floorGroups = new Map();
  view.scene = new THREE.Scene();
  view.grid = new THREE.Group();
  view.scene.add(view.grid);
  view.drawOverlay = () => {};
  view.invalidate = () => {};
  for (const model of view.architecture.floors) {
    const group = new THREE.Group(), architectureGroup = new THREE.Group();
    const walls = wallGroup(model.walls), contextWalls = wallGroup(model.envelope.context_walls || []);
    const exterior = wallGroup(model.envelope.walls), rooms = new THREE.Group();
    const roofs = wallGroup(model.envelope.roofs || []);
    roofs.children.forEach((mesh, index) => { mesh.userData.roofId = model.envelope.roofs[index].id; });
    const plan = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
    const outline = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial());
    const heat = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
    const markers = new THREE.Group();
    architectureGroup.add(walls, contextWalls, exterior, rooms, roofs);
    group.add(architectureGroup, plan, outline, heat, markers);
    view.scene.add(group);
    view.floorGroups.set(model.id, {
      group, model, walls, contextWalls, exterior, rooms, roofs, plan, outline, heat, markers,
      architectureGroup, label: { classList: { toggle() {} } },
    });
  }
  return view;
}

function layout(view, options = {}) {
  Object.assign(view.options, options);
  view.updateLayout();
  view.scene.updateMatrixWorld(true);
}
const bounds = object => new THREE.Box3().setFromObject(object);
const visibleInScene = object => {
  for (let current = object; current; current = current.parent) if (!current.visible) return false;
  return true;
};

test('assembled exterior closes the ECJ 16 ft and 14 ft storey gaps without stretching plan walls', () => {
  const view = fixture();
  layout(view);
  const first = view.floorGroups.get('1'), second = view.floorGroups.get('2');
  close(bounds(first.exterior).min.y, 0, 'level 1 enclosure base');
  close(bounds(first.exterior).max.y, 16, 'level 1 enclosure reaches level 2');
  close(bounds(second.exterior).min.y, 16, 'level 2 enclosure base');
  close(bounds(second.exterior).max.y, 30, 'level 2 enclosure reaches level 3');
  const storeys = [...view.floorGroups.values()].filter(f => f.model.envelope.role === 'storey');
  for (let index = 0; index < storeys.length - 1; index++) {
    close(bounds(storeys[index].exterior).max.y, bounds(storeys[index + 1].exterior).min.y,
      `adjacent enclosure bands meet above ${storeys[index].model.id}`);
  }
  for (const floor of storeys) close(bounds(floor.walls).getSize(new THREE.Vector3()).y, 10,
    `plan walls retain their separate 10 ft extrusion on ${floor.model.id}`);
  const penthouse = bounds(view.floorGroups.get('11').exterior);
  close(penthouse.min.y, 142, 'penthouse base');
  close(penthouse.max.y, 159, 'explicit penthouse top, independent of mezzanine/reference placements');
});

test('exploding to 3× moves floor bases without tripling enclosure or plan-wall heights', () => {
  const view = fixture();
  layout(view);
  const assembled = new Map([...view.floorGroups].map(([id, f]) => [id, bounds(f.exterior)]));
  layout(view, { separation: 3 });
  for (const [id, floor] of view.floorGroups) {
    if (floor.model.envelope.role !== 'storey') continue;
    const before = assembled.get(id), after = bounds(floor.exterior);
    close(after.min.y, before.min.y * 3, `exploded base on ${id}`);
    close(after.max.y - after.min.y, before.max.y - before.min.y, `unchanged enclosure height on ${id}`);
    close(bounds(floor.walls).getSize(new THREE.Vector3()).y, 10, `unchanged plan-wall height on ${id}`);
  }
  close(bounds(view.floorGroups.get('2').exterior).min.y - bounds(view.floorGroups.get('1').exterior).max.y,
    32, '16 ft storey gets 32 ft of visible separation');
  close(bounds(view.floorGroups.get('B').exterior).min.y, -48, 'basement separates below the datum');
});

test('whole exterior uses reviewed level 11 context and suppresses composite/internal plans, reversibly', () => {
  const view = fixture();
  const penthouse = view.floorGroups.get('11');
  const originalWalls = penthouse.walls.children.slice();
  layout(view);
  assert.equal(visibleInScene(penthouse.walls), false, 'raw roof-plan wall context is hidden');
  assert.equal(visibleInScene(penthouse.contextWalls), true, 'reviewed penthouse wall context is visible');
  close(bounds(penthouse.contextWalls).min.x, 100, 'the separately modeled context geometry is selected');
  close(bounds(penthouse.contextWalls).getSize(new THREE.Vector3()).y, 10, 'context uses plan-wall height');
  for (const id of ['11M', 'R']) {
    assert.equal(visibleInScene(view.floorGroups.get(id).group), false, `${id} does not become a duplicate exterior storey`);
  }
  assert.equal(visibleInScene(view.floorGroups.get('10').walls), true, 'ordinary storeys keep their plan walls');

  layout(view, { exterior: false });
  assert.equal(visibleInScene(penthouse.walls), true);
  assert.equal(visibleInScene(penthouse.contextWalls), false);
  assert.deepEqual(penthouse.walls.children, originalWalls, 'mode changes preserve the original raw geometry');
  assert.equal(visibleInScene(penthouse.exterior), false);
  for (const id of ['11M', 'R']) assert.equal(visibleInScene(view.floorGroups.get(id).walls), true,
    `${id} source walls are restored in the complete plan stack`);

  layout(view, { exterior: true });
  assert.equal(visibleInScene(penthouse.contextWalls), true, 'returning to exterior reselects reviewed context');
  assert.equal(visibleInScene(view.floorGroups.get('R').walls), false);
});

test('isolating levels 11, 11M or R exposes original source geometry even with exterior enabled', () => {
  const view = fixture();
  for (const id of ['11', '11M', 'R']) {
    view.floor = id;
    layout(view, { isolate: true });
    const floor = view.floorGroups.get(id);
    assert.equal(visibleInScene(floor.walls), true, `source walls remain inspectable on ${id}`);
    assert.equal(visibleInScene(floor.contextWalls), false, `whole-building context replacement is inactive on ${id}`);
    assert.deepEqual([...view.floorGroups.values()].filter(f => visibleInScene(f.group)).map(f => f.model.id), [id]);
    if (id !== '11') assert.equal(visibleInScene(floor.exterior), false, `${id} has no independent exterior band`);
    close(view.grid.position.y, floor.group.position.y - 1, 'isolated-floor grid follows the source level');
  }
});

test('plan-wall visibility and exterior-enclosure visibility remain independent layers', () => {
  const view = fixture();
  layout(view, { walls: false });
  for (const id of ['1', '11']) {
    const floor = view.floorGroups.get(id);
    assert.equal(visibleInScene(floor.walls), false);
    assert.equal(visibleInScene(floor.contextWalls), false);
    assert.equal(visibleInScene(floor.exterior), true, `enclosure remains visible on ${id}`);
  }
  layout(view, { walls: true, exterior: false });
  assert.equal(visibleInScene(view.floorGroups.get('11').walls), true);
  assert.equal(visibleInScene(view.floorGroups.get('11').exterior), false);
});

test('removable ECJ roof solids end at the 142 ft and 159 ft surfaces instead of adding thickness above them', () => {
  const view = fixture();
  layout(view, { roofs: true });
  const floor = view.floorGroups.get('11');
  const top = floor.roofs.children.find(mesh => mesh.userData.roofId === 'penthouse-top');
  const lower = floor.roofs.children.find(mesh => mesh.userData.roofId === 'lower-roof');
  close(bounds(top).min.y, 158.5, 'penthouse roof underside');
  close(bounds(top).max.y, 159, 'penthouse roof surface');
  close(bounds(lower).min.y, 141.5, 'lower roof underside');
  close(bounds(lower).max.y, 142, 'lower roof surface at the storey base');
  close(bounds(top).getSize(new THREE.Vector3()).y, .5, 'roof display thickness');
  close(bounds(top).max.y, bounds(floor.exterior).max.y, 'roof surface meets the enclosure top');
});

test('roofs reenabled in an exploded view follow their owning floor without stretching local offsets or thickness', () => {
  const view = fixture();
  layout(view, { roofs: true });
  const floor = view.floorGroups.get('11');
  const original = floor.roofs.children.map(mesh => ({ mesh, box: bounds(mesh) }));
  layout(view, { roofs: false, separation: 3 });
  assert.equal(visibleInScene(floor.roofs), false, 'exploded preset can hide caps');
  layout(view, { roofs: true });
  assert.equal(visibleInScene(floor.roofs), true, 'user can reenable caps in the exploded view');
  for (const { mesh, box } of original) {
    const moved = bounds(mesh);
    close(moved.min.y - box.min.y, 284, 'roof translates with its owning level 11 base');
    close(moved.max.y - moved.min.y, .5, 'roof thickness does not triple');
  }
  const top = floor.roofs.children.find(mesh => mesh.userData.roofId === 'penthouse-top');
  close(bounds(top).max.y - floor.group.position.y, 17, 'penthouse roof retains its local offset');
  close(bounds(top).max.y, bounds(floor.exterior).max.y, 'exploded cap still meets its enclosure top');
});

test('roof visibility is independent of wall layers and toggling it preserves every mesh and source surface', () => {
  const view = fixture();
  const floor = view.floorGroups.get('11'), meshes = floor.roofs.children.slice();
  const source = JSON.stringify(floor.model);
  layout(view, { roofs: true, exterior: false, walls: false, rooms: false });
  assert.ok(meshes.every(visibleInScene), 'roof-only inspection works');
  assert.equal(visibleInScene(floor.exterior), false);
  assert.equal(visibleInScene(floor.walls), false);
  layout(view, { roofs: false, exterior: true, walls: true, rooms: true });
  assert.ok(meshes.every(mesh => !visibleInScene(mesh)), 'all caps are hidden together');
  assert.equal(visibleInScene(floor.exterior), true, 'hiding caps does not hide the enclosure');
  assert.equal(visibleInScene(floor.contextWalls), true, 'hiding caps does not hide plan-wall context');
  assert.equal(JSON.stringify(floor.model), source, 'visibility does not mutate source geometry');
  assert.deepEqual(floor.roofs.children, meshes, 'toggle reuses intact roof meshes');
  layout(view, { roofs: true });
  assert.ok(meshes.every(visibleInScene));
});

test('unverified EER roof elevation follows display settings while its assumed thickness remains fixed', () => {
  const view = fixture(eer);
  view.floor = '8';
  layout(view, { roofs: true });
  const floor = view.floorGroups.get('8'), mesh = floor.roofs.children[0];
  close(bounds(mesh).max.y, 108, 'schematic eighth-level roof at default spacing');
  assert.equal(floor.roofSurfaces[0].elevationStatus, 'assumed');
  layout(view, { spacing: 20, wallHeight: 12 });
  close(bounds(mesh).max.y, 152, 'roof follows the changed schematic level and final-band height');
  close(bounds(mesh).getSize(new THREE.Vector3()).y, .5, 'display slab thickness is independent of wall height');
  assert.equal(floor.roofSurfaces[0].elevationStatus, 'assumed', 'controls never promote a display height to sourced');
});

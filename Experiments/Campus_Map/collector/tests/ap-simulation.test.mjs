import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { roomCenterAps, createSimulation, simulateSurvey, wallsCrossed, pathLoss, SIM_DEFAULTS } from '../ap-simulation.mjs';
import { surveyPoints, estimatePosition } from '../signal-model.mjs';

const load = (id, file) => JSON.parse(readFileSync(new URL(`../buildings/${id}/${file}`, import.meta.url)));
const building = { id: 'EER', ...load('EER', 'building.json') }, architecture = load('EER', 'architecture.json');

test('path loss falls with distance, walls and floors', () => {
  assert.equal(pathLoss({ distanceFt: 0 }), SIM_DEFAULTS.p1m);
  assert.ok(pathLoss({ distanceFt: 100 }) < pathLoss({ distanceFt: 10 }));
  assert.equal(pathLoss({ distanceFt: 3.28084, walls: 2 }), SIM_DEFAULTS.p1m - 2 * SIM_DEFAULTS.wallLoss);
  assert.equal(pathLoss({ distanceFt: 3.28084, floors: 1 }), SIM_DEFAULTS.p1m - SIM_DEFAULTS.floorLoss);
});

test('a path through a wall polygon counts it once', () => {
  const wall = [{ ring: [[5, -1], [5.5, -1], [5.5, 1], [5, 1]], minX: 5, maxX: 5.5, minY: -1, maxY: 1 }];
  assert.equal(wallsCrossed(wall, 0, 0, 10, 0), 1);
  assert.equal(wallsCrossed(wall, 0, 5, 10, 5), 0);
});

test('one assumed AP per modeled space, with unique BSSIDs', () => {
  const aps = roomCenterAps(building, architecture);
  assert.equal(aps.length, architecture.floors.reduce((n, f) => n + f.rooms.length, 0));
  assert.equal(new Set(aps.map(a => a.bssid)).size, aps.length);
});

test('a scan at a room center hears that room AP strongest; real AP lists can replace the default', () => {
  const room = architecture.floors.find(f => f.id === '2').rooms[10];
  const sim = createSimulation(building, architecture);
  const scan = sim.scan('2', ...room.center);
  assert.equal(scan.aps[0].rssi, SIM_DEFAULTS.p1m);
  assert.ok(scan.aps.length <= SIM_DEFAULTS.keep && scan.aps.every(a => a.rssi >= SIM_DEFAULTS.floor));
  const custom = createSimulation(building, architecture, [{ bssid: '02:aa:00:00:00:01', ssid: 'Real', floor: '2', x: room.center[0], y: room.center[1] }]);
  assert.deepEqual(custom.scan('2', ...room.center).aps.map(a => a.bssid), ['02:aa:00:00:00:01']);
});

test('simulated survey feeds the existing heatmap points and estimator', () => {
  const sim = createSimulation(building, architecture);
  const samples = simulateSurvey(building, architecture, sim).filter(s => s.floor === '2');
  const points = surveyPoints(samples, building);
  assert.ok(points.length > 100);
  const room = architecture.floors.find(f => f.id === '2').rooms[20];
  const estimate = estimatePosition(points, sim.scan('2', ...room.center).aps);
  assert.ok(estimate.ok && estimate.floor === '2');
  assert.ok(Math.hypot(estimate.x - room.center[0], estimate.y - room.center[1]) < 30);
});

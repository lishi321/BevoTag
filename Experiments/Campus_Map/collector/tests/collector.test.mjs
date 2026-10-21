import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { parseCSV, importSurvey } from '../signal-model.mjs';

// Exercise the actual collector with a tiny DOM and deterministic device/file boundaries.
// These tests do not replace the browser checks for rendering and pointer interaction.
async function collector() {
  const nodes = new Map();
  const element = () => ({ value: '', textContent: '', innerHTML: '', checked: false, disabled: false,
    style: {}, dataset: {}, childNodes: [], tBodies: [{ innerHTML: '' }],
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {}, setAttribute() {}, getAttribute() { return null; },
    appendChild(n) { this.childNodes.push(n); }, removeChild() { this.childNodes.shift(); },
    getBoundingClientRect() { return { width: 1000, height: 700, left: 0, top: 0 }; },
    focus() {}, click() {}, remove() {},
  });
  const document = { getElementById(id) { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); },
    createElement: element, createElementNS: element, querySelectorAll: () => [], body: element() };
  let timer = 0;
  const context = vm.createContext({ document, navigator: {}, console, TextEncoder, TextDecoder, crypto: webcrypto,
    localStorage: { getItem: () => null, setItem() {} }, performance: { now: () => 42 },
    setTimeout: () => ++timer, clearTimeout() {}, setInterval: () => ++timer, clearInterval() {},
    ResizeObserver: class { observe() {} }, CustomEvent: class {},
    addEventListener() {}, dispatchEvent() {}, confirm: () => true,
    Blob, URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    fetch: async path => ({ ok: true, json: async () => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url))) }),
  });
  context.window = context;
  vm.runInContext(readFileSync(new URL('../app.js', import.meta.url), 'utf8'), context);
  const api = context.BevoTag;
  assert.equal(await api.ready, true);
  return { ...api, nodes, context };
}

test('late replies remain raw but cannot become a labeled training scan', async () => {
  const { S, RawLog, onLine } = await collector();
  await RawLog.start();
  S.collecting = true;
  S.label = { building: 'EER', floor: '2', room: '2.610', x_px: 1000, y_px: 2000, batch: 'current' };
  let resolved = false;
  S.waiter = { id: 42, timer: 1, resolve: () => { resolved = true; } };
  onLine('{"type":"scan","id":41,"aps":[{"bssid":"aa:bb:cc:dd:ee:01","rssi":-55}]}');
  assert.equal(resolved, false);
  const late = parseCSV(RawLog.mem.join('\n')).at(-1);
  assert.equal(late.collecting, '0'); assert.equal(late.batch, '');
  onLine('{"type":"scan","id":42,"aps":[]}');
  assert.equal(resolved, true);
  const current = parseCSV(RawLog.mem.join('\n')).at(-1);
  assert.equal(current.collecting, '1'); assert.equal(current.batch, 'current');
});

test('logging after simulator hello still records identity and excludes simulated training', async () => {
  const { S, RawLog, onLine } = await collector();
  S.mode = 'sim'; onLine('{"type":"hello","chip":"SIMULATOR"}');
  await RawLog.start();
  S.collecting = true; S.label = { building: 'EER', floor: '2', room: '2.610', x_px: 1000, y_px: 2000, batch: 'a' };
  onLine('{"type":"scan","aps":[{"bssid":"aa:bb:cc:dd:ee:01","rssi":-55}]}');
  const rows = parseCSV(RawLog.mem.join('\n'));
  assert.equal(JSON.parse(rows[0].line).source, 'sim');
  const result = importSurvey(rows, S.buildings);
  assert.equal(result.samples.length, 0); assert.equal(result.simulatorRows, 1);
});

test('failed final CSV flush retains the file and rows; retry commits exactly once', async () => {
  const { RawLog } = await collector();
  let fail = true, written = '', aborts = 0;
  const handle = { getFile: async () => ({ size: 0 }), createWritable: async () => ({
    seek: async () => {}, write: async s => { if (fail) throw new Error('disk full'); written += s; },
    close: async () => {}, abort: async () => { aborts++; },
  }) };
  RawLog.handle = handle; RawLog.buf = ['first', 'second'];
  await RawLog.stop();
  assert.equal(RawLog.on(), true); assert.equal(RawLog.handle, handle);
  assert.deepEqual(Array.from(RawLog.buf), ['first', 'second']);
  assert.equal(RawLog.stopping, false); assert.equal(aborts, 1);
  fail = false; await RawLog.stop();
  assert.equal(written, 'first\nsecond\n'); assert.equal(RawLog.on(), false);
  assert.equal(RawLog.buf.length, 0);
});

test('stop defines a recording cutoff before waiting on an in-flight disk write', async () => {
  const { RawLog } = await collector();
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  let written = '';
  RawLog.handle = { getFile: async () => ({ size: 0 }), createWritable: async () => ({
    seek: async () => {}, write: async text => { entered(); await gate; written += text; }, close: async () => {},
  }) };
  RawLog.buf = ['accepted'];
  const stopping = RawLog.stop();
  await started;
  RawLog.add('in', 'after-cutoff');
  release(); await stopping;
  assert.equal(written, 'accepted\n'); assert.equal(RawLog.on(), false);
});

test('localization uses bounded monotonic request IDs, freezes location, and never trains on query', async () => {
  const api = await collector(), { S, RawLog, nodes, probe, onLine } = api;
  S.mode = 'sim'; await RawLog.start(); api.setPoint(1000, 2000); nodes.get('room').value = '2.610';
  const oldFloor = S.floor, oldBuilding = S.building;
  const pending = probe();
  await Promise.resolve();
  assert.equal(S.locating, true);
  const id = S.waiter.id; assert.ok(id > 0 && id < 2147483647);
  onLine(JSON.stringify({ type: 'err', id: id - 1, msg: 'stale failure' }));
  assert.equal(S.waiter.id, id);
  await assert.rejects(probe(), /already/);
  api.setFloor('3'); api.setBuilding('ASE'); api.setPoint(5, 5);
  assert.equal(S.floor, oldFloor); assert.equal(S.building, oldBuilding); assert.equal(S.point.x, 1000);
  await api.collect(); assert.equal(S.collecting, false);
  onLine(JSON.stringify({ type: 'scan', id, aps: [
    { bssid: 'aa:bb:cc:dd:ee:01', rssi: -55, ch: '<img src=x>' },
    { bssid: 'aa:bb:cc:dd:ee:02', rssi: null }, { bssid: 'invalid', rssi: -50 },
  ] }));
  const scan = await pending;
  assert.equal(scan.aps.length, 1); assert.equal(scan.aps[0].ch, null);
  assert.equal(S.locating, false); assert.equal(S.samples.length, 0);
  const raw = parseCSV(RawLog.mem.join('\n')).filter(r => r.type === 'scan' && r.dir === 'in');
  assert.equal(raw[0].collecting, '0'); assert.equal(raw[0].batch, '');
  const next = probe(); await Promise.resolve();
  assert.equal(S.waiter.id, id + 1);
  onLine('{"type":"err","msg":"scan failed"}'); await assert.rejects(next, /scan failed/);
  assert.equal(S.locating, false);
});

import { BuildingView } from './model-view.mjs';
import { parseCSV, importSurvey, surveyPoints, estimatePosition, demoSurvey, demoScan, toFrame, fromFrame } from './signal-model.mjs';
import { roomAt, validateArchitecture } from './architecture.mjs';
import { exportArchitectureOBJ } from './architecture-geometry.mjs';
import { elevationInfo, verticalSummary } from './vertical-model.mjs';

const $ = id => document.getElementById(id);
const api = window.BevoTag, S = api.S;
let view, buildingId, points = [], importedRows = [], imported = [], estimate = null, estimating = false;
let modelMessage = '', demo = [], importInfo = '', currentView = '3d', importing = false;
let architecture = null, modelFloor = null, selectedRoom = null, loadGeneration = 0;

function refreshHeights() {
  const building = S.buildings[S.building];
  if (!building || !S.floor) return;
  const spacing = Number($('floorSpacing').value) || 14, summary = verticalSummary(building, spacing);
  const current = elevationInfo(building, S.floor, spacing);
  const labels = { documented: 'Documented', estimated: 'Source estimate', unverified: 'Unverified', assumed: 'Unknown' };
  const format = value => Number(value.toFixed(2)).toString();
  $('heightStatus').textContent = current.status === 'assumed'
    ? `Level ${S.floor} elevation unknown · schematic display only`
    : `Level ${S.floor}: ${format(current.elevationFt)} ft · ${labels[current.status].toLowerCase()}`;
  $('sceneSubtitle').textContent = `${building.floors.length} levels · ${summary.counts.documented} documented elevations`;
  $('heightDatum').textContent = typeof summary.datum === 'string' ? summary.datum : summary.datum.description;
  $('heightRows').replaceChildren();
  for (const row of summary.rows) {
    const tr = document.createElement('tr'); tr.classList.toggle('active', row.floorId === S.floor); tr.title = row.note;
    for (const value of [row.floorId, row.status === 'assumed' ? 'Unknown' : `${format(row.elevationFt)} ft · ${labels[row.status]}`, format(row.elevationFt)]) {
      const td = document.createElement('td'); td.textContent = value; tr.appendChild(td);
    }
    $('heightRows').appendChild(tr);
  }
  $('heightResearchNote').textContent = building.vertical?.note || 'No dimensioned elevation source is recorded for this building.';
  $('heightSources').replaceChildren();
  for (const source of building.vertical?.sources || []) {
    if (!/^https?:\/\//.test(source.url)) continue;
    const li = document.createElement('li'), a = document.createElement('a');
    a.textContent = source.title; a.href = source.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.title = source.evidence;
    li.appendChild(a); $('heightSources').appendChild(li);
  }
  $('btnExportModel').textContent = summary.counts.documented === building.floors.length ? 'Export building OBJ' : 'Export schematic OBJ';
}

function chooseRoom(room) {
  selectedRoom = room;
  $('modelRoom').value = room?.id || '';
  $('roomDetail').textContent = room ? `${room.label} · ≈ ${Math.round(room.area_ft2).toLocaleString()} sq ft · ${room.label_source === 'plan-ocr' ? 'label read from plan' : 'unlabeled space'}` : 'Click a room surface or choose one above.';
  view?.selectRoom(room?.id || null); controls();
}

function refreshArchitecture() {
  const floor = architecture?.floors.find(f => f.id === S.floor);
  $('architectureSummary').textContent = floor ? `${floor.rooms.length} enclosed spaces · ${floor.walls.length} wall solids on level ${S.floor}` : 'No wall geometry loaded for this floor.';
  $('btnExportModel').disabled = !architecture;
  if (modelFloor === floor) return;
  modelFloor = floor;
  $('modelRoom').replaceChildren(new Option('Select a room in the model', ''));
  for (const room of [...(floor?.rooms || [])].sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }))) $('modelRoom').appendChild(new Option(room.label, room.id));
  chooseRoom(null);
}

async function loadArchitecture(building) {
  const generation = ++loadGeneration;
  view?.clearBuilding();
  architecture = null; modelFloor = null; refreshArchitecture();
  try {
    const response = await fetch(`buildings/${building.id}/architecture.json`);
    if (!response.ok) throw new Error(`model file returned HTTP ${response.status}`);
    const data = validateArchitecture(await response.json(), building);
    if (generation !== loadGeneration) return;
    architecture = data;
    demo = demoSurvey(building, architecture);
    const loading = view?.setBuilding(building, S.floor, architecture);
    options(); refreshArchitecture(); refreshData();
    await loading;
    if (!view) modelMessage = '';
    if (generation === loadGeneration) status();
  } catch (error) {
    if (generation !== loadGeneration) return;
    modelMessage = `Wall model unavailable: ${error.message}. Use the 2D survey to view the plan.`;
    refreshArchitecture(); status();
  }
}

function status() {
  $('modelStatus').textContent = modelMessage || (!points.length ? 'Import survey CSVs or explore the demo to see signal coverage.' : '');
  $('modelStatus').hidden = !$('modelStatus').textContent;
}

function selectView(mode) {
  currentView = mode;
  $('modelViewport').hidden = mode !== '3d'; $('viewport').hidden = mode !== '2d';
  for (const [id, active] of [['view3d', mode === '3d'], ['view2d', mode === '2d']]) {
    $(id).classList.toggle('active', active); $(id).setAttribute('aria-pressed', String(active));
  }
  if (mode === '2d') requestAnimationFrame(() => api.fitView()); else view?.resize();
}

function clearEstimate(message = 'Collect or import at least 3 survey points to begin.') {
  estimate = null; view?.setEstimate(null); $('estimateResult').textContent = message; $('btnFocusEstimate').hidden = true;
}

function controls() {
  const busy = S.collecting || S.locating || estimating || importing;
  for (const id of ['btnDemo', 'surveySource', 'btnImport', 'btnClearImport', 'btnEstimateJson']) $(id).disabled = busy;
  $('btnEstimate').disabled = busy || points.length < 3;
  $('btnEstimate').textContent = estimating ? 'Matching fingerprints…' : $('surveySource').value === 'demo' ? 'Estimate demo signal' : 'Scan & estimate position';
  $('btnFocusRoom').disabled = !selectedRoom || !view;
  $('btnRoomPoint').disabled = busy || !selectedRoom;
}

function refreshData(reset = true) {
  const building = S.buildings[S.building];
  if (!building || !S.floor) return;
  const synthetic = $('surveySource').value === 'demo';
  const samples = synthetic ? demo : [...imported, ...S.samples.filter(s => !s.simulated)];
  points = surveyPoints(samples, building);
  const aps = new Map();
  for (const p of points) for (const ap of p.aps) aps.set(ap.bssid, ap.ssid);
  const chosen = $('signalSelect').value;
  $('signalSelect').replaceChildren(new Option('Strongest observed signal', '*'));
  for (const [id, ssid] of [...aps].sort((a, b) => a[0].localeCompare(b[0]))) $('signalSelect').appendChild(new Option(`${ssid || 'Hidden network'} · ${id}`, id));
  if (chosen === '*' || aps.has(chosen)) $('signalSelect').value = chosen;
  const floorCount = new Set(points.map(p => p.floor)).size;
  $('surveySummary').textContent = `${points.length} points · ${floorCount} floors · ${aps.size} BSSIDs in ${building.id}. ` +
    (synthetic ? 'Synthetic example; never added to survey logs.' : importInfo || 'Live hardware scans and imported survey logs.');
  $('dataBadge').textContent = synthetic ? 'DEMO · SYNTHETIC' : points.length ? `${points.length} SURVEY POINTS` : 'NO SURVEY DATA';
  $('dataBadge').classList.toggle('demo', synthetic);
  view?.setOptions({ bssid: $('signalSelect').value }); view?.setData(points);
  if (reset) clearEstimate(points.length >= 3 ? 'Ready to match a new scan. The query is kept out of the survey dataset.' : 'Collect or import at least 3 survey points to begin.');
  status(); controls();
}

function syncBuilding() {
  if (!S.building || !S.floor) return;
  const building = S.buildings[S.building];
  if (buildingId !== S.building) {
    buildingId = S.building; demo = demoSurvey(building);
    $('buildingName').textContent = building.name;
    modelMessage = 'Loading room and wall geometry…';
    loadArchitecture(building);
    refreshData();
  }
  $('sceneTitle').textContent = `${building.id} / Level ${S.floor}`;
  refreshHeights();
  view?.setFloor(S.floor, S.point);
  refreshArchitecture();
  controls();
}

function options() {
  const spacing = Math.max(6, Math.min(40, Number($('floorSpacing').value) || 14));
  const separation = Number($('floorSeparation').value);
  const wallHeight = Math.max(1, Math.min(30, Number($('wallHeight').value) || 10));
  const isolateChanged = view && view.options.isolate !== $('isolateFloor').checked;
  const heightsChanged = view && (view.options.spacing !== spacing || view.options.separation !== separation);
  $('wallHeight').value = wallHeight;
  $('floorSpacing').value = spacing; $('separationValue').value = `${separation}×${separation === 1 ? ' · unexploded' : ' · exploded view'}`;
  view?.setOptions({ spacing, separation, wallHeight, walls: $('showWalls').checked, rooms: $('showRooms').checked, plans: $('showPlans').checked, bssid: $('signalSelect').value, heat: $('showHeat').checked, points: $('showPoints').checked, isolate: $('isolateFloor').checked });
  if (isolateChanged || heightsChanged) view.fit();
  refreshHeights();
}

function renderEstimate(result, source) {
  estimate = result; view?.setEstimate(result);
  const output = $('estimateResult'); output.replaceChildren();
  $('btnFocusEstimate').hidden = !result.ok;
  if (!result.ok) { output.textContent = result.reason; return; }
  const title = document.createElement('strong'); title.textContent = `${S.building} · Level ${result.floor}`; output.appendChild(title);
  const position = document.createElement('div'); position.textContent = `Building frame: ${result.x.toFixed(1)}, ${result.y.toFixed(1)} ft`; output.appendChild(position);
  const room = document.createElement('div'); room.textContent = `Nearest survey label: ${result.room || 'unlabeled'}`; output.appendChild(room);
  const modelRoom = roomAt(architecture?.floors.find(f => f.id === result.floor), result.x, result.y);
  const space = document.createElement('div'); space.textContent = `Model space: ${modelRoom?.label || 'open or unresolved space'}`; output.appendChild(space);
  const grid = document.createElement('div'); grid.className = 'result-detail';
  for (const [label, value] of [['Neighbor spread', `${result.spread.toFixed(1)} ft`], ['Shared BSSIDs', result.shared], ['Fingerprint difference', `${result.distance.toFixed(1)} dB RMS`], ['Matching points', result.neighbors.length]]) {
    const item = document.createElement('div'); item.textContent = label;
    const number = document.createElement('b'); number.textContent = value; item.appendChild(number); grid.appendChild(item);
  }
  output.appendChild(grid);
  const note = document.createElement('p'); note.className = 'small';
  note.textContent = `${source}. ${result.floorSupport < 0.7 ? 'Floor match is ambiguous; neighboring floors also match. ' : ''}Teal marker = estimate; circle = neighbor spread.`;
  output.appendChild(note);
}

async function runEstimate(pasted = false) {
  if (estimating || S.collecting || S.locating) return;
  estimating = true; controls();
  try {
    const synthetic = $('surveySource').value === 'demo';
    let scan, source;
    if (pasted) {
      scan = JSON.parse($('queryScan').value);
      if (!scan || !Array.isArray(scan.aps)) throw new Error('Paste a scan object with an aps array.');
      source = synthetic ? 'Recorded query against synthetic demo' : 'Recorded query against survey data';
    } else if (synthetic) {
      const building = S.buildings[S.building], floor = building.floors.find(f => f.id === S.floor);
      const [x0, y0, x1, y1] = floor.fit;
      const room = modelFloor?.rooms[Math.floor(modelFloor.rooms.length / 2)];
      const pixel = S.point || (room && fromFrame(floor, ...room.center)) || { x: x0 + (x1 - x0) * 0.47, y: y0 + (y1 - y0) * 0.51 };
      const p = toFrame(floor, pixel.x, pixel.y); scan = demoScan(building, S.floor, p.x, p.y);
      source = 'Synthetic demo query';
    } else {
      if (S.mode === 'sim' || S.device?.chip === 'SIMULATOR') throw new Error('Simulator scans are excluded from real surveys. Choose the demo source to try estimation.');
      scan = await api.probe(); source = 'New device scan';
    }
    renderEstimate(estimatePosition(points, scan.aps), source);
  } catch (error) { clearEstimate(error.message || 'The scan could not be estimated.'); }
  finally { estimating = false; controls(); }
}

async function importFiles(files) {
  if (!files.length || importing) return;
  importing = true; controls(); $('surveySummary').textContent = 'Reading survey CSVs…';
  try {
    const additional = [];
    for (const file of files) {
      if (file.size > 50 * 1024 * 1024) throw new Error(`${file.name} is larger than 50 MB. Split the survey log before importing.`);
      const rows = parseCSV(await file.text());
      if (importedRows.length + additional.length + rows.length > 300000) throw new Error('Import is limited to 300,000 raw log rows per page. Split large sessions first.');
      for (const row of rows) additional.push(row);
    }
    if (importedRows.length + additional.length > 300000) throw new Error('Import is limited to 300,000 raw log rows per page. Split large sessions first.');
    const nextRows = [...importedRows, ...additional];
    const result = importSurvey(nextRows, S.buildings);
    importedRows = nextRows; imported = result.samples;
    importInfo = `${result.skipped} invalid/unlabeled/discarded scans skipped; ${result.simulatorRows} simulator scans excluded.`;
    $('surveySource').value = 'survey'; refreshData();
  } catch (error) { $('surveySummary').textContent = `Import failed: ${error.message}`; }
  finally { importing = false; $('csvFiles').value = ''; controls(); }
}

async function init() {
  if (!await api.ready) throw new Error('Building metadata failed to load. Serve this folder over HTTP.');
  try {
    view = new BuildingView($('modelCanvas'), $('floorLabels'), (floor, p) => { if (!S.collecting && !S.locating) { api.setFloor(floor, true); api.setPoint(p.x, p.y); } }, message => { modelMessage = message; status(); }, chooseRoom);
  } catch (error) {
    $('graphicsNotice').textContent = `3D requires WebGL 2: ${error.message}. The 2D survey, data import, and position estimation remain available.`;
    $('graphicsNotice').hidden = false;
    $('view3d').disabled = true; selectView('2d');
  }
  $('view3d').onclick = () => selectView('3d'); $('view2d').onclick = () => selectView('2d');
  $('cameraIso').onclick = () => view?.fit(); $('cameraTop').onclick = () => { $('isolateFloor').checked = true; options(); view?.fit(true); }; $('cameraFit').onclick = () => view?.fit();
  $('btnDemo').onclick = () => { $('surveySource').value = 'demo'; refreshData(); if (view) selectView('3d'); };
  $('surveySource').onchange = () => refreshData();
  $('btnImport').onclick = () => $('csvFiles').click();
  $('csvFiles').onchange = event => importFiles([...event.target.files]);
  $('btnClearImport').onclick = () => { imported = []; importedRows = []; importInfo = ''; refreshData(); };
  for (const id of ['signalSelect', 'showHeat', 'showPoints', 'isolateFloor', 'floorSpacing', 'showWalls', 'showRooms', 'showPlans', 'wallHeight']) $(id).onchange = options;
  $('floorSeparation').oninput = options;
  $('modelRoom').onchange = () => chooseRoom(modelFloor?.rooms.find(r => r.id === $('modelRoom').value) || null);
  $('btnFocusRoom').onclick = () => { if (selectedRoom) { $('isolateFloor').checked = true; options(); selectView('3d'); view?.focusRoom(selectedRoom); } };
  $('btnRoomPoint').onclick = () => {
    if (!selectedRoom || S.collecting || S.locating || estimating || importing) return;
    const floor = S.buildings[S.building].floors.find(f => f.id === S.floor);
    const p = fromFrame(floor, ...selectedRoom.center);
    if (!p) return;
    api.setPoint(p.x, p.y);
    if (selectedRoom.label_source === 'plan-ocr' && !selectedRoom.label.includes(' / ')) $('room').value = selectedRoom.label;
    else $('room').value = '';
    $('room').dispatchEvent(new Event('input', { bubbles: true }));
  };
  $('btnExportModel').onclick = () => {
    if (!architecture) return;
    const text = exportArchitectureOBJ(architecture, S.buildings[S.building], { wallHeight: Number($('wallHeight').value), spacing: Number($('floorSpacing').value) });
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' })), link = document.createElement('a');
    link.href = url; link.download = `${S.building}-rooms-walls.obj`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
  };
  $('btnEstimate').onclick = () => runEstimate(); $('btnEstimateJson').onclick = () => runEstimate(true);
  $('btnFocusEstimate').onclick = () => {
    if (!estimate?.ok || S.collecting || S.locating) return;
    api.setFloor(estimate.floor); if (view) selectView('3d'); $('isolateFloor').checked = true; options(); view?.fit(true);
  };
  window.addEventListener('bevotag:change', event => {
    syncBuilding();
    if (event.detail.kind === 'dataset' && S.floor) refreshData();
  });
  window.addEventListener('pagehide', () => view?.destroy(), { once: true });
  syncBuilding();
  // Read-only diagnostics used by browser regression tests.
  window.BevoTagStudio = { get points() { return points; }, get estimate() { return estimate; }, get view() { return currentView; }, get renderedFloors() { return view?.floorGroups.size || 0; }, get architecture() { return architecture; }, get selectedRoom() { return selectedRoom; } };
}

init().catch(error => { $('modelStatus').textContent = error.message; $('estimateResult').textContent = error.message; });

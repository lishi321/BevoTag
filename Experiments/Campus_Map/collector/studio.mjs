import { BuildingView } from './model-view.mjs';
import { parseCSV, importSurvey, surveyPoints, estimatePosition, demoSurvey, demoScan, toFrame } from './signal-model.mjs';

const $ = id => document.getElementById(id);
const api = window.BevoTag, S = api.S;
let view, buildingId, points = [], importedRows = [], imported = [], estimate = null, estimating = false;
let modelMessage = '', demo = [], importInfo = '', currentView = '3d', importing = false;

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
    modelMessage = 'Loading registered floor plans…';
    view?.setBuilding(building, S.floor).catch(error => { modelMessage = `3D model failed: ${error.message}. Use 2D survey.`; status(); });
    refreshData();
  }
  $('sceneTitle').textContent = `${building.id} / Level ${S.floor}`;
  $('sceneSubtitle').textContent = `${building.floors.length} registered levels · approximate heights`;
  view?.setFloor(S.floor, S.point);
  controls();
}

function options() {
  const spacing = Math.max(6, Math.min(40, Number($('floorSpacing').value) || 14));
  const separation = Number($('floorSeparation').value);
  $('floorSpacing').value = spacing; $('separationValue').value = `${separation}×`;
  view?.setOptions({ spacing, separation, bssid: $('signalSelect').value, heat: $('showHeat').checked, points: $('showPoints').checked, isolate: $('isolateFloor').checked });
}

function renderEstimate(result, source) {
  estimate = result; view?.setEstimate(result);
  const output = $('estimateResult'); output.replaceChildren();
  $('btnFocusEstimate').hidden = !result.ok;
  if (!result.ok) { output.textContent = result.reason; return; }
  const title = document.createElement('strong'); title.textContent = `${S.building} · Level ${result.floor}`; output.appendChild(title);
  const position = document.createElement('div'); position.textContent = `Building frame: ${result.x.toFixed(1)}, ${result.y.toFixed(1)} ft`; output.appendChild(position);
  const room = document.createElement('div'); room.textContent = `Nearest survey label: ${result.room || 'unlabeled'}`; output.appendChild(room);
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
      const pixel = S.point || { x: x0 + (x1 - x0) * 0.47, y: y0 + (y1 - y0) * 0.51 };
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
    view = new BuildingView($('modelCanvas'), $('floorLabels'), (floor, p) => { if (!S.collecting && !S.locating) { api.setFloor(floor, true); api.setPoint(p.x, p.y); } }, message => { modelMessage = message; status(); });
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
  for (const id of ['signalSelect', 'showHeat', 'showPoints', 'isolateFloor', 'floorSpacing']) $(id).onchange = options;
  $('floorSeparation').oninput = options;
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
  window.BevoTagStudio = { get points() { return points; }, get estimate() { return estimate; }, get view() { return currentView; }, get renderedFloors() { return view?.floorGroups.size || 0; } };
}

init().catch(error => { $('modelStatus').textContent = error.message; $('estimateResult').textContent = error.message; });

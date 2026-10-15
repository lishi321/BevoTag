/* BevoTag survey collector
 * Plain script (no build step, no modules). Serve it over http (see README): buildings are loaded with fetch.
 * Buildings: buildings/index.json lists ids; each buildings/<ID>/building.json holds that building's
 * plans, floors and coordinate frame. Adding a building needs no code changes.
 * Serial protocol: see PROTOCOL.md
 * Storage: CSV only. Every serial line in either direction becomes one row of the CSV log file,
 * tagged with the current location; nothing is filtered by message type (see README).
 */
'use strict';

// ---------------------------------------------------------------- config
const SCAN_TIMEOUT_MS = 20000;
const FLUSH_MS = 2000;      // how often buffered rows are committed to the CSV file
const CSV_HEAD = ['host_time', 'session', 'building', 'floor', 'room', 'x_px', 'y_px', 'x_ft', 'y_ft', 'fx_ft', 'fy_ft',
  'operator', 'note', 'collecting', 'batch', 'dir', 'type', 'line'];
const ACCENT = '#bf5700', SAMPLE_COLOR = '#2563eb';   // map is always light, so fixed colors

// ---------------------------------------------------------------- state
const S = {
  buildings: {},          // id -> building.json
  building: null,         // current building id
  floor: null,
  point: null,            // {x, y} in image px
  samples: [],            // scans collected since the page opened (display only: the CSV file is the record)
  label: null,            // location frozen for the point being collected
  view: { s: 0.2, tx: 0, ty: 0 },
  needFit: false,         // a fit was requested while the viewport had no size (hidden tab etc.)
  img: { w: 1, h: 1 },
  mode: 'none',           // 'none' | 'serial' | 'sim'
  device: null,           // hello info
  collecting: false,
  stop: false,
  waiter: null,
  session: new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '') + '-' + Math.random().toString(36).slice(2, 6),
};

const $ = id => document.getElementById(id);
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() :
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16);
  }));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const prefs = {
  get(k, d) { try { const v = localStorage.getItem('bevotag.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('bevotag.' + k, JSON.stringify(v)); } catch { /* ignore */ } },
};

// ---------------------------------------------------------------- buildings
const bld = (id = S.building) => S.buildings[id];
const floorsOf = (id = S.building) => bld(id)?.floors || [];
const floorCfg = (fid = S.floor, bid = S.building) => floorsOf(bid).find(f => f.id === fid);
// every building's plans are at a true drawing scale; this converts image px to feet on the sheet.
// A floor can override the building's ft_per_in when its sheet is drawn at a different scale.
const ftPerPx = (fid = S.floor, bid = S.building) =>
  (floorCfg(fid, bid)?.ft_per_in ?? bld(bid).plan.ft_per_in) / bld(bid).plan.dpi;
const floorImg = (fid = S.floor, bid = S.building) => `buildings/${bid}/${floorCfg(fid, bid).image}`;

// Building frame: shared across a building's floors, y up. Floors with to_frame = null aren't
// registered yet. Computed at export time from the current config, so fixing a registration
// later also fixes old samples.
function toFrame(x) {
  const m = floorCfg(x.floor, x.building)?.to_frame;
  if (!m) return null;
  const [a, b, c, d, e, f] = m;
  return { x: +(a * x.x_px + b * x.y_px + c).toFixed(2), y: +(d * x.x_px + e * x.y_px + f).toFixed(2) };
}

async function loadBuildings() {
  const get = async url => { const r = await fetch(url); if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return r.json(); };
  const ids = await get('buildings/index.json');
  for (const id of ids) S.buildings[id] = await get(`buildings/${id}/building.json`);
}

function toast(msg, ms = 2200) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), ms);
}

// ---------------------------------------------------------------- log
function log(text, cls = 'sys') {
  const el = $('log');
  const line = document.createElement('div');
  line.className = cls;
  const ts = new Date().toLocaleTimeString([], { hour12: false });
  line.textContent = `${ts} ${cls === 'in' ? '←' : cls === 'outl' ? '→' : '·'} ${text.length > 400 ? text.slice(0, 400) + ' …' : text}`;
  el.appendChild(line);
  while (el.childNodes.length > 500) el.removeChild(el.firstChild);
  el.scrollTop = el.scrollHeight;
}

// ---------------------------------------------------------------- storage: CSV log file
const csvq = v => { const t = String(v ?? ''); return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };

// location the next row is tagged with: frozen while collecting, otherwise whatever is selected now
function currentLabel() {
  if (S.label) return S.label;
  const p = S.point;
  return {
    building: S.building, floor: S.floor, room: $('room').value.trim(),
    x_px: p?.x ?? null, y_px: p?.y ?? null,
    x_ft: p ? +(p.x * ftPerPx()).toFixed(2) : null, y_ft: p ? +(p.y * ftPerPx()).toFixed(2) : null,
    note: $('note').value.trim(), operator: $('operator').value.trim(), batch: null,
  };
}

const RawLog = {
  handle: null,   // file picked with showSaveFilePicker (Chrome/Edge); rows are appended every FLUSH_MS
  mem: null,      // fallback without the File System Access API: rows kept in memory, downloaded on stop
  buf: [], rows: 0, name: '', timer: null, chain: Promise.resolve(), failed: false,
  on() { return !!(this.handle || this.mem); },
  async start() {
    const name = `bevotag_${S.session}.csv`;
    if (window.showSaveFilePicker) {
      let handle;
      try {
        handle = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: 'CSV', accept: { 'text/csv': ['.csv'] } }] });
        const w = await handle.createWritable();       // truncates an existing file
        await w.write(CSV_HEAD.join(',') + '\n'); await w.close();
      } catch (e) { if (e.name !== 'AbortError') toast('Could not create the file: ' + e.message, 4000); return; }
      this.handle = handle; this.name = handle.name;
    } else {
      this.mem = [CSV_HEAD.join(',')]; this.name = name;
      toast('This browser can\'t write files directly: the CSV downloads when you stop logging', 5000);
    }
    this.buf = []; this.rows = 0; this.failed = false;
    this.timer = setInterval(() => { this.flush(); renderLogState(); }, FLUSH_MS);
    log(`CSV log started: ${this.name}`);
    renderLogState();
  },
  // dir: 'in' device -> laptop, 'out' laptop -> device, 'app' a note from the app itself (e.g. discard)
  add(dir, line, type = '', batch) {
    if (!this.on()) return;
    const L = currentLabel();
    const fr = L.x_px == null ? null : toFrame(L);
    const row = [new Date().toISOString(), S.session, L.building, L.floor, L.room, L.x_px, L.y_px, L.x_ft, L.y_ft,
      fr?.x, fr?.y, L.operator, L.note, S.collecting ? 1 : 0, batch ?? L.batch, dir, type, line].map(csvq).join(',');
    (this.mem || this.buf).push(row);
    this.rows++;
    if (this.rows % 50 === 0) renderLogState();
  },
  flush() { this.chain = this.chain.then(() => this.write()); return this.chain; },
  async write() {
    if (!this.handle || !this.buf.length) return;
    const rows = this.buf; this.buf = [];
    try {
      // keepExistingData + seek to the end appends; close() commits, so a crash loses at most FLUSH_MS of rows
      const size = (await this.handle.getFile()).size;
      const w = await this.handle.createWritable({ keepExistingData: true });
      await w.seek(size); await w.write(rows.join('\n') + '\n'); await w.close();
      if (this.failed) { this.failed = false; renderLogState(); }
    } catch (e) {
      this.buf = rows.concat(this.buf);              // keep them for the next try
      if (!this.failed) { log('CSV write failed: ' + e, 'errl'); toast('Writing the CSV failed, retrying: ' + e.message, 4000); }
      this.failed = true; renderLogState();
    }
  },
  async stop() {
    clearInterval(this.timer); this.timer = null;
    await this.flush();
    if (this.mem) download(this.name, this.mem.join('\n') + '\n', 'text/csv');
    if (this.handle && this.buf.length) toast(`${this.buf.length} rows could not be written to ${this.name}`, 6000);
    log(`CSV log stopped: ${this.rows} rows in ${this.name}`);
    this.handle = null; this.mem = null; this.buf = [];
    renderLogState(); updateCollectState();
  },
};

function renderLogState() {
  const b = $('btnRawLog'), m = $('rawLogMsg'), on = RawLog.on();
  b.textContent = on ? 'Stop CSV log' : 'Start CSV log…';
  b.classList.toggle('on', on);
  m.classList.toggle('on', on && !RawLog.failed);
  m.textContent = !on ? 'Pick a CSV file to log to. Every line the device sends is saved there.'
    : RawLog.failed ? `Write to ${RawLog.name} failed, retrying (${RawLog.buf.length} rows waiting)`
    : `Logging to ${RawLog.name} · ${RawLog.rows} rows${RawLog.mem ? ' (downloads on stop)' : ''}`;
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------- map view
const vp = $('viewport'), stage = $('stage'), img = $('planImg'), svg = $('overlay');
const SVGNS = 'http://www.w3.org/2000/svg';

function applyView() {
  const { s, tx, ty } = S.view;
  stage.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
  renderOverlay();
  renderScaleBar();
}
function renderScaleBar() {
  // pick a round length that draws as roughly 60-150 screen px
  if (!S.building) return;
  const ftPerScreenPx = ftPerPx() / S.view.s;
  const ft = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500].find(n => n / ftPerScreenPx >= 60) || 500;
  $('scalebarLine').style.width = (ft / ftPerScreenPx) + 'px';
  $('scalebarText').textContent = `${ft} ft`;
}
function fitView() {
  const r = vp.getBoundingClientRect();
  if (!r.width || !r.height) { S.needFit = true; return; }   // retried by the ResizeObserver
  S.needFit = false;
  // fit: the drawing's bounding box on the sheet image [x0, y0, x1, y1], so "fit" skips blank margins
  const [x0, y0, x1, y1] = floorCfg()?.fit || [0, 0, S.img.w, S.img.h];
  const s = Math.min(r.width / (x1 - x0), r.height / (y1 - y0)) * 0.95;
  S.view = { s, tx: r.width / 2 - (x0 + x1) / 2 * s, ty: r.height / 2 - (y0 + y1) / 2 * s };
  applyView();
}
function zoomAt(factor, cx, cy) {
  const v = S.view;
  const s = Math.min(4, Math.max(0.05, v.s * factor));
  const k = s / v.s;
  S.view = { s, tx: cx - (cx - v.tx) * k, ty: cy - (cy - v.ty) * k };
  applyView();
}
function centerOn(x, y, s) {
  const r = vp.getBoundingClientRect();
  s = s || Math.max(S.view.s, 0.6);
  S.view = { s, tx: r.width / 2 - x * s, ty: r.height / 2 - y * s };
  applyView();
}

function setBuilding(bid) {
  if (S.collecting) { toast('Stop collecting before switching buildings'); return false; }
  if (!bld(bid)) { toast(`Unknown building "${bid}"`); return false; }
  if (bid === S.building) return true;
  S.building = bid; S.floor = null; S.point = null; prefs.set('building', bid);
  $('building').value = bid;
  $('floorTabs').innerHTML = floorsOf().map(f => `<button data-id="${esc(f.id)}" title="${esc(f.name)} floor">${esc(f.id)}</button>`).join('');
  refreshDataset();
  return true;
}

// bid: switch building first (e.g. jumping to a room from the dataset table)
function setFloor(id, keepView = false, bid = S.building) {
  if (S.collecting) { toast('Stop collecting before switching floors'); return; }
  if (!setBuilding(bid)) return;
  if (!floorCfg(id)) { toast(`Unknown floor "${id}" in ${bid}`); return; }
  const changed = id !== S.floor;
  S.floor = id; prefs.set('floor.' + bid, id);
  if (changed) S.point = null;
  document.querySelectorAll('#floorTabs button').forEach(b => b.classList.toggle('active', b.dataset.id === id));
  $('floorOut').value = `${bid} ${id} (${floorCfg(id).name})`;
  const src = floorImg(id);
  if (img.getAttribute('src') !== src) {
    img.onload = () => {
      S.img = { w: img.naturalWidth, h: img.naturalHeight };
      svg.setAttribute('width', S.img.w); svg.setAttribute('height', S.img.h);
      svg.setAttribute('viewBox', `0 0 ${S.img.w} ${S.img.h}`);
      if (!keepView) fitView(); else applyView();
    };
    img.onerror = () => toast(`Missing ${src}. Run make_floors.py ${bid} (see README)`, 5000);
    img.src = src;
  } else applyView();
  updatePointUI();
}

function renderOverlay() {
  const s = S.view.s;
  const px = n => n / s;                // screen px -> image px
  svg.innerHTML = '';
  // collected points on this floor, grouped by position
  const groups = new Map();
  for (const x of S.samples) {
    if (x.building !== S.building || x.floor !== S.floor) continue;
    const k = x.x_px + ',' + x.y_px;
    const g = groups.get(k) || { x: x.x_px, y: x.y_px, n: 0, room: x.room };
    g.n++; groups.set(k, g);
  }
  for (const g of groups.values()) {
    const c = document.createElementNS(SVGNS, 'circle');
    c.setAttribute('cx', g.x); c.setAttribute('cy', g.y); c.setAttribute('r', px(5 + Math.min(4, Math.sqrt(g.n))));
    c.setAttribute('fill', SAMPLE_COLOR); c.setAttribute('fill-opacity', '0.55');
    c.setAttribute('stroke', '#fff'); c.setAttribute('stroke-width', px(1.5));
    svg.appendChild(c);
    if (s > 0.35) {
      const t = document.createElementNS(SVGNS, 'text');
      t.setAttribute('x', g.x + px(9)); t.setAttribute('y', g.y - px(7));
      t.setAttribute('font-size', px(11)); t.setAttribute('fill', SAMPLE_COLOR); t.setAttribute('font-family', 'system-ui');
      t.setAttribute('paint-order', 'stroke'); t.setAttribute('stroke', '#fff'); t.setAttribute('stroke-width', px(3));
      t.textContent = `${g.room} ×${g.n}`;
      svg.appendChild(t);
    }
  }
  // current point
  if (S.point) {
    const { x, y } = S.point;
    const g = document.createElementNS(SVGNS, 'g');
    g.innerHTML =
      `<circle cx="${x}" cy="${y}" r="${px(14)}" fill="none" stroke="${ACCENT}" stroke-width="${px(3)}"/>` +
      `<circle cx="${x}" cy="${y}" r="${px(3)}" fill="${ACCENT}"/>` +
      `<line x1="${x - px(22)}" y1="${y}" x2="${x - px(8)}" y2="${y}" stroke="${ACCENT}" stroke-width="${px(2)}"/>` +
      `<line x1="${x + px(8)}" y1="${y}" x2="${x + px(22)}" y2="${y}" stroke="${ACCENT}" stroke-width="${px(2)}"/>` +
      `<line x1="${x}" y1="${y - px(22)}" x2="${x}" y2="${y - px(8)}" stroke="${ACCENT}" stroke-width="${px(2)}"/>` +
      `<line x1="${x}" y1="${y + px(8)}" x2="${x}" y2="${y + px(22)}" stroke="${ACCENT}" stroke-width="${px(2)}"/>`;
    if (S.collecting) {
      const pulse = document.createElementNS(SVGNS, 'circle');
      pulse.setAttribute('cx', x); pulse.setAttribute('cy', y); pulse.setAttribute('fill', 'none');
      pulse.setAttribute('stroke', ACCENT); pulse.setAttribute('stroke-width', px(2));
      pulse.innerHTML = `<animate attributeName="r" from="${px(14)}" to="${px(40)}" dur="1.2s" repeatCount="indefinite"/>` +
        `<animate attributeName="opacity" from="1" to="0" dur="1.2s" repeatCount="indefinite"/>`;
      g.appendChild(pulse);
    }
    svg.appendChild(g);
  }
}

// pan / zoom / click
(function wirePointer() {
  let down = null;
  const pointers = new Map();
  vp.addEventListener('pointerdown', e => {
    if (e.target.closest('.zoomctl')) return;
    vp.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    down = { x: e.clientX, y: e.clientY, tx: S.view.tx, ty: S.view.ty, moved: false, pinch: pointers.size > 1 };
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      down.dist = Math.hypot(a.x - b.x, a.y - b.y); down.s = S.view.s;
    }
  });
  vp.addEventListener('pointermove', e => {
    if (!down || !pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2 && down.dist) {          // pinch zoom
      const [a, b] = [...pointers.values()];
      const r = vp.getBoundingClientRect();
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      zoomAt((down.s * d / down.dist) / S.view.s, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
      down.moved = true; return;
    }
    const dx = e.clientX - down.x, dy = e.clientY - down.y;
    if (!down.moved && Math.hypot(dx, dy) < 5) return;
    down.moved = true; vp.classList.add('dragging');
    S.view.tx = down.tx + dx; S.view.ty = down.ty + dy;
    applyView();
  });
  const end = e => {
    if (!down) return;
    pointers.delete(e.pointerId);
    vp.classList.remove('dragging');
    if (e.type === 'pointerup' && !down.moved && !down.pinch && pointers.size === 0) {
      const r = vp.getBoundingClientRect();
      const x = (e.clientX - r.left - S.view.tx) / S.view.s;
      const y = (e.clientY - r.top - S.view.ty) / S.view.s;
      if (x >= 0 && y >= 0 && x <= S.img.w && y <= S.img.h) setPoint(x, y);
    }
    if (pointers.size === 0) down = null;
  };
  vp.addEventListener('pointerup', end);
  vp.addEventListener('pointercancel', end);
  vp.addEventListener('wheel', e => {
    e.preventDefault();
    const r = vp.getBoundingClientRect();
    zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  $('zoomIn').onclick = () => { const r = vp.getBoundingClientRect(); zoomAt(1.4, r.width / 2, r.height / 2); };
  $('zoomOut').onclick = () => { const r = vp.getBoundingClientRect(); zoomAt(1 / 1.4, r.width / 2, r.height / 2); };
  $('zoomFit').onclick = fitView;
  new ResizeObserver(() => (S.needFit ? fitView() : applyView())).observe(vp);
})();

function setPoint(x, y) {
  if (S.collecting) { toast('Collecting… stop first to move the point'); return; }
  S.point = { x: Math.round(x), y: Math.round(y) };
  $('hint').style.display = 'none';
  updatePointUI(); renderOverlay();
  $('room').focus();
}
function updatePointUI() {
  const p = S.point;
  $('xOut').value = p ? (p.x * ftPerPx()).toFixed(1) : '';
  $('yOut').value = p ? (p.y * ftPerPx()).toFixed(1) : '';
  const fr = p && toFrame({ building: S.building, floor: S.floor, x_px: p.x, y_px: p.y });
  $('frameOut').textContent = !p ? '' : fr ? `Building frame: ${fr.x.toFixed(1)}, ${fr.y.toFixed(1)} ft`
    : 'This floor is not registered to the building frame yet.';
  updateCollectState();
}

// ---------------------------------------------------------------- device: Web Serial
const Serial = {
  port: null, reader: null, readDone: null, enc: new TextEncoder(),
  async connect() {
    if (!('serial' in navigator)) { toast('Web Serial needs desktop Chrome or Edge', 4000); return; }
    try {
      this.port = await navigator.serial.requestPort();
      await this.port.open({ baudRate: +$('baud').value, bufferSize: 1 << 16 });
    } catch (e) { if (e.name !== 'NotFoundError') { log('Open failed: ' + e, 'errl'); toast('Could not open port: ' + e.message, 4000); } this.port = null; return; }
    const info = this.port.getInfo();
    log(`Port opened (VID ${info.usbVendorId?.toString(16) ?? '?'} PID ${info.usbProductId?.toString(16) ?? '?'}) @ ${$('baud').value}`);
    setMode('serial');
    this.readLoop();
    setTimeout(() => this.connected() && send({ cmd: 'hello' }), 1500);
  },
  connected() { return !!this.port; },
  async readLoop() {
    const dec = new TextDecoderStream();
    this.readDone = this.port.readable.pipeTo(dec.writable).catch(() => {});
    this.reader = dec.readable.getReader();
    let buf = '';
    try {
      for (;;) {
        const { value, done } = await this.reader.read();
        if (done) break;
        buf += value;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1);
          if (line.trim()) onLine(line);
        }
        if (buf.length > 1 << 20) { log('Dropping 1 MB of unterminated input', 'errl'); buf = ''; }
      }
    } catch (e) { log('Read error: ' + e, 'errl'); }
    finally { try { this.reader.releaseLock(); } catch { /* */ } }
  },
  async write(text) {
    const w = this.port.writable.getWriter();
    try { await w.write(this.enc.encode(text + '\n')); } finally { w.releaseLock(); }
  },
  async disconnect() {
    const p = this.port; this.port = null;
    try { await this.reader?.cancel(); } catch { /* */ }
    try { await this.readDone; } catch { /* */ }
    try { await p?.close(); } catch { /* */ }
    log('Port closed');
  },
};
if ('serial' in navigator) {
  navigator.serial.addEventListener('disconnect', e => {
    if (e.target === Serial.port) { Serial.port = null; log('Device unplugged', 'errl'); toast('Device disconnected'); setMode('none'); }
  });
}

// ---------------------------------------------------------------- device: simulator
const Sim = {
  aps: {}, seq: 0, streamTimer: null, imuTimer: null,     // aps: building id -> fake APs
  // mimic a device that scans on its own when "Device streams scans" is ticked
  syncStream() {
    const on = S.mode === 'sim' && $('streamMode').checked;
    if (on && !this.streamTimer) this.streamTimer = setInterval(() => this.handle({ cmd: 'scan' }), 1500);
    if (!on && this.streamTimer) { clearInterval(this.streamTimer); this.streamTimer = null; }
    // fake IMU lines, so the CSV log has non-scan data to record. The format is made up: the real one is up to the firmware
    const imu = S.mode === 'sim';
    if (imu && !this.imuTimer) this.imuTimer = setInterval(() => this.emit({
      type: 'imu', ms: Math.round(performance.now()),
      ax: +(0.01 * this.gauss()).toFixed(3), ay: +(0.01 * this.gauss()).toFixed(3), az: +(1 + 0.01 * this.gauss()).toFixed(3),
      gx: +(0.2 * this.gauss()).toFixed(2), gy: +(0.2 * this.gauss()).toFixed(2), gz: +(0.2 * this.gauss()).toFixed(2),
      mx: +(0.22 + 0.005 * this.gauss()).toFixed(3), my: +(-0.05 + 0.005 * this.gauss()).toFixed(3), mz: +(0.41 + 0.005 * this.gauss()).toFixed(3),
    }), 100);
    if (!imu && this.imuTimer) { clearInterval(this.imuTimer); this.imuTimer = null; }
  },
  emit(msg) { if (S.mode === 'sim') onLine(JSON.stringify(msg)); },
  build(bid) {
    // deterministic fake APs per building: 24 per floor, 3 SSIDs each, inside each floor's fit box
    const bi = Object.keys(S.buildings).indexOf(bid);
    let seed = 12345 + bi;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const aps = [];
    floorsOf(bid).forEach((f, fi) => {
      const [x0, y0, x1, y1] = f.fit || [0, 0, 2750, 4250];
      for (let i = 0; i < 24; i++) {
        const x = x0 + (x1 - x0) * rnd(), y = y0 + (y1 - y0) * rnd();
        const base = [0x70, bi, fi, i].map(b => b.toString(16).padStart(2, '0')).join(':') + ':00';
        const ch = [1, 6, 11][Math.floor(rnd() * 3)];
        ['utexas', 'utexas-iot', 'eduroam'].forEach((ssid, k) =>
          aps.push({ fi, x, y, ch, ssid, bssid: `${base}:${(k + 1).toString(16).padStart(2, '0')}` }));
      }
    });
    return aps;
  },
  gauss() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); },
  handle(cmd) {
    if (cmd.cmd === 'hello') return setTimeout(() => this.emit({ type: 'hello', v: 1, fw: 'sim-0.1', chip: 'SIMULATOR', mac: 'de:ad:be:ef:00:01' }), 50);
    if (cmd.cmd !== 'scan') return;
    const all = (this.aps[S.building] ||= this.build(S.building));
    const fi = floorsOf().findIndex(f => f.id === S.floor);
    const p = S.point || { x: 1375, y: 2000 };
    const aps = [];
    for (const a of all) {
      const df = Math.abs(a.fi - fi); if (df > 1) continue;
      const dm = Math.max(1, Math.hypot(a.x - p.x, a.y - p.y) * ftPerPx() * 0.3048);
      const rssi = Math.round(-38 - 28 * Math.log10(dm) - 15 * df + 4 * this.gauss());
      if (rssi > -92) aps.push({ bssid: a.bssid, ssid: a.ssid, rssi, ch: a.ch });
    }
    aps.sort((a, b) => b.rssi - a.rssi);
    const dur = 700 + Math.round(Math.random() * 300);
    setTimeout(() => this.emit({ type: 'scan', v: 1, id: cmd.id, seq: ++this.seq, ms: Math.round(performance.now()), dur_ms: dur, aps }), dur);
  },
};

// ---------------------------------------------------------------- messaging
async function send(obj) {
  const text = typeof obj === 'string' ? obj : JSON.stringify(obj);
  log(text, 'outl');
  RawLog.add('out', text, jsonType(text));
  if (S.mode === 'serial') { try { await Serial.write(text); } catch (e) { log('Write failed: ' + e, 'errl'); } }
  else if (S.mode === 'sim') { try { Sim.handle(JSON.parse(text)); } catch { /* */ } }
  else toast('No device connected');
}
// "type" (or "cmd") of a JSON line, or '' for anything else. Only fills the CSV's type column; it never decides what's logged.
const msgType = m => (m && typeof m === 'object' ? String(m.type ?? m.cmd ?? '') : '');
function jsonType(line) {
  if (line[0] !== '{') return '';
  try { return msgType(JSON.parse(line)); } catch { return ''; }
}
// every line from the device: logged to the CSV as is, then handled if it's a message the app understands
function onLine(line) {
  log(line, 'in');
  let msg = null;
  if (line[0] === '{') { try { msg = JSON.parse(line); } catch { /* not JSON: logged as text */ } }
  RawLog.add('in', line, msgType(msg));
  if (msg && typeof msg === 'object') onMsg(msg);
}
function onMsg(msg) {
  if (msg.type === 'hello') {
    S.device = { mac: msg.mac ?? null, fw: msg.fw ?? null, chip: msg.chip ?? null, v: msg.v ?? null };
    setMode(S.mode);
  } else if (msg.type === 'scan') {
    const scan = normalizeScan(msg);
    if (!scan) return;
    showScan(scan);
    // a reply that arrives after its request timed out must not be saved as the next request's scan
    if (S.waiter && S.waiter.id != null && scan.id != null && +scan.id !== S.waiter.id) {
      log(`Late reply for scan ${scan.id} ignored (waiting for ${S.waiter.id})`, 'errl'); return;
    }
    if (S.waiter) { const w = S.waiter; S.waiter = null; clearTimeout(w.timer); w.resolve(scan); }
  } else if (msg.type === 'err') {
    toast('Device error: ' + msg.msg, 3500);
    if (S.waiter) { const w = S.waiter; S.waiter = null; clearTimeout(w.timer); w.reject(new Error(msg.msg)); }
  }
}
function normalizeScan(m) {
  if (!Array.isArray(m.aps)) { log('scan without aps[] (ignored)', 'errl'); return null; }
  const aps = [];
  for (const a of m.aps) {
    if (!a || typeof a.bssid !== 'string' || !Number.isFinite(+a.rssi)) continue;
    aps.push({ bssid: a.bssid.toLowerCase(), ssid: a.ssid ?? '', rssi: Math.round(+a.rssi), ch: a.ch ?? null });
  }
  return { id: m.id ?? null, seq: m.seq ?? null, ms: m.ms ?? null, dur_ms: m.dur_ms ?? null, aps };
}
function waitScan(ms, id = null) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { S.waiter = null; reject(new Error('timeout')); }, ms);
    S.waiter = { resolve, reject, timer, id };
  });
}

function setMode(mode) {
  S.mode = mode;
  if (mode === 'none') {
    S.device = null;
    if (S.waiter) { const w = S.waiter; S.waiter = null; clearTimeout(w.timer); w.reject(new Error('device disconnected')); }
  }
  const dot = $('connDot'), txt = $('connText'), bc = $('btnConnect'), bs = $('btnSim');
  dot.className = 'dot ' + (mode === 'serial' ? 'on' : mode === 'sim' ? 'sim' : 'off');
  const dev = S.device ? ` · ${S.device.chip || ''} ${S.device.mac || ''} ${S.device.fw ? 'fw ' + S.device.fw : ''}` : '';
  txt.textContent = mode === 'serial' ? 'ESP32 connected' + dev : mode === 'sim' ? 'Simulator' + dev : 'Not connected';
  bc.textContent = mode === 'serial' ? 'Disconnect' : 'Connect ESP32';
  bc.disabled = mode === 'sim';
  bs.textContent = mode === 'sim' ? 'Stop simulator' : 'Simulator';
  bs.disabled = mode === 'serial';
  Sim.syncStream();
  updateCollectState();
}

// ---------------------------------------------------------------- collection
function updateCollectState() {
  const b = $('btnCollect'), m = $('collectMsg');
  if (S.collecting) { b.disabled = false; b.textContent = 'Stop'; return; }
  b.textContent = 'Collect';
  const room = $('room').value.trim();
  const why = !RawLog.on() ? 'Start the CSV log first.'
    : S.mode === 'none' ? 'Connect a device (or start the simulator).'
    : !S.point ? 'Click the map where the DAQ module is.'
    : !room ? 'Enter the room number.' : '';
  b.disabled = !!why;
  m.textContent = why || `Ready: ${$('nScans').value} scans at ${S.building} ${S.floor} · ${room}.`;
}

async function collect() {
  if (S.collecting) { S.stop = true; $('collectMsg').textContent = 'Stopping after current scan…'; return; }
  const n = Math.max(1, Math.min(100, parseInt($('nScans').value, 10) || 1));
  const stream = $('streamMode').checked;
  const batch = uuid();
  const label = { ...currentLabel(), batch };   // x_px/y_px: raw click on the floor image; everything else derives from these
  S.label = label;
  S.collecting = true; S.stop = false; updateCollectState(); renderOverlay();
  let ok = 0, fails = 0, cmdId = Date.now() % 1e6;
  const bar = $('progBar'); bar.style.width = '0%';
  while (ok < n && !S.stop && S.mode !== 'none') {
    $('collectMsg').textContent = `Scan ${ok + 1} / ${n}…`;
    try {
      const id = stream ? null : ++cmdId;
      const wait = waitScan(SCAN_TIMEOUT_MS, id);
      if (!stream) await send({ cmd: 'scan', id });
      const scan = await wait;
      S.samples.push({ ...label, t: new Date().toISOString(), scan });   // the scan itself is already in the CSV
      ok++; fails = 0;
      bar.style.width = (100 * ok / n) + '%';
      refreshDataset();
    } catch (e) {
      fails++;
      log(`Scan failed (${e.message}), ${fails}/3`, 'errl');
      if (fails >= 3) { toast('3 scans in a row failed: stopping', 4000); break; }
    }
  }
  S.collecting = false; S.waiter = null; S.label = null;
  updateCollectState(); renderOverlay();
  $('collectMsg').textContent = `Logged ${ok} scan${ok === 1 ? '' : 's'} for ${label.room} (${label.building} floor ${label.floor}). Click the next point.`;
  if (ok) toast(`Logged ${ok} × ${label.room}`);
  setTimeout(() => { if (!S.collecting) bar.style.width = '0%'; }, 1500);
}

function showScan(scan) {
  $('lastMeta').textContent = `${scan.aps.length} APs${scan.dur_ms ? ' · ' + scan.dur_ms + ' ms' : ''} · ${new Date().toLocaleTimeString([], { hour12: false })}`;
  const rows = [...scan.aps].sort((a, b) => b.rssi - a.rssi).map(a =>
    `<tr><td><span class="rssi">${a.rssi}</span><span class="bar" style="width:${Math.max(2, (a.rssi + 100) * 1.1)}px"></span></td>` +
    `<td>${esc(a.ssid) || '<span class="muted">(hidden)</span>'}</td><td class="mono">${esc(a.bssid)}</td><td>${a.ch ?? ''}</td></tr>`).join('');
  $('apTable').tBodies[0].innerHTML = rows || '<tr><td colspan="4" class="muted">No APs heard</td></tr>';
}

// ---------------------------------------------------------------- dataset UI
function refreshDataset() {
  const byRoom = new Map(), bssids = new Set(), points = new Set();
  let apSum = 0;
  for (const x of S.samples) {
    const k = x.building + '|' + x.floor + '|' + x.room;
    const g = byRoom.get(k) || { building: x.building, floor: x.floor, room: x.room, n: 0, sx: 0, sy: 0 };
    g.n++; g.sx += x.x_px; g.sy += x.y_px; byRoom.set(k, g);
    points.add(x.batch);
    for (const a of x.scan.aps) bssids.add(a.bssid);
    apSum += x.scan.aps.length;
  }
  $('stats').innerHTML =
    `<div><b>${S.samples.length}</b><span>scans</span></div>` +
    `<div><b>${points.size}</b><span>points</span></div>` +
    `<div><b>${byRoom.size}</b><span>rooms</span></div>` +
    `<div><b>${bssids.size}</b><span>BSSIDs</span></div>`;
  const order = g => floorsOf(g.building).findIndex(f => f.id === g.floor);
  const groups = [...byRoom.values()].sort((a, b) => a.building.localeCompare(b.building) || order(a) - order(b) ||
    a.room.localeCompare(b.room, undefined, { numeric: true }));
  $('roomTable').tBodies[0].innerHTML = groups.map(g =>
    `<tr class="clickable" data-building="${esc(g.building)}" data-floor="${esc(g.floor)}" data-room="${esc(g.room)}" data-x="${g.sx / g.n}" data-y="${g.sy / g.n}">` +
    `<td>${esc(g.building)} ${esc(g.floor)}</td><td>${esc(g.room)}</td><td>${g.n}</td></tr>`).join('') ||
    '<tr><td colspan="3" class="muted">No scans yet</td></tr>';
  const here = S.samples.filter(x => x.building === S.building);
  $('roomList').innerHTML = [...new Set(here.map(x => x.room))].map(r => `<option value="${esc(r)}">`).join('');
  // floor tab counts (current building)
  const perFloor = {};
  for (const x of here) perFloor[x.floor] = (perFloor[x.floor] || 0) + 1;
  document.querySelectorAll('#floorTabs button').forEach(b => {
    const c = perFloor[b.dataset.id];
    b.innerHTML = esc(b.dataset.id) + (c ? `<span class="cnt">${c}</span>` : '');
  });
  $('btnDiscard').disabled = !S.samples.length;
  renderOverlay();
}

$('roomTable').addEventListener('click', e => {
  const tr = e.target.closest('tr[data-room]'); if (!tr) return;
  const { building, floor, room } = tr.dataset;
  if (S.collecting) return;
  setFloor(floor, true, building);
  $('room').value = room; updateCollectState();
  const go = () => centerOn(+tr.dataset.x, +tr.dataset.y);
  img.complete ? go() : img.addEventListener('load', go, { once: true });
});

// the CSV is append-only, so "undo" writes a discard row carrying the last point's batch id; drop that batch in analysis
function discardLast() {
  if (!S.samples.length || S.collecting) return;
  const last = S.samples.reduce((a, b) => (a.t > b.t ? a : b));
  const n = S.samples.filter(x => x.batch === last.batch).length;
  if (!RawLog.on()) return toast('Start the CSV log first: the discard row goes into it');
  if (!confirm(`Discard the last point (${n} scans in ${last.room}, ${last.building} floor ${last.floor})?\n` +
    'Its rows stay in the CSV, plus a discard row with its batch id to filter them out.')) return;
  RawLog.add('app', JSON.stringify({ type: 'discard', batch: last.batch }), 'discard', last.batch);
  S.samples = S.samples.filter(x => x.batch !== last.batch);
  refreshDataset(); toast('Discarded last point');
}

// ---------------------------------------------------------------- wiring
function init() {
  $('building').innerHTML = Object.values(S.buildings).map(b => `<option value="${esc(b.id)}" title="${esc(b.name)}">${esc(b.id)}</option>`).join('');
  $('building').onchange = e => { if (setBuilding(e.target.value)) openFloor(); else e.target.value = S.building; };
  $('floorTabs').onclick = e => { const b = e.target.closest('button'); if (b) setFloor(b.dataset.id); };

  $('btnConnect').onclick = async () => {
    if (S.mode === 'serial') { await Serial.disconnect(); setMode('none'); } else await Serial.connect();
  };
  $('btnSim').onclick = () => {
    if (S.mode === 'sim') { setMode('none'); log('Simulator stopped'); return; }
    setMode('sim'); log('Simulator started'); send({ cmd: 'hello' });
  };
  $('btnCollect').onclick = collect;
  $('room').addEventListener('input', updateCollectState);
  $('room').addEventListener('keydown', e => { if (e.key === 'Enter' && !S.collecting && !$('btnCollect').disabled) collect(); });
  $('nScans').addEventListener('input', () => { prefs.set('nScans', $('nScans').value); updateCollectState(); });
  $('streamMode').addEventListener('change', () => { prefs.set('stream', $('streamMode').checked); Sim.syncStream(); });
  $('operator').addEventListener('input', () => prefs.set('operator', $('operator').value));
  $('baud').addEventListener('change', () => prefs.set('baud', $('baud').value));
  $('btnDiscard').onclick = discardLast;
  $('btnRawLog').onclick = async () => {
    if (!RawLog.on()) { await RawLog.start(); updateCollectState(); return; }
    if (S.collecting) return toast('Stop collecting before stopping the log');
    await RawLog.stop();
  };
  $('btnSend').onclick = () => { const t = $('rawCmd').value.trim(); if (t) send(t); };
  $('rawCmd').addEventListener('keydown', e => { if (e.key === 'Enter') $('btnSend').click(); });
  window.addEventListener('beforeunload', e => {
    if (S.collecting || RawLog.on()) { RawLog.flush(); e.preventDefault(); e.returnValue = ''; }
  });

  $('operator').value = prefs.get('operator', '');
  $('nScans').value = prefs.get('nScans', '5');
  $('streamMode').checked = prefs.get('stream', false);
  $('baud').value = prefs.get('baud', '115200');
  if (!('serial' in navigator)) log('Web Serial not available in this browser. Use desktop Chrome/Edge (simulator still works).', 'errl');
  log(`Session ${S.session}`);
}

// open the remembered floor of the current building, else its default
function openFloor() {
  const f = prefs.get('floor.' + S.building, null);
  setFloor(floorCfg(f) ? f : (bld().default_floor || floorsOf()[0].id));
}

(async () => {
  try { await loadBuildings(); } catch (e) {
    toast('Could not load buildings. Serve this folder over http (see README).', 8000);
    log('Loading buildings failed: ' + e, 'errl'); return;
  }
  init();
  setMode('none');
  renderLogState();
  const b = prefs.get('building', null);
  setBuilding(bld(b) ? b : Object.keys(S.buildings)[0]);
  openFloor();
})();

// exposed for debugging / automated tests
window.BevoTag = { S, Sim, RawLog, setPoint, setFloor, setBuilding, toFrame, collect, onLine };

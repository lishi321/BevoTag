/* BevoTag EER survey collector
 * Plain script (no build step, no modules) so it also runs from file://.
 * Serial protocol: see PROTOCOL.md
 */
'use strict';

// ---------------------------------------------------------------- config
const BUILDING = 'EER';
// fit: drawing bounding box on the 250-dpi sheet [x0, y0, x1, y1] so "fit" skips the blank margins
const FLOORS = [
  { id: 'B', name: 'Basement', fit: [240, 290, 2469, 3789] },
  { id: '1', name: 'First', fit: [240, 295, 2469, 3771] },
  { id: '2', name: 'Second', fit: [240, 290, 2447, 3789] },
  { id: '3', name: 'Third', fit: [361, 1653, 2448, 3419] },
  { id: '4', name: 'Fourth', fit: [300, 1153, 2387, 2913] },
  { id: '5', name: 'Fifth', fit: [300, 1153, 2387, 2913] },
  { id: '6', name: 'Sixth', fit: [300, 1153, 2387, 2913] },
  { id: '7', name: 'Seventh', fit: [300, 1153, 2387, 2913] },
  { id: '8', name: 'Eighth', fit: [300, 1158, 2387, 2909] },
];
// Plans were rendered from the UT PDF at 250 dpi; drawing scale is 1/32" = 1'-0" (1 in = 32 ft).
// Checked against the real building: the tower (floors 4-8) measures 265-267 ft wide on the PDF vs
// 265.8 ft for the EER footprint in OpenStreetMap, so the stated scale holds to ~0.5%.
const PLAN_DPI = 250;
const FT_PER_PX = 32 / PLAN_DPI;           // 0.128 ft per image pixel
const floorImg = id => `floors/EER_${id}.png`;
const SCAN_TIMEOUT_MS = 20000;
const SCHEMA = 'bevotag.survey.v1';
const ACCENT = '#bf5700', SAMPLE_COLOR = '#2563eb';   // map is always light, so fixed colors

// ---------------------------------------------------------------- state
const S = {
  floor: '2',
  point: null,            // {x, y} in image px
  samples: [],            // all samples (loaded from IndexedDB)
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

// ---------------------------------------------------------------- storage (IndexedDB, memory fallback)
const DB = {
  db: null,
  async open() {
    try {
      this.db = await new Promise((res, rej) => {
        const r = indexedDB.open('bevotag', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('samples', { keyPath: 'id' });
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    } catch (e) {
      this.db = null;
      log('IndexedDB unavailable, data kept in memory only: ' + e, 'errl');
      toast('Storage unavailable: export often!', 4000);
    }
  },
  tx(mode, fn) {
    if (!this.db) return Promise.resolve([]);
    return new Promise((res, rej) => {
      const t = this.db.transaction('samples', mode);
      const store = t.objectStore('samples');
      const out = fn(store);
      t.oncomplete = () => res(out && out.result !== undefined ? out.result : undefined);
      t.onerror = () => rej(t.error);
    });
  },
  all() { return this.tx('readonly', s => s.getAll()).then(r => r || []); },
  put(list) { return this.tx('readwrite', s => { list.forEach(x => s.put(x)); }); },
  del(ids) { return this.tx('readwrite', s => { ids.forEach(id => s.delete(id)); }); },
  clear() { return this.tx('readwrite', s => s.clear()); },
};

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
  const ftPerScreenPx = FT_PER_PX / S.view.s;
  const ft = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500].find(n => n / ftPerScreenPx >= 60) || 500;
  $('scalebarLine').style.width = (ft / ftPerScreenPx) + 'px';
  $('scalebarText').textContent = `${ft} ft`;
}
function fitView() {
  const r = vp.getBoundingClientRect();
  if (!r.width || !r.height) { S.needFit = true; return; }   // retried by the ResizeObserver
  S.needFit = false;
  const f = FLOORS.find(x => x.id === S.floor);
  const [x0, y0, x1, y1] = (f && f.fit) || [0, 0, S.img.w, S.img.h];
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

function setFloor(id, keepView = false) {
  if (S.collecting) { toast('Stop collecting before switching floors'); return; }
  if (!FLOORS.some(f => f.id === id)) { toast(`Unknown floor "${id}"`); return; }
  const changed = id !== S.floor;
  S.floor = id; prefs.set('floor', id);
  if (changed) S.point = null;
  document.querySelectorAll('#floorTabs button').forEach(b => b.classList.toggle('active', b.dataset.id === id));
  $('floorOut').value = `${id} (${FLOORS.find(f => f.id === id).name})`;
  const src = floorImg(id);
  if (img.getAttribute('src') !== src) {
    img.onload = () => {
      S.img = { w: img.naturalWidth, h: img.naturalHeight };
      svg.setAttribute('width', S.img.w); svg.setAttribute('height', S.img.h);
      svg.setAttribute('viewBox', `0 0 ${S.img.w} ${S.img.h}`);
      if (!keepView) fitView(); else applyView();
    };
    img.onerror = () => toast(`Missing ${src}. Run make_floors.sh (see README)`, 5000);
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
    if (x.floor !== S.floor) continue;
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
  $('xOut').value = S.point ? (S.point.x * FT_PER_PX).toFixed(1) : '';
  $('yOut').value = S.point ? (S.point.y * FT_PER_PX).toFixed(1) : '';
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
  aps: null, seq: 0, streamTimer: null,
  // mimic a device that scans on its own when "Device streams scans" is ticked
  syncStream() {
    const on = S.mode === 'sim' && $('streamMode').checked;
    if (on && !this.streamTimer) this.streamTimer = setInterval(() => this.handle({ cmd: 'scan' }), 1500);
    if (!on && this.streamTimer) { clearInterval(this.streamTimer); this.streamTimer = null; }
  },
  build() {
    // deterministic fake APs: ~24 per floor, 3 SSIDs each, over the middle of the sheet
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const aps = [];
    FLOORS.forEach((f, fi) => {
      for (let i = 0; i < 24; i++) {
        const x = 2750 * (0.15 + 0.7 * rnd()), y = 4250 * (0.15 + 0.6 * rnd());
        const base = [0x70, 0x10, 0x5c, fi, i].map(b => b.toString(16).padStart(2, '0')).join(':');
        const ch = [1, 6, 11][Math.floor(rnd() * 3)];
        ['utexas', 'utexas-iot', 'eduroam'].forEach((ssid, k) =>
          aps.push({ fi, x, y, ch, ssid, bssid: `${base}:${(k + 1).toString(16).padStart(2, '0')}` }));
      }
    });
    this.aps = aps;
  },
  gauss() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); },
  handle(cmd) {
    if (cmd.cmd === 'hello') return setTimeout(() => onMsg({ type: 'hello', v: 1, fw: 'sim-0.1', chip: 'SIMULATOR', mac: 'de:ad:be:ef:00:01' }), 50);
    if (cmd.cmd !== 'scan') return;
    if (!this.aps) this.build();
    const fi = FLOORS.findIndex(f => f.id === S.floor);
    const p = S.point || { x: 1375, y: 2000 };
    const aps = [];
    for (const a of this.aps) {
      const df = Math.abs(a.fi - fi); if (df > 1) continue;
      const dm = Math.max(1, Math.hypot(a.x - p.x, a.y - p.y) * FT_PER_PX * 0.3048);
      const rssi = Math.round(-38 - 28 * Math.log10(dm) - 15 * df + 4 * this.gauss());
      if (rssi > -92) aps.push({ bssid: a.bssid, ssid: a.ssid, rssi, ch: a.ch });
    }
    aps.sort((a, b) => b.rssi - a.rssi);
    const dur = 700 + Math.round(Math.random() * 300);
    setTimeout(() => onMsg({ type: 'scan', v: 1, id: cmd.id, seq: ++this.seq, ms: Math.round(performance.now()), dur_ms: dur, aps }), dur);
  },
};

// ---------------------------------------------------------------- messaging
async function send(obj) {
  const text = typeof obj === 'string' ? obj : JSON.stringify(obj);
  log(text, 'outl');
  if (S.mode === 'serial') { try { await Serial.write(text); } catch (e) { log('Write failed: ' + e, 'errl'); } }
  else if (S.mode === 'sim') { try { Sim.handle(JSON.parse(text)); } catch { /* */ } }
  else toast('No device connected');
}
function onLine(line) {
  log(line, 'in');
  if (line[0] !== '{') return;
  let msg;
  try { msg = JSON.parse(line); } catch { log('Unparseable JSON line (ignored)', 'errl'); return; }
  onMsg(msg, true);
}
function onMsg(msg, alreadyLogged) {
  if (!alreadyLogged) log(JSON.stringify(msg), 'in');
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
  const why = S.mode === 'none' ? 'Connect a device (or start the simulator).'
    : !S.point ? 'Click the map where the DAQ module is.'
    : !room ? 'Enter the room number.' : '';
  b.disabled = !!why;
  m.textContent = why || `Ready: ${$('nScans').value} scans at ${BUILDING} ${room}.`;
}

async function collect() {
  if (S.collecting) { S.stop = true; $('collectMsg').textContent = 'Stopping after current scan…'; return; }
  const n = Math.max(1, Math.min(100, parseInt($('nScans').value, 10) || 1));
  const stream = $('streamMode').checked;
  const label = {
    building: BUILDING, floor: S.floor, room: $('room').value.trim(),
    x_px: S.point.x, y_px: S.point.y,
    x_ft: +(S.point.x * FT_PER_PX).toFixed(2), y_ft: +(S.point.y * FT_PER_PX).toFixed(2),
    note: $('note').value.trim(), operator: $('operator').value.trim(),
  };
  const batch = uuid();
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
      const sample = {
        id: uuid(), schema: SCHEMA, batch, session: S.session, t: new Date().toISOString(),
        ...label, device: { ...(S.device || {}), sim: S.mode === 'sim' }, scan,
      };
      S.samples.push(sample);
      await DB.put([sample]);
      ok++; fails = 0;
      bar.style.width = (100 * ok / n) + '%';
      refreshDataset();
    } catch (e) {
      fails++;
      log(`Scan failed (${e.message}), ${fails}/3`, 'errl');
      if (fails >= 3) { toast('3 scans in a row failed: stopping', 4000); break; }
    }
  }
  S.collecting = false; S.waiter = null;
  updateCollectState(); renderOverlay();
  $('collectMsg').textContent = `Saved ${ok} scan${ok === 1 ? '' : 's'} for ${label.room} (floor ${label.floor}). Click the next point.`;
  if (ok) toast(`Saved ${ok} × ${label.room}`);
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
    const k = x.floor + '|' + x.room;
    const g = byRoom.get(k) || { floor: x.floor, room: x.room, n: 0, sx: 0, sy: 0 };
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
  const order = f => FLOORS.findIndex(x => x.id === f);
  const groups = [...byRoom.values()].sort((a, b) => order(a.floor) - order(b.floor) || a.room.localeCompare(b.room, undefined, { numeric: true }));
  $('roomTable').tBodies[0].innerHTML = groups.map(g =>
    `<tr class="clickable" data-floor="${esc(g.floor)}" data-room="${esc(g.room)}" data-x="${g.sx / g.n}" data-y="${g.sy / g.n}">` +
    `<td>${esc(g.floor)}</td><td>${esc(g.room)}</td><td>${g.n}</td>` +
    `<td><button class="x" title="Delete this room's samples" data-del="1">✕</button></td></tr>`).join('') ||
    '<tr><td colspan="4" class="muted">No data yet</td></tr>';
  $('roomList').innerHTML = [...new Set(S.samples.map(x => x.room))].map(r => `<option value="${esc(r)}">`).join('');
  // floor tab counts
  const perFloor = {};
  for (const x of S.samples) perFloor[x.floor] = (perFloor[x.floor] || 0) + 1;
  document.querySelectorAll('#floorTabs button').forEach(b => {
    const c = perFloor[b.dataset.id];
    b.innerHTML = esc(b.dataset.id) + (c ? `<span class="cnt">${c}</span>` : '');
  });
  $('btnUndo').disabled = !S.samples.length;
  renderOverlay();
}

$('roomTable').addEventListener('click', async e => {
  const tr = e.target.closest('tr[data-room]'); if (!tr) return;
  const { floor, room } = tr.dataset;
  if (e.target.dataset.del) {
    const ids = S.samples.filter(x => x.floor === floor && x.room === room).map(x => x.id);
    if (!confirm(`Delete ${ids.length} scans for ${room} (floor ${floor})?`)) return;
    await DB.del(ids);
    S.samples = S.samples.filter(x => !(x.floor === floor && x.room === room));
    refreshDataset(); return;
  }
  if (S.collecting) return;
  setFloor(floor, true);
  $('room').value = room; updateCollectState();
  const go = () => centerOn(+tr.dataset.x, +tr.dataset.y);
  img.complete ? go() : img.addEventListener('load', go, { once: true });
});

async function undoLast() {
  if (!S.samples.length || S.collecting) return;
  const last = S.samples.reduce((a, b) => (a.t > b.t ? a : b));
  const ids = S.samples.filter(x => x.batch === last.batch).map(x => x.id);
  if (!confirm(`Remove the last point (${ids.length} scans in ${last.room}, floor ${last.floor})?`)) return;
  await DB.del(ids);
  S.samples = S.samples.filter(x => x.batch !== last.batch);
  refreshDataset(); toast('Removed last point');
}

// ---------------------------------------------------------------- import / export
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

function exportJson() {
  if (!S.samples.length) return toast('Nothing to export');
  const doc = {
    schema: SCHEMA, exported_at: new Date().toISOString(), building: BUILDING,
    coord_frame: { units: 'ft', origin: 'top-left of floor-plan sheet', ft_per_px: FT_PER_PX, plan_dpi: PLAN_DPI,
      note: 'x/y are relative to each floor\'s PDF page; floors are not yet registered to each other' },
    samples: S.samples,
  };
  download(`bevotag_${BUILDING}_${stamp()}.json`, JSON.stringify(doc, null, 1), 'application/json');
}
function exportCsv() {
  if (!S.samples.length) return toast('Nothing to export');
  const q = v => { const s = String(v ?? ''); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const head = ['sample_id', 'batch', 'session', 'time', 'building', 'floor', 'room', 'x_ft', 'y_ft', 'operator', 'note',
    'device_mac', 'sim', 'scan_seq', 'n_aps', 'bssid', 'ssid', 'rssi', 'channel'];
  const lines = [head.join(',')];
  for (const x of S.samples) {
    const base = [x.id, x.batch, x.session, x.t, x.building, x.floor, x.room, x.x_ft, x.y_ft, x.operator, x.note,
      x.device?.mac, x.device?.sim ? 1 : 0, x.scan.seq, x.scan.aps.length];
    if (!x.scan.aps.length) lines.push([...base, '', '', '', ''].map(q).join(','));
    for (const a of x.scan.aps) lines.push([...base, a.bssid, a.ssid, a.rssi, a.ch].map(q).join(','));
  }
  download(`bevotag_${BUILDING}_${stamp()}.csv`, lines.join('\n'), 'text/csv');
}
async function importJson(file) {
  try {
    const doc = JSON.parse(await file.text());
    const list = Array.isArray(doc) ? doc : doc.samples;
    if (!Array.isArray(list)) throw new Error('no samples[] found');
    const have = new Set(S.samples.map(x => x.id));
    const fresh = list.filter(x => x && x.id && x.scan && Array.isArray(x.scan.aps) && x.floor &&
      !have.has(x.id) && have.add(x.id));   // also drops duplicates inside the file itself
    await DB.put(fresh);
    S.samples.push(...fresh);
    refreshDataset();
    toast(`Imported ${fresh.length} new scans (${list.length - fresh.length} skipped)`, 3500);
  } catch (e) { toast('Import failed: ' + e.message, 4000); }
}

// ---------------------------------------------------------------- wiring
function init() {
  $('floorTabs').innerHTML = FLOORS.map(f => `<button data-id="${f.id}" title="${f.name} floor">${f.id}</button>`).join('');
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
  $('btnUndo').onclick = undoLast;
  $('btnExportJson').onclick = exportJson;
  $('btnExportCsv').onclick = exportCsv;
  $('importFile').onchange = e => { if (e.target.files[0]) importJson(e.target.files[0]); e.target.value = ''; };
  $('btnClear').onclick = async () => {
    if (!S.samples.length) return;
    if (!confirm(`Delete ALL ${S.samples.length} scans from this browser? Export first!`)) return;
    if (prompt('Type DELETE to confirm') !== 'DELETE') return;
    await DB.clear(); S.samples = []; refreshDataset(); toast('Cleared');
  };
  $('btnSend').onclick = () => { const t = $('rawCmd').value.trim(); if (t) send(t); };
  $('rawCmd').addEventListener('keydown', e => { if (e.key === 'Enter') $('btnSend').click(); });
  window.addEventListener('beforeunload', e => { if (S.collecting) { e.preventDefault(); e.returnValue = ''; } });

  $('operator').value = prefs.get('operator', '');
  $('nScans').value = prefs.get('nScans', '5');
  $('streamMode').checked = prefs.get('stream', false);
  $('baud').value = prefs.get('baud', '115200');
  if (!('serial' in navigator)) log('Web Serial not available in this browser. Use desktop Chrome/Edge (simulator still works).', 'errl');
  log(`Session ${S.session}`);
}

(async () => {
  init();
  setMode('none');
  await DB.open();
  S.samples = await DB.all();
  const floor = prefs.get('floor', '2');
  setFloor(FLOORS.some(f => f.id === floor) ? floor : '2');
  refreshDataset();
})();

// exposed for debugging / automated tests
window.BevoTag = { S, Sim, DB, setPoint, setFloor, collect, exportCsv, exportJson };

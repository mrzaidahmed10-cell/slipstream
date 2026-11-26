// In-race HUD: position, lap, timer, speed, drift meter, item slot, minimap, standings, banners.
import { getTrack } from '../core/tracks.js';
import { fmtTime, ordinal, clamp } from '../core/util.js';
import { ITEM_ICONS } from './icons.js';
import { PAINT_BY_ID } from '../core/vehicles.js';

const $ = (s, r = document) => r.querySelector(s);
const TIER_COLORS = ['#7dd3ff', '#ffb02e', '#d27dff'];

export class HUD {
  constructor(root) {
    this.root = root; this.el = {}; this.mini = null; this.track = null; this.trackPath = null; this.msgTimer = 0;
    root.innerHTML = `
      <div class="hud-top-left"><div class="pos"><span class="pos-n" id="h-pos">1</span><span class="pos-s" id="h-pos-s">st</span><span class="pos-of" id="h-total">/ 8</span></div>
        <div class="standings" id="h-stand"></div></div>
      <div class="hud-top-right">
        <div class="lapbox"><div class="lap-l">LAP</div><div class="lap-n"><b id="h-lap">1</b><i id="h-laps">/3</i></div></div>
        <div class="timebox"><div id="h-time">0:00.00</div><div class="best" id="h-best"></div></div>
        <canvas id="h-mini" width="260" height="260"></canvas>
      </div>
      <div class="hud-item" id="h-item"><div class="item-ring"><div class="item-ic" id="h-item-ic"></div><div class="item-ct" id="h-item-ct"></div></div><div class="item-name" id="h-item-name"></div></div>
      <div class="hud-center"><div class="count" id="h-count"></div><div class="msg" id="h-msg"></div><div class="wrong" id="h-wrong">WRONG WAY</div></div>
      <div class="hud-speed"><div class="drift-meter" id="h-drift"><i></i></div><div class="spd"><b id="h-spd">0</b><span>KM/H</span></div><div class="speed-bar"><i id="h-spd-bar"></i></div><div class="surface" id="h-surf"></div></div>
      <div class="speedlines" id="h-lines"></div><div class="vignette" id="h-vig"></div>`;
    for (const id of ['h-pos', 'h-pos-s', 'h-total', 'h-stand', 'h-lap', 'h-laps', 'h-time', 'h-best', 'h-mini', 'h-item', 'h-item-ic', 'h-item-ct', 'h-item-name', 'h-count', 'h-msg', 'h-wrong', 'h-spd', 'h-spd-bar', 'h-drift', 'h-surf', 'h-lines', 'h-vig']) this.el[id] = $('#' + id, root);
    this.mini = this.el['h-mini'].getContext('2d');
    this.last = {};
  }
  setTrack(trackId) {
    this.track = getTrack(trackId);
    const t = this.track, b = t.bounds(0), s = Math.min(220 / (b.maxX - b.minX), 220 / (b.maxZ - b.minZ));
    this.mm = { s, ox: 130 - ((b.minX + b.maxX) / 2) * s, oz: 130 + ((b.minZ + b.maxZ) / 2) * s };
    const p = new Path2D();
    for (let i = 0; i <= t.N; i += 3) { const x = this.mm.ox + t.X[i % t.N] * s, y = this.mm.oz - t.Z[i % t.N] * s; i ? p.lineTo(x, y) : p.moveTo(x, y); }
    p.closePath(); this.trackPath = p; this.last = {};
  }
  show(v) { this.root.classList.toggle('on', v); }
  set(k, v, fn) { if (this.last[k] !== v) { this.last[k] = v; fn(v); } }

  message(text, cls = '', ms = 1800) {
    const m = this.el['h-msg']; m.textContent = text; m.className = 'msg show ' + cls; clearTimeout(this.msgTimer);
    this.msgTimer = setTimeout(() => (m.className = 'msg ' + cls), ms);
  }

  update(s, opts = {}) {
    const E = this.el, set = this.set.bind(this);
    set('pos', s.rank, (v) => { E['h-pos'].textContent = v; E['h-pos-s'].textContent = ordinal(v).replace(/\d+/, ''); });
    set('total', s.total, (v) => (E['h-total'].textContent = '/ ' + v));
    E['h-pos'].parentElement.style.display = opts.hidePos ? 'none' : '';
    set('lap', s.lap, (v) => (E['h-lap'].textContent = v));
    set('laps', s.laps, (v) => (E['h-laps'].textContent = v >= 90 ? '' : '/' + v));
    const t = Math.max(0, s.time);
    set('time', fmtTime(t), (v) => (E['h-time'].textContent = v));
    const best = s.lapTimes.length ? Math.min(...s.lapTimes) : null;
    set('best', best, (v) => (E['h-best'].textContent = v ? 'BEST ' + fmtTime(v) : ''));
    const kmh = Math.round(s.speed * 3.6 * 1.6);
    set('spd', kmh, (v) => (E['h-spd'].textContent = v));
    E['h-spd-bar'].style.transform = `scaleX(${clamp(s.speedRatio / 1.2, 0, 1)})`;
    E['h-spd-bar'].style.background = s.boosting ? 'linear-gradient(90deg,#ffb02e,#ff4f4f)' : '';
    // drift meter
    const dm = E['h-drift'];
    if (s.drifting) { const tier = s.tier; dm.classList.add('on'); dm.style.setProperty('--c', tier ? TIER_COLORS[tier - 1] : '#ffffff55'); dm.firstChild.style.transform = `scaleX(${clamp(s.driftTier / 3.6, 0, 1)})`; }
    else dm.classList.remove('on');
    // item
    set('item', (s.rolling ? 'roll' : s.item) + ':' + s.itemCount, () => {
      const ic = E['h-item-ic'];
      E['h-item'].classList.toggle('has', !!s.item || s.rolling); E['h-item'].classList.toggle('roll', s.rolling);
      if (s.rolling) ic.innerHTML = ITEM_ICONS.turbo; else ic.innerHTML = s.item ? ITEM_ICONS[s.item] : '';
      E['h-item-ct'].textContent = s.item === 'triple' ? '×' + s.itemCount : '';
      E['h-item-name'].textContent = s.rolling ? '' : s.itemInfo ? s.itemInfo.name : '';
    });
    if (s.rolling && this.track) { const keys = Object.keys(ITEM_ICONS); const k = keys[Math.floor(performance.now() / 70) % keys.length]; if (this.last.rk !== k) { this.last.rk = k; E['h-item-ic'].innerHTML = ITEM_ICONS[k]; } }
    set('count', s.countdown, (v) => { const c = E['h-count']; c.textContent = v || ''; c.className = 'count' + (v ? ' show' : ''); if (v) { void c.offsetWidth; c.classList.add('pop'); } });
    E['h-wrong'].classList.toggle('show', !!s.wrong);
    set('surf', s.zone || (s.surface === 'off' ? 'off' : ''), (v) => { E['h-surf'].textContent = { ice: 'ICE', sand: 'SAND', wet: 'WET', off: 'OFF-ROAD' }[v] || ''; E['h-surf'].className = 'surface ' + (v || ''); });
    E['h-lines'].style.opacity = clamp((s.speedRatio - 0.85) * 2.2 + (s.boosting ? 0.5 : 0), 0, 0.9);
    E['h-vig'].classList.toggle('boost', s.boosting);
    // standings
    const sk = s.order.map((o) => o.id + o.rank).join(',');
    set('stand', sk, () => {
      const rows = s.order.slice(0, 8).map((o) => { const c = (PAINT_BY_ID[o.color] || { color: '#999' }).color; return `<div class="st ${o.isPlayer ? 'me' : ''}"><b>${o.rank}</b><i style="background:${c}"></i><span>${o.name}</span></div>`; });
      E['h-stand'].innerHTML = rows.join('');
    });
    this.drawMini(s);
  }

  drawMini(s) {
    if (!this.trackPath) return; const g = this.mini, m = this.mm;
    g.clearRect(0, 0, 260, 260);
    g.lineJoin = 'round'; g.lineCap = 'round';
    g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 12; g.stroke(this.trackPath);
    g.strokeStyle = 'rgba(210,225,255,0.85)'; g.lineWidth = 7; g.stroke(this.trackPath);
    const sorted = [...s.karts].sort((a, b) => (a.isPlayer ? 1 : 0) - (b.isPlayer ? 1 : 0));
    for (const k of sorted) {
      const x = m.ox + k.x * m.s, y = m.oz - k.z * m.s;
      g.beginPath(); g.arc(x, y, k.isPlayer ? 7 : 4.5, 0, 7);
      g.fillStyle = k.isPlayer ? '#ffffff' : (PAINT_BY_ID[k.color] || { color: '#aaa' }).color; g.fill();
      g.lineWidth = k.isPlayer ? 3 : 1.5; g.strokeStyle = k.isPlayer ? '#34e0ff' : 'rgba(0,0,0,0.7)'; g.stroke();
    }
  }
}

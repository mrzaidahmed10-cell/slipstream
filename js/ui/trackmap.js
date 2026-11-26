// Stylised top-down track maps: terrain halo, asphalt ribbon, hazard zones, boost pads, item rows,
// numbered corners, direction arrows and the start line. Cached as data URLs.
import { getTrack } from '../core/tracks.js';

const THEME = {
  stadium: { bg: ['#1c2a58', '#0d1430'], land: '#2f7d3f', halo: '#3fa357' },
  desert: { bg: ['#6a4a2a', '#3a2814'], land: '#d9a85e', halo: '#f0c883' },
  winter: { bg: ['#294a84', '#10203f'], land: '#dce9f8', halo: '#ffffff' },
  beach: { bg: ['#0f6f93', '#093a52'], land: '#efd7a0', halo: '#ffe9bb' },
  forest: { bg: ['#1c3a22', '#0b1a10'], land: '#2f6a38', halo: '#4a9a58' },
  city: { bg: ['#14173a', '#070a1c'], land: '#2a2f58', halo: '#4a4f90' },
};
export const ZONE_COLORS = { ice: '#9fe8ff', sand: '#ffd58a', wet: '#6aa0ff' };
const cache = new Map();

export function cornerList(t) {
  const N = t.N, K = t.K, out = [];
  const sm = new Float32Array(N);
  for (let i = 0; i < N; i++) { let a = 0; for (let d = -4; d <= 4; d++) a += K[(i + d + N) % N]; sm[i] = a / 9; }
  const win = 14;
  for (let i = 0; i < N; i++) {
    const v = Math.abs(sm[i]); if (v < 0.011) continue;
    let peak = true; for (let d = -win; d <= win; d++) { if (Math.abs(sm[(i + d + N) % N]) > v + 1e-9) { peak = false; break; } }
    if (peak && !out.some((o) => Math.min(Math.abs(o.i - i), N - Math.abs(o.i - i)) < 16)) out.push({ i, dir: Math.sign(sm[i]), k: v });
  }
  return out.sort((a, b) => a.i - b.i);
}

export function trackMap(trackId, w = 640, h = 400, { numbers = true } = {}) {
  const key = trackId + w + h + numbers; if (cache.has(key)) return cache.get(key);
  const t = getTrack(trackId), th = THEME[t.theme] || THEME.stadium;
  const dpr = 1, cv = document.createElement('canvas'); cv.width = w * dpr; cv.height = h * dpr; const g = cv.getContext('2d');
  const bg = g.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, Math.max(w, h) * 0.7); bg.addColorStop(0, th.bg[0]); bg.addColorStop(1, th.bg[1]);
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  // faint blueprint grid
  g.strokeStyle = 'rgba(255,255,255,0.045)'; g.lineWidth = 1;
  for (let x = 0; x < w; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
  for (let y = 0; y < h; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  const b = t.bounds(0), pad = 46, s = Math.min((w - pad * 2) / (b.maxX - b.minX), (h - pad * 2) / (b.maxZ - b.minZ));
  const ox = (w - (b.maxX - b.minX) * s) / 2 - b.minX * s, oy = (h + (b.maxZ - b.minZ) * s) / 2 + b.minZ * s;
  const P = (i, lane = 0) => { const p = t.pointAt(i, lane); return [ox + p.x * s, oy - p.z * s]; };
  const path = (from = 0, to = t.N, lane = 0, step = 2) => { g.beginPath(); let first = true; for (let i = from; i <= to; i += step) { const [x, y] = P(i, lane); first ? g.moveTo(x, y) : g.lineTo(x, y); first = false; } };
  g.lineJoin = 'round'; g.lineCap = 'round';
  // terrain halo around the road (contour feel)
  const rw = t.def.width * s;
  for (const [mul, a] of [[11, 0.07], [8, 0.09], [5.4, 0.13], [3.4, 0.18]]) { path(); g.closePath(); g.strokeStyle = th.halo; g.globalAlpha = a; g.lineWidth = rw * mul; g.stroke(); }
  g.globalAlpha = 1;
  // walls / outline, asphalt, kerb stripes, centre dashes
  path(); g.closePath(); g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = rw + 11; g.stroke();
  path(); g.closePath(); g.strokeStyle = '#e6ecff'; g.lineWidth = rw + 6; g.stroke();
  path(); g.closePath(); g.strokeStyle = '#2b3347'; g.lineWidth = rw + 1; g.stroke();
  path(); g.closePath(); g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 1.5; g.setLineDash([8, 9]); g.stroke(); g.setLineDash([]);
  // hazard zones
  for (const z of t.zones) { path(z.i0, z.i1, 0, 1); g.strokeStyle = ZONE_COLORS[z.type]; g.globalAlpha = 0.85; g.lineWidth = rw * 0.8; g.lineCap = 'butt'; g.stroke(); g.globalAlpha = 1; g.lineCap = 'round'; }
  // boost pads (chevrons)
  for (const p of t.pads) {
    const [x, y] = P(p.idx, p.lane), [x2, y2] = P(p.idx + 4, p.lane), a = Math.atan2(y2 - y, x2 - x);
    g.save(); g.translate(x, y); g.rotate(a); g.fillStyle = '#ffd23f'; g.strokeStyle = '#7a5a00'; g.lineWidth = 1;
    for (let k = 0; k < 2; k++) { g.beginPath(); g.moveTo(-5 + k * 6, -5); g.lineTo(1 + k * 6, 0); g.lineTo(-5 + k * 6, 5); g.lineTo(-2 + k * 6, 0); g.closePath(); g.fill(); g.stroke(); }
    g.restore();
  }
  // item boxes
  for (const r of t.itemRows) for (const ln of r.lanes) { const [x, y] = P(r.idx, ln); const gr = g.createLinearGradient(x - 3, y - 3, x + 3, y + 3); gr.addColorStop(0, '#ff5fa8'); gr.addColorStop(0.5, '#ffd23f'); gr.addColorStop(1, '#34e0ff'); g.fillStyle = gr; g.fillRect(x - 3, y - 3, 6, 6); g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 1; g.strokeRect(x - 3, y - 3, 6, 6); }
  // direction arrows
  g.fillStyle = 'rgba(255,255,255,0.8)';
  for (let i = 40; i < t.N; i += Math.round(t.N / 9)) { const [x, y] = P(i), [x2, y2] = P(i + 3), a = Math.atan2(y2 - y, x2 - x); g.save(); g.translate(x, y); g.rotate(a); g.beginPath(); g.moveTo(5, 0); g.lineTo(-3, -4.5); g.lineTo(-1, 0); g.lineTo(-3, 4.5); g.closePath(); g.fill(); g.restore(); }
  // numbered corners
  if (numbers) {
    cornerList(t).forEach((c, n) => {
      const [x, y] = P(c.i, -c.dir * (t.def.width * 0.5 + 9)); // outside of the bend (left turn => outside is +right)
      g.beginPath(); g.arc(x, y, 8.5, 0, 7); g.fillStyle = 'rgba(10,15,32,0.92)'; g.fill(); g.strokeStyle = '#34e0ff'; g.lineWidth = 1.5; g.stroke();
      g.fillStyle = '#fff'; g.font = '700 10px system-ui,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(n + 1), x, y + 0.5);
    });
  }
  // start / finish
  { const [x, y] = P(0), [x2, y2] = P(2), a = Math.atan2(y2 - y, x2 - x); g.save(); g.translate(x, y); g.rotate(a);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 2; c++) { g.fillStyle = (r + c) % 2 ? '#fff' : '#111'; g.fillRect(-4 + c * 4, -rw / 2 + (r * rw) / 4, 4, rw / 4); }
    g.restore();
    g.font = '700 11px system-ui,sans-serif'; g.textAlign = 'center'; g.fillStyle = '#ffd23f'; g.strokeStyle = 'rgba(0,0,0,.8)'; g.lineWidth = 3; g.strokeText('START', x, y - rw / 2 - 12); g.fillText('START', x, y - rw / 2 - 12); }
  const url = cv.toDataURL('image/png'); cache.set(key, url); return url;
}

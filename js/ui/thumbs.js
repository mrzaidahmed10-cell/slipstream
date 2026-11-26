// Track thumbnails drawn on a canvas (theme art + glowing track outline), cached as data URLs.
import { getTrack } from '../core/tracks.js';
const THEME_ART = {
  stadium: ['#1b2a63', '#ff9a63', '#3a8c44'], desert: ['#3b82d8', '#ffe0a8', '#e0b070'], winter: ['#16306b', '#ffc9a0', '#e9f1ff'],
  beach: ['#2f7fd6', '#ffd7a8', '#27c3cf'], forest: ['#7fb0c8', '#eef4de', '#3f6a38'], city: ['#04061a', '#6b2a78', '#162040'],
};
const cache = new Map();
export function trackThumb(trackId, w = 480, h = 270) {
  const key = trackId + w;
  if (cache.has(key)) return cache.get(key);
  const t = getTrack(trackId), [c0, c1, c2] = THEME_ART[t.theme];
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const g = cv.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, h); sky.addColorStop(0, c0); sky.addColorStop(0.62, c1); sky.addColorStop(0.621, c2); sky.addColorStop(1, c2);
  g.fillStyle = sky; g.fillRect(0, 0, w, h);
  // horizon silhouettes
  g.fillStyle = 'rgba(0,0,0,0.28)'; g.beginPath(); g.moveTo(0, h * 0.62);
  for (let x = 0; x <= w; x += 8) g.lineTo(x, h * 0.62 - (Math.sin(x * 0.03 + t.length) * 9 + Math.sin(x * 0.011) * 16 + 16)); g.lineTo(w, h * 0.62); g.fill();
  if (t.theme === 'city') { g.fillStyle = '#0b0f26'; for (let x = 0; x < w; x += 22) { const bh = 30 + ((x * 7919) % 60); g.fillRect(x, h * 0.62 - bh, 18, bh); g.fillStyle = '#ffe9a0'; for (let y = h * 0.62 - bh + 6; y < h * 0.62 - 4; y += 9) if (((x + y) * 31) % 5 < 2) g.fillRect(x + 4, y, 3, 4); g.fillStyle = '#0b0f26'; } }
  // track outline
  const b = t.bounds(0), pad = 34, sx = (w - pad * 2) / (b.maxX - b.minX), sz = (h * 0.8 - pad) / (b.maxZ - b.minZ), s = Math.min(sx, sz);
  const ox = (w - (b.maxX - b.minX) * s) / 2, oy = h * 0.14;
  const P = (i) => [ox + (t.X[i] - b.minX) * s, oy + (b.maxZ - t.Z[i]) * s * 0.78 + h * 0.05];
  g.lineJoin = 'round'; g.lineCap = 'round';
  const path = () => { g.beginPath(); for (let i = 0; i <= t.N; i += 2) { const [x, y] = P(i % t.N); i ? g.lineTo(x, y) : g.moveTo(x, y); } g.closePath(); };
  path(); g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 15; g.stroke();
  path(); g.strokeStyle = '#2b3140'; g.lineWidth = 11; g.stroke();
  path(); g.strokeStyle = '#ffffff'; g.lineWidth = 1.6; g.setLineDash([7, 8]); g.stroke(); g.setLineDash([]);
  for (const z of t.zones) { g.beginPath(); for (let i = z.i0; i <= z.i1; i++) { const [x, y] = P(i % t.N); i === z.i0 ? g.moveTo(x, y) : g.lineTo(x, y); } g.strokeStyle = z.type === 'ice' ? '#bfe6ff' : z.type === 'sand' ? '#f0c878' : '#6aa8ff'; g.lineWidth = 6; g.stroke(); }
  const [sx0, sy0] = P(0); g.fillStyle = '#ffd23f'; g.beginPath(); g.arc(sx0, sy0, 6.5, 0, 7); g.fill(); g.strokeStyle = '#111'; g.lineWidth = 2; g.stroke();
  const url = cv.toDataURL('image/jpeg', 0.86); cache.set(key, url); return url;
}

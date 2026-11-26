// Procedural prop geometry for scenery. Everything is vertex-coloured and merged so a prop is one draw call
// (or two when it has an emissive part). Factories return BufferGeometry or { solid, glow }.
import { THREE, GeoBuilder, mat4, lerpColor, noise2, fbm, canvasTex, mergeGeometries } from './gfx.js';

const PI = Math.PI;
const C = (h) => new THREE.Color(h);
const cyl = (a, b, h, s = 10) => new THREE.CylinderGeometry(a, b, h, s);
const cone = (r, h, s = 10) => new THREE.ConeGeometry(r, h, s);
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const sph = (r, ws = 12, hs = 9) => new THREE.SphereGeometry(r, ws, hs);

function hashPos(x, y, z, seed) {
  const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + seed * 4.1) * 43758.5453;
  return s - Math.floor(s);
}

function displace(geo, amp, freq, seed = 0, flat = true) {
  let g = geo.index ? geo.toNonIndexed() : geo.clone();
  const p = g.attributes.position;
  const cache = new Map();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const key = `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
    let o = cache.get(key);
    if (!o) {
      const n = noise2(x * freq + seed * 3.1, z * freq + y * freq * 0.7) + noise2(y * freq * 1.7 + 9, x * freq * 1.3 + seed) * 0.5;
      const l = Math.hypot(x, y, z) || 1;
      const k = 1 + (n - 0.75) * amp;
      o = [x * k, y * (1 + (n - 0.75) * amp * 0.6), z * k];
      cache.set(key, o);
    }
    p.setXYZ(i, o[0], o[1], o[2]);
  }
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------- trees
export function pine({ snow = 0.0, scale = 1, dark = '#1d4a2c', light = '#2f7a43' } = {}) {
  const b = new GeoBuilder();
  b.add(cyl(0.32, 0.55, 3.2, 8), '#4a3222', { pos: [0, 1.6, 0] });
  const layers = 5;
  for (let k = 0; k < layers; k++) {
    const r = 3.5 - k * 0.6, h = 3.4, y = 2.4 + k * 1.95;
    b.add(cone(r, h, 11), (x, yy, z) => {
      const t = Math.min(1, Math.max(0, (yy - y) / h + 0.5)); // 0 bottom .. 1 top
      const base = lerpColor(dark, light, t * 0.8 + noise2(x * 2, z * 2) * 0.25);
      if (snow > 0) base.lerp(C('#f4f8ff'), snow * Math.min(1, Math.pow(t, 0.7) * 0.9 + noise2(x * 3, z * 3 + yy) * 0.3));
      return base;
    }, { pos: [0, y, 0], rot: [0, k * 0.7, 0] });
  }
  b.add(cone(0.5, 1.6, 8), snow > 0 ? '#f4f8ff' : light, { pos: [0, 2.4 + layers * 1.95 + 0.4, 0] });
  return b.build();
}

export function redwood() {
  const b = new GeoBuilder();
  const H = 44;
  b.add(cyl(1.2, 2.1, H, 14), (x, y, z) => {
    const ang = Math.atan2(z, x);
    const rib = noise2(ang * 5 + 3, y * 0.08) * 0.35;
    return lerpColor('#5a2d1c', '#8a4a2a', 0.3 + rib + noise2(ang * 11, y * 0.3) * 0.2);
  }, { pos: [0, H / 2, 0] });
  // root flare
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * PI * 2 + 0.3;
    b.add(cone(0.9, 4.5, 6), '#5a2d1c', { pos: [Math.cos(a) * 1.8, 1.7, Math.sin(a) * 1.8], rot: [Math.sin(a) * 0.55, 0, -Math.cos(a) * 0.55], scale: [1, 1, 0.7] });
  }
  // foliage tiers high up
  for (let k = 0; k < 7; k++) {
    const y = 22 + k * 3.4, r = 6.2 - k * 0.8;
    b.add(cone(Math.max(1.2, r), 5.6, 9), (x, yy, z) => lerpColor('#14321f', '#2c6a3a', noise2(x * 0.7, z * 0.7 + yy) * 0.8 + (yy - y) * 0.04), { pos: [0, y, 0], rot: [0, k, 0] });
  }
  // some side branches
  for (let k = 0; k < 6; k++) {
    const y = 10 + k * 3.7, a = k * 2.1;
    b.add(cone(2.2, 4.2, 7), '#1f4a2c', { pos: [Math.cos(a) * 2.6, y, Math.sin(a) * 2.6], rot: [Math.sin(a) * 1.3, 0, -Math.cos(a) * 1.3] });
  }
  return b.build();
}

export function palm(variant = 0) {
  const b = new GeoBuilder();
  const segs = 9, len = 7.5 + variant * 1.4, bend = 1.6 + variant * 0.8;
  const pts = [];
  for (let i = 0; i <= segs; i++) { const t = i / segs; pts.push([Math.sin(t * 1.15) * bend * t, t * len, Math.sin(t * 2.2) * 0.3]); }
  for (let i = 0; i < segs; i++) {
    const a = pts[i], c = pts[i + 1];
    const dir = new THREE.Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    const mid = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2];
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
    const r1 = 0.42 - (i / segs) * 0.16, r2 = 0.42 - ((i + 1) / segs) * 0.16;
    b.add(cyl(r2, r1, dir.length() * 1.04, 9), i % 2 ? '#8a6a44' : '#a07c52', { pos: mid, rot: [e.x, e.y, e.z] });
  }
  const top = pts[segs];
  const fronds = 10;
  for (let f = 0; f < fronds; f++) {
    const a = (f / fronds) * PI * 2 + variant * 0.4;
    const droop = 0.65 + (f % 3) * 0.2;
    // each frond: chain of small flattened pieces following a drooping arc
    const L = 4.6;
    let px = top[0], py = top[1] + 0.2, pz = top[2];
    const parts = 7;
    for (let s = 0; s < parts; s++) {
      const t = s / parts, t2 = (s + 1) / parts;
      const arc = (u) => [Math.cos(a) * u * L, Math.sin(Math.min(1.1, u * 2.4)) * 1.5 - u * u * L * droop * 1.3, Math.sin(a) * u * L];
      const p1 = arc(t), p2 = arc(t2);
      const v = new THREE.Vector3(p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]);
      const m = [top[0] + (p1[0] + p2[0]) / 2, top[1] + 0.2 + (p1[1] + p2[1]) / 2, top[2] + (p1[2] + p2[2]) / 2];
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), v.clone().normalize());
      const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
      const w = 1.25 * (1 - t * 0.85);
      b.add(box(w, 0.05, v.length() * 1.05), lerpColor('#2c7a35', '#5fae3f', t), { pos: m, rot: [e.x, e.y, e.z] });
      b.add(box(w * 0.9, 0.04, v.length()), lerpColor('#2c7a35', '#5fae3f', t), { pos: [m[0], m[1] - 0.03, m[2]], rot: [e.x, e.y, e.z + 0.45] });
    }
  }
  for (let k = 0; k < 3; k++) b.add(sph(0.26, 8, 6), '#5a3a1e', { pos: [top[0] + Math.cos(k * 2.1) * 0.35, top[1] - 0.2, top[2] + Math.sin(k * 2.1) * 0.35] });
  return b.build();
}

export function cactus(variant = 0) {
  const b = new GeoBuilder();
  const col = (x, y, z) => lerpColor('#2f6b35', '#4c9a4b', 0.4 + noise2(x * 5, z * 5 + y) * 0.4);
  const H = 5.5 + variant * 1.2;
  b.add(new THREE.CapsuleGeometry(0.5, H, 6, 12), col, { pos: [0, H / 2 + 0.5, 0] });
  const arms = variant === 0 ? [[-1, 2.2, 1.6], [1, 3.2, 1.2]] : [[1, 2.6, 1.8]];
  for (const [s, y, h] of arms) {
    b.add(cyl(0.32, 0.32, 1.4, 8).rotateZ(PI / 2), col, { pos: [s * 0.95, y, 0] });
    b.add(new THREE.CapsuleGeometry(0.32, h, 5, 10), col, { pos: [s * 1.65, y + h / 2 + 0.1, 0] });
  }
  b.add(sph(0.18, 8, 6), '#ff7aa8', { pos: [0, H + 1.2, 0] });
  return b.build();
}

// ---------------------------------------------------------------- rocks & mesas
export function rock(seed = 0, c0 = '#8a8a92', c1 = '#c4c4cc', stretch = 1) {
  const g = displace(new THREE.IcosahedronGeometry(1, 2), 0.9, 1.3, seed);
  g.scale(1, 0.75 * stretch, 1);
  const p = g.attributes.position, n = p.count;
  const col = new Float32Array(n * 3);
  const a = C(c0), b = C(c1), t = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const y = p.getY(i);
    t.copy(a).lerp(b, THREE.MathUtils.clamp(y * 0.6 + 0.5 + (hashPos(p.getX(i), y, p.getZ(i), seed) - 0.5) * 0.25, 0, 1));
    col[i * 3] = t.r; col[i * 3 + 1] = t.g; col[i * 3 + 2] = t.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

export function mesa(seed = 0, radius = 40, height = 60, strata = ['#b5532f', '#c8693a', '#d9894c', '#a7452b', '#cf7a41', '#e0a15f']) {
  const b = new GeoBuilder();
  const layers = 8;
  let y = 0;
  for (let k = 0; k < layers; k++) {
    const h = height / layers * (0.8 + (k % 3) * 0.25);
    const r0 = radius * (1 - Math.pow(k / layers, 1.8) * 0.28) * (0.94 + noise2(seed + k * 3, k) * 0.12);
    const r1 = r0 * (k % 2 ? 0.95 : 1.04);
    let g = cyl(r1 * 0.96, r0, h, 20);
    g = displace(g, 0.35, 0.09, seed + k);
    const c = C(strata[(k + seed) % strata.length]);
    b.add(g, (x, yy, z) => c.clone().lerp(C('#f0c890'), noise2(x * 0.05, z * 0.05 + yy * 0.1) * 0.25), { pos: [0, y + h / 2, 0] });
    y += h;
  }
  b.add(cyl(radius * 0.7, radius * 0.7, 1.6, 20), '#d6b076', { pos: [0, y + 0.8, 0] });
  return b.build();
}

export function rockArch(seed = 3) {
  const b = new GeoBuilder();
  const col = (x, y, z) => lerpColor('#b8522e', '#e0975a', noise2(x * 0.06, y * 0.12 + z * 0.06) * 0.8);
  for (const s of [-1, 1]) b.add(displace(cyl(5.2, 7.5, 28, 14), 0.4, 0.07, seed + s), col, { pos: [s * 16, 14, 0] });
  b.add(displace(new THREE.TorusGeometry(16, 5, 12, 28, PI), 0.35, 0.08, seed), col, { pos: [0, 26, 0] });
  b.add(displace(new THREE.IcosahedronGeometry(7, 1), 0.6, 0.1, seed + 4), col, { pos: [-22, 3, 4] });
  return b.build();
}

export function deadTree() {
  const b = new GeoBuilder();
  b.add(cyl(0.25, 0.55, 5, 7), '#6a5a48', { pos: [0, 2.5, 0], rot: [0.05, 0, 0.08] });
  for (let k = 0; k < 4; k++) {
    const a = k * 1.7;
    b.add(cyl(0.08, 0.2, 2.6, 6), '#76644f', { pos: [Math.cos(a) * 0.9, 3.8 + k * 0.3, Math.sin(a) * 0.9], rot: [Math.sin(a) * 1.0, 0, -Math.cos(a) * 1.0] });
  }
  return b.build();
}

export function shrub(c0 = '#8a8a4a', c1 = '#b8b070') {
  const b = new GeoBuilder();
  for (let k = 0; k < 7; k++) {
    const a = k * 0.9;
    b.add(cone(0.18, 1.6, 5), lerpColor(c0, c1, (k % 3) / 3), { pos: [Math.cos(a) * 0.5, 0.7, Math.sin(a) * 0.5], rot: [Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6] });
  }
  return b.build();
}

export function fern() {
  const b = new GeoBuilder();
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * PI * 2;
    b.add(cone(0.22, 2.4, 4), lerpColor('#2d6a2e', '#5fae3f', (k % 3) / 2), { pos: [Math.cos(a) * 0.9, 0.55, Math.sin(a) * 0.9], rot: [Math.sin(a) * 1.15, 0, -Math.cos(a) * 1.15], scale: [1.4, 1, 0.35] });
  }
  return b.build();
}

export function mushroom() {
  const b = new GeoBuilder();
  b.add(cyl(0.16, 0.2, 0.6, 8), '#efe8d4', { pos: [0, 0.3, 0] });
  b.add(new THREE.SphereGeometry(0.6, 12, 8, 0, PI * 2, 0, PI / 2), '#d8392f', { pos: [0, 0.55, 0] });
  for (let k = 0; k < 5; k++) b.add(sph(0.08, 6, 4), '#fff', { pos: [Math.cos(k * 1.3) * 0.34, 0.95 - (k % 2) * 0.18, Math.sin(k * 1.3) * 0.34] });
  return b.build();
}

export function fallenLog() {
  const b = new GeoBuilder();
  b.add(cyl(0.9, 1.0, 9, 10).rotateZ(PI / 2), (x, y, z) => lerpColor('#4a3322', '#5d7a3a', y > 0.4 ? 0.6 : 0.05 + noise2(x, z) * 0.2), { pos: [0, 0.9, 0] });
  b.add(cyl(0.7, 0.7, 0.05, 10).rotateZ(PI / 2), '#c9a070', { pos: [4.55, 0.9, 0] });
  return b.build();
}

// ---------------------------------------------------------------- winter
export function snowman() {
  const b = new GeoBuilder();
  b.add(sph(1.1, 14, 10), '#f7fbff', { pos: [0, 1.0, 0] });
  b.add(sph(0.8, 14, 10), '#f7fbff', { pos: [0, 2.4, 0] });
  b.add(sph(0.56, 14, 10), '#f7fbff', { pos: [0, 3.35, 0] });
  b.add(cone(0.1, 0.7, 6).rotateX(PI / 2), '#ff8a1a', { pos: [0, 3.35, 0.7] });
  b.add(cyl(0.6, 0.6, 0.12, 12), '#1b1b22', { pos: [0, 3.95, 0] });
  b.add(cyl(0.36, 0.38, 0.5, 12), '#1b1b22', { pos: [0, 4.2, 0] });
  b.add(new THREE.TorusGeometry(0.58, 0.14, 8, 16).rotateX(PI / 2), '#d6202c', { pos: [0, 2.9, 0] });
  for (const s of [-1, 1]) { b.add(sph(0.07, 6, 4), '#111', { pos: [s * 0.2, 3.5, 0.5] }); b.add(cyl(0.05, 0.05, 1.6, 5), '#5a3b22', { pos: [s * 1.2, 2.6, 0], rot: [0, 0, -s * 0.9] }); }
  return b.build();
}

export function cabin() {
  const solid = new GeoBuilder(), glow = new GeoBuilder();
  const wood = (x, y, z) => lerpColor('#6a4426', '#8a5c34', (Math.sin(y * 9) * 0.5 + 0.5) * 0.5 + noise2(x, z) * 0.2);
  solid.add(box(8, 3.6, 6), wood, { pos: [0, 1.8, 0] });
  // pitched roof with snow
  const shape = new THREE.Shape(); shape.moveTo(-4.6, 0); shape.lineTo(4.6, 0); shape.lineTo(0, 3.1); shape.closePath();
  const roof = new THREE.ExtrudeGeometry(shape, { depth: 7.2, bevelEnabled: false }); roof.translate(0, 0, -3.6);
  solid.add(roof, (x, y) => lerpColor('#3a2a22', '#f4f8ff', y > 0.7 ? 1 : 0.15), { pos: [0, 3.6, 0] });
  solid.add(box(1.0, 2.4, 1.0), '#6b6b74', { pos: [2.4, 5.2, -1.4] });
  solid.add(box(1.2, 0.25, 1.2), '#f4f8ff', { pos: [2.4, 6.5, -1.4] });
  solid.add(box(1.5, 2.5, 0.2), '#3a2416', { pos: [-1.8, 1.25, 3.05] });
  for (const x of [1.4, 3.1]) glow.add(box(1.1, 1.1, 0.1), '#ffcf70', { pos: [x - 0.4, 2.0, 3.04] });
  for (const z of [-1.4, 1.4]) glow.add(box(0.1, 1.1, 1.1), '#ffcf70', { pos: [4.04, 2.0, z] });
  return { solid: solid.build(), glow: glow.build() };
}

export function iceSpire() {
  const b = new GeoBuilder();
  for (let k = 0; k < 5; k++) {
    const a = k * 1.3, r = 0.6 + (k % 3) * 0.4;
    b.add(cone(r, 5 + (k % 3) * 2.6, 5), (x, y) => lerpColor('#9fd4ff', '#e8f6ff', Math.min(1, y / 6 + 0.3)), { pos: [Math.cos(a) * 1.4, 2.6, Math.sin(a) * 1.4], rot: [Math.sin(a) * 0.2, k, Math.cos(a) * 0.2] });
  }
  return b.build();
}

export function mountain(seed = 0, radius = 160, height = 140, snowLine = 0.52, rockC = '#6b7488', snowC = '#f2f7ff') {
  let g = new THREE.ConeGeometry(radius, height, 14, 12, true);
  g = displace(g, 0.55, 0.012, seed);
  const p = g.attributes.position, n = p.count, col = new Float32Array(n * 3), t = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const hy = p.getY(i) / height + 0.5;
    const nz = noise2(p.getX(i) * 0.03 + seed, p.getZ(i) * 0.03);
    if (hy + nz * 0.18 > snowLine) t.set(snowC).lerp(C('#c9dcff'), nz * 0.5); else t.set(rockC).lerp(C('#3c4456'), (1 - hy) * 0.55 + nz * 0.3);
    col[i * 3] = t.r; col[i * 3 + 1] = t.g; col[i * 3 + 2] = t.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

// ---------------------------------------------------------------- beach
export function umbrella(c = '#ff4f6a') {
  const b = new GeoBuilder();
  b.add(cyl(0.05, 0.05, 3, 6), '#e8e0d0', { pos: [0, 1.5, 0], rot: [0, 0, 0.08] });
  const canopy = new THREE.ConeGeometry(1.8, 0.7, 12, 1, true);
  b.add(canopy, (x, y, z) => ((Math.floor((Math.atan2(z, x) + PI) / (PI / 6)) % 2) ? C(c) : C('#fff')), { pos: [0, 3.05, 0], rot: [0, 0, 0.08] });
  b.add(box(2.4, 0.04, 1.1), '#2fb5c8', { pos: [1.8, 0.03, 1.3], rot: [0, 0.5, 0] });
  b.add(box(2.2, 0.04, 1.0), '#ffcf3f', { pos: [-1.9, 0.03, 1.5], rot: [0, -0.3, 0] });
  return b.build();
}

export function tikiHut() {
  const b = new GeoBuilder();
  for (const [x, z] of [[-2, -1.6], [2, -1.6], [-2, 1.6], [2, 1.6]]) b.add(cyl(0.16, 0.2, 2.6, 6), '#6a4a2c', { pos: [x, 1.3, z] });
  b.add(box(5, 0.2, 4), '#8a6038', { pos: [0, 1.0, 0] });
  b.add(cone(3.8, 2.4, 8), (x, y, z) => lerpColor('#b89a5a', '#d6c080', noise2(x * 3, z * 3)), { pos: [0, 3.7, 0], rot: [0, PI / 8, 0] });
  b.add(box(5.4, 1.0, 0.4), '#3d2a1a', { pos: [0, 1.5, 1.8] });
  return b.build();
}

export function lighthouse() {
  const solid = new GeoBuilder(), glow = new GeoBuilder();
  for (let k = 0; k < 6; k++) solid.add(cyl(3.2 - k * 0.25, 3.5 - k * 0.25, 5.2, 18), k % 2 ? '#f2f2f2' : '#d6202c', { pos: [0, 2.6 + k * 5.2, 0] });
  solid.add(cyl(4.2, 3.6, 0.8, 18), '#222', { pos: [0, 32, 0] });
  solid.add(cone(3.1, 3.2, 18), '#d6202c', { pos: [0, 36.4, 0] });
  glow.add(cyl(1.9, 1.9, 3.0, 14), '#fff4b8', { pos: [0, 33.8, 0] });
  return { solid: solid.build(), glow: glow.build() };
}

export function sailboat() {
  const b = new GeoBuilder();
  const hull = new THREE.SphereGeometry(1, 14, 8, 0, PI * 2, PI / 2, PI / 2); hull.scale(1.3, 1.1, 4.2);
  b.add(hull, '#f4f4f4', { pos: [0, 1.0, 0], rot: [PI, 0, 0] });
  b.add(box(2.4, 0.12, 6.6), '#c8a070', { pos: [0, 1.02, 0] });
  b.add(cyl(0.08, 0.1, 9, 6), '#ddd', { pos: [0, 5.5, 0.4] });
  const sail = new THREE.BufferGeometry();
  sail.setAttribute('position', new THREE.Float32BufferAttribute([0, 9.2, 0.4, 0, 1.6, 0.4, 0, 1.6, -3.6, 0, 9.2, 0.4, 0, 1.6, -3.6, 0, 1.6, 0.4], 3));
  sail.computeVertexNormals();
  b.add(sail, '#ffffff'); b.add(sail.clone().rotateY(PI), '#fff7e6', { pos: [0, 0, 0.8] });
  const jib = new THREE.BufferGeometry();
  jib.setAttribute('position', new THREE.Float32BufferAttribute([0, 8.2, 0.9, 0, 1.6, 0.9, 0, 1.6, 3.8], 3)); jib.computeVertexNormals();
  b.add(jib, '#ff7a5c'); b.add(jib.clone(), '#ff7a5c', { rot: [0, PI, 0], pos: [0, 0, 1.8] });
  return b.build();
}

export function ferrisWheel() {
  const solid = new GeoBuilder(), glow = new GeoBuilder();
  const R = 20;
  solid.add(new THREE.TorusGeometry(R, 0.4, 8, 48), '#e8edf5', { pos: [0, 24, 0] });
  solid.add(new THREE.TorusGeometry(R * 0.55, 0.25, 6, 32), '#d6dbe6', { pos: [0, 24, 0] });
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * PI * 2;
    const L = R;
    solid.add(cyl(0.14, 0.14, L, 5), '#d6dbe6', { pos: [Math.cos(a) * L / 2, 24 + Math.sin(a) * L / 2, 0], rot: [0, 0, a - PI / 2] });
    solid.add(box(2.4, 1.8, 1.6), ['#ff5f8a', '#ffd23f', '#3ee0a8', '#4da3ff'][k % 4], { pos: [Math.cos(a) * R, 24 + Math.sin(a) * R - 1.2, 1.2] });
    glow.add(sph(0.32, 6, 4), '#fff0b0', { pos: [Math.cos(a) * R, 24 + Math.sin(a) * R, 0.5] });
  }
  for (const s of [-1, 1]) solid.add(cyl(0.5, 0.8, 26, 6), '#9aa3b4', { pos: [0, 12, s * 3], rot: [s * 0.0, 0, 0] });
  const gl = glow.build(), so = solid.build();
  return { solid: so, glow: gl };
}

// ---------------------------------------------------------------- stadium
export function tireStack() {
  const b = new GeoBuilder();
  for (let k = 0; k < 3; k++) {
    b.add(new THREE.TorusGeometry(0.62, 0.3, 8, 16).rotateX(PI / 2), k === 2 ? '#e9e9ee' : '#16171b', { pos: [(k - 1) * 0.04, 0.3 + k * 0.52, 0] });
  }
  b.add(new THREE.TorusGeometry(0.62, 0.3, 8, 16).rotateX(PI / 2), '#d6202c', { pos: [0, 1.82, 0], scale: [1, 0.35, 1] });
  return b.build();
}

export function floodlight() {
  const solid = new GeoBuilder(), glow = new GeoBuilder();
  solid.add(cyl(0.45, 0.75, 34, 8), '#8a93a3', { pos: [0, 17, 0] });
  solid.add(box(10, 5.6, 0.7), '#252a34', { pos: [0, 35.4, 0] });
  for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) glow.add(box(1.5, 1.4, 0.3), '#fff6d8', { pos: [-4 + c * 2, 33.8 + r * 1.6, 0.5] });
  return { solid: solid.build(), glow: glow.build() };
}

let crowdMatCache = null;
export function crowdTexture() {
  if (crowdMatCache) return crowdMatCache;
  crowdMatCache = canvasTex(512, 128, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const cols = ['#ff4f4f', '#ffd23f', '#4da3ff', '#ffffff', '#8ee000', '#ff7a1a', '#b57aff', '#2ee6c8'];
    for (let k = 0; k < 190; k++) {
      const x = Math.random() * w, y = 36 + Math.random() * 80, s = 11 + Math.random() * 5;
      ctx.fillStyle = cols[(Math.random() * cols.length) | 0]; ctx.beginPath(); ctx.ellipse(x, y + s, s * 0.8, s * 1.1, 0, 0, PI * 2); ctx.fill();
      ctx.fillStyle = ['#f2c9a0', '#d9a074', '#a8734c', '#6e4a30'][(Math.random() * 4) | 0]; ctx.beginPath(); ctx.arc(x, y - s * 0.35, s * 0.55, 0, PI * 2); ctx.fill();
    }
  });
  return crowdMatCache;
}

export function grandstand(length = 120, tiers = 9) {
  const solid = new GeoBuilder();
  const crowdParts = [];
  const tierH = 1.15, tierD = 1.7;
  for (let t = 0; t < tiers; t++) {
    const y = t * tierH, z = t * tierD;
    solid.add(box(length, tierH, tierD), (x, yy, zz) => lerpColor('#6a7284', '#8e96a8', Math.sin(x * 0.9) * 0.1 + 0.4), { pos: [0, y + tierH / 2, z] });
    // seat strips in team colours
    solid.add(box(length, 0.1, 0.9), (x) => (Math.floor(x / 12) % 2 ? C('#d6202c') : C('#1d4fd6')), { pos: [0, y + tierH + 0.04, z - 0.1] });
    const pl = new THREE.PlaneGeometry(length, 1.7);
    pl.translate(0, y + tierH + 0.85, z + 0.2);
    const uv = pl.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * length / 22 + t * 0.37);
    crowdParts.push(pl);
  }
  // back wall + roof canopy
  const backZ = tiers * tierD + 0.4;
  solid.add(box(length, tiers * tierH + 3, 1), '#4a4f60', { pos: [0, (tiers * tierH + 3) / 2, backZ] });
  solid.add(box(length + 4, 0.7, tiers * tierD + 5), '#e9edf4', { pos: [0, tiers * tierH + 6.6, tiers * tierD / 2 + 1.5], rot: [-0.08, 0, 0] });
  for (let x = -length / 2; x <= length / 2; x += 20) solid.add(cyl(0.3, 0.3, tiers * tierH + 6.6, 6), '#9aa3b4', { pos: [x, (tiers * tierH + 6.6) / 2, tiers * tierD * 0.15] });
  // front rail
  solid.add(box(length, 1.0, 0.2), '#cfd6e4', { pos: [0, 0.5, -1.0] });
  return { solid: solid.build(), crowd: mergeGeometries(crowdParts, false), depth: backZ };
}

export function blimp() {
  const solid = new GeoBuilder(), glow = new GeoBuilder();
  solid.add(sph(1, 24, 16), (x, y, z) => (z * 0.0 + Math.floor((x + 40) / 4) % 2 ? C('#f4f6fb') : C('#ffd23f')), { scale: [9, 8.5, 32] });
  for (const a of [0, PI / 2, PI, -PI / 2]) solid.add(box(0.5, 9, 9), '#d6202c', { pos: [Math.sin(a) * 2.8, Math.cos(a) * 2.8, -27], rot: [0, 0, a] });
  solid.add(box(3, 2.4, 9), '#2b3040', { pos: [0, -9.4, 2] });
  glow.add(box(2.4, 0.8, 7), '#fff0b0', { pos: [0, -9.4, 2.1] });
  return { solid: solid.build(), glow: glow.build() };
}

export function flagPole(color = '#ffd23f') {
  const b = new GeoBuilder();
  b.add(cyl(0.12, 0.16, 14, 6), '#e0e4ec', { pos: [0, 7, 0] });
  b.add(box(0.05, 2.4, 4.2), color, { pos: [0, 12.8, 2.3] });
  b.add(box(0.06, 0.8, 4.2), '#111', { pos: [0, 12.2, 2.3] });
  return b.build();
}

// ---------------------------------------------------------------- city
export function facadeTextures() {
  const col = canvasTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#3a4270'; ctx.fillRect(0, 0, w, h);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const px = 14 + x * 60, py = 12 + y * 62;
      ctx.fillStyle = '#161a30'; ctx.fillRect(px, py, 44, 46);
      ctx.fillStyle = 'rgba(120,150,230,0.22)'; ctx.fillRect(px, py, 44, 10);
    }
  }, { aniso: 8 });
  const emi = canvasTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
    const pal = ['#ffd98a', '#ffcf70', '#9ad8ff', '#ffb8e8', '#fff3c8'];
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      if (Math.random() < 0.42) { ctx.fillStyle = pal[(Math.random() * pal.length) | 0]; ctx.fillRect(14 + x * 60, 12 + y * 62, 44, 46); }
    }
  }, { aniso: 8 });
  return { col, emi };
}

export function building(w, h, d, seed = 0) {
  const b = new GeoBuilder();
  const tw = 12, th = 14;
  const parts = [];
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv, nrm = g.attributes.normal;
  const ox = hashPos(seed, 1, 2, 3), oy = hashPos(seed, 4, 5, 6);
  for (let i = 0; i < uv.count; i++) {
    const nx = Math.abs(nrm.getX(i)), ny = Math.abs(nrm.getY(i));
    if (ny > 0.5) { uv.setXY(i, 0.97, 0.97); continue; }
    const span = nx > 0.5 ? d : w;
    uv.setXY(i, uv.getX(i) * span / tw + ox, uv.getY(i) * h / th + oy);
  }
  g.translate(0, h / 2, 0);
  const geos = [g];
  // stepped crown + spire
  if (hashPos(seed, 7, 8, 9) > 0.45) {
    const c = new THREE.BoxGeometry(w * 0.62, h * 0.16, d * 0.62);
    const cu = c.attributes.uv; for (let i = 0; i < cu.count; i++) cu.setXY(i, 0.97, 0.97);
    c.translate(0, h + h * 0.08, 0); geos.push(c);
  }
  const sp = new THREE.CylinderGeometry(0.15, 0.4, 10, 5);
  const su = sp.attributes.uv; for (let i = 0; i < su.count; i++) su.setXY(i, 0.97, 0.97);
  sp.translate(0, h + (h * 0.16) + 4, 0); geos.push(sp);
  return mergeGeometries(geos.map((q) => { const x = q.index ? q.toNonIndexed() : q; return x; }), false);
}

export function streetlight() {
  const solid = new GeoBuilder(), glow = new GeoBuilder();
  solid.add(cyl(0.1, 0.16, 8, 6), '#3a3f4c', { pos: [0, 4, 0] });
  solid.add(cyl(0.07, 0.07, 2.6, 5).rotateZ(PI / 2), '#3a3f4c', { pos: [-1.2, 8, 0] });
  glow.add(box(0.9, 0.18, 0.4), '#ffe9b0', { pos: [-2.3, 7.9, 0] });
  return { solid: solid.build(), glow: glow.build() };
}

export function crane() {
  const b = new GeoBuilder();
  const orange = '#e8642a';
  for (const [x, z] of [[-6, -4], [6, -4], [-6, 4], [6, 4]]) b.add(box(0.9, 26, 0.9), orange, { pos: [x, 13, z] });
  b.add(box(13.4, 1.2, 9.4), orange, { pos: [0, 26.4, 0] });
  b.add(box(60, 1.6, 2.4), '#cfd5df', { pos: [14, 28.2, 0] });
  b.add(box(5, 4, 4), '#2b3040', { pos: [-2, 24.4, 0] });
  for (let k = 0; k < 6; k++) b.add(box(0.2, 8, 0.2), '#444', { pos: [8 + k * 8, 24, 0], rot: [0, 0, 0] });
  b.add(cyl(0.1, 0.1, 16, 5), '#222', { pos: [36, 20, 0] });
  b.add(box(5.4, 1, 2.4), '#d6202c', { pos: [36, 12, 0] });
  return b.build();
}

export function containers(rows = 4, cols = 3, levels = 3) {
  const b = new GeoBuilder();
  const pal = ['#d6402c', '#2f7fd6', '#f0b020', '#2fa86a', '#8a5cd6', '#e8e8ee', '#d6702c'];
  for (let l = 0; l < levels; l++) for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (l > 0 && hashPos(r, c, l, 5) > 0.7) continue;
    b.add(box(2.5, 2.6, 12), pal[Math.floor(hashPos(r, c, l, 2) * pal.length)], { pos: [c * 2.7, 1.3 + l * 2.65, r * 12.4] });
  }
  return b.build();
}

export function ship() {
  const b = new GeoBuilder();
  b.add(box(18, 8, 90), '#2b3a55', { pos: [0, 2, 0] });
  const bow = new THREE.ConeGeometry(9, 22, 4); bow.rotateX(PI / 2).rotateY(PI / 4);
  b.add(bow, '#2b3a55', { pos: [0, 2, 55], scale: [1, 0.44, 1] });
  b.add(box(18.2, 2, 90), '#9a2a2a', { pos: [0, -1.8, 0] });
  b.add(box(14, 10, 12), '#e8eaf0', { pos: [0, 11, -30] });
  b.add(box(8, 5, 6), '#cfd4e0', { pos: [0, 18, -30] });
  const pal = ['#d6402c', '#2f7fd6', '#f0b020', '#2fa86a'];
  for (let k = 0; k < 8; k++) for (const s of [-1, 1]) b.add(box(5.2, 4.8, 8.8), pal[(k + (s > 0 ? 1 : 0)) % 4], { pos: [s * 3.2, 8.6, 24 - k * 9.2] });
  return b.build();
}

export function ground2(w) { return w; }

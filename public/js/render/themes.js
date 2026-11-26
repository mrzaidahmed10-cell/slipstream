// Environment themes: lighting, terrain, road, walls and scenery for each track style.
import { THREE, canvasTex, fbm, noise2, mat4, glowTex, lerpColor } from './gfx.js';
import * as P from './props.js';
import { clamp, smoothstep, lerp } from '../core/util.js';

const PI = Math.PI;
const col = (h) => new THREE.Color(h);

let _mats = null;
function mats() {
  if (_mats) return _mats;
  _mats = {
    vc: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88 }),
    vcFlat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }),
    glow: new THREE.MeshBasicMaterial({ vertexColors: true, fog: true }),
  };
  return _mats;
}

function M(x, y, z, ry = 0, s = 1, rx = 0, rz = 0) { return mat4([x, y, z], [rx, ry, rz], typeof s === 'number' ? [s, s, s] : s); }

// place geometry at points
function place(ctx, geo, mat, pts, { s0 = 0.85, s1 = 1.3, yo = 0, rot = true, cast = false, sink = 0 } = {}) {
  const ms = pts.map((p) => M(p.x, p.y + yo - sink, p.z, rot ? p.r * PI * 12.37 : 0, lerp(s0, s1, (p.r * 7.31) % 1)));
  return ctx.inst(geo, mat, ms, { cast });
}

function glowPoints(ctx, positions, { color = '#ffe9b0', size = 9, opacity = 0.9 } = {}) {
  if (!positions.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions.flat(), 3));
  const m = new THREE.PointsMaterial({ map: glowTex(color, 64), size, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity, fog: false });
  const p = new THREE.Points(g, m); p.frustumCulled = false; ctx.group.add(p); return p;
}

// distant ring of silhouette hills
function horizonRing(ctx, { color = '#7c8fb4', top = '#aab8d6', h0 = 40, h1 = 150, seed = 3, radius = 1150, snow = false } = {}) {
  const segs = 180, g = new THREE.CylinderGeometry(radius, radius, 1, segs, 1, true);
  const p = g.attributes.position, c = new Float32Array(p.count * 3);
  const base = col(color), tp = col(top), t = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), up = p.getY(i) > 0;
    const a = Math.atan2(z, x);
    const hgt = h0 + (fbm(a * 3 + seed, 0.5, 4) * 0.7 + fbm(a * 11 + seed, 3.3, 3) * 0.3) * (h1 - h0);
    p.setY(i, up ? hgt : -80);
    t.copy(up ? tp : base);
    if (snow && up) t.lerp(col('#ffffff'), 0.5);
    c[i * 3] = t.r; c[i * 3 + 1] = t.g; c[i * 3 + 2] = t.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.BackSide, depthWrite: false }));
  const b = ctx.bounds;
  m.position.set((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
  m.renderOrder = -5; m.frustumCulled = false;
  ctx.group.add(m);
}

function straightRuns(track, minLen = 70, thr = 0.003) {
  const N = track.N, ks = new Float32Array(N);
  for (let i = 0; i < N; i++) { let m = 0; for (let d = -4; d <= 4; d += 2) m = Math.max(m, Math.abs(track.K[(i + d + N) % N])); ks[i] = m; }
  const runs = []; let s = -1;
  for (let i = 0; i <= N; i++) {
    const ok = i < N && ks[i] < thr;
    if (ok && s < 0) s = i;
    if ((!ok || i === N) && s >= 0) { if ((i - s) * track.step >= minLen) runs.push([s, i]); s = -1; }
  }
  return { runs, ks };
}

function facadeMaterial() {
  const { col: c, emi } = P.facadeTextures();
  return new THREE.MeshStandardMaterial({ map: c, emissiveMap: emi, emissive: 0xffffff, emissiveIntensity: 1.35, roughness: 0.55, metalness: 0.35 });
}

function noiseColor(out, a, b, n) { return out.copy(col(a)).lerp(col(b), clamp(n, 0, 1)); }

// ================================================================ THEMES
export const THEMES = {
  // ------------------------------------------------------------ STADIUM
  stadium: {
    light: { sun: '#ffb98a', sunInt: 2.7, sunDir: [0.55, 0.22, 0.62], hemiSky: '#7f93d0', hemiGround: '#3c3a52', hemiInt: 1.05, fog: '#b98a86', fogNear: 140, fogFar: 760, exposure: 1.02 },
    terrain: {
      ramp: 120,
      height: (x, z, d, t) => 3 + fbm(x / 90, z / 90, 3) * 9 + smoothstep(0, 1, t) * 7,
      color: (c, y, d, x, z) => { const stripe = Math.floor((x + z) / 14) % 2; noiseColor(c, stripe ? '#2f7a3a' : '#3a8c44', '#24632f', fbm(x / 40, z / 40, 3) * 0.7); if (d > 220) c.lerp(col('#59606e'), smoothstep(220, 320, d)); },
    },
    road: { base: '#3a3d45', line: '#f3f3f3', rough: 0.9, env: 0.35 },
    shoulder: (c, i, o) => { noiseColor(c, '#7d7a72', '#a39c8c', noise2(i * 0.3, Math.abs(o) * 0.4)); },
    wall: {
      rough: 0.8, jitter: 0, stride: 1,
      profile: [[0, 0], [0, 1.15], [0.55, 1.15], [0.55, 0]],
      color: (s, j, y, o) => { if (y > 1.1) return '#dfe3ea'; const blk = Math.floor(s / 4) % 2; return blk ? '#d6202c' : '#f2f2f2'; },
    },
    water: null, weather: null,
    scenery(ctx) {
      const m = mats(), { track } = ctx;
      horizonRing(ctx, { color: '#6f6a86', top: '#a58a9c', h0: 25, h1: 70, seed: 2 });
      const crowdMat = new THREE.MeshBasicMaterial({ map: P.crowdTexture(), transparent: true, alphaTest: 0.5, side: THREE.DoubleSide });
      const { runs } = straightRuns(track, 85);
      let side = 1, placed = 0;
      for (const [a, b] of runs) {
        if (placed >= 7) break;
        const i = Math.floor((a + b) / 2), s = side; side = -side;
        const L = Math.min(130, (b - a) * track.step - 10);
        const gs = P.grandstand(L, 9);
        const pt = track.pointAt(i, s * (track.W[i] / 2 + track.wallGap + 3));
        const rx = track.RX[i] * s, rz = track.RZ[i] * s;
        const grp = new THREE.Group();
        grp.add(new THREE.Mesh(gs.solid, m.vc), new THREE.Mesh(gs.crowd, crowdMat));
        grp.position.set(pt.x, 0, pt.z); grp.rotation.y = Math.atan2(rx, rz);
        ctx.group.add(grp); placed++;
        // flags on top of stand
        const fp = P.flagPole(['#ffd23f', '#d6202c', '#4da3ff'][placed % 3]);
        const fm = [];
        for (let k = -1; k <= 1; k += 2) { const p2 = track.pointAt(i + k * Math.floor(L / 3 / track.step), s * (track.W[i] / 2 + track.wallGap + 22)); fm.push(M(p2.x, 0, p2.z, Math.atan2(rx, rz))); }
        ctx.inst(fp, m.vc, fm);
      }
      // floodlights
      const fl = P.floodlight();
      const pts = ctx.along(10, { out: 26, jitter: 6 }).filter((p, k) => k % 2 === 0).slice(0, 10);
      const flm = pts.map((p) => M(p.x, 0, p.z, Math.atan2(track.X[p.i] - p.x, track.Z[p.i] - p.z)));
      ctx.inst(fl.solid, m.vc, flm, { cast: false });
      ctx.inst(fl.glow, m.glow, flm);
      glowPoints(ctx, pts.map((p) => [p.x, 34.5, p.z]), { size: 60, color: '#fff2c8', opacity: 0.55 });
      // tyre stacks on the outside of corners
      const ts = P.tireStack(); const tm = [];
      for (let i = 0; i < track.N; i += 3) {
        const k = track.K[i]; if (Math.abs(k) < 0.0085) continue;
        const side = k > 0 ? 1 : -1; // outside of the corner is opposite the inside
        const o = side * (track.W[i] / 2 + track.wallGap + 0.9);
        const p = track.pointAt(i, o); tm.push(M(p.x, 0, p.z, i));
      }
      ctx.inst(ts, m.vc, tm, { cast: true });
      // billboards
      const bb = canvasTex(512, 128, (c, w, h) => { c.fillStyle = '#0b1226'; c.fillRect(0, 0, w, h); c.fillStyle = '#ffd23f'; c.font = '900 76px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('SLIPSTREAM', w / 2, h / 2 + 4); }, { wrap: false });
      const bm = new THREE.MeshBasicMaterial({ map: bb, side: THREE.DoubleSide });
      for (const p of ctx.along(4, { out: 14, jitter: 2, sides: [1] }).slice(0, 3)) {
        const g = new THREE.Group();
        const sc = new THREE.Mesh(new THREE.PlaneGeometry(22, 5.5), bm); sc.position.y = 8;
        const l1 = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 6, 6), new THREE.MeshStandardMaterial({ color: 0x333a48 })); l1.position.set(-8, 3, 0);
        const l2 = l1.clone(); l2.position.x = 8;
        g.add(sc, l1, l2); g.position.set(p.x, 0, p.z); g.rotation.y = Math.atan2(track.X[p.i] - p.x, track.Z[p.i] - p.z);
        ctx.group.add(g);
      }
      // distant city
      const fm = facadeMaterial();
      const geos = [0, 1, 2, 3, 4, 5].map((k) => P.building(20 + (k % 3) * 10, 60 + k * 22, 20 + ((k + 1) % 3) * 8, k));
      const far = ctx.scatter(46, { min: 160, max: 420, minGap: 40 });
      geos.forEach((g, k) => ctx.inst(g, fm, far.filter((_, i) => i % 6 === k).map((p) => M(p.x, p.y - 1, p.z, p.r * 6)), {}));
      // trees
      const tree = P.pine({ snow: 0, dark: '#2c6a2e', light: '#4f9a3c' });
      place(ctx, tree, m.vc, ctx.scatter(120, { min: 24, max: 200 }), { s0: 0.8, s1: 1.5 });
      // blimp
      const bl = P.blimp(); const bg = new THREE.Group();
      bg.add(new THREE.Mesh(bl.solid, m.vc), new THREE.Mesh(bl.glow, m.glow));
      bg.scale.setScalar(2.2); ctx.group.add(bg);
      const cx = (ctx.bounds.minX + ctx.bounds.maxX) / 2, cz = (ctx.bounds.minZ + ctx.bounds.maxZ) / 2;
      ctx.animators.push((dt, t) => { const a = t * 0.04; bg.position.set(cx + Math.cos(a) * 240, 150, cz + Math.sin(a) * 260); bg.rotation.y = -a + PI; });
    },
  },

  // ------------------------------------------------------------ DESERT
  desert: {
    light: { sun: '#fff0cf', sunInt: 3.5, sunDir: [0.35, 0.78, 0.5], hemiSky: '#9ec3f5', hemiGround: '#d1a874', hemiInt: 1.15, fog: '#efd7b0', fogNear: 160, fogFar: 880, exposure: 1.02 },
    terrain: {
      ramp: 90,
      height: (x, z, d, t) => (fbm(x / 120, z / 120, 4) - 0.3) * 56 + (Math.abs(noise2(x / 38, z / 38) - 0.5)) * 4,
      color: (c, y, d, x, z) => {
        const rip = Math.abs(Math.sin((x * 0.4 + z * 0.9) * 0.12 + fbm(x / 50, z / 50, 3) * 5));
        noiseColor(c, '#d6a864', '#efc986', rip * 0.6 + fbm(x / 70, z / 70, 3) * 0.5);
        c.lerp(col('#b0703c'), clamp(smoothstep(8, -6, y) * 0.5, 0, 0.5));
      },
    },
    road: { base: '#4d4339', line: '#fff3d1', rough: 0.92, env: 0.3 },
    shoulder: (c, i, o) => { noiseColor(c, '#d3a867', '#e8c488', noise2(i * 0.2, Math.abs(o) * 0.3)); },
    wall: {
      rough: 1, jitter: 0.55, flat: true,
      profile: [[0, 0], [-0.35, 1.6], [0.1, 3.3], [1.4, 4.6], [3.6, 3.4], [4.8, 0]],
      color: (s, j, y, o) => lerpColor('#b4532f', '#e2a26a', clamp(y / 4.6 + Math.sin(y * 3.2 + s * 0.02) * 0.2, 0, 1)),
    },
    water: null, weather: null,
    scenery(ctx) {
      const m = mats(), { track } = ctx;
      horizonRing(ctx, { color: '#d9b585', top: '#c98a5a', h0: 30, h1: 90, seed: 6 });
      const mesaGeos = [0, 1, 2, 3].map((k) => P.mesa(k * 2 + 1, 30 + k * 8, 56 + k * 18));
      const mpts = ctx.scatter(16, { min: 110, max: 460, minGap: 110 });
      mesaGeos.forEach((g, k) => ctx.inst(g, m.vcFlat, mpts.filter((_, i) => i % 4 === k).map((p) => M(p.x, p.y - 8, p.z, p.r * 6, 0.9 + p.r * 0.7)), { cast: false }));
      const arch = P.rockArch(); ctx.inst(arch, m.vcFlat, ctx.scatter(2, { min: 120, max: 400, minGap: 200 }).map((p) => M(p.x, p.y - 2, p.z, p.r * 6, 1.1)));
      // canyon boulders along the walls
      const rockGeos = [0, 1, 2].map((k) => P.rock(k * 5, '#a8482c', '#e0a56c', 1.2));
      const al = ctx.along(220, { out: 5, jitter: 12 });
      rockGeos.forEach((g, k) => ctx.inst(g, m.vcFlat, al.filter((_, i) => i % 3 === k).map((p) => M(p.x, p.y + 1.0, p.z, p.r * 6, 2.4 + p.r * 4.5)), { cast: false }));
      place(ctx, P.cactus(0), m.vc, ctx.scatter(90, { min: 7, max: 160, minGap: 9 }), { s0: 0.8, s1: 1.5 });
      place(ctx, P.cactus(1), m.vc, ctx.scatter(60, { min: 9, max: 220, minGap: 9 }), { s0: 0.8, s1: 1.7 });
      place(ctx, P.deadTree(), m.vc, ctx.scatter(26, { min: 12, max: 200 }), { s0: 0.9, s1: 1.6 });
      place(ctx, P.shrub(), m.vc, ctx.scatter(180, { min: 5, max: 140 }), { s0: 0.8, s1: 1.7 });
      const rg = P.rock(9, '#9a7a54', '#d8b88a');
      place(ctx, rg, m.vcFlat, ctx.scatter(150, { min: 6, max: 260 }), { s0: 0.6, s1: 2.6, yo: 0.2 });
    },
  },

  // ------------------------------------------------------------ WINTER
  winter: {
    light: { sun: '#ffd0a8', sunInt: 2.5, sunDir: [-0.6, 0.2, 0.55], hemiSky: '#8fb0ff', hemiGround: '#e4efff', hemiInt: 1.35, fog: '#aab9de', fogNear: 120, fogFar: 760, exposure: 1.06 },
    terrain: {
      ramp: 110,
      height: (x, z, d, t) => (fbm(x / 130, z / 130, 4) - 0.3) * 50 + smoothstep(220, 420, d) * fbm(x / 260 + 4, z / 260, 3) * 90,
      color: (c, y, d, x, z) => { noiseColor(c, '#eef4ff', '#cfe0ff', fbm(x / 36, z / 36, 3) * 0.9); if (y < -2) c.lerp(col('#a9cdf5'), 0.5); },
    },
    road: { base: '#4b5362', line: '#e8f2ff', rough: 0.72, metal: 0.05, env: 0.7 },
    shoulder: (c, i, o) => { noiseColor(c, '#e8f0ff', '#f7fbff', noise2(i * 0.2, Math.abs(o) * 0.3)); },
    wall: {
      rough: 0.9, jitter: 0.35,
      profile: [[0, 0], [-0.25, 0.9], [0.3, 1.7], [1.4, 2.2], [2.8, 1.5], [3.8, 0]],
      color: (s, j, y, o) => lerpColor('#c9d9f6', '#ffffff', clamp(y / 2.2 + noise2(s * 0.2, j) * 0.2, 0, 1)),
    },
    water: null, weather: 'snow',
    scenery(ctx) {
      const m = mats(), { track } = ctx;
      horizonRing(ctx, { color: '#9bb0da', top: '#dbe6ff', h0: 60, h1: 190, seed: 11, snow: true });
      // big mountains
      const cx = (ctx.bounds.minX + ctx.bounds.maxX) / 2, cz = (ctx.bounds.minZ + ctx.bounds.maxZ) / 2;
      const R = Math.max(ctx.bounds.maxX - ctx.bounds.minX, ctx.bounds.maxZ - ctx.bounds.minZ) / 2 + 40;
      const mg = [0, 1, 2].map((k) => P.mountain(k * 3, 170 + k * 40, 150 + k * 50));
      mg.forEach((g, k) => { const ms = []; for (let a = k; a < 14; a += 3) { const ang = (a / 14) * PI * 2 + 0.3; ms.push(M(cx + Math.cos(ang) * R, -26, cz + Math.sin(ang) * R, a, 1)); } ctx.inst(g, m.vcFlat, ms); });
      const tree = P.pine({ snow: 0.95 });
      place(ctx, tree, m.vc, ctx.scatter(520, { min: 5, max: 280, minGap: 5 }), { s0: 0.7, s1: 1.7 });
      const al = ctx.along(180, { out: 6, jitter: 10 });
      place(ctx, tree, m.vc, al, { s0: 0.8, s1: 1.5 });
      place(ctx, P.snowman(), m.vc, ctx.along(26, { out: 4, jitter: 3 }).filter((_, i) => i % 5 === 0), { s0: 1.0, s1: 1.5 });
      place(ctx, P.iceSpire(), m.vc, ctx.scatter(34, { min: 12, max: 220 }), { s0: 0.8, s1: 2.0 });
      const cab = P.cabin();
      const cp = ctx.scatter(7, { min: 30, max: 190, minGap: 40, maxY: 12 });
      ctx.inst(cab.solid, m.vc, cp.map((p) => M(p.x, p.y, p.z, p.r * 6, 1.4)), { cast: false });
      ctx.inst(cab.glow, m.glow, cp.map((p) => M(p.x, p.y, p.z, p.r * 6, 1.4)));
      glowPoints(ctx, cp.map((p) => [p.x, p.y + 3.5, p.z]), { size: 26, color: '#ffcf70', opacity: 0.6 });
      const rg = P.rock(4, '#6a7284', '#e7eefc');
      place(ctx, rg, m.vcFlat, ctx.scatter(120, { min: 6, max: 260 }), { s0: 0.6, s1: 2.8, yo: 0.1 });
      // festive pennant posts along the wall
      const pp = ctx.along(70, { out: -0.6, jitter: 0.2 });
      const post = new THREE.CylinderGeometry(0.1, 0.1, 5, 5).translate(0, 2.5, 0);
      ctx.inst(post, new THREE.MeshStandardMaterial({ color: 0x8a5c34, roughness: 0.8 }), pp.map((p) => M(p.x, 0, p.z, 0)));
    },
  },

  // ------------------------------------------------------------ BEACH
  beach: {
    light: { sun: '#ffc68c', sunInt: 2.3, sunDir: [-0.45, 0.42, 0.25], hemiSky: '#a9cdea', hemiGround: '#e6bf72', hemiInt: 0.85, fog: '#f1d9bc', fogNear: 170, fogFar: 940, exposure: 0.95 },
    terrain: {
      ramp: 130,
      height: (x, z, d, t) => {
        const base = 0.5 - 6.5 * Math.pow(t, 1.6) + (fbm(x / 60, z / 60, 3) - 0.5) * 0.7 * (1 - t);
        const n = fbm(x / 150 + 9, z / 150, 3);
        const island = smoothstep(0.58, 0.72, n) * smoothstep(0.35, 0.7, t) * 14;
        return base + island;
      },
      color: (c, y, d, x, z) => {
        if (y > 4.2) noiseColor(c, '#3f9a4a', '#2c7a3a', fbm(x / 20, z / 20, 3));
        else if (y > -0.45) noiseColor(c, '#e9c47a', '#f6d794', fbm(x / 30, z / 30, 3));
        else if (y > -0.85) noiseColor(c, '#cdb27c', '#bd9f68', fbm(x / 30, z / 30, 3));
        else noiseColor(c, '#8fd6cf', '#4fb6c4', clamp((-y - 0.8) / 4, 0, 1));
        if (Math.abs(y + 0.9) < 0.22) c.lerp(col('#ffffff'), 0.55);
      },
    },
    road: { base: '#5a5d63', line: '#ffffff', rough: 0.85, env: 0.4 },
    shoulder: (c, i, o) => { noiseColor(c, '#e6c07a', '#f3d697', noise2(i * 0.25, Math.abs(o) * 0.3)); },
    wall: {
      rough: 0.85, jitter: 0.25,
      profile: [[0, 0], [0, 1.1], [0.5, 1.1], [0.5, 0.7], [1.6, 1.3], [3.4, 1.7], [5.2, 0.7], [6.2, 0]],
      color: (s, j, y, o) => {
        if (j <= 2) { if (y > 1.05) return '#2fb5c8'; return Math.floor(s / 3) % 2 ? '#fdfdfd' : '#e9e2d0'; }
        return lerpColor('#f3dba2', '#e8c98a', noise2(s * 0.2, j));
      },
    },
    water: { level: -0.9, color: '#27c3cf', opacity: 0.8 }, weather: null,
    scenery(ctx) {
      const m = mats(), { track } = ctx;
      horizonRing(ctx, { color: '#8fc0d8', top: '#a9c8d6', h0: 6, h1: 26, seed: 8 });
      const palms = [P.palm(0), P.palm(1), P.palm(2)];
      const al = ctx.along(190, { out: 3.5, jitter: 9 });
      palms.forEach((g, k) => ctx.inst(g, m.vc, al.filter((_, i) => i % 3 === k).filter((p) => p.y > 0.1).map((p) => M(p.x, p.y, p.z, p.r * 6, 0.9 + p.r * 0.5)), { cast: false }));
      const sc = ctx.scatter(160, { min: 6, max: 260, minY: 0.2, minGap: 6 });
      palms.forEach((g, k) => ctx.inst(g, m.vc, sc.filter((_, i) => i % 3 === k).map((p) => M(p.x, p.y, p.z, p.r * 6, 0.8 + p.r * 0.7)), { cast: false }));
      ['#ff4f6a', '#ffb02e', '#2fb5c8', '#8a5cd6'].forEach((c, k) => {
        const g = P.umbrella(c);
        const pts = ctx.along(40, { out: 9, jitter: 6 }).filter((p, i) => i % 4 === k && p.y > 0.2);
        ctx.inst(g, m.vc, pts.map((p) => M(p.x, p.y, p.z, p.r * 6, 1)), { cast: false });
      });
      place(ctx, P.tikiHut(), m.vc, ctx.along(24, { out: 12, jitter: 5 }).filter((p, i) => i % 4 === 0 && p.y > 0.2), { s0: 1, s1: 1.3 });
      // boats
      const boats = ctx.scatter(26, { min: 70, max: 380, maxY: -2.2, minGap: 40 });
      place(ctx, P.sailboat(), m.vc, boats, { s0: 1.0, s1: 1.8, yo: 0.2 });
      // lighthouse on an island
      const lh = P.lighthouse(); const lp = ctx.scatter(2, { min: 90, max: 420, minY: 5, minGap: 100 });
      ctx.inst(lh.solid, m.vc, lp.map((p) => M(p.x, p.y - 0.5, p.z, 0, 1.4)));
      ctx.inst(lh.glow, m.glow, lp.map((p) => M(p.x, p.y - 0.5, p.z, 0, 1.4)));
      glowPoints(ctx, lp.map((p) => [p.x, p.y + 48, p.z]), { size: 80, color: '#fff2b0', opacity: 0.7 });
      // ferris wheel on the nearest land
      const fw = P.ferrisWheel(); const fp = ctx.scatter(1, { min: 40, max: 140, minY: 0.3, attempts: 200 });
      if (fp.length) {
        const g = new THREE.Group(); const wheel = new THREE.Group(); wheel.position.y = 24;
        const sol = new THREE.Mesh(fw.solid, m.vc), glw = new THREE.Mesh(fw.glow, m.glow);
        // split: rotate everything except support legs by rotating the whole thing slowly (legs are thin, acceptable)
        g.add(sol, glw); g.position.set(fp[0].x, fp[0].y, fp[0].z); g.rotation.y = 0.6; g.scale.setScalar(1.3);
        ctx.group.add(g);
      }
      place(ctx, P.rock(7, '#8a8478', '#d6cfbe'), m.vcFlat, ctx.scatter(110, { min: 6, max: 260, minY: -0.3 }), { s0: 0.6, s1: 2.4, yo: 0.1 });
    },
  },

  // ------------------------------------------------------------ FOREST
  forest: {
    light: { sun: '#fff0c0', sunInt: 2.6, sunDir: [0.4, 0.55, 0.7], hemiSky: '#a9d0c8', hemiGround: '#506a3c', hemiInt: 1.1, fog: '#cfe0c6', fogNear: 50, fogFar: 520, exposure: 1.0 },
    terrain: {
      ramp: 80,
      height: (x, z, d, t) => (fbm(x / 80, z / 80, 4) - 0.28) * 54 + 2,
      color: (c, y, d, x, z) => { noiseColor(c, '#35552c', '#587a38', fbm(x / 28, z / 28, 4)); if (fbm(x / 18 + 5, z / 18, 3) > 0.62) c.lerp(col('#6a4a2c'), 0.4); },
    },
    road: { base: '#3d3b36', line: '#f2e8c6', rough: 0.92, env: 0.3 },
    shoulder: (c, i, o) => { noiseColor(c, '#5d4a30', '#7a6040', noise2(i * 0.3, Math.abs(o) * 0.5)); },
    wall: {
      rough: 1, jitter: 0.45, flat: true,
      profile: [[0, 0], [-0.2, 1.3], [0.5, 2.5], [1.8, 2.9], [3.0, 1.7], [3.8, 0]],
      color: (s, j, y, o) => lerpColor('#4a3a2a', '#4f7a3a', clamp(y / 2.9 + noise2(s * 0.3, j * 2) * 0.3, 0, 1)),
    },
    water: null, weather: null,
    scenery(ctx) {
      const m = mats(), { track } = ctx;
      horizonRing(ctx, { color: '#7da28a', top: '#9fbfa8', h0: 40, h1: 130, seed: 4 });
      const rw = P.redwood();
      place(ctx, rw, m.vc, ctx.scatter(330, { min: 4, max: 240, minGap: 8 }), { s0: 0.8, s1: 1.45, sink: 0.5 });
      place(ctx, rw, m.vc, ctx.along(180, { out: 3, jitter: 10 }), { s0: 0.8, s1: 1.3, sink: 0.5 });
      place(ctx, P.fern(), m.vc, ctx.scatter(420, { min: 4, max: 90 }), { s0: 0.8, s1: 1.8 });
      place(ctx, P.fern(), m.vc, ctx.along(240, { out: 2, jitter: 4 }), { s0: 1.0, s1: 2.0 });
      place(ctx, P.mushroom(), m.vc, ctx.scatter(70, { min: 4, max: 80 }), { s0: 0.8, s1: 2.0 });
      place(ctx, P.fallenLog(), m.vc, ctx.scatter(30, { min: 8, max: 160 }), { s0: 0.8, s1: 1.4 });
      place(ctx, P.rock(5, '#4a5a46', '#8aa07a'), m.vcFlat, ctx.scatter(100, { min: 5, max: 200 }), { s0: 0.7, s1: 3.0, yo: 0.2 });
      // light shafts
      const beam = canvasTex(64, 256, (c, w, h) => { const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(255,245,200,0.0)'); g.addColorStop(0.2, 'rgba(255,245,200,0.55)'); g.addColorStop(1, 'rgba(255,245,200,0)'); c.fillStyle = g; c.fillRect(0, 0, w, h); const g2 = c.createLinearGradient(0, 0, w, 0); g2.addColorStop(0, 'rgba(0,0,0,1)'); g2.addColorStop(0.5, 'rgba(0,0,0,0)'); g2.addColorStop(1, 'rgba(0,0,0,1)'); c.globalCompositeOperation = 'destination-out'; c.fillStyle = g2; c.fillRect(0, 0, w, h); }, { wrap: false });
      const bm = new THREE.MeshBasicMaterial({ map: beam, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, opacity: 0.32, fog: true });
      const geo = new THREE.PlaneGeometry(9, 46);
      const bp = ctx.along(60, { out: 12, jitter: 8 }).filter((_, i) => i % 5 === 0);
      ctx.inst(geo, bm, bp.map((p) => M(p.x, 22, p.z, p.r * 6, 1, 0.0, 0.18)));
      ctx.inst(geo, bm, bp.map((p) => M(p.x, 22, p.z, p.r * 6 + PI / 2, 1, 0.0, 0.18)));
    },
  },

  // ------------------------------------------------------------ CITY
  city: {
    light: { sun: '#9db4ff', sunInt: 1.7, sunDir: [-0.45, 0.55, 0.7], hemiSky: '#6252c8', hemiGround: '#2a2050', hemiInt: 1.25, fog: '#241a4a', fogNear: 110, fogFar: 760, exposure: 1.25 },
    terrain: {
      ramp: 60,
      height: (x, z, d, t) => { const mk = fbm(x / 200 + 3, z / 200, 3); return -0.08 - smoothstep(0.62, 0.7, mk) * smoothstep(20, 50, d) * 7; },
      color: (c, y, d, x, z) => { const gx = Math.abs(((x % 70) + 70) % 70 - 35), gz = Math.abs(((z % 70) + 70) % 70 - 35); const lane = gx > 31 || gz > 31 ? 0.18 : 0; noiseColor(c, '#1a1c28', '#262a3a', fbm(x / 30, z / 30, 3) + lane); if (y < -2) c.lerp(col('#0a1626'), 0.7); },
      rough: 0.6,
    },
    road: { base: '#22242d', line: '#f4f6ff', rough: 0.32, metal: 0.2, env: 1.5 },
    shoulder: (c, i, o) => { noiseColor(c, '#3b3f50', '#4d5268', noise2(i * 0.3, Math.abs(o) * 0.5)); },
    wall: {
      rough: 0.6, jitter: 0, stride: 1,
      profile: [[-0.5, 0], [-0.5, 0.25], [-0.12, 0.8], [-0.12, 1.45], [0.55, 1.45], [0.55, 0]],
      color: (s, j, y, o) => { if (y > 1.4) return '#9ef0ff'; if (j === 1) return Math.floor(s / 4) % 2 ? '#ffd23f' : '#1a1a22'; return '#7e8398'; },
    },
    water: { level: -1.8, color: '#0c2a4a', opacity: 0.92 }, weather: 'rain',
    scenery(ctx) {
      const m = mats(), { track } = ctx;
      horizonRing(ctx, { color: '#2a1a4a', top: '#4a2a6a', h0: 40, h1: 120, seed: 5 });
      const fm = facadeMaterial();
      const bg = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => P.building(26 + (k % 4) * 8, 50 + (k * 17) % 90, 26 + ((k + 2) % 4) * 9, k + 1));
      const lining = ctx.along(210, { out: 30, jitter: 16 }).filter((p) => p.y > -0.5);
      bg.forEach((g, k) => ctx.inst(g, fm, lining.filter((_, i) => i % 8 === k).map((p) => M(p.x, 0, p.z, Math.round(p.r * 4) * PI / 2 + Math.atan2(p.x, p.z) * 0)), { cast: false }));
      const far = ctx.scatter(130, { min: 50, max: 420, minGap: 44, minY: -0.5 });
      const tall = [0, 1, 2, 3].map((k) => P.building(34 + k * 7, 140 + k * 45, 34 + k * 5, 20 + k));
      tall.forEach((g, k) => ctx.inst(g, fm, far.filter((_, i) => i % 4 === k).map((p) => M(p.x, 0, p.z, Math.round(p.r * 4) * PI / 2)), { cast: false }));
      // street lights
      const sl = P.streetlight(); const lamps = [];
      const sm = [];
      for (let i = 0; i < track.N; i += 5) for (const s of [-1, 1]) {
        const o = s * (track.W[i] / 2 + track.wallGap + 1.4); const p = track.pointAt(i, o);
        const rx = track.RX[i] * s, rz = track.RZ[i] * s; // away from track
        sm.push(M(p.x, 0, p.z, Math.atan2(-rz, rx)));
        lamps.push([p.x - rx * 2.3, 7.9, p.z - rz * 2.3]);
      }
      ctx.inst(sl.solid, m.vc, sm); ctx.inst(sl.glow, m.glow, sm);
      glowPoints(ctx, lamps, { size: 14, color: '#ffe0a0', opacity: 0.75 });
      // neon signs
      const neonCols = ['#ff2ea6', '#2ee6ff', '#ffd23f', '#8a5cff', '#37ff9a'];
      const nGeo = new THREE.BoxGeometry(1, 1, 0.3);
      const nMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const np = ctx.along(70, { out: 16, jitter: 6 }).filter((p) => p.y > -0.5);
      const nm = np.map((p) => { const w = 4 + p.r * 9; return M(p.x, 8 + p.r * 22, p.z, Math.atan2(track.X[p.i] - p.x, track.Z[p.i] - p.z), [w, 0.8 + (p.r * 3.7 % 1) * 1.4, 1]); });
      const nmesh = ctx.inst(nGeo, nMat, nm);
      np.forEach((p, i) => nmesh.setColorAt(i, col(neonCols[i % neonCols.length])));
      if (nmesh.instanceColor) nmesh.instanceColor.needsUpdate = true;
      glowPoints(ctx, np.map((p) => [p.x, 8 + p.r * 22, p.z]), { size: 36, color: '#ff9ad8', opacity: 0.55 });
      // harbour: cranes, containers, ships
      place(ctx, P.crane(), m.vc, ctx.scatter(5, { min: 70, max: 240, minGap: 90, minY: -0.5 }), { s0: 1, s1: 1.3 });
      place(ctx, P.containers(4, 3, 3), m.vc, ctx.scatter(14, { min: 40, max: 220, minGap: 40, minY: -0.5 }), { s0: 1, s1: 1 });
      place(ctx, P.ship(), m.vc, ctx.scatter(4, { min: 60, max: 400, maxY: -3.2, minGap: 150 }), { s0: 1.2, s1: 1.7, yo: -0.2 });
    },
  },
};

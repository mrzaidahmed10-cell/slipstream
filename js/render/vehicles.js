// Procedural vehicle models (3 karts + 3 small cars). Static parts are merged per material
// into a handful of meshes; wheels, head and steering wheel stay separate so they can animate.
import { THREE, mergeGeometries, toCreasedNormals, canvasTex } from './gfx.js';
import { VEHICLE_BY_ID, PAINT_BY_ID } from '../core/vehicles.js';

const V3 = THREE.Vector3;
const PI = Math.PI;

// ============================================================ geometry helpers
function smoothPoly(pts, iters = 2) {
  let p = pts;
  for (let it = 0; it < iters; it++) {
    const out = [];
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    p = out;
  }
  return p;
}

function shapeFrom(pts) {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  s.closePath();
  return s;
}

// Side-profile (z,y) polygon extruded across the car's width (x). Optional vertex deformer.
function profileSolid(pts, width, { smooth = 2, bevel = 0.07, deform = null, crease = 0.85 } = {}) {
  const shape = shapeFrom(smoothPoly(pts, smooth));
  const bt = bevel;
  const g = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.01, width - 2 * bt), bevelEnabled: true, bevelThickness: bt, bevelSize: bt * 0.8, bevelSegments: 3, curveSegments: 4 });
  g.translate(0, 0, -(width - 2 * bt) / 2);
  g.rotateY(-PI / 2); // x_s -> z, extrusion -> x
  if (deform) {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const o = deform(p.getX(i), p.getY(i), p.getZ(i));
      p.setXYZ(i, o[0], o[1], o[2]);
    }
  }
  return toCreasedNormals(g, crease);
}

function rbox(w, h, d, r = 0.05) {
  r = Math.min(r, w / 2 - 0.002, h / 2 - 0.002, d / 2 - 0.002);
  const bs = r * 0.6, bt = r * 0.6;
  const iw = Math.max(0.002, w - 2 * bs), ih = Math.max(0.002, h - 2 * bs);
  const x = -iw / 2, y = -ih / 2, rr = Math.max(0.001, r - bs);
  const s = new THREE.Shape();
  s.moveTo(x + rr, y);
  s.lineTo(x + iw - rr, y); s.quadraticCurveTo(x + iw, y, x + iw, y + rr);
  s.lineTo(x + iw, y + ih - rr); s.quadraticCurveTo(x + iw, y + ih, x + iw - rr, y + ih);
  s.lineTo(x + rr, y + ih); s.quadraticCurveTo(x, y + ih, x, y + ih - rr);
  s.lineTo(x, y + rr); s.quadraticCurveTo(x, y, x + rr, y);
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.002, d - 2 * bt), bevelEnabled: true, bevelThickness: bt, bevelSize: bs, bevelSegments: 2, curveSegments: 3 });
  g.translate(0, 0, -(d - 2 * bt) / 2);
  return toCreasedNormals(g, 0.9);
}

function ellipsoid(rx, ry, rz, ws = 24, hs = 16) {
  const g = new THREE.SphereGeometry(1, ws, hs);
  g.scale(rx, ry, rz);
  return g;
}

function cyl(r1, r2, h, seg = 16) { return new THREE.CylinderGeometry(r1, r2, h, seg); }

function lathe(profile, seg = 32) {
  return new THREE.LatheGeometry(profile.map((p) => new THREE.Vector2(p[0], p[1])), seg);
}

// Matrix for a capsule/cylinder spanning a -> b (geometry has its axis along Y).
function between(a, b) {
  const A = new V3(...a), B = new V3(...b);
  const mid = A.clone().add(B).multiplyScalar(0.5);
  const dir = B.clone().sub(A);
  const len = dir.length();
  const q = new THREE.Quaternion().setFromUnitVectors(new V3(0, 1, 0), dir.normalize());
  return { mid, q, len };
}
function limbMatrix(a, b) {
  const { mid, q } = between(a, b);
  return new THREE.Matrix4().compose(mid, q, new V3(1, 1, 1));
}

function M(pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1]) {
  const e = new THREE.Euler(rot[0], rot[1], rot[2], 'YXZ');
  const q = new THREE.Quaternion().setFromEuler(e);
  if (typeof scale === 'number') scale = [scale, scale, scale];
  return new THREE.Matrix4().compose(new V3(pos[0], pos[1], pos[2]), q, new V3(scale[0], scale[1], scale[2]));
}

// Collects geometry per material key and merges at the end.
class Parts {
  constructor() { this.m = new Map(); }
  add(key, geo, matrix = new THREE.Matrix4()) {
    if (!this.m.has(key)) this.m.set(key, []);
    this.m.get(key).push({ geo, matrix });
    return this;
  }
  mirror(key, geo, pos, rot = [0, 0, 0], scale = [1, 1, 1]) {
    this.add(key, geo, M(pos, rot, scale));
    // mirrored copy across x (flip rotation y/z)
    const mp = [-pos[0], pos[1], pos[2]];
    const g2 = geo;
    const mat = M(mp, [rot[0], -rot[1], -rot[2]], scale);
    this.add(key, g2, mat);
    return this;
  }
  build() {
    const out = {};
    for (const [key, list] of this.m) {
      const gs = list.map(({ geo, matrix }) => {
        let g = geo.clone();
        g.applyMatrix4(matrix);
        if (g.index) g = g.toNonIndexed();
        for (const n of Object.keys(g.attributes)) if (n !== 'position' && n !== 'normal') g.deleteAttribute(n);
        if (!g.attributes.normal) g.computeVertexNormals();
        return g;
      });
      out[key] = mergeGeometries(gs, false);
    }
    return out;
  }
}

// ============================================================ materials
const shared = {};
function sharedMats() {
  if (shared.ready) return shared;
  shared.carbon = new THREE.MeshStandardMaterial({ color: 0x16191f, roughness: 0.55, metalness: 0.45 });
  shared.metal = new THREE.MeshStandardMaterial({ color: 0x9aa3ae, roughness: 0.32, metalness: 0.95 });
  shared.chrome = new THREE.MeshStandardMaterial({ color: 0xe6ebf2, roughness: 0.08, metalness: 1.0 });
  shared.rubber = new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.92, metalness: 0.0 });
  shared.glass = new THREE.MeshPhysicalMaterial({ color: 0x0c1626, roughness: 0.04, metalness: 0.7, transparent: true, opacity: 0.88, clearcoat: 1 });
  shared.lightW = new THREE.MeshBasicMaterial({ color: 0xfff3c4 });
  shared.lightR = new THREE.MeshBasicMaterial({ color: 0xff2a2a });
  shared.lightA = new THREE.MeshBasicMaterial({ color: 0xffb020 });
  shared.interior = new THREE.MeshStandardMaterial({ color: 0x1d1f26, roughness: 0.85 });
  shared.dark = new THREE.MeshStandardMaterial({ color: 0x07080b, roughness: 0.7, metalness: 0.2 });
  shared.visor = new THREE.MeshPhysicalMaterial({ color: 0x0a1220, roughness: 0.03, metalness: 0.85, clearcoat: 1 });
  shared.bronze = new THREE.MeshStandardMaterial({ color: 0xc88a3a, roughness: 0.3, metalness: 0.95 });
  shared.ready = true;
  return shared;
}

const paintCache = new Map();
function paintMats(color, accent) {
  const key = color + '|' + accent;
  if (paintCache.has(key)) return paintCache.get(key);
  const o = {
    paint: new THREE.MeshPhysicalMaterial({ color, metalness: 0.3, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.07 }),
    accent: new THREE.MeshPhysicalMaterial({ color: accent, metalness: 0.2, roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.12 }),
    suit: new THREE.MeshStandardMaterial({ color: accent, roughness: 0.7 }),
    helmet: new THREE.MeshPhysicalMaterial({ color, metalness: 0.25, roughness: 0.25, clearcoat: 1 }),
    stripe: new THREE.MeshStandardMaterial({ color: accent, roughness: 0.4, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  };
  paintCache.set(key, o);
  return o;
}

let _numberTex = new Map();
function numberTexture(n, bg, fg) {
  const key = n + bg + fg;
  if (_numberTex.has(key)) return _numberTex.get(key);
  const t = canvasTex(128, 128, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(w / 2, h / 2, w * 0.46, 0, PI * 2); ctx.fill();
    ctx.lineWidth = 6; ctx.strokeStyle = fg; ctx.stroke();
    ctx.fillStyle = fg; ctx.font = 'bold 78px system-ui, Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(n), w / 2, h / 2 + 6);
  }, { wrap: false });
  _numberTex.set(key, t);
  return t;
}

// ============================================================ wheels
const wheelCache = new Map();
function wheelBlueprint(R, w, rimKind = 'sport') {
  const key = [R, w, rimKind].join('|');
  if (wheelCache.has(key)) return wheelCache.get(key);
  const rimR = R * 0.62;
  // tyre
  const prof = [
    [rimR, -w / 2], [R - 0.07, -w / 2], [R - 0.025, -w / 2 + 0.035], [R - 0.004, -w / 2 + 0.1],
    [R, -w * 0.3], [R, w * 0.3],
    [R - 0.004, w / 2 - 0.1], [R - 0.025, w / 2 - 0.035], [R - 0.07, w / 2], [rimR, w / 2],
  ];
  const tire = lathe(prof, 36); tire.rotateZ(PI / 2);
  // tread blocks: shallow ridges
  const ridges = [];
  const nBlocks = 22;
  for (let i = 0; i < nBlocks; i++) {
    const a = (i / nBlocks) * PI * 2;
    const b = new THREE.BoxGeometry(w * 0.82, 0.018, 0.05);
    const m = new THREE.Matrix4().compose(new V3(0, Math.cos(a) * (R + 0.004), Math.sin(a) * (R + 0.004)), new THREE.Quaternion().setFromAxisAngle(new V3(1, 0, 0), -a), new V3(1, 1, 1));
    ridges.push({ geo: b, matrix: m });
  }
  const rimParts = new Parts();
  // barrel + lip
  const barrel = lathe([[rimR * 0.2, w * 0.28], [rimR * 0.96, w * 0.36], [rimR, w * 0.42], [rimR * 0.98, w * 0.46], [rimR * 0.9, w * 0.2], [rimR * 0.9, -w * 0.3], [rimR * 0.2, -w * 0.28]], 28);
  barrel.rotateZ(PI / 2);
  rimParts.add('rim', barrel);
  const spokes = rimKind === 'rally' ? 6 : 5;
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * PI * 2;
    const sp = new THREE.BoxGeometry(w * 0.18, rimR * 0.86, rimR * 0.2);
    rimParts.add('rim', sp, new THREE.Matrix4().compose(new V3(w * 0.34, Math.cos(a) * rimR * 0.5, Math.sin(a) * rimR * 0.5), new THREE.Quaternion().setFromAxisAngle(new V3(1, 0, 0), -a), new V3(1, 1, 1)));
  }
  rimParts.add('hub', cyl(rimR * 0.2, rimR * 0.2, w * 0.1, 12).rotateZ(PI / 2), M([w * 0.4, 0, 0]));
  rimParts.add('disc', cyl(rimR * 0.78, rimR * 0.78, 0.025, 28).rotateZ(PI / 2), M([-w * 0.12, 0, 0]));
  rimParts.add('disc', rbox(0.05, rimR * 0.34, rimR * 0.46, 0.012), M([-w * 0.12, rimR * 0.64, 0]));
  const rp = rimParts.build();
  const bp = { tire: mergeGeometries([tire, ...ridges.map(({ geo, matrix }) => { const g = geo.clone().applyMatrix4(matrix); return g.index ? g.toNonIndexed() : g; }).map((g) => { for (const n of Object.keys(g.attributes)) if (n !== 'position' && n !== 'normal') g.deleteAttribute(n); return g; })].map((g) => { let x = g.index ? g.toNonIndexed() : g; for (const n of Object.keys(x.attributes)) if (n !== 'position' && n !== 'normal') x.deleteAttribute(n); return x; }), false), rim: rp.rim, hub: rp.hub, disc: rp.disc, R, w, rimKind };
  wheelCache.set(key, bp);
  return bp;
}

function makeWheel(bp, M_, rimMat) {
  const spin = new THREE.Group();
  const tire = new THREE.Mesh(bp.tire, M_.rubber); tire.castShadow = true;
  const rim = new THREE.Mesh(bp.rim, rimMat);
  const hub = new THREE.Mesh(bp.hub, M_.accent);
  const disc = new THREE.Mesh(bp.disc, M_.carbon);
  spin.add(tire, rim, hub, disc);
  return spin;
}

// ============================================================ blueprint cache
const blueprints = new Map();

function kartBlueprint(look) {
  const P = new Parts();
  const W = look.width, nose = look.nose, tireK = look.tire;
  const Rr = 0.38 * tireK, wr = 0.36 * tireK, Rf = 0.3 * tireK, wf = 0.24 * tireK;
  const zr = -0.98, zf = 0.98 + (nose - 1) * 0.28;
  const xr = W / 2 - 0.1, xf = W / 2 - 0.2;
  const frontZ = zf + 0.7 * nose;

  // chassis
  P.add('carbon', rbox(W * 0.7, 0.1, 2.7 + (nose - 1) * 0.5, 0.04), M([0, 0.27, 0.1 + (nose - 1) * 0.2]));
  P.add('carbon', cyl(0.05, 0.05, W * 0.92, 10).rotateZ(PI / 2), M([0, Rr, zr]));
  P.add('carbon', cyl(0.04, 0.04, W * 0.84, 10).rotateZ(PI / 2), M([0, Rf, zf]));
  // wishbones
  for (const s of [-1, 1]) {
    P.add('metal', cyl(0.018, 0.018, 0.55, 6), limbMatrix([s * 0.18, 0.34, zf - 0.12], [s * xf, Rf + 0.02, zf]));
    P.add('metal', cyl(0.018, 0.018, 0.55, 6), limbMatrix([s * 0.18, 0.34, zf + 0.12], [s * xf, Rf + 0.02, zf]));
    P.add('metal', cyl(0.02, 0.02, 0.4, 6), limbMatrix([s * 0.25, 0.4, 0.55], [s * 0.18, 0.28, zf]));
  }
  // side pods
  const podX = W / 2 - 0.46;
  const podGeo = new THREE.CapsuleGeometry(0.25, 1.15 + (nose - 1) * 0.2, 8, 18);
  for (const s of [-1, 1]) {
    P.add('paint', podGeo, M([s * podX, 0.5, 0.15 + (nose - 1) * 0.1], [PI / 2, 0, 0], [1.0, 1, 0.8]));
    P.add('dark', rbox(0.26, 0.2, 0.06, 0.03), M([s * podX, 0.5, 0.75 + (nose - 1) * 0.2]));
    P.add('accent', rbox(0.06, 0.12, 0.8, 0.03), M([s * (podX + 0.22), 0.5, 0.15]));
  }
  // nose
  P.add('paint', ellipsoid(0.34 + W * 0.1, 0.23, 0.95 * nose, 28, 18), M([0, 0.5, 0.88 + (nose - 1) * 0.28]));
  P.add('chrome', new THREE.TorusGeometry(0.34 + W * 0.1, 0.035, 8, 24, PI).rotateX(PI / 2).rotateY(PI), M([0, 0.4, frontZ - 0.12]));
  for (const s of [-1, 1]) P.add('lightW', new THREE.CircleGeometry(0.075, 14), M([s * 0.2, 0.56, frontZ - 0.15 - 0.002], [0, 0, 0]));
  // front wing
  P.add('accent', rbox(W * 0.86, 0.035, 0.3, 0.015), M([0, 0.27, frontZ + 0.06], [0.08, 0, 0]));
  for (const s of [-1, 1]) P.add('paint', rbox(0.035, 0.18, 0.38, 0.015), M([s * W * 0.43, 0.3, frontZ + 0.05]));
  // cockpit
  P.add('interior', rbox(0.62, 0.14, 0.72, 0.05), M([0, 0.46, -0.32]));
  P.add('interior', rbox(0.64, 0.58, 0.14, 0.06), M([0, 0.8, -0.67], [-0.18, 0, 0]));
  P.add('accent', rbox(0.5, 0.06, 0.02, 0.01), M([0, 0.98, -0.58], [-0.18, 0, 0]));
  // pedals
  P.add('metal', rbox(0.1, 0.02, 0.1, 0.01), M([-0.1, 0.55, 0.66], [-0.5, 0, 0]));
  P.add('metal', rbox(0.1, 0.02, 0.1, 0.01), M([0.1, 0.55, 0.66], [-0.5, 0, 0]));

  // engine / rear cowl
  const eng = look.engine;
  P.add('paint', rbox(W * 0.6, 0.48, 0.82, 0.12), M([0, 0.62, -1.02]));
  P.add('accent', rbox(W * 0.34, 0.06, 0.5, 0.025), M([0, 0.9, -1.05]));
  const cylCount = eng === 'single' ? 1 : 2;
  const cylR = eng === 'big' ? 0.15 : 0.11;
  for (let i = 0; i < cylCount; i++) {
    const x = cylCount === 1 ? 0 : (i === 0 ? -1 : 1) * (eng === 'big' ? 0.24 : 0.2);
    P.add('metal', cyl(cylR, cylR, 0.3, 16), M([x, 0.98, -1.03]));
    P.add('chrome', cyl(cylR * 1.08, cylR * 1.08, 0.04, 16), M([x, 1.14, -1.03]));
    for (let f = 0; f < 4; f++) P.add('carbon', cyl(cylR * 1.3, cylR * 1.3, 0.018, 16), M([x, 0.86 + f * 0.065, -1.03]));
    P.add('chrome', cyl(0.025, 0.025, 0.22, 8), M([x, 1.1, -1.03]));
  }
  if (eng === 'big') {
    P.add('carbon', rbox(0.5, 0.12, 0.3, 0.04), M([0, 1.05, -0.78]));
    P.add('chrome', cyl(0.1, 0.1, 0.12, 14).rotateX(PI / 2), M([0, 1.05, -0.64]));
  }
  // exhausts
  const ex = [];
  for (const s of [-1, 1]) {
    const a = [s * 0.18, 0.62, -1.38], b = [s * 0.2, 0.7, -1.78];
    P.add('chrome', cyl(0.06, 0.075, 0.5, 14), limbMatrix(a, b));
    P.add('dark', new THREE.CircleGeometry(0.058, 14).rotateY(PI), M([b[0], b[1] + 0.005, b[2] - 0.003]));
    ex.push(new V3(b[0], b[1], b[2] - 0.05));
  }
  // tail lights
  for (const s of [-1, 1]) P.add('lightR', rbox(0.2, 0.05, 0.03, 0.01), M([s * 0.28, 0.78, -1.44]));

  // rear wing
  const wing = look.wing;
  const wy = wing === 'tall' ? 1.38 : wing === 'wide' ? 1.18 : 1.05;
  const ww = wing === 'wide' ? W * 1.0 : wing === 'tall' ? W * 0.9 : W * 0.78;
  const wz = -1.4;
  P.add('accent', rbox(ww, 0.05, 0.42, 0.02), M([0, wy, wz], [0.1, 0, 0]));
  if (wing !== 'tall') P.add('paint', rbox(ww * 0.96, 0.04, 0.3, 0.02), M([0, wy + 0.13, wz - 0.06], [0.2, 0, 0]));
  for (const s of [-1, 1]) {
    P.add('paint', rbox(0.04, wing === 'tall' ? 0.34 : 0.32, 0.56, 0.02), M([s * ww / 2, wy + 0.05, wz - 0.02]));
    P.add('carbon', cyl(0.03, 0.03, wy - 0.7, 8), limbMatrix([s * 0.3, 0.72, wz + 0.1], [s * 0.34, wy - 0.02, wz]));
  }
  // roll hoop
  if (look.roll) {
    P.add('chrome', new THREE.TorusGeometry(0.46, 0.045, 10, 24, PI), M([0, 0.72, -0.62]));
    P.add('chrome', cyl(0.035, 0.035, 0.9, 8).rotateZ(PI / 2), M([0, 1.18, -0.62]));
    for (const s of [-1, 1]) P.add('chrome', cyl(0.03, 0.03, 0.7, 8), limbMatrix([s * 0.44, 0.74, -0.62], [s * 0.44, 0.74, -1.0]));
  } else {
    P.add('chrome', new THREE.TorusGeometry(0.34, 0.03, 8, 18, PI), M([0, 0.9, -0.74], [-0.2, 0, 0]));
  }

  // driver body (static parts)
  P.add('suit', new THREE.CapsuleGeometry(0.17, 0.3, 6, 12), M([0, 0.9, -0.38], [-0.25, 0, 0], [1.1, 1, 0.85]));
  P.add('suit', ellipsoid(0.12, 0.09, 0.14), M([-0.24, 1.04, -0.36]));
  P.add('suit', ellipsoid(0.12, 0.09, 0.14), M([0.24, 1.04, -0.36]));
  for (const s of [-1, 1]) {
    P.add('suit', new THREE.CapsuleGeometry(0.058, 0.38, 5, 10), limbMatrix([s * 0.25, 1.02, -0.36], [s * 0.14, 0.9, 0.32]));
    P.add('carbon', ellipsoid(0.065, 0.065, 0.075), M([s * 0.13, 0.9, 0.36]));
    P.add('suit', new THREE.CapsuleGeometry(0.075, 0.4, 5, 10), limbMatrix([s * 0.13, 0.58, -0.42], [s * 0.15, 0.72, 0.14]));
    P.add('suit', new THREE.CapsuleGeometry(0.06, 0.4, 5, 10), limbMatrix([s * 0.15, 0.72, 0.14], [s * 0.13, 0.55, 0.6]));
    P.add('carbon', rbox(0.12, 0.08, 0.2, 0.03), M([s * 0.13, 0.52, 0.68], [-0.3, 0, 0]));
  }

  return {
    kind: 'kart', parts: P.build(), size: { length: 3.2, width: W + 0.4 },
    wheels: [
      { x: xr, y: Rr, z: zr, R: Rr, w: wr, front: false }, { x: -xr, y: Rr, z: zr, R: Rr, w: wr, front: false },
      { x: xf, y: Rf, z: zf, R: Rf, w: wf, front: true }, { x: -xf, y: Rf, z: zf, R: Rf, w: wf, front: true },
    ],
    head: { pos: [0, 1.22, -0.34], helmetR: 0.2 },
    steeringWheel: { pos: [0, 0.92, 0.36], tilt: -1.0, r: 0.14 },
    exhaust: ex, numberSpot: { pos: [0, 0.724, 0.95 + (nose - 1) * 0.28], rot: -0.12, size: 0.3 },
    stripeLines: kartStripes(W, nose), rimKind: 'sport', ride: 0,
  };
}

// Top-contour polylines used for stripe ribbons on karts (nose and rear cowl)
function kartStripes(W, nose) {
  const pts = [];
  const cz = 0.88 + (nose - 1) * 0.28, rz = 0.95 * nose, cy = 0.5, ry = 0.23;
  for (let i = 0; i <= 14; i++) {
    const z = cz - rz * 0.92 + (i / 14) * rz * 1.82;
    const t = (z - cz) / rz;
    pts.push([z, cy + ry * Math.sqrt(Math.max(0, 1 - t * t)) + 0.012]);
  }
  return [pts];
}

// ---------------------------------------------------------------- cars
function carCommon(P, o) {
  const { W, wheelX, wheelZf, wheelZr, Rw } = o;
  // wheel arch shadows + dark wells
  for (const s of [-1, 1]) {
    for (const z of [wheelZf, wheelZr]) {
      P.add('dark', new THREE.CylinderGeometry(Rw * 1.18, Rw * 1.18, 0.02, 20).rotateZ(PI / 2), M([s * (W / 2 - 0.01), Rw + 0.04, z]));
      P.add('dark', new THREE.CylinderGeometry(Rw * 1.1, Rw * 1.1, W * 0.5, 20).rotateZ(PI / 2), M([s * (W / 2 - W * 0.26), Rw + 0.02, z]));
    }
    // sill + mirror
  }
}

function addStripeRibbons(P, key, paths, style) {
  // paths: array of polylines [[z,y],...]; ribbons run along the car at selected x ranges
  const xr = style === 'dual' ? [[0.1, 0.26], [-0.26, -0.1]] : style === 'chevron' ? [[-0.34, 0.34]] : style === 'checker' ? [[-0.22, 0.22]] : [];
  for (const pts of paths) {
    for (const [x0, x1] of xr) {
      const n = pts.length;
      if (style === 'checker') {
        const cols = 4;
        for (let i = 0; i < n - 1; i++) {
          for (let c = 0; c < cols; c++) {
            if ((i + c) % 2) continue;
            const xa = x0 + ((x1 - x0) * c) / cols, xb = x0 + ((x1 - x0) * (c + 1)) / cols;
            P.add(key, quadStrip([pts[i], pts[i + 1]], xa, xb));
          }
        }
      } else if (style === 'chevron') {
        // two angled bars
        for (let i = 0; i < n - 1; i += 2) {
          const a = pts[i], b = pts[Math.min(n - 1, i + 1)];
          P.add(key, quadStrip([a, b], -0.34, -0.12, 0.08));
          P.add(key, quadStrip([a, b], 0.12, 0.34, -0.08));
        }
      } else P.add(key, quadStrip(pts, x0, x1));
    }
  }
}
function quadStrip(pts, x0, x1, skew = 0) {
  const pos = [], idx = [];
  pts.forEach((p, i) => {
    pos.push(x0, p[1] + (i ? 0 : 0), p[0] + skew * (x0 < 0 ? 1 : -1) * 0, x1, p[1], p[0] + skew * 0);
  });
  for (let i = 0; i < pts.length - 1; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // ensure upward normals
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) if (n.getY(i) < 0) { n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i)); }
  // flip winding if needed so the strip renders from above
  const ix = g.index.array;
  for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
  return g;
}

function carBlueprint(model) {
  const P = new Parts();
  let o;
  if (model === 'pip') o = pipCar(P);
  else if (model === 'dart') o = dartCar(P);
  else o = roadsterCar(P);
  carCommon(P, o);
  return {
    kind: 'car', parts: P.build(), size: { length: o.L, width: o.W },
    wheels: [
      { x: o.wheelX, y: o.Rw, z: o.wheelZr, R: o.Rw, w: o.ww, front: false }, { x: -o.wheelX, y: o.Rw, z: o.wheelZr, R: o.Rw, w: o.ww, front: false },
      { x: o.wheelX, y: o.Rw, z: o.wheelZf, R: o.Rw, w: o.ww, front: true }, { x: -o.wheelX, y: o.Rw, z: o.wheelZf, R: o.Rw, w: o.ww, front: true },
    ],
    head: o.head, steeringWheel: o.steer, exhaust: o.exhaust, numberSpot: o.numberSpot, stripeLines: o.stripes, rimKind: o.rim, ride: 0,
  };
}

// Body deformer: taper nose/tail in plan, tumble-home toward the top, soften corners.
function bodyDeform(L, W, beltY, topY, noseK = 0.2, tailK = 0.14) {
  return (x, y, z) => {
    const zn = z / (L / 2);
    const a = Math.abs(zn);
    let k = 1;
    if (zn > 0) k -= noseK * Math.pow(Math.max(0, a - 0.35) / 0.65, 2);
    else k -= tailK * Math.pow(Math.max(0, a - 0.35) / 0.65, 2);
    const h = Math.max(0, (y - beltY) / Math.max(0.01, topY - beltY));
    k -= 0.1 * h * h;
    const low = 1 - Math.min(1, Math.max(0, (y - 0.26) / 0.3));
    k -= 0.05 * low;
    return [x * k, y, z];
  };
}

function pipCar(P) {
  const L = 3.0, W = 1.64, Rw = 0.31, ww = 0.2;
  const wheelX = W / 2 - 0.04, zf = 1.0, zr = -0.98;
  // tub
  const tub = [[-1.5, 0.3], [-1.53, 0.6], [-1.47, 0.86], [-1.25, 0.97], [0.55, 0.97], [1.05, 0.95], [1.4, 0.84], [1.53, 0.62], [1.5, 0.36], [1.3, 0.26], [-1.3, 0.26]];
  P.add('paint', profileSolid(tub, W, { smooth: 2, bevel: 0.1, deform: bodyDeform(3.0, W, 0.97, 1.0, 0.22, 0.16) }));
  // sill / lower trim
  P.add('carbon', rbox(W * 1.0, 0.09, 2.4, 0.04), M([0, 0.3, -0.04]));
  // greenhouse glass
  const gh = [[0.6, 0.96], [0.24, 1.58], [-0.82, 1.58], [-1.22, 0.96]];
  P.add('glass', profileSolid(gh, W * 0.86, { smooth: 2, bevel: 0.03, deform: (x, y, z) => { const h = (y - 0.96) / 0.62; return [x * (1 - 0.12 * h * h), y, z]; } }));
  // roof
  P.add('paint', profileSolid([[0.3, 1.575], [0.2, 1.62], [-0.84, 1.62], [-0.95, 1.575]], W * 0.84, { smooth: 1, bevel: 0.05, deform: (x, y, z) => [x * (1 - 0.08 * Math.abs(z) * 0.4), y, z] }));
  // pillars
  for (const s of [-1, 1]) {
    P.add('paint', rbox(0.07, 0.07, 0.8, 0.02), limbMatrixBox([s * 0.355, 0.98, 0.6], [s * 0.34, 1.6, 0.24], 0.07, 0.06));
    P.add('paint', rbox(0.07, 0.07, 0.8, 0.02), limbMatrixBox([s * 0.355, 0.98, -1.22], [s * 0.34, 1.6, -0.9], 0.07, 0.06));
    P.add('paint', rbox(0.06, 0.62, 0.07, 0.02), M([s * 0.7, 1.28, -0.26]));
  }
  // lights, grille, bumpers
  for (const s of [-1, 1]) {
    P.add('chrome', cyl(0.17, 0.17, 0.06, 20).rotateX(PI / 2), M([s * 0.5, 0.78, 1.5]));
    P.add('lightW', new THREE.CircleGeometry(0.13, 20), M([s * 0.5, 0.78, 1.532]));
    P.add('chrome', cyl(0.085, 0.085, 0.05, 16).rotateX(PI / 2), M([s * 0.5, 0.58, 1.5]));
    P.add('lightA', new THREE.CircleGeometry(0.06, 14), M([s * 0.5, 0.58, 1.526]));
    P.add('lightR', new THREE.CircleGeometry(0.1, 16).rotateY(PI), M([s * 0.56, 0.76, -1.545]));
    P.add('chrome', cyl(0.115, 0.115, 0.05, 16).rotateX(PI / 2), M([s * 0.56, 0.76, -1.525]));
    P.add('paint', rbox(0.28, 0.06, 0.2, 0.025), M([s * 0.84, 1.0, 0.98], [0, 0.4 * s, 0]));
    P.add('chrome', rbox(0.12, 0.08, 0.04, 0.015), M([s * 0.93, 1.02, 0.98]));
    P.add('carbon', rbox(0.04, 0.1, 0.8, 0.015), M([s * (W / 2 - 0.005), 0.78, -0.24]));
  }
  P.add('chrome', rbox(0.7, 0.2, 0.06, 0.03), M([0, 0.62, 1.52]));
  for (let i = 0; i < 4; i++) P.add('carbon', rbox(0.6, 0.015, 0.03, 0.004), M([0, 0.56 + i * 0.045, 1.55]));
  P.add('chrome', rbox(W * 0.98, 0.07, 0.07, 0.03), M([0, 0.38, 1.55]));
  P.add('chrome', rbox(W * 0.98, 0.07, 0.07, 0.03), M([0, 0.38, -1.55]));
  P.add('chrome', rbox(0.24, 0.08, 0.04, 0.02), M([0, 0.44, -1.57]));
  P.add('chrome', cyl(0.006, 0.006, 0.5, 6), limbMatrix([-0.5, 1.6, -0.8], [-0.62, 2.0, -1.0]));
  // interior + seats
  P.add('interior', rbox(W * 0.72, 0.1, 1.5, 0.03), M([0, 0.9, -0.3]));
  P.add('interior', rbox(0.5, 0.5, 0.16, 0.06), M([0.0, 1.2, -0.84], [-0.16, 0, 0]));
  P.add('interior', rbox(W * 0.74, 0.18, 0.3, 0.06), M([0, 1.0, 0.45], [0.3, 0, 0]));
  // driver
  P.add('suit', new THREE.CapsuleGeometry(0.17, 0.26, 6, 12), M([0, 1.18, -0.36], [-0.1, 0, 0], [1.2, 1, 0.9]));
  for (const s of [-1, 1]) P.add('suit', new THREE.CapsuleGeometry(0.055, 0.34, 5, 10), limbMatrix([s * 0.25, 1.28, -0.36], [s * 0.14, 1.12, 0.24]));
  return {
    L, W, Rw, ww, wheelX, wheelZf: zf, wheelZr: zr,
    head: { pos: [0, 1.5, -0.34], helmetR: 0.2 },
    steer: { pos: [0, 1.12, 0.3], tilt: -0.9, r: 0.17 },
    exhaust: [new V3(-0.4, 0.38, -1.6), new V3(0.4, 0.38, -1.6)],
    numberSpot: { pos: [0, 1.0, 1.1], rot: -0.35, size: 0.28 },
    stripes: [[[1.42, 0.9], [1.05, 0.975], [0.6, 0.985]], [[0.24, 1.635], [-0.4, 1.635], [-0.86, 1.635]], [[-1.2, 0.99], [-1.42, 0.97]]],
    rim: 'sport',
  };
}

function limbMatrixBox(a, b, w, h) {
  // orient a box whose long axis is Z from a to b
  const A = new V3(...a), B = new V3(...b);
  const mid = A.clone().add(B).multiplyScalar(0.5);
  const dir = B.clone().sub(A);
  const q = new THREE.Quaternion().setFromUnitVectors(new V3(0, 0, 1), dir.clone().normalize());
  return new THREE.Matrix4().compose(mid, q, new V3(1, 1, dir.length() / 0.8));
}

function dartCar(P) {
  const L = 3.7, W = 1.82, Rw = 0.35, ww = 0.26;
  const wheelX = W / 2 - 0.05, zf = 1.12, zr = -1.12;
  const tub = [[-1.8, 0.34], [-1.85, 0.72], [-1.72, 0.98], [-1.2, 1.04], [0.35, 1.02], [1.0, 0.95], [1.55, 0.8], [1.84, 0.62], [1.82, 0.38], [1.6, 0.28], [-1.5, 0.28]];
  P.add('paint', profileSolid(tub, W, { smooth: 2, bevel: 0.1, deform: bodyDeform(3.7, W, 1.0, 1.1, 0.2, 0.12) }));
  P.add('carbon', rbox(W * 1.0, 0.1, 3.0, 0.04), M([0, 0.32, 0]));
  // fender flares
  for (const s of [-1, 1]) for (const z of [zf, zr]) {
    P.add('paint', new THREE.TorusGeometry(Rw * 1.22, 0.05, 8, 20, PI * 1.15).rotateY(PI / 2).rotateX(-PI * 0.075), M([s * (W / 2 + 0.01), Rw + 0.03, z], [0, 0, 0]));
    P.add('paint', rbox(0.1, 0.15, Rw * 2.5, 0.04), M([s * (W / 2 + 0.01), Rw * 1.6 + 0.02, z]));
  }
  const gh = [[0.56, 1.02], [0.0, 1.58], [-1.15, 1.58], [-1.7, 1.06]];
  P.add('glass', profileSolid(gh, W * 0.88, { smooth: 2, bevel: 0.03, deform: (x, y, z) => { const h = (y - 1.02) / 0.56; return [x * (1 - 0.13 * h * h), y, z]; } }));
  P.add('accent', profileSolid([[0.06, 1.575], [-0.02, 1.625], [-1.15, 1.625], [-1.22, 1.575]], W * 0.84, { smooth: 1, bevel: 0.05, deform: (x, y, z) => [x * 0.98, y, z] }));
  for (const s of [-1, 1]) {
    P.add('paint', rbox(0.07, 0.07, 0.8, 0.02), limbMatrixBox([s * 0.38, 1.04, 0.56], [s * 0.36, 1.6, 0.04], 0.07, 0.06));
    P.add('paint', rbox(0.07, 0.07, 0.8, 0.02), limbMatrixBox([s * 0.38, 1.08, -1.7], [s * 0.36, 1.6, -1.16], 0.07, 0.06));
    P.add('paint', rbox(0.06, 0.58, 0.08, 0.02), M([s * 0.78, 1.32, -0.55]));
    P.add('carbon', rbox(0.1, 0.1, 0.18, 0.03), M([s * 0.98, 1.1, 0.55], [0, 0.3 * s, 0]));
    // headlights, fog lamps
    P.add('lightW', rbox(0.32, 0.09, 0.03, 0.02), M([s * 0.64, 0.84, 1.8], [0, 0.25 * s, 0]));
    P.add('lightA', cyl(0.07, 0.07, 0.03, 14).rotateX(PI / 2), M([s * 0.7, 0.5, 1.82]));
    P.add('lightA', cyl(0.045, 0.045, 0.03, 14).rotateX(PI / 2), M([s * 0.5, 0.5, 1.84]));
    P.add('lightR', rbox(0.36, 0.1, 0.03, 0.02), M([s * 0.66, 0.9, -1.88], [0, -0.1 * s, 0]));
    // mud flap
    P.add('carbon', rbox(0.04, 0.2, 0.22, 0.01), M([s * (W / 2 - 0.1), 0.36, zr - 0.5]));
    // side vent
    P.add('dark', rbox(0.03, 0.14, 0.4, 0.01), M([s * (W / 2 - 0.01), 0.82, zf + 0.5]));
  }
  // grille / intake
  P.add('dark', rbox(1.0, 0.24, 0.05, 0.03), M([0, 0.52, 1.84]));
  for (let i = 0; i < 5; i++) P.add('carbon', rbox(0.96, 0.012, 0.04, 0.004), M([0, 0.43 + i * 0.045, 1.87]));
  P.add('chrome', rbox(0.34, 0.08, 0.04, 0.02), M([0, 0.84, 1.84]));
  P.add('lightR', cyl(0.025, 0.025, 0.04, 8).rotateX(PI / 2), M([0.0, 0.3, 1.88]));
  P.add('carbon', rbox(W * 0.98, 0.14, 0.14, 0.05), M([0, 0.32, 1.86]));
  P.add('carbon', rbox(W * 0.98, 0.14, 0.14, 0.05), M([0, 0.34, -1.86]));
  // hood scoop + vents
  P.add('accent', profileSolid([[0.9, 0.99], [0.85, 1.12], [0.35, 1.14], [0.15, 1.03]], 0.6, { smooth: 1, bevel: 0.04 }));
  P.add('dark', rbox(0.44, 0.05, 0.1, 0.02), M([0, 1.12, 0.89], [0.1, 0, 0]));
  // roof scoop, antenna, rack
  P.add('paint', rbox(0.26, 0.1, 0.4, 0.04), M([0, 1.67, -0.2]));
  P.add('dark', rbox(0.18, 0.04, 0.1, 0.02), M([0, 1.66, -0.02]));
  // rear wing
  P.add('accent', rbox(1.7, 0.05, 0.44, 0.02), M([0, 1.56, -1.9], [0.08, 0, 0]));
  P.add('paint', rbox(1.5, 0.04, 0.26, 0.02), M([0, 1.66, -1.96], [0.2, 0, 0]));
  for (const s of [-1, 1]) {
    P.add('paint', rbox(0.04, 0.38, 0.58, 0.02), M([s * 0.86, 1.6, -1.92]));
    P.add('carbon', cyl(0.03, 0.03, 0.6, 8), limbMatrix([s * 0.5, 1.02, -1.72], [s * 0.54, 1.54, -1.88]));
  }
  // exhaust
  P.add('chrome', cyl(0.075, 0.085, 0.3, 14).rotateX(PI / 2), M([0.5, 0.4, -1.92]));
  P.add('dark', new THREE.CircleGeometry(0.07, 14).rotateY(PI), M([0.5, 0.4, -2.075]));
  P.add('lightW', rbox(0.3, 0.07, 0.03, 0.01), M([0, 0.56, -1.9]));
  P.add('interior', rbox(W * 0.74, 0.1, 1.9, 0.03), M([0, 0.96, -0.5]));
  P.add('interior', rbox(0.52, 0.5, 0.16, 0.06), M([0.0, 1.28, -0.9], [-0.15, 0, 0]));
  P.add('interior', rbox(W * 0.78, 0.2, 0.32, 0.06), M([0, 1.04, 0.45], [0.3, 0, 0]));
  P.add('suit', new THREE.CapsuleGeometry(0.17, 0.26, 6, 12), M([0, 1.26, -0.42], [-0.1, 0, 0], [1.2, 1, 0.9]));
  for (const s of [-1, 1]) P.add('suit', new THREE.CapsuleGeometry(0.055, 0.34, 5, 10), limbMatrix([s * 0.25, 1.36, -0.42], [s * 0.14, 1.2, 0.2]));
  return {
    L, W, Rw, ww, wheelX, wheelZf: zf, wheelZr: zr,
    head: { pos: [0, 1.56, -0.4], helmetR: 0.2 },
    steer: { pos: [0, 1.18, 0.26], tilt: -0.95, r: 0.17 },
    exhaust: [new V3(0.5, 0.4, -2.12), new V3(-0.5, 0.4, -2.12)],
    numberSpot: { pos: [0, 1.06, 0.8], rot: -0.3, size: 0.3 },
    stripes: [[[1.8, 0.9], [1.4, 0.96], [1.0, 0.985]], [[0.0, 1.645], [-0.6, 1.645], [-1.2, 1.645]], [[-1.7, 1.03], [-1.82, 0.96]]],
    rim: 'rally',
  };
}

function roadsterCar(P) {
  const L = 3.6, W = 1.72, Rw = 0.33, ww = 0.24;
  const wheelX = W / 2 - 0.04, zf = 1.08, zr = -1.06;
  const tub = [[-1.78, 0.32], [-1.82, 0.6], [-1.7, 0.84], [-1.3, 0.9], [-0.2, 0.88], [0.5, 0.9], [1.2, 0.92], [1.62, 0.8], [1.86, 0.58], [1.84, 0.36], [1.62, 0.26], [-1.5, 0.26]];
  P.add('paint', profileSolid(tub, W, { smooth: 2, bevel: 0.1, deform: bodyDeform(3.6, W, 0.88, 0.95, 0.24, 0.14) }));
  P.add('carbon', rbox(W * 1.0, 0.09, 2.9, 0.04), M([0, 0.3, 0]));
  // cockpit tub (dark) + seats
  P.add('interior', rbox(W * 0.66, 0.06, 1.35, 0.03), M([0, 0.9, -0.28]));
  for (const s of [-1, 1]) {
    // rear deck fairings behind headrests
    P.add('paint', ellipsoid(0.36, 0.26, 0.62), M([s * 0.44, 1.0, -1.22]));
    P.add('interior', rbox(0.46, 0.5, 0.14, 0.06), M([s * 0.0, 1.12, -0.82], [-0.14, 0, 0]));
  }
  P.add('paint', rbox(0.2, 0.1, 1.0, 0.04), M([0, 0.92, -1.25]));
  // windshield: frame + glass
  P.add('glass', rbox(W * 0.78, 0.36, 0.03, 0.01), M([0, 1.08, 0.48], [-0.9, 0, 0]));
  P.add('chrome', rbox(W * 0.82, 0.04, 0.05, 0.015), M([0, 1.26, 0.38]));
  for (const s of [-1, 1]) {
    P.add('chrome', rbox(0.035, 0.4, 0.05, 0.012), M([s * W * 0.39, 1.08, 0.48], [-0.9, 0, 0]));
    // headlights
    P.add('chrome', cyl(0.14, 0.14, 0.06, 18).rotateX(PI / 2), M([s * 0.58, 0.88, 1.56], [0.3, 0, 0]));
    P.add('lightW', new THREE.CircleGeometry(0.11, 18), M([s * 0.58, 0.9, 1.585], [0.3, 0, 0]));
    P.add('lightR', rbox(0.34, 0.09, 0.03, 0.02), M([s * 0.58, 0.72, -1.84]));
    P.add('dark', rbox(0.03, 0.1, 0.5, 0.01), M([s * (W / 2 - 0.01), 0.7, zf + 0.35]));
    for (let i = 0; i < 4; i++) P.add('carbon', rbox(0.03, 0.12, 0.018, 0.005), M([s * (W / 2 - 0.005), 0.72, zf + 0.15 + i * 0.1]));
    P.add('chrome', rbox(0.1, 0.06, 0.16, 0.025), M([s * 0.93, 1.0, 0.5]));
    P.add('chrome', cyl(0.06, 0.06, 0.3, 14).rotateX(PI / 2), M([s * 0.45, 0.42, -1.93]));
    P.add('dark', new THREE.CircleGeometry(0.052, 14).rotateY(PI), M([s * 0.45, 0.42, -2.085]));
  }
  P.add('chrome', new THREE.TorusGeometry(0.52, 0.04, 8, 20, PI), M([0, 0.9, -0.62]));
  // hood louvres + grille
  for (let i = 0; i < 5; i++) P.add('carbon', rbox(0.7, 0.012, 0.05, 0.004), M([0, 0.945, 0.8 + i * 0.12], [0.06, 0, 0]));
  P.add('dark', rbox(0.9, 0.22, 0.05, 0.03), M([0, 0.52, 1.86]));
  P.add('chrome', rbox(0.96, 0.03, 0.05, 0.012), M([0, 0.66, 1.87]));
  P.add('chrome', rbox(W * 0.98, 0.06, 0.07, 0.03), M([0, 0.33, 1.84]));
  P.add('chrome', rbox(W * 0.98, 0.06, 0.07, 0.03), M([0, 0.36, -1.84]));
  // roll hoops behind seats
  for (const s of [-1, 1]) {
    P.add('chrome', new THREE.TorusGeometry(0.2, 0.035, 8, 16, PI), M([s * 0.44, 1.05, -0.9]));
    P.add('chrome', cyl(0.03, 0.03, 0.2, 8), M([s * 0.44, 0.97, -0.9]));
  }
  // driver
  P.add('suit', new THREE.CapsuleGeometry(0.17, 0.26, 6, 12), M([0, 1.18, -0.36], [-0.1, 0, 0], [1.2, 1, 0.9]));
  for (const s of [-1, 1]) {
    P.add('suit', new THREE.CapsuleGeometry(0.055, 0.34, 5, 10), limbMatrix([s * 0.25, 1.28, -0.36], [s * 0.14, 1.1, 0.14]));
    P.add('carbon', ellipsoid(0.06, 0.06, 0.07), M([s * 0.14, 1.08, 0.18]));
  }
  return {
    L, W, Rw, ww, wheelX, wheelZf: zf, wheelZr: zr,
    head: { pos: [0, 1.52, -0.34], helmetR: 0.2 },
    steer: { pos: [0, 1.06, 0.18], tilt: -0.95, r: 0.17 },
    exhaust: [new V3(0.45, 0.42, -2.1), new V3(-0.45, 0.42, -2.1)],
    numberSpot: { pos: [0, 0.96, 1.3], rot: -0.12, size: 0.3 },
    stripes: [[[1.78, 0.82], [1.4, 0.935], [0.9, 0.955], [0.55, 0.955]], [[-1.46, 0.915], [-1.7, 0.86]]],
    rim: 'sport',
  };
}

// ============================================================ public API
function getBlueprint(id) {
  if (blueprints.has(id)) return blueprints.get(id);
  const v = VEHICLE_BY_ID[id];
  const bp = v.type === 'kart' ? kartBlueprint(v.look) : carBlueprint(v.look.model);
  blueprints.set(id, bp);
  return bp;
}

const MAT_FOR_KEY = (S, M_) => ({
  paint: M_.paint, accent: M_.accent, carbon: S.carbon, metal: S.metal, chrome: S.chrome, glass: S.glass,
  lightW: S.lightW, lightR: S.lightR, lightA: S.lightA, interior: S.interior, dark: S.dark, suit: M_.suit,
  stripe: M_.stripe, rim: S.metal, hub: M_.accent, disc: S.carbon,
});

// Returns { root, body, wheels, head, steerWheel, flames, shield, ... }
export function createVehicle(vehicleId, { color = '#e0243a', accent = '#ffd23f', stripe = 'none', number = 1 } = {}) {
  const bp = getBlueprint(vehicleId);
  const S = sharedMats();
  const M_ = paintMats(color, accent);
  const mm = MAT_FOR_KEY(S, M_);
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  for (const key in bp.parts) {
    const mesh = new THREE.Mesh(bp.parts[key], mm[key] || S.carbon);
    mesh.castShadow = key !== 'glass';
    mesh.receiveShadow = false;
    body.add(mesh);
  }

  // stripes
  if (stripe !== 'none' && bp.stripeLines && bp.stripeLines.length) {
    const sp = new Parts();
    addStripeRibbons(sp, 'stripe', bp.stripeLines, stripe);
    const built = sp.build();
    if (built.stripe) { const m = new THREE.Mesh(built.stripe, M_.stripe); body.add(m); }
  }

  // race number decal
  if (bp.numberSpot) {
    const t = numberTexture(number, '#ffffff', '#111');
    const dm = new THREE.Mesh(new THREE.PlaneGeometry(bp.numberSpot.size, bp.numberSpot.size), new THREE.MeshBasicMaterial({ map: t, transparent: true, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    dm.rotation.x = -PI / 2 - bp.numberSpot.rot;
    dm.position.set(...bp.numberSpot.pos);
    body.add(dm);
  }

  // wheels
  const wheels = [];
  const rimMat = bp.rimKind === 'rally' ? S.bronze : S.metal;
  for (const w of bp.wheels) {
    const wbp = wheelBlueprint(w.R, w.w, bp.rimKind);
    const pivot = new THREE.Group();
    pivot.position.set(w.x, w.y, w.z);
    const spin = makeWheel(wbp, { ...M_, rubber: S.rubber, carbon: S.carbon }, rimMat);
    if (w.x < 0) spin.rotation.y = PI; // mirror so the dish faces outward
    const holder = new THREE.Group();
    holder.add(spin);
    pivot.add(holder);
    body.add(pivot);
    wheels.push({ pivot, spin: holder, R: w.R, front: w.front, side: Math.sign(w.x) });
  }

  // driver head
  const head = new THREE.Group();
  head.position.set(...bp.head.pos);
  const hr = bp.head.helmetR;
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(hr, 24, 18), M_.helmet);
  helmet.scale.set(1, 1.05, 1.12); helmet.castShadow = true;
  const visor = new THREE.Mesh(new THREE.SphereGeometry(hr * 1.03, 24, 14, -PI * 0.42, PI * 0.84, PI * 0.3, PI * 0.28), S.visor);
  visor.rotation.y = PI; visor.scale.set(1, 1.05, 1.12);
  const chin = new THREE.Mesh(new THREE.TorusGeometry(hr * 0.78, hr * 0.07, 8, 16, PI), M_.accent);
  chin.rotation.set(PI / 2, 0, 0); chin.position.set(0, -hr * 0.15, hr * 0.1);
  const stripeH = new THREE.Mesh(new THREE.TorusGeometry(hr * 1.0, hr * 0.06, 8, 24, PI), M_.accent);
  stripeH.rotation.set(0, PI / 2, 0); stripeH.scale.set(1, 1.05, 1.12);
  head.add(helmet, visor, stripeH);
  body.add(head);

  // steering wheel
  const sw = new THREE.Group();
  sw.position.set(...bp.steeringWheel.pos);
  const col = new THREE.Group();
  col.rotation.x = bp.steeringWheel.tilt;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(bp.steeringWheel.r, 0.02, 8, 24), S.carbon);
  const hubm = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.03, 12).rotateX(PI / 2), M_.accent);
  const sp1 = new THREE.Mesh(new THREE.BoxGeometry(bp.steeringWheel.r * 1.9, 0.02, 0.012), S.metal);
  const sp2 = new THREE.Mesh(new THREE.BoxGeometry(0.02, bp.steeringWheel.r * 0.9, 0.012), S.metal);
  sp2.position.y = -bp.steeringWheel.r * 0.45;
  col.add(ring, hubm, sp1, sp2);
  sw.add(col);
  body.add(sw);
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.5, 8), S.metal);
  column.position.set(bp.steeringWheel.pos[0], bp.steeringWheel.pos[1] - 0.2, bp.steeringWheel.pos[2] + 0.12);
  column.rotation.x = -0.9;
  body.add(column);

  // exhaust flames (visible when boosting)
  const flames = new THREE.Group();
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xffa030, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const flameCore = new THREE.MeshBasicMaterial({ color: 0xfff3b0, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
  for (const e of bp.exhaust) {
    const f = new THREE.Group();
    f.position.copy(e);
    const outer = new THREE.Mesh(new THREE.ConeGeometry(0.14, 1.1, 12, 1, true).rotateX(-PI / 2).translate(0, 0, -0.55), flameMat);
    const inner = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.7, 10, 1, true).rotateX(-PI / 2).translate(0, 0, -0.35), flameCore);
    f.add(outer, inner);
    flames.add(f);
  }
  flames.visible = false;
  body.add(flames);

  // shield bubble
  const shield = new THREE.Mesh(
    new THREE.SphereGeometry(Math.max(bp.size.length, bp.size.width) * 0.62, 28, 20),
    new THREE.MeshPhysicalMaterial({ color: 0x4da3ff, transparent: true, opacity: 0.22, roughness: 0.1, metalness: 0, emissive: 0x2a7bff, emissiveIntensity: 0.6, side: THREE.DoubleSide, depthWrite: false }),
  );
  shield.position.y = 0.9; shield.visible = false;
  root.add(shield);

  return {
    root, body, wheels, head, steerWheel: col, flames, shield, size: bp.size, id: vehicleId, kind: bp.kind,
    headBase: new V3(...bp.head.pos), flameMat, flameCore, helmet,
  };
}

// Per-frame animation. s: { speed, steer (-1..1 right+), dt, boost (0..1), roll, pitch, slip }
export function animateVehicle(v, s) {
  const { dt } = s;
  for (const w of v.wheels) {
    w.spin.rotation.x += (s.speed * dt) / w.R;
    if (w.front) w.pivot.rotation.y = -s.steer * 0.5;
  }
  v.steerWheel.rotation.z = s.steer * 1.4;
  v.head.rotation.y = -s.steer * 0.35 + (s.lookBack ? PI : 0);
  v.head.rotation.z = -s.steer * 0.12;
  v.head.position.x = v.headBase.x - s.steer * 0.05;
  v.flames.visible = s.boost > 0.02;
  if (v.flames.visible) {
    const flick = 0.85 + Math.random() * 0.3;
    for (const f of v.flames.children) { f.scale.set(1, 1, (0.4 + s.boost * 1.3) * flick); }
  }
}

export function disposeVehicleCaches() { /* materials/geometry are shared and live for the page lifetime */ }

export { PAINT_BY_ID };

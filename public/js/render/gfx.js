// Shared 3D helpers: vertex-coloured geometry merging, procedural textures, value noise.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices, toCreasedNormals } from '../../vendor/BufferGeometryUtils.js';

export { THREE, mergeGeometries, mergeVertices, toCreasedNormals };

// ---------------------------------------------------------------- noise
function hash2(ix, iy) {
  let h = (ix * 374761393 + iy * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function noise2(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy), b = hash2(ix + 1, iy), c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x, y, oct = 4) {
  let s = 0, amp = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { s += noise2(x * f, y * f) * amp; n += amp; amp *= 0.5; f *= 2.03; }
  return s / n;
}

// ---------------------------------------------------------------- geometry builder
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();

export function mat4(pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1]) {
  _e.set(rot[0], rot[1], rot[2], 'YXZ');
  _q.setFromEuler(_e);
  _v.set(pos[0], pos[1], pos[2]);
  if (typeof scale === 'number') scale = [scale, scale, scale];
  _s.set(scale[0], scale[1], scale[2]);
  return new THREE.Matrix4().compose(_v, _q, _s);
}

// Collects primitives, bakes transforms + vertex colours, merges to one geometry.
export class GeoBuilder {
  constructor() { this.parts = []; }
  // color: hex / THREE.Color / function(x,y,z) -> hex|Color (evaluated per vertex after transform)
  add(geo, color, opts = {}) {
    let g = geo.clone();
    const m = opts.matrix || mat4(opts.pos, opts.rot, opts.scale);
    g.applyMatrix4(m);
    if (g.index) g = g.toNonIndexed();
    if (g.attributes.uv) g.deleteAttribute('uv');
    if (g.attributes.uv1) g.deleteAttribute('uv1');
    const pos = g.attributes.position, n = pos.count;
    const col = new Float32Array(n * 3);
    if (typeof color === 'function') {
      for (let i = 0; i < n; i++) {
        _c.set(color(pos.getX(i), pos.getY(i), pos.getZ(i)));
        col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b;
      }
    } else {
      _c.set(color);
      for (let i = 0; i < n; i++) { col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; }
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.parts.push(g);
    return this;
  }
  build() {
    if (!this.parts.length) return new THREE.BufferGeometry();
    const g = mergeGeometries(this.parts, false);
    this.parts.length = 0;
    return g;
  }
}

export function lerpColor(a, b, t) {
  return new THREE.Color(a).lerp(new THREE.Color(b), Math.min(1, Math.max(0, t)));
}

// ---------------------------------------------------------------- textures
export function canvasTex(w, h, draw, { repeat = null, srgb = true, aniso = 4, wrap = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  draw(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (wrap) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}

export function glowTex(color = '#ffffff', size = 128, hard = 0.0) {
  return canvasTex(size, size, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const gg = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    const col = new THREE.Color(color);
    const rgb = `${(col.r * 255) | 0},${(col.g * 255) | 0},${(col.b * 255) | 0}`;
    gg.addColorStop(0, `rgba(${rgb},1)`);
    gg.addColorStop(0.25 + hard * 0.5, `rgba(${rgb},0.55)`);
    gg.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = gg;
    ctx.fillRect(0, 0, w, h);
  }, { wrap: false });
}

// Soft dark blob (fake shadow)
export function blobTex() {
  return canvasTex(128, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(0,0,0,0.65)');
    g.addColorStop(0.55, 'rgba(0,0,0,0.35)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }, { wrap: false });
}

export function dispose(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of ms) {
        for (const k in m) { const v = m[k]; if (v && v.isTexture) v.dispose(); }
        m.dispose();
      }
    }
  });
}

// Turn a list of [x,z] / sample data into an InstancedMesh.
export function instanced(geo, mat, matrices, { cast = false, receive = false } = {}) {
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, matrices.length));
  for (let i = 0; i < matrices.length; i++) mesh.setMatrixAt(i, matrices[i]);
  mesh.count = matrices.length;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = cast; mesh.receiveShadow = receive;
  mesh.frustumCulled = false;
  return mesh;
}

// Particle systems (CPU-simulated, drawn as soft point sprites) and skid marks.
import { THREE, glowTex } from './gfx.js';

const vert = /* glsl */ `
attribute vec4 aColor; attribute float aSize;
uniform float uScale;
varying vec4 vColor;
void main(){
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(aSize * uScale / max(0.5, -mv.z), 0.0, 220.0);
}`;
const frag = /* glsl */ `
uniform sampler2D uTex; varying vec4 vColor;
void main(){
  vec4 t = texture2D(uTex, gl_PointCoord);
  gl_FragColor = vec4(vColor.rgb, vColor.a * t.a);
  #include <colorspace_fragment>
}`;

class PointPool {
  constructor(max, additive, tex) {
    this.max = max; this.n = 0;
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 4); this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3); this.age = new Float32Array(max); this.life = new Float32Array(max);
    this.s0 = new Float32Array(max); this.s1 = new Float32Array(max); this.grav = new Float32Array(max); this.drag = new Float32Array(max);
    this.c0 = new Float32Array(max * 4); this.c1 = new Float32Array(max * 4);
    const g = new THREE.BufferGeometry();
    this.gPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.gCol = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    this.gSize = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.gPos); g.setAttribute('aColor', this.gCol); g.setAttribute('aSize', this.gSize);
    g.setDrawRange(0, 0);
    this.uniforms = { uScale: { value: 600 }, uTex: { value: tex } };
    const m = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, uniforms: this.uniforms, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, fog: false });
    this.points = new THREE.Points(g, m); this.points.frustumCulled = false; this.points.renderOrder = 6;
    this.head = 0;
  }
  emit(p, v, life, s0, s1, c0, c1, grav = 0, drag = 0) {
    const i = this.head; this.head = (this.head + 1) % this.max; if (this.n < this.max) this.n++;
    this.pos[i * 3] = p[0]; this.pos[i * 3 + 1] = p[1]; this.pos[i * 3 + 2] = p[2];
    this.vel[i * 3] = v[0]; this.vel[i * 3 + 1] = v[1]; this.vel[i * 3 + 2] = v[2];
    this.age[i] = 0; this.life[i] = life; this.s0[i] = s0; this.s1[i] = s1; this.grav[i] = grav; this.drag[i] = drag;
    for (let k = 0; k < 4; k++) { this.c0[i * 4 + k] = c0[k]; this.c1[i * 4 + k] = c1[k]; }
  }
  update(dt) {
    let live = 0;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.col[i * 4 + 3] = 0; this.size[i] = 0; continue; }
      this.age[i] += dt;
      const t = this.age[i] / this.life[i];
      if (t >= 1) { this.life[i] = 0; this.col[i * 4 + 3] = 0; this.size[i] = 0; continue; }
      live++;
      const dr = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= dr; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * dr - this.grav[i] * dt; this.vel[i * 3 + 2] *= dr;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      for (let k = 0; k < 4; k++) this.col[i * 4 + k] = this.c0[i * 4 + k] + (this.c1[i * 4 + k] - this.c0[i * 4 + k]) * t;
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
    }
    this.gPos.needsUpdate = this.gCol.needsUpdate = this.gSize.needsUpdate = true;
    this.points.geometry.setDrawRange(0, this.max);
    return live;
  }
}

export class Effects {
  constructor(scene) {
    this.group = new THREE.Group();
    this.smoke = new PointPool(900, false, glowTex('#ffffff', 64, 0.25));
    this.add = new PointPool(900, true, glowTex('#ffffff', 64, 0.05));
    this.group.add(this.smoke.points, this.add.points);
    scene.add(this.group);
    this.skid = new SkidMarks(this.group);
    this.tmp = new THREE.Color();
  }
  setScale(h, fov) { const s = h / (2 * Math.tan((fov * Math.PI) / 360)); this.smoke.uniforms.uScale.value = s; this.add.uniforms.uScale.value = s; }
  rgba(hex, a) { this.tmp.set(hex); return [this.tmp.r, this.tmp.g, this.tmp.b, a]; }
  rand(a) { return (Math.random() - 0.5) * 2 * a; }

  tireSmoke(x, z, vx, vz, color = '#d9dde6', amt = 1) {
    this.smoke.emit([x + this.rand(0.3), 0.25, z + this.rand(0.3)], [vx * 0.15 + this.rand(0.8), 0.9 + Math.random() * 0.8, vz * 0.15 + this.rand(0.8)], 0.7 + Math.random() * 0.45, 0.9 * amt, 3.2 * amt, this.rgba(color, 0.42), this.rgba(color, 0), 0, 1.2);
  }
  dust(x, z, vx, vz, color = '#c9a56a', amt = 1) {
    this.smoke.emit([x + this.rand(0.5), 0.3, z + this.rand(0.5)], [vx * 0.1 + this.rand(1.2), 1.2 + Math.random(), vz * 0.1 + this.rand(1.2)], 0.9 + Math.random() * 0.5, 1.0 * amt, 3.8 * amt, this.rgba(color, 0.5), this.rgba(color, 0), 0.3, 1.0);
  }
  spark(x, y, z, vx, vz, color) {
    this.add.emit([x, y, z], [vx + this.rand(4), 2 + Math.random() * 3.5, vz + this.rand(4)], 0.28 + Math.random() * 0.22, 0.35, 0.05, this.rgba(color, 1), this.rgba(color, 0), 14, 0.5);
  }
  boostFlame(x, y, z, fx, fz, speed) {
    const j = 0.25;
    this.add.emit([x + this.rand(0.1), y, z + this.rand(0.1)], [-fx * (4 + Math.random() * 5) + this.rand(j), this.rand(0.4), -fz * (4 + Math.random() * 5) + this.rand(j)], 0.22 + Math.random() * 0.12, 0.8, 0.15, this.rgba('#ffd27a', 0.9), this.rgba('#ff5a18', 0), 0, 0.4);
  }
  explosion(x, z) {
    for (let k = 0; k < 40; k++) {
      const a = Math.random() * Math.PI * 2, s = 4 + Math.random() * 13;
      this.add.emit([x, 0.6, z], [Math.cos(a) * s, 3 + Math.random() * 8, Math.sin(a) * s], 0.4 + Math.random() * 0.5, 1.4, 0.2, this.rgba(k % 3 ? '#ffb02e' : '#fff3b0', 1), this.rgba('#ff3a0a', 0), 9, 1.4);
    }
    for (let k = 0; k < 22; k++) {
      const a = Math.random() * Math.PI * 2, s = 2 + Math.random() * 6;
      this.smoke.emit([x, 0.7, z], [Math.cos(a) * s, 2 + Math.random() * 4, Math.sin(a) * s], 1.1 + Math.random() * 0.8, 2.2, 6.5, this.rgba('#3a3a40', 0.7), this.rgba('#18181c', 0), 0, 1.6);
    }
  }
  burst(x, y, z, color, n = 18) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * 1.2, s = 3 + Math.random() * 6;
      this.add.emit([x, y, z], [Math.cos(a) * s, 2 + Math.random() * 6 * e, Math.sin(a) * s], 0.5 + Math.random() * 0.3, 0.7, 0.1, this.rgba(color, 1), this.rgba(color, 0), 8, 0.9);
    }
  }
  update(dt) { this.smoke.update(dt); this.add.update(dt); }
}

export class SkidMarks {
  constructor(parent, max = 900) {
    this.max = max; this.head = 0;
    this.pos = new Float32Array(max * 4 * 3); this.col = new Float32Array(max * 4 * 4);
    const idx = [];
    for (let i = 0; i < max; i++) { const b = i * 4; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
    const g = new THREE.BufferGeometry();
    this.gp = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.gc = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.gp); g.setAttribute('color', this.gc); g.setIndex(idx);
    const m = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5, fog: true });
    this.mesh = new THREE.Mesh(g, m); this.mesh.frustumCulled = false; this.mesh.renderOrder = 3;
    parent.add(this.mesh);
    this.last = new Map();
  }
  segment(key, x, z, hx, hz, width, alpha) {
    // hx,hz: unit heading; the quad spans width across the perpendicular
    const prev = this.last.get(key);
    const px = -hz * width * 0.5, pz = hx * width * 0.5;
    if (!prev || Math.hypot(prev.x - x, prev.z - z) > 6) { this.last.set(key, { x, z, px, pz }); return; }
    if (Math.hypot(prev.x - x, prev.z - z) < 0.45) return;
    const i = this.head; this.head = (this.head + 1) % this.max;
    const o = i * 12, y = 0.045;
    this.pos.set([prev.x - prev.px, y, prev.z - prev.pz, prev.x + prev.px, y, prev.z + prev.pz, x - px, y, z - pz, x + px, y, z + pz], o);
    const c = i * 16;
    for (let k = 0; k < 4; k++) { this.col[c + k * 4] = 0.04; this.col[c + k * 4 + 1] = 0.04; this.col[c + k * 4 + 2] = 0.05; this.col[c + k * 4 + 3] = alpha; }
    this.gp.needsUpdate = this.gc.needsUpdate = true;
    this.last.set(key, { x, z, px, pz });
  }
  breakLine(key) { this.last.delete(key); }
  clear() { this.col.fill(0); this.pos.fill(0); this.gp.needsUpdate = this.gc.needsUpdate = true; this.last.clear(); this.head = 0; }
}

// Builds the full 3D world for a track: terrain, road, kerbs, walls, gate, pickups, scenery, sky, weather.
import { THREE, canvasTex, fbm, noise2, GeoBuilder, mat4, glowTex, dispose } from './gfx.js';
import { createSky } from './sky.js';
import { THEMES } from './themes.js';
import { rng, clamp, smoothstep, lerp } from '../core/util.js';
import { zoneAt } from '../core/tracks.js';

const PI = Math.PI;

// ---------------------------------------------------------------- ribbons
// offFn(i) -> [lateralStart, lateralEnd] (metres, +right). Returns indexed geometry.
function ribbon(track, offFn, y, { vLen = 8, colorFn = null, uvU = 1, closed = true, from = 0, to = track.N } = {}) {
  const { N, X, Z, RX, RZ, step } = track;
  const count = to - from;
  const n = count + (closed && from === 0 && to === N ? 1 : 0);
  const pos = new Float32Array(n * 2 * 3), uv = new Float32Array(n * 2 * 2), nor = new Float32Array(n * 2 * 3);
  const col = colorFn ? new Float32Array(n * 2 * 3) : null;
  const tileLen = track.length / Math.max(1, Math.round(track.length / vLen));
  for (let k = 0; k < n; k++) {
    const i = (from + k) % N;
    const [a, b] = offFn(i);
    const yy = typeof y === 'function' ? y(i) : y;
    for (let s = 0; s < 2; s++) {
      const o = s === 0 ? a : b;
      const vi = (k * 2 + s);
      pos[vi * 3] = X[i] + RX[i] * o; pos[vi * 3 + 1] = yy; pos[vi * 3 + 2] = Z[i] + RZ[i] * o;
      nor[vi * 3 + 1] = 1;
      uv[vi * 2] = s * uvU; uv[vi * 2 + 1] = ((from + k) * step) / tileLen;
      if (col) { const c = colorFn(i, s, o); col[vi * 3] = c.r; col[vi * 3 + 1] = c.g; col[vi * 3 + 2] = c.b; }
    }
  }
  const idx = [];
  for (let k = 0; k < n - 1; k++) {
    const a = k * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (col) g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

// ---------------------------------------------------------------- textures
function asphaltTexture(T) {
  return canvasTex(512, 512, (ctx, w, h) => {
    ctx.fillStyle = T.road.base; ctx.fillRect(0, 0, w, h);
    // blotchy low-frequency variation
    const img = ctx.getImageData(0, 0, w, h), d = img.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const n = (fbm(x / 60, y / 60, 3) - 0.5) * 26 + (Math.random() - 0.5) * 22;
        d[i] += n; d[i + 1] += n; d[i + 2] += n;
      }
    }
    ctx.putImageData(img, 0, 0);
    // worn tyre lanes
    for (const cx of [0.3, 0.7]) {
      const g = ctx.createLinearGradient((cx - 0.12) * w, 0, (cx + 0.12) * w, 0);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, 'rgba(0,0,0,0.22)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect((cx - 0.12) * w, 0, 0.24 * w, h);
    }
    // edge lines
    ctx.fillStyle = T.road.line;
    ctx.globalAlpha = 0.92;
    ctx.fillRect(w * 0.035, 0, w * 0.014, h);
    ctx.fillRect(w * 0.951, 0, w * 0.014, h);
    // dashed centre line
    const dash = h / 4;
    for (let k = 0; k < 4; k++) ctx.fillRect(w * 0.4935, k * dash + dash * 0.15, w * 0.013, dash * 0.45);
    ctx.globalAlpha = 1;
    // speckle chips on lines for wear
    ctx.fillStyle = T.road.base;
    for (let k = 0; k < 500; k++) ctx.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }, { aniso: 8 });
}

function kerbTexture() {
  return canvasTex(64, 128, (ctx, w, h) => {
    ctx.fillStyle = '#e8e8ea'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#d6202c'; ctx.fillRect(0, 0, w, h / 2);
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    for (let k = 0; k < 40; k++) ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  }, { aniso: 8 });
}

function checkerTex() {
  return canvasTex(256, 64, (ctx, w, h) => {
    const s = 16;
    for (let y = 0; y < h / s; y++) for (let x = 0; x < w / s; x++) { ctx.fillStyle = (x + y) % 2 ? '#101114' : '#f4f4f4'; ctx.fillRect(x * s, y * s, s, s); }
  }, { wrap: false });
}

function detailTex() {
  return canvasTex(256, 256, (ctx, w, h) => {
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const v = 200 + (fbm(x / 22, y / 22, 3) - 0.5) * 70 + (Math.random() - 0.5) * 20;
      const i = (y * w + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = clamp(v, 0, 255); img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, { srgb: false, aniso: 8 });
}

function arrowTex() {
  return canvasTex(128, 256, (ctx, w, h) => {
    ctx.fillStyle = '#071423'; ctx.fillRect(0, 0, w, h);
    ctx.lineJoin = 'round';
    for (let k = 0; k < 3; k++) {
      const y = h * (0.16 + k * 0.27);
      ctx.strokeStyle = k === 1 ? '#7dffe0' : '#34e0ff'; ctx.lineWidth = 18;
      ctx.beginPath(); ctx.moveTo(w * 0.2, y + h * 0.12); ctx.lineTo(w * 0.5, y); ctx.lineTo(w * 0.8, y + h * 0.12); ctx.stroke();
    }
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 6; ctx.strokeRect(4, 4, w - 8, h - 8);
  }, { wrap: false });
}

function questionTex() {
  return canvasTex(128, 128, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#ff5fa8'); g.addColorStop(0.35, '#ffb02e'); g.addColorStop(0.65, '#3ee0a8'); g.addColorStop(1, '#4da3ff');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.fillRect(0, 0, w, h * 0.45);
    ctx.fillStyle = '#fff'; ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 8;
    ctx.font = '900 96px system-ui, Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.strokeText('?', w / 2, h / 2 + 6); ctx.fillText('?', w / 2, h / 2 + 6);
  }, { wrap: false });
}

function zoneTex(kind) {
  return canvasTex(256, 256, (ctx, w, h) => {
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const n = fbm(x / 34, y / 34, 4), i = (y * w + x) * 4;
      let r, g, b, a;
      if (kind === 'ice') { const v = 0.6 + n * 0.5; r = 170 * v + 40; g = 215 * v + 25; b = 255; a = 205 + n * 40; }
      else if (kind === 'sand') { const ridge = Math.abs(Math.sin((x / 24 + n * 3) * 1.0)); const v = 0.75 + ridge * 0.25; r = 236 * v; g = 196 * v; b = 132 * v; a = 255 * clamp(n * 1.9 - 0.2, 0.0, 0.96); }
      else { const v = 0.35 + n * 0.45; r = 30 * v; g = 60 * v + 20; b = 90 * v + 40; a = 255 * clamp(n * 2.4 - 0.55, 0, 0.75); }
      img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = a;
    }
    ctx.putImageData(img, 0, 0);
    // soft edges across width
    ctx.globalCompositeOperation = 'destination-in';
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.08, 'rgba(0,0,0,1)'); g.addColorStop(0.92, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }, { aniso: 8 });
}

function bannerTex(text, a = '#ffd23f', b = '#0b0f1a') {
  return canvasTex(1024, 160, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, b); g.addColorStop(0.5, '#1a2748'); g.addColorStop(1, b);
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = a; ctx.font = '900 112px system-ui, Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2 + 6);
    ctx.fillStyle = '#fff';
    for (let k = 0; k < 2; k++) { ctx.fillRect(0, k * (h - 12), w, 12); }
  }, { wrap: false });
}

function adTex() {
  return canvasTex(1024, 128, (ctx, w, h) => {
    const brands = [['SLIPSTREAM', '#ffd23f', '#12192e'], ['TURBO·X', '#ff4f4f', '#fff'], ['VOLT', '#8ee000', '#10151f'], ['NOVA OIL', '#ffffff', '#1d6fe8'], ['ZENITH', '#ffffff', '#4b3fd6'], ['APEX TIRES', '#111', '#ffb02e']];
    const cw = w / 4;
    brands.slice(0, 4).forEach(([t, fg, bg], i) => {
      ctx.fillStyle = bg; ctx.fillRect(i * cw, 0, cw, h);
      ctx.fillStyle = fg; ctx.font = '900 58px system-ui, Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(t, i * cw + cw / 2, h / 2 + 4);
      ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(i * cw, 0, cw, 10);
    });
  }, { aniso: 8 });
}

// ---------------------------------------------------------------- walls
function buildWall(track, side, T) {
  const { N, X, Z, RX, RZ, W } = track;
  const wp = T.wall;
  const prof = wp.profile; // [[outward, height], ...]
  const S = prof.length - 1;
  const rnd = rng(77 + (side > 0 ? 1 : 2));
  const stepI = wp.stride || 1;
  const cols = Math.ceil(N / stepI) + 1;
  const jit = wp.jitter || 0;
  // per sample jitter noise
  const verts = [], norms = [], colors = [], idx = [];
  const tmpC = new THREE.Color();
  const lat0 = (i) => side * (W[i] / 2 + track.wallGap - 0.15);
  const P = (i, j, s) => {
    const q = prof[j];
    let o = q[0], hh = q[1];
    if (jit && hh > 0.01) {
      const n1 = noise2(s * 0.35 + j * 7.1, j * 3.7 + side * 11), n2 = noise2(s * 0.8 + 50, j * 5.1);
      o += (n1 - 0.5) * jit * 2; hh = Math.max(0.05, hh + (n2 - 0.5) * jit * 1.2);
    }
    return [X[i] + RX[i] * (lat0(i) + side * o), hh, Z[i] + RZ[i] * (lat0(i) + side * o), o, hh];
  };
  for (let c = 0; c < cols; c++) {
    const s = c * stepI, i = s % N;
    const row = [];
    for (let j = 0; j <= S; j++) row.push(P(i, j, s));
    verts.push(row);
  }
  const pos = [], nor = [], col = [];
  for (let c = 0; c < cols - 1; c++) {
    const i0 = (c * stepI) % N, i1 = ((c + 1) * stepI) % N;
    for (let j = 0; j < S; j++) {
      const a = verts[c][j], b = verts[c + 1][j], d = verts[c][j + 1], e = verts[c + 1][j + 1];
      // profile segment normal (outward, up)
      let dx = prof[j + 1][0] - prof[j][0], dy = prof[j + 1][1] - prof[j][1];
      let nx = dy, ny = -dx; // rotate: for profile going up/outward this points outward-ish
      const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
      // want normal to face away from the track (outward) and up; flip if pointing inward
      if (nx < 0 || (nx === 0 && ny < 0)) { nx = -nx; ny = -ny; }
      if (dy > 0 && dx === 0) { nx = -side * 0 - 1; ny = 0; nx = -1; } // inner face points toward the track
      const nvec = (i) => [side * RX[i] * nx, ny, side * RZ[i] * nx];
      const n0 = nvec(i0), n1 = nvec(i1);
      const quad = [[a, n0], [d, n0], [b, n1], [e, n1]];
      // two triangles (double sided material hides winding concerns)
      for (const t of [[0, 1, 2], [2, 1, 3]]) for (const k of t) {
        const [v, nn] = quad[k];
        pos.push(v[0], v[1], v[2]); nor.push(nn[0], nn[1], nn[2]);
        tmpC.set(wp.color(c * stepI, j, v[4], v[3], side));
        col.push(tmpC.r, tmpC.g, tmpC.b);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

// ---------------------------------------------------------------- weather
function createWeather(kind, camera) {
  const rain = kind === 'rain';
  const count = rain ? 1500 : 1800;
  const box = rain ? new THREE.Vector3(70, 40, 70) : new THREE.Vector3(80, 34, 80);
  const base = new Float32Array(count * 3 * (rain ? 2 : 1)), endA = new Float32Array(count * (rain ? 2 : 1)), seed = new Float32Array(count * (rain ? 2 : 1));
  for (let i = 0; i < count; i++) {
    const x = Math.random(), y = Math.random(), z = Math.random(), s = Math.random();
    const reps = rain ? 2 : 1;
    for (let r = 0; r < reps; r++) {
      const k = i * reps + r;
      base[k * 3] = x; base[k * 3 + 1] = y; base[k * 3 + 2] = z;
      endA[k] = r; seed[k] = s;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(base, 3));
  g.setAttribute('aEnd', new THREE.BufferAttribute(endA, 1));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const vel = rain ? new THREE.Vector3(-4, -42, 2) : new THREE.Vector3(1.2, -3.2, 0.6);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false,
    uniforms: { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uBox: { value: box }, uVel: { value: vel }, uColor: { value: new THREE.Color(rain ? '#b8c8ff' : '#ffffff') }, uAlpha: { value: rain ? 0.35 : 0.85 }, uSize: { value: rain ? 1 : 26 }, uTex: { value: glowTex('#ffffff', 64, 0.1) } },
    vertexShader: `
      attribute float aEnd; attribute float aSeed;
      uniform float uTime, uSize; uniform vec3 uCam, uBox, uVel;
      varying float vA;
      void main(){
        vec3 p = position * uBox + uVel * uTime * (0.7 + aSeed*0.6);
        p.x += sin(uTime*0.7 + aSeed*30.0) * ${rain ? '0.0' : '1.4'};
        vec3 rel = mod(p - uCam + uBox*0.5, uBox) - uBox*0.5;
        vec3 w = uCam + rel;
        ${rain ? 'w -= normalize(uVel) * 1.5 * aEnd;' : ''}
        vec4 mv = viewMatrix * vec4(w, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uSize * (0.6 + aSeed*0.7) * (300.0 / max(1.0, -mv.z)) * 0.05;
        vA = (1.0 - smoothstep(25.0, 38.0, length(rel))) ${rain ? '* (1.0 - aEnd*0.8)' : ''};
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uAlpha; uniform sampler2D uTex; varying float vA;
      void main(){
        ${rain ? 'gl_FragColor = vec4(uColor, uAlpha * vA);' : 'vec4 t = texture2D(uTex, gl_PointCoord); gl_FragColor = vec4(uColor, t.a * uAlpha * vA);'}
      }`,
  });
  const obj = rain ? new THREE.LineSegments(g, mat) : new THREE.Points(g, mat);
  obj.frustumCulled = false; obj.renderOrder = 5;
  return { obj, update(t, cam) { mat.uniforms.uTime.value = t; mat.uniforms.uCam.value.copy(cam); } };
}

// ---------------------------------------------------------------- main
export function buildWorld(track, { quality = 'high', renderer = null } = {}) {
  const T = THEMES[track.theme];
  const group = new THREE.Group();
  const rnd = rng(track.id.split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7));
  const N = track.N;
  const animators = [];
  const corr = track.baseWidth / 2 + track.wallGap;

  // ---- sky + lighting
  const sky = createSky(track.theme);
  const L = T.light;
  const hemi = new THREE.HemisphereLight(L.hemiSky, L.hemiGround, L.hemiInt);
  const sun = new THREE.DirectionalLight(L.sun, L.sunInt);
  const sdir = sky.sunDir.clone();
  if (L.sunDir) sdir.set(...L.sunDir).normalize();
  sun.userData.dir = sdir.clone();
  sun.castShadow = quality !== 'low';
  const sh = sun.shadow;
  const smap = quality === 'high' ? 2048 : 1024;
  sh.mapSize.set(smap, smap);
  Object.assign(sh.camera, { left: -48, right: 48, top: 48, bottom: -48, near: 1, far: 240 });
  sh.bias = -0.0004; sh.normalBias = 0.06;
  group.add(hemi, sun, sun.target);
  const fog = new THREE.Fog(new THREE.Color(L.fog), L.fogNear, L.fogFar);

  // ---- terrain
  const bb = track.bounds(quality === 'low' ? 320 : 460);
  const cell = quality === 'low' ? 13 : 9;
  const nx = Math.ceil((bb.maxX - bb.minX) / cell) + 1, nz = Math.ceil((bb.maxZ - bb.minZ) / cell) + 1;
  const flatD = corr + 9;
  const heightAtRaw = (x, z, d) => {
    const t = smoothstep(flatD, flatD + T.terrain.ramp, d);
    if (t <= 0) return -0.08;
    return lerp(-0.08, T.terrain.height(x, z, d, t), t);
  };
  const heightCache = new Map();
  const heightAt = (x, z) => heightAtRaw(x, z, track.distTo(x, z, 220));
  const tPos = new Float32Array(nx * nz * 3), tCol = new Float32Array(nx * nz * 3), tUv = new Float32Array(nx * nz * 2);
  const tmp = new THREE.Color();
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const x = bb.minX + ix * cell, z = bb.minZ + iz * cell, k = iz * nx + ix;
      const d = track.distTo(x, z, 220);
      const y = heightAtRaw(x, z, d);
      tPos[k * 3] = x; tPos[k * 3 + 1] = y; tPos[k * 3 + 2] = z;
      tUv[k * 2] = x / 30; tUv[k * 2 + 1] = z / 30;
      T.terrain.color(tmp, y, d, x, z);
      tCol[k * 3] = tmp.r; tCol[k * 3 + 1] = tmp.g; tCol[k * 3 + 2] = tmp.b;
    }
  }
  const tIdx = [];
  for (let iz = 0; iz < nz - 1; iz++) for (let ix = 0; ix < nx - 1; ix++) {
    const a = iz * nx + ix, b = a + 1, c = a + nx, d = c + 1;
    tIdx.push(a, c, b, b, c, d);
  }
  const tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.BufferAttribute(tPos, 3));
  tg.setAttribute('color', new THREE.BufferAttribute(tCol, 3));
  tg.setAttribute('uv', new THREE.BufferAttribute(tUv, 2));
  tg.setIndex(tIdx);
  tg.computeVertexNormals();
  const detail = detailTex();
  const terrain = new THREE.Mesh(tg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: T.terrain.rough ?? 1, metalness: 0, map: detail }));
  terrain.receiveShadow = true;
  group.add(terrain);

  // ---- water
  let water = null;
  if (T.water) {
    const wnorm = canvasTex(256, 256, (ctx, w, h) => {
      const img = ctx.createImageData(w, h);
      const hh = (x, y) => fbm(((x + w) % w) / 24, ((y + h) % h) / 24, 4);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const dx = hh(x + 1, y) - hh(x - 1, y), dy = hh(x, y + 1) - hh(x, y - 1);
        const i = (y * w + x) * 4;
        img.data[i] = 128 + dx * 900; img.data[i + 1] = 128 + dy * 900; img.data[i + 2] = 255; img.data[i + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
    }, { srgb: false });
    const wm = new THREE.MeshPhysicalMaterial({ color: T.water.color, roughness: 0.12, metalness: 0.0, transparent: true, opacity: T.water.opacity ?? 0.86, normalMap: wnorm, normalScale: new THREE.Vector2(0.55, 0.55), clearcoat: 1, clearcoatRoughness: 0.1, envMapIntensity: 1.4 });
    wnorm.repeat.set(70, 70);
    water = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000).rotateX(-PI / 2), wm);
    water.position.y = T.water.level;
    water.renderOrder = 1;
    group.add(water);
    animators.push((dt, t) => { wnorm.offset.set(t * 0.012, t * 0.007); });
  }

  // ---- road, shoulder, kerbs
  const roadTex = asphaltTexture(T);
  const roadMat = new THREE.MeshStandardMaterial({ map: roadTex, roughness: T.road.rough, metalness: T.road.metal ?? 0, envMapIntensity: T.road.env ?? 0.5 });
  const Wd = track.W;
  const roadGeo = ribbon(track, (i) => [-Wd[i] / 2, Wd[i] / 2], 0.02, { vLen: 12 });
  const road = new THREE.Mesh(roadGeo, roadMat);
  road.receiveShadow = true;
  group.add(road);

  const shoulderColor = new THREE.Color();
  const shoulderGeoFn = (side) => ribbon(track, (i) => (side > 0 ? [Wd[i] / 2 + 0.2, Wd[i] / 2 + track.wallGap + 1] : [-Wd[i] / 2 - track.wallGap - 1, -Wd[i] / 2 - 0.2]), 0.008, {
    vLen: 12, colorFn: (i, s, o) => { T.shoulder(shoulderColor, i, o); return shoulderColor; },
  });
  for (const side of [-1, 1]) {
    const m = new THREE.Mesh(shoulderGeoFn(side), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, map: detail }));
    m.receiveShadow = true; group.add(m);
  }

  // kerbs on the corners
  const kTex = kerbTexture();
  const kerbMat = new THREE.MeshStandardMaterial({ map: kTex, roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const kerbGeos = [];
  const strongK = 0.0075;
  const ksmooth = new Float32Array(N);
  for (let i = 0; i < N; i++) { let m = 0; for (let d = -12; d <= 12; d += 3) m = Math.max(m, Math.abs(track.K[(i + d + N) % N])); ksmooth[i] = m; }
  for (const side of [-1, 1]) {
    let runStart = -1;
    for (let i = 0; i <= N; i++) {
      const on = i < N && ksmooth[i] > strongK && Math.sign(track.K[i] || 1) * side * -1 <= 1;
      // kerb the inside of the corner (inside is toward curvature sign): K>0 left turn -> inside is left (-1)
      const inside = i < N ? (track.K[i] > 0 ? -1 : 1) : 0;
      const onSide = on && (inside === side || ksmooth[i] > 0.014);
      if (onSide && runStart < 0) runStart = i;
      if ((!onSide || i === N) && runStart >= 0) {
        const len = i - runStart;
        if (len > 6) {
          const a = runStart - 2, b = i + 2;
          const g = ribbon(track, (ii) => (side > 0 ? [Wd[ii] / 2 - 0.1, Wd[ii] / 2 + 1.7] : [-Wd[ii] / 2 - 1.7, -Wd[ii] / 2 + 0.1]), 0.03, { vLen: 4, from: ((a % N) + N) % N, to: ((a % N) + N) % N + (b - a) });
          kerbGeos.push(g);
        }
        runStart = -1;
      }
    }
  }
  for (const g of kerbGeos) { const m = new THREE.Mesh(g, kerbMat); m.receiveShadow = true; group.add(m); }

  // ---- hazard zones
  for (const z of track.zones) {
    const tex = zoneTex(z.type);
    const mat = new THREE.MeshStandardMaterial({
      map: tex, transparent: true, roughness: z.type === 'ice' ? 0.08 : z.type === 'wet' ? 0.12 : 0.95, metalness: z.type === 'ice' ? 0.35 : 0.0,
      envMapIntensity: z.type === 'sand' ? 0.1 : 1.6, polygonOffset: true, polygonOffsetFactor: -1.5, polygonOffsetUnits: -1.5, depthWrite: false,
    });
    const g = ribbon(track, (i) => [-Wd[i] / 2 + 0.1, Wd[i] / 2 - 0.1], 0.034, { vLen: 12, from: z.i0 % N, to: (z.i0 % N) + (z.i1 - z.i0), closed: false });
    const m = new THREE.Mesh(g, mat); m.receiveShadow = true; m.renderOrder = 2; group.add(m);
  }

  // ---- walls
  const wallMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: T.wall.rough ?? 0.85, metalness: T.wall.metal ?? 0.0, side: THREE.DoubleSide, flatShading: !!T.wall.flat });
  for (const side of [-1, 1]) {
    const m = new THREE.Mesh(buildWall(track, side, T), wallMat);
    m.castShadow = false; m.receiveShadow = true;
    group.add(m);
  }

  // ---- start gate
  const gate = buildGate(track, T);
  group.add(gate.group);

  // ---- boost pads
  const arrows = arrowTex();
  const padMat = new THREE.MeshBasicMaterial({ map: arrows, transparent: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const padGlow = new THREE.MeshBasicMaterial({ map: glowTex('#34e0ff', 64), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.55 });
  for (const p of track.pads) {
    const pt = track.pointAt(p.idx, p.lane);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(5.4, p.len).rotateX(-PI / 2), padMat);
    m.position.set(pt.x, 0.045, pt.z); m.rotation.y = pt.h;
    const gl = new THREE.Mesh(new THREE.PlaneGeometry(9, p.len + 4).rotateX(-PI / 2), padGlow);
    gl.position.set(pt.x, 0.05, pt.z); gl.rotation.y = pt.h;
    group.add(m, gl);
  }
  animators.push((dt, t) => { arrows.offset.y = -((t * 1.6) % 1); padGlow.opacity = 0.4 + Math.sin(t * 6) * 0.15; });

  // ---- item boxes (created by game via world.setBoxes)
  const qTex = questionTex();
  const boxGeo = new THREE.BoxGeometry(1.5, 1.5, 1.5);
  const boxMat = new THREE.MeshStandardMaterial({ map: qTex, emissive: 0xffffff, emissiveMap: qTex, emissiveIntensity: 0.55, roughness: 0.3, transparent: true, opacity: 0.94 });
  const haloMat = new THREE.SpriteMaterial({ map: glowTex('#ffe9a8', 96), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.8 });
  const boxMeshes = [];
  const boxes = { list: [] };
  function setBoxes(list) {
    for (const b of boxMeshes) group.remove(b.root);
    boxMeshes.length = 0;
    for (const b of list) {
      const root = new THREE.Group();
      const cube = new THREE.Mesh(boxGeo, boxMat);
      const halo = new THREE.Sprite(haloMat); halo.scale.setScalar(4.2);
      root.add(cube, halo); root.position.set(b.x, 1.5, b.z);
      group.add(root);
      boxMeshes.push({ root, cube, ref: b });
    }
  }

  // ---- scenery
  const ctx = {
    THREE, track, rnd, group, quality, corr, bounds: bb, heightAt, waterLevel: T.water ? T.water.level : null, animators, sunDir: sdir,
    free(x, z, min = 6) { return track.distTo(x, z, min + 2) >= corr + min; },
    freeAbove(x, z, min = 6, minY = 0.3) { return this.free(x, z, min) && heightAt(x, z) > minY; },
    inst(geo, mat, matrices, o = {}) {
      const m = new THREE.InstancedMesh(geo, mat, Math.max(1, matrices.length));
      matrices.forEach((mm, i) => m.setMatrixAt(i, mm));
      m.count = matrices.length; m.instanceMatrix.needsUpdate = true;
      m.castShadow = !!o.cast; m.receiveShadow = !!o.receive; m.frustumCulled = false;
      group.add(m); return m;
    },
    scatter(count, { min = 8, max = 400, minY = -1e9, maxY = 1e9, attempts = 30, minGap = 0, along = null } = {}) {
      const out = []; const pts = [];
      for (let k = 0; k < count * attempts && out.length < count; k++) {
        const x = lerp(bb.minX, bb.maxX, rnd()), z = lerp(bb.minZ, bb.maxZ, rnd());
        const d = track.distTo(x, z, max + 2);
        if (d < corr + min || d > corr + max) continue;
        const y = heightAtRaw(x, z, d);
        if (y < minY || y > maxY) continue;
        if (minGap > 0 && pts.some((p) => (p[0] - x) ** 2 + (p[1] - z) ** 2 < minGap * minGap)) continue;
        pts.push([x, z]); out.push({ x, y, z, d, r: rnd() });
      }
      return out;
    },
    // points hugging the outside of the wall along the track
    along(count, { out = 3, jitter = 3, sides = [-1, 1], every = null } = {}) {
      const res = [];
      const stepI = every || Math.max(1, Math.floor(N / count));
      for (let i = 0; i < N; i += stepI) for (const s of sides) {
        const o = s * (track.W[i] / 2 + track.wallGap + out + (rnd() - 0.5) * jitter);
        const p = track.pointAt(i, o);
        res.push({ x: p.x, z: p.z, h: p.h, y: heightAtRaw(p.x, p.z, track.distTo(p.x, p.z, 80)), i, side: s, r: rnd() });
      }
      return res;
    },
    heightRaw: heightAtRaw,
  };
  T.scenery(ctx);

  // ---- weather
  let weather = null;
  if (T.weather && quality !== 'low') { weather = createWeather(T.weather); group.add(weather.obj); }

  // ---- environment for reflections
  let envTex = null;
  function buildEnv(rend) {
    const pm = new THREE.PMREMGenerator(rend);
    const sc = new THREE.Scene();
    const s2 = createSky(track.theme);
    s2.mesh.scale.setScalar(50);
    s2.update(new THREE.Vector3(), 3);
    sc.add(s2.mesh);
    // warm ground bounce
    const g = new THREE.Mesh(new THREE.CircleGeometry(60, 24).rotateX(-PI / 2), new THREE.MeshBasicMaterial({ color: T.light.hemiGround }));
    g.position.y = -4; sc.add(g);
    envTex = pm.fromScene(sc, 0.02, 0.5, 200).texture;
    pm.dispose();
    return envTex;
  }
  if (renderer) buildEnv(renderer);

  const camPos = new THREE.Vector3();
  function update(dt, t, cam, focus) {
    camPos.copy(cam.position);
    sky.update(camPos, t);
    for (const a of animators) a(dt, t);
    if (weather) weather.update(t, camPos);
    // sun follows the focus point so shadows stay tight
    if (focus) {
      sun.position.copy(focus).addScaledVector(sun.userData.dir, 120);
      sun.target.position.copy(focus);
      // snap shadow camera to texel grid to prevent shimmering
      const texel = 96 / smap;
      sun.position.x = Math.round(sun.position.x / texel) * texel;
      sun.position.z = Math.round(sun.position.z / texel) * texel;
      sun.target.position.x = Math.round(sun.target.position.x / texel) * texel;
      sun.target.position.z = Math.round(sun.target.position.z / texel) * texel;
    }
    for (const b of boxMeshes) {
      const live = b.ref.cd <= 0;
      b.root.visible = live;
      if (live) { b.cube.rotation.y = t * 1.6 + b.ref.x * 0.1; b.cube.rotation.x = Math.sin(t * 1.3 + b.ref.z) * 0.3; b.root.position.y = 1.55 + Math.sin(t * 2.4 + b.ref.x) * 0.18; }
    }
  }

  return {
    group, sky, sun, hemi, fog, update, setBoxes, gate, heightAt, env: envTex, theme: track.theme,
    exposure: L.exposure, bg: L.fog, weather: T.weather,
    dispose() { dispose(group); },
  };
}

// ---------------------------------------------------------------- start gate
function buildGate(track, T) {
  const g = new THREE.Group();
  const i0 = 0, pt = track.pointAt(i0, 0);
  const w = track.W[i0] / 2 + 3.6;
  const trussMat = new THREE.MeshStandardMaterial({ color: 0x20252f, roughness: 0.5, metalness: 0.7 });
  const accent = new THREE.MeshStandardMaterial({ color: 0xffd23f, roughness: 0.4, metalness: 0.3 });
  const root = new THREE.Group();
  root.position.set(pt.x, 0, pt.z); root.rotation.y = pt.h;
  // pylons (local +x is... use world right = -x in local; symmetric so fine)
  for (const s of [-1, 1]) {
    const col = new THREE.Mesh(new THREE.BoxGeometry(1.6, 10.5, 1.6), trussMat); col.position.set(s * w, 5.25, 0); col.castShadow = true;
    const base = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.8, 2.4), accent); base.position.set(s * w, 0.4, 0);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.5, 2.0), accent); cap.position.set(s * w, 10.6, 0);
    root.add(col, base, cap);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(w * 2 + 1.6, 1.3, 1.4), trussMat); beam.position.set(0, 10.1, 0); beam.castShadow = true;
  root.add(beam);
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(w * 2 - 2.4, 4.2), new THREE.MeshBasicMaterial({ map: bannerTex('START · FINISH'), side: THREE.DoubleSide }));
  banner.position.set(0, 7.9, 0.0); root.add(banner);
  const banner2 = banner.clone(); banner2.rotation.y = PI; banner2.position.z = -0.02; root.add(banner2);
  // countdown lights
  const lamps = [];
  for (let k = 0; k < 3; k++) {
    const m = new THREE.MeshBasicMaterial({ color: 0x331111 });
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.62, 18, 12), m);
    lamp.position.set((k - 1) * 2.2, 10.1, 0.8);
    const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.78, 0.4, 18).rotateX(PI / 2), new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.6 }));
    housing.position.set((k - 1) * 2.2, 10.1, 0.62);
    root.add(housing, lamp); lamps.push(m);
  }
  // checker line on road
  const chk = new THREE.Mesh(new THREE.PlaneGeometry(track.W[i0], 2.4).rotateX(-PI / 2), new THREE.MeshBasicMaterial({ map: (() => { const t = checkerTex(); return t; })(), polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
  chk.position.set(0, 0.04, 0); root.add(chk);
  // grid boxes
  const boxMat = new THREE.MeshBasicMaterial({ color: 0xffffff, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  for (let r = 0; r < 4; r++) for (const c of [0, 1]) {
    const back = 10 + r * 8.5 + (c ? 3.5 : 0);
    const lane = c ? 5.2 : -5.2;
    // local: +z is forward, local x = -right (since right = -x when h = 0)
    const bx = -lane, bz = -back;
    const bar = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 0.2).rotateX(-PI / 2), boxMat); bar.position.set(bx, 0.045, bz + 2.8);
    const l1 = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 2.6).rotateX(-PI / 2), boxMat); l1.position.set(bx - 1.4, 0.045, bz + 1.5);
    const l2 = l1.clone(); l2.position.x = bx + 1.4;
    root.add(bar, l1, l2);
  }
  g.add(root);
  const colors = [0xff2a2a, 0xff2a2a, 0x37ff6a];
  return {
    group: g,
    setLights(n) { // n: 0 off, 1..3 red lights lit, 4 = green
      lamps.forEach((m, k) => { m.color.setHex(n === 4 ? 0x37ff6a : k < n ? 0xff2a2a : 0x2a1010); });
    },
  };
}

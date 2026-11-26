// Track geometry: closed Catmull-Rom spline resampled to even ~2 m spacing.
// World convention: forward = (sin h, cos h), right = (cos h, -sin h) * -1 -> r = (-tz, tx).
// steering right DEcreases heading; curvature K > 0 means a LEFT turn.
import { wrapPi, clamp } from './util.js';

function cr(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

export class Track {
  constructor(def) {
    this.def = def;
    this.id = def.id;
    this.name = def.name;
    this.theme = def.theme;
    this.laps = def.laps ?? 3;
    this.wallGap = def.wallGap ?? 10;
    this.baseWidth = def.width ?? 24;
    this._build();
  }

  _build() {
    const def = this.def, pts = def.ctrl, n = pts.length, SEG = 48;
    const dense = [];
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
      const w = (p) => p[2] ?? this.baseWidth;
      for (let k = 0; k < SEG; k++) {
        const t = k / SEG;
        dense.push([cr(p0[0], p1[0], p2[0], p3[0], t), cr(p0[1], p1[1], p2[1], p3[1], t), cr(w(p0), w(p1), w(p2), w(p3), t)]);
      }
    }
    const m = dense.length;
    const cum = new Float64Array(m + 1);
    for (let i = 1; i <= m; i++) {
      const a = dense[i - 1], b = dense[i % m];
      cum[i] = cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    const total = cum[m];
    const N = Math.round(total / 2);
    const step = total / N;
    this.N = N;
    this.step = step;
    this.length = total;
    const X = (this.X = new Float32Array(N));
    const Z = (this.Z = new Float32Array(N));
    const W = (this.W = new Float32Array(N));
    let j = 0;
    for (let s = 0; s < N; s++) {
      const target = s * step;
      while (cum[j + 1] < target) j++;
      const a = dense[j], b = dense[(j + 1) % m];
      const t = (target - cum[j]) / Math.max(1e-6, cum[j + 1] - cum[j]);
      X[s] = a[0] + (b[0] - a[0]) * t;
      Z[s] = a[1] + (b[1] - a[1]) * t;
      W[s] = a[2] + (b[2] - a[2]) * t;
    }
    // Tangents, normals, heading, curvature.
    const TX = (this.TX = new Float32Array(N));
    const TZ = (this.TZ = new Float32Array(N));
    const RX = (this.RX = new Float32Array(N));
    const RZ = (this.RZ = new Float32Array(N));
    const H = (this.H = new Float32Array(N));
    for (let i = 0; i < N; i++) {
      const a = (i - 2 + N) % N, b = (i + 2) % N;
      let dx = X[b] - X[a], dz = Z[b] - Z[a];
      const l = Math.hypot(dx, dz) || 1;
      dx /= l; dz /= l;
      TX[i] = dx; TZ[i] = dz;
      RX[i] = -dz; RZ[i] = dx;
      H[i] = Math.atan2(dx, dz);
    }
    const K = (this.K = new Float32Array(N));
    const raw = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = (i - 3 + N) % N, b = (i + 3) % N;
      raw[i] = wrapPi(H[b] - H[a]) / (6 * step);
    }
    for (let i = 0; i < N; i++) {
      let acc = 0;
      for (let d = -3; d <= 3; d++) acc += raw[(i + d + N) % N];
      K[i] = acc / 7;
    }
    // spatial hash for fast full searches (used on spawn/reset)
    this._cell = 40;
    this._grid = new Map();
    for (let i = 0; i < N; i++) {
      const key = this._key(X[i], Z[i]);
      let arr = this._grid.get(key);
      if (!arr) this._grid.set(key, (arr = []));
      arr.push(i);
    }
  }

  _key(x, z) {
    return Math.floor(x / this._cell) + ',' + Math.floor(z / this._cell);
  }

  idx(i) {
    return ((i % this.N) + this.N) % this.N;
  }

  // Position on the centre line (+ lateral offset, + right) at a fractional sample index.
  pointAt(fi, lane = 0) {
    const N = this.N;
    const i0 = Math.floor(fi), f = fi - i0;
    const a = this.idx(i0), b = this.idx(i0 + 1);
    const x = this.X[a] + (this.X[b] - this.X[a]) * f;
    const z = this.Z[a] + (this.Z[b] - this.Z[a]) * f;
    const rx = this.RX[a] + (this.RX[b] - this.RX[a]) * f;
    const rz = this.RZ[a] + (this.RZ[b] - this.RZ[a]) * f;
    const l = Math.hypot(rx, rz) || 1;
    const h = this.H[a] + wrapPi(this.H[b] - this.H[a]) * f;
    return { x: x + (rx / l) * lane, z: z + (rz / l) * lane, h, w: this.W[a] + (this.W[b] - this.W[a]) * f };
  }

  // Fraction of lap (0..1) -> sample index
  uToIdx(u) {
    return Math.round(((u % 1) + 1) % 1 * this.N) % this.N;
  }

  // Nearest sample near hint (windowed) or global (hint < 0).
  locate(x, z, hint = -1, win = 36) {
    const { X, Z, N } = this;
    let best = -1, bd = 1e18;
    if (hint < 0) {
      const cx = Math.floor(x / this._cell), cz = Math.floor(z / this._cell);
      for (let r = 1; r <= 12 && best < 0; r++) {
        for (let ix = cx - r; ix <= cx + r; ix++) {
          for (let iz = cz - r; iz <= cz + r; iz++) {
            const arr = this._grid.get(ix + ',' + iz);
            if (!arr) continue;
            for (const i of arr) {
              const d = (X[i] - x) ** 2 + (Z[i] - z) ** 2;
              if (d < bd) { bd = d; best = i; }
            }
          }
        }
      }
      if (best < 0) for (let i = 0; i < N; i++) { const d = (X[i] - x) ** 2 + (Z[i] - z) ** 2; if (d < bd) { bd = d; best = i; } }
    } else {
      for (let d = -win; d <= win; d++) {
        const i = (hint + d + N) % N;
        const dd = (X[i] - x) ** 2 + (Z[i] - z) ** 2;
        if (dd < bd) { bd = dd; best = i; }
      }
    }
    const dx = x - X[best], dz = z - Z[best];
    const along = dx * this.TX[best] + dz * this.TZ[best];
    const off = dx * this.RX[best] + dz * this.RZ[best];
    return { idx: best, frac: clamp(along / this.step, -1, 1), off, w: this.W[best] };
  }

  // Euclidean distance from (x,z) to the centre line (capped at ~cap metres). Cheap: uses the spatial hash.
  distTo(x, z, cap = 160) {
    const { X, Z } = this;
    const cx = Math.floor(x / this._cell), cz = Math.floor(z / this._cell);
    const R = Math.ceil(cap / this._cell);
    let bd = cap * cap, found = false;
    for (let ix = cx - R; ix <= cx + R; ix++) {
      for (let iz = cz - R; iz <= cz + R; iz++) {
        const arr = this._grid.get(ix + ',' + iz);
        if (!arr) continue;
        for (let k = 0; k < arr.length; k++) {
          const i = arr[k];
          const d = (X[i] - x) ** 2 + (Z[i] - z) ** 2;
          if (d < bd) { bd = d; found = true; }
        }
      }
    }
    return found ? Math.sqrt(bd) : cap;
  }

  bounds(margin = 0) {
    let a = 1e9, b = -1e9, c = 1e9, d = -1e9;
    for (let i = 0; i < this.N; i++) { a = Math.min(a, this.X[i]); b = Math.max(b, this.X[i]); c = Math.min(c, this.Z[i]); d = Math.max(d, this.Z[i]); }
    return { minX: a - margin, maxX: b + margin, minZ: c - margin, maxZ: d + margin };
  }

  // Check that the track doesn't squeeze against itself and report stats.
  analyze() {
    const { N, X, Z, step } = this;
    let minSep = 1e9, minSepAt = -1;
    const skip = Math.ceil(120 / step); // ignore neighbours within 120 m of arc
    for (let i = 0; i < N; i += 2) {
      for (let j = i + skip; j < N; j += 2) {
        if (N - (j - i) < skip) continue;
        const d = Math.hypot(X[i] - X[j], Z[i] - Z[j]);
        if (d < minSep) { minSep = d; minSepAt = i; }
      }
    }
    let kmax = 0;
    for (let i = 0; i < N; i++) kmax = Math.max(kmax, Math.abs(this.K[i]));
    return { length: this.length, samples: N, minSep, minSepAt, minRadius: 1 / (kmax || 1e-6) };
  }
}

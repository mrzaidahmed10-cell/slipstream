// Deterministic race simulation: kart physics, drifting, items, hazards, laps.
// Pure logic - no rendering. The renderer reads kart state and drains `race.events`.
import { clamp, wrapPi, damp, rng } from './util.js';
import { physicsFor } from './vehicles.js';
import { zoneAt } from './tracks.js';
import { makeAI, aiInput } from './ai.js';

export const COUNTDOWN = 3.0;
const DRIFT_TIERS = [
  { at: 1.0, time: 0.55, power: 0.3 },
  { at: 2.2, time: 1.05, power: 0.38 },
  { at: 3.6, time: 1.6, power: 0.46 },
];
const SURFACE_GRIP = { road: 11, kerb: 9, off: 6.5 };
const ZONE = {
  ice: { grip: 2.4, steer: 0.55, speed: 1 },
  wet: { grip: 7, steer: 0.92, speed: 1 },
  sand: { grip: 6, steer: 0.9, speed: 0.78 },
};

export const ITEM_INFO = {
  turbo: { name: 'Turbo Cell', color: '#ffb02e' },
  triple: { name: 'Triple Turbo', color: '#ff7a1a' },
  oil: { name: 'Oil Slick', color: '#8a5cff' },
  mine: { name: 'Proximity Mine', color: '#ff4f4f' },
  seeker: { name: 'Seeker Pod', color: '#2ee6c8' },
  shield: { name: 'Aegis Shield', color: '#4da3ff' },
};

export class Kart {
  constructor(entry, slot, track) {
    this.id = entry.id;
    this.name = entry.name;
    this.vehicle = entry.vehicle;
    this.color = entry.color;
    this.stripe = entry.stripe || 'none';
    this.isPlayer = !!entry.isPlayer;
    this.skill = entry.skill ?? 0.5;
    this.number = entry.number ?? slot + 1;
    this.P = physicsFor(entry.vehicle);
    this.ai = this.isPlayer ? null : makeAI(this.skill, rng((entry.seed ?? 1) * 7919 + slot));
    this.auto = false; // finished karts coast under AI control
    this.slot = slot;
    // grid placement behind the start line
    const row = Math.floor(slot / 2), col = slot % 2;
    const back = 10 + row * 8.5 + (col ? 3.5 : 0);
    const p = track.pointAt(-back / track.step, col ? 5.2 : -5.2);
    this.x = p.x; this.z = p.z; this.h = p.h;
    this.vx = 0; this.vz = 0; this.speed = 0; this.slip = 0;
    this.steer = 0;
    this.idx = track.locate(this.x, this.z, -1).idx;
    const loc = track.locate(this.x, this.z, this.idx);
    this.off = loc.off;
    this.lastF = loc.idx + loc.frac;
    this.prog = -back;
    this.lapsDone = -1; // becomes 0 on crossing the line the first time
    this.lapTimes = [];
    this.lapStart = 0;
    this.finished = false; this.finishTime = null; this.rank = slot + 1;
    this.driftState = 0; this.driftDir = 0; this.driftCharge = 0; this.driftTier = 0; this.hopT = 0;
    this.boostT = 0; this.boostPow = 0;
    this.spinT = 0; this.spinAng = 0; this.invulnT = 0; this.shieldT = 0;
    this.item = null; this.itemCount = 0; this.rollT = 0; this.itemCd = 0;
    this.stuckT = 0; this.wrongT = 0;
    this.surface = 'road'; this.zone = null;
    this.prev = { drift: false, rawThr: 0, item: false };
    this.speedMul = this.isPlayer ? 1 : 0.82 + 0.2 * this.skill;
    this.padCd = 0;
    this.throttleEdgeAt = null;
    this.wallHit = 0;
    this.bumpT = 0;
    this.stats = { hits: 0, driftBoosts: 0, wallHits: 0, itemsUsed: 0, offroad: 0 };
  }
}

export class Race {
  constructor(opts) {
    this.track = opts.track;
    this.laps = opts.laps ?? this.track.laps;
    this.mode = opts.mode || 'race'; // race | time | tutorial | qualify
    this.rubber = opts.rubber ?? 0;
    this.rnd = rng(opts.seed ?? 1234);
    this.itemsOn = opts.items !== false;
    this.forceItem = opts.forceItem || null;
    this.karts = opts.entries.map((e, i) => new Kart({ ...e, seed: opts.seed ?? 1 }, e.slot ?? i, this.track));
    this.player = this.karts.find((k) => k.isPlayer) || null;
    this.time = -COUNTDOWN;
    this.state = 'countdown'; // countdown | racing | finished
    this.events = [];
    this.hazards = [];
    this.projectiles = [];
    this.nextId = 1;
    this.input = { steer: 0, throttle: 0, brake: 0, drift: false, item: false, reset: false };
    this.finishedAt = null;
    this.lastCount = 4;
    const layout = opts.layout || { itemRows: this.itemsOn ? this.track.itemRows : [], pads: this.track.pads };
    this.pads = layout.pads.map((p) => {
      const pt = this.track.pointAt(p.idx, p.lane);
      return { ...p, x: pt.x, z: pt.z, h: pt.h, cd: 0 };
    });
    this.boxes = [];
    for (const row of layout.itemRows) {
      for (const lane of row.lanes) {
        const pt = this.track.pointAt(row.idx, lane);
        this.boxes.push({ x: pt.x, z: pt.z, idx: row.idx, lane, cd: 0 });
      }
    }
    this.updateRanks();
  }

  emit(type, data = {}) { this.events.push({ type, ...data }); }
  drain() { const e = this.events; this.events = []; return e; }
  kartById(id) { return this.karts.find((k) => k.id === id); }

  // ---------------------------------------------------------------- main step
  step(dt) {
    if (this.state === 'countdown') {
      this.time += dt;
      const n = Math.ceil(-this.time);
      if (n !== this.lastCount && n >= 1 && n <= 3) { this.lastCount = n; this.emit('count', { n }); }
      if (this.time >= 0) { this.state = 'racing'; this.emit('go'); this.rocketStart(); }
    } else {
      this.time += dt;
    }
    const raceLive = this.state !== 'countdown';
    for (const k of this.karts) {
      let inp;
      if (k.isPlayer && !k.auto) inp = this.input;
      else inp = raceLive ? aiInput(k, this, dt) : { steer: 0, throttle: 0, brake: 0, drift: false, item: false };
      this.stepKart(k, inp, dt, raceLive);
    }
    this.collideKarts();
    this.stepHazards(dt);
    this.stepProjectiles(dt);
    this.stepPickups(dt);
    this.updateRanks();
    if (this.state === 'racing' && this.player && this.player.finished && this.finishedAt === null) {
      this.finishedAt = this.time;
      this.state = 'finished';
      this.emit('race-finish');
    }
    if (this.state === 'racing' && !this.player && this.karts.every((k) => k.finished)) this.state = 'finished';
  }

  rocketStart() {
    for (const k of this.karts) {
      if (k.isPlayer) {
        // perfect start: throttle pressed within a short window around GO
        if (k.throttleEdgeAt !== null && k.throttleEdgeAt >= -0.55) {
          this.boost(k, 1.0, 0.42); this.emit('rocket', { id: k.id });
        }
      } else if (this.rnd() < k.skill * 0.55) {
        this.boost(k, 0.8, 0.38);
      }
    }
  }

  boost(k, time, power) {
    if (k.boostT < time || k.boostPow < power) { k.boostT = Math.max(k.boostT, time); k.boostPow = Math.max(k.boostPow, power); }
    this.emit('boost', { id: k.id, power });
  }

  // ---------------------------------------------------------------- kart physics
  stepKart(k, inp, dt, live) {
    const T = this.track, P = k.P;
    const spinning = k.spinT > 0;
    let steerIn = inp.steer, thr = inp.throttle, brk = inp.brake, driftKey = inp.drift;
    if (!live || spinning) { steerIn = 0; thr = 0; brk = spinning ? 0 : brk; driftKey = false; }
    if (this.state === 'countdown' && k.isPlayer) {
      const raw = inp.throttle;
      if (raw > 0.5 && k.prev.rawThr <= 0.5) k.throttleEdgeAt = this.time;
      if (raw <= 0.5) k.throttleEdgeAt = null;
    }
    k.prev.rawThr = inp.throttle;

    // timers
    k.boostT = Math.max(0, k.boostT - dt); if (k.boostT === 0) k.boostPow = 0;
    k.invulnT = Math.max(0, k.invulnT - dt);
    k.shieldT = Math.max(0, k.shieldT - dt);
    k.itemCd = Math.max(0, k.itemCd - dt);
    k.bumpT = Math.max(0, k.bumpT - dt);
    k.wallHit = Math.max(0, k.wallHit - dt);
    if (k.rollT > 0) {
      k.rollT -= dt;
      if (k.rollT <= 0) this.grantItem(k);
    }
    if (spinning) {
      k.spinT -= dt; k.spinAng += dt * 10;
      if (k.spinT <= 0) { k.spinT = 0; k.spinAng = 0; k.invulnT = Math.max(k.invulnT, 1.6); this.emit('recover', { id: k.id }); }
    }

    // surface
    const half = T.W[k.idx] / 2;
    const ao = Math.abs(k.off);
    k.surface = ao < half ? 'road' : ao < half + 2.2 ? 'kerb' : 'off';
    k.zone = k.surface === 'road' ? zoneAt(T, k.idx) : null;
    const zone = k.zone ? ZONE[k.zone] : null;
    const offSpeed = T.def.offSpeed ?? 0.62;
    let surfSpeed = k.surface === 'off' ? offSpeed : k.surface === 'kerb' ? 0.93 : 1;
    if (zone) surfSpeed *= zone.speed;
    if (k.boostT > 0) surfSpeed = Math.max(surfSpeed, 0.9);
    const rubber = k.rubberMul ?? 1;
    const vmaxEff = P.vmax * surfSpeed * (1 + k.boostPow) * (k.isPlayer ? 1 : rubber * (k.speedMul ?? 1));

    const fx = Math.sin(k.h), fz = Math.cos(k.h);
    let vf = k.vx * fx + k.vz * fz;

    // --- acceleration
    let a = 0;
    if (thr > 0 && vf < vmaxEff) a += P.accel * thr * (1 - Math.pow(Math.max(vf, 0) / vmaxEff, 2));
    if (k.boostT > 0) a += 38 * (vf < vmaxEff ? 1 : 0);
    if (brk > 0) {
      if (vf > 1.5) a -= 42 * brk;
      else if (thr === 0) a -= 13 * brk * (vf > -9 ? 1 : 0);
    }
    if (thr === 0 && brk === 0) a -= vf * 0.1 + (Math.abs(vf) > 0.5 ? Math.sign(vf) * 1.4 : 0);
    if (k.surface === 'off' && !spinning) a -= vf * 0.35;
    k.vx += fx * a * dt; k.vz += fz * a * dt;
    vf = k.vx * fx + k.vz * fz;
    if (vf > vmaxEff) { const cut = (vf - vmaxEff) * Math.min(1, 2.6 * dt); k.vx -= fx * cut; k.vz -= fz * cut; vf -= cut; }
    if (spinning) { const d = Math.exp(-2.4 * dt); k.vx *= d; k.vz *= d; }

    // --- drifting state machine
    const sp = Math.abs(vf);
    if (driftKey && !k.prev.drift && k.driftState === 0 && sp > 0.4 * P.vmax && k.surface !== 'off' && !spinning) {
      k.driftState = 1; k.hopT = 0.16; this.emit('hop', { id: k.id });
    }
    if (k.driftState === 1) {
      k.hopT -= dt;
      if (!driftKey) k.driftState = 0;
      else if (k.hopT <= 0 && Math.abs(k.steer) > 0.28) {
        k.driftState = 2; k.driftDir = Math.sign(k.steer) || 1; k.driftCharge = 0; k.driftTier = 0;
        this.emit('drift-start', { id: k.id });
      }
    }
    if (k.driftState === 2) {
      const rel = k.steer * k.driftDir;
      k.driftCharge += dt * (0.85 + (rel > 0.55 ? 0.55 : 0) - (rel < -0.4 ? 0.3 : 0)) * (sp > 0.55 * P.vmax ? 1 : 0.55);
      let tier = 0;
      for (let i = 0; i < DRIFT_TIERS.length; i++) if (k.driftCharge >= DRIFT_TIERS[i].at) tier = i + 1;
      if (tier > k.driftTier) { k.driftTier = tier; this.emit('drift-tier', { id: k.id, tier }); }
      if (!driftKey || sp < 0.28 * P.vmax || spinning || k.surface === 'off') this.endDrift(k);
    }
    if (k.hopT > 0 && k.driftState !== 1) k.hopT = Math.max(0, k.hopT - dt);

    // --- steering
    k.steer += (steerIn - k.steer) * damp(13, dt);
    const zoneSteer = zone ? zone.steer : 1;
    let dh = 0;
    if (k.driftState === 2) {
      const rel = k.steer * k.driftDir;
      const dOmega = Math.min(P.maxTurn * 0.95, 42 / Math.max(sp, 12));
      dh = -k.driftDir * dOmega * (0.62 + 0.38 * rel) * dt;
    } else {
      const omega = Math.min(P.maxTurn, P.aLat / Math.max(sp, 3)) * clamp(sp / 5, 0, 1) * zoneSteer * (k.surface === 'off' ? 0.9 : 1);
      dh = -k.steer * omega * dt * (vf >= -0.5 ? 1 : -1);
    }
    k.h += dh;

    // --- tyre grip: velocity rotates toward the heading
    const nfx = Math.sin(k.h), nfz = Math.cos(k.h);
    let grip = SURFACE_GRIP[k.surface];
    if (zone) grip = Math.min(grip, zone.grip);
    if (k.driftState === 2) grip = zone && k.zone === 'ice' ? 1.6 : 3.1;
    else if (k.surface === 'road' && !zone && k.boostT > 0) grip = 13;
    const spd = Math.hypot(k.vx, k.vz);
    const dir = k.vx * nfx + k.vz * nfz >= 0 ? 1 : -1;
    const ga = 1 - Math.exp(-grip * dt);
    k.vx += (nfx * spd * dir - k.vx) * ga;
    k.vz += (nfz * spd * dir - k.vz) * ga;
    k.speed = k.vx * nfx + k.vz * nfz;
    k.slip = k.vx * -nfz + k.vz * nfx;

    // --- integrate
    k.x += k.vx * dt; k.z += k.vz * dt;

    // --- track locate, walls, progress
    let loc = T.locate(k.x, k.z, k.idx, 30);
    const lim = T.W[loc.idx] / 2 + T.wallGap - P.radius;
    if (Math.abs(loc.off) > lim) {
      const s = Math.sign(loc.off), nx = T.RX[loc.idx] * s, nz = T.RZ[loc.idx] * s;
      const over = Math.abs(loc.off) - lim;
      k.x -= nx * over; k.z -= nz * over;
      const vn = k.vx * nx + k.vz * nz;
      if (vn > 0) {
        k.vx -= nx * vn * 1.3; k.vz -= nz * vn * 1.3;
        k.vx *= 0.95; k.vz *= 0.95;
        if (vn > 4.5 && k.wallHit <= 0) { k.wallHit = 0.25; k.stats.wallHits++; this.emit('wall', { id: k.id, power: vn }); }
        // slide along the wall
        k.h += wrapPi(T.H[loc.idx] - k.h) * 0.07;
      }
      loc = T.locate(k.x, k.z, loc.idx, 6);
    }
    k.idx = loc.idx; k.off = loc.off;
    const f = loc.idx + loc.frac;
    let d = f - k.lastF;
    const N = T.N;
    if (d > N / 2) d -= N; else if (d < -N / 2) d += N;
    k.prog += d * T.step; k.lastF = f;
    if (k.surface === 'off') k.stats.offroad += dt;

    // wrong way
    const tdot = k.vx * T.TX[k.idx] + k.vz * T.TZ[k.idx];
    k.wrongT = tdot < -3 && live ? k.wrongT + dt : 0;

    // laps
    const lapNow = Math.floor(k.prog / T.length);
    if (live && lapNow > k.lapsDone && !k.finished) {
      if (k.lapsDone >= 0) {
        const lt = this.time - k.lapStart;
        k.lapTimes.push(lt);
        this.emit('lap', { id: k.id, lap: k.lapTimes.length, time: lt, best: lt <= Math.min(...k.lapTimes) });
      }
      k.lapsDone = lapNow; k.lapStart = this.time;
      if (lapNow >= this.laps) {
        k.finished = true;
        k.finishTime = this.time - Math.max(0, (k.prog - this.laps * T.length)) / Math.max(10, Math.abs(k.speed));
        k.auto = true;
        this.emit('finish', { id: k.id, time: k.finishTime });
      }
    }

    // boost pads
    if (live) {
      k.padCd = Math.max(0, k.padCd - dt);
      if (k.padCd <= 0) {
        for (const p of this.pads) {
          let di = k.idx - p.idx;
          if (di > N / 2) di -= N; else if (di < -N / 2) di += N;
          if (Math.abs(di) * T.step < p.len * 0.5 && Math.abs(k.off - p.lane) < 5) {
            this.boost(k, 1.5, 0.42); this.emit('pad', { id: k.id }); k.padCd = 1.0; break;
          }
        }
      }
    }

    // items
    if (inp.item && !k.prev.item && live) this.useItem(k);

    // manual reset or stuck
    if (live && !k.finished) {
      if (Math.abs(k.speed) < 1.6 && k.spinT <= 0) k.stuckT += dt; else k.stuckT = 0;
      if (inp.reset || k.stuckT > 3.2 || k.wrongT > 6 || k.surface === 'off' && k.stuckT > 1.8) this.respawn(k);
    }

    k.prev.drift = driftKey; k.prev.item = !!inp.item;
  }

  endDrift(k) {
    if (k.driftState === 2 && k.driftTier > 0) {
      const t = DRIFT_TIERS[k.driftTier - 1];
      this.boost(k, t.time, t.power);
      k.stats.driftBoosts++;
      this.emit('drift-boost', { id: k.id, tier: k.driftTier });
    }
    k.driftState = 0; k.driftCharge = 0; k.driftTier = 0; k.driftDir = 0;
  }

  respawn(k) {
    const T = this.track;
    const i = T.idx(k.idx - 4);
    const p = T.pointAt(i, 0);
    let dd = i - k.lastF;
    if (dd > T.N / 2) dd -= T.N; else if (dd < -T.N / 2) dd += T.N;
    k.prog += dd * T.step;
    k.x = p.x; k.z = p.z; k.h = p.h; k.vx = 0; k.vz = 0; k.speed = 0; k.steer = 0;
    k.off = 0; k.idx = i; k.lastF = i; k.stuckT = 0; k.wrongT = 0;
    k.spinT = 0; k.spinAng = 0; k.invulnT = 2.2; k.boostT = 0; k.boostPow = 0;
    k.driftState = 0; k.driftCharge = 0; k.driftTier = 0;
    this.emit('respawn', { id: k.id });
  }

  // ---------------------------------------------------------------- items & hazards
  rankCount() { return this.karts.length; }

  rollItem(k) {
    const n = this.karts.length;
    const f = n > 1 ? (k.rank - 1) / (n - 1) : 0.5;
    const w = {
      turbo: 16 + 26 * f,
      triple: 22 * f * f,
      oil: 8 + 24 * (1 - f),
      mine: 5 + 16 * (1 - f),
      seeker: k.rank === 1 ? 0 : 6 + 24 * f,
      shield: 8 + 18 * (1 - f),
    };
    let sum = 0;
    for (const key in w) sum += w[key];
    let r = this.rnd() * sum;
    for (const key in w) { r -= w[key]; if (r <= 0) return key; }
    return 'turbo';
  }

  grantItem(k) {
    k.item = this.forceItem || this.rollItem(k);
    k.itemCount = k.item === 'triple' ? 3 : 1;
    this.emit('item-got', { id: k.id, item: k.item });
  }

  useItem(k) {
    if (!k.item || k.rollT > 0 || k.itemCd > 0) return;
    const T = this.track;
    const fx = Math.sin(k.h), fz = Math.cos(k.h);
    k.itemCd = 0.35;
    k.stats.itemsUsed++;
    switch (k.item) {
      case 'turbo': this.boost(k, 1.6, 0.5); k.item = null; break;
      case 'triple':
        this.boost(k, 1.1, 0.48);
        if (--k.itemCount <= 0) k.item = null;
        break;
      case 'oil':
        this.hazards.push({ id: this.nextId++, type: 'oil', x: k.x - fx * 3.4, z: k.z - fz * 3.4, r: 2.9, age: 0, arm: 0.5, life: 30, owner: k.id });
        k.item = null; break;
      case 'mine':
        this.hazards.push({ id: this.nextId++, type: 'mine', x: k.x - fx * 3.4, z: k.z - fz * 3.4, r: 2.3, age: 0, arm: 0.9, life: 45, owner: k.id });
        k.item = null; break;
      case 'seeker': {
        const ahead = this.karts.filter((o) => o !== k && o.rank < k.rank).sort((a, b) => b.rank - a.rank)[0];
        this.projectiles.push({ id: this.nextId++, type: 'seeker', idxF: k.lastF + 2, lane: k.off, speed: 80, target: ahead ? ahead.id : null, age: 0, owner: k.id, x: k.x, z: k.z, h: k.h });
        k.item = null; break;
      }
      case 'shield': k.shieldT = 8; this.emit('shield', { id: k.id }); k.item = null; break;
    }
    this.emit('item-use', { id: k.id });
  }

  hitKart(k, kind) {
    if (k.invulnT > 0 || k.spinT > 0 || k.finished) return false;
    if (k.shieldT > 0) {
      k.shieldT = 0; k.invulnT = 0.6;
      this.emit('shield-pop', { id: k.id });
      return false;
    }
    const dur = { oil: 1.15, mine: 1.8, seeker: 1.6 }[kind] || 1.2;
    k.spinT = dur; k.spinAng = 0; k.stats.hits++;
    this.endDriftSilently(k);
    k.boostT = 0; k.boostPow = 0;
    this.emit('hit', { id: k.id, kind });
    return true;
  }

  endDriftSilently(k) { k.driftState = 0; k.driftCharge = 0; k.driftTier = 0; k.driftDir = 0; }

  stepHazards(dt) {
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i];
      h.age += dt;
      if (h.age > h.life) { this.hazards.splice(i, 1); continue; }
      let consumed = false;
      for (const k of this.karts) {
        if (h.age < h.arm && k.id === h.owner) continue;
        const dd = Math.hypot(k.x - h.x, k.z - h.z);
        if (dd < h.r + k.P.radius * 0.5) {
          if (h.type === 'mine') {
            this.emit('explosion', { x: h.x, z: h.z });
            for (const o of this.karts) if (Math.hypot(o.x - h.x, o.z - h.z) < 7) this.hitKart(o, 'mine');
            consumed = true; break;
          } else if (this.hitKart(k, 'oil')) { /* oil persists */ }
        }
      }
      if (consumed) this.hazards.splice(i, 1);
    }
  }

  stepProjectiles(dt) {
    const T = this.track;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.age += dt;
      if (p.age > 7) { this.projectiles.splice(i, 1); continue; }
      const tgt = p.target ? this.kartById(p.target) : null;
      if (tgt) p.lane += (tgt.off - p.lane) * damp(3.5, dt);
      p.idxF += (p.speed * dt) / T.step;
      const pt = T.pointAt(p.idxF, p.lane);
      p.x = pt.x; p.z = pt.z; p.h = pt.h;
      let hit = false;
      for (const k of this.karts) {
        if (k.id === p.owner && p.age < 0.6) continue;
        if (Math.hypot(k.x - p.x, k.z - p.z) < 2.6) {
          this.emit('projectile-hit', { id: k.id, x: p.x, z: p.z });
          this.hitKart(k, 'seeker');
          hit = true; break;
        }
      }
      if (hit) this.projectiles.splice(i, 1);
    }
  }

  stepPickups(dt) {
    for (const b of this.boxes) {
      b.cd = Math.max(0, b.cd - dt);
      if (b.cd > 0) continue;
      for (const k of this.karts) {
        if (k.item || k.rollT > 0 || k.finished) continue;
        if (Math.hypot(k.x - b.x, k.z - b.z) < 3.3) {
          b.cd = 5.5; k.rollT = 1.1;
          this.emit('box', { id: k.id, x: b.x, z: b.z });
          break;
        }
      }
    }
    for (const p of this.pads) p.cd = Math.max(0, p.cd - dt);
  }

  // ---------------------------------------------------------------- kart vs kart
  collideKarts() {
    const ks = this.karts;
    for (let i = 0; i < ks.length; i++) {
      for (let j = i + 1; j < ks.length; j++) {
        const a = ks[i], b = ks[j];
        const dx = b.x - a.x, dz = b.z - a.z;
        const min = a.P.radius + b.P.radius;
        const d2 = dx * dx + dz * dz;
        if (d2 >= min * min || d2 < 1e-6) continue;
        const d = Math.sqrt(d2), nx = dx / d, nz = dz / d;
        const over = min - d;
        const ma = a.P.weight, mb = b.P.weight, tot = ma + mb;
        a.x -= nx * over * (mb / tot); a.z -= nz * over * (mb / tot);
        b.x += nx * over * (ma / tot); b.z += nz * over * (ma / tot);
        const rv = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
        if (rv < 0) {
          const imp = (-(1 + 0.45) * rv) / (1 / ma + 1 / mb);
          a.vx -= (nx * imp) / ma; a.vz -= (nz * imp) / ma;
          b.vx += (nx * imp) / mb; b.vz += (nz * imp) / mb;
          if (-rv > 3 && a.bumpT <= 0 && b.bumpT <= 0) { a.bumpT = b.bumpT = 0.3; this.emit('bump', { a: a.id, b: b.id, power: -rv, x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }); }
        }
      }
    }
  }

  // ---------------------------------------------------------------- ranking & results
  updateRanks() {
    const key = (k) => (k.finished ? 1e7 - k.finishTime : k.prog);
    const sorted = [...this.karts].sort((a, b) => key(b) - key(a));
    sorted.forEach((k, i) => (k.rank = i + 1));
    this.order = sorted;
    // rubber banding for AI relative to the player
    if (this.player && this.rubber > 0) {
      for (const k of this.karts) {
        if (k.isPlayer) continue;
        const gap = k.prog - this.player.prog; // + means AI ahead
        k.rubberMul = gap > 0 ? 1 - this.rubber * clamp(gap / 420, 0, 0.055) : 1 + this.rubber * clamp(-gap / 330, 0, 0.065);
      }
    }
  }

  results() {
    const T = this.track;
    const out = this.order.map((k, i) => {
      let t = k.finishTime;
      let est = false;
      if (t === null) {
        const remain = Math.max(0, this.laps * T.length - k.prog);
        const avg = Math.max(22, k.prog > 100 ? (k.prog / Math.max(1, this.time)) : 30);
        t = this.time + remain / avg; est = true;
      }
      return {
        id: k.id, name: k.name, vehicle: k.vehicle, color: k.color, isPlayer: k.isPlayer, skill: k.skill,
        place: i + 1, time: t, estimated: est,
        bestLap: k.lapTimes.length ? Math.min(...k.lapTimes) : null, lapTimes: k.lapTimes.slice(),
        stats: k.stats,
      };
    });
    // ensure ordering by time among estimated for stability
    return out;
  }
}

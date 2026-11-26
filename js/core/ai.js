// AI driver. `skill` in 0..1 scales cornering confidence, top speed, drift use,
// mistake rate and item smarts. The same module is used for the calibration ladder.
import { clamp, wrapPi, damp } from './util.js';

export function makeAI(skill, rnd) {
  return {
    skill, rnd,
    lane: (rnd() - 0.5) * 0.9,
    aiOff: 0,
    mistakeT: 0, mistakeDir: 1,
    driftHold: false, driftK: 0,
    itemT: 0.8 + rnd() * 2.2,
    ph: rnd() * 10,
  };
}

export function aiInput(k, race, dt) {
  const T = race.track, ai = k.ai, P = k.P, N = T.N;
  const sk = ai.skill, rnd = ai.rnd;
  const speed = Math.max(k.speed, 0);
  const fx = Math.sin(k.h), fz = Math.cos(k.h);

  // --- look-ahead target
  const L = 7 + speed * 0.48;
  const la = Math.max(3, Math.round(L / T.step));
  const half = Math.max(2, T.W[(k.idx + la) % N] / 2 - 3.4);
  let kc = 0;
  for (let d = 6; d <= 26; d += 4) {
    const v = T.K[(k.idx + d) % N];
    if (Math.abs(v) > Math.abs(kc)) kc = v;
  }
  // K > 0 is a left turn, whose inside is the left (negative right-offset)
  const cornerBias = -clamp(kc * 55, -1, 1);
  let desired = (ai.lane * 0.55 + cornerBias * 0.8 * (0.35 + 0.65 * sk)) * half;

  // --- traffic and hazard avoidance
  for (const o of race.karts) {
    if (o === k) continue;
    const ahead = o.prog - k.prog;
    if (ahead > 0 && ahead < 15) {
      const lat = o.off - k.off;
      if (Math.abs(lat) < 3.6) {
        const dirAway = lat > 0 ? -1 : 1;
        const room = dirAway > 0 ? half - k.off : half + k.off;
        desired = k.off + (room > 4 ? dirAway : -dirAway) * 4.4;
      }
    }
  }
  for (const h of race.hazards) {
    const dx = h.x - k.x, dz = h.z - k.z;
    const fwd = dx * fx + dz * fz;
    if (fwd > 1 && fwd < 24 && sk > 0.2) {
      const lat = dx * -fz + dz * fx;
      if (Math.abs(lat) < h.r + 2.3) desired = k.off - Math.sign(lat || 1) * (h.r + 3.2);
    }
  }
  desired = clamp(desired, -half, half);
  ai.aiOff += (desired - ai.aiOff) * damp(2.4 + 2.4 * sk, dt);

  const tp = T.pointAt(k.lastF + la, ai.aiOff);
  const err = wrapPi(Math.atan2(tp.x - k.x, tp.z - k.z) - k.h);
  let steer = clamp(-err * (1.7 + sk * 0.9), -1, 1);

  // --- mistakes and wobble (low skill)
  if (ai.mistakeT > 0) { ai.mistakeT -= dt; steer = clamp(steer + ai.mistakeDir * 0.42, -1, 1); }
  else if (rnd() < Math.pow(1 - sk, 1.6) * 0.1 * dt) { ai.mistakeT = 0.45 + rnd() * 0.6; ai.mistakeDir = rnd() < 0.5 ? -1 : 1; }
  steer = clamp(steer + Math.sin(race.time * 1.7 + ai.ph) * (1 - sk) * 0.08, -1, 1);

  // --- speed plan: slow for corners ahead using a braking envelope
  const drifting = k.driftState === 2;
  const aLat = P.aLat * (0.72 + 0.3 * sk) * (drifting ? 1.3 : 1);
  const decel = 23 + 7 * sk;
  let tv = P.vmax * (1 + k.boostPow) * k.speedMul * (k.rubberMul ?? 1);
  if (k.auto) tv *= 0.55;
  const maxD = Math.min(240, (speed * speed) / (2 * decel) + 45);
  for (let d = 0; d <= maxD; d += 6) {
    const kk = Math.max(Math.abs(T.K[(k.idx + Math.round(d / T.step)) % N]), 1e-4);
    const vc = Math.sqrt(aLat / kk);
    const va = Math.sqrt(vc * vc + 2 * decel * d);
    if (va < tv) tv = va;
  }
  if (k.zone === 'ice') tv *= 0.82;
  if (ai.mistakeT > 0) tv *= 0.9;

  let throttle = 0, brake = 0;
  if (speed < tv - 0.6) throttle = 1;
  else if (speed < tv + 1.2) throttle = 0.6;
  else brake = clamp((speed - tv - 1.2) / 5, 0, 1);

  // --- drifting
  let drift = false;
  if (sk > 0.36 && !k.auto && k.spinT <= 0) {
    if (ai.driftHold) {
      const kn = T.K[(k.idx + Math.round(8 / T.step)) % N];
      if (Math.sign(kn) === ai.driftK && Math.abs(kn) > 0.0062 && speed > 0.45 * P.vmax) drift = true;
      else ai.driftHold = false;
    } else if (speed > 0.62 * P.vmax && k.driftState === 0) {
      const kAhead = T.K[(k.idx + Math.round(22 / T.step)) % N];
      if (Math.abs(kAhead) > 0.0115 && rnd() < 0.06 * (0.4 + sk)) { ai.driftHold = true; ai.driftK = Math.sign(kAhead); drift = true; }
    }
  }

  // --- items
  let item = false;
  ai.itemT -= dt;
  if (k.item && k.rollT <= 0 && ai.itemT <= 0 && !k.auto) {
    const kAhead = Math.abs(T.K[(k.idx + Math.round(20 / T.step)) % N]);
    let use = false;
    switch (k.item) {
      case 'turbo': case 'triple': use = kAhead < 0.005 || sk < 0.3; break;
      case 'oil': case 'mine': {
        use = race.karts.some((o) => o !== k && o.prog < k.prog && k.prog - o.prog < 30 && Math.abs(o.off - k.off) < 9) || rnd() < 0.01;
        break;
      }
      case 'seeker': use = race.karts.some((o) => o !== k && o.prog > k.prog && o.prog - k.prog < 140); break;
      case 'shield': use = rnd() < 0.02; break;
    }
    if (use) { item = true; ai.itemT = 0.5 + rnd() * 1.2 * (1.3 - sk); } else ai.itemT = 0.35;
  }

  return { steer, throttle, brake, drift, item, reset: false };
}

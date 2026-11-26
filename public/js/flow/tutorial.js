// Guided test drive on the Proving Grounds: teaches accelerate, steer, brake, drift, boost pads and items.
import { getTrack } from '../core/tracks.js';
import { keyHints } from '../input.js';

const STEP_COUNT = 8;

export function runTutorial(app) {
  const track = getTrack('training'), N = track.N;
  const game = app.game;
  let step = -1, stepT = 0, done = false, markers = [], st = {};
  let resolveFn;
  const finishP = new Promise((r) => (resolveFn = r));
  const keys = () => keyHints(app.input.device);
  const player = () => game.race.player;
  const idxAhead = (p, meters) => track.idx(p.idx + Math.round(meters / track.step));
  const dIdx = (a, b) => { let d = a - b; if (d > N / 2) d -= N; if (d < -N / 2) d += N; return d; }; // a relative to b
  const clearMarkers = () => { markers.forEach((m) => game.removeMarker(m)); markers = []; game.setGuide(null); };
  const marker = (idx, lane, kind, extra = {}) => {
    const pt = track.pointAt(idx, lane);
    const m = game.addMarker({ kind, x: pt.x, z: pt.z, h: pt.h, idx, lane, ...extra }); markers.push(m); return m;
  };
  const guideTo = (m) => game.setGuide(m ? { x: m.data.x, z: m.data.z } : null);
  let advancing = false;
  const advance = () => {
    if (done || advancing) return;
    advancing = true;
    app.audio.sfx('step'); app.coach.toast(['Nice!', 'Great!', 'Smooth!', 'Perfect!', 'Clean!', 'Boom!', 'Got it!', 'Test drive complete!'][Math.min(step, 7)] || 'Nice!');
    clearMarkers();
    setTimeout(() => begin(step + 1), 900);
    st.locked = true;
  };

  const steps = [
    { title: 'Hit the gas', body: () => `Hold <kbd>${keys().accel}</kbd> to accelerate. Get up to speed.`, begin() { st = { t: 0 }; },
      tick(p, dt) { if (p.speed > 17) { st.t += dt; app.coach.progress(st.t / 0.7); if (st.t > 0.7) advance(); } else st.t = Math.max(0, st.t - dt); } },
    { title: 'Steer through the gates', body: () => `Steer with <kbd>${keys().steer}</kbd>. Drive through the glowing rings.`, begin() { st = { hits: 0, miss: 0, gates: [] }; placeGates(); },
      tick(p) {
        for (const g of st.gates) {
          if (g.done) continue;
          const d = dIdx(p.idx, g.idx);
          if (Math.abs(d) <= 2 && Math.hypot(p.x - g.m.data.x, p.z - g.m.data.z) < 5.6) { g.done = true; g.m.data.done = true; st.hits++; app.audio.sfx('ui-ok'); app.coach.progress(st.hits / 4); }
          else if (d > 3) { g.done = true; g.missed = true; st.miss++; }
        }
        const next = st.gates.find((g) => !g.done); guideTo(next ? next.m : null);
        if (st.hits >= 4) advance();
        else if (!next) { st.miss = 0; st.gates.forEach((g) => game.removeMarker(g.m)); markers = []; st.hits = Math.min(st.hits, 3); placeGates(); app.coach.hint('Try to line up with the rings — they\'re wide!'); }
      } },
    { title: 'Brake', body: () => `Press <kbd>${keys().brake}</kbd> to slow down. Stop inside the blue zone.`, begin() { st = {}; placeBrake(); },
      tick(p) {
        const z = st.zone; if (!z) return;
        const inside = Math.hypot(p.x - z.data.x, p.z - z.data.z) < 10;
        if (inside && p.speed < 9) advance();
        else if (dIdx(p.idx, z.data.idx) > 8) { game.removeMarker(z); markers = markers.filter((m) => m !== z); placeBrake(); app.coach.hint('Too fast — brake sooner and let off the gas.'); }
      } },
    { title: 'Drift for a boost', body: () => `Near a corner, tap <kbd>${keys().drift}</kbd> while steering in, and keep holding. When sparks appear, let go for a turbo boost.`, begin() { st = {}; placeCorner(); },
      tick(p) { if (st.zone && dIdx(p.idx, st.zone.data.idx) > 40) { game.removeMarker(st.zone); markers = []; placeCorner(); } },
      event(e, p) { if (e.type === 'drift-boost' && e.id === p.id) advance(); if (e.type === 'drift-start' && e.id === p.id) app.coach.hint('Hold it — wait for the sparks, then release.'); } },
    { title: 'Boost pad', body: () => `Drive over the glowing arrows on the road for a free speed boost.`, begin() { st = {}; },
      tick(p) { const pad = nextAhead(track.pads, p); if (pad) { const pt = track.pointAt(pad.idx, pad.lane); game.setGuide({ x: pt.x, z: pt.z }); } },
      event(e, p) { if (e.type === 'pad' && e.id === p.id) advance(); } },
    { title: 'Grab an item box', body: () => `Drive through a rainbow <b>?</b> box to collect an item.`, begin() { st = {}; },
      tick(p) { const row = nextAhead(track.itemRows, p); if (row) { const pt = track.pointAt(row.idx, row.lanes[0]); game.setGuide({ x: pt.x, z: pt.z }); } },
      event(e, p) { if (e.type === 'item-got' && e.id === p.id) advance(); } },
    { title: 'Use your item', body: () => `Press <kbd>${keys().item}</kbd> to use it. Items can boost you, trap rivals, or protect you.`, begin() { st = {}; },
      event(e, p) { if (e.type === 'item-use' && e.id === p.id) advance(); } },
    { title: 'Cross the line', body: () => `Finish the test drive: follow the arrow and cross the start line.`, begin() { st = { laps: player().lapsDone }; const pt = track.pointAt(0, 0); game.setGuide({ x: pt.x, z: pt.z }); },
      tick(p) { const pt = track.pointAt(0, 0); game.setGuide({ x: pt.x, z: pt.z }); if (p.lapsDone > st.laps) complete(); } },
  ];

  function nextAhead(list, p) {
    let best = null, bd = 1e9;
    for (const it of list) { const d = dIdx(it.idx, p.idx); const dd = d < 12 ? d + N : d; if (dd < bd) { bd = dd; best = it; } }
    return best;
  }
  function placeGates() {
    const p = player(), lanes = [-4.5, 5, -5, 4.5, 0];
    st.gates = lanes.map((ln, i) => { const idx = idxAhead(p, 48 + i * 42); const m = marker(idx, ln, 'gate', { r: 4.4 }); return { idx, m, done: false }; });
  }
  function placeBrake() { const p = player(); const idx = idxAhead(p, 170); st.zone = marker(idx, 0, 'zone', { r: 10, color: '#34e0ff', idx }); guideTo(st.zone); }
  function placeCorner() {
    const p = player(); let found = -1;
    for (let d = 40; d < 520; d += 4) { const i = idxAhead(p, d); if (Math.abs(track.K[i]) > 0.0105) { found = i; break; } }
    if (found < 0) found = idxAhead(p, 200);
    const idx = track.idx(found - Math.round(22 / track.step));
    st.zone = marker(idx, 0, 'zone', { r: 9, color: '#ffb02e', idx }); guideTo(st.zone);
  }

  function begin(i) {
    if (done) return;
    step = i; stepT = 0; advancing = false;
    if (i >= steps.length) return complete();
    st = {}; steps[i].begin();
    app.coach.show({ n: i + 1, total: STEP_COUNT, title: steps[i].title, body: steps[i].body(), skip: true });
    app.coach.progress(0);
  }
  function complete() {
    if (done) return; done = true; clearMarkers();
    app.audio.sfx('finish'); app.coach.toast('Test drive complete!', 2400); app.coach.hide();
    setTimeout(() => { app.endRace(); resolveFn('done'); }, 1500);
  }
  app.coach.onSkip = () => { if (done) return; done = true; clearMarkers(); app.coach.hide(); app.endRace(); resolveFn('skipped'); };

  const entry = app.makeEntry(true, 0);
  app.playRace({
    trackId: 'training', laps: 99, entries: [entry], raceMode: 'tutorial', items: true, forceItem: 'turbo', skipCountdown: true, rubber: 0,
    hud: { hidePos: true },
    onReady() { begin(0); },
    onStep(race, dt) {
      if (done || step < 0 || step >= steps.length) return;
      const p = race.player; stepT += dt;
      if (st.locked) { st.locked = false; return; }
      steps[step].tick?.(p, dt);
      if (stepT > 25 && !st.hinted) { st.hinted = true; app.coach.hint('Stuck? Press ' + keys().reset + ' to respawn on the road.'); }
    },
    onEvent(e, race) { if (!done && step >= 0 && step < steps.length) steps[step].event?.(e, race.player); },
  });
  return finishP;
}

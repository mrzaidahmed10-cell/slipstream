// Adaptive skill check: a ladder of AI drivers from slow to fast; where you finish pins your rating.
// A second (and, if the first two disagree, third) race re-centres the ladder around the estimate.
import { ladderSkills, estimateFromPlacement, classFor } from '../core/skill.js';
import { clamp } from '../core/util.js';

const PLAN = [
  { trackId: 'apex', laps: 2, center: 0.55, spread: 0.125 },
  { trackId: 'cove', laps: 2, spread: 0.08 },
  { trackId: 'dune', laps: 2, spread: 0.06 },
];

// Resolves to { rating, cls, races:[{trackId, place, estimate, ladder}] }
export async function runPlacement(app, { onRaceDone, onIntro } = {}) {
  const races = [];
  let center = PLAN[0].center;
  for (let i = 0; i < PLAN.length; i++) {
    const plan = PLAN[i];
    if (i === 2 && Math.abs(races[0].estimate - races[1].estimate) < 0.2) break; // consistent: no third race needed
    if (i > 0) center = races.length === 1 ? races[0].estimate : (races[0].estimate + races[1].estimate) / 2;
    const ladder = ladderSkills(center, plan.spread, 7);
    if (onIntro) { const go = await onIntro({ index: i, total: Math.abs((races[0]?.estimate ?? 0) - (races[1]?.estimate ?? 0)) >= 0.2 && i >= 1 ? 3 : 2, trackId: plan.trackId, center }); if (go === 'skip') return null; }
    const res = await app.playRace({
      trackId: plan.trackId, laps: plan.laps, raceMode: 'placement', items: true, rubber: 0,
      entries: app.buildField(ladder, i), hud: {},
    });
    if (!res) return null;
    const me = res.results.find((r) => r.isPlayer);
    const place = me.place;
    const est = estimateFromPlacement(place, ladder);
    // driving cleanliness nudges the estimate a little
    const dur = Math.max(1, me.time || 1);
    const wallPerLap = me.stats.wallHits / plan.laps, offFrac = me.stats.offroad / dur;
    let adj = 0; if (wallPerLap > 5) adj -= 0.03; if (wallPerLap > 10) adj -= 0.03; if (offFrac > 0.1) adj -= 0.03; if (wallPerLap < 1.5 && offFrac < 0.03 && place <= 3) adj += 0.02;
    const entry = { trackId: plan.trackId, place, ladder, estimate: clamp(est + adj, 0.05, 0.97), raw: est };
    races.push(entry);
    if (onRaceDone) await onRaceDone(entry, i);
  }
  const w = races.length === 1 ? [1] : races.length === 2 ? [0.35, 0.65] : [0.2, 0.35, 0.45];
  const rating = clamp(races.reduce((a, r, i) => a + r.estimate * w[i], 0), 0.05, 0.97);
  return { rating, cls: classFor(rating), races };
}

import { Race } from '../public/js/core/race.js';
import { getTrack, RACE_TRACKS } from '../public/js/core/tracks.js';
import { VEHICLES } from '../public/js/core/vehicles.js';
import { ladderSkills } from '../public/js/core/skill.js';
const ladder = ladderSkills(0.58, 0.12, 8);
console.log('ladder', ladder.map(x=>x.toFixed(2)).join(' '));
for (const t of RACE_TRACKS) {
  const track = getTrack(t.id);
  let agree = 0, runs = 0;
  const places = [];
  for (let seed = 1; seed <= 3; seed++) {
    const entries = ladder.map((sk, i) => ({ id: 'ai' + i, name: 'AI' + i, vehicle: VEHICLES[(i * 5 + seed) % VEHICLES.length].id, color: '#fff', skill: sk, slot: (i * 3 + seed) % 8 }));
    const race = new Race({ track, laps: 2, entries, seed, rubber: 0 });
    let s = 0;
    while (!race.karts.every((k) => k.finished) && s++ < 60 * 400) race.step(1 / 60);
    const order = race.order.map((k) => +k.id.slice(2));
    places.push(order.join(''));
    // Spearman-ish: mean abs displacement from ideal (best skill first)
    const ideal = [7, 6, 5, 4, 3, 2, 1, 0];
    let d = 0; order.forEach((v, i) => (d += Math.abs(v - ideal[i])));
    agree += d / 8; runs++;
  }
  console.log(t.id.padEnd(8), 'mean displacement', (agree / runs).toFixed(2), ' orders:', places.join('  '));
}

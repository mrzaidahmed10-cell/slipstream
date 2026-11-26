// Headless AI-only race simulation: checks every track is drivable and prints lap times.
import { Race } from '../js/core/race.js';
import { getTrack, RACE_TRACKS } from '../js/core/tracks.js';
import { VEHICLES } from '../js/core/vehicles.js';

const only = process.argv[2];
const skills = [0.15, 0.5, 0.85, 1.0];
function run(trackId, laps = 2, field, seed = 7) {
  const track = getTrack(trackId);
  const entries = field.map((sk, i) => ({ id: 'ai' + i, name: 'AI' + i, vehicle: VEHICLES[i % VEHICLES.length].id, color: '#fff', skill: sk }));
  const race = new Race({ track, laps, entries, seed, rubber: 0 });
  const dt = 1 / 60;
  let steps = 0, resets = 0, walls = 0, hits = 0, boosts = 0;
  while (race.state !== 'finished' && steps < 60 * 60 * 6) {
    race.step(dt); steps++;
    for (const e of race.drain()) { if (e.type === 'respawn') resets++; if (e.type === 'wall') walls++; if (e.type === 'hit') hits++; if (e.type === 'drift-boost') boosts++; }
    if (race.karts.every((k) => k.finished)) break;
  }
  return { race, steps, resets, walls, hits, boosts };
}
for (const t of RACE_TRACKS) {
  if (only && t.id !== only) continue;
  const track = getTrack(t.id);
  const row = [];
  for (const sk of skills) {
    const r = run(t.id, 2, [sk, sk, sk, sk]);
    const k = r.race.karts[0];
    const best = k.lapTimes.length ? Math.min(...k.lapTimes) : NaN;
    row.push(`sk${sk}: lap ${best.toFixed(1)}s fin=${r.race.karts.filter((x) => x.finished).length}/4 rs=${r.resets} wall=${r.walls} db=${r.boosts}`);
  }
  console.log(t.id.padEnd(8), (track.length | 0) + 'm', '|', row.join(' | '));
}

// Adaptive difficulty: a 0..1 skill rating decides how fast the AI field drives.
import { clamp } from './util.js';

export const CLASSES = [
  { id: 'rookie', name: 'Rookie', min: 0, color: '#8fa3b8' },
  { id: 'amateur', name: 'Amateur', min: 0.2, color: '#4cc38a' },
  { id: 'pro', name: 'Pro', min: 0.4, color: '#4da3ff' },
  { id: 'elite', name: 'Elite', min: 0.6, color: '#b57aff' },
  { id: 'legend', name: 'Legend', min: 0.8, color: '#ffb02e' },
];

export function classFor(rating) {
  let c = CLASSES[0];
  for (const k of CLASSES) if (rating >= k.min) c = k;
  return c;
}

export const DIFFICULTIES = [
  { id: 'auto', name: 'Adaptive', blurb: 'AI matches your skill rating and keeps adjusting.' },
  { id: 'relaxed', name: 'Relaxed', blurb: 'Friendly opponents. Great for learning a track.', center: 0.22 },
  { id: 'standard', name: 'Standard', blurb: 'A fair fight for an average driver.', center: 0.5 },
  { id: 'hard', name: 'Hard', blurb: 'Clean lines and smart item play.', center: 0.74 },
  { id: 'insane', name: 'Insane', blurb: 'Near-perfect drivers. Mistakes are punished.', center: 0.93 },
];

// Skill centre used for a normal race, given settings and the stored rating.
export function fieldCenter(difficultyId, rating) {
  const d = DIFFICULTIES.find((x) => x.id === difficultyId);
  if (!d || d.id === 'auto') return clamp(rating, 0.06, 0.97);
  return d.center;
}

// Spread of n AI skills around a centre (ascending).
export function fieldSkills(center, n = 7, spread = 0.06) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(clamp(center + (i - (n - 1) / 2) * spread, 0.03, 1));
  return out;
}

// A wide ladder used by the calibration races: your finish tells us where you sit.
export function ladderSkills(center, spread, n = 7) {
  return fieldSkills(center, n, spread);
}

// Given a finishing place (1 = best) against a sorted ladder, estimate skill.
export function estimateFromPlacement(place, ladder) {
  const total = ladder.length + 1;
  const beaten = clamp(total - place, 0, ladder.length);
  if (beaten === 0) return clamp(ladder[0] - 0.12, 0.03, 0.99);
  if (beaten === ladder.length) return clamp(ladder[ladder.length - 1] + 0.07, 0.03, 0.99);
  return (ladder[beaten - 1] + ladder[beaten]) / 2;
}

// Elo-flavoured nudge after each normal race. Early races move faster.
export function updateRating(rating, place, total, racesPlayed = 0) {
  const p = (total - place) / Math.max(1, total - 1); // 1 = won, 0 = last
  const gain = (p - 0.55) * 0.11;
  const k = racesPlayed < 6 ? 1.6 : racesPlayed < 15 ? 1.2 : 1;
  return clamp(rating + gain * k, 0.03, 0.99);
}

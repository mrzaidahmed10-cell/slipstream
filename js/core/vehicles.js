// Vehicle roster: stats feed the physics, `look` feeds the 3D builders.
// Stat scale is 0..1 (shown as bars in the garage).
export const VEHICLES = [
  {
    id: 'comet', type: 'kart', name: 'Comet',
    blurb: 'The all-rounder. Predictable, forgiving, quick off the line.',
    stats: { speed: 0.6, accel: 0.6, handling: 0.6, weight: 0.5 },
    look: { width: 1.7, nose: 1.0, wing: 'tall', tire: 1.0, engine: 'twin', roll: false },
  },
  {
    id: 'bruiser', type: 'kart', name: 'Bruiser',
    blurb: 'Heavy, wide, and fast on the long straights. Slow to wind up.',
    stats: { speed: 0.88, accel: 0.32, handling: 0.4, weight: 0.9 },
    look: { width: 1.95, nose: 0.75, wing: 'wide', tire: 1.22, engine: 'big', roll: true },
  },
  {
    id: 'whisper', type: 'kart', name: 'Whisper',
    blurb: 'Featherweight with razor turn-in. Out-accelerates everything.',
    stats: { speed: 0.4, accel: 0.88, handling: 0.9, weight: 0.22 },
    look: { width: 1.5, nose: 1.35, wing: 'slim', tire: 0.9, engine: 'single', roll: false },
  },
  {
    id: 'pip', type: 'car', name: 'Pip',
    blurb: 'A retro city mini. Tiny, tossable, and surprisingly punchy.',
    stats: { speed: 0.42, accel: 0.8, handling: 0.82, weight: 0.3 },
    look: { model: 'pip' },
  },
  {
    id: 'dart', type: 'car', name: 'Rally Dart',
    blurb: 'A turbo hatch built for loose surfaces. Grippy and balanced.',
    stats: { speed: 0.72, accel: 0.66, handling: 0.62, weight: 0.55 },
    look: { model: 'dart' },
  },
  {
    id: 'roadster', type: 'car', name: 'Roadster Zero',
    blurb: 'A low open-top roadster with a long top speed and a wide arc.',
    stats: { speed: 0.82, accel: 0.5, handling: 0.52, weight: 0.45 },
    look: { model: 'roadster' },
  },
];

export const VEHICLE_BY_ID = Object.fromEntries(VEHICLES.map((v) => [v.id, v]));

export const PAINTS = [
  { id: 'crimson', name: 'Crimson', color: '#e0243a', accent: '#ffd23f' },
  { id: 'tangerine', name: 'Tangerine', color: '#ff7a1a', accent: '#1b2a49' },
  { id: 'sun', name: 'Sunburst', color: '#ffc61a', accent: '#d7263d' },
  { id: 'lime', name: 'Volt', color: '#8ee000', accent: '#10151f' },
  { id: 'emerald', name: 'Emerald', color: '#0fa968', accent: '#f4f4f4' },
  { id: 'teal', name: 'Lagoon', color: '#12b5b0', accent: '#ff5d8f' },
  { id: 'azure', name: 'Azure', color: '#1d6fe8', accent: '#f4f4f4' },
  { id: 'indigo', name: 'Indigo', color: '#4b3fd6', accent: '#7dffd8' },
  { id: 'violet', name: 'Violet', color: '#9a3ff0', accent: '#ffe14d' },
  { id: 'rose', name: 'Rose', color: '#ff4f9a', accent: '#ffffff' },
  { id: 'graphite', name: 'Graphite', color: '#3b4252', accent: '#ff5a36' },
  { id: 'pearl', name: 'Pearl', color: '#eef1f6', accent: '#e0243a' },
];
export const PAINT_BY_ID = Object.fromEntries(PAINTS.map((p) => [p.id, p]));

export const STRIPES = [
  { id: 'none', name: 'Clean' },
  { id: 'dual', name: 'Twin Stripe' },
  { id: 'chevron', name: 'Chevron' },
  { id: 'checker', name: 'Checker' },
];

// Derive physics constants from the 0..1 stats.
export function physicsFor(vehicleId) {
  const v = VEHICLE_BY_ID[vehicleId] || VEHICLES[0];
  const s = v.stats;
  return {
    vmax: 34 + s.speed * 6,            // m/s  (36.4 .. 39.3)
    accel: 15 + s.accel * 11,           // m/s^2 at standstill
    maxTurn: 1.75 + s.handling * 0.85,  // rad/s at low speed
    aLat: 21 + s.handling * 6,          // lateral accel budget (m/s^2)
    weight: 0.7 + s.weight * 0.9,
    radius: v.type === 'car' ? 1.55 : 1.45,
  };
}

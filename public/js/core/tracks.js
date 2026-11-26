// Track definitions. `ctrl` is a closed loop of [x, z, (width)] control points.
// By convention point 0 is (0,0) heading +z, so every grid starts on a straight.
import { Track } from './track.js';

export const TRACK_DEFS = [
  {
    id: 'apex', name: 'Apex Stadium', theme: 'stadium', laps: 3, width: 26, wallGap: 4,
    blurb: 'Floodlit grandstands, tire walls and a tight infield chicane.',
    difficulty: 1, itemRows: 7, pads: 5,
    zones: [],
    ctrl: [[0, 0], [0, 100], [0, 200], [10, 285], [55, 345], [130, 372], [210, 350], [255, 290], [262, 215], [235, 150], [185, 110], [170, 60], [200, 10], [250, -40], [275, -110], [260, -190], [215, -250], [145, -280], [75, -270], [35, -225], [15, -160], [0, -90]],
  },
  {
    id: 'dune', name: 'Dune Run', theme: 'desert', laps: 3, width: 28, wallGap: 13,
    blurb: 'Canyon sweepers, a mesa hairpin and soft sand drifts.',
    difficulty: 2, itemRows: 7, pads: 5,
    zones: [{ type: 'sand', u: 0.33, len: 40 }, { type: 'sand', u: 0.78, len: 40 }],
    ctrl: [[0, 0], [0, 100], [-10, 190], [-60, 255], [-140, 285], [-225, 260], [-275, 195], [-265, 120], [-205, 75], [-130, 60], [-80, 20], [-85, -45], [-150, -85], [-220, -80], [-280, -125], [-290, -200], [-240, -260], [-160, -285], [-80, -270], [-30, -215], [-5, -150], [0, -90]],
  },
  {
    id: 'frost', name: 'Frostbite Pass', theme: 'winter', laps: 3, width: 23, wallGap: 10, scale: 0.88,
    blurb: 'A snowbound mountain pass with sheets of black ice.',
    difficulty: 3, itemRows: 8, pads: 5,
    zones: [{ type: 'ice', u: 0.2, len: 50 }, { type: 'ice', u: 0.52, len: 55 }, { type: 'ice', u: 0.83, len: 45 }],
    ctrl: [[0, 0], [0, 100], [30, 175], [95, 215], [170, 205], [215, 150], [205, 80], [245, 25], [320, 15], [375, 60], [385, 135], [345, 200], [270, 235], [250, 305], [295, 365], [285, 440], [215, 480], [135, 455], [110, 390], [55, 350], [-20, 365], [-85, 335], [-105, 265], [-75, 200], [-90, 130], [-85, 50], [-100, -30], [-92, -100], [-52, -138], [-8, -125], [0, -90]],
  },
  {
    id: 'cove', name: 'Coral Cove', theme: 'beach', laps: 3, width: 26, wallGap: 14, mirror: true,
    blurb: 'A sandbar loop around a turquoise lagoon at golden hour.',
    difficulty: 2, itemRows: 7, pads: 5,
    zones: [{ type: 'wet', u: 0.28, len: 45 }, { type: 'wet', u: 0.7, len: 45 }],
    ctrl: [[0, 0], [0, 110], [-20, 200], [-75, 260], [-150, 275], [-220, 245], [-255, 180], [-245, 105], [-195, 55], [-130, 45], [-95, 0], [-90, -70], [-115, -130], [-170, -165], [-230, -170], [-285, -210], [-295, -280], [-250, -340], [-170, -360], [-100, -330], [-45, -275], [-10, -190], [0, -90]],
  },
  {
    id: 'redwood', name: 'Redwood Run', theme: 'forest', laps: 3, width: 24, wallGap: 11, scale: 0.78,
    blurb: 'Giant redwoods, a mossy ravine and long flowing esses.',
    difficulty: 3, itemRows: 8, pads: 5,
    zones: [{ type: 'wet', u: 0.45, len: 50 }],
    ctrl: [[0, 0], [0, 110], [25, 200], [90, 250], [170, 240], [215, 185], [200, 115], [150, 70], [155, 10], [210, -30], [270, -20], [320, 40], [335, 120], [300, 190], [330, 260], [395, 300], [400, 370], [340, 415], [260, 400], [215, 345], [150, 330], [85, 360], [20, 350], [-35, 300], [-45, 225], [-100, 175], [-165, 180], [-215, 130], [-205, 55], [-150, 10], [-135, -60], [-118, -130], [-78, -178], [-30, -170], [-6, -130], [0, -90]],
  },
  {
    id: 'neon', name: 'Neon Harbor', theme: 'city', laps: 3, width: 24, wallGap: 5,
    blurb: 'A rain-slick night street circuit through the harbor district.',
    difficulty: 4, itemRows: 7, pads: 5,
    zones: [{ type: 'wet', u: 0.4, len: 50 }, { type: 'wet', u: 0.9, len: 40 }],
    ctrl: [[0, 0], [0, 100], [0, 200], [0, 270], [40, 320], [110, 335], [200, 330], [265, 300], [290, 240], [275, 170], [225, 130], [160, 125], [110, 90], [105, 30], [150, -15], [230, -30], [300, -60], [330, -125], [310, -195], [250, -240], [170, -255], [100, -235], [60, -190], [40, -140], [0, -90]],
  },
  {
    id: 'training', name: 'Proving Grounds', theme: 'stadium', laps: 99, width: 30, wallGap: 4, hidden: true, training: true,
    blurb: 'Closed course for the test drive.',
    difficulty: 0, itemRows: 2, pads: 2, zones: [],
    ctrl: [[0, 0], [0, 110], [10, 200], [60, 255], [135, 260], [185, 215], [185, 150], [140, 105], [150, 45], [200, 5], [235, -55], [215, -125], [155, -165], [85, -160], [35, -135], [0, -90]],
  },
];

export const CUPS = [
  { id: 'sun', name: 'Sun Cup', tracks: ['apex', 'dune', 'cove'] },
  { id: 'moon', name: 'Moon Cup', tracks: ['frost', 'redwood', 'neon'] },
];

const cache = new Map();

export function getTrack(id) {
  if (cache.has(id)) return cache.get(id);
  const def = TRACK_DEFS.find((t) => t.id === id);
  if (!def) throw new Error('Unknown track ' + id);
  const d = { ...def };
  const sc = def.scale ?? 1, mx = def.mirror ? -1 : 1;
  d.ctrl = def.ctrl.map((p) => [p[0] * sc * mx, p[1] * sc, p[2]]);
  const t = new Track(d);
  t.def = def;
  layoutPickups(t);
  cache.set(id, t);
  return t;
}

export const RACE_TRACKS = TRACK_DEFS.filter((t) => !t.hidden);

// Pick straight-ish stretches for item rows and boost pads; assign hazard zones.
function layoutPickups(t) {
  const def = t.def, N = t.N;
  const straightness = (i) => {
    let m = 0;
    for (let d = -6; d <= 6; d++) m = Math.max(m, Math.abs(t.K[(i + d + N) % N]));
    return m;
  };
  const bestNear = (u, span = 0.035) => {
    const c = Math.round(u * N);
    const r = Math.round(span * N);
    let best = c, bs = 1e9;
    for (let d = -r; d <= r; d++) {
      const i = (c + d + N) % N;
      const s = straightness(i) + Math.abs(d) * 1e-5;
      if (s < bs) { bs = s; best = i; }
    }
    return best;
  };
  t.itemRows = [];
  for (let k = 0; k < (def.itemRows || 0); k++) {
    const u = 0.06 + (k / def.itemRows) * 0.92;
    t.itemRows.push({ idx: bestNear(u), lanes: k % 2 ? [-8, 0, 8] : [-4, 4] });
  }
  t.pads = [];
  for (let k = 0; k < (def.pads || 0); k++) {
    const u = 0.06 + ((k + 0.5) / def.pads) * 0.92;
    const idx = bestNear(u + 0.01, 0.03);
    t.pads.push({ idx, lane: [0, -6, 6, 0, -5][k % 5], len: 9 });
  }
  t.zones = (def.zones || []).map((z) => ({ type: z.type, i0: Math.round(z.u * N), i1: Math.round(z.u * N + z.len / t.step) }));
}

export function zoneAt(track, idx) {
  for (const z of track.zones) if (idx >= z.i0 && idx <= z.i1) return z.type;
  return null;
}

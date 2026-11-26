# Slipstream

A fast, drift-heavy kart racer for the browser. Three.js, no build step.

- 3 karts + 3 small cars, 12 paints, 4 liveries (all procedural 3D)
- 6 tracks: Apex Stadium, Dune Run (desert), Frostbite Pass (winter), Coral Cove (beach), Redwood Run (forest), Neon Harbor (city)
- Drift mini-turbos, rocket starts, boost pads, 6 items, ice/sand/wet surfaces
- First run: guided test drive, then an adaptive skill check that sets AI difficulty (Rookie → Legend); rating keeps adapting
- Quick Race, Grand Prix (Sun / Moon cups), Time Trial, Garage, online leaderboards
- Keyboard, gamepad and touch controls
- Accounts + progress sync via Cloudflare Pages Functions + KV

## Deploy (Cloudflare Pages)

1. Create a Pages project from this repo. Build command: *(none)*. Build output directory: `public`.
2. Create a KV namespace and bind it to the project (Settings → Bindings → KV namespace) with variable name `SLIPSTREAM_KV` (production and preview).
3. `functions/` must stay at the repo root: it serves `/api/*`.

## Local dev

```
node tools/serve.mjs 8123   # serves public/ and runs the real /api handler with a file-backed mock KV
node tools/test-api.mjs     # API tests
```

Real-time multiplayer later will need Workers + Durable Objects.

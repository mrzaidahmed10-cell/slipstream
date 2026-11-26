// Game: owns the renderer and scenes (race / demo / garage), runs the fixed-timestep simulation,
// the chase camera, kart visuals and effects, and emits a per-frame snapshot for the HUD.
import * as THREE from 'three';
import { buildWorld } from './render/world.js';
import { createVehicle, animateVehicle } from './render/vehicles.js';
import { Effects } from './render/fx.js';
import { glowTex, canvasTex } from './render/gfx.js';
import { Race, COUNTDOWN, ITEM_INFO } from './core/race.js';
import { getTrack } from './core/tracks.js';
import { PAINT_BY_ID, VEHICLES } from './core/vehicles.js';
import { clamp, damp, lerp, wrapPi, smoothstep } from './core/util.js';

const DT = 1 / 60;
const PI = Math.PI;
const SURFACE_FX = {
  stadium: { dust: '#9a948a' }, desert: { dust: '#e2bd7e' }, winter: { dust: '#f2f7ff' },
  beach: { dust: '#f0d79a' }, forest: { dust: '#7a6040' }, city: { dust: '#8a90a8' },
};

export class Game {
  constructor(canvas, { input, audio, settings }) {
    this.canvas = canvas; this.input = input; this.audio = audio; this.settings = settings;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: settings.quality !== 'low', powerPreference: 'high-performance', preserveDrawingBuffer: false });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.camera = new THREE.PerspectiveCamera(64, 1, 0.3, 3200);
    this.mode = 'idle';
    this.scene = null; this.world = null; this.race = null; this.cfg = null;
    this.visuals = new Map(); this.hazardMeshes = new Map(); this.projMeshes = new Map(); this.markers = [];
    this.acc = 0; this.last = 0; this.paused = false; this.running = false;
    this.cam = { yaw: 0, pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 64, shake: 0, init: false, orbit: 0 };
    this.garage = null; this.snapT = 0; this.raf = 0; this.timeScale = 1; this.finishTimer = 0; this.resultsSent = false;
    this.tmpV = new THREE.Vector3();
    this.applyQuality();
    addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.audio.suspend(); else this.audio.resume(); });
    this.resize();
    this.loop = this.loop.bind(this);
  }

  applyQuality() {
    const q = this.settings.quality;
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(q === 'low' ? 1 : q === 'medium' ? Math.min(dpr, 1.5) : Math.min(dpr, 2));
    this.renderer.shadowMap.enabled = q !== 'low';
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.resize();
  }
  resize() {
    const w = this.canvas.clientWidth || innerWidth, h = this.canvas.clientHeight || innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    if (this.fx) this.fx.setScale(h * this.renderer.getPixelRatio(), this.camera.fov);
  }

  // ------------------------------------------------------------ scene management
  clearScene() {
    this.stopLoopSounds();
    if (this.world) { this.world.dispose(); this.world = null; }
    if (this.garage) { this.garage.dispose(); this.garage = null; }
    for (const v of this.visuals.values()) v.dispose?.();
    this.visuals.clear(); this.hazardMeshes.clear(); this.projMeshes.clear(); this.markers = [];
    if (this.scene) this.scene.traverse((o) => { if (o.geometry && !o.userData.shared) o.geometry.dispose?.(); });
    this.scene = null; this.fx = null; this.race = null; this.cfg = null; this.guide = null;
    this.renderer.renderLists.dispose();
  }
  stopLoopSounds() { this.audio.stopEngine(); }

  async buildScene(trackId) {
    const track = getTrack(trackId);
    this.scene = new THREE.Scene();
    this.world = buildWorld(track, { quality: this.settings.quality, renderer: this.renderer });
    this.scene.add(this.world.group, this.world.sky.mesh);
    this.scene.fog = this.world.fog; this.scene.background = new THREE.Color(this.world.bg);
    this.scene.environment = this.world.env;
    this.renderer.toneMappingExposure = this.world.exposure;
    this.fx = new Effects(this.scene);
    this.fx.setScale(this.canvas.height, this.camera.fov);
    this.track = track;
    return track;
  }

  makeKartVisual(k) {
    const paint = PAINT_BY_ID[k.color] || { color: k.color, accent: '#ffffff' };
    const v = createVehicle(k.vehicle, { color: paint.color, accent: paint.accent, stripe: k.stripe, number: k.number });
    this.scene.add(v.root);
    // blob shadow for low quality
    const vis = { v, px: k.x, pz: k.z, ph: k.h, hop: 0, spin: 0, tilt: 0, pitch: 0, last: { x: k.x, z: k.z, h: k.h } };
    this.visuals.set(k.id, vis);
    return vis;
  }

  // ------------------------------------------------------------ race
  async startRace(cfg) {
    this.clearScene();
    this.mode = 'race'; this.cfg = cfg; this.resultsSent = false; this.finishTimer = 0; this.paused = false;
    const track = await this.buildScene(cfg.trackId);
    const race = new Race({
      track, laps: cfg.laps, entries: cfg.entries, seed: cfg.seed ?? (Math.random() * 1e6) | 0, rubber: cfg.rubber ?? 0.5,
      items: cfg.items !== false, layout: cfg.layout, forceItem: cfg.forceItem, mode: cfg.raceMode || 'race',
    });
    if (cfg.skipCountdown) { race.time = 0; race.state = 'racing'; race.lastCount = 0; }
    this.race = race;
    this.world.setBoxes(race.boxes);
    for (const k of race.karts) { this.makeKartVisual(k); k.px = k.x; k.pz = k.z; k.ph = k.h; }
    this.cam.init = false; this.acc = 0;
    this.audio.startEngine();
    this.audio.startMusic(track.theme);
    this.world.gate.setLights(cfg.skipCountdown ? 0 : 4);
    this.run();
    return race;
  }

  async startDemo(trackId) {
    this.clearScene();
    this.mode = 'demo'; this.cfg = { trackId };
    const track = await this.buildScene(trackId);
    const ids = VEHICLES.map((v) => v.id), paints = Object.keys(PAINT_BY_ID);
    const entries = [];
    for (let i = 0; i < 8; i++) entries.push({ id: 'd' + i, name: 'AI', vehicle: ids[i % ids.length], color: paints[(i * 3 + 1) % paints.length], stripe: ['none', 'dual', 'chevron', 'checker'][i % 4], skill: 0.55 + (i % 5) * 0.08, number: i + 1 });
    const race = new Race({ track, laps: 99, entries, seed: 99, rubber: 0, items: true });
    race.time = 0; race.state = 'racing'; race.lastCount = 0;
    this.race = race; this.world.setBoxes(race.boxes);
    for (const k of race.karts) { this.makeKartVisual(k); k.px = k.x; k.pz = k.z; k.ph = k.h; }
    this.demo = { target: 0, camKind: 0, t: 0 };
    this.cam.init = false; this.acc = 0;
    this.world.gate.setLights(0);
    this.run();
  }

  setMarkers(list) {
    for (const m of this.markers) { this.scene.remove(m.obj); }
    this.markers = [];
    for (const d of list) this.addMarker(d);
  }
  addMarker(d) {
    const g = new THREE.Group();
    const col = new THREE.Color(d.color || '#34e0ff');
    if (d.kind === 'gate') {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(d.r || 4.2, 0.28, 10, 36), new THREE.MeshBasicMaterial({ color: col }));
      ring.position.y = (d.r || 4.2) * 0.9; g.add(ring);
      const fill = new THREE.Mesh(new THREE.CircleGeometry(d.r || 4.2, 36), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
      fill.position.y = (d.r || 4.2) * 0.9; g.add(fill);
    } else {
      const ring = new THREE.Mesh(new THREE.RingGeometry((d.r || 9) - 0.6, d.r || 9, 48).rotateX(-PI / 2), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
      ring.position.y = 0.08; g.add(ring);
      const disc = new THREE.Mesh(new THREE.CircleGeometry((d.r || 9) - 0.6, 48).rotateX(-PI / 2), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending }));
      disc.position.y = 0.07; g.add(disc);
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(d.r || 9, d.r || 9, 22, 32, 1, true), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
      beam.position.y = 11; g.add(beam);
    }
    g.position.set(d.x, 0, d.z); g.rotation.y = d.h || 0;
    this.scene.add(g);
    const m = { obj: g, data: d };
    this.markers.push(m);
    return m;
  }
  removeMarker(m) { this.scene.remove(m.obj); this.markers = this.markers.filter((x) => x !== m); }
  setGuide(target) { // target: {x,z} or null -> floating arrow over the player
    if (!this.scene) return;
    if (!this.guide) {
      const g = new THREE.Group();
      const m = new THREE.MeshBasicMaterial({ color: 0x34e0ff, transparent: true, opacity: 0.95, depthTest: false });
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.7, 1.6, 4).rotateX(PI / 2), m); cone.position.z = 0.9;
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 1.2), m); tail.position.z = -0.3;
      g.add(cone, tail); g.renderOrder = 20; g.traverse((o) => (o.renderOrder = 20));
      this.scene.add(g); this.guide = g;
    }
    this.guideTarget = target; this.guide.visible = !!target;
  }

  pause(v = true) { this.paused = v; if (v) { this.audio.stopEngine(); } else if (this.mode === 'race') { this.audio.startEngine(); } }

  // ------------------------------------------------------------ garage
  async showGarage(sel) {
    this.clearScene();
    this.mode = 'garage';
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b1020);
    this.scene = scene;
    const pm = new THREE.PMREMGenerator(this.renderer);
    const env = new THREE.Scene();
    env.add(new THREE.Mesh(new THREE.BoxGeometry(60, 30, 60), new THREE.MeshBasicMaterial({ color: 0x10162a, side: THREE.BackSide })));
    for (const [x, y, z, w, h, c] of [[-14, 12, 8, 14, 6, 0xffffff], [16, 8, -6, 10, 10, 0x9ad8ff], [0, 18, -12, 22, 3, 0xffd9a0], [0, 9, 20, 18, 4, 0xff8ad0]]) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(2.2), side: THREE.DoubleSide }));
      p.position.set(x, y, z); p.lookAt(0, 0, 0); env.add(p);
    }
    scene.environment = pm.fromScene(env, 0.03).texture; pm.dispose();
    // platform
    const plat = new THREE.Group();
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 5.5, 0.4, 64), new THREE.MeshStandardMaterial({ color: 0x1a2038, roughness: 0.35, metalness: 0.7 }));
    disc.position.y = -0.2; disc.receiveShadow = true;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(5.0, 0.07, 8, 96).rotateX(PI / 2), new THREE.MeshBasicMaterial({ color: 0x34e0ff }));
    ring.position.y = 0.02;
    const floor = new THREE.Mesh(new THREE.CircleGeometry(60, 48).rotateX(-PI / 2), new THREE.MeshStandardMaterial({ color: 0x0a0e1c, roughness: 0.6, metalness: 0.3 }));
    floor.position.y = -0.45;
    plat.add(disc, ring, floor); scene.add(plat);
    const key = new THREE.DirectionalLight(0xfff0dd, 2.4); key.position.set(-6, 10, 7); key.castShadow = true; key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 1, far: 30 });
    const rim = new THREE.DirectionalLight(0x6ab8ff, 1.6); rim.position.set(7, 4, -8);
    scene.add(key, rim, new THREE.HemisphereLight(0x8aa8ff, 0x1a1a2a, 0.5));
    this.garage = { scene, yaw: 0.6, dragYaw: 0, vehicle: null, auto: true, sel: null, ring, dispose: () => {} };
    this.garageSet(sel);
    this.fx = null; this.race = null; this.cam.init = false;
    this.audio.stopEngine();
    this.run();
  }
  garageSet(sel) {
    const g = this.garage; if (!g) return;
    const key = [sel.vehicle, sel.color, sel.stripe, sel.number || 1].join('|');
    if (g.sel === key) return;
    g.sel = key;
    if (g.vehicle) this.scene.remove(g.vehicle.root);
    const paint = PAINT_BY_ID[sel.color] || PAINT_BY_ID.crimson;
    g.vehicle = createVehicle(sel.vehicle, { color: paint.color, accent: paint.accent, stripe: sel.stripe, number: sel.number || 1 });
    g.vehicle.root.position.y = 0.0;
    this.scene.add(g.vehicle.root);
    g.pop = 1;
  }

  // ------------------------------------------------------------ loop
  run() { if (this.running) return; this.running = true; this.last = performance.now(); this.raf = requestAnimationFrame(this.loop); }
  halt() { this.running = false; cancelAnimationFrame(this.raf); }

  loop(now) {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.loop);
    let dt = Math.min(0.1, (now - this.last) / 1000); this.last = now;
    if (!this.scene) return;
    const t = now / 1000;
    if (this.mode === 'garage') { this.updateGarage(dt, t); this.renderer.render(this.scene, this.camera); return; }
    if (this.paused) { this.renderFrame(0, t, 1); return; }
    this.acc += dt * this.timeScale;
    let steps = 0;
    const race = this.race;
    while (this.acc >= DT && steps < 6) {
      for (const k of race.karts) { k.px = k.x; k.pz = k.z; k.ph = k.h; }
      if (race.player && this.mode === 'race') Object.assign(race.input, this.input.poll(DT));
      race.step(DT);
      this.cfg.onStep?.(race, DT);
      this.handleEvents(race.drain());
      this.acc -= DT; steps++;
    }
    if (steps === 6) this.acc = 0;
    const alpha = clamp(this.acc / DT, 0, 1);
    this.renderFrame(dt, t, alpha);
    this.updateFinish(dt);
    this.snapT -= dt;
    if (this.snapT <= 0 && this.cfg.onFrame) { this.snapT = 1 / 30; this.cfg.onFrame(this.snapshot()); }
  }

  updateGarage(dt, t) {
    const g = this.garage; if (!g || !g.vehicle) return;
    if (g.auto) g.yaw += dt * 0.35;
    g.pop = Math.max(0, (g.pop || 0) - dt * 3);
    const s = 1 + g.pop * 0.06 * Math.sin(g.pop * 9);
    g.vehicle.root.rotation.y = g.yaw; g.vehicle.root.scale.setScalar(s);
    g.vehicle.root.position.y = 0.04 + Math.sin(t * 1.5) * 0.01;
    animateVehicle(g.vehicle, { speed: 2, steer: Math.sin(t * 0.8) * 0.4, dt, boost: 0 });
    const sz = Math.max(g.vehicle.size.length, 3.4);
    this.camera.fov = 38; this.camera.updateProjectionMatrix();
    this.camera.position.set(Math.sin(0.55) * sz * 2.1, sz * 0.62, Math.cos(0.55) * sz * 2.1 + 0.5);
    this.camera.lookAt(0, 0.85, 0);
    g.ring.material.color.setHSL((t * 0.05) % 1, 0.8, 0.6);
  }

  // ------------------------------------------------------------ rendering
  renderFrame(dt, t, alpha) {
    const race = this.race;
    const cam = this.camera;
    // kart visuals
    for (const k of race.karts) {
      let vis = this.visuals.get(k.id);
      if (!vis) vis = this.makeKartVisual(k);
      this.updateKartVisual(k, vis, dt, t, alpha);
    }
    this.updateHazards(race, t);
    this.updateMarkers(t);
    this.updateCamera(dt, t, alpha);
    this.world.update(dt, t, cam, this.focusPos());
    this.fx.update(dt);
    // gate countdown lights
    if (this.mode === 'race' && race.state === 'countdown') { const n = Math.ceil(-race.time); this.world.gate.setLights(clamp(4 - n, 0, 3)); }
    else if (this.mode === 'race' && race.time < 1.6 && race.time >= 0) this.world.gate.setLights(4);
    else if (this.mode === 'race' && race.time >= 1.6) this.world.gate.setLights(0);
    // engine audio
    const p = race.player;
    if (p && this.mode === 'race') {
      const sr = clamp(Math.abs(p.speed) / p.P.vmax, 0, 1.4);
      this.audio.updateEngine(sr, p.prev.rawThr > 0 ? 1 : 0, p.boostT > 0, p.driftState === 2, p.surface === 'off');
    }
    this.renderer.render(this.scene, cam);
  }

  focusPos() {
    const race = this.race; const k = this.focusKart();
    const v = this.visuals.get(k.id);
    return v ? v.v.root.position : this.tmpV.set(k.x, 0, k.z);
  }
  focusKart() { const race = this.race; return race.player || race.order?.[this.demo?.target ?? 0] || race.karts[0]; }

  updateKartVisual(k, vis, dt, t, alpha) {
    const v = vis.v, root = v.root;
    const x = lerp(k.px, k.x, alpha), z = lerp(k.pz, k.z, alpha), h = k.ph + wrapPi(k.h - k.ph) * alpha;
    const speedRatio = clamp(Math.abs(k.speed) / k.P.vmax, 0, 1.3);
    const drifting = k.driftState === 2;
    // body attitude
    const slideYaw = drifting ? -k.driftDir * (0.38 + 0.12 * Math.abs(k.steer)) : clamp(-k.slip * 0.02, -0.15, 0.15);
    vis.slide = lerp(vis.slide ?? 0, slideYaw, damp(12, dt || 0.016));
    vis.tilt = lerp(vis.tilt, -k.steer * 0.06 * speedRatio - (drifting ? -k.driftDir * 0.06 : 0), damp(10, dt || 0.016));
    const accel = k.prev.rawThr > 0 && speedRatio < 0.9 ? 1 : 0;
    vis.pitch = lerp(vis.pitch, (k.boostT > 0 ? -0.05 : 0) + accel * -0.015 - (k.speed < 1 ? 0 : 0), damp(6, dt || 0.016));
    let hop = 0;
    if (k.driftState === 1 && k.hopT > 0) hop = Math.sin((1 - k.hopT / 0.16) * PI) * 0.5;
    if (k.spinT > 0) { hop = Math.sin(Math.min(1, (1.0 - k.spinT) * 2.2) * PI) * 1.1 * clamp(k.spinT, 0, 1); }
    const bump = Math.sin(t * 38 + k.slot) * 0.012 * speedRatio * (k.surface === 'off' ? 3 : 1);
    root.position.set(x, hop + bump, z);
    root.rotation.set(0, h, 0);
    v.body.rotation.set(vis.pitch, vis.slide + (k.spinT > 0 ? k.spinAng : 0), vis.tilt);
    root.visible = k.invulnT > 0 && k.shieldT <= 0 && k.spinT <= 0 ? Math.floor(t * 14) % 2 === 0 : true;
    animateVehicle(v, { speed: k.speed, steer: k.steer, dt: dt || 0.016, boost: k.boostT > 0 ? clamp(k.boostT * 1.4, 0, 1) : 0, lookBack: k.isPlayer && this.input.state.look });
    v.shield.visible = k.shieldT > 0;
    if (v.shield.visible) { v.shield.scale.setScalar(1 + Math.sin(t * 8) * 0.03); v.shield.material.opacity = k.shieldT < 2 && Math.floor(t * 8) % 2 ? 0.08 : 0.24; }
    // item overhead marker (AI only: small spinning icon for readability)
    if (dt > 0) this.emitKartFx(k, vis, dt, t, x, z, h, speedRatio);
  }

  emitKartFx(k, vis, dt, t, x, z, h, speedRatio) {
    const fx = this.fx, cam = this.camera.position;
    const near = (x - cam.x) ** 2 + (z - cam.z) ** 2 < 70 * 70;
    const fxs = Math.sin(h), fzs = Math.cos(h);
    const rx = -fzs, rz = fxs; // right vector
    const theme = this.track.theme, dustCol = SURFACE_FX[theme].dust;
    const rearX = x - fxs * 1.1, rearZ = z - fzs * 1.1;
    const drifting = k.driftState === 2;
    const skidding = drifting || (Math.abs(k.slip) > 3.2 && speedRatio > 0.35) || (k.spinT > 0);
    if (near || k.isPlayer) {
      for (const s of [-1, 1]) {
        const wx = rearX + rx * s * 0.85, wz = rearZ + rz * s * 0.85;
        const key = k.id + s;
        if (skidding && k.surface !== 'off') fx.skid.segment(key, wx, wz, fxs, fzs, 0.42, 0.5); else fx.skid.breakLine(key);
        if (skidding && Math.random() < dt * 40 && k.surface !== 'off') fx.tireSmoke(wx, wz, k.vx, k.vz, k.zone === 'ice' ? '#e6f2ff' : '#d8dce6', 0.9);
        if (drifting && k.driftTier > 0 && Math.random() < dt * 60) fx.spark(wx, 0.3, wz, -fxs * 2 + rx * s * 3, -fzs * 2 + rz * s * 3, ['#7dd3ff', '#ffb02e', '#d27dff'][k.driftTier - 1]);
        if (k.surface === 'off' && speedRatio > 0.15 && Math.random() < dt * 55) fx.dust(wx, wz, k.vx, k.vz, dustCol, 1);
        if (k.zone === 'sand' && speedRatio > 0.2 && Math.random() < dt * 50) fx.dust(wx, wz, k.vx, k.vz, '#e8c585', 1.2);
        if (k.zone === 'wet' && speedRatio > 0.25 && Math.random() < dt * 40) fx.tireSmoke(wx, wz, k.vx * 0.4, k.vz * 0.4, '#9fc4ff', 0.7);
        if (k.zone === 'ice' && speedRatio > 0.25 && Math.random() < dt * 30) fx.spark(wx, 0.2, wz, rx * s * 1.5, rz * s * 1.5, '#cfeaff');
      }
    }
    if (k.boostT > 0 && (near || k.isPlayer)) {
      const ex = x - fxs * 1.7, ez = z - fzs * 1.7;
      for (const s of [-1, 1]) if (Math.random() < dt * 70) fx.boostFlame(ex + rx * s * 0.28, 0.72, ez + rz * s * 0.28, fxs, fzs, k.speed);
    }
    if (k.spinT > 0 && Math.random() < dt * 30) fx.tireSmoke(x, z, 0, 0, '#cfd3dc', 1.2);
  }

  updateHazards(race, t) {
    const seen = new Set();
    for (const h of race.hazards) {
      seen.add(h.id);
      let m = this.hazardMeshes.get(h.id);
      if (!m) {
        m = new THREE.Group();
        if (h.type === 'oil') {
          const mesh = new THREE.Mesh(new THREE.CircleGeometry(h.r, 28).rotateX(-PI / 2), new THREE.MeshStandardMaterial({ color: 0x1a0f2e, roughness: 0.03, metalness: 0.85, emissive: 0x3a1a6a, emissiveIntensity: 0.35, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }));
          mesh.position.y = 0.05; m.add(mesh);
          const sheen = new THREE.Mesh(new THREE.RingGeometry(h.r * 0.35, h.r * 0.8, 28).rotateX(-PI / 2), new THREE.MeshBasicMaterial({ color: 0x9a6aff, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false })); sheen.position.y = 0.06; m.add(sheen); m.userData.sheen = sheen;
        } else {
          const body = new THREE.Mesh(new THREE.SphereGeometry(0.75, 16, 12), new THREE.MeshStandardMaterial({ color: 0x2a2d38, roughness: 0.4, metalness: 0.8 })); body.position.y = 0.85; m.add(body);
          for (let i = 0; i < 12; i++) { const a = (i / 12) * PI * 2; const s = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.5, 6), new THREE.MeshStandardMaterial({ color: 0x9aa3b4, metalness: 0.9, roughness: 0.3 })); s.position.set(Math.cos(a) * 0.78, 0.85, Math.sin(a) * 0.78); s.rotation.z = -Math.cos(a) * PI / 2; s.rotation.x = Math.sin(a) * PI / 2; m.add(s); }
          const led = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff2a2a })); led.position.y = 1.5; m.add(led); m.userData.led = led;
          const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex('#ff4040', 64), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })); halo.scale.setScalar(3.2); halo.position.y = 1.5; m.add(halo); m.userData.halo = halo;
        }
        m.position.set(h.x, 0, h.z); this.scene.add(m); this.hazardMeshes.set(h.id, m);
      }
      if (m.userData.led) { const on = h.age < h.arm ? Math.floor(t * 14) % 2 : Math.floor(t * 3) % 2; m.userData.led.material.color.setHex(on ? 0xff2a2a : 0x551010); m.userData.halo.visible = !!on; }
      if (m.userData.sheen) m.userData.sheen.rotation.y = t * 0.6;
    }
    for (const [id, m] of this.hazardMeshes) if (!seen.has(id)) { this.scene.remove(m); this.hazardMeshes.delete(id); }
    // projectiles
    const pseen = new Set();
    for (const p of race.projectiles) {
      pseen.add(p.id);
      let m = this.projMeshes.get(p.id);
      if (!m) {
        m = new THREE.Group();
        const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 0.9, 6, 12).rotateX(PI / 2), new THREE.MeshStandardMaterial({ color: 0x2ee6c8, emissive: 0x16a090, emissiveIntensity: 1.2, roughness: 0.3, metalness: 0.4 })); body.position.y = 0.9;
        const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex('#2ee6c8', 64), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })); halo.scale.setScalar(4); halo.position.y = 0.9;
        m.add(body, halo); this.scene.add(m); this.projMeshes.set(p.id, m);
      }
      m.position.set(p.x, 0, p.z); m.rotation.y = p.h;
      if (Math.random() < 0.7) this.fx.add.emit([p.x, 0.9, p.z], [Math.random() - 0.5, 0.5, Math.random() - 0.5], 0.4, 0.9, 0.1, this.fx.rgba('#46ffe0', 0.9), this.fx.rgba('#1a8cff', 0), 0, 1);
    }
    for (const [id, m] of this.projMeshes) if (!pseen.has(id)) { this.scene.remove(m); this.projMeshes.delete(id); }
  }

  updateMarkers(t) {
    for (const m of this.markers) {
      const s = 1 + Math.sin(t * 4 + m.data.x) * 0.04; m.obj.scale.set(s, s, s);
      m.obj.visible = m.data.visible !== false;
      if (m.data.done) m.obj.scale.setScalar(0.001);
    }
    if (this.guide && this.guide.visible && this.race.player) {
      const p = this.race.player, tg = this.guideTarget;
      const v = this.visuals.get(p.id);
      if (v && tg) {
        this.guide.position.set(v.v.root.position.x, 4.2 + Math.sin(t * 5) * 0.2, v.v.root.position.z);
        this.guide.rotation.y = Math.atan2(tg.x - p.x, tg.z - p.z);
      }
    }
  }

  updateCamera(dt, t, alpha) {
    const cam = this.camera, c = this.cam, race = this.race;
    const k = this.focusKart();
    const vis = this.visuals.get(k.id); if (!vis) return;
    const kp = vis.v.root.position;
    const speedRatio = clamp(Math.abs(k.speed) / k.P.vmax, 0, 1.3);
    const kh = k.ph + wrapPi(k.h - k.ph) * alpha;
    let targetYaw = kh;
    if (k.speed > 6) { const vh = Math.atan2(k.vx, k.vz); targetYaw = kh + wrapPi(vh - kh) * 0.35; }
    if (k.driftState === 2) targetYaw -= k.driftDir * 0.22;
    let dist = 8.6 + speedRatio * 1.8, height = 3.7 - speedRatio * 0.4, lookAhead = 7, fov = 62 + speedRatio * 9 + (k.boostT > 0 ? 8 : 0);
    const look = this.input.state.look && this.mode === 'race' && race.player;
    if (!c.init) { c.yaw = kh; c.pos.set(kp.x - Math.sin(kh) * dist, height, kp.z - Math.cos(kh) * dist); c.fov = fov; c.init = true; }
    let yaw = c.yaw + wrapPi(targetYaw - c.yaw) * damp(look ? 14 : 5.5, dt || 0.016);
    c.yaw = yaw;
    let yawView = yaw;
    let extra = 0;
    if (this.mode === 'demo') return this.demoCamera(dt, t, k, kp, kh);
    if (this.mode === 'race' && race.state === 'countdown') {
      const u = clamp(-race.time / COUNTDOWN, 0, 1);
      const e = smoothstep(0, 1, u);
      extra = e * 2.6; dist *= 1 - 0.42 * e; height = lerp(height, 1.9, e);
    }
    if (race.player && race.player.finished) { c.orbit += dt * 0.5; extra = Math.sin(c.orbit) * 1.1 + 0.6; dist = 11; height = 3.4; fov = 56; }
    if (look) { yawView += PI; }
    const d = look ? 7 : dist;
    const tx = kp.x - Math.sin(yawView + extra) * d, tz = kp.z - Math.cos(yawView + extra) * d;
    const ty = height + kp.y * 0.5;
    const rate = c.skip ? 99 : 10;
    c.pos.x += (tx - c.pos.x) * damp(rate, dt || 0.016); c.pos.z += (tz - c.pos.z) * damp(rate, dt || 0.016); c.pos.y += (ty - c.pos.y) * damp(7, dt || 0.016);
    c.fov += (fov - c.fov) * damp(4, dt || 0.016);
    // shake
    c.shake = Math.max(0, c.shake - dt * 2.8);
    const sh = c.shake * (0.35 + (k.boostT > 0 ? 0.1 : 0)) * (this.settings.shake ?? 1);
    cam.position.set(c.pos.x + (Math.random() - 0.5) * sh, c.pos.y + (Math.random() - 0.5) * sh * 0.6, c.pos.z + (Math.random() - 0.5) * sh);
    // keep the camera above the ground
    cam.position.y = Math.max(cam.position.y, 1.2);
    const lx = kp.x + Math.sin(yawView) * lookAhead * (look ? -1 : 1) * 0.0 + Math.sin(yawView + (look ? 0 : 0)) * (look ? -lookAhead : lookAhead);
    const lz = kp.z + Math.cos(yawView) * (look ? -lookAhead : lookAhead);
    c.look.set(kp.x + (lx - kp.x) * 1, 1.5 + kp.y * 0.5, kp.z + (lz - kp.z) * 1);
    cam.lookAt(c.look);
    if (Math.abs(cam.fov - c.fov) > 0.01) { cam.fov = c.fov; cam.updateProjectionMatrix(); this.fx.setScale(this.canvas.height, cam.fov); }
  }

  demoCamera(dt, t, k, kp, kh) {
    const cam = this.camera, c = this.cam, d = this.demo;
    d.t += dt;
    if (d.t > 9) { d.t = 0; d.camKind = (d.camKind + 1) % 3; d.target = (d.target + 1) % this.race.karts.length; c.init = false; }
    const fx = Math.sin(kh), fz = Math.cos(kh);
    let pos, look;
    if (d.camKind === 0) { pos = [kp.x - fx * 12, 4.5, kp.z - fz * 12]; look = [kp.x + fx * 6, 1.3, kp.z + fz * 6]; }
    else if (d.camKind === 1) { const rx = -fz, rz = fx; pos = [kp.x + fx * 16 + rx * 9, 2.2, kp.z + fz * 16 + rz * 9]; look = [kp.x, 1.2, kp.z]; }
    else { const a = d.t * 0.5; pos = [kp.x + Math.cos(a) * 20, 8 + Math.sin(d.t * 0.3) * 2, kp.z + Math.sin(a) * 20]; look = [kp.x, 1.2, kp.z]; }
    if (!c.init) { c.pos.set(...pos); c.look.set(...look); c.init = true; }
    c.pos.x += (pos[0] - c.pos.x) * damp(3, dt || 0.016); c.pos.y += (pos[1] - c.pos.y) * damp(3, dt || 0.016); c.pos.z += (pos[2] - c.pos.z) * damp(3, dt || 0.016);
    c.look.x += (look[0] - c.look.x) * damp(5, dt || 0.016); c.look.y += (look[1] - c.look.y) * damp(5, dt || 0.016); c.look.z += (look[2] - c.look.z) * damp(5, dt || 0.016);
    cam.position.copy(c.pos); cam.lookAt(c.look);
    const fov = 52; if (cam.fov !== fov) { cam.fov = fov; cam.updateProjectionMatrix(); this.fx.setScale(this.canvas.height, fov); }
  }

  // ------------------------------------------------------------ events
  handleEvents(events) {
    const race = this.race, a = this.audio, player = race.player, pid = player?.id;
    for (const e of events) {
      const mine = e.id === pid;
      const k = e.id ? race.kartById(e.id) : null;
      switch (e.type) {
        case 'count': a.sfx('count'); break;
        case 'go': a.sfx('go'); break;
        case 'rocket': if (mine) a.sfx('rocket'); break;
        case 'boost': if (mine) { a.sfx('boost'); this.cam.shake = Math.max(this.cam.shake, 0.5); } break;
        case 'pad': if (mine) { a.sfx('boost'); this.cam.shake = Math.max(this.cam.shake, 0.6); } break;
        case 'hop': if (mine) a.sfx('hop'); break;
        case 'drift-tier': if (mine) a.sfx('tier', { tier: e.tier }); break;
        case 'drift-boost': if (mine) this.cam.shake = Math.max(this.cam.shake, 0.4); break;
        case 'box': if (k) { this.fx.burst(e.x, 1.5, e.z, '#ffe08a', 16); if (mine) a.sfx('box'); } break;
        case 'item-got': if (mine) a.sfx('item-got'); break;
        case 'item-use': if (mine) a.sfx('item-use'); break;
        case 'hit': if (k) { if (mine) { a.sfx('hit'); this.cam.shake = 1.4; } this.fx.burst(k.x, 0.8, k.z, e.kind === 'oil' ? '#b58aff' : '#ffb02e', 22); } break;
        case 'wall': if (mine) { a.sfx('wall', { power: e.power }); this.cam.shake = Math.max(this.cam.shake, clamp(e.power / 12, 0.3, 1.1)); } if (k) for (let i = 0; i < 8; i++) this.fx.spark(k.x, 0.6, k.z, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, '#ffd27a'); break;
        case 'bump': { const near = player && Math.hypot(player.x - e.x, player.z - e.z) < 30; if (near) a.sfx('bump'); for (let i = 0; i < 6; i++) this.fx.spark(e.x, 0.7, e.z, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, '#fff0b0'); break; }
        case 'explosion': this.fx.explosion(e.x, e.z); a.sfx('explosion'); if (player && Math.hypot(player.x - e.x, player.z - e.z) < 25) this.cam.shake = 1.5; break;
        case 'projectile-hit': this.fx.burst(e.x, 1, e.z, '#46ffe0', 24); break;
        case 'shield': if (mine) a.sfx('shield'); break;
        case 'shield-pop': if (mine) a.sfx('pop'); if (k) this.fx.burst(k.x, 1, k.z, '#6ab8ff', 24); break;
        case 'lap': if (mine) a.sfx('lap'); break;
        case 'finish': if (mine) a.sfx('finish'); break;
        case 'respawn': if (mine) a.sfx('respawn'); break;
      }
      this.cfg.onEvent?.(e, race);
    }
  }

  // ------------------------------------------------------------ finish & results
  updateFinish(dt) {
    const race = this.race;
    if (this.mode !== 'race' || !race.player || this.resultsSent) return;
    const finished = race.player.finished || (race.cfgMaxTime && race.time > race.cfgMaxTime);
    if (finished) {
      this.finishTimer += dt;
      if (this.finishTimer > 3.6) {
        this.resultsSent = true;
        // fast-forward the rest of the field so everyone gets a real finish time
        let guard = 0;
        while (!race.karts.every((k) => k.finished) && guard++ < 60 * 90) race.step(DT);
        race.drain();
        this.cfg.onFinish?.(race.results(), race);
      }
    }
  }

  // ------------------------------------------------------------ HUD snapshot
  snapshot() {
    const race = this.race, p = race.player || race.karts[0];
    const T = race.track;
    const lap = clamp(p.lapsDone + 1, 1, race.laps);
    const info = p.item ? ITEM_INFO[p.item] : null;
    return {
      time: race.time, state: race.state, mode: this.mode,
      lap, laps: race.laps, rank: p.rank, total: race.karts.length, speed: Math.abs(p.speed), speedRatio: clamp(Math.abs(p.speed) / p.P.vmax, 0, 1.4),
      item: p.item, itemCount: p.itemCount, itemInfo: info, rolling: p.rollT > 0,
      driftTier: p.driftState === 2 ? p.driftCharge : 0, drifting: p.driftState === 2, tier: p.driftTier, boosting: p.boostT > 0, boostPow: p.boostPow,
      wrong: p.wrongT > 1.2, surface: p.surface, zone: p.zone, shield: p.shieldT, finished: p.finished,
      lapStart: p.lapStart, lapTimes: p.lapTimes, countdown: race.state === 'countdown' ? Math.ceil(-race.time) : 0,
      karts: race.karts.map((k) => ({ id: k.id, x: k.x, z: k.z, color: k.color, isPlayer: k.isPlayer, rank: k.rank, name: k.name, prog: k.prog, finished: k.finished })),
      order: race.order.map((k) => ({ id: k.id, name: k.name, isPlayer: k.isPlayer, color: k.color, rank: k.rank, lap: Math.max(1, Math.min(race.laps, k.lapsDone + 1)), finished: k.finished })),
      player: p,
    };
  }
}

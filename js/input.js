// Unified input: keyboard, gamepad, on-screen touch controls. Produces { steer, throttle, brake, drift, item, reset, look }.
import { clamp, damp } from './core/util.js';

export class Input {
  constructor() {
    this.keys = new Set();
    this.touch = { left: false, right: false, brake: false, drift: false, item: false, gas: false };
    this.wheelAngle = 0; this.wheelMax = 1.9; this.wheelHeld = false; this.gasV = 0; this.brakeV = 0; this.onscreen = false; this.scheme = 'buttons';
    this.state = { steer: 0, throttle: 0, brake: 0, drift: false, item: false, reset: false, look: false };
    this.device = 'keyboard';
    this.listeners = {};
    this.kbSteer = 0; this.btnSteer = 0; this.autoGas = false;
    this.padPrev = {};
    this.enabled = true;
    this.touchAutoGas = true;
    const norm = (e) => e.code;
    addEventListener('keydown', (e) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code) && !(e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName))) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(norm(e)); this.device = 'keyboard';
      this.emit('key', e.code);
      if (e.code === 'Escape' || e.code === 'KeyP') this.emit('pause');
      if (e.code === 'KeyR') { this.resetFlag = true; this.emit('reset'); }
    });
    addEventListener('keyup', (e) => this.keys.delete(norm(e)));
    addEventListener('blur', () => this.keys.clear());
    this.bindTouch();
  }
  on(ev, fn) { (this.listeners[ev] ||= []).push(fn); return () => (this.listeners[ev] = this.listeners[ev].filter((f) => f !== fn)); }
  emit(ev, ...a) { (this.listeners[ev] || []).forEach((f) => f(...a)); }

  // On-screen controls (pointer events, so they work with touch and mouse): buttons, pedals and a steering wheel.
  bindTouch() {
    const map = { 'tc-left': 'left', 'tc-right': 'right', 'tc-brake': 'brake', 'tc-drift': 'drift', 'tc-item': 'item', 'tc-gas': 'gas' };
    const set = (k, v, pt) => { this.touch[k] = v; if (pt === 'touch' && v) this.device = 'touch'; if (v && k === 'item') this.emit('touch-item'); };
    document.addEventListener('pointerdown', (e) => {
      const el = e.target.closest && e.target.closest('[data-tc]'); if (!el) return;
      e.preventDefault(); try { el.setPointerCapture(e.pointerId); } catch {}
      el.classList.add('down'); set(map[el.id], true, e.pointerType);
      const up = () => { el.classList.remove('down'); set(map[el.id], false); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); el.removeEventListener('lostpointercapture', up); };
      el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('lostpointercapture', up);
    }, { passive: false });
    // steering wheel: drag around the hub; springs back to centre on release
    const wheel = document.getElementById('tc-wheel'); this.wheelEl = wheel;
    if (wheel) {
      let id = null, last = 0;
      const ang = (e) => { const r = wheel.getBoundingClientRect(); return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)); };
      wheel.addEventListener('pointerdown', (e) => { e.preventDefault(); id = e.pointerId; wheel.setPointerCapture(id); last = ang(e); this.wheelHeld = true; if (e.pointerType === 'touch') this.device = 'touch'; }, { passive: false });
      wheel.addEventListener('pointermove', (e) => {
        if (e.pointerId !== id) return;
        const a = ang(e); let d = a - last; if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; last = a;
        this.wheelAngle = clamp(this.wheelAngle + d, -this.wheelMax * 1.15, this.wheelMax * 1.15);
      });
      const end = (e) => { if (e.pointerId === id) { id = null; this.wheelHeld = false; } };
      wheel.addEventListener('pointerup', end); wheel.addEventListener('pointercancel', end); wheel.addEventListener('lostpointercapture', end);
    }
  }

  pad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  poll(dt) {
    const k = this.keys, s = this.state;
    let steerT = (k.has('ArrowRight') || k.has('KeyD') ? 1 : 0) - (k.has('ArrowLeft') || k.has('KeyA') ? 1 : 0);
    let thr = k.has('ArrowUp') || k.has('KeyW') ? 1 : 0;
    let brk = k.has('ArrowDown') || k.has('KeyS') ? 1 : 0;
    let drift = k.has('Space');
    let item = k.has('KeyE') || k.has('ShiftLeft') || k.has('ShiftRight') || k.has('KeyF') || k.has('Enter') && false;
    let look = k.has('KeyC') || k.has('KeyB');
    // keyboard steering ramps for finer control
    const rate = steerT === 0 ? 14 : 7.5;
    this.kbSteer += (steerT - this.kbSteer) * damp(rate, dt);
    let steer = Math.abs(this.kbSteer) < 0.01 ? 0 : this.kbSteer;
    if (k.has('ArrowUp') || k.has('ArrowDown') || k.has('ArrowLeft') || k.has('ArrowRight') || k.has('KeyW') || k.has('KeyA') || k.has('KeyS') || k.has('KeyD')) this.device = 'keyboard';

    // gamepad
    const p = this.pad();
    if (p) {
      const ax = p.axes[0] || 0, dz = 0.12;
      const gs = Math.abs(ax) < dz ? 0 : Math.sign(ax) * (Math.abs(ax) - dz) / (1 - dz);
      const rt = p.buttons[7] ? p.buttons[7].value : 0, lt = p.buttons[6] ? p.buttons[6].value : 0;
      const a = p.buttons[0]?.pressed, b = p.buttons[1]?.pressed, x = p.buttons[2]?.pressed, y = p.buttons[3]?.pressed;
      const lb = p.buttons[4]?.pressed, rb = p.buttons[5]?.pressed;
      const dl = p.buttons[14]?.pressed, dr = p.buttons[15]?.pressed;
      const any = Math.abs(gs) > 0.2 || rt > 0.2 || lt > 0.2 || a || b || x || y || lb || rb;
      if (any) this.device = 'gamepad';
      if (this.device === 'gamepad') {
        steer = clamp(gs + (dr ? 1 : 0) - (dl ? 1 : 0), -1, 1);
        thr = Math.max(rt, a ? 1 : 0); brk = Math.max(lt, b ? 1 : 0);
        drift = !!(rb || x || lb && false); item = !!(y || lb); look = !!p.buttons[10]?.pressed;
        const start = !!p.buttons[9]?.pressed;
        if (start && !this.padPrev.start) this.emit('pause');
        this.padPrev.start = start;
      }
    }

    // on-screen controls (touch, or mouse when shown on desktop). Combined with keyboard/pad: the stronger input wins.
    if (this.onscreen) {
      const t = this.touch;
      this.gasV += ((t.gas ? 1 : 0) - this.gasV) * damp(t.gas ? 8 : 16, dt);
      this.brakeV += ((t.brake ? 1 : 0) - this.brakeV) * damp(t.brake ? 9 : 16, dt);
      let ts;
      if (this.scheme === 'wheel') {
        if (!this.wheelHeld) this.wheelAngle *= Math.exp(-9 * dt);
        if (Math.abs(this.wheelAngle) < 0.004) this.wheelAngle = 0;
        ts = clamp(this.wheelAngle / this.wheelMax, -1, 1);
        // progressive response around centre for fine control
        ts = Math.sign(ts) * Math.pow(Math.abs(ts), 1.25);
        if (this.wheelEl) this.wheelEl.style.transform = `rotate(${(this.wheelAngle * 180 / Math.PI).toFixed(1)}deg)`;
      } else {
        const tgt = (t.right ? 1 : 0) - (t.left ? 1 : 0);
        this.btnSteer += (tgt - this.btnSteer) * damp(tgt ? 6.5 : 13, dt); ts = Math.abs(this.btnSteer) < 0.01 ? 0 : this.btnSteer;
      }
      if (Math.abs(ts) > Math.abs(steer)) steer = ts;
      thr = Math.max(thr, this.gasV);
      if (this.autoGas && this.device === 'touch' && !t.brake) thr = Math.max(thr, 1);
      brk = Math.max(brk, this.brakeV);
      drift = drift || t.drift; item = item || t.item;
      const g = document.getElementById('tc-gas'), b = document.getElementById('tc-brake');
      if (g) g.style.setProperty('--p', this.gasV.toFixed(2)); if (b) b.style.setProperty('--p', this.brakeV.toFixed(2));
    }

    s.steer = clamp(steer, -1, 1); s.throttle = thr; s.brake = brk; s.drift = !!drift; s.item = !!item; s.look = !!look;
    s.reset = !!this.resetFlag; this.resetFlag = false;
    return s;
  }

  configure({ scheme, onscreen, autoGas }) { this.scheme = scheme === 'wheel' ? 'wheel' : 'buttons'; this.autoGas = !!autoGas; this.onscreenMode = onscreen; this.refreshOnscreen(); }
  refreshOnscreen() { const m = this.onscreenMode || 'auto'; this.onscreen = m === 'on' || (m === 'auto' && this.device === 'touch'); }

  anyPress() { return this.keys.size > 0; }
}

export function keyHints(device) {
  if (device === 'touch') return { accel: 'the GAS pedal', steer: 'the wheel / arrow pads', brake: 'the BRAKE pedal', drift: 'DRIFT', item: 'ITEM', reset: 'Menu → Respawn' };
  if (device === 'gamepad') return { accel: 'RT / A', steer: 'Left stick', brake: 'LT / B', drift: 'RB / X', item: 'Y / LB', reset: 'Menu → Respawn' };
  return { accel: 'W / ↑', steer: 'A D / ← →', brake: 'S / ↓', drift: 'Space', item: 'E / Shift', reset: 'R' };
}

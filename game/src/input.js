// Keyboard + mouse input for SKYPOST.
// W/S or ArrowUp/Down: throttle. A/D or ArrowLeft/Right: roll. Mouse position (or drag):
// fine pitch/roll attitude — mouse up climbs, mouse right banks right.
// Edge actions: Enter/click = start, P/Esc = pause, R = retry, T = title, M = mute.
// Space = brake, Shift = boost.

import { VIEW } from './config.js';
import { clamp } from './math3.js';

const PREVENT = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);

export class Input {
  constructor() {
    this.keys = new Set();
    this.pressed = new Set();
    this.mouse = { x: VIEW.W / 2, y: VIEW.H * 0.45, down: false, inside: true };
    this._handlers = null;
  }

  attach(canvas) {
    const onKeyDown = (e) => {
      if (PREVENT.has(e.code)) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.keys.add(e.code);
    };
    const onKeyUp = (e) => this.keys.delete(e.code);
    const onBlur = () => { this.keys.clear(); this.pressed.clear(); };
    const onMouseMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      this.mouse.x = clamp(((e.clientX - rect.left) / rect.width) * VIEW.W, 0, VIEW.W);
      this.mouse.y = clamp(((e.clientY - rect.top) / rect.height) * VIEW.H, 0, VIEW.H);
      this.mouse.inside = true;
    };
    const onMouseDown = (e) => {
      if (e.button === 0) { this.mouse.down = true; this.pressed.add('Mouse'); }
      const rect = canvas.getBoundingClientRect();
      this.mouse.x = clamp(((e.clientX - rect.left) / rect.width) * VIEW.W, 0, VIEW.W);
      this.mouse.y = clamp(((e.clientY - rect.top) / rect.height) * VIEW.H, 0, VIEW.H);
    };
    const onMouseUp = (e) => { if (e.button === 0) this.mouse.down = false; };
    const onMouseLeave = () => { this.mouse.inside = false; this.mouse.down = false; };
    const onContext = (e) => e.preventDefault();
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('mouseleave', onMouseLeave);
    canvas.addEventListener('contextmenu', onContext);
    this._handlers = { onKeyDown, onKeyUp, onBlur, onMouseMove, onMouseDown, onMouseUp, onMouseLeave, onContext };
  }

  detach() {
    if (!this._handlers) return;
    const h = this._handlers;
    window.removeEventListener('keydown', h.onKeyDown);
    window.removeEventListener('keyup', h.onKeyUp);
    window.removeEventListener('blur', h.onBlur);
    window.removeEventListener('mouseup', h.onMouseUp);
    this._handlers = null;
  }

  endFrame() { this.pressed.clear(); }

  wasPressed(code) { return this.pressed.has(code); }

  // Edge-triggered menu actions, checked once per frame by main.js.
  action(name) {
    switch (name) {
      case 'start': return this.pressed.has('Enter') || this.pressed.has('NumpadEnter') || this.pressed.has('Mouse');
      case 'pause': return this.pressed.has('KeyP') || this.pressed.has('Escape');
      case 'retry': return this.pressed.has('KeyR');
      case 'title': return this.pressed.has('KeyT');
      case 'mute': return this.pressed.has('KeyM');
      default: return false;
    }
  }
}

// Continuous flight controls for one frame. Mutates plane.throttle from held keys and
// returns the attitude/boost/brake command the flight model consumes.
export function readFlightControls(input, plane, dt) {
  let throttleRate = 0;
  if (input.keys.has('KeyW') || input.keys.has('ArrowUp')) throttleRate += 0.55;
  if (input.keys.has('KeyS') || input.keys.has('ArrowDown')) throttleRate -= 0.55;
  plane.throttle = clamp(plane.throttle + throttleRate * dt, 0, 1);

  const rollKey =
    (input.keys.has('KeyD') || input.keys.has('ArrowRight') ? 1 : 0) -
    (input.keys.has('KeyA') || input.keys.has('ArrowLeft') ? 1 : 0);
  const mx = clamp((input.mouse.x - VIEW.W / 2) / (VIEW.W / 2), -1, 1);
  const my = clamp((input.mouse.y - VIEW.H * 0.45) / (VIEW.H * 0.5), -1, 1);
  return {
    roll: clamp(rollKey + mx * 0.9, -1, 1),
    pitch: clamp(-my * 0.85, -1, 1),
    boost: input.keys.has('ShiftLeft') || input.keys.has('ShiftRight'),
    brake: input.keys.has('Space'),
  };
}

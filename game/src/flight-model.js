// Arcade flight model of the SKYPOST mail plane.
// stepPlane() advances one time slice; main.js substeps so the integrator stays stable.
// The world (terrain height, wind, rings, runway) arrives through ctx, so this module
// is pure logic: Node can unit-test it without a DOM.
//
// Feel: throttle sets a target speed, pitch trades speed for altitude, bank turns the
// heading (coordinated turn), and control authority scales with airspeed. Below the stall
// speed the nose drops on its own. Wind drifts the ground track off the nose.

import { PLANE, SEA_LEVEL } from './config.js';
import { clamp, lerp, wrapAngle } from './math3.js';
import { evaluateTouchdown, nextRing } from './missions.js';

export function createPlane(overrides = {}) {
  return {
    x: 0, y: 320, z: 220,          // world position (m), z runs along the course
    yaw: 0, pitch: 0.02, roll: 0,  // attitude (rad); yaw 0 faces +z down the course
    speed: 60,                     // airspeed (m/s)
    throttle: 0.6,
    fuel: PLANE.fuelMax,
    damage: 0,
    vy: 0,                         // vertical speed of the ground track (m/s)
    stall: false, engineOut: false,
    landed: false, rollout: false, dead: false,
    time: 0,
    _prevZ: 220, _prevX: 0, _prevY: 320, _stressWarned: false, _stopped: false,
    ...overrides,
  };
}

export function stepPlane(p, ctrl, ctx, dt) {
  dt = Math.min(dt, 0.05);
  if (p.dead || dt <= 0) return;
  const ev = ctx.events;
  p.time += dt;
  p._prevZ = p.z;
  p._prevX = p.x;
  p._prevY = p.y;

  // On the runway the aerodynamics are done: brakes and steering only.
  if (p.rollout) { stepRollout(p, ctrl, ctx, dt); return; }

  // Power: target speed from throttle, brake and boost; pitch exchanges speed/height.
  let vTarget;
  if (p.engineOut) vTarget = 46; // best glide with the engine out
  else if (ctrl.brake) vTarget = PLANE.vMin * 0.9;
  else vTarget = PLANE.vMin + p.throttle * (PLANE.vMax - PLANE.vMin) + (ctrl.boost ? PLANE.vBoost - PLANE.vMax : 0);
  // A dead engine can only drag, never push: with the tank empty the relaxation
  // toward best-glide speed is clamped to <= 0, otherwise a fixed positive pitch
  // converges to a constant-speed climb (phantom thrust below 46 m/s) and gains
  // specific energy forever in still air — see test/energy-glide.test.mjs.
  let relax = (vTarget - p.speed) * 0.55 * dt;
  if (p.engineOut && relax > 0) relax = 0;
  const dv = relax - Math.sin(p.pitch) * 9.8 * dt * 0.62;
  p.speed = clamp(p.speed + dv, 0, PLANE.vBoost + 8);

  // Fuel burn; an empty tank means a glide home.
  if (!p.engineOut && p.fuel > 0) {
    const burn = PLANE.burnBase + PLANE.burnThrottle * p.throttle + (ctrl.boost ? PLANE.burnBoost : 0);
    p.fuel = clamp(p.fuel - burn * dt, 0, PLANE.fuelMax);
    if (p.fuel <= 0) { p.engineOut = true; ev.push({ type: 'fuelout' }); }
  }

  // Attitude: authority grows with airspeed, so low speed answers sluggishly.
  const auth = clamp(p.speed / 55, 0.25, 1.25);
  const rollT = ctrl.roll * PLANE.maxRoll;
  p.roll += (rollT - p.roll) * Math.min(1, 2.6 * auth * dt);
  const pitchT = p.stall ? -0.6 : ctrl.pitch * PLANE.maxPitch;
  p.pitch += (pitchT - p.pitch) * Math.min(1, 2.2 * auth * dt);

  // Stall: nose drops until the dive restores speed.
  const wasStall = p.stall;
  p.stall = p.speed < PLANE.vStall;
  if (p.stall && !wasStall) ev.push({ type: 'stall' });
  if (!p.stall && wasStall) ev.push({ type: 'stallEnd' });
  if (p.stall) p.pitch = Math.max(p.pitch - 1.4 * dt, -0.6);

  // Heading from bank (coordinated turn).
  const yawRate = Math.tan(p.roll) * 9.8 / Math.max(p.speed, 24) * 1.05;
  p.yaw = wrapAngle(p.yaw + yawRate * dt);

  // Velocity: air path plus wind drift.
  const cp = Math.cos(p.pitch);
  const dir = [Math.sin(p.yaw) * cp, Math.sin(p.pitch), Math.cos(p.yaw) * cp];
  const w = ctx.windAt(p.x, p.y, p.z, p.time);
  const vx = dir[0] * p.speed + w[0];
  // Engine-out glide: with the engine dead the plane always sinks at airspeed / glide
  // ratio, so an empty tank cannot hold altitude — recovery is a refuel ring only.
  const vy = dir[1] * p.speed + w[1] - (p.engineOut ? p.speed / PLANE.glide : 0);
  const vz = dir[2] * p.speed + w[2];
  p.vy = vy;

  const rw = ctx.runway;

  p.x += vx * dt;
  p.y += vy * dt;
  p.z += vz * dt;

  // Structural overstress: hard bank at high speed bends the airframe.
  if (Math.abs(p.roll) > 0.95 && p.speed > 78) {
    p.damage += 9 * dt;
    if (!p._stressWarned) { p._stressWarned = true; ev.push({ type: 'warn', text: '過大G — 減速せよ' }); }
  } else {
    p._stressWarned = false;
  }

  // Wind rings: rings are sequential — only the first unpassed ring is live, so a later
  // ring crossed while the current one is pending never scores, refuels or becomes passed.
  // Crossing the live ring's plane in the +z course direction inside its radius scores; a
  // graze costs damage. The segment-plane crossing is evaluated where the path pierces the
  // ring plane, so a fast plane cannot tunnel through; overshoot and turn back to re-cross.
  const next = nextRing(ctx.rings);
  if (next && p._prevZ < next.z && p.z >= next.z) {
    const span = p.z - p._prevZ;
    const t = span > 1e-9 ? clamp((next.z - p._prevZ) / span, 0, 1) : 1;
    const cx = lerp(p._prevX, p.x, t);
    const cy = lerp(p._prevY, p.y, t);
    const dist = Math.hypot(cx - next.x, cy - next.y);
    if (dist <= next.R) { next.passed = true; ev.push({ type: 'ring', id: next.id, dist, R: next.R }); }
    else if (dist <= next.R * 1.3) { p.damage += 14; ev.push({ type: 'clip', id: next.id }); }
  }

  // Ground contact: runway touchdown, sea, or terrain.
  const th = ctx.terrainHeight(p.x, p.z);
  const ground = th > 0 ? th : SEA_LEVEL;
  const nearRunway = p.z > rw.z0 - 30 && p.z < rw.z1 + 40 && Math.abs(p.x - rw.cx) < rw.halfW + 8;
  if (p.y - PLANE.gearH <= ground) {
    if (th > 0 && nearRunway && Math.abs(p.y - rw.alt) < 8 && Math.abs(wrapAngle(p.yaw - rw.heading)) < 0.6) {
      const res = evaluateTouchdown(p, rw);
      if (res.ok) {
        p.rollout = true;
        p.landed = true;
        p.y = rw.alt + PLANE.gearH;
        p.x = clamp(p.x, rw.cx - rw.halfW, rw.cx + rw.halfW);
        ev.push({ type: 'touchdown' });
      } else if (res.fatal) {
        kill(p, ev, '着陸失敗 — ' + res.reason);
      } else {
        const sink = -p.vy;
        p.damage += sink * 7 + p.speed * 0.12;
        p.y = ground + PLANE.gearH;
        p.speed *= 0.72;
        ev.push({ type: 'bounce', reason: res.reason });
      }
    } else if (th <= 0) {
      kill(p, ev, p.vy < -8 ? '海面に激突した' : '着水事故になった');
    } else {
      const sink = -p.vy;
      if (sink > 11 || p.speed > 88) kill(p, ev, '地形に激突した');
      else {
        p.damage += sink * 6 + p.speed * 0.15;
        p.y = ground + PLANE.gearH;
        p.speed *= 0.6;
        ev.push({ type: 'scrape' });
      }
    }
  }
  if (p.damage >= 100) kill(p, ev, '機体損傷が致命的になった');
}

function kill(p, ev, reason) {
  if (p.dead) return;
  p.dead = true;
  ev.push({ type: 'dead', reason });
}

// Ground roll on the runway: brakes bleed speed, stop inside the strip to end the sortie.
// Terminal outcomes fire exactly once (p._stopped) and with clear priority: leaving the
// strip kills first, then a full stop ends the sortie — a win only when every ring was
// threaded, otherwise an explicit incomplete event.
function stepRollout(p, ctrl, ctx, dt) {
  const ev = ctx.events;
  const rw = ctx.runway;
  if (p._stopped) return;
  p.stall = false;
  p.speed = Math.max(0, p.speed - (10 + p.speed * 0.12) * dt - (ctrl.brake ? 8 * dt : 0));
  p.yaw = wrapAngle(p.yaw + clamp(ctrl.roll, -1, 1) * 0.45 * dt);
  p.x += Math.sin(p.yaw) * p.speed * dt;
  p.z += Math.cos(p.yaw) * p.speed * dt;
  p.y = rw.alt + PLANE.gearH;
  p.pitch += (0 - p.pitch) * Math.min(1, 4 * dt);
  p.roll += (0 - p.roll) * Math.min(1, 4 * dt);
  if (Math.abs(p.x - rw.cx) > rw.halfW + 6) kill(p, ev, '滑走路から逸脱した');
  else if (p.z > rw.z1 + 30) kill(p, ev, '断崖の端から転落した');
  else if (p.speed <= 2.5) {
    p._stopped = true;
    p.speed = 0;
    const passed = ctx.rings.filter((r) => r.passed).length;
    if (passed === ctx.rings.length) ev.push({ type: 'win' });
    else ev.push({ type: 'incomplete', passed, total: ctx.rings.length, reason: 'リング未通過 ' + (ctx.rings.length - passed) + '/' + ctx.rings.length + ' — 配達未完了' });
  }
}

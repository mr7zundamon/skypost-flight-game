// game-logic.test.mjs — Node built-in tests for the SKYPOST game logic.
// Runs against the ES modules in src/ (not bundle.js): no DOM, no browser, no network.
// Everything is driven through the same deterministic world/seeds the game uses.
//
// Covered behaviors (mirrors the manual Node smoke test):
//   1. course layout: 7 rings, refuel rings on ids [2, 4]
//   2. ring scoring + refuel amount through applyEvent
//   3. high-speed ring plane crossing (segment-plane interpolation, no tunneling)
//   4. zero-fuel engine-out without death (unit + full tick integration)
//   5. acceptable / unacceptable touchdown evaluation
//   6. sequential ring progression (out-of-order inert, turn-back re-cross) and the
//      incomplete result when landing with rings outstanding; all-ring landing wins
//   7. unacceptable landing: bounce with damage; fatal approach -> crash -> result
//   8. engine-out -> refuel restarts propulsion; no boost while empty
//   9. final score includes ring points; exactly one terminal event per state transition
//   10. full reset (resetSortie) plus pause round-trip and dt clamp

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PLANE, LAND, RUNWAY, SCORE } from '../src/config.js';
import { createPlane, stepPlane } from '../src/flight-model.js';
import { buildRings, ringScore, evaluateTouchdown, finalScore, rankFor } from '../src/missions.js';
import {
  createGame, resetSortie, applyEvent, togglePause, tick,
  STEP, REFUEL_RINGS, REFUEL_AMOUNT, CRASH_DELAY,
} from '../src/game-state.js';

const NEUTRAL = { roll: 0, pitch: 0, boost: false, brake: false };
const APPROACH = { roll: 0, pitch: -0.1, boost: false, brake: false };
const BRAKE = { roll: 0, pitch: 0, boost: false, brake: true };

// Minimal physics context for stepPlane unit tests: flat sea, no wind, no rings.
function stubCtx(overrides = {}) {
  return {
    events: [],
    rings: [],
    runway: RUNWAY,
    terrainHeight: () => 0,
    windAt: () => [0, 0, 0],
    ...overrides,
  };
}

// Mark a ring as threaded the way stepPlane does on a crossing, then fold in its event.
function passRing(g, id, dist = 0) {
  g.rings[id].passed = true;
  applyEvent(g, { type: 'ring', id, dist, R: g.rings[id].R });
}

test('course layout: seven deterministic rings, refuel on ids [2, 4]', () => {
  const rings = buildRings();
  assert.equal(rings.length, 7);
  assert.deepEqual(rings.map((r) => r.id), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(rings.map((r) => r.z), [900, 1600, 2300, 3000, 3700, 4400, 5100]);
  assert.ok(rings.every((r) => r.R === 15 && r.passed === false));
  assert.deepEqual(buildRings(), rings); // fixed seed: identical course every run

  assert.deepEqual([...REFUEL_RINGS].sort((a, b) => a - b), [2, 4]);

  const g = createGame();
  assert.equal(g.state, 'title');
  assert.deepEqual(g.rings.filter((r) => r.refuel).map((r) => r.id), [2, 4]);
  resetSortie(g);
  assert.deepEqual(g.rings.filter((r) => r.refuel).map((r) => r.id), [2, 4]);
});

test('ring pass scores points; refuel rings restore fuel (clamped at fuelMax)', () => {
  const g = createGame();
  resetSortie(g);
  g.plane.fuel = 10;

  applyEvent(g, { type: 'ring', id: 0, dist: 0, R: 15 });
  assert.equal(g.score, SCORE.ringBase + SCORE.ringAcc); // dead-center: 300
  assert.equal(g.plane.fuel, 10); // ordinary ring does not refuel

  applyEvent(g, { type: 'ring', id: 2, dist: 7.5, R: 15 });
  assert.equal(g.score, 300 + ringScore(7.5, 15).pts); // 300 + 225
  assert.equal(g.plane.fuel, 10 + REFUEL_AMOUNT);
  assert.match(g.msg, /燃料補給/);

  g.plane.fuel = 90;
  applyEvent(g, { type: 'ring', id: 4, dist: 0, R: 15 });
  assert.equal(g.plane.fuel, PLANE.fuelMax); // clamped, not 90 + 35

  // scoring helpers stay consistent with the constants
  assert.equal(ringScore(15, 15).pts, SCORE.ringBase); // rim = base only
  const s = finalScore({ time: SCORE.timePar, fuel: 50, damage: 10 });
  assert.equal(s.total, LAND.base + 0 + 50 * SCORE.fuelBonus - 10 * SCORE.damagePenalty);
  assert.equal(rankFor(1400), 'S');
  assert.equal(rankFor(1150), 'A');
  assert.equal(rankFor(900), 'B');
  assert.equal(rankFor(899), 'C');
});

test('high-speed crossing is scored at the ring plane, not the step endpoint', () => {
  // One max-size step carries the plane from z < ring.z to z > ring.z while a strong
  // crosswind drags it 40 m sideways: the step ENDS 20 m outside the ring (R = 15),
  // but the path pierces the ring plane dead-center.
  const ring = { id: 0, x: 100, y: 200, z: 1000, R: 15, passed: false };
  const ctx = stubCtx({ rings: [ring], windAt: () => [-800, 0, 0] });
  const p = createPlane({
    x: ring.x + 20, y: ring.y, z: ring.z - 2.5,
    yaw: 0, pitch: 0, roll: 0, speed: 100, throttle: 1, fuel: 100,
  });
  stepPlane(p, NEUTRAL, ctx, 0.05);

  const ringEvs = ctx.events.filter((e) => e.type === 'ring');
  assert.equal(ringEvs.length, 1);
  assert.equal(ringEvs[0].id, 0);
  assert.ok(ringEvs[0].dist < 0.1, 'crossing dist ' + ringEvs[0].dist);
  assert.ok(Math.abs(p.x - ring.x) > ring.R, 'step endpoint is outside the ring');
  assert.equal(ring.passed, true); // no tunneling: the segment-plane crossing counts

  // Control: a step that stops short of the ring plane scores nothing.
  const ring2 = { id: 1, x: 0, y: 200, z: 1000, R: 15, passed: false };
  const ctx2 = stubCtx({ rings: [ring2] });
  const p2 = createPlane({
    x: 0, y: 200, z: ring2.z - 10, yaw: 0, pitch: 0, roll: 0, speed: 100, throttle: 1, fuel: 100,
  });
  stepPlane(p2, NEUTRAL, ctx2, 0.05);
  assert.ok(p2.z < ring2.z);
  assert.equal(ctx2.events.length, 0);
  assert.equal(ring2.passed, false);
});

test('boost-speed plane threaded through ring 0 is caught by tick()', () => {
  const g = createGame();
  resetSortie(g);
  const r = g.rings[0];
  Object.assign(g.plane, {
    x: r.x, y: r.y, z: r.z - 3, yaw: 0, pitch: 0, roll: 0,
    speed: PLANE.vBoost, throttle: 1, fuel: 100, damage: 0,
  });
  const drained = [];
  for (let i = 0; i < 10 && !drained.some((e) => e.type === 'ring'); i++) {
    drained.push(...tick(g, { roll: 0, pitch: 0, boost: true, brake: false }, 0.1));
  }
  const ev = drained.find((e) => e.type === 'ring');
  assert.ok(ev, 'ring event drained from tick()');
  assert.equal(ev.id, 0);
  assert.ok(ev.dist < 1, 'near-center pass, dist ' + ev.dist);
  assert.equal(g.rings[0].passed, true);
  assert.ok(g.score >= SCORE.ringBase);
  assert.equal(g.state, 'flight');
});

test('zero fuel: engine-out fires once, then the plane glides without dying (unit)', () => {
  const ctx = stubCtx();
  const p = createPlane({ fuel: 0.3, throttle: 1, speed: 60 });
  let steps = 0;
  while (!p.engineOut && steps < 600) { stepPlane(p, NEUTRAL, ctx, STEP); steps++; }
  assert.ok(p.engineOut, 'engine cut when the tank hit zero');
  assert.equal(p.fuel, 0);
  assert.equal(ctx.events.filter((e) => e.type === 'fuelout').length, 1);
  assert.equal(p.dead, false);

  for (let i = 0; i < 600; i++) stepPlane(p, NEUTRAL, ctx, STEP); // 5 s glide
  assert.equal(p.dead, false);
  assert.ok(p.speed > 40 && p.speed < 52, 'settling at best glide ~46 m/s, got ' + p.speed);
  assert.equal(p.fuel, 0); // burn stopped at the empty tank
  assert.equal(ctx.events.filter((e) => e.type === 'fuelout').length, 1); // fired exactly once
});

test('zero fuel through the full game tick: fuelout event, message, survivable glide', () => {
  const g = createGame();
  resetSortie(g);
  g.plane.fuel = 0.2;
  g.plane.y = 500; // high enough that the glide path cannot touch terrain
  const drained = [];
  for (let i = 0; i < 20 && !g.plane.engineOut; i++) drained.push(...tick(g, NEUTRAL, 0.1));

  assert.ok(drained.some((e) => e.type === 'fuelout'));
  assert.equal(g.plane.engineOut, true);
  assert.equal(g.plane.fuel, 0);
  assert.equal(g.plane.dead, false);
  assert.equal(g.state, 'flight');
  assert.match(g.msg, /燃料切れ/);

  for (let i = 0; i < 30; i++) tick(g, NEUTRAL, 0.1); // 3 s of gliding home
  assert.equal(g.plane.dead, false);
  assert.equal(g.state, 'flight');
  assert.ok(g.plane.speed > 40 && g.plane.speed < 52);
});

test('touchdown evaluation: in-window accepted, out-of-window rejected (fatal beyond limits)', () => {
  const mk = (o) => createPlane({ yaw: 0, roll: 0, speed: 45, vy: -2, ...o });

  assert.deepEqual(evaluateTouchdown(mk({}), RUNWAY), { ok: true, fatal: false, reason: 'OK' });
  // window edges are inclusive
  assert.equal(evaluateTouchdown(
    mk({ speed: LAND.vMin, vy: -LAND.sinkMax, yaw: LAND.yawMax, roll: LAND.rollMax }), RUNWAY,
  ).ok, true);

  assert.equal(evaluateTouchdown(mk({ speed: LAND.vMin - 1 }), RUNWAY).ok, false); // too slow
  const fast = evaluateTouchdown(mk({ speed: LAND.vMax + 1 }), RUNWAY);
  assert.equal(fast.ok, false);
  assert.equal(fast.fatal, false); // hard but survivable
  assert.match(fast.reason, /速度/);
  assert.equal(evaluateTouchdown(mk({ speed: LAND.vMax * 1.6 + 1 }), RUNWAY).fatal, true); // fatal

  const sink = evaluateTouchdown(mk({ vy: -LAND.sinkMax - 0.5 }), RUNWAY);
  assert.equal(sink.ok, false);
  assert.equal(sink.fatal, false);
  assert.equal(evaluateTouchdown(mk({ vy: -LAND.sinkMax * 2.2 - 0.5 }), RUNWAY).fatal, true);

  assert.equal(evaluateTouchdown(mk({ yaw: LAND.yawMax + 0.05 }), RUNWAY).ok, false); // misaligned
  assert.equal(evaluateTouchdown(mk({ roll: LAND.rollMax + 0.05 }), RUNWAY).ok, false); // banked
});

// Fly the fixed final approach onto the cliff runway, then brake to a full stop.
// Returns every event drained from the approach through the end of the sortie.
function landAndStop(g) {
  Object.assign(g.plane, {
    x: 0, y: 60, z: 5950, yaw: 0, pitch: -0.055, roll: 0,
    speed: 45, throttle: 0.3, fuel: 80, damage: 0,
  });
  const all = [];
  for (let i = 0; i < 600 && !all.some((e) => e.type === 'touchdown'); i++) all.push(...tick(g, APPROACH, 1 / 30));
  for (let i = 0; i < 600 && g.state !== 'result'; i++) all.push(...tick(g, BRAKE, 1 / 30));
  return all;
}

test('safe landing with rings outstanding is an incomplete result, not a win', () => {
  // Zero rings passed: touchdown is allowed, but stopping on the runway must not win.
  {
    const g = createGame();
    resetSortie(g);
    const evs = landAndStop(g);
    assert.ok(evs.some((e) => e.type === 'touchdown'), 'touchdown still allowed');
    assert.ok(!evs.some((e) => e.type === 'win'), 'no win with rings outstanding');
    const inc = evs.find((e) => e.type === 'incomplete');
    assert.ok(inc, 'incomplete event fired at the full stop');
    assert.equal(inc.passed, 0);
    assert.equal(inc.total, 7);
    assert.equal(g.state, 'result');
    assert.equal(g.result.win, false);
    assert.match(g.result.reason, /リング未通過 7\/7/);
    assert.equal(g.plane.dead, false); // safe landing, not a crash
    assert.equal(g.plane.landed, true);
    assert.match(g.msg, /リング未通過/);
  }
  // Partial course (rings 0..2 passed): reason reports the outstanding count.
  {
    const g = createGame();
    resetSortie(g);
    for (let id = 0; id < 3; id++) passRing(g, id);
    const evs = landAndStop(g);
    assert.ok(!evs.some((e) => e.type === 'win'));
    const inc = evs.find((e) => e.type === 'incomplete');
    assert.ok(inc);
    assert.equal(inc.passed, 3);
    assert.match(g.result.reason, /リング未通過 4\/7/);
    assert.equal(g.result.win, false);
    assert.equal(g.state, 'result');
  }
});

test('all seven rings then a safe landing wins; final score includes ring points; one win event', () => {
  const g = createGame();
  resetSortie(g);
  for (let id = 0; id < 7; id++) passRing(g, id);
  const ringPoints = g.score;
  assert.equal(ringPoints, 7 * (SCORE.ringBase + SCORE.ringAcc)); // 2100 for dead-center passes

  const evs = landAndStop(g);
  assert.equal(evs.filter((e) => e.type === 'touchdown').length, 1, 'exactly one touchdown');
  assert.equal(evs.filter((e) => e.type === 'win').length, 1, 'exactly one win — no repeats within or across ticks');
  assert.ok(!evs.some((e) => e.type === 'dead' || e.type === 'incomplete'), 'no contradictory terminal outcome');
  assert.equal(g.state, 'result');
  assert.equal(g.result.win, true);
  assert.equal(g.result.score.parts.ring, ringPoints, 'ring points appear in the breakdown');
  assert.equal(
    g.result.score.total,
    finalScore({ time: g.plane.time, fuel: g.plane.fuel, damage: g.plane.damage, ringPoints }).total,
  );
  assert.ok(g.result.score.total > LAND.base + ringPoints, 'ring points add to the total');
  assert.equal(g.result.rank, rankFor(g.result.score.total));
});

test('out-of-order ring crossing is ignored; rings score strictly in sequence', () => {
  const g = createGame();
  resetSortie(g);
  // Aim at ring 1 while ring 0 is still pending: crossing its plane must do nothing.
  const r1 = g.rings[1];
  Object.assign(g.plane, {
    x: r1.x, y: r1.y, z: r1.z - 3, yaw: 0, pitch: 0, roll: 0,
    speed: PLANE.vBoost, throttle: 1, fuel: 100, damage: 0,
  });
  let drained = [];
  for (let i = 0; i < 10 && !drained.length; i++) drained.push(...tick(g, { roll: 0, pitch: 0, boost: true, brake: false }, 0.1));
  assert.equal(drained.length, 0, 'later ring inert while ring 0 is pending: no ring/clip event');
  assert.equal(g.rings[1].passed, false);
  assert.equal(g.score, 0);
  assert.ok(g.plane.fuel < 100, 'fuel only burned, no refuel from an out-of-order crossing: ' + g.plane.fuel);

  // Thread ring 0; ring 1 only becomes live afterwards.
  const r0 = g.rings[0];
  Object.assign(g.plane, { x: r0.x, y: r0.y, z: r0.z - 3 });
  drained = [];
  for (let i = 0; i < 10 && !drained.some((e) => e.type === 'ring'); i++) drained.push(...tick(g, { roll: 0, pitch: 0, boost: true, brake: false }, 0.1));
  assert.equal(drained.find((e) => e.type === 'ring').id, 0);
  assert.equal(g.rings[0].passed, true);
  assert.ok(g.score > 0);

  Object.assign(g.plane, { x: r1.x, y: r1.y, z: r1.z - 3 });
  drained = [];
  for (let i = 0; i < 10 && !drained.some((e) => e.type === 'ring'); i++) drained.push(...tick(g, { roll: 0, pitch: 0, boost: true, brake: false }, 0.1));
  assert.equal(drained.find((e) => e.type === 'ring').id, 1);
  assert.equal(g.rings[1].passed, true);
});

test('overshooting the current ring: turn back and re-cross in +z to score', () => {
  const rings = buildRings();
  const ctx = stubCtx({ rings });
  const r0 = rings[0];
  const p = createPlane({
    x: r0.x, y: r0.y, z: r0.z + 20, yaw: Math.PI, pitch: 0, roll: 0,
    speed: 60, throttle: 0.5, fuel: 100,
  });
  // Fly backwards across the ring plane: invalid direction, must not score.
  for (let i = 0; i < 60; i++) stepPlane(p, NEUTRAL, ctx, STEP);
  assert.ok(p.z < r0.z, 'flew back past the ring plane');
  assert.equal(ctx.events.length, 0);
  assert.equal(r0.passed, false);
  // Turn around and cross forward: the valid course direction scores.
  p.yaw = 0;
  for (let i = 0; i < 60 && !r0.passed; i++) stepPlane(p, NEUTRAL, ctx, STEP);
  const ev = ctx.events.find((e) => e.type === 'ring');
  assert.ok(ev, 'forward re-crossing scored');
  assert.equal(ev.id, 0);
  assert.ok(ev.dist < 1, 'dist ' + ev.dist);
  assert.equal(r0.passed, true);
});

test('engine-out -> refuel ring restores propulsion; burn and controls resume; no boost while empty', () => {
  const g = createGame();
  resetSortie(g);
  // Engine out at zero fuel: boost must not push past best glide.
  g.plane.fuel = 0;
  g.plane.engineOut = true;
  g.plane.speed = 50;
  g.plane.throttle = 1;
  let drained = [];
  for (let i = 0; i < 10; i++) drained.push(...tick(g, { roll: 0, pitch: 0, boost: true, brake: false }, 0.1));
  assert.equal(g.plane.engineOut, true);
  assert.equal(g.plane.fuel, 0);
  assert.ok(g.plane.speed <= 50 && g.plane.speed > 40, 'gliding near 46 m/s, no automatic boost, speed=' + g.plane.speed);
  assert.ok(!drained.some((e) => e.type === 'fuelout'), 'fuelout not re-emitted while already out');

  // Passing refuel ring 2 with positive fuel restarts the engine.
  applyEvent(g, { type: 'ring', id: 2, dist: 0, R: 15 });
  assert.equal(g.plane.fuel, REFUEL_AMOUNT);
  assert.equal(g.plane.engineOut, false);
  assert.match(g.msg, /エンジン再始動/);

  // Normal fuel burn and throttle control resume after the restart.
  const fuelBefore = g.plane.fuel;
  drained = [];
  for (let i = 0; i < 10; i++) drained.push(...tick(g, { roll: 0, pitch: 0, boost: false, brake: false }, 0.1));
  assert.ok(g.plane.speed > 60, 'throttle accelerates again after restart, speed=' + g.plane.speed);
  assert.ok(g.plane.fuel < fuelBefore && g.plane.fuel > 0, 'fuel burning normally again');
  assert.ok(!drained.some((e) => e.type === 'fuelout'));
  assert.equal(g.state, 'flight');
  assert.equal(g.plane.dead, false);
});

test('finalScore includes ring points in total and parts', () => {
  const s = finalScore({ time: 100, fuel: 50, damage: 10, ringPoints: 450 });
  assert.equal(s.parts.ring, 450);
  const expect = LAND.base + 450
    + Math.round((SCORE.timePar - 100) * SCORE.timeBonusPerSec)
    + 50 * SCORE.fuelBonus - 10 * SCORE.damagePenalty;
  assert.equal(s.total, expect);
  const s0 = finalScore({ time: SCORE.timePar, fuel: 0, damage: 0 });
  assert.equal(s0.parts.ring, 0);
  assert.equal(s0.total, LAND.base);
});

test('unacceptable landing: too fast bounces with damage; fatal approach crashes to result', () => {
  // 70 m/s on the runway: outside the window but survivable -> bounce, damage, no touchdown.
  {
    const g = createGame();
    resetSortie(g);
    Object.assign(g.plane, {
      x: 0, y: 53, z: 6000, yaw: 0, pitch: 0, roll: 0, speed: 70, throttle: 0, fuel: 100, damage: 0,
    });
    const evs = tick(g, NEUTRAL, STEP); // exactly one physics step
    assert.equal(evs.length, 1);
    assert.equal(evs[0].type, 'bounce');
    assert.ok(g.plane.damage > 0);
    assert.equal(g.plane.landed, false);
    assert.equal(g.plane.dead, false);
    assert.equal(g.state, 'flight');
  }
  // 100 m/s (> LAND.vMax * 1.6): fatal -> dead -> crash -> result after CRASH_DELAY.
  {
    const g = createGame();
    resetSortie(g);
    Object.assign(g.plane, {
      x: 0, y: 53, z: 6000, yaw: 0, pitch: 0, roll: 0, speed: 100, throttle: 0, fuel: 100, damage: 0,
    });
    const evs = tick(g, NEUTRAL, STEP);
    assert.equal(evs.length, 1);
    assert.equal(evs[0].type, 'dead');
    assert.match(evs[0].reason, /着陸失敗/);
    assert.equal(g.state, 'crash');
    assert.equal(g.result.win, false);
    assert.equal(g.result.reason, evs[0].reason);

    tick(g, NEUTRAL, CRASH_DELAY - 0.01);
    assert.equal(g.state, 'crash'); // crash screen still up before the delay elapses
    tick(g, NEUTRAL, 0.05);
    assert.equal(g.state, 'result');
  }
});

test('resetSortie fully rebuilds a fresh sortie; pause round-trips; huge dt is clamped', () => {
  const g = createGame();
  assert.equal(g.state, 'title');
  resetSortie(g);
  assert.equal(g.state, 'flight');

  // Dirty every piece of state: score, events, plane, crash flow.
  applyEvent(g, { type: 'ring', id: 2, dist: 0, R: 15 });
  applyEvent(g, { type: 'clip', id: 3 });
  Object.assign(g.plane, { fuel: 5, damage: 80, dead: true, x: 50, y: 90, z: 4000 });
  applyEvent(g, { type: 'dead', reason: 'テスト墜落' });
  assert.equal(g.state, 'crash');
  assert.ok(g.score > 0);
  g.msg = 'dirty';

  resetSortie(g);
  assert.equal(g.state, 'flight');
  assert.equal(g.score, 0);
  assert.equal(g.result, null);
  assert.equal(g.crashT, 0);
  assert.equal(g.acc, 0);
  assert.equal(g.msg, '');
  assert.equal(g.phys.events.length, 0);
  assert.equal(g.rings.length, 7);
  assert.ok(g.rings.every((r) => !r.passed));
  assert.deepEqual(g.rings.filter((r) => r.refuel).map((r) => r.id), [2, 4]);
  const fresh = createPlane();
  for (const k of ['x', 'y', 'z', 'yaw', 'pitch', 'roll', 'speed', 'throttle', 'fuel',
    'damage', 'vy', 'stall', 'engineOut', 'landed', 'rollout', 'dead', 'time', '_stopped']) {
    assert.equal(g.plane[k], fresh[k], 'plane.' + k);
  }

  // The fresh sortie flies; a tab-switch-sized dt is clamped to a single 0.1 s batch.
  const evs = tick(g, NEUTRAL, 60);
  assert.equal(evs.length, 0);
  assert.ok(Math.abs(g.plane.time - 0.1) < 1e-9, 'plane.time=' + g.plane.time);
  assert.equal(g.state, 'flight');

  togglePause(g);
  assert.equal(g.state, 'pause');
  assert.equal(g.prev, 'flight');
  togglePause(g);
  assert.equal(g.state, 'flight');
  assert.equal(g.prev, null);

  tick(g, NEUTRAL, STEP);
  assert.ok(Math.abs(g.plane.time - 0.1 - STEP) < 1e-9);
});

test('per-substep: crash stops motion in that substep and clears accumulator', () => {
  // Set up a plane that will crash on terrain contact
  const setup = () => {
    const g = createGame();
    resetSortie(g);
    Object.assign(g.plane, {
      x: 0, y: 2.0, z: 1000, yaw: 0, pitch: -0.3, roll: 0,
      speed: 60, throttle: 0.5, fuel: 100, damage: 0,
    });
    return g;
  };

  // Single large dt that contains multiple substeps
  const gA = setup();
  const dA = tick(gA, NEUTRAL, 0.1);
  assert.ok(dA.some((e) => e.type === 'dead'), 'crash event in first tick');
  assert.equal(gA.state, 'crash');
  assert.equal(gA.acc, 0, 'accumulator cleared after crash');

  // Further ticks must not move the plane after death
  const zAfter = gA.plane.z;
  tick(gA, NEUTRAL, 0.1);
  tick(gA, NEUTRAL, 0.1);
  assert.equal(gA.plane.z, zAfter, 'plane does not move after death');
  assert.equal(gA.state, 'crash');
});

test('per-substep: safe touchdown changes state to rollout for following substep', () => {
  const g = createGame();
  resetSortie(g);
  for (let id = 0; id < 7; id++) {
    g.rings[id].passed = true;
    applyEvent(g, { type: 'ring', id, dist: 0, R: 15 });
  }
  Object.assign(g.plane, {
    x: 0, y: 53, z: 6000, yaw: 0, pitch: 0.1, roll: 0,
    speed: 45, throttle: 0.3, fuel: 80, damage: 0,
  });

  // Touchdown should happen within the first few substeps
  const drained = [];
  for (let i = 0; i < 10; i++) drained.push(...tick(g, APPROACH, 0.1));

  const touchdownEv = drained.find((e) => e.type === 'touchdown');
  assert.ok(touchdownEv, 'touchdown event occurred');
  assert.equal(g.state, 'rollout', 'state changed to rollout after touchdown');
  assert.equal(g.plane.landed, true);
  assert.equal(g.plane.rollout, true);
});

test('per-substep: refuel after fuel-out restarts engine mid-tick', () => {
  const g = createGame();
  resetSortie(g);

  // Pass rings 0 and 1 first to make ring 2 the live ring
  for (let id = 0; id < 2; id++) {
    g.rings[id].passed = true;
    applyEvent(g, { type: 'ring', id, dist: 0, R: 15 });
  }

  const r = g.rings[2]; // refuel ring
  Object.assign(g.plane, {
    x: r.x, y: r.y, z: r.z - 0.3, yaw: 0, pitch: 0, roll: 0,
    speed: 46, throttle: 1, fuel: 0, engineOut: true, damage: 0,
    _prevZ: r.z - 10, // Ensure we cross the ring plane this substep
  });

  // Cross the refuel ring: engine should restart during the same tick
  const drained = tick(g, NEUTRAL, 0.1);
  assert.ok(drained.some((e) => e.type === 'ring' && e.id === 2), 'refuel ring crossed');
  assert.equal(g.plane.engineOut, false, 'engine restarted by refuel');
  assert.ok(g.plane.fuel >= REFUEL_AMOUNT - 0.2 && g.plane.fuel <= REFUEL_AMOUNT, 'fuel restored');
  assert.equal(g.state, 'flight');
});

test('per-substep: zero-wind level-engine-out glide descent', () => {
  const ctx = stubCtx();
  const p = createPlane({
    x: 0, y: 800, z: 0, yaw: 0, pitch: 0, roll: 0,
    speed: 46, throttle: 1, fuel: 0, engineOut: true,
  });

  // Simulate 1 second of glide with engine out, level attitude, zero wind
  const initialY = p.y;
  for (let i = 0; i < 120; i++) {
    stepPlane(p, NEUTRAL, ctx, STEP);
  }

  const sink = initialY - p.y;
  const expectedSink = 46 / PLANE.glide; // speed / glide ratio
  assert.ok(Math.abs(sink - expectedSink) < 0.5, `sink rate correct: ${sink.toFixed(2)} ≈ ${expectedSink.toFixed(2)}`);
  assert.ok(p.speed > 40 && p.speed < 52, 'speed settles near best glide');
  assert.equal(ctx.events.filter((e) => e.type === 'fuelout').length, 0, 'no additional fuelout events');
});

test('per-substep: engine-out rollout stop', () => {
  const g = createGame();
  resetSortie(g);

  // Pass all rings
  for (let id = 0; id < 7; id++) {
    g.rings[id].passed = true;
    applyEvent(g, { type: 'ring', id, dist: 0, R: 15 });
  }

  // Engine out but already on runway rollout
  Object.assign(g.plane, {
    x: 0, y: RUNWAY.alt + PLANE.gearH, z: RUNWAY.z0 + 100,
    yaw: 0, pitch: 0, roll: 0, speed: 30, throttle: 0,
    fuel: 0, engineOut: true, damage: 0, landed: true, rollout: true, dead: false,
  });

  // Apply brake and simulate rollout to stop
  const drained = [];
  for (let i = 0; i < 600 && g.state !== 'result'; i++) {
    drained.push(...tick(g, BRAKE, 1 / 30));
  }

  assert.ok(drained.some((e) => e.type === 'win'), 'win event fired after rollout stop');
  assert.equal(g.state, 'result');
  assert.equal(g.result.win, true);
  assert.equal(g.plane.speed, 0);
  assert.equal(g.plane._stopped, true);
});

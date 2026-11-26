// energy-glide.test.mjs — focused regression for engine-out energy behavior.
// Falsification test requested by the review: with the engine dead and zero wind,
// a fixed pitch input must not produce a SUSTAINED specific-energy increase
// (E = 9.8*y + v^2/2). A short pull-up may trade speed for height, but after the
// transient the energy must not keep growing: the old speed relaxation acted as
// phantom thrust below best-glide speed, so any fixed positive pitch converged
// to a constant-speed climb with the tank empty.
//
// Runs the real flight model (stepPlane) deterministically in still air.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { RUNWAY, PLANE } from '../src/config.js';
import { createPlane, stepPlane } from '../src/flight-model.js';

const STEP = 1 / 120;
// Zero wind, open sea far below (y0=2000 keeps 60 s of flight clear of the surface).
const stillAir = { events: [], windAt: () => [0, 0, 0], rings: [], runway: RUNWAY, terrainHeight: () => -1 };

function flyEngineOut(pitchInput, secs = 60) {
  const p = createPlane({ y: 2000, speed: 60, fuel: 1e-4, throttle: 0.6 });
  const ctrl = { roll: 0, pitch: pitchInput, boost: false, brake: false };
  const samples = [];
  for (let i = 0; i < secs * 120; i++) {
    stepPlane(p, ctrl, stillAir, STEP);
    if (i % 60 === 0) samples.push({ t: p.time, E: 9.8 * p.y + p.speed ** 2 / 2, vy: p.vy, v: p.speed, y: p.y });
  }
  return { p, samples };
}

test('engine-out, still air, fixed positive pitch: no sustained specific-energy gain', () => {
  for (const c of [0.36, 0.5, 0.8]) {
    const { p, samples } = flyEngineOut(c);
    assert.ok(p.engineOut, 'tank empty -> engine out');
    const near = (tt) => samples.reduce((a, s) => (Math.abs(s.t - tt) < Math.abs(a.t - tt) ? s : a));
    const E30 = near(30).E, E40 = near(40).E, E60 = samples[samples.length - 1].E;
    // After the pull-up transient, energy must not still be growing.
    assert.ok(E60 <= E40 + 1.0,
      `pitchInput=${c}: E still growing late: E(30)=${E30.toFixed(0)} E(40)=${E40.toFixed(0)} E(60)=${E60.toFixed(0)}`);
    assert.ok(E60 <= E30 + 1.0, `pitchInput=${c}: E(60)=${E60.toFixed(0)} > E(30)=${E30.toFixed(0)}`);
  }
});

test('engine-out, still air, neutral pitch: glides down and loses energy', () => {
  const { p, samples } = flyEngineOut(0);
  const E60 = samples[samples.length - 1].E, E40 = samples.reduce((a, s) => (Math.abs(s.t - 40) < Math.abs(a.t - 40) ? s : a)).E;
  assert.ok(p.vy < 0, `level engine-out glide must sink, vy=${p.vy.toFixed(2)}`);
  assert.ok(E60 < E40, `energy must decrease in the glide: E(40)=${E40.toFixed(0)} E(60)=${E60.toFixed(0)}`);
  assert.ok(p.speed > 30 && p.speed <= 52, `settles near best glide, v=${p.speed.toFixed(1)}`);
});

test('powered flight unaffected: fixed climb with engine on still climbs', () => {
  const p = createPlane({ y: 2000, speed: 60, fuel: 100, throttle: 1 });
  const ctrl = { roll: 0, pitch: 0.4, boost: false, brake: false };
  for (let i = 0; i < 20 * 120; i++) stepPlane(p, ctrl, stillAir, STEP);
  assert.ok(!p.engineOut && p.y > 2000, `powered climb should gain height, y=${p.y.toFixed(1)}`);
});

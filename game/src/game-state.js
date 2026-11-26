// game-state.js — pure game flow for SKYPOST: states, scoring, refuel rings, fixed-step tick.
// No DOM in here: main.js feeds it input, tests drive it directly from Node.
//
// States: 'title' -> 'flight' -> 'rollout' -> 'result' (win)
//                     'flight' -> 'crash' -> 'result' (fail); 'pause' overlays flight/rollout.
// A safe landing with rings still outstanding ends in 'result' with win:false ('incomplete').
//
// Exports:
//   STEP              fixed physics step (1/120 s)
//   REFUEL_RINGS      ring ids that refuel on pass (3rd and 5th rings)
//   REFUEL_AMOUNT     fuel restored by a refuel ring
//   CRASH_DELAY       seconds the crash state shows before the result screen
//   createGame()      fresh game in 'title' state
//   resetSortie(g)    rebuild plane/rings/score wholesale and enter 'flight'
//   applyEvent(g, ev) fold one physics event into the game state
//   togglePause(g)    pause/resume around flight/rollout
//   tick(g, ctrl, dt) advance fixed-step physics and timers; returns drained events

import { RUNWAY, PLANE } from './config.js';
import { clamp } from './math3.js';
import { createPlane, stepPlane } from './flight-model.js';
import { buildRings, ringScore, finalScore, rankFor } from './missions.js';
import { createWorld } from './world.js';

export const STEP = 1 / 120;
export const REFUEL_RINGS = new Set([2, 4]);
export const REFUEL_AMOUNT = 35;
export const CRASH_DELAY = 1.5;

// Events that end the sortie. At most one is emitted per tick and per state transition;
// the first one applied wins, later terminal events in the same batch are ignored.
const TERMINAL = new Set(['dead', 'win', 'incomplete']);

export function createGame() {
  const world = createWorld();
  const g = {
    world,
    state: 'title', prev: null,
    plane: createPlane(), rings: [], score: 0,
    phys: { events: [], windAt: world.windAt, rings: [], runway: RUNWAY, terrainHeight: world.terrainHeight },
    msg: '', msgAge: 0, muted: false, result: null, crashT: 0, acc: 0,
  };
  resetSortie(g);
  g.state = 'title';
  return g;
}

// Whole-state rebuild: no partial resets, no leftover listeners or timers.
export function resetSortie(g) {
  g.plane = createPlane();
  g.rings = buildRings();
  for (const r of g.rings) r.refuel = REFUEL_RINGS.has(r.id);
  g.phys.rings = g.rings;
  g.phys.events.length = 0;
  g.score = 0;
  g.result = null;
  g.crashT = 0;
  g.acc = 0;
  g.msg = '';
  g.msgAge = 0;
  g.state = 'flight';
}

export function applyEvent(g, ev) {
  // Terminal outcomes are final: once crash/result is decided, no later terminal event
  // can override or duplicate it (priority: the first terminal event wins).
  if (TERMINAL.has(ev.type) && (g.state === 'crash' || g.state === 'result')) return;
  switch (ev.type) {
    case 'ring': {
      const s = ringScore(ev.dist, ev.R);
      g.score += s.pts;
      g.msg = '風標リング通過 +' + s.pts;
      if (REFUEL_RINGS.has(ev.id)) {
        const wasOut = g.plane.engineOut;
        g.plane.fuel = clamp(g.plane.fuel + REFUEL_AMOUNT, 0, PLANE.fuelMax);
        // A refuel with positive fuel restarts propulsion (clears engine-out).
        if (g.plane.fuel > 0) g.plane.engineOut = false;
        g.msg += ' — 燃料補給 +' + REFUEL_AMOUNT;
        if (wasOut && !g.plane.engineOut) g.msg += ' — エンジン再始動';
      }
      break;
    }
    case 'clip': g.msg = 'リング枠に接触 — 損傷'; break;
    case 'touchdown': g.state = 'rollout'; g.msg = 'タッチダウン — ブレーキで停止せよ'; break;
    case 'win': {
      // Success requires the full course: all seven rings, in order, then the landing.
      if (!g.rings.every((r) => r.passed)) {
        const passed = g.rings.filter((r) => r.passed).length;
        applyEvent(g, { type: 'incomplete', passed, total: g.rings.length, reason: 'リング未通過 ' + (g.rings.length - passed) + '/' + g.rings.length + ' — 配達未完了' });
        break;
      }
      const score = finalScore({ time: g.plane.time, fuel: g.plane.fuel, damage: g.plane.damage, ringPoints: g.score });
      g.result = { win: true, score, rank: rankFor(score.total) };
      g.state = 'result';
      g.msg = '配達完了!';
      break;
    }
    case 'incomplete': {
      g.result = { win: false, reason: ev.reason };
      g.state = 'result';
      g.msg = ev.reason;
      break;
    }
    case 'dead':
      g.result = { win: false, reason: ev.reason };
      g.state = 'crash';
      g.crashT = 0;
      g.msg = ev.reason;
      break;
    case 'stall': g.msg = '失速警告 — 速度を回復せよ'; break;
    case 'stallEnd': break;
    case 'fuelout': g.msg = '燃料切れ — 滑空で帰還せよ'; break;
    case 'bounce': g.msg = 'バウンド: ' + ev.reason; break;
    case 'scrape': g.msg = '地形に接触 — 損傷'; break;
    case 'warn': g.msg = ev.text; break;
  }
  g.msgAge = 0;
}

export function togglePause(g) {
  if (g.state === 'flight' || g.state === 'rollout') { g.prev = g.state; g.state = 'pause'; }
  else if (g.state === 'pause') { g.state = g.prev || 'flight'; g.prev = null; }
}

export function tick(g, ctrl, dt) {
  g.msgAge += dt;
  const drained = [];
  // Events are applied immediately after every substep, in emission order, so one frame
  // is exactly the sum of its fixed steps no matter how dt was chunked.
  const drain = () => {
    while (g.phys.events.length) {
      const ev = g.phys.events.shift();
      applyEvent(g, ev);
      drained.push(ev);
    }
  };
  if (g.state === 'flight' || g.state === 'rollout') {
    if (!Number.isFinite(g.plane.x + g.plane.y + g.plane.z + g.plane.speed + g.plane.fuel)) {
      applyEvent(g, { type: 'dead', reason: '機体状態が異常になった' });
    } else {
      // Fixed-step accumulator: tab switches (dt clamped to 0.1 s) cannot blow the plane up.
      g.acc = (g.acc || 0) + Math.min(dt, 0.1);
      while (g.acc >= STEP) {
        stepPlane(g.plane, ctrl || { roll: 0, pitch: 0, boost: false, brake: false }, g.phys, STEP);
        g.acc -= STEP;
        drain();
        // Once the sortie ends (crash/result), stop substepping at once and drop the
        // leftover accumulator: no post-mortem motion, no second terminal event. The
        // applyEvent terminal guard makes a dead/win pair impossible to double-apply.
        if (g.state !== 'flight' && g.state !== 'rollout') { g.acc = 0; break; }
      }
    }
  }
  drain();
  if (g.state === 'crash') {
    g.crashT += dt;
    if (g.crashT >= CRASH_DELAY) g.state = 'result';
  }
  return drained;
}

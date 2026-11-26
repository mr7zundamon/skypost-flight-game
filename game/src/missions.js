// Mission rules for SKYPOST: 風紋の配達便: thread the glowing wind rings strung over the
// island coast, then land on the cliff-side runway. Also scoring, the touchdown acceptance
// window, and the deterministic showcase states used for ?showcase= screenshot captures.

import { RUNWAY, LAND, SCORE } from './config.js';
import { mulberry32 } from './rng.js';
import { clamp, wrapAngle } from './math3.js';

// Seven rings spaced down the course, alternating sides and heights.
export function buildRings() {
  const rng = mulberry32(90210);
  const zs = [900, 1600, 2300, 3000, 3700, 4400, 5100];
  return zs.map((z, i) => ({
    id: i,
    x: Math.round((rng() - 0.5) * 460),
    y: Math.round(150 + rng() * 190),
    z,
    R: 15,
    passed: false,
  }));
}

export function nextRing(rings) {
  return rings.find((r) => !r.passed) ?? null;
}

// What the HUD points at: the next ring, or the runway once all rings are threaded.
export function objectiveInfo(p, rings, runway) {
  const r = nextRing(rings);
  if (r) {
    const dx = r.x - p.x, dz = r.z - p.z;
    return {
      kind: 'ring', id: r.id, passed: rings.filter((q) => q.passed).length, total: rings.length,
      x: r.x, y: r.y, z: r.z,
      dist: Math.hypot(dx, r.y - p.y, dz),
      bearing: Math.atan2(dx, dz),
    };
  }
  const dx = runway.cx - p.x, dz = runway.z0 - p.z;
  return {
    kind: 'runway', passed: rings.length, total: rings.length,
    x: runway.cx, y: runway.alt + 24, z: runway.z0 - 140,
    dist: Math.hypot(dx, runway.alt + 30 - p.y, dz),
    bearing: Math.atan2(dx, dz),
  };
}

// Touchdown window: speed, sink rate, runway alignment and wings-level.
// Returns { ok, fatal, reason } — fatal fails hard, otherwise the plane bounces with damage.
export function evaluateTouchdown(p, rw) {
  const yawErr = Math.abs(wrapAngle(p.yaw - rw.heading));
  const sink = -p.vy;
  const checks = [
    [p.speed >= LAND.vMin && p.speed <= LAND.vMax, `速度 ${p.speed.toFixed(0)} m/s（${LAND.vMin}〜${LAND.vMax} が目安）`],
    [sink <= LAND.sinkMax, `沈下率 ${sink.toFixed(1)} m/s（${LAND.sinkMax} 以下）`],
    [yawErr <= LAND.yawMax, `方位誤差 ${(yawErr * 57.3).toFixed(0)}°（${Math.round(LAND.yawMax * 57.3)}° 以内）`],
    [Math.abs(p.roll) <= LAND.rollMax, 'バンク角が大きすぎる'],
  ];
  for (const [ok, reason] of checks) {
    if (!ok) {
      const fatal = p.speed > LAND.vMax * 1.6 || sink > LAND.sinkMax * 2.2;
      return { ok: false, fatal, reason };
    }
  }
  return { ok: true, fatal: false, reason: 'OK' };
}

// Ring score: dead-center pays the accuracy bonus.
export function ringScore(dist, R) {
  const acc = clamp(1 - dist / R, 0, 1);
  return { pts: Math.round(SCORE.ringBase + acc * SCORE.ringAcc), acc };
}

// Final score breakdown at a successful landing. Ring points earned along the course
// (g.score) are part of the total, alongside the existing time/fuel/damage terms.
export function finalScore({ time, fuel, damage, ringPoints = 0 }) {
  const timeBonus = Math.max(0, Math.round((SCORE.timePar - time) * SCORE.timeBonusPerSec));
  const fuelBonus = Math.round(fuel * SCORE.fuelBonus);
  const damagePenalty = Math.round(damage * SCORE.damagePenalty);
  const total = Math.max(0, LAND.base + ringPoints + timeBonus + fuelBonus - damagePenalty);
  return { total, parts: { landing: LAND.base, ring: ringPoints, timeBonus, fuelBonus, damagePenalty } };
}

export function rankFor(total) {
  if (total >= 1400) return 'S';
  if (total >= 1150) return 'A';
  if (total >= 900) return 'B';
  return 'C';
}

// Deterministic states for ?showcase=flight|approach|landing (frozen-frame screenshots).
// Returns plane overrides plus the ring list; main.js wraps the overrides in createPlane().
export function buildShowcase(name) {
  const rings = buildRings();
  if (name === 'flight') {
    return {
      plane: { x: 0, y: 300, z: 420, yaw: 0.06, pitch: 0.02, roll: 0.05, speed: 64, throttle: 0.62, fuel: 78, damage: 0 },
      rings,
    };
  }
  if (name === 'approach') {
    const r = rings[3];
    rings[0].passed = rings[1].passed = rings[2].passed = true;
    return {
      plane: { x: r.x * 0.92, y: r.y + 7, z: r.z - 130, yaw: 0.03, pitch: 0.03, roll: 0.04, speed: 56, throttle: 0.5, fuel: 52, damage: 0 },
      rings,
    };
  }
  if (name === 'landing') {
    for (const r of rings) r.passed = true;
    return {
      plane: { x: 1.5, y: RUNWAY.alt + 30, z: RUNWAY.z0 - 320, yaw: 0.02, pitch: -0.06, roll: 0.02, speed: 50, throttle: 0.34, fuel: 40, damage: 0 },
      rings,
    };
  }
  return null;
}

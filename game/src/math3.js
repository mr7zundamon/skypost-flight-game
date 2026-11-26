// Small math helpers shared by the flight model, camera and renderers.

export const TAU = Math.PI * 2;

export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
// Frame-rate independent exponential approach.
export function damp(cur, target, lambda, dt) { return lerp(cur, target, 1 - Math.exp(-lambda * dt)); }

export function wrapAngle(a) {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}

export function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

export function fmtInt(n) { return String(Math.round(n)).padStart(6, '0'); }

// Convert radians to 0-359 degrees (0 = +z, consistent with yaw).
export function toDegrees360(rad) {
  let deg = rad * 180 / Math.PI;
  deg = deg % 360;
  return deg < 0 ? deg + 360 : deg;
}

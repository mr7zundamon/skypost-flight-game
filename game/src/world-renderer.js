// world-renderer.js — pseudo-3D perspective renderer for SKYPOST.
// Everything on screen is drawn in code from PALETTE colors: no images, no web fonts,
// no audio files, no network.
//
// Exports:
//   createCamera(plane)  -> chase camera { pos, r, u, f, yaw, pitch, roll }
//   project(cam, x, y, z) -> { x, y, d } in 1280x720 screen units, or null behind the near plane
//   drawWorld(ctx, plane, world, rings, runway, time)
//       ctx    CanvasRenderingContext2D (drawing happens in 1280x720 units)
//       plane  flight-model plane state (x,y,z,yaw,pitch,roll,speed,throttle,...)
//       world  createWorld() result (terrainHeight / surfaceInfo)
//       rings  missions.buildRings() list; r.passed / r.refuel drive the colors
//       runway RUNWAY from config.js
//       time   mission clock in seconds (pulses the next ring, blinks the beacon)
//   drawPlane(ctx, plane, time) -> chase-view airframe, exported for tests

import { VIEW, PALETTE, SUN } from './config.js';
import { clamp, lerp, smoothstep, TAU } from './math3.js';
import { hash2 } from './rng.js';

const CAM_BACK = 9.5;   // chase distance behind the plane (m)
const CAM_UP = 3.4;     // camera height above the plane (m)
const CAM_ROLL = 0.62;  // fraction of the plane's bank the camera follows; the rest shows on the airframe

// --- camera -------------------------------------------------------------------

export function createCamera(plane) {
  const yaw = plane.yaw, pitch = plane.pitch;
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const f = [Math.sin(yaw) * cp, sp, Math.cos(yaw) * cp];
  const r0 = [Math.cos(yaw), 0, -Math.sin(yaw)];
  const u0 = [-Math.sin(yaw) * sp, cp, -Math.cos(yaw) * sp];
  const roll = plane.roll * CAM_ROLL;
  const cr = Math.cos(roll), sr = Math.sin(roll);
  const r = [r0[0] * cr + u0[0] * sr, r0[1] * cr + u0[1] * sr, r0[2] * cr + u0[2] * sr];
  const u = [u0[0] * cr - r0[0] * sr, u0[1] * cr - r0[1] * sr, u0[2] * cr - r0[2] * sr];
  return {
    pos: [plane.x - f[0] * CAM_BACK, plane.y - f[1] * CAM_BACK + CAM_UP, plane.z - f[2] * CAM_BACK],
    r, u, f, yaw, pitch, roll,
  };
}

// Near-plane clip: points behind the camera return null instead of mirroring.
export function project(cam, x, y, z) {
  const dx = x - cam.pos[0], dy = y - cam.pos[1], dz = z - cam.pos[2];
  const zc = dx * cam.f[0] + dy * cam.f[1] + dz * cam.f[2];
  if (zc < 0.6) return null;
  const xc = dx * cam.r[0] + dy * cam.r[1] + dz * cam.r[2];
  const yc = dx * cam.u[0] + dy * cam.u[1] + dz * cam.u[2];
  return { x: VIEW.W / 2 + VIEW.FOCAL * xc / zc, y: VIEW.H / 2 - VIEW.FOCAL * yc / zc, d: zc };
}

// --- small color helpers (hex or rgb() strings in, rgb() string out) ----------

function parseC(c) {
  if (c[0] === '#') {
    const n = parseInt(c.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = c.match(/[\d.]+/g);
  return [+m[0], +m[1], +m[2]];
}
function mixc(a, b, t) {
  const A = parseC(a), B = parseC(b);
  return `rgb(${Math.round(lerp(A[0], B[0], t))},${Math.round(lerp(A[1], B[1], t))},${Math.round(lerp(A[2], B[2], t))})`;
}
function shade(c, f) {
  const A = parseC(c);
  return `rgb(${clamp(Math.round(A[0] * f), 0, 255)},${clamp(Math.round(A[1] * f), 0, 255)},${clamp(Math.round(A[2] * f), 0, 255)})`;
}

// --- sky, sun, sea --------------------------------------------------------------

function drawSkyAndSea(ctx, cam) {
  const W = VIEW.W, H = VIEW.H, F = VIEW.FOCAL;
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.rotate(cam.roll);
  ctx.translate(0, F * Math.tan(clamp(cam.pitch, -1.25, 1.25)));
  // In this frame the horizon is the local y=0 line; sky above, sea below.
  const sky = ctx.createLinearGradient(0, -H * 2, 0, 0);
  sky.addColorStop(0, PALETTE.skyTop);
  sky.addColorStop(0.45, PALETTE.skyMid);
  sky.addColorStop(0.72, PALETTE.skyLow);
  sky.addColorStop(0.9, PALETTE.skyWarm);
  sky.addColorStop(1, PALETTE.horizon);
  ctx.fillStyle = sky;
  ctx.fillRect(-W * 1.6, -H * 2, W * 3.2, H * 2);
  const sea = ctx.createLinearGradient(0, 0, 0, H * 2);
  sea.addColorStop(0, mixc(PALETTE.seaGlade, PALETTE.seaDeep, 0.25));
  sea.addColorStop(0.3, PALETTE.seaDeep);
  sea.addColorStop(1, PALETTE.seaDeep);
  ctx.fillStyle = sea;
  ctx.fillRect(-W * 1.6, 0, W * 3.2, H * 2);
  ctx.restore();
}

function sunScreenPos(cam) {
  const el = SUN.el, az = SUN.az + cam.yaw; // sun azimuth is fixed relative to the course
  const dist = 4000;
  return project(cam,
    cam.pos[0] + Math.sin(az) * Math.cos(el) * dist,
    cam.pos[1] + Math.sin(el) * dist,
    cam.pos[2] + Math.cos(az) * Math.cos(el) * dist);
}

function drawSun(ctx, cam) {
  const p = sunScreenPos(cam);
  if (!p) return null;
  const g = ctx.createRadialGradient(p.x, p.y, 4, p.x, p.y, 200);
  g.addColorStop(0, PALETTE.sunGlow);
  g.addColorStop(1, 'rgba(255,196,110,0)');
  ctx.fillStyle = g;
  ctx.fillRect(p.x - 210, p.y - 210, 420, 420);
  ctx.fillStyle = PALETTE.sunCore;
  ctx.beginPath(); ctx.arc(p.x, p.y, 26, 0, TAU); ctx.fill();
  return p;
}

// Sun glitter path on the sea.
function drawGlade(ctx, cam, sunP) {
  if (!sunP || sunP.y > VIEW.H) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createLinearGradient(0, sunP.y, 0, VIEW.H);
  g.addColorStop(0, 'rgba(255,205,130,0.45)');
  g.addColorStop(1, 'rgba(255,205,130,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(sunP.x - 24, sunP.y);
  ctx.lineTo(sunP.x + 24, sunP.y);
  ctx.lineTo(sunP.x + 160, VIEW.H);
  ctx.lineTo(sunP.x - 160, VIEW.H);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawClouds(ctx, cam, time) {
  for (let i = 0; i < 24; i++) {
    const az = cam.yaw + (hash2(i, 11) - 0.5) * 2.8 + time * 0.006 * (hash2(i, 12) - 0.3);
    const el = 0.05 + hash2(i, 13) * 0.42;
    const dist = 2400 + hash2(i, 14) * 3600;
    const size = 260 + hash2(i, 15) * 420;
    const p = project(cam,
      cam.pos[0] + Math.sin(az) * Math.cos(el) * dist,
      cam.pos[1] + Math.sin(el) * dist,
      cam.pos[2] + Math.cos(az) * Math.cos(el) * dist);
    if (!p) continue;
    const s = VIEW.FOCAL * size / p.d;
    if (s < 6) continue;
    const a = clamp(0.16 * 3400 / p.d, 0.03, 0.13);
    ctx.fillStyle = `rgba(255,214,190,${a})`;
    for (let k = 0; k < 3; k++) {
      ctx.beginPath();
      ctx.ellipse(p.x + (hash2(i, 20 + k) - 0.5) * s, p.y + (hash2(i, 30 + k) - 0.5) * s * 0.3,
        s * (0.5 + hash2(i, 40 + k) * 0.5), s * 0.22, 0, 0, TAU);
      ctx.fill();
    }
  }
}

// Distant island ridges beyond the terrain mesh, hazed toward the sky.
function drawRidges(ctx, cam, world) {
  const layers = [
    { dist: 5600, color: mixc(PALETTE.fog, PALETTE.seaDeep, 0.45), alpha: 0.85 },
    { dist: 10500, color: mixc(PALETTE.fog, PALETTE.horizon, 0.3), alpha: 0.9 },
  ];
  for (const L of layers) {
    let first = null, last = null;
    ctx.beginPath();
    for (let a = -1.45; a <= 1.45001; a += 0.05) {
      const az = cam.yaw + a;
      const x = cam.pos[0] + Math.sin(az) * L.dist;
      const z = cam.pos[2] + Math.cos(az) * L.dist;
      const p = project(cam, x, Math.max(world.terrainHeight(x, z), 0), z);
      if (!p) continue;
      if (!first) { ctx.moveTo(p.x, p.y); first = p; } else ctx.lineTo(p.x, p.y);
      last = p;
    }
    if (!first) continue;
    ctx.lineTo(last.x, VIEW.H * 2);
    ctx.lineTo(first.x, VIEW.H * 2);
    ctx.closePath();
    ctx.globalAlpha = L.alpha;
    ctx.fillStyle = L.color;
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

// Wave glints on the sea, brighter toward the sun azimuth, twinkling with time.
function drawSeaDetail(ctx, cam, world, time) {
  const fh = [Math.sin(cam.yaw), 0, Math.cos(cam.yaw)];
  const rh = [Math.cos(cam.yaw), 0, -Math.sin(cam.yaw)];
  const sunAz = cam.yaw + SUN.az;
  ctx.save();
  ctx.lineWidth = 1.4;
  for (let iz = 0; iz < 26; iz++) {
    const d = 14 + iz * 26;
    for (let ix = -9; ix <= 9; ix++) {
      const xo = ix * 26 + hash2(ix * 3 + iz, iz) * 14;
      const wx = cam.pos[0] + fh[0] * d + rh[0] * xo;
      const wz = cam.pos[2] + fh[2] * d + rh[2] * xo;
      if (world.terrainHeight(wx, wz) > 0.5) continue;
      const p = project(cam, wx, 0, wz);
      if (!p || p.d > 900) continue;
      const toSun = ((wx - cam.pos[0]) * Math.sin(sunAz) + (wz - cam.pos[2]) * Math.cos(sunAz)) / d;
      const tw = hash2(ix + Math.floor(time * 3), iz * 7 + ix);
      const a = Math.pow(Math.max(0, toSun), 10) * (0.25 + 0.55 * tw) * clamp(700 / p.d, 0, 1);
      if (a < 0.05) continue;
      ctx.strokeStyle = `rgba(255,224,170,${a})`;
      const s = clamp(VIEW.FOCAL * 2.2 / p.d, 1, 7);
      ctx.beginPath(); ctx.moveTo(p.x - s, p.y); ctx.lineTo(p.x + s, p.y); ctx.stroke();
    }
  }
  ctx.restore();
}

// --- terrain mesh ---------------------------------------------------------------

function biomeColor(i0, i1, h, slope, x, z, d) {
  const moist = (i0.moist + i1.moist) / 2;
  let base;
  if (h <= 1.4) base = PALETTE.sand;
  else if (h < 22) base = mixc(PALETTE.sand, PALETTE.grass, clamp((h - 1.4) / 12, 0, 1) * (0.5 + moist));
  else if (h < 34) base = moist > 0.52 ? PALETTE.forest : PALETTE.grass;
  else if (h < 95) base = slope > 0.55 || moist < 0.34 ? PALETTE.rock : mixc(PALETTE.forest, PALETTE.rock, clamp((h - 34) / 40, 0, 1));
  else if (h < 160) base = PALETTE.rock;
  else base = slope > 0.7 ? PALETTE.rock : PALETTE.snow;
  const jit = 0.88 + 0.24 * hash2(Math.round(x * 0.9), Math.round(z * 0.9));
  const fogF = smoothstep(420, VIEW.FAR * 0.96, d);
  return mixc(shade(base, jit), PALETTE.fog, fogF);
}

function drawTerrain(ctx, cam, world) {
  const rows = VIEW.ROWS, cols = VIEW.COLS;
  const fh = [Math.sin(cam.yaw), 0, Math.cos(cam.yaw)];
  const rh = [Math.cos(cam.yaw), 0, -Math.sin(cam.yaw)];
  let prev = null;
  for (let i = 0; i < rows; i++) {
    const d = VIEW.NEAR * Math.pow(VIEW.FAR / VIEW.NEAR, i / (rows - 1));
    const w = d * 1.18 + 10;
    const row = [];
    for (let j = 0; j < cols; j++) {
      const xo = -w + (2 * w * j) / (cols - 1);
      const wx = cam.pos[0] + fh[0] * d + rh[0] * xo;
      const wz = cam.pos[2] + fh[2] * d + rh[2] * xo;
      const info = world.surfaceInfo(wx, wz);
      row.push({ p: project(cam, wx, info.h > 0 ? info.h : -3, wz), info, wx, wz, d });
    }
    if (prev) {
      for (let j = 0; j < cols - 1; j++) {
        const a = prev[j], b = prev[j + 1], c = row[j + 1], e = row[j];
        if (!a.p || !b.p || !c.p || !e.p) continue;
        if (a.info.h <= 0 && b.info.h <= 0 && c.info.h <= 0 && e.info.h <= 0) continue; // open water
        const hAvg = (a.info.h + e.info.h) / 2;
        const slope = Math.abs(row[j].info.h - prev[j].info.h) / Math.max(1, d - prev[j].d);
        ctx.fillStyle = biomeColor(a.info, e.info, hAvg, slope, a.wx, a.wz, d);
        ctx.beginPath();
        ctx.moveTo(a.p.x, a.p.y);
        ctx.lineTo(b.p.x, b.p.y);
        ctx.lineTo(c.p.x, c.p.y);
        ctx.lineTo(e.p.x, e.p.y);
        ctx.closePath();
        ctx.fill();
      }
    }
    prev = row;
  }
}

// --- cliff runway ---------------------------------------------------------------

function drawRunway(ctx, cam, runway, time) {
  const y = runway.alt + 0.4;
  const c = [
    project(cam, runway.cx - runway.halfW, y, runway.z0),
    project(cam, runway.cx + runway.halfW, y, runway.z0),
    project(cam, runway.cx + runway.halfW, y, runway.z1),
    project(cam, runway.cx - runway.halfW, y, runway.z1),
  ];
  if (c.some((p) => !p)) return;
  const d = Math.max(c[0].d, c[1].d, c[2].d, c[3].d);
  const fogF = smoothstep(600, VIEW.FAR, d) * 0.45;
  ctx.fillStyle = mixc(PALETTE.asphalt, PALETTE.fog, fogF);
  ctx.beginPath();
  ctx.moveTo(c[0].x, c[0].y);
  for (let i = 1; i < 4; i++) ctx.lineTo(c[i].x, c[i].y);
  ctx.closePath();
  ctx.fill();
  // Centreline dashes.
  ctx.strokeStyle = mixc('#e8e4da', PALETTE.fog, fogF);
  ctx.lineWidth = clamp(VIEW.FOCAL * 1.1 / d, 0.6, 4);
  for (let z = runway.z0 + 24; z < runway.z1 - 10; z += 46) {
    const a = project(cam, runway.cx, y + 0.1, z);
    const b = project(cam, runway.cx, y + 0.1, Math.min(z + 22, runway.z1 - 6));
    if (a && b) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
  }
  // Threshold bar.
  const t0 = project(cam, runway.cx - runway.halfW, y + 0.15, runway.z0 + 3);
  const t1 = project(cam, runway.cx + runway.halfW, y + 0.15, runway.z0 + 3);
  if (t0 && t1) {
    ctx.strokeStyle = mixc('#f4efe4', PALETTE.fog, fogF);
    ctx.lineWidth = clamp(VIEW.FOCAL * 1.6 / ((t0.d + t1.d) / 2), 1, 6);
    ctx.beginPath(); ctx.moveTo(t0.x, t0.y); ctx.lineTo(t1.x, t1.y); ctx.stroke();
  }
  // Edge lights along both sides.
  for (let z = runway.z0 + 10; z <= runway.z1; z += 85) {
    for (const s of [-1, 1]) {
      const p = project(cam, runway.cx + s * (runway.halfW - 0.7), y + 0.6, z);
      if (!p) continue;
      const r = clamp(VIEW.FOCAL * 0.9 / p.d, 1, 5);
      ctx.fillStyle = ((z - runway.z0) % 170) < 85 ? PALETTE.hudAmber : PALETTE.hudGreen;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fill();
    }
  }
  // Red lamps along the cliff edge past the far end.
  for (let x = runway.cx - 60; x <= runway.cx + 60; x += 20) {
    const p = project(cam, x, runway.alt + 1.2, runway.z1 + 6);
    if (!p) continue;
    const r = clamp(VIEW.FOCAL * 0.8 / p.d, 1, 5);
    ctx.fillStyle = PALETTE.hudRed;
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fill();
  }
  // Pale highlight on the cliff edge itself.
  const e0 = project(cam, runway.cx - 70, runway.alt, runway.z1 + 6);
  const e1 = project(cam, runway.cx + 70, runway.alt, runway.z1 + 6);
  if (e0 && e1) {
    ctx.strokeStyle = 'rgba(255,230,190,0.5)';
    ctx.lineWidth = clamp(VIEW.FOCAL * 1.2 / ((e0.d + e1.d) / 2), 0.6, 4);
    ctx.beginPath(); ctx.moveTo(e0.x, e0.y); ctx.lineTo(e1.x, e1.y); ctx.stroke();
  }
}

// --- wind rings -----------------------------------------------------------------

function drawRings(ctx, cam, rings, time) {
  const next = rings.find((r) => !r.passed) ?? null;
  const ordered = [...rings].sort((a, b) => {
    const ca = project(cam, a.x, a.y, a.z), cb = project(cam, b.x, b.y, b.z);
    return (cb ? cb.d : 0) - (ca ? ca.d : 0); // far first (painter)
  });
  for (const r of ordered) {
    const c = project(cam, r.x, r.y, r.z);
    if (!c || c.d > VIEW.FAR * 1.15) continue;
    let color, glow = 0;
    const lw = clamp(VIEW.FOCAL * 1.7 / c.d, 1.2, 7);
    if (r.passed) color = PALETTE.ringDone;
    else if (r === next) { color = PALETTE.ringNext; glow = 16 + 8 * Math.sin(time * 5); }
    else if (r.refuel) { color = PALETTE.ringIdle; glow = 7; }
    else color = 'rgba(255,210,122,0.55)';
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    if (glow) { ctx.shadowColor = color; ctx.shadowBlur = glow; }
    ctx.strokeStyle = color;
    if (r === next) ctx.globalAlpha = 0.8 + 0.2 * Math.sin(time * 5);
    ctx.lineWidth = lw;
    ctx.beginPath();
    let pen = false;
    for (let k = 0; k <= 26; k++) {
      const th = (k / 26) * TAU;
      const p = project(cam, r.x + r.R * Math.cos(th), r.y + r.R * Math.sin(th), r.z);
      if (!p) { pen = false; continue; }
      if (!pen) { ctx.moveTo(p.x, p.y); pen = true; } else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.restore();
  }
}

// --- the plane (chase view) -------------------------------------------------------

export function drawPlane(ctx, plane, time) {
  const cx = VIEW.W / 2;
  const cy = VIEW.H * 0.68 + clamp(plane.pitch, -0.6, 0.6) * 46;
  const body = PALETTE.planeBody, accent = PALETTE.planeAccent, dark = PALETTE.planeDark;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(plane.roll * (1 - CAM_ROLL)); // remaining bank shows on the airframe
  // main wings
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(-168, -16); ctx.lineTo(-18, -26); ctx.lineTo(-18, 2); ctx.lineTo(-168, 12); ctx.closePath();
  ctx.moveTo(168, -16); ctx.lineTo(18, -26); ctx.lineTo(18, 2); ctx.lineTo(168, 12); ctx.closePath();
  ctx.fill();
  // accent wingtips
  ctx.fillStyle = accent;
  ctx.fillRect(-168, -16, 12, 28);
  ctx.fillRect(156, -16, 12, 28);
  // horizontal stabiliser
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(-52, 44); ctx.lineTo(-10, 38); ctx.lineTo(-10, 50); ctx.lineTo(-52, 54); ctx.closePath();
  ctx.moveTo(52, 44); ctx.lineTo(10, 38); ctx.lineTo(10, 50); ctx.lineTo(52, 54); ctx.closePath();
  ctx.fill();
  // fuselage
  ctx.beginPath();
  ctx.moveTo(0, -104);
  ctx.bezierCurveTo(12, -84, 15, -40, 13, 6);
  ctx.bezierCurveTo(12, 34, 9, 52, 0, 58);
  ctx.bezierCurveTo(-9, 52, -12, 34, -13, 6);
  ctx.bezierCurveTo(-15, -40, -12, -84, 0, -104);
  ctx.fill();
  // canopy
  ctx.fillStyle = dark;
  ctx.beginPath(); ctx.ellipse(0, -52, 7.5, 16, 0, 0, TAU); ctx.fill();
  // vertical fin seen from behind
  ctx.fillStyle = accent;
  ctx.beginPath(); ctx.moveTo(-7, 56); ctx.lineTo(0, 34); ctx.lineTo(7, 56); ctx.closePath(); ctx.fill();
  // prop disc at the nose
  const th = clamp(plane.throttle, 0, 1);
  if (th > 0.05) {
    ctx.strokeStyle = `rgba(40,44,54,${0.25 + th * 0.5})`;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(0, -102, 4, 13 * (0.3 + th), 0, 0, TAU); ctx.stroke();
  }
  // nav lights: red left, green right, white strobe on the tail, landing light at the nose
  ctx.fillStyle = PALETTE.hudRed; ctx.beginPath(); ctx.arc(-168, -2, 3.4, 0, TAU); ctx.fill();
  ctx.fillStyle = PALETTE.hudGreen; ctx.beginPath(); ctx.arc(168, -2, 3.4, 0, TAU); ctx.fill();
  if (Math.sin(time * 7) > 0.55) {
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.beginPath(); ctx.arc(0, 57, 3, 0, TAU); ctx.fill();
  }
  ctx.fillStyle = 'rgba(255,244,200,0.9)';
  ctx.beginPath(); ctx.arc(0, -103, 2.4, 0, TAU); ctx.fill();
  ctx.restore();
}

// --- full scene -------------------------------------------------------------------

export function drawWorld(ctx, plane, world, rings, runway, time) {
  const cam = createCamera(plane);
  drawSkyAndSea(ctx, cam);
  const sunP = drawSun(ctx, cam);
  drawGlade(ctx, cam, sunP);
  drawClouds(ctx, cam, time);
  drawRidges(ctx, cam, world);
  drawSeaDetail(ctx, cam, world, time);
  drawTerrain(ctx, cam, world);
  drawRunway(ctx, cam, runway, time);
  drawRings(ctx, cam, rings || [], time);
  drawPlane(ctx, plane, time);
  // vignette
  const v = ctx.createRadialGradient(VIEW.W / 2, VIEW.H / 2, VIEW.H * 0.42, VIEW.W / 2, VIEW.H / 2, VIEW.H * 0.95);
  v.addColorStop(0, 'rgba(10,6,18,0)');
  v.addColorStop(1, 'rgba(10,6,18,0.42)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, VIEW.W, VIEW.H);
  return cam;
}

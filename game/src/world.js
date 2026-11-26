// world.js — the shared deterministic world of SKYPOST: island-chain coast terrain and wind.
// Physics, renderer and missions all read the ground through terrainHeight(), so what you
// see is exactly what the plane hits. Pure module: no DOM, no assets, no network.
//
// Exports:
//   createWorld(seed?) -> { seed, terrainHeight(x,z), windAt(x,y,z,t), surfaceInfo(x,z) }
//   terrainHeight(x,z) -> default world: meters above sea level (<= 0 means open sea)
//   windAt(x,y,z,t)    -> default world: wind vector [wx, wy, wz] in m/s
//   surfaceInfo(x,z)   -> default world: { h, moist, land } for renderer coloring
//
// The cliff-top runway strip (RUNWAY in config.js) is forced flat at RUNWAY.alt, the bay in
// front of the cliff stays at sea level, and open sea resumes beyond the cliff edge.

import { RUNWAY } from './config.js';
import { fbm } from './rng.js';

const PLATEAU = { x0: -170, x1: 170, z0: 5830, z1: 6695, drop: 55 }; // cliff top carrying the runway
const STRIP = { xHalf: 46, z0: 5860, z1: 6730 }; // hard-flat apron exactly around the runway

function ss(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

export function createWorld(seed = 20261126) {
  const s1 = (seed % 997) * 0.731, s2 = (seed % 991) * 0.377, s3 = (seed % 983) * 0.517;

  function baseHeight(x, z) {
    // Wandering coastline: open sea to the east (x > coast), land to the west.
    const coast = -30 + 150 * fbm(z * 0.0016 + s1 + 31.7, 7.3, 2) + 70 * fbm(z * 0.0052 + s2 + 11.1, 3.9, 2);
    const inland = ss(coast + 40, coast - 240, x); // 1 deep inland
    const centre = ss(200, 340, Math.abs(x));      // 1 near the course centreline
    const m = fbm(x * 0.0012 + s1 + 5.2, z * 0.0012 + s2 + 9.1, 5);
    const hills = fbm(x * 0.004 + s3 + 40.7, z * 0.004 + s1 + 17.3, 3);
    // The flight corridor near x=0 stays low so the rings always sit clear of the ground.
    let h = (Math.pow(m, 1.7) * 330 + hills * 24) * inland * (0.22 + 0.78 * centre);
    // Scattered islets in the sea lanes.
    const isl = fbm(x * 0.0016 + s3 + 77.7, z * 0.0016 + s2 + 51.3, 4);
    h = Math.max(h, ss(0.60, 0.68, isl) * (1 - inland) * (0.25 + 0.75 * centre) * 58);
    return h;
  }

  function terrainHeight(x, z) {
    let h = baseHeight(x, z);
    // Cliff-top plateau that carries the runway.
    const px = ss(PLATEAU.x0 - 90, PLATEAU.x0 + 60, x) * (1 - ss(PLATEAU.x1 - 60, PLATEAU.x1 + 90, x));
    const pz = ss(PLATEAU.z0 - 150, PLATEAU.z0 + 70, z) * (1 - ss(PLATEAU.z1, PLATEAU.z1 + PLATEAU.drop, z));
    const plateau = px * pz;
    if (plateau > 0) h = Math.max(h, plateau * RUNWAY.alt);
    // Hard-flat apron on the runway strip: touchdown logic needs solid ground at RUNWAY.alt.
    const sx = 1 - ss(STRIP.xHalf - 16, STRIP.xHalf + 16, Math.abs(x - RUNWAY.cx));
    const sz = ss(STRIP.z0 - 30, STRIP.z0 + 10, z) * (1 - ss(STRIP.z1 - 10, STRIP.z1 + 30, z));
    const flat = sx * sz;
    if (flat > 0) h = h * (1 - flat) + RUNWAY.alt * flat;
    // Bay in front of the cliff, so the runway visibly sits on a cliff over the sea.
    const bay = ss(5540, 5640, z) * (1 - ss(5740, 5830, z)) * (1 - ss(140, 220, Math.abs(x)));
    if (bay > 0) h = h * (1 - bay) + Math.min(h, 2) * bay;
    // Open sea again beyond the cliff edge.
    const off = ss(6740, 6790, z);
    if (off > 0) h = h * (1 - off) + Math.min(h, 0) * off;
    return h;
  }

  function surfaceInfo(x, z) {
    const h = terrainHeight(x, z);
    const moist = fbm(x * 0.003 + s2 + 100.2, z * 0.003 + s3 + 33.8, 3);
    return { h, moist, land: h > 0 };
  }

  function windAt(x, y, z, t) {
    const gust = Math.sin(t * 0.4 + z * 0.0035 + x * 0.002) * 0.6 + Math.sin(t * 0.17 + z * 0.0011 + 2.1) * 0.4;
    return [
      -1.6 - 1.4 * Math.sin(z * 0.0012 + 1.3 + s1) - gust * 0.8,        // crosswind
      0.9 * Math.sin(t * 0.6 + x * 0.008 + z * 0.002) * ss(60, 170, y),   // vertical gusts aloft
      2.4 + 1.8 * Math.sin(z * 0.0009 + 4.0) + gust * 1.2,                // along-course breeze
    ];
  }

  return { seed, terrainHeight, windAt, surfaceInfo };
}

const defaultWorld = createWorld();
export const terrainHeight = (x, z) => defaultWorld.terrainHeight(x, z);
export const windAt = (x, y, z, t) => defaultWorld.windAt(x, y, z, t);
export const surfaceInfo = (x, z) => defaultWorld.surfaceInfo(x, z);

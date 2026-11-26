// SKYPOST: 風紋の配達便 — shared constants: view, course layout, flight tuning, palette.

export const VIEW = {
  W: 1280, H: 720,
  FOCAL: 840,          // perspective focal length in pixels
  NEAR: 6,             // nearest terrain row distance (m)
  FAR: 4600,           // farthest terrain row distance (m)
  ROWS: 52,            // terrain rows
  COLS: 22,            // terrain columns per row
};

export const SEA_LEVEL = 0;

export const COURSE = { LENGTH: 6800, START_Z: 220 };

// The cliff-side runway at the end of the course. Heading 0 = course direction (+z).
export const RUNWAY = { cx: 0, halfW: 13, z0: 5920, z1: 6680, alt: 52, heading: 0 };

export const PLANE = {
  vStall: 33,          // stall speed (m/s)
  vMin: 30,            // idle / approach floor
  vCruise: 66,
  vMax: 97,            // full throttle level speed
  vBoost: 113,         // shift boost ceiling
  glide: 9,            // engine-out glide ratio: sink rate = airspeed / glide
  maxRoll: 1.05,       // rad of bank at full input
  maxPitch: 0.55,      // rad of pitch at full input
  gearH: 1.35,         // wheel height above ground contact
  fuelMax: 100,
  burnBase: 0.34,      // fuel per second at idle
  burnThrottle: 0.95,  // extra fuel per second at full throttle
  burnBoost: 0.9,
  ringRefuel: 6,
};

// Touchdown acceptance window on the runway.
export const LAND = { vMin: 34, vMax: 60, sinkMax: 4.2, yawMax: 0.22, rollMax: 0.2, base: 600 };

export const SCORE = {
  ringBase: 150,
  ringAcc: 150,        // accuracy bonus at dead-center pass
  timePar: 260,        // seconds par for the sortie
  timeBonusPerSec: 2,
  fuelBonus: 4,        // per fuel unit left at the win
  damagePenalty: 3,    // per damage percent at the win
};

// Low sun ahead-left of the course: drives sky, sea glade and cast shadows.
export const SUN = { az: -0.38, el: 0.15 };

export const PALETTE = {
  skyTop: '#241640',
  skyMid: '#5b2a63',
  skyLow: '#a34a6e',
  skyWarm: '#e0764f',
  horizon: '#ffd98a',
  sunCore: '#fff3d0',
  sunGlow: 'rgba(255,196,110,0.55)',
  fog: '#f2a266',
  seaDeep: '#46356e',
  seaGlade: '#ffcf8a',
  sand: '#e8c98f',
  grass: '#93a653',
  forest: '#4f7a48',
  rock: '#8a7472',
  snow: '#f2e8e0',
  asphalt: '#454b57',
  ringNext: '#7dffd4',
  ringIdle: '#ffd27a',
  ringDone: 'rgba(200,200,210,0.35)',
  hudPanel: 'rgba(8,12,24,0.74)',
  hudEdge: 'rgba(255,190,120,0.55)',
  hudAmber: '#ffd27a',
  hudCyan: '#7ef0ff',
  hudGreen: '#8dff9a',
  hudRed: '#ff6a5e',
  planeBody: '#f4ede0',
  planeAccent: '#d94f3d',
  planeDark: '#2a2f3a',
};

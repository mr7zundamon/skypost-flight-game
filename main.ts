// SKYPOST Flight Game - main.ts for make.fun entry
// Node 22, standard library only. Copies local game/ and screenshots/ into
// MAKEFUN_OUTPUT_DIR (or /output) and writes dossier.json using buildDossier.
// Requires 3-4 genuine PNG/JPEG screenshots; fails informatively if missing or invalid.

import { cpSync, existsSync, mkdirSync, readdirSync, lstatSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Validate screenshots: must have 3-4 PNG/JPEG/JPG files, each <= 262144 bytes
function validateScreenshots(screenshotsDir: string): void {
  if (!existsSync(screenshotsDir)) {
    throw new Error('Screenshots directory not found. 3-4 genuine PNG/JPEG screenshots required.');
  }

  const files = readdirSync(screenshotsDir);
  const imageFiles = files.filter((f) => {
    const ext = f.toLowerCase();
    return ext.endsWith('.png') || ext.endsWith('.jpg') || ext.endsWith('.jpeg');
  });

  if (imageFiles.length < 3 || imageFiles.length > 4) {
    throw new Error(`Expected 3-4 screenshots, found ${imageFiles.length}.`);
  }

  for (const file of imageFiles) {
    const filePath = join(screenshotsDir, file);
    const stat = lstatSync(filePath);
    if (stat.size > 262144) {
      throw new Error(`Screenshot "${file}" is ${stat.size} bytes, exceeds 262144 byte limit.`);
    }
  }
}

// Main
try {
  // Validate screenshots exist and are valid before claiming success
  const screenshotsDir = join(here, 'screenshots');
  validateScreenshots(screenshotsDir);

  // Create output directory
  mkdirSync(out, { recursive: true });

  // Copy game directory
  const gameDir = join(here, 'game');
  if (!existsSync(gameDir)) {
    throw new Error('game/ directory not found');
  }
  cpSync(gameDir, join(out, 'game'), { recursive: true });

  // Copy screenshots
  mkdirSync(join(out, 'screenshots'), { recursive: true });
  cpSync(screenshotsDir, join(out, 'screenshots'), { recursive: true });

  // Write dossier.json with exact caps from the starter
  writeFileSync(
    join(out, 'dossier.json'),
    buildDossier(out, {
      text_max_bytes: 163840,
      screenshots: { max: 4, max_bytes: 262144 },
      game_max_files: 993,
      game_max_bytes: 50331648,
      game_path_max_bytes: 1000,
    }),
  );

  console.log(`SKYPOST Flight Game entry created in ${out}`);
} catch (error) {
  if (error instanceof Error) {
    console.error('Error:', error.message);
  } else {
    console.error('Error:', String(error));
  }
  process.exit(1);
}

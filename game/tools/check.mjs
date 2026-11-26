#!/usr/bin/env node
// tools/check.mjs — syntax-check every src module (as ESM) and the generated
// bundle.js (as a classic script) with `node --check`.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const gameDir = path.join(here, '..');

const files = readdirSync(path.join(gameDir, 'src')).filter((f) => f.endsWith('.js'))
  .map((f) => path.join('src', f));
if (existsSync(path.join(gameDir, 'bundle.js'))) files.push('bundle.js');
files.push(path.join('tools', 'build.mjs'), path.join('tools', 'check.mjs'));

let fail = 0;
for (const rel of files) {
  const abs = path.join(gameDir, rel);
  const src = readFileSync(abs, 'utf8');
  const isModule = rel.endsWith('.mjs') || rel.startsWith('src' + path.sep) || rel.startsWith('test' + path.sep);
  const args = ['--check'];
  if (isModule) args.push('--input-type=module');
  const r = spawnSync(process.execPath, [...args], { input: src, encoding: 'utf8' });
  if (r.status === 0) console.log(`ok    ${rel}`);
  else { fail++; console.log(`FAIL  ${rel}\n${r.stderr}`); }
}
if (fail) { console.error(`check: ${fail} file(s) failed`); process.exit(1); }
console.log('check: all files parse');

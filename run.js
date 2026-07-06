#!/usr/bin/env node
'use strict';
// Stage 1 orchestrator: run each manager's bench (in Docker), then synthesize.
//   node run.js                # all managers, fast -> slow
//   node run.js apk pacman     # only these
//   node run.js --no-synth     # skip synthesis
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const OUT = path.join(ROOT, 'results');
const ORDER = ['apk', 'pacman', 'dnf', 'apt', 'nix', 'brew']; // fast -> slow

const args = process.argv.slice(2);
const noSynth = args.includes('--no-synth');
const want = args.filter((a) => !a.startsWith('--'));
const managers = want.length ? want : ORDER;

if (spawnSync('docker', ['version'], { stdio: 'ignore' }).status !== 0) {
  console.error('Docker is required but `docker version` failed. Is the daemon running?');
  process.exit(1);
}

fs.mkdirSync(OUT, { recursive: true });
const env = { ...process.env, OUT, TS_CMD: `node ${path.join(ROOT, 'lib', 'ts.js')}` };

for (const m of managers) {
  const script = path.join(ROOT, 'benches', `${m}.sh`);
  if (!fs.existsSync(script)) { console.error(`! no bench for "${m}", skipping`); continue; }
  console.log(`\n=== ${m} ===`);
  const r = spawnSync('bash', [script], { stdio: 'inherit', env });
  if (r.status !== 0) console.error(`! ${m} bench exited ${r.status} (see logs in results/)`);
}

if (!noSynth) {
  console.log('\n=== synthesis ===');
  spawnSync('node', [path.join(ROOT, 'synthesize.js')], { stdio: 'inherit' });
}

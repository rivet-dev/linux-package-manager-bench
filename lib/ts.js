#!/usr/bin/env node
// Minimal `ts -i`: prefix each stdin line with seconds elapsed since the previous
// line. Dependency-free stand-in for moreutils `ts -i` so the bench needs no extra
// system packages. Output format per line: "  <delta>  <text>".
const rl = require('readline').createInterface({ input: process.stdin });
let last = process.hrtime.bigint();
rl.on('line', (raw) => {
  const now = process.hrtime.bigint();
  const delta = Number(now - last) / 1e9;
  last = now;
  const text = raw.replace(/\r/g, '');
  process.stdout.write(delta.toFixed(3).padStart(8) + '  ' + text + '\n');
});

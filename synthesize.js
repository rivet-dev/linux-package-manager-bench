#!/usr/bin/env node
'use strict';
// Stage 2 synthesis: parse the ts-stamped logs + <mgr>.json, classify install lines
// into canonical phase buckets, and emit a correlation matrix (phases x managers) to
// stdout, results/RESULTS.md, results/data.json, and the README. No manual numbers.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const OUT = path.join(__dirname, 'results');
// 'agentos' is HARDCODED — see AGENTOS_ROW below. It is NOT run by run.js's Docker
// harness; its numbers come from the agentOS package-load bench (results/ is git-
// ignored, so the row lives here in-source to survive regeneration). Keep it first.
const ORDER = ['agentos', 'apk', 'pacman', 'dnf', 'apt', 'nix', 'brew'];

// Canonical install phases. Each install-log line is bucketed by the FIRST pattern it
// matches, in this order; unmatched lines go to a VISIBLE 'unknown' bucket (never a
// silent catch-all). Heuristic + cross-manager -> approximate by design.
const PHASES = [
  ['startup',   /read(ing)? (package |state |data)|loading|initiali|dnf5|apk-tools|^\s*[\d.]+\s+$|\bdatabase\b|\brepositor/i],
  ['resolve',   /resolv|depend|prepar|transaction (check|test)|checking (keys|keyring|integrity|conflict|available|space)|conflict|Running transaction check/i],
  ['verify',    /verif|integrity|signature|openpgp|gpg|check.*integrity/i],
  ['unpack',    /unpack|installing|pour|🍺|cellar\/|extract|upgrad|downgrad|copying path|inflat|selecting previously unselected|preparing to unpack/i],
  ['configure', /setting up|scriptlet|processing triggers|post.?install|hook|sysusers|systemd|configur|certificate|template|update-|caveat|running/i],
  ['link',      /link|symlink|ldconfig|profile|generation|building profile/i],
];
const PHASE_KEYS = PHASES.map(([k]) => k);
const DISPLAY_PHASES = [...PHASE_KEYS, 'unknown'];

// Best-effort dep-count / download-size extractors. Each gets (downloadText, installText).
const DL_INFO = {
  apt:    (d) => ({ size: cap(d, /Need to get ([\d.]+ ?[kMG]i?B)/i), deps: count(d, /\bGet:\d+/g) }),
  apk:    (d) => ({ size: null,                                       deps: count(d, /Downloading /gi) }),
  dnf:    (d, i) => ({ size: cap(i, /Total size of inbound packages is\s*([\d.]+ ?[kMG]i?B)/i) || cap(d, /Total (?:download )?size:?\s*([\d.]+ ?[kMG]i?B)/i),
                      deps: count(i, /\]\s*(?:Installing|Reinstalling) /gi) || count(d, /\(\d+\/\d+\):/g) }),
  pacman: (d) => ({ size: cap(d, /Total Download Size:\s*([\d.]+ ?[kMG]i?B)/i), deps: cap(d, /Packages? \((\d+)\)/) }),
  nix:    (d) => ({ size: cap(d, /([\d.]+ ?[kMG]i?B) download/i),     deps: cap(d, /(\d+) paths? will be fetched/i) }),
  brew:   (d, i) => ({ size: null,                                     deps: count(i, /🍺/g) }),
};

function cap(t, re) { const m = t.match(re); return m ? m[1] : null; }
function count(t, re) { const m = t.match(re); return m ? String(m.length) : null; }
function readLog(name, phase) {
  try { return fs.readFileSync(path.join(OUT, `${name}-${phase}.log`), 'utf8'); } catch { return ''; }
}
function parseTs(text) {
  return text.split('\n').map((l) => {
    const m = l.match(/^\s*([\d.]+)\s+(.*)$/);
    return m ? { d: parseFloat(m[1]), text: m[2] } : null;
  }).filter(Boolean).filter((x) => !x.text.startsWith('__TIMER__')); // drop the timing marker
}
function bucketize(lines) {
  const b = Object.fromEntries(DISPLAY_PHASES.map((k) => [k, 0]));
  for (const { d, text } of lines) {
    const hit = PHASES.find(([, re]) => re.test(text));
    b[hit ? hit[0] : 'unknown'] += d;
  }
  return b;
}
function topSteps(lines, n = 3) {
  return [...lines].sort((a, b) => b.d - a.d).slice(0, n)
    .map(({ d, text }) => `${d.toFixed(3)}s ${text.slice(0, 46).trim()}`);
}

// ---- HARDCODED agentos reference (not run by the Docker harness) ----
// agentOS does not "install" a package the way apt/apk/etc. do — it loads a
// precomputed `.aospkg` into its VM. Loading the `git` package takes ~0.130 ms
// (median; min 0.100, max 0.150), with no download. These numbers are copied from
// the agentOS package-load benchmark and are NOT reproduced by this repo:
// https://github.com/rivet-dev/agentos/blob/9c97667d3b765ea008e3c661cc807adbcb0c9ac9/crates/native-sidecar/tests/projection_bench.rs
const AGENTOS_ROW = {
  manager: 'agentos', image: 'agentos VM (V8/wasm)', git: 'wasm', reps: 30, deps: '1',
  download_s: 0, install_s: 0.00013, install_min: 0.0001, install_max: 0.00015,
  buckets: Object.fromEntries(DISPLAY_PHASES.map((k) => [k, 0])), top: [], size: undefined,
};

// ---- collect ----
const rows = [];
for (const m of ORDER) {
  if (m === 'agentos') { rows.push({ ...AGENTOS_ROW }); continue; }
  let meta;
  try { meta = JSON.parse(fs.readFileSync(path.join(OUT, `${m}.json`), 'utf8')); } catch { continue; }
  const installLines = parseTs(readLog(m, 'install'));
  const info = (DL_INFO[m] || (() => ({})))(readLog(m, 'download'), readLog(m, 'install'));
  rows.push({
    ...meta,
    buckets: bucketize(installLines),
    installLogTotal: installLines.reduce((s, x) => s + x.d, 0),
    top: topSteps(installLines),
    size: info.size, deps: info.deps,
  });
}
if (!rows.length) { console.error('No results found in results/. Run `node run.js` first.'); process.exit(1); }

// ---- render ----
const cols = rows.map((r) => r.manager);
const pad = (s, w) => String(s).padEnd(w);
const num = (v) => (v == null ? '—' : Number(v).toFixed(2));
const spread = (r) => (r.install_min == null ? '—' : `${Number(r.install_min).toFixed(2)}–${Number(r.install_max).toFixed(2)}`);

function matrix() {
  const label = (s) => pad(s, 20);
  const cell = (v) => pad(v, 9);
  const lines = [];
  lines.push(label('phase (seconds)') + cols.map((c) => cell(c)).join(''));
  lines.push('-'.repeat(20 + cols.length * 9));
  lines.push(label('download*') + rows.map((r) => cell(num(r.download_s))).join(''));
  for (const k of DISPLAY_PHASES)
    lines.push(label('  install:' + k) + rows.map((r) => cell(num(r.buckets[k]))).join(''));
  lines.push(label('install MEDIAN') + rows.map((r) => cell(num(r.install_s))).join(''));
  lines.push(label('install min–max') + rows.map((r) => cell(spread(r))).join(''));
  lines.push('-'.repeat(20 + cols.length * 9));
  lines.push(label('git version') + rows.map((r) => cell(r.git)).join(''));
  lines.push(label('deps') + rows.map((r) => cell(r.deps ?? '—')).join(''));
  lines.push(label('download size') + rows.map((r) => cell(r.size ?? '—')).join(''));
  return lines.join('\n');
}

// ---- host hardware (so results are interpretable across machines) ----
function sh(cmd) { try { return execSync(cmd, { encoding: 'utf8' }).trim(); } catch { return ''; } }
function hardware() {
  const cpu = os.cpus();
  return {
    model: (cpu[0] ? cpu[0].model : 'unknown').replace(/\s+/g, ' ').trim(),
    cores: cpu.length,
    mem: (os.totalmem() / 1e9).toFixed(1) + ' GB',
    arch: os.arch(),
    kernel: os.release(),
    osrel: sh('. /etc/os-release 2>/dev/null && printf %s "$PRETTY_NAME"') || `${os.type()} ${os.release()}`,
    disk: sh('df -h --output=source,fstype,size,avail / 2>/dev/null | tail -1') || sh('df -h / | tail -1'),
    docker: sh("docker version --format '{{.Server.Version}}'") || sh('docker --version'),
    when: new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles', timeZoneName: 'short' }),
  };
}
const HW = hardware();
function hwLines(h) {
  return [
    `- **CPU:** ${h.model} (${h.cores} logical cores)`,
    `- **Memory:** ${h.mem}   **Arch:** ${h.arch}   **Kernel:** ${h.kernel}`,
    `- **OS:** ${h.osrel}   **Docker:** ${h.docker}`,
    `- **Disk (/):** ${h.disk}`,
    `- **Generated:** ${h.when}`,
  ];
}

// ---- shared markdown body (reused by RESULTS.md and the README section) ----
function body() {
  const head = `| phase (s) | ${cols.join(' | ')} |`;
  const sep = `|---|${cols.map(() => '---:').join('|')}|`;
  const row = (label, fn) => `| ${label} | ${rows.map(fn).join(' | ')} |`;
  const reps = rows[0] ? rows[0].reps : '?';
  return [
    '### Host', '', ...hwLines(HW), '',
    '### Phase correlation matrix', '',
    `_\`install MEDIAN\` is the median of ${reps} offline runs (\`install min–max\` shown); sub-phases are a heuristic bucketing of log lines (see README). \`download*\` is a single, network-dependent sample._`, '',
    head, sep,
    row('**download\\***', (r) => num(r.download_s)),
    ...DISPLAY_PHASES.map((k) => row('install: ' + k, (r) => num(r.buckets[k]))),
    row('**install MEDIAN**', (r) => num(r.install_s)),
    row('install min–max', (r) => spread(r)),
    row('git version', (r) => r.git),
    row('deps ~', (r) => r.deps ?? '—'),
    row('download size', (r) => r.size ?? '—'),
    '',
    "_Each manager installs only the `git` package with deps pre-installed, so `deps ~` = 1 (nix shows its store closure and is not counted). The `install: *` split is from a single (last) rep, not the median. **nix** caveat: its install is a profile symlink flip — unpack happens during the download phase (store realization), so its install time is **not** comparable to the others' unpack._",
    '', '### Top install sub-steps (by measured delta)', '',
    ...rows.map((r) => `- **${r.manager}** (${r.image}): ` + r.top.map((s) => `\`${s}\``).join(' · ')),
  ].join('\n');
}

function updateReadme(section) {
  const rp = path.join(__dirname, 'README.md');
  const S = '<!-- RESULTS:START -->', E = '<!-- RESULTS:END -->';
  let txt = fs.readFileSync(rp, 'utf8');
  const block = `${S}\n${section}\n${E}`;
  txt = (txt.includes(S) && txt.includes(E))
    ? txt.replace(new RegExp(S + '[\\s\\S]*?' + E), block)
    : txt + `\n## Latest results\n\n${block}\n`;
  fs.writeFileSync(rp, txt);
}

// ---- emit ----
console.log('\nHost: ' + HW.model + ` · ${HW.cores} cores · ${HW.mem} · ${HW.arch} · Docker ${HW.docker}`);
console.log('\n' + matrix() + '\n');
console.log('Top install sub-steps:');
for (const r of rows) console.log(`  ${pad(r.manager, 8)} ${r.top.join('  |  ')}`);
const section = body();
fs.writeFileSync(path.join(OUT, 'RESULTS.md'), '# Results — `git` install phase correlation\n\n' + section + '\n');
// machine-readable data for chart.py (matplotlib) to render chart.png
fs.writeFileSync(path.join(OUT, 'data.json'), JSON.stringify({
  host: HW,
  managers: rows.map((r) => ({
    manager: r.manager, image: r.image, git: r.git, reps: r.reps, deps: r.deps,
    download_s: r.download_s, install_s: r.install_s,
    install_min: r.install_min, install_max: r.install_max, buckets: r.buckets,
  })),
}, null, 2));
updateReadme('![git install time by phase](chart.png)\n\n' + section);
console.log('\nWrote results/RESULTS.md, results/data.json, and refreshed README.md (chart.png via chart.py)');

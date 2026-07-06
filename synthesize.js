#!/usr/bin/env node
'use strict';
// Stage 2 synthesis: parse the ts-stamped logs + <mgr>.json, classify install lines
// into canonical phase buckets, and emit a correlation matrix (phases x managers) to
// stdout and results/RESULTS.md. Pure regex over the logs -- no manual numbers.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const OUT = path.join(__dirname, 'results');
const ORDER = ['apk', 'pacman', 'dnf', 'apt', 'nix', 'brew'];

// Canonical install phases. Each install-log line is bucketed by the FIRST pattern it
// matches, in this order. Heuristic + cross-manager -> approximate by design.
const PHASES = [
  ['startup',   /read(ing)? (package |state |data)|loading|initiali|dnf5|apk-tools|^\s*[\d.]+\s+$|db|repositor/i],
  ['resolve',   /resolv|depend|prepar|transaction (check|test)|checking (keys|integrity|conflict|available|space)|conflict|Running transaction check/i],
  ['verify',    /verif|integrity|signature|openpgp|gpg|check.*integrity/i],
  ['unpack',    /unpack|installing|pour|🍺|cellar\/|extract|upgrad|downgrad|copying path|inflat/i],
  ['configure', /setting up|scriptlet|processing triggers|post.?install|hook|sysusers|systemd|configur|certificate|template|update-|caveat|running/i],
  ['link',      /link|symlink|ldconfig|profile|generation|building profile/i],
];

// Best-effort dep-count / download-size extractors over the DOWNLOAD log text.
const DL_INFO = {
  apt:    (t) => ({ size: cap(t, /Need to get ([\d.]+ ?[kMG]i?B)/i), deps: count(t, /\bGet:\d+/g) }),
  apk:    (t) => ({ size: null,                                       deps: count(t, /Downloading /gi) }),
  dnf:    (t) => ({ size: cap(t, /Total (?:download )?size:\s*([\d.]+ ?[kMG]i?B)/i), deps: count(t, /\(\d+\/\d+\):/g) }),
  pacman: (t) => ({ size: cap(t, /Total Download Size:\s*([\d.]+ ?[kMG]i?B)/i), deps: cap(t, /Packages? \((\d+)\)/) }),
  nix:    (t) => ({ size: cap(t, /([\d.]+ ?[kMG]i?B) download/i),     deps: cap(t, /(\d+) paths? will be fetched/i) }),
  brew:   (t) => ({ size: null,                                       deps: count(t, /Downloading |Already downloaded/gi) }),
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
  }).filter(Boolean);
}
function bucketize(lines) {
  const b = Object.fromEntries(PHASES.map(([k]) => [k, 0]));
  for (const { d, text } of lines) {
    const hit = PHASES.find(([, re]) => re.test(text));
    b[hit ? hit[0] : 'configure'] += d;
  }
  return b;
}
function topSteps(lines, n = 3) {
  return [...lines].sort((a, b) => b.d - a.d).slice(0, n)
    .map(({ d, text }) => `${d.toFixed(3)}s ${text.slice(0, 46).trim()}`);
}

// ---- collect ----
const rows = [];
for (const m of ORDER) {
  let meta;
  try { meta = JSON.parse(fs.readFileSync(path.join(OUT, `${m}.json`), 'utf8')); } catch { continue; }
  const installLines = parseTs(readLog(m, 'install'));
  const info = (DL_INFO[m] || (() => ({})))(readLog(m, 'download'));
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

function matrix() {
  const label = (s) => pad(s, 20);
  const cell = (v) => pad(v, 9);
  const lines = [];
  lines.push(label('phase (seconds)') + cols.map((c) => cell(c)).join(''));
  lines.push('-'.repeat(20 + cols.length * 9));
  lines.push(label('download') + rows.map((r) => cell(num(r.download_s))).join(''));
  for (const [k] of PHASES)
    lines.push(label('  install:' + k) + rows.map((r) => cell(num(r.buckets[k]))).join(''));
  lines.push(label('install TOTAL') + rows.map((r) => cell(num(r.install_s))).join(''));
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
  return [
    '### Host', '', ...hwLines(HW), '',
    '### Phase correlation matrix', '',
    '_Install sub-phases are a heuristic bucketing of log lines (see README); the',
    '`download` and `install TOTAL` rows are ground truth._', '',
    head, sep,
    row('**download**', (r) => num(r.download_s)),
    ...PHASES.map(([k]) => row('install: ' + k, (r) => num(r.buckets[k]))),
    row('**install TOTAL**', (r) => num(r.install_s)),
    row('git version', (r) => r.git),
    row('deps', (r) => r.deps ?? '—'),
    row('download size', (r) => r.size ?? '—'),
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

// ---- chart: stacked bars of INSTALL time by phase (download excluded) ----
// Validated 6-slot categorical palette (see dataviz skill, both modes pass).
const PHASE_KEYS = PHASES.map(([k]) => k);
const PHASE_COLORS = {
  light: ['#2a78d6', '#1baf7a', '#eda100', '#008300', '#4a3aa7', '#e34948'],
  dark:  ['#3987e5', '#199e70', '#c98500', '#008300', '#9085e9', '#e66767'],
};

function chartHtml() {
  const data = {
    labels: rows.map((r) => r.manager),
    phases: PHASE_KEYS,
    values: PHASE_KEYS.map((k) => rows.map((r) => +r.buckets[k].toFixed(3))),
    totals: rows.map((r) => +r.install_s.toFixed(3)),
    light: PHASE_COLORS.light, dark: PHASE_COLORS.dark,
  };
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>git install time by phase</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"></script>
<style>
 :root{color-scheme:light dark}
 body{margin:0;padding:24px;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#f9f9f7;color:#0b0b0b}
 .card{max-width:880px;margin:0 auto;background:#fcfcfb;border:1px solid rgba(11,11,11,.10);border-radius:12px;padding:20px 22px}
 h1{font-size:18px;margin:0 0 2px} p.sub{margin:0 0 16px;color:#52514e;font-size:13px}
 @media (prefers-color-scheme:dark){
  body{background:#0d0d0d;color:#fff} .card{background:#1a1a19;border-color:rgba(255,255,255,.10)} p.sub{color:#c3c2b7}
 }
</style></head>
<body><div class="card">
<h1>git install time by phase</h1>
<p class="sub">Offline install only (download excluded) &middot; seconds &middot; lower is faster</p>
<canvas id="c" height="260"></canvas>
</div>
<script>
const D = ${JSON.stringify(data)};
function render(){
 const dark = matchMedia('(prefers-color-scheme: dark)').matches;
 const pal = dark ? D.dark : D.light, surface = dark ? '#1a1a19' : '#fcfcfb';
 const ink = dark ? '#c3c2b7' : '#52514e', grid = dark ? '#2c2c2a' : '#e1e0d9';
 const ds = D.phases.map((p,i)=>({label:p,data:D.values[i],backgroundColor:pal[i],borderColor:surface,borderWidth:2,borderRadius:3}));
 if(window._c) window._c.destroy();
 window._c = new Chart(document.getElementById('c'),{type:'bar',data:{labels:D.labels,datasets:ds},
  options:{indexAxis:'y',responsive:true,animation:false,
   scales:{x:{stacked:true,title:{display:true,text:'install time (s)',color:ink},ticks:{color:ink},grid:{color:grid}},
           y:{stacked:true,ticks:{color:ink},grid:{display:false}}},
   plugins:{legend:{position:'top',labels:{color:ink,boxWidth:12,boxHeight:12,usePointStyle:true,pointStyle:'rect'}},
            tooltip:{callbacks:{footer:(it)=>'total '+D.totals[it[0].dataIndex]+'s'}}}}});
}
render();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change',render);
</script>
</body></html>`;
}

function chartSvg() {
  const W = 760, rowH = 26, gap = 12, topY = 86, leftLabel = 76, rightPad = 56;
  const plotW = W - leftLabel - rightPad;
  const H = topY + rows.length * (rowH + gap) + 12;
  const max = Math.max(...rows.map((r) => r.install_s), 0.001);
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  let s = '';
  let lx = leftLabel;
  PHASE_KEYS.forEach((p, i) => {
    s += `<rect x="${lx}" y="43" width="11" height="11" rx="2" class="p${i}"/>`;
    s += `<text x="${lx + 16}" y="52" class="t-sec lbl">${esc(p)}</text>`;
    lx += 24 + p.length * 7.2;
  });
  rows.forEach((r, ri) => {
    const y = topY + ri * (rowH + gap);
    s += `<text x="${leftLabel - 8}" y="${(y + rowH * 0.7).toFixed(0)}" class="t-sec name" text-anchor="end">${esc(r.manager)}</text>`;
    let cx = leftLabel;
    PHASE_KEYS.forEach((p, i) => {
      const w = (r.buckets[p] / max) * plotW;
      if (w > 0.5) s += `<rect x="${cx.toFixed(1)}" y="${y}" width="${Math.max(1, w - 2).toFixed(1)}" height="${rowH}" rx="2" class="p${i}"><title>${esc(r.manager)} · ${esc(p)}: ${r.buckets[p].toFixed(2)}s</title></rect>`;
      cx += w;
    });
    s += `<text x="${(cx + 6).toFixed(1)}" y="${(y + rowH * 0.7).toFixed(0)}" class="t-pri tot">${r.install_s.toFixed(2)}s</text>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="system-ui,-apple-system,'Segoe UI',sans-serif">
<style>
 .bg{fill:#fcfcfb;stroke:rgba(11,11,11,.10)} .t-pri{fill:#0b0b0b}.t-sec{fill:#52514e}
 .title{font-size:15px;font-weight:600}.sub{font-size:11px}.lbl{font-size:11px}.name{font-size:12px}.tot{font-size:11px;font-weight:600}
 .p0{fill:#2a78d6}.p1{fill:#1baf7a}.p2{fill:#eda100}.p3{fill:#008300}.p4{fill:#4a3aa7}.p5{fill:#e34948}
 @media (prefers-color-scheme:dark){
  .bg{fill:#1a1a19;stroke:rgba(255,255,255,.10)} .t-pri{fill:#fff}.t-sec{fill:#c3c2b7}
  .p0{fill:#3987e5}.p1{fill:#199e70}.p2{fill:#c98500}.p3{fill:#008300}.p4{fill:#9085e9}.p5{fill:#e66767}
 }
</style>
<rect class="bg" x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="12"/>
<text x="16" y="24" class="t-pri title">git install time by phase</text>
<text x="16" y="40" class="t-sec sub">offline install only (download excluded) · seconds · lower is faster</text>
${s}
</svg>`;
}

// ---- emit ----
console.log('\nHost: ' + HW.model + ` · ${HW.cores} cores · ${HW.mem} · ${HW.arch} · Docker ${HW.docker}`);
console.log('\n' + matrix() + '\n');
console.log('Top install sub-steps:');
for (const r of rows) console.log(`  ${pad(r.manager, 8)} ${r.top.join('  |  ')}`);
const section = body();
fs.writeFileSync(path.join(OUT, 'RESULTS.md'), '# Results — `git` install phase correlation\n\n' + section + '\n');
fs.writeFileSync(path.join(__dirname, 'chart.html'), chartHtml());
fs.writeFileSync(path.join(__dirname, 'chart.svg'), chartSvg());
const chartEmbed = '![git install time by phase](chart.svg)\n\n_Interactive version: [`chart.html`](chart.html) — hover for per-phase values._';
updateReadme(chartEmbed + '\n\n' + section);
console.log('\nWrote results/RESULTS.md, chart.html, chart.svg, and refreshed README.md');

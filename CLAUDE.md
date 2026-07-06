# Working instructions for this repo

## Keep it reproducible

- Benchmark prerequisites are Docker + Node only (the `ts` timestamper is the bundled
  `lib/ts.js`). The chart step additionally needs Python 3 + matplotlib.
- Bench commands live in `benches/<mgr>.sh`; the timing/harness logic is shared in
  `benches/_lib.sh`. Keep each bench file tiny (just the setup/download/install/verify
  commands).
- `synthesize.js` regenerates the results and writes them into `results/RESULTS.md`,
  `results/data.json`, and the README's `<!-- RESULTS -->` block automatically — never
  hand-edit that block. `chart.py` renders `results/data.json` into `chart.png`.

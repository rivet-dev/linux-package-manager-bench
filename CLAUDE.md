# Working instructions for this repo

## Keep it reproducible

- No new runtime dependencies. The only prerequisites are Docker + Node (the `ts`
  timestamper is the bundled `lib/ts.js`).
- Bench commands live in `benches/<mgr>.sh`; the timing/harness logic is shared in
  `benches/_lib.sh`. Keep each bench file tiny (just the setup/download/install/verify
  commands).
- `synthesize.js` regenerates the results and writes them into `results/RESULTS.md` and
  the README's `<!-- RESULTS -->` block automatically — never hand-edit that block.

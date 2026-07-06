# Working instructions for this repo

## Always refresh the README after a benchmark run

Whenever you run the benchmark (`node run.js`, or any subset, or a bare
`node synthesize.js`), you MUST update `README.md` with the new results and commit it.

- `synthesize.js` **auto-writes** the results into `README.md` between the
  `<!-- RESULTS:START -->` / `<!-- RESULTS:END -->` markers, and into `results/RESULTS.md`.
- After a run, always `git add README.md && git commit` so the README's **Latest results**
  section reflects the most recent numbers and the **host hardware** they came from.
- If you ran only a subset of managers, say so in the commit — the matrix only shows the
  managers that have results in `results/`.
- Never hand-edit the marked results block; regenerate it with `node synthesize.js`.

## Keep it reproducible

- No new runtime dependencies. The only prerequisites are Docker + Node (the `ts`
  timestamper is the bundled `lib/ts.js`).
- Bench commands live in `benches/<mgr>.sh`; the timing/harness logic is shared in
  `benches/_lib.sh`. Keep each bench file tiny (just the setup/download/install/verify
  commands).

# linux-package-manager-bench

How long does it take to **install `git`** with each major Linux package manager —
and where does that time actually go? This benchmarks six managers in throwaway Docker
containers, splitting each run into two timed phases:

1. **Download** — fetch `git` + all dependencies into the local cache/store (online).
2. **Install (offline)** — the network is physically disconnected, then `git` is
   installed *from cache*. This isolates the real install work (unpack, scriptlets,
   linking) from network speed.

Every line of both phases is timestamped with the elapsed time since the previous line,
so the install can be broken down step by step.

| Manager | Distro / image | Cache-download command | Offline-install command |
|---|---|---|---|
| **apk** | `alpine` | `apk fetch --recursive git` | `apk add --no-network *.apk` |
| **pacman** | `archlinux` | `pacman -Sw git` | `pacman -S git` |
| **dnf** | `fedora` | `dnf download --resolve git` | `dnf install --cacheonly *.rpm` |
| **apt** | `debian:12-slim` | `apt-get install --download-only git` | `apt-get install git` |
| **nix** | `nixos/nix` | `nix build nixpkgs#git` | `nix profile install nixpkgs#git` |
| **brew** | `homebrew/brew` | `brew fetch --deps git` | `brew install git` |

## Run it

```bash
node run.js              # all managers (fast -> slow), then synthesize
node run.js apk pacman   # just a subset
node synthesize.js       # re-render the tables from existing logs
```

**Prerequisites:** Docker (daemon running) and Node.js 18+. Nothing else — the `ts`
timestamper is a tiny bundled script (`lib/ts.js`), no `moreutils` needed.

Output lands in `results/` (git-ignored): per-manager `*-download.log`,
`*-install.log`, `*.json`, and the generated **`results/RESULTS.md`**.

## How it works (two stages)

- **`run.js`** (stage 1) — for each manager, calls `benches/<mgr>.sh`, which uses the
  shared harness `benches/_lib.sh` to: start a container, do untimed **setup** (pull repo
  metadata, clean state), time the **download**, `docker network disconnect` the
  container, time the **offline install** (piping every line through `lib/ts.js`), verify
  `git --version`, and write `<mgr>.json`.
- **`synthesize.js`** (stage 2) — parses the ts-stamped logs with regex, classifies each
  install line into a canonical phase, and prints a **phase × manager correlation matrix**
  (also written to `results/RESULTS.md`).

## Reading the matrix

Rows are phases (seconds), columns are managers. `download` and `install TOTAL` are
wall-clock ground truth. The `install: *` sub-rows bucket each timestamped install line
into canonical phases:

| bucket | what lands here |
|---|---|
| `startup` | package-manager start, reading state/db |
| `resolve` | dependency resolution, transaction prepare/check, conflict/key checks |
| `verify` | package integrity / signature / GPG verification |
| `unpack` | unpacking / pouring / extracting / installing file payloads |
| `configure` | scriptlets, triggers, post-install hooks, sysusers, cert stores |
| `link` | symlinks, ldconfig, profile generation |

These sub-buckets are a **heuristic** classification of human-readable log lines and vary
with tool versions — treat them as directional. The two totals are exact.

## Caveats

- Not apples-to-apples: `git` version, dependency count, and base-image baseline differ
  per manager (e.g. Arch/Alpine ship more in their base, so fewer deps are pulled).
- Install-phase reads come from the **page cache** (files were written seconds earlier),
  so they reflect warm-RAM reads, not cold disk.
- **brew** setup clones the full `homebrew-core` tap (slow — minutes); this is untimed
  setup and pins installs to the local tap for determinism.
- Re-running is destructive to same-named containers (`<mgr>-bench`), which are force
  removed at start and on teardown.

## License

MIT — see [LICENSE](LICENSE).

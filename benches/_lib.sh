# Shared bench harness. Sourced by each benches/<mgr>.sh.
# Provides bench(): spin up a container, time DOWNLOAD, disconnect network,
# time OFFLINE INSTALL, timestamp every line, verify git, emit <mgr>.json.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
: "${OUT:?set OUT to the results dir}"
TS_CMD="${TS_CMD:-node $ROOT/lib/ts.js}"

now()   { date +%s.%N; }
delta() { awk -v a="$1" -v b="$2" 'BEGIN{printf "%.3f", b-a}'; }

# bench NAME IMAGE SETUP_SH DOWNLOAD_SH INSTALL_SH VERIFY_SH
bench() {
  local NAME="$1" IMAGE="$2" SETUP="$3" DL="$4" INST="$5" VERIFY="$6"
  local CID="${NAME}-bench"

  echo ">>> [$NAME] image=$IMAGE"
  docker rm -f "$CID" >/dev/null 2>&1 || true
  docker run -d --name "$CID" "$IMAGE" sleep infinity >/dev/null

  # --- setup (UNTIMED): pull metadata, clean state ---
  echo "    setup (untimed)..."
  docker exec "$CID" sh -c "$SETUP" >/dev/null 2>&1 || true

  # --- DOWNLOAD (timed): fetch git + deps into cache, no install ---
  echo "    download..."
  local t0 t1; t0=$(now)
  docker exec "$CID" sh -c "$DL" 2>&1 | $TS_CMD > "$OUT/$NAME-download.log" || true
  t1=$(now)

  # --- INSTALL (timed, OFFLINE): cut the network, install from cache ---
  echo "    install (offline)..."
  docker network disconnect bridge "$CID" >/dev/null 2>&1 || true
  local t2 t3; t2=$(now)
  docker exec "$CID" sh -c "$INST" 2>&1 | $TS_CMD > "$OUT/$NAME-install.log" || true
  t3=$(now)

  # --- verify + teardown ---
  local gitver
  gitver=$(docker exec "$CID" sh -c "$VERIFY" 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
  docker rm -f "$CID" >/dev/null 2>&1 || true

  local dl inst; dl=$(delta "$t0" "$t1"); inst=$(delta "$t2" "$t3")
  printf '{"manager":"%s","image":"%s","git":"%s","download_s":%s,"install_s":%s}\n' \
    "$NAME" "$IMAGE" "${gitver:-unknown}" "$dl" "$inst" > "$OUT/$NAME.json"
  echo "    done: git ${gitver:-?}  download=${dl}s  install=${inst}s"
}

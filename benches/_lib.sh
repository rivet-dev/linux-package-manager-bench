# Shared bench harness. Sourced by each benches/<mgr>.sh.
# Provides bench(): untimed SETUP, one timed DOWNLOAD, then commit the warm-cache
# container to an image and run the OFFLINE INSTALL N times, each in a fresh
# `--network none` container from that image. Timing is host wall-clock minus a
# measured `docker exec` baseline (so exec/startup overhead is excluded); the
# install exit code is checked (fail-loud); install_s is the MEDIAN of the reps.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
: "${OUT:?set OUT to the results dir}"
TS_CMD="${TS_CMD:-node $ROOT/lib/ts.js}"
REPS="${REPS:-5}"

now() { date +%s.%N; }
sub() { awk -v a="$1" -v b="$2" 'BEGIN{d=b-a; if(d<0)d=0; printf "%.3f\n", d}'; }  # host ts have %N precision; newline so callers can sort/min
median() { sort -n | awk '{a[NR]=$1} END{ if(NR==0){print 0} else if(NR%2){printf "%.3f",a[(NR+1)/2]} else {printf "%.3f",(a[NR/2]+a[NR/2+1])/2} }'; }

# baseline: min wall-time of a no-op `docker exec CID true` over 3 tries (the fixed
# exec/attach overhead we subtract from timed commands).
exec_baseline() {
  local cid="$1" i t0 t1
  for i in 1 2 3; do t0=$(now); docker exec "$cid" true >/dev/null 2>&1; t1=$(now); sub "$t0" "$t1"; done | sort -n | head -1
}

# timed_exec CID CMD LOGFILE BASELINE -> echoes "<elapsed_seconds> <exit_code>"
# Host wall-clock around the docker exec, minus BASELINE. Every line ts-stamped to LOG.
timed_exec() {
  local cid="$1" cmd="$2" log="$3" base="${4:-0}" t0 t1 rc
  t0=$(now)
  docker exec "$cid" sh -c "$cmd" 2>&1 | $TS_CMD > "$log"
  rc=${PIPESTATUS[0]}
  t1=$(now)
  echo "$(sub "$t0" "$t1" | awk -v base="$base" '{d=$1-base; if(d<0)d=0; printf "%.3f", d}') $rc"
}

# bench NAME IMAGE SETUP_SH DOWNLOAD_SH INSTALL_SH VERIFY_SH
bench() {
  local NAME="$1" IMAGE="$2" SETUP="$3" DL="$4" INST="$5" VERIFY="$6"
  local CID="${NAME}-bench" IMG="${NAME}-bench-cached"

  echo ">>> [$NAME] image=$IMAGE  reps=$REPS"
  docker rm -f "$CID" >/dev/null 2>&1 || true
  docker run -d --name "$CID" "$IMAGE" sleep infinity >/dev/null
  local digest; digest=$(docker image inspect --format '{{if .RepoDigests}}{{index .RepoDigests 0}}{{else}}{{.Id}}{{end}}' "$IMAGE" 2>/dev/null || echo "$IMAGE")

  # --- SETUP (untimed) ---
  echo "    setup (untimed)..."
  docker exec "$CID" sh -c "$SETUP" >/dev/null 2>&1 || true
  local base; base=$(exec_baseline "$CID")
  echo "    docker-exec baseline: ${base}s (subtracted from timings)"

  # --- DOWNLOAD (timed once; network-dependent) ---
  echo "    download..."
  local dl dl_s dl_rc; dl=$(timed_exec "$CID" "$DL" "$OUT/$NAME-download.log" "$base")
  dl_s=${dl% *}; dl_rc=${dl#* }
  [ "$dl_rc" = "0" ] || echo "    !! download exited rc=$dl_rc"

  # Freeze the warm cache into an image so every install rep starts identical, with
  # no network at all (true offline — no reliance on `network disconnect`).
  docker commit "$CID" "$IMG" >/dev/null
  docker rm -f "$CID" >/dev/null 2>&1 || true

  # --- INSTALL (timed, offline, N reps on fresh containers) ---
  echo "    install x$REPS (offline: --network none, fresh container per rep)..."
  local reps_file gitver="" i res rep_s rep_rc fails=0 rbase
  reps_file=$(mktemp)
  for i in $(seq 1 "$REPS"); do
    local RC="${NAME}-rep$i"
    docker rm -f "$RC" >/dev/null 2>&1 || true
    docker run -d --network none --name "$RC" "$IMG" sleep infinity >/dev/null
    rbase=$(exec_baseline "$RC")
    res=$(timed_exec "$RC" "$INST" "$OUT/$NAME-install.log" "$rbase")   # last rep's log kept for breakdown
    rep_s=${res% *}; rep_rc=${res#* }
    [ "$rep_rc" = "0" ] || { fails=$((fails+1)); echo "    !! rep $i FAILED rc=$rep_rc"; }
    [ "$i" = "$REPS" ] && gitver=$(docker exec "$RC" sh -c "$VERIFY" 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
    docker rm -f "$RC" >/dev/null 2>&1 || true
    printf "      rep %d: %ss (rc=%s)\n" "$i" "$rep_s" "$rep_rc"
    echo "$rep_s" >> "$reps_file"
  done
  docker rmi -f "$IMG" >/dev/null 2>&1 || true

  local inst_median inst_min inst_max
  inst_median=$(median < "$reps_file")
  inst_min=$(sort -n "$reps_file" | head -1)
  inst_max=$(sort -n "$reps_file" | tail -1)
  rm -f "$reps_file"

  if [ "$fails" != "0" ] || [ -z "$gitver" ]; then
    echo "    !! [$NAME] FAILED (${fails} rep failures, git='${gitver:-unknown}') — not writing result"
    return 1
  fi

  cat > "$OUT/$NAME.json" <<JSON
{"manager":"$NAME","image":"$IMAGE","image_digest":"$digest","git":"$gitver","reps":$REPS,"download_s":$dl_s,"install_s":$inst_median,"install_min":$inst_min,"install_max":$inst_max}
JSON
  echo "    done: git $gitver  download=${dl_s}s  install(median/$REPS)=${inst_median}s  [min $inst_min, max $inst_max]"
}

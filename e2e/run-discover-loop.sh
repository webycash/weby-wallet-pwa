#!/usr/bin/env bash
# Durable repeat-runner for the two-node DHTX discover diagnosis (Step 2).
#
# Runs the exchange-two-node spec up to N times, capturing each run's full
# stdout to a per-run log AND appending a compact one-line tally to
# discover-loop.tally so a mid-loop cut leaves the evidence on disk. Stops early
# once >=2 discover FAILURES are caught WITH counters (the diagnosis goal) or N
# runs are exhausted.
#
# Usage:  E2E_PORT=5183 bash e2e/run-discover-loop.sh [N]   (default N=40)
set -u
cd "$(dirname "$0")/.."

N="${1:-40}"
OUT_DIR="e2e/.discover-loop"
mkdir -p "$OUT_DIR"
TALLY="$OUT_DIR/discover-loop.tally"
: > "$TALLY"

pass=0
fail=0
err=0
for i in $(seq 1 "$N"); do
  log="$OUT_DIR/run-$(printf '%02d' "$i").log"
  # Run only the (a)..(d) chain — (e)/(f) are downstream and not part of the
  # discover diagnosis. The spec is serial; a per-run fresh node pair is booted.
  npx playwright test e2e/exchange-two-node.spec.ts \
    --grep "discovers Node A|publishes a signed|establish a real|boot a real|mock adapter" \
    >"$log" 2>&1
  rc=$?

  if grep -q "node B discovered A's order" "$log"; then
    pass=$((pass+1))
    ms=$(grep -oE "after [0-9]+ms" "$log" | head -1)
    bdiag=$(grep -oE "B diag: \{.*\}" "$log" | head -1)
    echo "run $i PASS $ms | $bdiag" | tee -a "$TALLY"
  elif grep -q "DISCOVER FAILURE" "$log"; then
    fail=$((fail+1))
    echo "run $i DISCOVER_FAIL" | tee -a "$TALLY"
    grep -A3 "DISCOVER FAILURE" "$log" | tee -a "$TALLY"
    grep -E "roles — " "$log" | tee -a "$TALLY"
  else
    err=$((err+1))
    # Not a discover failure — a bootstrap/peer-connect/other gate failed.
    reason=$(grep -E "Bootstrap failed|reached 0 peers|0 peer DataChannels|roster|Error:|peer-formation" "$log" | head -2 | tr '\n' ' ')
    echo "run $i OTHER_FAIL rc=$rc | $reason" | tee -a "$TALLY"
  fi
  echo "  [loop] tally so far: pass=$pass discover_fail=$fail other_fail=$err" | tee -a "$TALLY"

  # Diagnosis is complete once we have a SUCCESS baseline AND >=2 discover
  # failures with counters — that pins the (a) vs (b) fork.
  if [ "$pass" -ge 1 ] && [ "$fail" -ge 2 ]; then
    echo "STOP: have success baseline ($pass) + $fail discover failures at run $i" | tee -a "$TALLY"
    break
  fi
done

echo "DONE pass=$pass discover_fail=$fail other_fail=$err" | tee -a "$TALLY"

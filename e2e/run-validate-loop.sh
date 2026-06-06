#!/usr/bin/env bash
# Post-fix validation runner (Step 4): run the two-node discover chain N times
# and require ZERO discover failures. The harness reproduced the pre-fix bug at
# ~1/3, so 0/20 is statistically decisive. Any residual failure logs its diag +
# drop reason (watch for drop_bad_signature = a relocated verify_as landmine).
set -u
cd "$(dirname "$0")/.."

N="${1:-20}"
OUT_DIR="e2e/.validate-loop"
mkdir -p "$OUT_DIR"
TALLY="$OUT_DIR/validate.tally"
: > "$TALLY"

pass=0; fail=0; err=0
for i in $(seq 1 "$N"); do
  log="$OUT_DIR/run-$(printf '%02d' "$i").log"
  npx playwright test e2e/exchange-two-node.spec.ts \
    --grep "discovers Node A|publishes a signed|establish a real|boot a real|mock adapter" \
    >"$log" 2>&1
  if grep -q "node B discovered A's order" "$log"; then
    pass=$((pass+1))
    ms=$(grep -oE "after [0-9]+ms" "$log" | head -1)
    echo "run $i PASS $ms" | tee -a "$TALLY"
  elif grep -q "DISCOVER FAILURE" "$log"; then
    fail=$((fail+1))
    echo "run $i DISCOVER_FAIL *** REGRESSION ***" | tee -a "$TALLY"
    grep -E "VERDICT-HINT|DROP-ERROR|B final diag" "$log" | tee -a "$TALLY"
  else
    err=$((err+1))
    reason=$(grep -E "Bootstrap failed|reached 0 peers|0 peer DataChannels" "$log" | head -1)
    echo "run $i OTHER_FAIL (peer/bootstrap, not discover) | $reason" | tee -a "$TALLY"
  fi
  echo "  tally: pass=$pass discover_fail=$fail other_fail=$err" | tee -a "$TALLY"
done
echo "DONE pass=$pass discover_fail=$fail other_fail=$err" | tee -a "$TALLY"

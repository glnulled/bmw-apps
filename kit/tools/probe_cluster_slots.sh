#!/usr/bin/env bash
# probe_cluster_slots.sh - which of the cluster's slots suits cluster-render's `panel` on this car (iDrive 7).
# For each slot: panel_slot = <slot> in the unit's cluster-render.local.conf, cluster-render restarted, a test picture
# with the slot's number and a coordinate grid shown for SECS seconds (kit/tools/cluster_slot_pattern.js) - photograph
# the cluster - and what the cluster answered and took down meanwhile read from cluster-render's log.
# At the end (also on Ctrl-C) the panel's slot is put back: AFTER=default (cluster-render's own, 0x203) or AFTER=keep
# (the local.conf as it was before the run).
#
#   HU=root@<unit-ip> [KEY=path/to/key] [PORT=22] [SECS=20] [AFTER=default|keep] kit/tools/probe_cluster_slots.sh [slot ...]
#
# Default slots: the empty ones seen on a G3x M-layout cluster, then the known ones to compare with.
# The car parked, ignition on. Each slot restarts cluster-render (its clients reconnect by themselves).
set -euo pipefail

[ -n "${HU:-}" ] || { echo "set HU=root@<unit-ip> (and KEY=<ssh key>)"; exit 1; }
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SECS="${SECS:-20}"; AFTER="${AFTER:-default}"
if [ $# -gt 0 ]; then SLOTS=("$@"); else SLOTS=(0x220 0x201 0x105 0x250 0x111 0x104 0x203); fi
OUT="$ROOT/work/slot-probe-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT"
SSH=(ssh -o ConnectTimeout=10 -o LogLevel=ERROR)
[ -n "${PORT:-}" ] && SSH+=(-p "$PORT")
[ -n "${KEY:-}" ] && SSH+=(-i "$KEY" -o IdentitiesOnly=yes)
run() { "${SSH[@]}" "$HU" "LC_ALL=C; $1"; }

CONF=/var/opt/cluster-render/cluster-render.local.conf
LOG=/var/opt/cluster-render/log/cluster-render.log
PAT=/tmp/cluster_slot_pattern.js

run "[ -x /usr/bin/node ] && [ -d /var/opt/cluster-render/current ]" || { echo "no node or no cluster-render on $HU"; exit 1; }
run "cat $CONF 2>/dev/null || true" > "$OUT/local.conf.before"
run "cat > $PAT" < "$ROOT/kit/tools/cluster_slot_pattern.js"

# the local.conf without any panel_slot line, then with ours; an empty result removes the file
set_slot() {   # $1: a slot, or empty for cluster-render's own
    run "f=$CONF; t=\$f.probe; { [ -f \$f ] && grep -v '^panel_slot' \$f || true; } > \$t; [ -n '$1' ] && echo 'panel_slot = $1' >> \$t;
         if grep -q '^[^#]' \$t; then chown root:root \$t; chmod 644 \$t; mv \$t \$f; else rm -f \$t \$f; fi;
         systemctl restart cluster-render; sleep 3; systemctl is-active cluster-render"
}
restore() {
    trap - EXIT INT TERM
    echo
    if [ "$AFTER" = keep ]; then
        echo "putting cluster-render.local.conf back as it was"
        if [ -s "$OUT/local.conf.before" ]; then run "cat > $CONF; chown root:root $CONF; chmod 644 $CONF; systemctl restart cluster-render" < "$OUT/local.conf.before"
        else run "rm -f $CONF; systemctl restart cluster-render"; fi
    else
        echo "panel back in cluster-render's own slot (0x203)"
        set_slot "" > /dev/null || true
    fi
    run "rm -f $PAT; cat $CONF 2>/dev/null || echo '(no local.conf)'"
    echo "results: $OUT"
}
trap restore EXIT INT TERM

echo "-> $OUT   slots: ${SLOTS[*]}   ${SECS}s each"
for slot in "${SLOTS[@]}"; do
    echo
    echo "=== $slot ==="
    if ! state=$(set_slot "$slot" 2>&1 | tail -1) || [ "$state" != active ]; then
        echo "   cluster-render did not start with this slot ($state): skipped"
        run "tail -5 $LOG" > "$OUT/$slot.log" 2>&1 || true
        continue
    fi
    echo "   PHOTOGRAPH THE CLUSTER NOW: the picture stays ${SECS}s"
    run "/usr/bin/node $PAT $slot $SECS" 2>&1 | sed 's/^/   /' | tee "$OUT/$slot.client.txt" || true
    run "n=\$(grep -n 'I start:' $LOG | tail -1 | cut -d: -f1); tail -n +\$n $LOG | grep -v ' ramses: '" > "$OUT/$slot.log" || true
    # the cluster's answer, and what else changed while ours was there
    if grep -q "slot $slot status [0-9] content 0x10004f8 class 0 map 1" "$OUT/$slot.log"; then echo "   cluster: shown in $slot"
    elif grep -q "content 0x10004f8 map status [0-9] -> 3" "$OUT/$slot.log"; then echo "   cluster: parked behind other content in $slot (not shown)"
    else echo "   cluster: NOT shown"; fi
    grep -E "E_DCSM_[A-Z_]+" "$OUT/$slot.log" | grep -v E_DCSM_OK | sed 's/^.*dcsm: /   refused: /' | sort -u | head -5 || true
    grep -E "content 0x[0-9a-f]+ map status 1 -> [03]" "$OUT/$slot.log" | grep -v -E "0x10004f[0-9]|0x1000300" \
        | sed -E 's/^.*content (0x[0-9a-f]+) map status 1 -> ([03]).*$/   taken down meanwhile: content \1 (-> \2)/' | sort | uniq -c | head -8 || true
done

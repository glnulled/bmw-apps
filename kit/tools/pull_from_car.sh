#!/usr/bin/env bash
# pull_from_car.sh - everything to debug the apps with, from the head unit into work/car-<time>/ (nothing on the car
# is changed): the data folders of this repository's apps (their logs and settings),
# cluster-render's status, log and settings, and the apps' state in the platform.
#
#   HU=root@<unit-ip> [PORT=22] [KEY=path/to/key] kit/tools/pull_from_car.sh [--catalog]
#
# --catalog also copies the unit's SOME/IP catalog to reference/ (for kit/tools/check_signals.py and sigdoc.py).
set -euo pipefail

[ -n "${HU:-}" ] || { echo "set HU=root@<unit-ip> (and KEY=<ssh key>)"; exit 1; }
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/work/car-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT"
SSH=(ssh -o ConnectTimeout=10)
[ -n "${PORT:-}" ] && SSH+=(-p "$PORT")
[ -n "${KEY:-}" ] && SSH+=(-i "$KEY" -o IdentitiesOnly=yes)
run() { "${SSH[@]}" "$HU" "LC_ALL=C; $1"; }

echo "-> $OUT"

# this repository's apps: their ids from apps/*/app.json; each app's folder is oap_<uid> by the platform's uid table
# (an app the Store installed can have a uid outside the usual range), else wherever its log file is
IDS=$(cd "$ROOT/apps" && for d in */; do [ -f "$d/app.json" ] && basename "$d"; done)
for id in $IDS; do
    dir=$(run "uid=\$(sed -n 's/^\\([0-9]*\\)=$id\$/\\1/p' /var/opt/public/oap/oap_12201/security/uids.txt 2>/dev/null | head -1);
        if [ -n \"\$uid\" ] && [ -d /var/opt/public/oap/oap_\$uid/data ]; then echo /var/opt/public/oap/oap_\$uid/data;
        else f=\$(find /var/opt -name '$id.log' 2>/dev/null | head -1); [ -n \"\$f\" ] && dirname \"\$f\"; fi" || true)
    if [ -z "$dir" ]; then echo "   $id: no data folder (not installed, or never started)"; continue; fi
    mkdir -p "$OUT/$id"
    run "cd '$dir' && tar cf - ." | tar xf - -C "$OUT/$id" || echo "   $id: could not copy $dir"
    run "ls -la '$dir' '$dir/..'" > "$OUT/$id/_folder.txt" 2>&1 || true
    echo "   $id ($dir): $(ls "$OUT/$id" | tr '\n' ' ')"
done

# cluster-render: its own status (targets, slots, every client's layers), its log and the unit's own settings
if run "[ -d /var/opt/cluster-render ]"; then
    mkdir -p "$OUT/cluster-render"
    run "ls /var/opt/cluster-render/current/ 2>/dev/null; cat /var/opt/cluster-render/current/component.json 2>/dev/null" > "$OUT/cluster-render/installed.txt" || true
    run "/var/opt/cluster-render/current/cluster-render status 2>&1 || cluster-render status 2>&1" > "$OUT/cluster-render/status.txt" || true
    run "cd /var/opt/cluster-render/log 2>/dev/null && tar cf - ." | tar xf - -C "$OUT/cluster-render" || true
    run "cat /var/opt/cluster-render/cluster-render.local.conf 2>/dev/null" > "$OUT/cluster-render/local.conf" || true
    run "systemctl status cluster-render.service --no-pager 2>&1 | head -20" > "$OUT/cluster-render/systemd.txt" || true
    echo "   cluster-render: $(ls "$OUT/cluster-render" | tr '\n' ' ')"
else
    echo "   cluster-render: not installed (MGU Store, source robertnisipeanu/idrive-apps, Cluster renderer)"
fi

# the platform's view of the apps
run "cat /var/opt/public/oap/oap_12201/security/uids.txt 2>/dev/null" > "$OUT/uids.txt" || true
run "ls -la /dev/shm/cluster-render/ 2>&1" > "$OUT/cluster-render-socket.txt" || true

if [ "${1:-}" = "--catalog" ]; then
    mkdir -p "$ROOT/reference"
    run "cat /etc/oap/someip/someip-interfaces.json" > "$ROOT/reference/someip-interfaces.json"
    echo "   catalog: reference/someip-interfaces.json"
fi
echo "done: $OUT"

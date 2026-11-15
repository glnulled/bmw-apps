#!/bin/sh
# panel-slot.sh - cluster-render's `panel` target in slot 0x105 (glnulled-cluster-slot, component.json: activate runs
# `set` as root once a version is in place, deactivate runs `unset` before the tool is removed).
#
# Why: on a cluster coded to the M layout (seen on a G3x), the KOMBI shows only one of the slots 0x200 (the widgets on
# the right), 0x202 (the media source list) and 0x203 (cluster-render's own slot for the panel). With anything on the
# panel the widgets go, and the list is pushed from the cluster to the HUD. 0x105 is as large (the whole cluster,
# 1920 x 720), is drawn over the gauges and the map and under the widgets, and shares with none of them
# (kit/tools/probe_cluster_slots.sh shows every slot on a car). It is the slot of the navigation's maneuver box and
# the seat-belt warning: the panel gives way to them, and cluster-render's guide hold is off while the panel is there.
#
# A slot is cluster-render's setting, not a client's: its line goes in the unit's own
# /var/opt/cluster-render/cluster-render.local.conf, which cluster-render's updates keep. Ours is marked, so `unset`
# removes only it; a panel_slot the unit already has there (set by hand) is left as it is.
#
#   panel-slot.sh set | unset | status
set -u
CONF="${CLUSTER_SLOT_CONF:-/var/opt/cluster-render/cluster-render.local.conf}"
SLOT="${CLUSTER_SLOT:-0x105}"
SYSTEMCTL="${CLUSTER_SLOT_SYSTEMCTL:-systemctl}"
MARK="# glnulled-cluster-slot:"
NOTE="$MARK the panel beside the widgets and the media list (the next line is its, removed with the tool)"

say() { echo "glnulled-cluster-slot: $*"; }
ours() { [ -f "$CONF" ] && grep -q "^$MARK" "$CONF"; }
theirs() { [ -f "$CONF" ] && sed -e "/^$MARK/,/^panel_slot/d" "$CONF" | grep -q '^panel_slot'; }
# the file without our two lines; nothing left: no file
strip() {
    [ -f "$CONF" ] || return 0
    sed -e "/^$MARK/,/^panel_slot/d" "$CONF" > "$CONF.tmp" || return 1
    if [ -s "$CONF.tmp" ]; then chmod 644 "$CONF.tmp"; mv "$CONF.tmp" "$CONF"; else rm -f "$CONF.tmp" "$CONF"; fi
}
# cluster-render reads its settings at its start; its clients reconnect by themselves. Not running: nothing to do
again() { $SYSTEMCTL try-restart cluster-render.service 2>/dev/null || true; }

case "${1:-status}" in
set)
    [ -d "$(dirname "$CONF")" ] || { say "no $(dirname "$CONF"): cluster-render is not installed"; exit 1; }
    if theirs; then say "the unit has a panel_slot of its own in $CONF: left as it is"; exit 0; fi
    if ours && grep -q "^panel_slot = $SLOT\$" "$CONF"; then say "panel_slot = $SLOT is there already"; exit 0; fi
    strip || { say "cannot write $CONF"; exit 1; }
    { printf '%s\n' "$NOTE" "panel_slot = $SLOT" >> "$CONF" && chmod 644 "$CONF"; } || { say "cannot write $CONF"; exit 1; }
    again
    say "panel_slot = $SLOT in $CONF, cluster-render started again"
    ;;
unset)
    if ours; then
        strip || { say "cannot write $CONF"; exit 1; }
        again
        say "its panel_slot removed from $CONF, cluster-render started again (the panel back in its own slot)"
    else say "no panel_slot of ours in $CONF"; fi
    ;;
status)
    if ours; then say "ours: $(grep '^panel_slot' "$CONF" | tail -1)"
    elif theirs; then say "the unit's own: $(grep '^panel_slot' "$CONF" | tail -1)"
    else say "none: the panel is in cluster-render's own slot"; fi
    ;;
*) echo "usage: panel-slot.sh set | unset | status"; exit 2 ;;
esac

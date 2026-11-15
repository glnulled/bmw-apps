# Customizer

The driving mode on the iDrive 7 instrument cluster, **over** the stock picture, for clusters coded to a layout that
shows none (an M layout on another car, with BimmerCode): nothing of the cluster is redrawn, one small box goes where
the Standard layout writes the mode and the rest stays BMW's. Id `glnulled_customizer`.

- **The mode:** COMFORT, COMFORT+, SPORT, SPORT+, SPORT IND, ECO PRO, ADAPTIVE, and the individual, hybrid,
  xOffroad and TRACTION modes, in BMW's colours (Sport red, Comfort white, Eco Pro blue) or white.
- **The stability control with it:** in the traction mode (DTC, the DSC button pressed short) TRACTION in orange under
  the mode; with DSC off **DSC OFF** in red under the mode, blinking (it can be made steady).
- **A black plate** under the text, edge to edge, covers what the stock cluster writes in the same place (the
  Standard layout's own mode text).

It runs from the platform's start (`autostart`), so the cluster shows the mode with the app closed.

## Needs

- **cluster-render** 0.6.0 or newer, the service every app draws on the cluster and the HUD through, by Robert
  Nisipeanu ([robertnisipeanu/idrive-apps](https://github.com/robertnisipeanu/idrive-apps), not in this repository):
  `app.json` `requires` it, so the MGU Store installs it first from that source (one of the Store's default sources).
  Installed by hand (`deploy/push-to-car.sh`), install *Cluster renderer* and *Renderer* from the Store yourself.
- **Cluster slot for Customizer** (`glnulled-cluster-slot`, [`kit/cluster-slot`](../../kit/cluster-slot)), a small
  tool from this repository the Store installs with the app (`requires`). On a cluster coded to the M layout the KOMBI
  shows only one of the slots 0x200 (the widgets on the right), 0x202 (the media source list) and 0x203
  (cluster-render's own slot for the whole cluster): with the mode on the cluster the widgets went, the mode went
  while the source list showed, and the list was pushed over to the HUD. The tool puts `panel_slot = 0x105` in the
  unit's `/var/opt/cluster-render/cluster-render.local.conf` and starts cluster-render again: 0x105 is as large,
  over the gauges and the map and under the widgets, and shares with none of them. It is the slot of the
  navigation's maneuver box and the seat-belt warning, which the panel gives way to; cluster-render's guide hold is
  off while the panel is there. A `panel_slot` already set there by hand is left alone; removing the tool removes
  its line. Another cluster may want another slot: `kit/tools/probe_cluster_slots.sh` shows each one (below).
- iDrive 7 (MGU). iDrive 8 has no target over the whole cluster.

## The page

On / Off (off: nothing of ours on the cluster, the connection to cluster-render closed), DSC / traction shown,
DSC OFF blinks, colours (by mode / white), text size, alignment, background (plate / none); the box's position and
size (arrows in steps of 1, 10 or 50 px, W / H, Reset to the defaults) with a map of the cluster; a preview.

Defaults: the box at x 1212, y 658, 192 x 62 (the cluster's own pixels, 1920 x 720 from the top-left), text 28.

## How it works

```
 FES statusFESVehicleDynamicSwitchHMI ─┐                  ┌─> layer 'mode'    the badge (plate, mode, TRACTION)
 FES statusDSCSwitchHMI               ─┼─> service.js ────┤
 FES modeAvailabilityDSC              ─┘   (overlay.js)   └─> layer 'dscOff'  DSC OFF under the mode, shown / hidden to blink
                                         cluster_render_client.js ──> /dev/shm/cluster-render/render.sock
```

- The mode: `displayModeDrivingExperience` (else `actualValueModeDrivingExperience`) of
  `statusFESVehicleDynamicSwitchHMI` (`modes.js`).
- DSC (`stability.js`): *traction* from `statusDSCSwitchHMI` TRAKTIONSMODUS_EIN, `modeAvailabilityDSC` TRAKTION /
  TRAKTIONSOPTIMIERT_STUFE_n / MID, or the mode's availability "cut down by the driver"; *off* from DSC_AUS, KEINE or
  "switched off by the driver". Off wins.
- cluster-render puts one scene over the whole cluster (its target `panel`: slot 0x203 as shipped, 0x105 with the
  tool above); the KOMBI draws it over its gauges. The badge is an image layer (class `overlay`) written when what it shows changes, only the part that
  changed; DSC OFF is written once and blinks by its visibility alone (no pixels sent).
- `data/customizer.json`: the settings; `data/glnulled_customizer.log`: the app's log, with every mode and DSC status
  the car sent.

## On the desk

```sh
node kit/tools/fake_cluster_render.js --sock /tmp/cluster-render-fake.sock --bg work/cluster.jpg   # http://localhost:8090
CLUSTER_RENDER_SOCK=/tmp/cluster-render-fake.sock CUSTOMIZER_SIMULATE=1 node kit/tools/emu.js glnulled_customizer
node kit/tools/test_glnulled_customizer.js out          # the tests; the page, the badges and the cluster in out/
```

`CUSTOMIZER_SIMULATE=1` steps through modes, traction and DSC off by itself. `--bg` takes a photo of the cluster cut
to it (stretched to 1920 x 720); `work/` is out of git.

## Files

| | |
|---|---|
| `main.js` | the page |
| `service.js` | the car's signals, the blink, on / off (runs with the app closed) |
| `overlay.js` | the two layers in cluster-render |
| `draw.js` | the pictures (badge, DSC OFF) |
| `modes.js` | the car's driving modes as labels and colours |
| `stability.js` | the car's DSC statuses as traction / off |
| `config.js` | `data/customizer.json` |
| `cluster_render_client.js` | cluster-render's Node client, unchanged (MPL-2.0, see `NOTICE`) |

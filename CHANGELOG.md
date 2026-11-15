# Changelog

## Customizer (glnulled_customizer)

### 1.0.1 (2026-11-16)

- Off and On again left the earlier layers in cluster-render: its client makes again every layer it was given, and
  Off only forgot them. One more badge was drawn over the first each time (four layers seen in the service's status
  on a car). Off now drops the layers, then closes the connection.
- Needs the new tool *Cluster slot for Customizer* (`glnulled-cluster-slot` 1.0.0, `kit/cluster-slot`), which the
  Store installs with it: cluster-render's panel moves from slot 0x203 to 0x105. On the M-layout cluster the KOMBI
  showed only one of 0x200 (the widgets on the right), 0x202 (the media source list) and 0x203, so the widgets went
  while the mode showed, the mode went while the list showed, and the list jumped to the HUD. In 0x105 all three
  show together (found with `kit/tools/probe_cluster_slots.sh`; 0x201 also pushes the widgets out, 0x111 and 0x104
  are small windows, 0x220 and 0x250 show nothing).

### 1.0.0 (2026-11-16)

First version in this repository and the MGU Store; 0.1.0 to 0.4.0 were tried in a car (an M-coded cluster,
cluster-render 0.6.0), installed by hand, and not published. Installed from the Store it starts with the platform
(`autostart`), so the mode is back on the cluster after the car sleeps or the head unit restarts.

- The driving mode on the instrument cluster, over the stock picture, through cluster-render's `panel` target: one
  box (default x 1212, y 658, 192 x 62, text 28) where the Standard layout writes the mode, on a black plate that
  covers the stock text; colours by mode or white, size, alignment, the box moved and sized on the page.
- DSC from the car's FES statuses: in the traction mode TRACTION in orange under the mode; with DSC off DSC OFF in
  red under the mode, blinking twice a second by the layer's visibility alone (no pixels sent), or steady.
- On / Off: off closes the connection to cluster-render, so nothing of ours stays on the cluster.
- Requires cluster-render 0.6.0 (`app.json` `requires`): the MGU Store installs it first, from robertnisipeanu/idrive-apps.
- Nothing touches the HMI's cluster widgets (BC): reading and stepping them, tried in 0.1.0, took the stock widgets
  off the cluster until the head unit restarted.

## Driver profiles (glnulled_driver_profiles)

### 1.0.1 (2026-11-15)

- The app's own profiles (emulator, preview) are saved on Node 8 too: their folder was made with an option Node 8
  does not have.

### 1.0.0 (2026-11-14)

First release.

- The car's own driver profiles without BMW ID / ConnectedDrive, through the head unit's personalisation services:
  the list with the profile in use, new profiles with a name, rename, switch, delete one.
- On-screen keyboard with English and Russian layouts, each switched on or off in the settings.
- Where the car's services are not there (emulator, preview), profiles of the app's own to try the screens.

## Kit

Taken from [cauliflowermossgrape/idrive7-apps](https://github.com/cauliflowermossgrape/idrive7-apps) at `8681f50`
(renderer 2.1.11), without its apps, with these changes:

- `kit/tools/build.py`: `"fonts": ["cyrillic"]` in an app's `app.json` puts the Cyrillic glyph atlas into every
  build, not only the Russian one.
- `kit/runtime/locales/ko.tsv` / `ko.json`: Korean for Driver profiles' menu labels.
- `kit/tools/run_tests.js`: runs every `kit/tools/test_*.js` (`npm test`).
- `kit/cluster-slot` (`glnulled-cluster-slot` 1.0.0): a Store tool, listed in `mgu-repo.json` `tools`, that sets
  cluster-render's `panel_slot` in the unit's `cluster-render.local.conf` when it is installed and takes its line
  out when it is removed (`panel-slot.sh`, tested by `kit/tools/test_cluster_slot.js`).
- `kit/tools/probe_cluster_slots.sh` with `cluster_slot_pattern.js`: shows a test picture (the slot's number, a
  coordinate grid, coloured edges) in each of the cluster's slots in turn and reads from cluster-render's log what
  the cluster took down meanwhile; the panel's slot is put back at the end.
- No renderer of our own: `kit/renderd/prebuilt` (renderer 2.1.11 and the controller gate) is gone, and
  `kit/tools/make_kit.py` packs the apps and the install scripts only. The apps draw through the MGU Store's
  Renderer, which the Store keeps up to date; `kit/renderd` keeps its source for the emulator's draw engine.
- `kit/tools/fake_cluster_render.js`: a stand-in of cluster-render for the desk (its protocol on a Unix socket, the
  cluster and the HUD composed in a browser page).
- `kit/tools/pull_from_car.sh`: the apps' data, cluster-render's status and log from the head unit.

# Changelog

## Driver profiles (glnulled_driver_profiles)

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

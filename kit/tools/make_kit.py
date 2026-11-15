#!/usr/bin/env python3
"""make_kit.py - build the apps and pack everything the head unit needs into one folder
(+ .tar.gz) for push-to-car.sh / push-to-car.ps1 or a USB stick. Runs on Linux, macOS and
Windows (Python 3.6+ and Node.js; no bash, no Docker needed).

    python3 kit/tools/make_kit.py                 # all apps in apps/
    python3 kit/tools/make_kit.py car_vitals ...  # only these
    (deploy/make-car-kit.sh and deploy\\make-car-kit.cmd call this)

Output: dist/mgu-custom-apps/ and dist/mgu-custom-apps.tar.gz

No renderer goes in the kit: the apps draw through the one the MGU Store installs and keeps up to
date (its Renderer, mgu-render, and the controller gate from idrive7-apps), found by kit/runtime/renderd.js
on its socket. A unit without one runs the apps in software (a few fps) until it is installed from the Store.
kit/renderd keeps the renderer's source only for the emulator's draw engine (kit/emu, GPL-3.0-or-later).
"""
import gzip, hashlib, json, os, shutil, subprocess, sys, tarfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DEPLOY = os.path.join(ROOT, 'deploy')
DIST = os.path.join(ROOT, 'dist')
# files copied next to the apps; text, so always shipped with Unix line endings
CAR_FILES = [('car/deploy-car.sh', 'deploy-car.sh'), ('mgu-app-install.sh', 'mgu-app-install.sh'),
             ('mainapp-patch.js', 'mainapp-patch.js'), ('car/README.txt', 'README.txt')]


def md5(p):
    h = hashlib.md5()
    with open(p, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''): h.update(b)
    return h.hexdigest()


def main():
    import argparse
    from localize import languages, package_version, normalize_language
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--language', type=normalize_language, choices=languages(), default='en',
                        help='UI language; Korean also accepts ko-KR, ko-kr and ko_KR')
    parser.add_argument('apps', nargs='*')
    args = parser.parse_args()
    # English (the default) keeps the usual dist/mgu-custom-apps(.tar.gz); other languages get a suffix
    name = 'mgu-custom-apps' + ('' if args.language == 'en' else '-' + args.language)
    OUT = os.path.join(DIST, name)
    archive = os.path.join(DIST, name + '.tar.gz')
    apps = args.apps or sorted(d for d in os.listdir(os.path.join(ROOT, 'apps'))
                                  if os.path.isfile(os.path.join(ROOT, 'apps', d, 'app.json')))

    shutil.rmtree(OUT, ignore_errors=True)
    os.makedirs(os.path.join(OUT, 'apps'))
    for app in apps:
        r = subprocess.run([sys.executable, os.path.join(ROOT, 'kit', 'tools', 'build.py'), '--language', args.language, app], cwd=ROOT)
        if r.returncode: sys.exit('build of %s failed' % app)
        spec = json.load(open(os.path.join(ROOT, 'apps', app, 'app.json'), encoding='utf-8'))
        app_id = spec.get('id', app)
        ver = package_version(spec['version'], args.language)
        shutil.copyfile(os.path.join(DIST, '%s@%s.mgu' % (app_id, ver)), os.path.join(OUT, 'apps', '%s@%s.mgu' % (app_id, ver)))
    for src, dst in CAR_FILES:
        data = open(os.path.join(DEPLOY, src), 'rb').read().replace(b'\r\n', b'\n')
        open(os.path.join(OUT, dst), 'wb').write(data)
    print('renderer: none in the kit - the apps use the MGU Store\'s Renderer (it updates itself); '
          'a unit without it draws them in software until it is installed from the Store')

    names = ['deploy-car.sh', 'mgu-app-install.sh', 'mainapp-patch.js'] + \
            ['apps/' + n for n in sorted(os.listdir(os.path.join(OUT, 'apps')))]
    with open(os.path.join(OUT, 'KIT_SUMS'), 'w', encoding='utf-8', newline='\n') as f:
        for n in names: f.write('%s  %s\n' % (md5(os.path.join(OUT, n)), n))

    # the archive carries Unix modes (the scripts), also when made on Windows
    def mode(ti):
        ti.uid = ti.gid = 0; ti.uname = ti.gname = 'root'
        ti.mode = 0o755 if ti.isdir() or ti.name.endswith('.sh') else 0o644
        return ti
    # no clock in the gzip header: it holds 32 bits, past 2106 it fails (see build.py gz_header_free)
    with gzip.GzipFile(archive, 'wb', mtime=0) as gz, tarfile.open(fileobj=gz, mode='w') as tf:
        tf.add(OUT, arcname='mgu-custom-apps', filter=mode)
    if hasattr(os, 'chmod'):
        for n in ('deploy-car.sh', 'mgu-app-install.sh'):
            os.chmod(os.path.join(OUT, n), 0o755)
    shutil.copyfile(os.path.join(DEPLOY, 'push-to-car.ps1'), os.path.join(DIST, 'push-to-car.ps1'))  # Windows: next to the .tar.gz
    print('kit: %s  (%s)' % (OUT, ' '.join(sorted(os.listdir(os.path.join(OUT, 'apps'))))))
    print('     %s' % archive)


if __name__ == '__main__':
    main()

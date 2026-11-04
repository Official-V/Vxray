// Builds the 64-bit Linux release (AppImage and deb).
//
// Statically swaps Linux ELF binaries from bin-linux/ into bin/ for the duration
// of the build and restores the original set afterwards.
// Runs as `npm run build:linux`.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = __dirname;
const BIN = path.join(ROOT, 'bin');
const LINUX_BIN = path.join(ROOT, 'bin-linux');
const BACKUP = path.join(ROOT, 'bin-windows-backup');

function fail(msg) {
  console.error('[build:linux] ' + msg);
  process.exit(1);
}

if (fs.existsSync(BACKUP)) {
  fail('bin-windows-backup/ already exists. An earlier build may have been interrupted.');
}

if (!fs.existsSync(LINUX_BIN)) {
  fail('bin-linux/ directory not found.');
}

for (const name of ['sing-box', 'xray', 'geoip.dat', 'geosite.dat']) {
  const f = path.join(LINUX_BIN, name);
  if (!fs.existsSync(f)) fail(`bin-linux/${name} is missing.`);
}

console.log('[build:linux] Staging bin-linux/ over bin/');
if (fs.existsSync(BIN)) {
  fs.renameSync(BIN, BACKUP);
}
fs.mkdirSync(BIN, { recursive: true });

function restore(reason) {
  if (fs.existsSync(BACKUP)) {
    console.log('[build:linux] Restoring Windows bin/ -- ' + reason);
    fs.rmSync(BIN, { recursive: true, force: true });
    fs.renameSync(BACKUP, BIN);
  }
}

try {
  for (const entry of fs.readdirSync(LINUX_BIN)) {
    const src = path.join(LINUX_BIN, entry);
    const dst = path.join(BIN, entry);
    fs.copyFileSync(src, dst);
    if (entry === 'sing-box' || entry === 'xray') {
      try {
        fs.chmodSync(dst, 0o755);
      } catch (_) {}
    }
  }

  console.log('[build:linux] Running Tauri build for Linux...');
  const tauriConfig = path.join(ROOT, 'src-tauri', 'tauri.linux.conf.json');
  const build = spawnSync(
    'npx',
    ['tauri', 'build', '--config', tauriConfig],
    { cwd: ROOT, stdio: 'inherit', shell: true }
  );

  if (build.status !== 0) {
    fail(`Tauri build exited with status ${build.status}`);
  }
} finally {
  restore('cleanup');
}

// Copy outputs to releases/
const releasesDir = path.join(ROOT, 'releases');
if (!fs.existsSync(releasesDir)) fs.mkdirSync(releasesDir, { recursive: true });

const bundleDir = path.join(ROOT, 'src-tauri', 'target', 'release', 'bundle');
const appimageDir = path.join(bundleDir, 'appimage');
const debDir = path.join(bundleDir, 'deb');

if (fs.existsSync(appimageDir)) {
  for (const f of fs.readdirSync(appimageDir)) {
    if (f.endsWith('.AppImage')) {
      const targetName = f.replace(/_2\.\d+\.\d+/, '_2.1');
      fs.copyFileSync(path.join(appimageDir, f), path.join(releasesDir, targetName));
      console.log(`[build:linux] Created: releases/${targetName}`);
    }
  }
}

if (fs.existsSync(debDir)) {
  for (const f of fs.readdirSync(debDir)) {
    if (f.endsWith('.deb')) {
      const targetName = f.replace(/_2\.\d+\.\d+/, '_2.1');
      fs.copyFileSync(path.join(debDir, f), path.join(releasesDir, targetName));
      console.log(`[build:linux] Created: releases/${targetName}`);
    }
  }
}

console.log('[build:linux] Linux build complete!');

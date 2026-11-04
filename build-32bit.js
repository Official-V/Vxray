// Builds the 32-bit release.
//
// The x64 and x86 builds need different sing-box.exe / xray.exe / wintun.dll, and Tauri's
// bundle config names those files statically, so the x86 set is swapped into bin/ for the
// duration of the build and the x64 set is put back afterwards. Every step is ordered so an
// interrupted run leaves the tree recoverable rather than holding a mix of both architectures.
//
// Runs as `npm run build:32`. Everything before the toolchain is a preflight that exits 1
// with the exact thing missing, so a broken 32-bit build fails here instead of shipping.
//
// What the 32-bit set has to contain, and where each one comes from:
//   sing-box.exe  -> sing-box-<ver>-windows-386.tar.gz      (github.com/SagerNet/sing-box)
//   xray.exe      -> Xray-windows-32.zip                    (github.com/XTLS/Xray-core)
//   wintun.dll    -> wintun-0.14.1.zip, bin/x86/wintun.dll  (wintun.net)
//   geoip.dat, geosite.dat -> architecture-independent, copy the ones already in bin/
//
// stat-tracker.exe and vxray-tun.exe are not staged: the app copies them from sing-box.exe at
// runtime (see core_copy in core/manager.rs), so one 32-bit sing-box covers all three.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = __dirname;
const BIN = path.join(ROOT, 'bin');
const X86 = path.join(ROOT, 'bin-x86');
const BACKUP = path.join(ROOT, 'bin-amd64');

const TARGET = 'i686-pc-windows-msvc';
// The PE machine field the 32-bit binaries must carry. Checked rather than trusted, because
// dropping an x64 build into bin-x86 is the one mistake this script cannot undo later.
const MACHINE_X86 = 0x014c;

function fail(msg) {
  console.error('[build:32] ' + msg);
  process.exit(1);
}

function peMachine(file) {
  const fh = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(0x400);
    const n = fs.readSync(fh, head, 0, 0x400, 0);
    const view = head.subarray(0, n);
    if (view.length < 0x40 || view.readUInt16LE(0) !== 0x5a4d) return null; // no MZ signature
    const peOff = view.readInt32LE(0x3c);
    if (peOff < 0 || peOff + 6 > view.length) return null;
    if (view.readUInt32LE(peOff) !== 0x00004550) return null; // no PE\0\0
    return view.readUInt16LE(peOff + 4);
  } finally {
    fs.closeSync(fh);
  }
}

// The swap is only safe if nothing from a previous interrupted run is still on disk.
if (fs.existsSync(BACKUP)) {
  fail(`bin-amd64/ already exists -- a previous run was interrupted. If bin/ currently holds the ` +
    `32-bit set, move bin-amd64 back over it manually (rename bin-amd64 to bin) and re-run.`);
}
if (!fs.existsSync(X86)) {
  fail(`bin-x86/ not found. Stage the 32-bit cores there first:\n` +
    `  sing-box.exe   from sing-box-<ver>-windows-386.tar.gz\n` +
    `  xray.exe       from Xray-windows-32.zip\n` +
    `  wintun.dll     from wintun-<ver>.zip, bin/x86/wintun.dll\n` +
    `  geoip.dat, geosite.dat -- copy from bin/, they are architecture-independent.`);
}

for (const name of ['sing-box.exe', 'xray.exe', 'wintun.dll']) {
  const f = path.join(X86, name);
  if (!fs.existsSync(f)) fail(`bin-x86/${name} is missing.`);
  const machine = peMachine(f);
  if (machine !== MACHINE_X86) {
    fail(`bin-x86/${name} is not a 32-bit binary (PE machine ${machine === null ? 'unreadable' : '0x' + machine.toString(16)}, ` +
      `expected 0x${MACHINE_X86.toString(16)}). Staging an x64 build here would produce an installer ` +
      `that cannot run its own cores on a 32-bit machine.`);
  }
}
for (const name of ['geoip.dat', 'geosite.dat']) {
  if (!fs.existsSync(path.join(X86, name))) fail(`bin-x86/${name} is missing.`);
}

// A 32-bit app needs the 32-bit MSVC link libraries, which are a separate VS component from
// the x64 ones. Checking up front keeps the failure out of a long compile.
const targets = spawnSync('rustup', ['target', 'list', '--installed'], { encoding: 'utf8', shell: true });
if (targets.error || !targets.stdout.split(/\r?\n/).includes(TARGET)) {
  fail(`Rust target ${TARGET} is not installed. Run:\n  rustup target add ${TARGET}\n` +
    `If that fails, install the "MSVC v143 - VS 2022 C++ x64/x86 build tools" component in ` +
    `Visual Studio Setup; the 32-bit linker is not part of the default workload.`);
}

// Manifest of what bin/ held, so the restore is verified rather than assumed.
const before = fs.readdirSync(BIN).sort()
  .map(n => ({ name: n, size: fs.statSync(path.join(BIN, n)).size }));
if (!before.length) fail('bin/ is empty -- nothing to back up, so the swap cannot be undone.');

console.log('[build:32] staging bin-x86 over bin/');
fs.renameSync(BIN, BACKUP);
fs.mkdirSync(BIN, { recursive: true });
for (const entry of fs.readdirSync(X86)) {
  fs.copyFileSync(path.join(X86, entry), path.join(BIN, entry));
}

function restore(reason) {
  console.error('[build:32] restoring the x64 set into bin/ -- ' + reason);
  fs.rmSync(BIN, { recursive: true, force: true });
  fs.renameSync(BACKUP, BIN);
  const after = fs.readdirSync(BIN).sort()
    .map(n => ({ name: n, size: fs.statSync(path.join(BIN, n)).size }));
  const same = before.length === after.length && before.every((e, i) => e.name === after[i].name && e.size === after[i].size);
  if (!same) fail('bin/ was not restored to what it held before the build. Stop here and check bin/ manually.');
}

const build = spawnSync('npx', ['tauri', 'build', '--target', TARGET], { cwd: ROOT, stdio: 'inherit', shell: true });
if (build.status !== 0) {
  restore('the build failed');
  fail(`tauri build exited with status ${build.status}. bin/ is back to the x64 set.`);
}

restore('build finished');

// The NSIS artifact carries a three-part version; rename-installer.js drops the trailing .0
// the same way the x64 postbuild does, so both releases read "2.1".
spawnSync('node', ['rename-installer.js'], { cwd: ROOT, stdio: 'inherit' });

const nsisDir = path.join(ROOT, 'src-tauri', 'target', TARGET, 'release', 'bundle', 'nsis');
if (fs.existsSync(nsisDir)) {
  const setups = fs.readdirSync(nsisDir).filter(f => f.endsWith('-setup.exe'));
  console.log('[build:32] done: ' + (setups.length ? setups.join(', ') : 'no setup.exe found in ' + nsisDir));
} else {
  console.log('[build:32] done, but the expected bundle dir was not found: ' + nsisDir);
}

// The manifests must carry semver (cargo and Tauri both reject "2.1"), so the NSIS
// bundler names the artifact Vxray_2.1.0_x64-setup.exe. The release is numbered "2.1"
// and the app's About page already says "v2.1", so the setup.exe a user downloads
// should read the same two-part number. This mirrors display_version() in
// core/update.rs -- drop a trailing ".0" -- so both halves agree and nothing has to be
// hardcoded when the version moves.
//
// The updater is unaffected: pick_asset() in core/update.rs selects the release asset
// by shape ("setup" + "x64"), never by exact name.

// Runs as `npm run postbuild`. A cosmetic filename fix must never be able to fail a
// release that actually compiled, so any problem here warns and exits 0.
//
// Both bundle directories are scanned: the x64 build lands in target/release and the
// 32-bit one in target/i686-pc-windows-msvc/release. A single release ships two installers,
// and only fixing one of them would send 32-bit users a file numbered differently from the
// version their About page reports.

const fs = require('fs');
const path = require('path');

const ARCH_DIRS = ['release', 'i686-pc-windows-msvc/release'];

// The NSIS bundler names the 32-bit artifact "..._x86-setup.exe" after the i686 target triple,
// but the release reads "x64 and x32", so the arch token is rewritten to match. arch_tag() in
// core/update.rs searches for this same string -- if these two drift apart the 32-bit build
// stops finding its own update and falls back to whichever setup comes first, which can hand a
// 32-bit install a 64-bit installer.
const ARCH_TOKENS = { x86: 'x32' };

try {
  let renamed = 0, scanned = 0;
  for (const sub of ARCH_DIRS) {
    const nsisDir = path.join(__dirname, 'src-tauri', 'target', sub, 'bundle', 'nsis');
    if (!fs.existsSync(nsisDir)) continue;
    scanned++;
  for (const file of fs.readdirSync(nsisDir)) {
    if (!file.endsWith('-setup.exe')) continue;

    // Vxray_<version>_<arch>-setup.exe
    const versionToken = file.split('_')[1];
    if (!versionToken) continue;

    const parts = versionToken.split('.');
    if (parts[parts.length - 1] === '0') parts.pop();
    const display = parts.join('.');
    const archToken = Object.keys(ARCH_TOKENS).find(a => file.includes(`_${a}-`));
    const displayArch = archToken ? ARCH_TOKENS[archToken] : archToken;

    if (display === versionToken && !archToken) continue;

    // `.replace` with an undefined archToken is a no-op, so a setup with no arch token -- or one
    // this map does not know -- keeps its name rather than gaining an "_undefined-".
    const target = file
      .replace(`_${versionToken}_`, `_${display}_`)
      .replace(`_${archToken}-`, `_${displayArch}-`);
    const from = path.join(nsisDir, file);
    const to = path.join(nsisDir, target);
    fs.rmSync(to, { force: true });
    fs.renameSync(from, to);
    console.log(`[rename] ${file} -> ${target}`);
    renamed++;
    }
  }
  if (!scanned) console.log('[rename] no nsis bundle dir yet, nothing to do');
  else if (renamed) console.log(`[rename] ${renamed} installer(s) renamed to the two-part version`);
  else console.log('[rename] installers already two-part');
} catch (e) {
  console.warn(`[rename] skipped: ${e.message}`);
  process.exit(0);
}

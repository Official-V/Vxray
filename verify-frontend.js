// Confirms the frontend embedded in a just-built binary is the source we wrote. The assets are
// Brotli-compressed and named by BLAKE3, so the only reliable check is decompress-and-compare.
// Stale vxray-rust-<hash> dirs accumulate and are never cleaned, and this tauri-codegen version
// writes no invoked.timestamp to disambiguate them, so every candidate dir is scanned and the one
// that matches the current sources byte-for-byte is the live one.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const repo = path.join(__dirname);
const srcDir = path.join(repo, 'src');
const triple = process.argv[2] || ''; // '' = x64 host build, 'i686-pc-windows-msvc' = 32-bit
const buildDir = path.join(repo, 'src-tauri', 'target', triple, 'release', 'build');

let dirs = [];
try { dirs = fs.readdirSync(buildDir).filter(d => d.startsWith('vxray-rust-')); }
catch (e) { console.log(`no build dir at ${buildDir}`); process.exit(0); }

const targets = ['app.js', 'i18n-strings.js', 'i18n-help.js', 'styles.css'];
const wanted = {};
for (const t of targets) wanted[t] = fs.readFileSync(path.join(srcDir, t));

let live = null;
for (const d of dirs) {
  const dir = path.join(buildDir, d, 'out', 'tauri-codegen-assets');
  let files;
  try { files = fs.readdirSync(dir); } catch (e) { continue; }
  const hits = [];
  for (const t of targets) {
    for (const f of files) {
      if (path.extname(f) !== path.extname(t)) continue;
      let raw;
      try { raw = zlib.brotliDecompressSync(fs.readFileSync(path.join(dir, f))); } catch (e) { continue; }
      if (raw.equals(wanted[t])) { hits.push(t); break; }
    }
  }
  if (hits.length) {
    console.log(`${d}  matched ${hits.length}/${targets.length}: ${hits.join(', ')}`);
    if (hits.length === targets.length) live = d;
  }
}
console.log(live ? `\nLIVE TREE: ${live} -- all four sources embedded byte-identically`
                : '\nNO asset tree carries the current frontend');
process.exitCode = live ? 0 : 1;

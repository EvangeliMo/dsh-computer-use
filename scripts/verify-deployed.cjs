/**
 * Verify the DEPLOYED plugin copy loads from its real profile location.
 *
 * This is the check that matters: if the host modules or the native helpers
 * cannot be resolved from the deployed path, the bundle would fail to load
 * inside the app. Finding that out here is much cheaper than after a restart.
 *
 * It also compares the deployed copy against the source tree, byte for byte.
 * The profile manifest declares this bundle as `link:<source>` while
 * `install.ps1` simultaneously copies it into `node_modules/`, so *which* tree
 * the host runs is not something this script can promise. Requiring the two to
 * be identical makes that ambiguity irrelevant; skipping the comparison is how
 * a verification passes while the host executes different code.
 *
 *   $env:ELECTRON_RUN_AS_NODE="1"
 *   & "<install>\DeepSeek Harness.exe" scripts\verify-deployed.cjs
 *
 * Pass a second argument to check a different source tree. The profile location
 * is derived from the environment (DSH_PROFILE_DIR, else USERPROFILE) so nothing
 * here is tied to one machine.
 */

'use strict';

const { createHash } = require('node:crypto');
const { existsSync, readdirSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

/**
 * Locate the deployed plugin inside the active profile.
 *
 * `DSH_PROFILE_DIR` is the authoritative value when this runs under the host;
 * `USERPROFILE` covers a plain shell.
 *
 * @returns {string} the expected deployed directory.
 */
function defaultDeployedDir() {
  const profileDir = process.env.DSH_PROFILE_DIR;
  // Unscoped, so pnpm (and install.ps1) place it directly under node_modules/,
  // and the patch's module name matches that directory name.
  const rel = ['node_modules', 'dsh-computer-use-mode'];
  if (profileDir) return join(profileDir, ...rel);
  const home = process.env.USERPROFILE ?? process.env.HOME;
  if (home) return join(home, '.dsh', 'profiles', 'desktop', ...rel);
  throw new Error('cannot locate the profile: set DSH_PROFILE_DIR or USERPROFILE, or pass the path as argument 1');
}

const deployed = process.argv[2] ?? defaultDeployedDir();
const source = process.argv[3] ?? join(__dirname, '..');

console.log(`deployed at: ${deployed}`);
for (const rel of ['lib/index.js', 'lib/loader.cjs', 'src/win32.cjs', 'src/capture.cjs', 'src/png.cjs', 'cordis.patch.yml', 'package.json']) {
  console.log(`  ${existsSync(join(deployed, rel)) ? 'ok  ' : 'MISS'} ${rel}`);
}
console.log('');

// ---------------------------------------------------------------------------
// The two trees must agree.
//
// This is the check that was missing. The profile manifest declares
// `dsh-computer-mode` as `link:<source>`, while `install.ps1` also copies the
// plugin into `node_modules/`. Which of the two the host actually resolves is
// an implementation detail that has already changed once 鈥?and if they drift
// apart, verifying only the copy reports success while the host runs different
// code. Comparing them removes the question entirely: identical trees make the
// ambiguity harmless, and a divergence is a loud failure either way.
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set(['node_modules', '.git', 'test-output']);

/**
 * Files that belong to the repository but not to a deployed plugin.
 *
 * Git metadata has no meaning inside `profiles/<id>/node_modules/<plugin>`, so
 * `install.ps1` does not copy it and this comparison must not require it.
 */
const SKIP_FILES = new Set(['.gitignore', '.gitattributes']);

function walk(root, dir = '') {
  const out = [];
  let entries;
  try {
    entries = readdirSync(join(root, dir), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const rel = dir ? join(dir, entry.name) : entry.name;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push(...walk(root, rel));
    } else if (entry.isFile()) {
      if (dir === '' && SKIP_FILES.has(entry.name)) continue;
      out.push(rel);
    }
  }
  return out;
}

const digest = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

console.log('[trees] source vs deployed copy');
console.log(`  source   : ${source}`);
console.log(`  deployed : ${deployed}`);

const missing = [];
const differing = [];
let compared = 0;
for (const rel of walk(source)) {
  const inDeployed = join(deployed, rel);
  if (!existsSync(inDeployed)) {
    missing.push(rel);
    continue;
  }
  compared += 1;
  if (digest(join(source, rel)) !== digest(inDeployed)) differing.push(rel);
}
const extra = walk(deployed).filter((rel) => !existsSync(join(source, rel)));

if (missing.length === 0 && differing.length === 0 && extra.length === 0) {
  console.log(`  OK   ${compared} file(s) byte-identical 鈥?it does not matter which tree the host loads`);
} else {
  if (differing.length > 0) {
    console.log(`  FAIL ${differing.length} file(s) differ between source and deployed copy:`);
    for (const rel of differing.slice(0, 10)) console.log(`         ${rel}`);
  }
  if (missing.length > 0) {
    console.log(`  FAIL ${missing.length} source file(s) missing from the deployed copy:`);
    for (const rel of missing.slice(0, 10)) console.log(`         ${rel}`);
  }
  if (extra.length > 0) {
    console.log(`  WARN ${extra.length} file(s) exist only in the deployed copy (stale leftovers):`);
    for (const rel of extra.slice(0, 10)) console.log(`         ${rel}`);
  }
  console.log('       Fix with: powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1');
  console.log('       Until then this verification proves nothing about the code the host will run.');
  process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// What the manifest says the host should load, and whether it can even boot.
// ---------------------------------------------------------------------------

const profileDir = join(deployed, '..', '..');
const manifestPath = join(profileDir, 'package.json');
console.log('\n[manifest] what the host will resolve');
if (!existsSync(manifestPath)) {
  console.log(`  WARN no profile manifest at ${manifestPath}`);
} else {
  const raw = readFileSync(manifestPath, 'utf8');
  if (raw.charCodeAt(0) === 0xfeff) {
    // dsh-host reads this with a bare JSON.parse(), so a BOM kills startup
    // before the window appears.
    console.log('  FAIL the manifest starts with a UTF-8 BOM 鈥?dsh-host will crash on startup');
    process.exitCode = 1;
  } else {
    console.log('  OK   manifest has no BOM');
  }
  try {
    const manifest = JSON.parse(raw.replace(/^\uFEFF/, ''));
    const spec = manifest?.dependencies?.['dsh-computer-use-mode'];
    console.log(`  spec : ${spec ?? '(not declared)'}`);
    if (typeof spec === 'string' && spec.startsWith('link:')) {
      const target = spec.slice('link:'.length).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
      const here = source.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
      console.log(
        target === here
          ? '  OK   the link target is the source tree verified above'
          : `  WARN the link points at ${spec.slice(5)}, which is NOT the tree verified above (${source})`,
      );
    }
    const bundled = manifest?.dsh?.profile?.bundles ?? [];
    if (!bundled.includes('dsh-computer-use-mode')) {
      console.log('  WARN dsh-computer-mode is not in dsh.profile.bundles, so it will not load');
      process.exitCode = 1;
    } else {
      console.log('  OK   listed in dsh.profile.bundles');
    }
  } catch (error) {
    console.log(`  FAIL the manifest is not valid JSON: ${error.message}`);
    process.exitCode = 1;
  }
}
console.log('');

const entry = join(deployed, 'lib', 'index.js');
let mod;
try {
  mod = require(entry);
  console.log('  OK   require(lib/index.js) succeeded');
  console.log(`       name=${mod.name} inject=[${(mod.inject ?? []).join(', ')}] Config=${typeof mod.Config} apply=${typeof mod.apply}`);
} catch (error) {
  console.log(`  FAIL require failed: ${error.message}`);
  console.log(error.stack?.split('\n').slice(0, 8).join('\n'));
  process.exitCode = 1;
  process.exit();
}

const registered = [];
const ctx = {
  logger: {
    info: (...a) => console.log(`       [info] ${a.join(' ')}`),
    warn: (...a) => console.log(`       [warn] ${a.join(' ')}`),
    error: (...a) => console.log(`       [error] ${a.join(' ')}`),
  },
  tools: { register: (t) => { registered.push(t); return () => {}; } },
  get: () => undefined,
};

try {
  mod.apply(ctx, {
    enabled: true,
    thumbnailMaxDimension: 1152,
    nativeMaxDimension: 1400,
    pngLevel: 6,
    maxBatchActions: 40,
    // The deployed preset ships outputDirectory: '', i.e. the OS temp directory.
    // Exercise exactly that, so this check proves the real write path works.
    outputDirectory: '',
  });
  console.log(`  OK   apply() registered ${registered.length} tool(s): ${registered.map((t) => t.name).join(', ')}`);
} catch (error) {
  console.log(`  FAIL apply() threw: ${error.message}`);
  console.log(error.stack?.split('\n').slice(0, 8).join('\n'));
  process.exitCode = 1;
  process.exit();
}

const computer = registered.find((t) => t.name === 'computer');

(async () => {
  try {
    const value = await computer.execute({ action: 'screen_info' }, {});
    console.log(`  OK   screen_info from deployed copy: ${value.screen.width}x${value.screen.height} dpi=${value.screen.dpi}`);
  } catch (error) {
    console.log(`  FAIL screen_info threw: ${error.message}`);
    process.exitCode = 1;
  }

  try {
    const value = await computer.execute({ action: 'screenshot', region: { x: 0, y: 0, width: 320, height: 200 } }, {});
    console.log(`  OK   screenshot from deployed copy: ${value.screenshot.width}x${value.screenshot.height} scale=${value.screenshot.scale}`);
  } catch (error) {
    console.log(`  FAIL screenshot threw: ${error.message}`);
    process.exitCode = 1;
  }

  // Prove the asar-hosted modules used by the tool pipeline really resolved
  // through the deployed loader rather than a leftover local node_modules.
  const loader = require(join(deployed, 'lib', 'loader.cjs'));
  const candidates = loader.installCandidates('koffi');
  console.log('\n  koffi resolution candidates:');
  for (const c of candidates) console.log(`    ${c}`);

  console.log(
    process.exitCode
      ? '\nDEPLOYMENT VERIFICATION FAILED'
      : '\nSource and deployed trees match, the manifest can boot, and the copy loads, registers and captures correctly.',
  );
})();

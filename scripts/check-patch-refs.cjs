// Verify every package name referenced by a patch file exists in the install.
//
// The manifest BOM crash is fixed, but a patch that names a package the
// installation does not ship would fail when the bundle loads. Checking the
// names against the asar header index is cheap and catches that before restart.
//
// Usage:
//   node scripts/check-patch-refs.cjs [path/to/app.asar] [path/to/cordis.patch.yml]
//
// Both default to values derived from this checkout and the running platform,
// so nothing here is tied to one machine.
const fs = require('node:fs');
const path = require('node:path');
const { execPath } = require('node:process');

/**
 * Best guess at the installation's app.asar.
 *
 * `process.resourcesPath` is the authoritative value under the Electron host and
 * accounts for the installation directory's name. `execPath` is the fallback for
 * a plain Node run.
 *
 * @returns {string|undefined} the path, when it can be derived.
 */
function defaultAsar() {
  if (process.resourcesPath) return path.join(process.resourcesPath, 'app.asar');
  if (execPath && /\.exe$/i.test(execPath)) {
    return path.join(path.dirname(execPath), 'resources', 'app.asar');
  }
  return undefined;
}

const asar = process.argv[2] ?? process.env.DSH_ASAR ?? defaultAsar();
const patch = process.argv[3] ?? path.join(__dirname, '..', 'cordis.patch.yml');

if (asar === undefined || !fs.existsSync(asar)) {
  console.error(
    `cannot locate app.asar${asar ? ` at ${asar}` : ''}. Pass it explicitly:\n` +
      '  node scripts/check-patch-refs.cjs "<install>/resources/app.asar"',
  );
  process.exit(2);
}

/**
 * Read raw bytes from the archive file itself.
 *
 * Electron patches `fs` so that any path ending in `.asar` is treated as a
 * container and the remainder is looked up *inside* it; reading the archive's own
 * header therefore fails with "ENOENT, not found in <...>.asar". `process.noAsar`
 * suspends that interception for the duration of the read.
 *
 * @param file - path to the asar archive.
 * @param length - bytes to read from the start.
 * @returns the requested bytes.
 */
function readArchiveHead(file, length) {
  const previous = process.noAsar;
  process.noAsar = true;
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(length);
      fs.readSync(fd, buf, 0, length, 0);
      return buf;
    } finally {
      fs.closeSync(fd);
    }
  } finally {
    process.noAsar = previous;
  }
}

const head = readArchiveHead(asar, 16);
const jsonSize = head.readUInt32LE(12);
const jsonBuf = readArchiveHead(asar, 16 + jsonSize).subarray(16);
const header = JSON.parse(jsonBuf.toString('utf8'));

// Package names available to a loader: the installation's node_modules plus the
// profile's own bundles, which are not in the asar.
const available = new Set();
const nm = header.files?.dsh?.files?.node_modules?.files ?? {};
for (const key of Object.keys(nm)) {
  if (key.startsWith('@')) {
    for (const sub of Object.keys(nm[key].files ?? {})) available.add(`${key}/${sub}`);
  } else {
    available.add(key);
  }
}
// Cordis built-ins and this plugin itself are resolved by the loader directly.
available.add('cordis:group');
available.add('dsh-computer-use');

const yaml = fs.readFileSync(patch, 'utf8');
// Only `name:` under a plugin/insert entry is a package reference. Keys such as
// the preset's display `name: 电脑操作模式` are not, so require a scoped,
// bare, or cordis: value.
const refs = [...yaml.matchAll(/^\s*name:\s*'?(@?[a-z0-9][a-z0-9@\-\.\/]*|cordis:[a-z]+)'?\s*$/gim)]
  .map((m) => m[1])
  .filter(Boolean);
const unique = [...new Set(refs)];

console.log(`patch file: ${path.basename(patch)}`);
console.log(`referenced names: ${unique.length}`);

/**
 * A reference resolves when its package root exists. Subpath exports such as
 * `@deepseek-ai/dsh-plugin-manager/tools` are valid as long as the package does,
 * which is how the shipped presets use them too.
 */
function resolves(ref) {
  if (available.has(ref)) return true;
  const parts = ref.split('/');
  if (ref.startsWith('@')) return available.has(parts.slice(0, 2).join('/'));
  return available.has(parts[0]);
}

const missing = unique.filter((n) => !resolves(n));
if (missing.length === 0) {
  console.log('ALL REFERENCED PACKAGES EXIST in the installation.');
} else {
  console.log('\nMISSING (would fail to load):');
  for (const m of missing) console.log(`  ${m}`);
  process.exitCode = 1;
}

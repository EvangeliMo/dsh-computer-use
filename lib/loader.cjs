/**
 * dsh-computer-use-mode — module loading helpers.
 *
 * Why this file exists
 * --------------------
 * `koffi` ships *inside* the installation's asar archive
 * (`<app>/resources/app.asar/dsh/node_modules/koffi`); only its prebuilt binary
 * is unpacked. Two consequences shaped this package:
 *
 * 1. The plugin must be CommonJS. CommonJS `require` goes through Electron's
 *    asar-aware resolver, so it finds `koffi` on the archive path. The ESM
 *    resolver does not, and also ignores `NODE_PATH` — an `import ... from
 *    'koffi'` fails with ERR_MODULE_NOT_FOUND even though `require` succeeds.
 * 2. Resolution must not depend on the plugin happening to sit below the
 *    installation directory. `dsh-hmr` copies client bundles around, and an
 *    upgrade rewrites the app directory, so we resolve `koffi` explicitly from
 *    the running executable's own layout with a plain-`require` fallback.
 */

'use strict';

const path = require('node:path');

/**
 * Absolute candidate locations for a package that ships inside the Harness
 * installation, derived from the running executable.
 *
 * @param {string} name - bare package name.
 * @returns {string[]} candidate directory paths, most specific first.
 */
function installCandidates(name) {
  const out = [];
  const executable = process.execPath;
  if (typeof executable === 'string' && executable.length > 0) {
    // process.execPath is <install>/DeepSeek Harness.exe, so <install> is its dir.
    const installRoot = path.dirname(executable);
    const resources = path.join(installRoot, 'resources');
    out.push(path.join(resources, 'app.asar.unpacked', 'dsh', 'node_modules', name));
    out.push(path.join(resources, 'app.asar', 'dsh', 'node_modules', name));
    out.push(path.join(resources, 'app', 'dsh', 'node_modules', name));
  }
  // Also try relative to this file: <plugin>/lib/loader.js -> <profile>/...
  out.push(path.join(__dirname, '..', 'node_modules', name));
  return out;
}

/**
 * Require a native dependency that the installation provides, trying explicit
 * install-relative paths before falling back to normal resolution.
 *
 * @param {string} name - bare package name.
 * @param {string} purpose - human-readable reason, used in the error message.
 * @returns {any} the loaded module.
 */
function requireFromInstall(name, purpose) {
  const attempts = [];

  for (const candidate of installCandidates(name)) {
    try {
      return require(candidate);
    } catch (error) {
      attempts.push(`${candidate}: ${error.code ?? error.message}`);
    }
  }

  try {
    return require(name);
  } catch (error) {
    attempts.push(`${name}: ${error.code ?? error.message}`);
  }

  throw new Error(
    `dsh-computer-use-mode: cannot load "${name}" (${purpose}). ` +
      `The Harness installation normally provides it. Attempts: ${attempts.join(' | ')}`,
  );
}

module.exports = { requireFromInstall, installCandidates };

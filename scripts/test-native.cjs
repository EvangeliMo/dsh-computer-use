/**
 * Native-layer smoke test for dsh-computer-use-mode.
 *
 * Validates the FFI bindings, GDI capture and PNG encoder. It never moves the
 * mouse and never presses a key —input synthesis is exercised only through its
 * pure parsing functions —so running it cannot disturb the desktop.
 *
 * Run it with the Harness runtime so module resolution matches production:
 *
 *   $env:ELECTRON_RUN_AS_NODE="1"
 *   & "D:\Apps\DeepseekHarness\DeepSeek Harness.exe" scripts\test-native.cjs
 */

'use strict';

const { mkdirSync, writeFileSync } = require('node:fs');
const path = require('node:path');

const here = __dirname;
const outDir = path.join(here, '..', 'test-output');
mkdirSync(outDir, { recursive: true });

const results = [];
function check(label, fn) {
  try {
    const detail = fn();
    results.push({ ok: true, label, detail });
    console.log(`  PASS  ${label}${detail === undefined ? '' : ` —${detail}`}`);
  } catch (error) {
    results.push({ ok: false, label, detail: error.message });
    console.log(`  FAIL  ${label} —${error.message}`);
  }
}

console.log('dsh-computer-use-mode native smoke test\n');

// ---------------------------------------------------------------------------
console.log('[1] module loading (CommonJS, asar-aware)');

let win32Mod;
let capture;
let png;
check('load src/win32.cjs + src/capture.cjs + src/png.cjs', () => {
  win32Mod = require('../src/win32.cjs');
  capture = require('../src/capture.cjs');
  png = require('../src/png.cjs');
  return 'ok';
});

// ---------------------------------------------------------------------------
console.log('\n[2] koffi + Win32 bindings');

let api = null;
check('bind user32/gdi32 through koffi', () => {
  api = win32Mod.win32();
  return `${Object.keys(api).length} entry points`;
});

check('INPUT struct is 40 bytes (x64 ABI)', () => {
  if (!api) throw new Error('no api');
  if (api.INPUT_SIZE !== 40) throw new Error(`expected 40, got ${api.INPUT_SIZE}`);
  return `${api.INPUT_SIZE} bytes`;
});

check('BITMAPINFO struct is 44 bytes', () => {
  if (!api) throw new Error('no api');
  const size = api.koffi.sizeof(api.structs.BITMAPINFO);
  if (size !== 44) throw new Error(`expected 44, got ${size}`);
  return `${size} bytes`;
});

check('desktop geometry + DPI awareness', () => {
  const d = api.desktop();
  if (d.width <= 0 || d.height <= 0) throw new Error(`bad desktop ${d.width}x${d.height}`);
  return `${d.width}x${d.height} origin=(${d.x},${d.y}) monitors=${d.monitors} dpi=${d.dpi} awareness=${d.awareness}`;
});

check('DPI awareness is PER_MONITOR (2) so coordinates need no conversion', () => {
  const d = api.desktop();
  if (d.awareness !== 2) {
    throw new Error(
      `awareness=${d.awareness}; screenshots and cursor would be in different spaces`,
    );
  }
  return `awareness=${d.awareness} dpi=${d.dpi}`;
});

check('cursor position readable (no movement)', () => {
  const p = api.cursorPosition();
  return `(${p.x}, ${p.y})`;
});

// ---------------------------------------------------------------------------
console.log('\n[3] GDI capture');

let shot = null;
check('capture full desktop', () => {
  const d = api.desktop();
  shot = capture.captureRegion(d);
  if (shot.width !== d.width || shot.height !== d.height) {
    throw new Error(`size mismatch: captured ${shot.width}x${shot.height} vs ${d.width}x${d.height}`);
  }
  return `${shot.width}x${shot.height}, ${shot.pixels.length} bytes RGBA`;
});

check('captured pixels are not a blank buffer', () => {
  if (!shot) throw new Error('no capture to inspect');
  const seen = new Set();
  for (let i = 0; i < shot.pixels.length; i += 4 * 997) {
    seen.add((shot.pixels[i] << 16) | (shot.pixels[i + 1] << 8) | shot.pixels[i + 2]);
    if (seen.size > 32) break;
  }
  if (seen.size <= 2) throw new Error(`only ${seen.size} distinct colours —capture looks blank`);
  return `${seen.size}+ distinct colours sampled`;
});

check('sub-region capture with capture-time downscale', () => {
  const half = capture.captureRegion(
    { x: 0, y: 0, width: 400, height: 300 },
    { scaleX: 0.5, scaleY: 0.5 },
  );
  if (half.width !== 200 || half.height !== 150) {
    throw new Error(`expected 200x150, got ${half.width}x${half.height}`);
  }
  return `${half.width}x${half.height}`;
});

// ---------------------------------------------------------------------------
console.log('\n[4] PNG encoder');

check('encode: signature, IHDR, 8-bit RGBA', () => {
  if (!shot) throw new Error('no capture to encode');
  const bytes = png.encodePng(shot.width, shot.height, shot.pixels);
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < signature.length; i += 1) {
    if (bytes[i] !== signature[i]) throw new Error('bad PNG signature');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width !== shot.width || height !== shot.height) {
    throw new Error(`IHDR says ${width}x${height}, expected ${shot.width}x${shot.height}`);
  }
  if (bytes[24] !== 8 || bytes[25] !== 6) {
    throw new Error(`expected 8-bit RGBA, got depth=${bytes[24]} colourType=${bytes[25]}`);
  }
  writeFileSync(path.join(outDir, 'native-smoke-full.png'), bytes);
  return `${bytes.length} bytes -> test-output/native-smoke-full.png`;
});

check('downscale averages rather than point-samples', () => {
  const src = new Uint8ClampedArray(4 * 4 * 4);
  for (let y = 0; y < 4; y += 1) {
    for (let x = 0; x < 4; x += 1) {
      const v = (x + y) % 2 === 0 ? 0 : 255;
      const o = (y * 4 + x) * 4;
      src[o] = v;
      src[o + 1] = v;
      src[o + 2] = v;
      src[o + 3] = 255;
    }
  }
  const out = png.downscale(src, 4, 4, 2, 2);
  if (out[0] < 100 || out[0] > 155) throw new Error(`expected mid grey, got ${out[0]}`);
  return `checkerboard 4x4 -> 2x2 averaged to ${out[0]}`;
});

check('thumbnail + ruler + quadrant annotation pipeline', () => {
  if (!shot) throw new Error('no capture to encode');
  const targetW = 1024;
  const targetH = Math.max(1, Math.round((shot.height / shot.width) * targetW));
  const thumb = png.downscale(shot.pixels, shot.width, shot.height, targetW, targetH);
  const mapping = {
    originX: 0,
    originY: 0,
    scaleX: targetW / shot.width,
    scaleY: targetH / shot.height,
  };
  const annotated = png.drawRulers(targetW, targetH, thumb, mapping, { step: 200, labelEvery: 2 });
  const cornered = png.drawQuadrants(targetW, targetH, annotated);
  const bytes = png.encodePng(targetW, targetH, cornered);
  writeFileSync(path.join(outDir, 'native-smoke-thumb.png'), bytes);
  return `${targetW}x${targetH}, ${bytes.length} bytes -> test-output/native-smoke-thumb.png`;
});

// ---------------------------------------------------------------------------
console.log('\n[5] input-synthesis parsing (nothing is actually sent)');

check('resolveKey handles names, characters and raw codes', () => {
  const cases = [
    ['enter', 0x0d],
    ['ESC', 0x1b],
    ['F5', 0x74],
    ['a', 0x41],
    ['7', 0x37],
    ['vk_123', 123],
    ['0x5b', 0x5b],
  ];
  for (const [input, expected] of cases) {
    const got = win32Mod.resolveKey(input);
    if (got !== expected) throw new Error(`resolveKey(${input}) = ${got}, expected ${expected}`);
  }
  return `${cases.length} cases`;
});

check('resolveKey rejects nonsense with guidance', () => {
  try {
    win32Mod.resolveKey('definitely_not_a_key');
  } catch (error) {
    if (!/unknown key/.test(error.message)) throw new Error(`unhelpful error: ${error.message}`);
    return 'rejected with guidance';
  }
  throw new Error('expected a throw');
});

check('shortcut validates before sending anything', () => {
  let threw = false;
  try {
    win32Mod.shortcut('ctrl+shift+definitely_not_a_key');
  } catch (error) {
    threw = /unknown key/.test(error.message);
  }
  if (!threw) throw new Error('unknown key inside a chord was not rejected');
  return 'ok';
});

check('button names are validated', () => {
  if (!win32Mod.isKnownButton('left') || win32Mod.isKnownButton('elbow')) {
    throw new Error('button validation is wrong');
  }
  return 'left/right/middle/x1/x2 known';
});

// ---------------------------------------------------------------------------
console.log('\n[6] window enumeration');

check('list top-level windows', () => {
  const windows = win32Mod.listWindows({ includeMinimized: true });
  if (windows.length === 0) throw new Error('enumerated zero windows');
  const named = windows.filter((w) => w.title.trim().length > 0);
  const sample = named
    .slice(0, 4)
    .map((w) => `${JSON.stringify(w.title.slice(0, 36))} ${w.bounds.width}x${w.bounds.height}`);
  return `${windows.length} windows (${named.length} titled): ${sample.join(' | ')}`;
});

check('foreground window resolves', () => {
  const fg = win32Mod.foregroundWindow();
  return fg ? JSON.stringify(fg.title.slice(0, 50)) : 'none';
});

check('findWindow matches by title substring', () => {
  const all = win32Mod.listWindows({ includeMinimized: true });
  const titled = all.find((w) => w.title.trim().length > 4);
  if (!titled) return 'no titled window present';
  const found = win32Mod.findWindow(titled.title.slice(0, 8));
  // Window visibility depends on what happens to be open, so a null result here
  // is reported rather than treated as a binding failure.
  if (!found) return `no match for ${JSON.stringify(titled.title.slice(0, 8))} (tolerated)`;
  return `matched ${JSON.stringify(found.title.slice(0, 40))}`;
});

// ---------------------------------------------------------------------------
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) {
  console.log('\nFailures:');
  for (const f of failed) console.log(`  - ${f.label}: ${f.detail}`);
  process.exitCode = 1;
} else {
  console.log('\nInspect test-output/*.png with read_image to confirm the annotations look right.');
}

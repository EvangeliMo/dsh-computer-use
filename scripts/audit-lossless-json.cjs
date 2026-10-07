// Exhaustive lossless-JSON audit.
//
// The registry validates every tool result with a strict walker and kills the
// whole call when it fails, so this walks every action and both tools, under
// several configurations, and reports any result that would be rejected.
//
// Run under the host runtime: ELECTRON_RUN_AS_NODE=1 "<DeepSeek Harness.exe>" this
'use strict';

const path = require('node:path');
const os = require('node:os');

const pluginDir = process.argv[2];
const mod = require(path.join(pluginDir, 'lib', 'index.js'));

/** Port of the registry's walkJsonValue: returns a problem description or null. */
function losslessJsonProblem(value) {
  const ancestors = new Set();
  const stack = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === null) continue;
    const type = typeof current;
    if (type === 'boolean' || type === 'string') continue;
    if (type === 'number') {
      if (!Number.isFinite(current)) return `non-finite number ${current}`;
      if (Object.is(current, -0)) return '-0 (stringifies to 0)';
      continue;
    }
    if (type !== 'object') return `${type} value (JSON drops or mangles it)`;
    if (ancestors.has(current)) return 'circular reference';
    if (Array.isArray(current)) {
      if (Object.getPrototypeOf(current) !== Array.prototype) return 'array with non-plain prototype';
      for (let i = 0; i < current.length; i += 1) {
        if (!Object.prototype.hasOwnProperty.call(current, i)) return `sparse array at ${i}`;
      }
      ancestors.add(current);
      for (const item of current) stack.push(item);
      continue;
    }
    const proto = Object.getPrototypeOf(current);
    if (proto !== Object.prototype && proto !== null) {
      return `non-plain object (${current.constructor?.name ?? 'unknown'})`;
    }
    for (const key of Object.getOwnPropertyNames(current)) {
      if (!Object.getOwnPropertyDescriptor(current, key)?.enumerable) {
        return `non-enumerable key "${key}"`;
      }
    }
    for (const key of Object.keys(current)) {
      if (current[key] === undefined) return `property "${key}" is undefined`;
      stack.push(current[key]);
    }
  }
  return null;
}

const configs = [
  { name: 'defaults', value: { enabled: true, outputDirectory: os.tmpdir() } },
  {
    name: 'all-optional-omitted',
    value: { enabled: true, outputDirectory: '' },
  },
  {
    name: 'scale-down',
    value: { enabled: true, nativeMaxDimension: 300, pngLevel: 1, outputDirectory: os.tmpdir() },
  },
  {
    name: 'batch-1',
    value: { enabled: true, maxBatchActions: 1, outputDirectory: os.tmpdir() },
  },
];

/** Every action, with the arguments a model would plausibly send. */
const actions = [
  { action: 'screen_info' },
  { action: 'cursor' },
  { action: 'windows' },
  { action: 'windows', includeFiltered: true },
  { action: 'windows', titlesOnly: true },
  { action: 'windows', includeMinimized: true },
  { action: 'screenshot' },
  { action: 'screenshot', grid: true, quadrants: true },
  { action: 'screenshot', region: { x: 0, y: 0, width: 200, height: 150 } },
  { action: 'screenshot', region: { x: 0, y: 0, width: 200, height: 150 }, grid: false },
  { action: 'screenshot', region: { x: 0, y: 0, width: 300, height: 240 }, tiles: '2x2' },
  { action: 'screenshot', region: { x: 0, y: 0, width: 600, height: 480 }, tiles: '3x3' },
  { action: 'screenshot', scale: 0.5 },
  { action: 'screenshot', monitor: 0 },
  { action: 'sleep', ms: 1 },
  { action: 'cursor' },
  { action: 'waitForChange', timeoutMs: 60, region: { x: 0, y: 0, width: 80, height: 60 } },
  { action: 'waitUntilStable', timeoutMs: 60, region: { x: 0, y: 0, width: 80, height: 60 } },
];

/** Actions that must fail, to check the failure envelopes too. */
const failing = [
  { action: 'click', x: 99999, y: 99999 },
  { action: 'click' },
  { action: 'screenshot', region: { x: 0, y: 0, width: 0, height: 0 } },
  { action: 'focus_window', title: 'no such window title __xyzzy__' },
  { action: 'move' },
  { action: 'drag', x: 5, y: 5 },
  { action: 'type', text: '' },
  { action: 'shortcut', keys: [] },
  { action: 'key', key: 'NotAKey' },
  { action: 'screenshot', tiles: '2x2' },
  { action: 'tiles' },
  { action: 'unknown-action' },
  { action: 'scroll', amount: 'nonsense' },
  { action: 'windows', window: 999999 },
];

const failures = [];
let checked = 0;

function audit(label, value) {
  checked += 1;
  const problem = losslessJsonProblem(value);
  if (problem !== null) failures.push(`${label}: ${problem}`);
}

(async () => {
  for (const cfg of configs) {
    const registered = [];
    const sections = [];
    mod.apply(
      {
        logger: { info() {}, warn() {}, error() {} },
        tools: { register: (t) => (registered.push(t), () => {}) },
        get(key) {
          if (key === 'systemPrompt') {
            return { section: (s) => (sections.push(s), () => {}), getSectionOrder: () => 3000 };
          }
          return undefined;
        },
      },
      cfg.value,
    );

    const computer = registered.find((t) => t.name === 'computer');
    const batch = registered.find((t) => t.name === 'computer_batch');
    const exec = {};

    // The prompt section text is model-facing too.
    for (const section of sections) audit(`[${cfg.name}] prompt section`, { text: section.text({}) });

    for (const args of actions) {
      try {
        audit(`[${cfg.name}] computer ${JSON.stringify(args)}`, await computer.execute(args, exec));
      } catch (error) {
        audit(`[${cfg.name}] computer ${JSON.stringify(args)} THREW`, { message: error.message });
      }
    }
    for (const args of failing) {
      try {
        const value = await computer.execute(args, exec);
        audit(`[${cfg.name}] computer ${JSON.stringify(args)} (no throw)`, value);
      } catch (error) {
        // The registry never sees a throwing call, but the message is model-facing.
        audit(`[${cfg.name}] computer ${JSON.stringify(args)} THREW`, { message: error.message });
      }
    }

    const batches = [
      { actions: [{ action: 'cursor' }, { action: 'screen_info' }] },
      { actions: [{ action: 'screenshot', region: { x: 0, y: 0, width: 120, height: 90 } }] },
      { actions: [{ action: 'screenshot' }, { action: 'cursor' }] },
      { actions: [{ action: 'sleep', sleep: 1 }, { action: 'screen_info' }] },
      { actions: [{ action: 'click', x: 99999, y: 99999 }, { action: 'screen_info' }] },
      { actions: [{ action: 'unknown-action' }] },
    ];
    for (const args of batches) {
      try {
        audit(`[${cfg.name}] batch ${JSON.stringify(args)}`, await batch.execute(args, exec));
      } catch (error) {
        audit(`[${cfg.name}] batch ${JSON.stringify(args)} THREW`, { message: error.message });
      }
    }

    // Explicitly exercise the first-capture-of-an-area path, the original defect.
    const first = await computer.execute(
      { action: 'screenshot', region: { x: 0, y: 0, width: 111, height: 77 } },
      exec,
    );
    audit(`[${cfg.name}] first-capture-of-region`, first);
  }

  console.log(`configurations : ${configs.length}`);
  console.log(`results audited: ${checked}`);
  if (failures.length === 0) {
    console.log('\nNO non-lossless-JSON result found. Every audited result survives the registry walker.');
  } else {
    console.log(`\n${failures.length} PROBLEM(S):`);
    for (const line of failures) console.log(`  - ${line}`);
    process.exitCode = 1;
  }
})().catch((error) => {
  console.log('AUDIT FAILED:', error.stack);
  process.exitCode = 1;
});

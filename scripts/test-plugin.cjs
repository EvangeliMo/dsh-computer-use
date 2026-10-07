/**
 * Plugin-level smoke test for dsh-computer-use.
 *
 * Loads lib/index.js with a stub Cordis context, confirms the registry accepts
 * our tool definitions, then runs real actions.
 *
 * The most important check here is `the image reference SURVIVES the dispatcher
 * snapshot`: the tool registry JSON-snapshots and deep-freezes a tool's value
 * BEFORE calling output.render, so any image reference that is not plain
 * enumerable JSON inside the declared schema is silently dropped. That failure
 * shipped once and produced text with no image.
 *
 *   $env:ELECTRON_RUN_AS_NODE="1"
 *   & "D:\Apps\Deepseek Harness\DeepSeek Harness.exe" scripts\test-plugin.cjs
 */

'use strict';

const { mkdirSync, readFileSync, statSync } = require('node:fs');
const { join } = require('node:path');

const here = __dirname;
const pluginRoot = join(here, '..');
const outDir = join(pluginRoot, 'test-output');
mkdirSync(outDir, { recursive: true });

const results = [];
function record(ok, label, detail) {
  results.push({ ok, label, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : ` - ${detail}`}`);
}
function check(label, fn) {
  try {
    record(true, label, fn());
  } catch (error) {
    record(false, label, error.message);
  }
}
async function checkAsync(label, fn) {
  try {
    record(true, label, await fn());
  } catch (error) {
    record(false, label, error.message);
  }
}

/**
 * Reproduce the dispatcher's exact order of operations before `render`.
 *
 * `dsh-tools` calls `snapshotToolValue` (a JSON round-trip), validates the
 * result, then deep-freezes it, and only THEN calls `output.render` with the
 * detached copy. Anything non-enumerable is gone at that point.
 *
 * @param {unknown} value - the value returned by `execute`.
 * @returns {any} the snapshot the registry would hand to `render`.
 */
function dispatchSnapshot(value) {
  const snap = JSON.parse(JSON.stringify(value));
  const freeze = (node) => {
    if (node && typeof node === 'object') {
      Object.values(node).forEach(freeze);
      Object.freeze(node);
    }
    return node;
  };
  return freeze(snap);
}

/** Strip comments so a "no longer used" assertion tests code, not prose. */
function executableSource() {
  return readFileSync(join(pluginRoot, 'lib', 'index.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

async function main() {
  console.log('dsh-computer-use plugin smoke test\n');

  // -------------------------------------------------------------------------
  console.log('[1] module surface');

  const mod = require('../lib/index.js');

  check('exports name / inject / Config / apply', () => {
    if (typeof mod.name !== 'string') throw new Error('missing name');
    if (!Array.isArray(mod.inject)) throw new Error('missing inject');
    if (typeof mod.Config !== 'function' && typeof mod.Config !== 'object') throw new Error('missing Config');
    if (typeof mod.apply !== 'function') throw new Error('missing apply');
    return `name=${mod.name} inject=[${mod.inject.join(', ')}]`;
  });

  // -------------------------------------------------------------------------
  console.log('\n[2] Config validation');

  const config = mod.Config({
    enabled: true,
    fullMaxDimension: 4096,
    nativeMaxDimension: 1400,
    pngLevel: 6,
    maxBatchActions: 40,
    outputDirectory: outDir,
  });
  check('Config accepts a full explicit config', () => 'validated');

  check('captures default to native resolution, not a shrink target', () => {
    if (config.fullMaxDimension < 4096) {
      throw new Error(`fullMaxDimension ${config.fullMaxDimension} would downscale a normal desktop`);
    }
    return `fullMaxDimension=${config.fullMaxDimension} (safety cap only)`;
  });

  // -------------------------------------------------------------------------
  console.log('\n[3] registration against a stub context');

  const registered = [];
  const sections = [];
  const logs = [];

  const attachmentsStore = {
    async saveImage({ data, mediaType, name }) {
      return {
        attachmentId: `att-${registered.length}-${name ?? 'x'}`,
        mediaType,
        bytes: data.length,
        width: 0,
        height: 0,
        name,
      };
    },
  };

  /**
   * Build a context that enforces Cordis's service-access guard.
   *
   * A plain object stub cannot catch this class of bug: Cordis throws
   * `cannot get property "<name>" without inject` when a plugin reads a service
   * as a bare property it did not declare in `inject`. This package injects only
   * `tools`, so reads of `agent`, `attachments` or `systemPrompt` must go through
   * `ctx.get(...)`. One such bare read (`ctx.agent`) shipped and broke tool
   * assembly in production, because the stub happily returned undefined.
   *
   * Known service names are declared here so the guard fires only for services
   * the plugin did not inject, exactly as the real runtime behaves.
   *
   * @param attached - the services this plugin legitimately injects.
   * @param options - optional overrides.
   * @param options.sink - array to collect registered tools into (default: `registered`).
   * @param options.llm - value for the `llm` service, so a test can drive the
   *   image-capability gate without reaching into the plugin.
   * @returns a guarded context object.
   */
  function guardedContext(attached, options = {}) {
    const services = new Map(Object.entries(attached));
    if (options.llm !== undefined) services.set('llm', options.llm);
    const sink = options.sink ?? registered;
    const target = {
      logger: {
        info: (...a) => logs.push(['info', a.join(' ')]),
        warn: (...a) => logs.push(['warn', a.join(' ')]),
        error: (...a) => logs.push(['error', a.join(' ')]),
      },
      tools: {
        register: (tool) => {
          sink.push(tool);
          return () => {};
        },
      },
      get(key) {
        if (key === 'attachments') return attachmentsStore;
        if (key === 'systemPrompt') {
          return {
            section: (s) => {
              sections.push(s);
              return () => {};
            },
            getSectionOrder: (n) => (n === 'TOOL_COMPUTER_USE' ? 3000 : undefined),
          };
        }
        return services.get(key);
      },
    };

    // Services a plugin may read as a property only when it injected them.
    const GUARDED = ['agent', 'sessionProjections', 'llm', 'fs', 'commands', 'userQuestions'];
    return new Proxy(target, {
      get(obj, prop, receiver) {
        if (typeof prop === 'string' && GUARDED.includes(prop) && !services.has(prop)) {
          throw new Error(`cannot get property "${prop}" without inject`);
        }
        return Reflect.get(obj, prop, receiver);
      },
      has(obj, prop) {
        return Reflect.has(obj, prop);
      },
    });
  }

  const ctx = guardedContext({ tools: true });

  check('apply() runs without throwing', () => {
    mod.apply(ctx, config);
    return `${registered.length} tool(s), ${sections.length} prompt section(s)`;
  });

  check('apply() never reads a service it did not inject', () => {
    // Re-run against a fresh guarded context: any bare read of a guarded service
    // throws out of apply() and fails this check. This is the regression test for
    // the `ctx.agent` bug, whose symptom was a hard failure of the session's tool
    // assembly rather than a log line.
    //
    // The side effects of the re-run are rolled back so later assertions still see
    // exactly one registration pass.
    const savedTools = registered.length;
    const savedSections = sections.length;
    registered.length = 0;
    sections.length = 0;
    let threw = null;
    try {
      mod.apply(guardedContext({ tools: true }), config);
    } catch (error) {
      threw = error.message;
    } finally {
      registered.length = savedTools;
      sections.length = savedSections;
    }
    if (threw) throw new Error(`apply() threw under the access guard: ${threw}`);
    return 'no un-injected service reads';
  });

  check('registered exactly `computer` and `computer_batch`', () => {
    const names = registered.map((t) => t.name).sort();
    if (names.join(',') !== 'computer,computer_batch') throw new Error(`got ${names.join(',')}`);
    return names.join(', ');
  });

  check('tool definitions carry the required fields', () => {
    for (const tool of registered) {
      if (typeof tool.description !== 'string' || tool.description.length < 50) {
        throw new Error(`${tool.name}: description too short`);
      }
      if (typeof tool.execute !== 'function') throw new Error(`${tool.name}: no execute`);
      if (!tool.output || typeof tool.output.render !== 'function') throw new Error(`${tool.name}: no output.render`);
      if (tool.output.schema?.type !== 'object') throw new Error(`${tool.name}: output schema not an object root`);
      if (!tool.parameters || Object.keys(tool.parameters).length === 0) throw new Error(`${tool.name}: no parameters`);
    }
    return registered.map((t) => `${t.name}(${Object.keys(t.parameters).length} params)`).join(', ');
  });

  check('prompt section uses the reserved TOOL_COMPUTER_USE slot', () => {
    if (sections.length !== 1) throw new Error(`expected 1 section, got ${sections.length}`);
    const s = sections[0];
    if (s.name !== 'computer:policy') throw new Error(`unexpected section name ${s.name}`);
    if (s.order !== 3000) throw new Error(`expected order 3000, got ${s.order}`);
    const text = s.text({});
    if (typeof text !== 'string' || text.length < 100) throw new Error('section text is not usable');
    return `${s.name} @ ${s.order}, ${text.length} chars`;
  });

  check('the prompt stays a policy note, not a second manual', () => {
    // The tool description is where capability belongs, and it is read on demand.
    // This section is loaded on *every* turn, so anything that merely restates a
    // tool fact is a permanent context tax. The budget keeps that honest: it was
    // 2.8k of duplicated coordinate and waiting advice before this check existed.
    const text = sections[0].text({});
    // Safety rules and the application-launch order are exempt from trimming:
    // neither can be expressed as a tool fact. The ceiling exists to stop the
    // section drifting back into a second manual, so it sits well above what the
    // policy actually needs rather than at the byte.
    //
    // Raised from 2200 to 2350 when the "one failing tool is not a failed mode"
    // rule was added. That rule took the section to 2193 -- within the old budget,
    // but seven characters from it, which turns every later wording change into a
    // test failure and invites trimming the rule that matters to satisfy a number
    // picked when the section was shorter. The ceiling still catches drift: it is
    // well below the 2.8k of duplicated advice this check was written to remove.
    const BUDGET = 2350;
    if (text.length > BUDGET) {
      throw new Error(
        `the policy section is ${text.length} chars, over the ${BUDGET} budget. ` +
          'Move tool facts into the tool description instead of restating them here.',
      );
    }
    // Facts that belong to the tool description must not reappear here.
    for (const fact of ['add the region origin', 'native resolution']) {
      if (text.toLowerCase().includes(fact)) {
        throw new Error(`"${fact}" is a tool description fact, not a policy rule`);
      }
    }
    // The rule that a single failing tool must not end GUI work, and must not be
    // routed around by editing files on disk. Stated as an assertion because the
    // behaviour it prevents -- an agent abandoning the mode and rewriting files
    // with a shell command instead -- is silent when the guidance goes missing.
    if (!/not a failed mode/i.test(text) || !/shell command/i.test(text)) {
      throw new Error('the policy no longer tells the model to keep using the interface when one tool fails');
    }
    return `${text.length} chars (budget ${BUDGET}), no restated tool facts`;
  });

  check('no error-level logs during registration', () => {
    const errors = logs.filter(([level]) => level === 'error');
    if (errors.length > 0) throw new Error(errors.map((e) => e[1]).join(' | '));
    return logs.map(([l, m]) => `${l}: ${m.slice(0, 50)}`).join(' / ') || 'no logs';
  });

  check('image references are enumerable JSON, not a side channel', () => {
    const code = executableSource();
    if (/defineProperty\(|Symbol\(/.test(code)) {
      throw new Error('a non-enumerable/Symbol channel is still used; the snapshot would strip it');
    }
    if (!/images:/.test(code)) throw new Error('no `images` field is produced');
    return 'plain enumerable `images` array only';
  });

  check('no WeakMap-based delivery path remains', () => {
    const code = executableSource();
    if (/pendingImages/.test(code)) throw new Error('a pendingImages WeakMap is still executed');
    if (/projectContent/.test(code)) throw new Error('projectContent is still used in code');
    return 'delivery goes through output.render only';
  });

  check('tool output schema tolerates the image-free envelope', () => {
    for (const tool of registered) {
      const plain = { status: 'ok', message: 'no image here', images: [] };
      const blocks = tool.output.render({}, plain);
      if (!Array.isArray(blocks) || blocks[0]?.type !== 'text') {
        throw new Error(`${tool.name}: render did not produce a text block`);
      }
      if (blocks.some((b) => b.type === 'image')) {
        throw new Error(`${tool.name}: produced an image block from a value with no images`);
      }
    }
    return 'no images -> text only';
  });

  // -------------------------------------------------------------------------
  console.log('\n[3c] image-capability gate');

  /**
   * Build a context whose `llm` service reports the given input modalities, and
   * an execution context whose agent reports the given route.
   *
   * @param modalities - the model's declared input modalities, or undefined.
   * @returns `{ctx, exec}` for passing to a tool's execute.
   */
  function capabilityHarness(modalities) {
    const sink = [];
    const gateCtx = guardedContext(
      { tools: true },
      {
        sink,
        llm: {
          resolveModelInfo: async () =>
            modalities === undefined ? {} : { inputModalities: modalities },
        },
      },
    );
    mod.apply(gateCtx, config);
    const agent = { options: { provider: 'test', model: 'test-model' }, session: undefined };
    return { tools: sink, exec: { agent } };
  }

  await checkAsync('a capture is REFUSED when the model cannot accept images', async () => {
    const { tools, exec } = capabilityHarness(['text']);
    const tool = tools.find((t) => t.name === 'computer');
    let message = null;
    try {
      await tool.execute({ action: 'screenshot' }, exec);
    } catch (error) {
      message = error.message;
    }
    if (!message) throw new Error('a screenshot was attempted for a text-only model');
    if (!/does not|cannot capture|no image support/i.test(message)) {
      throw new Error(`unhelpful refusal: ${message}`);
    }
    // The message must name the cause and the remedy, or the user is back to guessing.
    if (!/test-model/.test(message)) throw new Error('the refusal does not name the model');
    if (!/image input/i.test(message)) throw new Error('the refusal does not say what is missing');
    return message.slice(0, 80);
  });

  await checkAsync('the same call proceeds when the model accepts images', async () => {
    const { tools, exec } = capabilityHarness(['text', 'image']);
    const tool = tools.find((t) => t.name === 'computer');
    const value = await tool.execute(
      { action: 'screenshot', region: { x: 0, y: 0, width: 160, height: 120 } },
      exec,
    );
    if (!Array.isArray(value.images) || value.images.length !== 1) {
      throw new Error('an image-capable model did not get its capture');
    }
    return `${value.screenshot.width}x${value.screenshot.height} delivered`;
  });

  await checkAsync('an unresolvable route is tolerated, not fatal', async () => {
    // No exec.agent at all: capability is unknown, so the capture must still work.
    const { tools } = capabilityHarness(['text']);
    const tool = tools.find((t) => t.name === 'computer');
    const value = await tool.execute(
      { action: 'screenshot', region: { x: 0, y: 0, width: 120, height: 90 } },
      {},
    );
    if (!value.screenshot) throw new Error('capture was refused without a resolvable route');
    return 'unknown route still captures';
  });

  await checkAsync('a batch containing a capture is refused up front', async () => {
    const { tools, exec } = capabilityHarness(['text']);
    const tool = tools.find((t) => t.name === 'computer_batch');
    let message = null;
    try {
      await tool.execute({ actions: [{ action: 'cursor' }, { action: 'screenshot' }] }, exec);
    } catch (error) {
      message = error.message;
    }
    if (!message) throw new Error('a batch with a capture ran for a text-only model');
    return 'refused before running any step';
  });

  // -------------------------------------------------------------------------
  console.log('\n[3d] lossless-JSON contract');

  /**
   * Port of the tool registry's strict walker (`walkJsonValue` in dsh-tools).
   *
   * Every tool result is validated with this before it is recorded, and a value
   * that fails kills the entire call with "invalid output: value is not lossless
   * JSON". The walker rejects more than JSON.stringify does:
   *
   *   - `undefined` as an object value, because JSON *drops* the key, so the
   *     round-trip loses it -- this is what broke a real capture on a user's
   *     machine when `meta.changed` was assigned `undefined` on the first
   *     screenshot of an area;
   *   - `NaN`, `Infinity` and `-0`, which stringify to null, null and 0;
   *   - anything whose prototype is not a plain object (Date, class instances);
   *   - symbols, and non-enumerable own keys.
   *
   * Checking with this rather than with `JSON.stringify` is the whole point: a
   * stringify-based test passes on a value the registry rejects.
   *
   * @param value - the candidate result.
   * @returns an error description, or null when the value is lossless JSON.
   */
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
      if (type !== 'object') return `${type} value (JSON.stringify drops or mangles it)`;
      if (ancestors.has(current)) return 'circular reference';
      if (Array.isArray(current)) {
        if (Object.getPrototypeOf(current) !== Array.prototype) return 'array with a non-plain prototype';
        // A hole does not survive either.
        for (let index = 0; index < current.length; index += 1) {
          if (!Object.prototype.hasOwnProperty.call(current, index)) return `sparse array at index ${index}`;
        }
        ancestors.add(current);
        for (const item of current) stack.push(item);
        continue;
      }
      if (Object.getPrototypeOf(current) !== Object.prototype && Object.getPrototypeOf(current) !== null) {
        return `non-plain object (${current.constructor?.name ?? 'unknown'})`;
      }
      for (const key of Object.getOwnPropertyNames(current)) {
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        if (!descriptor?.enumerable) return `non-enumerable key "${key}"`;
      }
      for (const key of Object.keys(current)) {
        if (current[key] === undefined) return `property "${key}" is undefined`;
        stack.push(current[key]);
      }
    }
    return null;
  }

  check('the lossless-JSON walker itself catches the bug it exists for', () => {
    // Guard against a walker that silently passes everything, which would make
    // every other check in this section meaningless.
    const cases = [
      [{ a: undefined }, true],
      [{ a: NaN }, true],
      [{ a: Infinity }, true],
      [{ a: -0 }, true],
      [{ a: new Date() }, true],
      [{ a: [1, , 3] }, true],
      [{ a: { b: [1, null, 'x'] } }, false],
      [{ a: 0, b: '', c: false, d: null }, false],
    ];
    for (const [sample, shouldFail] of cases) {
      const problem = losslessJsonProblem(sample);
      if (shouldFail && problem === null) throw new Error(`missed a bad value: ${JSON.stringify(sample)}`);
      if (!shouldFail && problem !== null) throw new Error(`rejected a good value: ${problem}`);
    }
    return `${cases.length} samples classified correctly`;
  });

  await checkAsync('a real screenshot result is lossless JSON', async () => {
    const tool = registered.find((t) => t.name === 'computer');
    const value = await tool.execute({ action: 'screen_info' }, {});
    const problem = losslessJsonProblem(value);
    if (problem !== null) throw new Error(`screen_info: ${problem}`);
    return 'screen_info survives the registry walker';
  });

  await checkAsync('the FIRST capture of an area is lossless JSON', async () => {
    // The regression: `meta.changed` was set to `undefined` when there was no
    // previous fingerprint, which is exactly the first capture of a region.
    const tool = registered.find((t) => t.name === 'computer');
    const value = await tool.execute(
      { action: 'screenshot', region: { x: 0, y: 0, width: 140, height: 110 } },
      {},
    );
    const problem = losslessJsonProblem(value);
    if (problem !== null) throw new Error(`first capture: ${problem}`);
    if ('changed' in value.screenshot) {
      throw new Error('the first capture invented a `changed` field with no baseline to compare');
    }
    return 'no baseline -> no `changed` key, and the result is lossless';
  });

  await checkAsync('a REPEAT capture of the same area is lossless JSON', async () => {
    const tool = registered.find((t) => t.name === 'computer');
    const area = { x: 0, y: 0, width: 140, height: 110 };
    await tool.execute({ action: 'screenshot', region: area }, {});
    const value = await tool.execute({ action: 'screenshot', region: area }, {});
    const problem = losslessJsonProblem(value);
    if (problem !== null) throw new Error(`repeat capture: ${problem}`);
    if (typeof value.screenshot.changed !== 'boolean') {
      throw new Error('a repeat capture did not report whether anything changed');
    }
    return `repeat capture reports changed=${value.screenshot.changed}`;
  });

  await checkAsync('omitting every optional argument stays lossless JSON', async () => {
    // Optional arguments reach the metadata as `undefined` when omitted, which is
    // how a field like `scale` can silently become non-lossless.
    const tool = registered.find((t) => t.name === 'computer');
    const value = await tool.execute({ action: 'screenshot' }, {});
    const problem = losslessJsonProblem(value);
    if (problem !== null) throw new Error(`bare capture: ${problem}`);
    return 'a capture with no optional arguments is lossless';
  });

  await checkAsync('a batch result is lossless JSON', async () => {
    const tool = registered.find((t) => t.name === 'computer_batch');
    const value = await tool.execute(
      {
        actions: [
          { action: 'cursor' },
          { action: 'screenshot', region: { x: 0, y: 0, width: 120, height: 90 } },
          { action: 'screen_info' },
        ],
      },
      {},
    );
    const problem = losslessJsonProblem(value);
    if (problem !== null) throw new Error(`batch: ${problem}`);
    return 'batch result survives the registry walker';
  });

  await checkAsync('a batch that stops on failure is lossless JSON', async () => {
    const tool = registered.find((t) => t.name === 'computer_batch');
    const value = await tool.execute(
      { actions: [{ action: 'cursor' }, { action: 'click', x: 99999, y: 99999 }, { action: 'screen_info' }] },
      {},
    );
    const problem = losslessJsonProblem(value);
    if (problem !== null) throw new Error(`failed batch: ${problem}`);
    return 'a stopped batch is lossless too';
  });

  // -------------------------------------------------------------------------
  console.log('\n[4] running real actions');

  const computer = registered.find((t) => t.name === 'computer');
  const batch = registered.find((t) => t.name === 'computer_batch');
  const exec = {};

  // Exercise the real delivery seam: the value handed to render is the
  // dispatcher's snapshot, never the live object execute returned.
  const content = (result) => computer.output.render({}, dispatchSnapshot(result));

  await checkAsync('screen_info returns desktop geometry', async () => {
    const value = await computer.execute({ action: 'screen_info' }, exec);
    if (value.status !== 'ok') throw new Error(`status=${value.status}`);
    if (!value.screen || value.screen.width <= 0) throw new Error('no screen geometry');
    return `${value.screen.width}x${value.screen.height} dpi=${value.screen.dpi} cursor=(${value.cursor.x},${value.cursor.y})`;
  });

  await checkAsync('a full-screen capture is delivered at NATIVE resolution', async () => {
    const value = await computer.execute({ action: 'screenshot' }, exec);
    const meta = value.screenshot;
    if (meta.scale !== 1) throw new Error(`expected scale 1, got ${meta.scale}`);
    if (meta.width !== value.screen.width || meta.height !== value.screen.height) {
      throw new Error(
        `capture is ${meta.width}x${meta.height} but the desktop is ${value.screen.width}x${value.screen.height}`,
      );
    }
    const size = statSync(meta.file).size;
    if (size !== meta.bytes) throw new Error(`file is ${size} bytes, metadata says ${meta.bytes}`);
    return `${meta.width}x${meta.height} scale=1 ${size}B (no pre-emptive downscale)`;
  });

  await checkAsync('the image reference SURVIVES the dispatcher snapshot', async () => {
    const value = await computer.execute(
      { action: 'screenshot', region: { x: 0, y: 0, width: 320, height: 200 } },
      exec,
    );
    if (!Array.isArray(value.images) || value.images.length !== 1) {
      throw new Error(`execute returned ${value.images?.length} image entries`);
    }
    const entry = value.images[0];
    if (!entry.attachment || typeof entry.attachment.attachmentId !== 'string') {
      throw new Error('the image entry has no usable attachment reference');
    }
    if (!entry.region || typeof entry.scale !== 'number') {
      throw new Error('the image entry lacks the data needed to map coordinates');
    }

    const snap = dispatchSnapshot(value);
    if (!Array.isArray(snap.images) || snap.images.length !== 1) {
      throw new Error(`the snapshot lost the images array (keys: ${Object.keys(snap).join(',')})`);
    }
    const blocks = computer.output.render({}, snap);
    const images = blocks.filter((b) => b.type === 'image');
    if (images.length !== 1) throw new Error(`render produced ${images.length} image blocks from the snapshot`);
    if (images[0].attachment.attachmentId !== entry.attachment.attachmentId) {
      throw new Error('the rendered attachment does not match the captured one');
    }
    return `survived JSON snapshot + deepFreeze; ${images.length} image block(s) rendered`;
  });

  await checkAsync('image entries carry the coordinate mapping the model needs', async () => {
    const value = await computer.execute(
      { action: 'screenshot', region: { x: 100, y: 50, width: 400, height: 300 } },
      exec,
    );
    const entry = value.images[0];
    if (!entry) throw new Error('no image entry');
    if (entry.region.x !== 100 || entry.region.y !== 50) throw new Error(`region is ${JSON.stringify(entry.region)}`);
    if (entry.native !== true) throw new Error('a small region should be native');
    if (!/region origin/.test(entry.hint)) throw new Error(`unhelpful hint: ${entry.hint}`);
    return `region origin (${entry.region.x}, ${entry.region.y}), native=${entry.native}`;
  });

  await checkAsync('tiled capture returns multiple images and tiles', async () => {
    const value = await computer.execute(
      { action: 'screenshot', region: { x: 0, y: 0, width: 1200, height: 600 }, tiles: 4, grid: false },
      exec,
    );
    if (!Array.isArray(value.tiles) || value.tiles.length !== 4) {
      throw new Error(`expected 4 tiles, got ${value.tiles?.length}`);
    }
    for (const tile of value.tiles) {
      if (tile.scale !== 1) throw new Error(`tile ${tile.index} scale=${tile.scale}`);
    }
    if (!Array.isArray(value.images) || value.images.length !== 4) {
      throw new Error(`expected 4 image entries, got ${value.images?.length}`);
    }
    return `${value.tiles.length} tiles, ${value.images.length} image entries`;
  });

  await checkAsync('an explicit scale below 1 is honoured', async () => {
    const value = await computer.execute(
      { action: 'screenshot', region: { x: 0, y: 0, width: 800, height: 600 }, scale: 0.5, grid: false },
      exec,
    );
    const meta = value.screenshot;
    if (meta.width !== 400 || meta.height !== 300) throw new Error(`got ${meta.width}x${meta.height}`);
    if (!/scaled by/.test(value.message)) throw new Error('the message did not mention the scaling');
    return `${meta.width}x${meta.height} scale=${meta.scale}`;
  });

  await checkAsync('windows action RENDERS the list, not just counts it', async () => {
    const value = await computer.execute({ action: 'windows' }, exec);
    if (typeof value.count !== 'number') throw new Error('no count');
    if (!Array.isArray(value.windows)) throw new Error('no windows array');
    if (value.count !== value.windows.length) {
      throw new Error(`count ${value.count} disagrees with ${value.windows.length} records`);
    }

    // A count alone is useless: only `render` output reaches the model, so the
    // titles and handles have to appear in the text block.
    const text = computer.output.render({}, dispatchSnapshot(value))[0].text;
    if (!/Format: handle/.test(text)) throw new Error('the list format was not explained');
    if (value.count === 0) return 'no windows open to verify against';
    let shown = 0;
    for (const w of value.windows) {
      if (text.includes(String(w.handle)) && text.includes(w.title)) shown += 1;
    }
    if (shown !== value.count) {
      throw new Error(`only ${shown} of ${value.count} windows appear in the rendered text`);
    }
    return `${shown} window(s) fully listed in the text the model receives`;
  });

  await checkAsync('window enumeration excludes zero-area and off-screen ghosts', async () => {
    const value = await computer.execute({ action: 'windows' }, exec);
    const screen = (await computer.execute({ action: 'screen_info' }, exec)).screen;
    for (const w of value.windows) {
      if (w.bounds.width <= 0 || w.bounds.height <= 0) {
        throw new Error(`zero-area window listed: ${JSON.stringify(w.title)} ${w.bounds.width}x${w.bounds.height}`);
      }
      if (w.minimized) continue;
      const overlaps =
        w.bounds.x < screen.originX + screen.width &&
        w.bounds.y < screen.originY + screen.height &&
        w.bounds.x + w.bounds.width > screen.originX &&
        w.bounds.y + w.bounds.height > screen.originY;
      if (!overlaps) {
        throw new Error(`off-screen window listed: ${JSON.stringify(w.title)} at ${w.bounds.x},${w.bounds.y}`);
      }
    }
    // Duplicate titles are deliberately NOT an error: several windows of one app
    // legitimately share a title (two WeChat windows, two Explorer windows). The
    // cloaked/zero-area/off-screen rules are the ghost filters; title equality
    // would also reject perfectly real windows.
    return `${value.count} non-empty, on-screen window(s)`;
  });

  await checkAsync('window capture matches the DWM frame, not GetWindowRect', async () => {
    // A capture as wide as the raw GetWindowRect would still include the
    // invisible resize border, which shows up as black margin.
    const list = await computer.execute({ action: 'windows' }, exec);
    const target = list.windows.find((w) => w.bounds.width > 300 && w.bounds.height > 200 && !w.minimized);
    if (!target) return 'no suitable window open to capture';
    const value = await computer.execute({ action: 'screenshot', window: String(target.handle) }, exec);
    const meta = value.screenshot;
    if (meta.width !== target.bounds.width || meta.height !== target.bounds.height) {
      throw new Error(
        `capture ${meta.width}x${meta.height} does not match the reported window bounds ` +
          `${target.bounds.width}x${target.bounds.height}`,
      );
    }
    return `${JSON.stringify(target.title.slice(0, 28))} at ${meta.width}x${meta.height} via ${meta.window.method}`;
  });

  await checkAsync('cursor action reports the pointer', async () => {
    const value = await computer.execute({ action: 'cursor' }, exec);
    if (!Number.isFinite(value.cursor?.x)) throw new Error('no cursor position');
    return `(${value.cursor.x}, ${value.cursor.y})`;
  });

  await checkAsync('out-of-bounds click is refused with guidance', async () => {
    let message = null;
    try {
      await computer.execute({ action: 'click', x: 99999, y: 99999 }, exec);
    } catch (error) {
      message = error.message;
    }
    if (!message) throw new Error('an off-screen click was accepted');
    if (!/outside the desktop/.test(message)) throw new Error(`unhelpful error: ${message}`);
    return message.slice(0, 70);
  });

  await checkAsync('invalid action values are rejected with the valid list', async () => {
    let message = null;
    try {
      await computer.execute({ action: 'teleport' }, exec);
    } catch (error) {
      message = error.message;
    }
    if (!message) throw new Error('an unknown action was accepted');
    if (!/must be one of/.test(message)) throw new Error(`unhelpful error: ${message}`);
    return `rejected at the schema boundary, ${(message.match(/"(\w+)"/g) ?? []).length} actions listed`;
  });

  // -------------------------------------------------------------------------
  console.log('\n[5] batch behaviour');

  await checkAsync('batch runs actions in order and reports each step', async () => {
    const value = await batch.execute(
      { actions: [{ action: 'cursor' }, { action: 'sleep', sleep: 120 }, { action: 'screen_info' }] },
      exec,
    );
    if (value.status !== 'ok') throw new Error(`status=${value.status}: ${value.message}`);
    if (value.completed !== 3 || value.total !== 3) throw new Error(`completed ${value.completed}/${value.total}`);
    return value.steps.map((s) => `${s.index}:${s.action}=${s.status}`).join(' ');
  });

  await checkAsync('a capture inside a batch still reaches the rendered result', async () => {
    const value = await batch.execute(
      { actions: [{ action: 'cursor' }, { action: 'screenshot', region: { x: 0, y: 0, width: 300, height: 200 } }] },
      exec,
    );
    if (!Array.isArray(value.images) || value.images.length !== 1) {
      throw new Error(`batch produced ${value.images?.length} image entries`);
    }
    const images = batch.output.render({}, dispatchSnapshot(value)).filter((b) => b.type === 'image');
    if (images.length !== 1) throw new Error(`render produced ${images.length} image blocks`);
    return 'mid-batch capture reached the rendered result';
  });

  await checkAsync('batch uses only observation actions in this test', async () => {
    const value = await batch.execute({ actions: [{ action: 'cursor' }, { action: 'cursor' }] }, exec);
    const typed = value.steps.some((s) => s.action === 'type' || s.action === 'click');
    if (typed) throw new Error('test issued input events');
    return 'no input events issued';
  });

  await checkAsync('batch stops at the first failure and names the step', async () => {
    const value = await batch.execute(
      {
        actions: [
          { action: 'cursor' },
          { action: 'click', x: -99999, y: -99999 },
          { action: 'cursor' },
        ],
      },
      exec,
    );
    if (value.status !== 'failed') throw new Error(`expected failure, got ${value.status}`);
    if (value.failure?.index !== 1) throw new Error(`expected failure at index 1, got ${value.failure?.index}`);
    if (value.completed !== 1) throw new Error(`expected 1 completion, got ${value.completed}`);
    return `stopped at ${value.failure.index}, ${value.completed}/${value.total} done`;
  });

  await checkAsync('batch rejects an over-long sequence', async () => {
    let message = null;
    try {
      await batch.execute({ actions: Array.from({ length: 99 }, () => ({ action: 'cursor' })) }, exec);
    } catch (error) {
      message = error.message;
    }
    if (!message || !/at most/.test(message)) throw new Error(`got: ${message}`);
    return message.slice(0, 60);
  });

  // -------------------------------------------------------------------------
  console.log('\n[6] waiting, change detection and filter transparency');

  // A patch of screen nothing animates: the top-left corner belongs to another
  // app's toolbar, so no spinner, caret or clock tick lives there.
  const staticRegion = { x: 0, y: 0, width: 160, height: 50 };

  await checkAsync('waitUntilStable decides from sampling, not from faith', async () => {
    const value = await computer.execute(
      { action: 'waitUntilStable', region: staticRegion, quietMs: 200, timeoutMs: 2500 },
      exec,
    );
    if (value.stable !== true) throw new Error(`reported unstable: ${value.message}`);
    if (typeof value.samples !== 'number' || value.samples < 2) {
      throw new Error(`claimed stability from ${value.samples} sample(s)`);
    }
    if (!/settled|still/i.test(value.message)) throw new Error('the message does not say what was decided');
    return `stable after ${value.waitedMs}ms, ${value.samples} samples`;
  });

  await checkAsync('waitForChange tells the truth when nothing moves', async () => {
    const value = await computer.execute(
      { action: 'waitForChange', region: staticRegion, timeoutMs: 400, intervalMs: 100 },
      exec,
    );
    if (value.changed !== false) throw new Error(`claimed a change on a static region: ${value.message}`);
    // A timeout is not a success: reporting it as "ok" would be the same class of
    // lie as a focus call that says "raised" without checking.
    if (value.status !== 'warning') throw new Error(`a timeout reported status=${value.status}`);
    return `no change in ${value.waitedMs}ms, status=${value.status}`;
  });

  await checkAsync('a repeat capture says whether anything changed', async () => {
    const first = await computer.execute({ action: 'screenshot', region: staticRegion }, exec);
    const second = await computer.execute({ action: 'screenshot', region: staticRegion }, exec);
    if (first.screenshot.changed !== undefined) {
      throw new Error('the first capture claimed a comparison it had nothing to compare against');
    }
    if (second.screenshot.changed !== false) {
      throw new Error(`an untouched region reported a change: ${second.message}`);
    }
    if (!/UNCHANGED/.test(second.message)) {
      throw new Error('the comparison was computed but never rendered, so the model cannot see it');
    }
    return 'fingerprint comparison rendered into the text the model receives';
  });

  await checkAsync('includeFiltered explains what the window list dropped', async () => {
    const value = await computer.execute({ action: 'windows', includeFiltered: true }, exec);
    const text = computer.output.render({}, dispatchSnapshot(value))[0].text;
    if (!Array.isArray(value.filtered)) throw new Error('no filtered array was returned');
    if (value.filtered.length === 0) {
      throw new Error('nothing was reported as excluded, which cannot be true on a real desktop');
    }
    for (const w of value.filtered) {
      if (!String(w.reason ?? '').trim()) throw new Error('an excluded window came back without a reason');
      if (!text.includes(String(w.reason))) {
        throw new Error(`reason not rendered for ${JSON.stringify(w.title)}: ${w.reason}`);
      }
    }
    return `${value.filtered.length} excluded window(s) listed with reasons`;
  });

  await checkAsync('tiles refuses a window target with guidance, not a TypeError', async () => {
    let message = '';
    try {
      await computer.execute({ action: 'screenshot', window: 'anything', tiles: 2 }, exec);
    } catch (error) {
      message = error.message;
    }
    if (!message) throw new Error('tiling a window was accepted');
    if (/Cannot read properties|undefined/.test(message)) throw new Error(`raw TypeError leaked: ${message}`);
    if (!/not on a `window`/.test(message)) throw new Error(`unhelpful message: ${message}`);
    return message.slice(0, 68);
  });

  await checkAsync('tiles refuses an impossible split with guidance', async () => {
    let message = '';
    try {
      await computer.execute(
        { action: 'screenshot', region: { x: 0, y: 0, width: 2, height: 2 }, tiles: 9 },
        exec,
      );
    } catch (error) {
      message = error.message;
    }
    if (!message) throw new Error('a 2x2 area was split 9 ways without complaint');
    if (/Cannot read properties|undefined/.test(message)) throw new Error(`raw TypeError leaked: ${message}`);
    if (!/larger region or fewer tiles/.test(message)) throw new Error(`unhelpful message: ${message}`);
    return message.slice(0, 68);
  });

  check('every new parameter is declared, so the model can actually pass it', () => {
    const shape = computer.parameters ?? {};
    const props = shape.properties ?? shape;
    const names = Object.keys(props);
    const needed = [
      'includeFiltered',
      'ensureForeground',
      'newline',
      'timeoutMs',
      'quietMs',
      'intervalMs',
      'minChange',
      'pixelTolerance',
    ];
    const missing = needed.filter((n) => !names.includes(n));
    if (missing.length > 0) throw new Error(`undeclared parameters: ${missing.join(', ')}`);
    const actions = (props.action ?? {}).enum ?? [];
    for (const a of ['waitForChange', 'waitUntilStable']) {
      if (!actions.includes(a)) throw new Error(`${a} is missing from the action enum`);
    }
    return `${needed.length} new parameters, ${actions.length} actions declared`;
  });

  // -------------------------------------------------------------------------
  console.log('\n[7] degraded mode: no attachment service mounted');

  const bareRegistered = [];
  const bareCtx = {
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    tools: { register: (t) => { bareRegistered.push(t); return () => {}; } },
    get: () => undefined,
  };

  check('apply() still succeeds without an attachments service', () => {
    mod.apply(bareCtx, config);
    if (bareRegistered.length !== 2) throw new Error(`registered ${bareRegistered.length} tools`);
    return 'registered both tools';
  });

  await checkAsync('screenshot without attachments says so instead of failing silently', async () => {
    const bareComputer = bareRegistered.find((t) => t.name === 'computer');
    const value = await bareComputer.execute(
      { action: 'screenshot', region: { x: 0, y: 0, width: 200, height: 120 } },
      {},
    );
    const snap = dispatchSnapshot(value);
    const blocks = bareComputer.output.render({}, snap);
    if (blocks.some((b) => b.type === 'image')) throw new Error('emitted an image with no store mounted');
    if (!Array.isArray(snap.images) || snap.images.length !== 0) throw new Error('images array is not empty');
    if (!/NO IMAGE WAS ATTACHED/.test(value.message)) {
      throw new Error(`the model was not told the image is missing: ${value.message.slice(0, 140)}`);
    }
    return 'text fallback names the reason and the file to read';
  });

  // -------------------------------------------------------------------------
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) {
    console.log('\nFailures:');
    for (const f of failed) console.log(`  - ${f.label}: ${f.detail}`);
    process.exitCode = 1;
  } else {
    console.log('\nPNGs written to test-output/; inspect with read_image.');
  }
}

main().catch((error) => {
  console.error('\nUNEXPECTED FAILURE:', error);
  process.exitCode = 1;
});

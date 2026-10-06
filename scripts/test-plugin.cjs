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

  const ctx = {
    logger: {
      info: (...a) => logs.push(['info', a.join(' ')]),
      warn: (...a) => logs.push(['warn', a.join(' ')]),
      error: (...a) => logs.push(['error', a.join(' ')]),
    },
    tools: { register: (tool) => { registered.push(tool); return () => {}; } },
    get(key) {
      if (key === 'attachments') return attachmentsStore;
      if (key === 'systemPrompt') {
        return {
          section: (s) => { sections.push(s); return () => {}; },
          getSectionOrder: (n) => (n === 'TOOL_COMPUTER_USE' ? 3000 : undefined),
        };
      }
      return undefined;
    },
  };

  check('apply() runs without throwing', () => {
    mod.apply(ctx, config);
    return `${registered.length} tool(s), ${sections.length} prompt section(s)`;
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
    const BUDGET = 2200;
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

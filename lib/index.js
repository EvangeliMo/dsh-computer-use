/**
 * dsh-computer-use — host plugin.
 *
 * Adds screen observation and desktop input synthesis to a DSH agent, for
 * operating software that exposes no agent-facing integration.
 *
 * Design constraints that shaped this file
 * ---------------------------------------
 * 1. **Coordinate space.** Measured in the live plugin host: thread DPI
 *    awareness is PER_MONITOR_AWARE and `SM_CXSCREEN` equals the physical panel
 *    size, so screen capture, `GetSystemMetrics`, `GetCursorPos` and
 *    `SetCursorPos` all share one physical-pixel space. This plugin therefore
 *    never rescales coordinates. The only scaling is on the image handed to the
 *    model, and that factor is reported back to it explicitly.
 * 2. **Low-resolution vision.** A full-screen image is downscaled to a
 *    model-friendly thumbnail with an annotated coordinate ruler. Because fine
 *    detail does not survive that, the model can re-capture any small region at
 *    native resolution. That two-step loop is the primary workflow.
 * 3. **Image delivery must be plain JSON inside the value.** The dispatcher calls
 *    `snapshotToolValue` -> `snapshotJsonValue` and `deepFreeze` BEFORE `render`,
 *    so `render` never sees the object `execute` returned — it sees a JSON
 *    round-trip of it. Anything non-enumerable (a Symbol, a WeakMap key) is
 *    stripped on the way, which silently drops every image while the text still
 *    arrives. Attachment references therefore live in an enumerable `images`
 *    array *inside* the declared output schema, exactly as `read_image` carries
 *    its reference in `value.image`.
 * 4. **No pre-emptive downscaling.** The model downsamples images itself, so a
 *    capture is delivered at native resolution by default and the agent decides
 *    what to look at. The ruler and the `region` re-capture remain, because they
 *    solve a different problem: telling the agent where a feature *is*.
 * 4. **CommonJS, not ESM.** The plugin's host modules (`dsh-tools`,
 *    `schemastery`) ship inside the installation asar. Only a CommonJS `require`
 *    goes through Electron's asar-aware resolver; an ESM `import` of a bare
 *    specifier fails with ERR_MODULE_NOT_FOUND even though `require` succeeds —
 *    measured from the deployed profile location, not assumed. Bundling copies of
 *    those packages is not an option either: a second `cordis` instance would
 *    break service identity. So this file is CommonJS and reaches the host
 *    modules through the shared install-aware loader.
 *
 * @module dsh-computer-use
 */

'use strict';

const { mkdirSync, statSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');

const { requireFromInstall } = require('./loader.cjs');

const { defineTool } = requireFromInstall('@deepseek-ai/dsh-tools', 'tool registration');
const z = requireFromInstall('@deepseek-ai/schemastery', 'plugin configuration schema');

const name = 'dsh-computer-use';

/**
 * Services required by this plugin. `attachments` and `systemPrompt` are looked
 * up optionally: without `attachments` a capture still lands on disk and the
 * model reads it with `read_image`, so the plugin degrades instead of refusing
 * to load.
 */
const inject = ['tools'];

/** Plugin configuration. */
const Config = z.object({
  /** Master switch; when false no tool is registered. */
  enabled: z.boolean().required(),
  /**
   * Safety cap on a capture's longest side. Captures are native-resolution by
   * default; this only bites on an unusually large virtual desktop, where
   * sending a 5K image to the model would be wasteful rather than useful.
   */
  fullMaxDimension: z.number().required(),
  /** Longest side of a region capture before it is treated as a tile. */
  nativeMaxDimension: z.number().required(),
  /** PNG deflate effort, 1-9. Higher is smaller and slower. */
  pngLevel: z.number().required(),
  /** Hard cap on actions accepted by one `computer_batch` call. */
  maxBatchActions: z.number().required(),
  /** Directory for captured PNGs. Empty uses the OS temp directory. */
  outputDirectory: z.string().required(),
});

/**
 * Load the native helper modules.
 *
 * They are CommonJS files in `src/` and are required *relatively*, which always
 * resolves regardless of where the profile lives. Each candidate is tried in
 * turn so the layout survives being flattened by a future deployment change.
 */
function helpers() {
  const here = __dirname;
  const candidates = {
    win32: [join(here, 'computer-win32.cjs'), join(here, '..', 'src', 'win32.cjs')],
    capture: [join(here, 'computer-capture.cjs'), join(here, '..', 'src', 'capture.cjs')],
    png: [join(here, 'computer-png.cjs'), join(here, '..', 'src', 'png.cjs')],
  };
  const first = (list, label) => {
    const errors = [];
    for (const candidate of list) {
      try {
        return require(candidate);
      } catch (error) {
        errors.push(`${candidate}: ${error.code ?? error.message}`);
      }
    }
    throw new Error(`dsh-computer-use: cannot load the ${label} helper. Tried: ${errors.join(' | ')}`);
  };
  return {
    win32: first(candidates.win32, 'Win32'),
    capture: first(candidates.capture, 'capture'),
    png: first(candidates.png, 'PNG'),
  };
}

// ---------------------------------------------------------------------------
// Description text
// ---------------------------------------------------------------------------

const TOOL_DESCRIPTION = [
  'Observe and control the graphical desktop of this computer: capture the screen, move and click the mouse, scroll, type text, press keys, and focus windows.',
  '',
  'Use this to operate software that has no agent-facing tool or API, and to read information that only exists on screen. Prefer a real file/API/shell path whenever one exists — reading a file is faster and exact; a screenshot is a picture of pixels.',
  '',
  'CAPTURES ARE NATIVE RESOLUTION. A screenshot comes back at the screen\'s real pixel size (a 1920x1080 desktop arrives as a 1920x1080 image), so the image block you receive and the `click` coordinates you send share one space: 1 image pixel = 1 screen pixel. Each returned image carries `region`, `scale`, `native`, and a `hint` restating the mapping.',
  '',
  'WHAT THE SCREEN LOOKS LIKE BY DEFAULT: every full-screen capture has a coordinate ruler painted on it, labelled in screen pixels, plus numbered quadrant markers. Use those to read off a position without doing arithmetic. They are drawn on the image only, never into the world.',
  '',
  'LOOKING AT DETAIL: because the ruler and labels are small, a full-screen capture is best for layout and for finding roughly where something is. To read fine text or hit a precise control, capture just that area with `region` — the result is still native resolution, and now fills more of the image so its detail is easier to judge. Zooming in by capturing a small region is the reliable way to work; the image is not downscaled for you, so there is no hidden precision loss to compensate for.',
  '',
  'TILES: pass `tiles` with `region` to split a larger area into a grid of images returned in one call, each carrying its own screen origin. Cheaper than several round trips when you need to survey an area at full detail.',
  '',
  'BATCHING: use `computer_batch` to perform several actions in one call with `sleep` steps between them. GUI work needs settle time: after a click that opens a menu or a dialog, sleep 200-600ms before the next action, and capture again before acting on anything that may have moved.',
  '',
  'WAITING INSTEAD OF GUESSING: `waitForChange` and `waitUntilStable` watch the screen and report when it has settled, so you do not have to guess a `sleep` and then re-capture to find out whether it was long enough. Reach for them after typing into a slow field (CJK input and long strings render asynchronously), after opening a dialog, and after launching an app. `waitUntilStable` returns at the moment a capture is worth trusting; `waitForChange` returns as soon as something moved.',
  '',
  'TYPING SEVERAL LINES: `type` accepts newlines in `text` and presses a key between them. `newline: "enter"` (the default) is right for editors; use `newline: "shiftEnter"` in a chat box where a bare Enter would send the message. There is no need to split the text across calls.',
  '',
  'CLICKS AND WINDOW ACTIVATION: Windows spends the first click on an inactive window just to activate it, so a single click can appear to do nothing. Pointing actions therefore raise the window under the pointer first and tell you whether that succeeded; if the result says activation failed, the click may have been consumed, so capture the screen before clicking again.',
  '',
  'STARTING AN APPLICATION — work down this order and stop at the first route that works; the earlier routes are faster and keep the user oriented:',
  '1. ALREADY RUNNING: a taskbar button or notification-area icon. Clicking it brings the existing window forward instead of starting a duplicate, which is almost always what the user wants. In the notification area prefer a visible icon — the overflow chevron flyout closes itself.',
  '2. DESKTOP: a shortcut is one double-click at a position you can see and verify.',
  '3. START MENU SEARCH: open Start, type the name, press Enter. This also finds apps with no shortcut anywhere.',
  '4. COMMAND LINE, LAST: only after the three above fail. It starts a second instance regardless of what is already open, may land in a different working directory, gives you less to verify, and the process can be torn down when the command returns — use a background job if the app must outlive the call.',
  'Follow `waitUntilStable` after any launch before concluding the app appeared, and if a route fails twice, verify what happened and switch routes rather than repeating a failing action.',
  '',
  'HONESTY: a capture shows what was on screen at that moment. If a click appears not to have worked, capture again and say so rather than assuming it did. If a capture comes back without an image attached, say so plainly instead of describing what you assume is there.',
  '',
  'WHEN A WINDOW YOU CAN SEE IS MISSING from the `windows` list, re-run it with `includeFiltered: true`: the result then names each excluded window and the rule that excluded it, which is faster than re-deriving the answer from a screenshot. `focus_window` reports whether the window actually reached the foreground, so never assume it worked.',
].join('\n');

const BATCH_DESCRIPTION = [
  'Run a sequence of desktop actions in one call, in order, with optional delays between them.',
  '',
  'This is the efficient way to drive a GUI: click a control, wait for the UI to settle, type into a field, press a key. Each step may set `sleep` (milliseconds to pause AFTER the action), which is what makes multi-step sequences reliable.',
  '',
  'Coordinates are screen pixels, exactly as `computer` uses them. If any step fails, execution stops and the error names the step index; the result still reports every step that completed.',
  '',
  'Example: [{"action":"click","x":420,"y":318,"sleep":400},{"action":"type","text":"report.pdf"},{"action":"key","key":"enter","sleep":800},{"action":"screenshot"}]',
  '',
  'Keep sequences to steps you are confident about. Capture (`screenshot`) between steps when the UI may have changed in a way you have not yet observed.',
].join('\n');

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

/**
 * Register the computer-use tools.
 *
 * @param ctx - registrant context carrying the tool registry.
 * @param config - validated plugin configuration.
 */
function apply(ctx, config) {
  const cfg = {
    enabled: config?.enabled ?? true,
    // 4096 is a safety cap, not a target: a normal desktop is delivered at its
    // real resolution, and this only downscales a pathological virtual desktop.
    fullMaxDimension: Math.max(640, Math.round(config?.fullMaxDimension ?? 4096)),
    nativeMaxDimension: Math.max(320, Math.round(config?.nativeMaxDimension ?? 1400)),
    pngLevel: Math.min(9, Math.max(1, Math.round(config?.pngLevel ?? 6))),
    maxBatchActions: Math.max(1, Math.round(config?.maxBatchActions ?? 40)),
    outputDirectory: config?.outputDirectory ?? '',
  };

  if (!cfg.enabled) {
    ctx.logger?.info?.('dsh-computer-use: disabled by configuration');
    return;
  }

  /**
   * Describe which instance of this plugin is loading.
   *
   * The same package is mounted twice — once as a host-plane row and once inside
   * the `computer` preset that each session composes — so a message that does not
   * say which one it came from is not actionable.
   *
   * @returns a short identity string.
   */
  const instanceLabel = () => {
    const agent = ctx.agent;
    if (!agent) return 'host-plane row (no owning agent)';
    const session = agent.session?.id ?? agent.sessionId ?? 'unknown session';
    const model = agent.options?.model;
    return `preset-scoped row for agent on ${session}${model ? ` (${model})` : ''}`;
  };

  // Logged before anything can fail, so a boot where registration later throws
  // still shows that the row was reached and in which plane.
  ctx.logger?.info?.('dsh-computer-use: load start — %s', instanceLabel());

  let mods;
  try {
    mods = helpers();
  } catch (error) {
    ctx.logger?.error?.('dsh-computer-use: native helpers unavailable: %s', error.message);
    return;
  }

  const probe = mods.win32.probeWin32();
  if (!probe.ok) {
    ctx.logger?.error?.('dsh-computer-use: Win32 bindings unavailable: %s', probe.message);
    return;
  }

  const outDir = cfg.outputDirectory.trim().length > 0
    ? resolve(cfg.outputDirectory)
    : join(tmpdir(), 'dsh-computer-use');
  try {
    mkdirSync(outDir, { recursive: true });
  } catch (error) {
    ctx.logger?.warn?.('dsh-computer-use: cannot create %s (%s); using temp', outDir, error.message);
  }

  /** Monotonic counter for capture file names. */
  let captureSeq = 0;

  /**
   * Fingerprint of the most recent capture per screen area, keyed by
   * `x,y,width,height`. Lets `screenshot` answer "has anything changed since I
   * last looked here?" without the model having to diff two images itself.
   */
  const lastSignature = new Map();

  /**
   * The attachment store is resolved at *execution* time, never captured once at
   * load time. `read_image` re-checks `ctx.get('attachments')` inside `execute`
   * for the same reason: a service mounted after this plugin loads would
   * otherwise be invisible forever, and the snapshot would silently strip every
   * image out of the tool result.
   */
  const attachmentStore = () => ctx.get?.('attachments');

  const desktop = () => mods.win32.win32().desktop();

  // -------------------------------------------------------------------------
  // Capture pipeline
  // -------------------------------------------------------------------------

  /**
   * Capture, annotate, encode and persist one image.
   *
   * Captures are native resolution by default. The only reason one is ever
   * downscaled is `fullMaxDimension`, a safety cap for an unusually large
   * virtual desktop — the model performs its own image downsampling, so
   * pre-shrinking here would throw away detail the agent may want to inspect.
   *
   * @param options - capture request.
   * @returns result metadata plus the stored attachment reference.
   */
  async function captureOne(options) {
    const { region, monitor, window: windowSelector, grid, quadrants, scale: requestedScale } = options;

    let area;
    let windowInfo;
    let source;
    let label;

    if (windowSelector !== undefined && windowSelector !== null) {
      const target = mods.win32.findWindow(windowSelector);
      if (!target) throw new Error(`no visible window matches ${JSON.stringify(windowSelector)}`);
      source = mods.capture.captureWindow(target.handle, scaleOptions(requestedScale, target.bounds));
      area = source.region;
      windowInfo = { handle: target.handle, title: target.title, method: source.method, minimized: target.minimized };
      label = `window ${JSON.stringify(target.title)}`;
    } else {
      const d = desktop();
      area = region ?? (monitor !== undefined ? monitorBounds(monitor) : { x: d.x, y: d.y, width: d.width, height: d.height });
      area = clampRegion(area);
      if (area.width <= 0 || area.height <= 0) {
        throw new Error('the requested capture region is empty after clamping to the desktop');
      }
      source = mods.capture.captureRegion(area, scaleOptions(requestedScale, area));
      area = source.region;
      label = region !== undefined || monitor !== undefined ? 'region' : 'full screen';
    }

    // The realised scale, which is what the model must divide by.
    const scaleX = source.width / area.width;
    const scaleY = source.height / area.height;
    const scale = Math.max(scaleX, scaleY);

    let pixels = source.pixels;
    if (grid === true) {
      pixels = mods.png.drawRulers(source.width, source.height, pixels, {
        originX: area.x,
        originY: area.y,
        scaleX,
        scaleY,
      });
    }
    if (quadrants === true) {
      pixels = mods.png.drawQuadrants(source.width, source.height, pixels);
    }

    // Fingerprint the delivered pixels before encoding. Two captures of an
    // unchanged screen hash alike, so the model can learn "nothing moved"
    // without spending tokens on another image.
    const signature = pixelSignature(pixels);

    const png = mods.png.encodePng(source.width, source.height, pixels, { level: cfg.pngLevel });
    const pngBuffer = Buffer.from(png.buffer, png.byteOffset, png.byteLength);
    captureSeq += 1;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = join(outDir, `capture-${stamp}-${captureSeq}.png`);
    writeFileSyncSafe(file, pngBuffer);

    const meta = {
      file,
      width: source.width,
      height: source.height,
      bytes: pngBuffer.length,
      region: area,
      scale: Number(scale.toFixed(6)),
      scaleX: Number(scaleX.toFixed(6)),
      scaleY: Number(scaleY.toFixed(6)),
      native: scale >= 0.999,
      label,
      signature,
    };
    if (windowInfo) meta.window = windowInfo;
    if (grid === true) {
      meta.gridStep = 200;
    }
    if (quadrants === true) {
      meta.quadrants = mods.png.quadrantLegend(area);
    }

    let image = null;
    const attachments = attachmentStore();
    if (attachments && typeof attachments.saveImage === 'function') {
      try {
        const ref = await attachments.saveImage({
          data: new Uint8Array(pngBuffer),
          mediaType: 'image/png',
          name: `screen-${stamp}.png`,
        });
        image = {
          attachmentId: ref.attachmentId,
          mediaType: ref.mediaType,
          bytes: ref.bytes,
          width: ref.width,
          height: ref.height,
          ...(ref.name === undefined ? { name: `screen-${stamp}.png` } : { name: ref.name }),
        };
      } catch (error) {
        meta.attachmentError = error.message;
      }
    } else {
      meta.attachmentError =
        'no attachment service is mounted, so this capture cannot be sent to you as an image; ' +
        `read it from ${file} with read_image instead`;
    }

    return { meta, image };
  }

  /**
   * Resolve the capture-time scale for one request.
   *
   * Native resolution unless the caller asked for something smaller or the area
   * exceeds the safety cap. Clamped to (0, 1]: upscaling would invent pixels and
   * mislead the agent's coordinate reading.
   *
   * @param requested - an explicit `scale` from the model, if any.
   * @param area - the source area in screen pixels.
   * @returns scale factors for the GDI blit.
   */
  function scaleOptions(requested, area) {
    if (typeof requested === 'number' && Number.isFinite(requested) && requested > 0) {
      const s = Math.min(1, requested);
      return { scaleX: s, scaleY: s };
    }
    const longest = Math.max(area.width, area.height);
    if (longest > cfg.fullMaxDimension) {
      const s = cfg.fullMaxDimension / longest;
      return { scaleX: s, scaleY: s };
    }
    return { scaleX: 1, scaleY: 1 };
  }

  /**
   * A cheap FNV-1a fingerprint over a sampled subset of an RGBA buffer.
   *
   * Sampling, not an exhaustive hash: this is only ever compared for equality
   * between two captures of the same area, and a 64-byte stride (16 pixels) is
   * far more than enough to notice a dialog appearing or text landing.
   *
   * @param pixels - RGBA bytes.
   * @returns an unsigned 32-bit fingerprint.
   */
  function pixelSignature(pixels) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < pixels.length; i += 64) {
      hash = Math.imul(hash ^ pixels[i], 0x01000193) >>> 0;
      hash = Math.imul(hash ^ (pixels[i + 1] ?? 0), 0x01000193) >>> 0;
      hash = Math.imul(hash ^ (pixels[i + 2] ?? 0), 0x01000193) >>> 0;
    }
    return hash >>> 0;
  }

  /** Clamp a numeric argument into range, falling back when it is absent. */
  function clampNumber(value, min, max, fallback) {
    const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
    return Math.min(max, Math.max(min, n));
  }

  /**
   * Grab a small raw-pixel frame for change detection.
   *
   * Deliberately bypasses the capture pipeline: no PNG encode, no attachment, no
   * disk write. Polling the screen must stay cheap enough to do several times a
   * second, and nothing here is ever shown to anyone.
   *
   * @param region - screen area, or the whole desktop when omitted.
   * @param maxDimension - shrink so the longest side is at most this many pixels.
   * @returns `{width, height, pixels, region}`.
   */
  function probeFrame(region, maxDimension) {
    const d = desktop();
    const area = clampRegion(region ?? { x: d.x, y: d.y, width: d.width, height: d.height });
    if (area.width <= 0 || area.height <= 0) {
      throw new Error('the probed region is empty after clamping to the desktop');
    }
    const longest = Math.max(area.width, area.height);
    const factor = longest > maxDimension ? maxDimension / longest : 1;
    const shot = mods.capture.captureRegion(area, { scaleX: factor, scaleY: factor });
    return { width: shot.width, height: shot.height, pixels: shot.pixels, region: area };
  }

  /**
   * Fraction of sampled pixels that differ beyond `tolerance`.
   *
   * @param a - first frame.
   * @param b - second frame.
   * @param tolerance - summed RGB distance treated as noise.
   * @returns 0..1.
   */
  function frameDifference(a, b, tolerance) {
    if (!a || !b || a.width !== b.width || a.height !== b.height) return 1;
    const pa = a.pixels;
    const pb = b.pixels;
    let changed = 0;
    let total = 0;
    for (let i = 0; i < pa.length; i += 4) {
      const delta =
        Math.abs(pa[i] - pb[i]) + Math.abs(pa[i + 1] - pb[i + 1]) + Math.abs(pa[i + 2] - pb[i + 2]);
      total += 1;
      if (delta > tolerance) changed += 1;
    }
    return total === 0 ? 0 : changed / total;
  }

  /**
   * Raise whatever window sits under a point, and *verify* that it happened.
   *
   * The verification is a poll rather than a single read because Windows applies
   * a foreground change asynchronously: `GetForegroundWindow` immediately after
   * a successful `SetForegroundWindow` can return 0 or the old window. Reading
   * once and believing it is precisely how a working raise gets reported as a
   * failure — measured on this machine at up to ~34ms of lag.
   *
   * @param x - screen x.
   * @param y - screen y.
   * @param timeoutMs - how long to keep polling for confirmation.
   * @returns what was found, what was requested, and what actually happened.
   */
  async function raiseForClick(x, y, timeoutMs = 400) {
    let target = null;
    try {
      target = mods.win32.windowFromPoint(x, y);
    } catch (error) {
      return { attempted: false, reason: `could not identify the window under the point (${error.message})` };
    }
    if (!target) return { attempted: false, reason: 'no window under the point (bare desktop)' };

    const started = Date.now();
    const outcome = mods.win32.activateWindow(target.handle);
    let foreground = mods.win32.foregroundHandle();
    while (foreground !== target.handle && Date.now() - started < timeoutMs) {
      await wait(30);
      foreground = mods.win32.foregroundHandle();
    }

    return {
      attempted: true,
      ok: foreground === target.handle,
      handle: target.handle,
      title: target.title,
      alreadyForeground: outcome.alreadyForeground === true,
      requested: outcome.requested,
      verifiedAfterMs: Date.now() - started,
    };
  }

  /** Resolve a monitor index or descriptor to its bounds. */
  function monitorBounds(monitor) {
    const d = desktop();
    if (typeof monitor === 'number') {
      // Only the virtual desktop is exposed by GetSystemMetrics; a single-monitor
      // host is the common case, so index 0 is the whole desktop.
      if (monitor === 0) return { x: d.x, y: d.y, width: d.width, height: d.height };
      throw new Error(`monitor index ${monitor} is out of range (this host reports ${d.monitors})`);
    }
    return { x: d.x, y: d.y, width: d.width, height: d.height };
  }

  /** Keep a region inside the virtual desktop. */
  function clampRegion(region) {
    const d = desktop();
    const left = Math.max(d.x, Math.round(region.x));
    const top = Math.max(d.y, Math.round(region.y));
    const right = Math.min(d.x + d.width, Math.round(region.x + region.width));
    const bottom = Math.min(d.y + d.height, Math.round(region.y + region.height));
    return { x: left, y: top, width: right - left, height: bottom - top };
  }

  /** Validate and normalise an action target point. */
  function targetPoint(args) {
    const x = args.x;
    const y = args.y;
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error('this action needs numeric `x` and `y` screen coordinates');
    }
    const d = desktop();
    if (x < d.x || y < d.y || x >= d.x + d.width || y >= d.y + d.height) {
      throw new Error(
        `(${x}, ${y}) lies outside the desktop (${d.x}..${d.x + d.width - 1}, ${d.y}..${d.y + d.height - 1}). ` +
          'Take a screenshot and read the coordinates off the annotated image.',
      );
    }
    return { x: Math.round(x), y: Math.round(y) };
  }

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  /**
   * Execute one named action.
   *
   * Screenshot actions put their attachment references in the returned value's
   * `images` array; everything else returns image-free JSON. The caller turns
   * that array into content blocks in {@link renderValue}.
   *
   * @param action - action name.
   * @param args - action arguments.
   * @returns a plain JSON result value.
   */
  async function runAction(action, args) {
    const api = mods.win32.win32();

    switch (action) {
      case 'screenshot': {
        const times = Math.min(9, Math.max(1, Math.round(args.tiles ?? 1)));
        if (times > 1) {
          const base = args.region
            ? clampRegion(args.region)
            : (() => {
                const d = desktop();
                return { x: d.x, y: d.y, width: d.width, height: d.height };
              })();
          // Validate before dividing: a degenerate base used to surface as a raw
          // TypeError from deep inside the capture, which told the caller nothing
          // about what to change.
          if (!Number.isFinite(base.width) || !Number.isFinite(base.height) || base.width <= 0 || base.height <= 0) {
            throw new Error(
              `cannot tile an area of ${base.width}x${base.height}; the region is empty after clamping to the ` +
                'desktop. Pass a region that lies on screen.',
            );
          }
          if (args.window !== undefined) {
            throw new Error(
              '`tiles` works on a screen `region`, not on a `window`. Capture the window first, then tile the ' +
                'region it occupies.',
            );
          }
          const cols = Math.max(1, Math.ceil(Math.sqrt(times)));
          const rows = Math.max(1, Math.ceil(times / cols));
          const tileW = Math.floor(base.width / cols);
          const tileH = Math.floor(base.height / rows);
          if (tileW < 1 || tileH < 1) {
            throw new Error(
              `cannot split ${base.width}x${base.height} into ${times} tile(s): each tile would be ` +
                `${tileW}x${tileH}. Use a larger region or fewer tiles.`,
            );
          }
          const tiles = [];
          const images = [];
          for (let row = 0; row < rows; row += 1) {
            for (let col = 0; col < cols; col += 1) {
              if (tiles.length >= times) break;
              const region = {
                x: base.x + col * tileW,
                y: base.y + row * tileH,
                width: col === cols - 1 ? base.width - col * tileW : tileW,
                height: row === rows - 1 ? base.height - row * tileH : tileH,
              };
              let shot;
              try {
                shot = await captureOne({ region, grid: true, quadrants: false, scale: 1 });
              } catch (error) {
                throw new Error(
                  `tile ${tiles.length + 1} of ${times} failed (${region.width}x${region.height} at ` +
                    `${region.x},${region.y}): ${error.message}`,
                );
              }
              if (shot.image) images.push(imageEntry(shot.meta, shot.image));
              tiles.push({
                index: tiles.length,
                region: shot.meta.region,
                width: shot.meta.width,
                height: shot.meta.height,
                scale: shot.meta.scale,
                file: shot.meta.file,
              });
            }
          }
          return {
            status: 'ok',
            images,
            message:
              `Captured ${tiles.length} native-resolution tiles covering ${base.width}x${base.height} at ` +
              `(${base.x}, ${base.y}). Each tile image is full resolution (scale 1), so its pixels equal screen pixels ` +
              'offset by that tile\'s region origin.',
            tiles,
          };
        }

        const shot = await captureOne({
          region: args.region,
          monitor: args.monitor,
          window: args.window,
          grid: args.grid ?? args.region === undefined,
          quadrants: args.quadrants === true,
          scale: args.scale,
        });
        // Cheap change detection: same area, same fingerprint means the picture
        // did not move, which is often the whole question ("did my click do
        // anything?"). Keyed by area, so switching regions never compares apples
        // to oranges.
        const key = `${shot.meta.region.x},${shot.meta.region.y},${shot.meta.region.width},${shot.meta.region.height}`;
        const before = lastSignature.get(key);
        shot.meta.changed = before === undefined ? undefined : before !== shot.meta.signature;
        lastSignature.set(key, shot.meta.signature);
        return {
          status: 'ok',
          images: shot.image ? [imageEntry(shot.meta, shot.image)] : [],
          message: describeCapture(shot.meta),
          screenshot: shot.meta,
          ...screenContext(),
        };
      }

      case 'screen_info': {
        const d = desktop();
        return {
          status: 'ok',
          message:
            `Desktop is ${d.width}x${d.height} physical pixels at origin (${d.x}, ${d.y}); ` +
            `${d.monitors} monitor(s), system DPI ${d.dpi}, DPI awareness ${d.awareness}. ` +
            'Screenshots and input share this coordinate space, so no conversion is needed.',
          screen: {
            width: d.width,
            height: d.height,
            originX: d.x,
            originY: d.y,
            monitors: d.monitors,
            dpi: d.dpi,
            dpiAwareness: d.awareness,
          },
          cursor: api.cursorPosition(),
          foregroundWindow: mods.win32.foregroundWindow(),
        };
      }

      case 'windows': {
        const wantFiltered = args.includeFiltered === true;
        const inspection = wantFiltered
          ? mods.win32.inspectWindows({ includeMinimized: true })
          : { windows: mods.win32.listWindows({ includeMinimized: true }), filtered: [] };
        const list = inspection.windows;
        const fg = mods.win32.foregroundWindow();
        const sorted = list
          .slice()
          .sort((a, b) => b.bounds.width * b.bounds.height - a.bounds.width * a.bounds.height)
          .slice(0, 60)
          .map((w) => ({
            handle: w.handle,
            title: w.title,
            pid: w.pid,
            minimized: w.minimized,
            bounds: w.bounds,
            ...(w.noRedirection === true ? { noRedirection: true } : {}),
          }));
        // Only the exclusions a *user* could see matter. Hundreds of invisible
        // helper windows ("not visible") are noise; a cloaked, zero-area or
        // offscreen one is the answer to "why is my dialog missing?".
        const noteworthy = (inspection.filtered ?? [])
          .filter((w) => !String(w.reason).startsWith('not visible'))
          .sort((a, b) => b.bounds.width * b.bounds.height - a.bounds.width * a.bounds.height)
          .slice(0, 20)
          .map((w) => ({
            title: w.title,
            reason: w.reason,
            bounds: w.bounds,
            pid: w.pid,
            handle: w.handle,
          }));
        return {
          status: 'ok',
          message: formatWindowList(sorted, fg, wantFiltered ? noteworthy : null, inspection.filtered?.length ?? 0),
          count: sorted.length,
          foreground: fg,
          windows: sorted,
          ...(wantFiltered ? { filtered: noteworthy } : {}),
        };
      }

      case 'focus_window': {
        const selector = args.title ?? args.handle;
        if (selector === undefined) throw new Error('focus_window needs a `title` or `handle`');
        const target = mods.win32.findWindow(selector);
        if (!target) throw new Error(`no visible window matches ${JSON.stringify(selector)}`);
        const outcome = mods.win32.focusWindow(target.handle);
        return {
          status: outcome.ok ? 'ok' : 'failed',
          message: outcome.ok
            ? `Raised ${JSON.stringify(target.title)}.`
            : `Asked Windows to raise ${JSON.stringify(target.title)} but it did not become the foreground window. ` +
              'Windows blocks focus stealing; click the taskbar entry instead, or capture that window directly by title.',
          window: { handle: target.handle, title: target.title, bounds: target.bounds },
          foreground: outcome.ok,
        };
      }

      case 'click':
      case 'double_click':
      case 'right_click':
      case 'middle_click': {
        const point = targetPoint(args);
        const button = action === 'right_click' ? 'right' : action === 'middle_click' ? 'middle' : 'left';
        const times = action === 'double_click' ? 2 : 1;

        // Raise the window under the pointer before clicking. Windows spends the
        // first click on an inactive window purely on activation, which makes a
        // single click look like it did nothing; raising first removes the
        // problem instead of asking the model to remember to click twice.
        const activation = args.ensureForeground === false ? null : await raiseForClick(point.x, point.y);

        mods.win32.moveCursor(point.x, point.y);
        const landed = api.cursorPosition();
        const moved = landed.x === point.x && landed.y === point.y;
        for (let i = 0; i < times; i += 1) {
          mods.win32.mouseDown(button);
          mods.win32.mouseUp(button);
          if (i + 1 < times) sleepSync(60);
        }

        const notes = [];
        if (!moved) {
          notes.push(
            `The cursor ended at (${landed.x}, ${landed.y}) instead, so the click may not have landed where intended.`,
          );
        }
        if (activation?.attempted && activation.ok && !activation.alreadyForeground) {
          notes.push(
            `Raised ${JSON.stringify(activation.title)} first (verified after ${activation.verifiedAfterMs}ms), ` +
              'so the click was delivered rather than spent on activation.',
          );
        }
        if (activation?.attempted && !activation.ok) {
          notes.push(
            `The window under that point (${JSON.stringify(activation.title)}) could NOT be brought to the ` +
              'foreground, so Windows may have consumed this click merely to activate it. Capture the screen ' +
              'before clicking again rather than clicking twice on faith.',
          );
        }
        if (activation && !activation.attempted) {
          notes.push(`No activation was needed: ${activation.reason}.`);
        }

        const suspect = !moved || (activation?.attempted === true && activation.ok === false);
        return {
          status: suspect ? 'warning' : 'ok',
          message: `${action} at (${point.x}, ${point.y}).${notes.length > 0 ? ` ${notes.join(' ')}` : ''}`,
          performed: {
            action,
            x: point.x,
            y: point.y,
            button,
            times,
            ...(activation ? { activation } : {}),
          },
          cursorAfter: landed,
          cursorMoved: moved,
        };
      }

      case 'move': {
        const point = targetPoint(args);
        mods.win32.moveCursor(point.x, point.y);
        const landed = api.cursorPosition();
        return {
          status: 'ok',
          message: `Moved the pointer to (${point.x}, ${point.y}).`,
          cursor: landed,
        };
      }

      case 'drag': {
        const from = args.from;
        const to = args.to;
        if (!from || !to) throw new Error('drag needs `from` and `to` objects with x and y');
        const start = targetPoint(from);
        const end = targetPoint(to);
        const button = args.button ?? 'left';
        mods.win32.moveCursor(start.x, start.y);
        sleepSync(80);
        mods.win32.mouseDown(button);
        // Intermediate moves matter: many apps only recognise a drag once they
        // see movement while the button is held.
        const steps = 12;
        for (let i = 1; i <= steps; i += 1) {
          mods.win32.moveCursor(
            Math.round(start.x + ((end.x - start.x) * i) / steps),
            Math.round(start.y + ((end.y - start.y) * i) / steps),
          );
          sleepSync(18);
        }
        mods.win32.mouseUp(button);
        return {
          status: 'ok',
          message: `Dragged with the ${button} button from (${start.x}, ${start.y}) to (${end.x}, ${end.y}).`,
          performed: { action: 'drag', from: start, to: end, button },
        };
      }

      case 'scroll': {
        const target = args.x !== undefined || args.y !== undefined ? targetPoint(args) : api.cursorPosition();
        const clicks = args.clicks ?? 3;
        if (args.x !== undefined || args.y !== undefined) mods.win32.moveCursor(target.x, target.y);
        mods.win32.scroll(clicks, args.horizontal === true);
        return {
          status: 'ok',
          message:
            `Scrolled ${clicks > 0 ? 'up/away' : 'down/toward'} by ${Math.abs(clicks)} notch(es)` +
            `${args.horizontal === true ? ' horizontally' : ''} at (${target.x}, ${target.y}).`,
          performed: { action: 'scroll', at: target, clicks, horizontal: args.horizontal === true },
        };
      }

      case 'type': {
        const text = args.text;
        if (typeof text !== 'string' || text.length === 0) throw new Error('type needs a non-empty `text`');
        if (text.length > 20000) throw new Error('type accepts at most 20000 characters per call');

        // A newline in `text` becomes a real key press. Without this the model
        // has to split multi-line input across calls, which is both slower and
        // more error-prone than one call that knows the difference between an
        // editor (Enter) and a chat box (Shift+Enter).
        const mode = args.newline === 'shiftEnter' ? 'shiftEnter' : 'enter';
        const lines = text.split(/\r\n|\r|\n/);
        let typed = 0;
        for (let i = 0; i < lines.length; i += 1) {
          if (lines[i].length > 0) typed += mods.win32.typeText(lines[i]);
          if (i + 1 < lines.length) {
            if (mode === 'shiftEnter') mods.win32.keyDown('shift');
            try {
              mods.win32.keyTap('enter');
            } finally {
              if (mode === 'shiftEnter') mods.win32.keyUp('shift');
            }
            sleepSync(40);
          }
        }

        const breaks = Math.max(0, lines.length - 1);
        return {
          status: 'ok',
          message:
            `Typed ${typed} character(s) into the focused control` +
            `${breaks > 0 ? `, with ${breaks} newline(s) sent as ${mode === 'shiftEnter' ? 'Shift+Enter' : 'Enter'}` : ''}.`,
          performed: { action: 'type', characters: typed, newlines: breaks, newlineMode: mode },
        };
      }

      case 'shortcut': {
        const combo = args.keys;
        if (typeof combo !== 'string' || combo.length === 0) throw new Error('shortcut needs `keys`, e.g. "ctrl+shift+s"');
        const executed = mods.win32.shortcut(combo);
        return {
          status: 'ok',
          message: `Pressed ${executed}.`,
          performed: { action: 'shortcut', keys: executed },
        };
      }

      case 'key': {
        const key = args.key;
        if (typeof key !== 'string' || key.length === 0) throw new Error('key needs a key name, e.g. "enter"');
        const repeats = args.repeats ?? 1;
        for (let i = 0; i < repeats; i += 1) {
          mods.win32.keyTap(key);
          if (i + 1 < repeats) sleepSync(40);
        }
        return {
          status: 'ok',
          message: `Pressed ${key}${repeats > 1 ? ` ${repeats} times` : ''}.`,
          performed: { action: 'key', key, repeats },
        };
      }

      case 'cursor': {
        const position = api.cursorPosition();
        return {
          status: 'ok',
          message: `The pointer is at (${position.x}, ${position.y}).`,
          cursor: position,
        };
      }

      case 'sleep': {
        const ms = args.sleep ?? args.ms ?? 300;
        await wait(ms);
        return { status: 'ok', message: `Waited ${ms}ms.`, performed: { action: 'sleep', ms } };
      }

      case 'waitForChange':
      case 'waitUntilStable': {
        const timeout = clampNumber(args.timeoutMs, 100, 120000, 5000);
        const interval = clampNumber(args.intervalMs, 30, 5000, 120);
        const tolerance = clampNumber(args.pixelTolerance, 0, 765, 24);
        const probeMax = clampNumber(args.probeMaxDimension, 64, 2048, 420);
        const threshold = clampNumber(args.minChange, 0, 1, 0.002);
        const started = Date.now();

        let previous = probeFrame(args.region, probeMax);
        const baseline = previous;
        let lastChangeAt = started;
        let samples = 1;
        let ratio = 0;

        if (action === 'waitForChange') {
          while (Date.now() - started < timeout) {
            await wait(interval);
            const frame = probeFrame(args.region, probeMax);
            samples += 1;
            ratio = frameDifference(baseline, frame, tolerance);
            if (ratio >= threshold) {
              const elapsed = Date.now() - started;
              return {
                status: 'ok',
                changed: true,
                waitedMs: elapsed,
                changeRatio: Number(ratio.toFixed(5)),
                samples,
                message:
                  `Screen changed ${elapsed}ms after watching began ` +
                  `(${(ratio * 100).toFixed(2)}% of sampled pixels differ, threshold ${(threshold * 100).toFixed(2)}%). ` +
                  'Watcher is done: capture now to see the new state.',
              };
            }
          }
          return {
            status: 'warning',
            changed: false,
            waitedMs: Date.now() - started,
            changeRatio: Number(ratio.toFixed(5)),
            samples,
            message:
              `Nothing changed in ${timeout}ms of watching (largest difference ${(ratio * 100).toFixed(2)}%, ` +
              `threshold ${(threshold * 100).toFixed(2)}%). Either it finished before you looked, or the change is ` +
              'smaller than the threshold. Capture the region and see for yourself instead of waiting longer.',
          };
        }

        const quietTarget = clampNumber(args.quietMs, 50, 10000, 300);
        while (Date.now() - started < timeout) {
          await wait(interval);
          const frame = probeFrame(args.region, probeMax);
          samples += 1;
          ratio = frameDifference(previous, frame, tolerance);
          previous = frame;
          if (ratio >= threshold) {
            lastChangeAt = Date.now();
          } else if (Date.now() - lastChangeAt >= quietTarget) {
            return {
              status: 'ok',
              stable: true,
              waitedMs: Date.now() - started,
              quietMs: quietTarget,
              samples,
              message:
                `Screen has been still for ${quietTarget}ms (last movement ${lastChangeAt - started}ms in, ` +
                `${samples} samples). It is settled, so a capture taken now shows the final state — the right ` +
                'moment to check what typing or a click actually did.',
            };
          }
        }
        return {
          status: 'warning',
          stable: false,
          waitedMs: Date.now() - started,
          samples,
          message:
            `The screen was still changing after ${timeout}ms (${samples} samples). Something is animating, ` +
            'loading or scrolling. Capture anyway and treat the result as a moving target, or raise timeoutMs.',
        };
      }

      default:
        throw new Error(
          `unknown action ${JSON.stringify(action)}. Valid actions: screenshot, screen_info, windows, ` +
            'focus_window, click, double_click, right_click, middle_click, move, drag, scroll, type, shortcut, ' +
            'key, cursor, sleep, waitForChange, waitUntilStable.',
        );
    }
  }

  /** Screen facts worth returning with every capture. */
  function screenContext() {
    const d = desktop();
    return {
      screen: { width: d.width, height: d.height, originX: d.x, originY: d.y, dpi: d.dpi },
      cursor: mods.win32.win32().cursorPosition(),
    };
  }

  /**
   * Render the window list as text.
   *
   * The list has to be *rendered*, not merely returned: the dispatcher validates
   * the value against the output schema and then builds the model's content from
   * `output.render` alone, so a declared-but-unrendered field never reaches the
   * model. Returning the array without printing it left the agent knowing only
   * "5 windows found" while being unable to name one.
   *
   * @param windows - the window records, largest first.
   * @param foreground - the current foreground window record, if any.
   * @param filtered - excluded but visible-to-a-user windows, when requested.
   * @param filteredTotal - how many windows were excluded in total.
   * @returns the model-facing text.
   */
  function formatWindowList(windows, foreground, filtered, filteredTotal = 0) {
    if (windows.length === 0) {
      return (
        'No top-level windows with titles are visible. For a window without a title, or a dialog, ' +
        'capture the whole screen instead.'
      );
    }

    const lines = windows.map((w) => {
      const size = `${w.bounds.width}x${w.bounds.height}`;
      const at = `${w.bounds.x},${w.bounds.y}`;
      const flags = [
        w.minimized ? 'minimized' : '',
        w.noRedirection ? 'gpu-composited' : '',
      ].filter(Boolean);
      return (
        `${w.handle} | ${size} at ${at} | pid ${w.pid}` +
        `${flags.length > 0 ? ` | ${flags.join(', ')}` : ''} | ${w.title}`
      );
    });

    const notes = [
      `Found ${windows.length} window(s), largest first. Format: handle | size at x,y | pid | flags | title.`,
      'Pass a title substring or the handle as `window` to capture one, or use `focus_window` to raise it.',
    ];
    if (foreground) {
      notes.push(`Current foreground: ${foreground.handle} ${JSON.stringify(foreground.title)}.`);
    }
    if (windows.some((w) => w.noRedirection)) {
      notes.push(
        'Windows marked `gpu-composited` draw through a GPU surface that the OS cannot redirect; ' +
          'capturing one usually returns a blank or black image. Capture the screen region instead, ' +
          'and make sure the window is visible on screen first.',
      );
    }
    if (filtered === null) {
      notes.push(
        'If a window you can see on screen is missing here, re-run with `includeFiltered: true` to see ' +
          'what was excluded and why.',
      );
    }
    if (filtered && filtered.length > 0) {
      const rows = filtered.map(
        (w) =>
          `  EXCLUDED [${w.reason}] ${w.bounds.width}x${w.bounds.height} at ${w.bounds.x},${w.bounds.y} ` +
          `pid ${w.pid} handle ${w.handle} | ${JSON.stringify(w.title)}`,
      );
      notes.push(
        `\n${filteredTotal} window(s) were excluded by the filter chain; the ${filtered.length} below are ` +
          'excluded by a rule a *user* could notice (the rest are invisible helper windows). An excluded ' +
          'window can still be captured by handle or read off a full-screen capture.',
        rows.join('\n'),
      );
    } else if (filtered && filtered.length === 0) {
      notes.push(
        `Nothing a user could see was excluded (${filteredTotal} invisible helper window(s) were skipped).`,
      );
    }
    return `${notes.join(' ')}\n${lines.join('\n')}`;
  }

  /**
   * One step's model-facing line inside a batch log.
   *
   * A batch runs through `runAction` directly, so it never goes past the schema;
   * only `render` output reaches the model. Reading state actions therefore have
   * to print their values here or they would report nothing useful.
   *
   * @param action - the action name.
   * @param value - that action's result value.
   * @returns a single line of text.
   */
  function stepDetail(action, value) {
    switch (action) {
      case 'cursor':
        return `pointer at (${value.cursor.x}, ${value.cursor.y})`;
      case 'screen_info':
        return (
          `${value.screen.width}x${value.screen.height} at (${value.screen.originX}, ${value.screen.originY}), ` +
          `dpi ${value.screen.dpi}, cursor (${value.cursor.x}, ${value.cursor.y})`
        );
      case 'windows':
        return `found ${value.count} window(s): ${(value.windows ?? [])
          .slice(0, 12)
          .map((w) => `${w.handle} ${JSON.stringify(w.title)} ${w.bounds.width}x${w.bounds.height}`)
          .join('; ')}`;
      case 'screenshot':
        return `captured ${value.screenshot.width}x${value.screenshot.height} of ${value.screenshot.label}`;
      case 'sleep':
        return value.message;
      default:
        return value.message ?? 'ok';
    }
  }

  /** Human-readable summary of a capture. */
  function describeCapture(meta) {
    const parts = [
      `Captured ${meta.label}: ${meta.width}x${meta.height} image, native resolution, of a ${meta.region.width}x${meta.region.height} screen area at (${meta.region.x}, ${meta.region.y}).`,
      'Image pixels are screen pixels: add the region origin to convert a point on the image into a click coordinate.',
    ];
    if (!meta.native) {
      parts.push(
        `This capture was scaled by ${meta.scale} (only happens above the deployment's size cap), so ` +
          `screen = region origin + image point / ${meta.scale}.`,
      );
    }
    if (meta.gridStep) {
      // Labels are printed at every second grid line, so the cadence is 2x the step.
      parts.push(`A ruler is drawn on the image, labelled in screen pixels every ${meta.gridStep * 2}.`);
    }
    if (meta.quadrants) parts.push(`Quadrant guide: ${meta.quadrants.join('; ')}.`);
    if (meta.window) parts.push(`Source window ${JSON.stringify(meta.window.title)} captured via ${meta.window.method}.`);
    if (meta.changed !== undefined) {
      parts.push(
        meta.changed
          ? 'Compared with the previous capture of this exact area: the screen CHANGED.'
          : 'Compared with the previous capture of this exact area: the screen is UNCHANGED (identical fingerprint), so nothing visible has happened yet.',
      );
    }
    if (meta.attachmentError) {
      parts.push(
        `NO IMAGE WAS ATTACHED TO THIS RESULT (${meta.attachmentError}). ` +
          `The PNG is at ${meta.file}; read it with read_image, or tell the user the image could not be delivered rather than guessing at its contents.`,
      );
    }
    return parts.join(' ');
  }

  // -------------------------------------------------------------------------
  // Tool registration
  // -------------------------------------------------------------------------

  const COMMON_PARAMETERS = {
    action: {
      type: 'string',
      required: true,
      enum: [
        'screenshot',
        'screen_info',
        'windows',
        'focus_window',
        'click',
        'double_click',
        'right_click',
        'middle_click',
        'move',
        'drag',
        'scroll',
        'type',
        'shortcut',
        'key',
        'cursor',
        'sleep',
        'waitForChange',
        'waitUntilStable',
      ],
      description: 'Which operation to perform.',
    },
    x: { type: 'number', description: 'Screen x coordinate (physical pixels), for pointing actions.' },
    y: { type: 'number', description: 'Screen y coordinate (physical pixels), for pointing actions.' },
    region: {
      type: 'object',
      additionalProperties: false,
      description:
        'Area of the screen to capture, in screen pixels. Prefer a SMALL region for reading fine detail: a region whose longest side is within nativeMaxDimension is captured at scale 1.',
      properties: {
        x: { type: 'number', required: true, description: 'Left edge.' },
        y: { type: 'number', required: true, description: 'Top edge.' },
        width: { type: 'number', required: true, description: 'Width in pixels.' },
        height: { type: 'number', required: true, description: 'Height in pixels.' },
      },
    },
    monitor: { type: 'number', description: 'Monitor index to capture instead of a region. 0 is the whole desktop.' },
    window: {
      type: 'string',
      description:
        'Capture one window instead of the screen, by title substring or numeric handle from the `windows` action. Works for a window that is partially covered or offscreen.',
    },
    grid: { type: 'boolean', description: 'Draw a labelled coordinate ruler on the captured image.' },
    quadrants: { type: 'boolean', description: 'Draw numbered quadrant markers on the captured image.' },
    scale: {
      type: 'number',
      description:
        'Optional capture-time scale below 1 to shrink a large capture. Omit it: captures are native resolution, and the model downsamples images itself. Use it only when a deliberately smaller overview is more useful than full detail.',
    },
    tiles: {
      type: 'number',
      description:
        'Split the captured area into up to 9 native-resolution tiles returned in one call. Use when you need to read detail across a large area without several round trips.',
    },
    from: {
      type: 'object',
      additionalProperties: false,
      description: 'Drag start point.',
      properties: {
        x: { type: 'number', required: true },
        y: { type: 'number', required: true },
      },
    },
    to: {
      type: 'object',
      additionalProperties: false,
      description: 'Drag end point.',
      properties: {
        x: { type: 'number', required: true },
        y: { type: 'number', required: true },
      },
    },
    button: { type: 'string', enum: ['left', 'right', 'middle'], description: 'Mouse button for drag. Defaults to left.' },
    clicks: { type: 'number', description: 'Wheel notches for scroll. Positive scrolls up, negative down. Defaults to 3.' },
    horizontal: { type: 'boolean', description: 'Scroll horizontally instead of vertically.' },
    text: { type: 'string', description: 'Literal text to type. Handles arbitrary Unicode, including CJK.' },
    keys: { type: 'string', description: 'Key chord for shortcut, e.g. "ctrl+shift+s" or "alt+f4".' },
    key: { type: 'string', description: 'Single key name for key, e.g. "enter", "escape", "tab", "f5", "left".' },
    repeats: { type: 'number', description: 'Times to repeat a key press. Defaults to 1.' },
    title: { type: 'string', description: 'Window title substring for focus_window.' },
    handle: { type: 'string', description: 'Numeric window handle for focus_window.' },
    sleep: { type: 'number', description: 'Milliseconds to wait before this action runs (or after it, in a batch).' },
    timeoutMs: {
      type: 'number',
      description:
        'For waitForChange / waitUntilStable: how long to keep watching before giving up. Defaults to 5000.',
    },
    intervalMs: {
      type: 'number',
      description: 'For waitForChange / waitUntilStable: how often to sample the screen. Defaults to 120.',
    },
    quietMs: {
      type: 'number',
      description:
        'For waitUntilStable: how long the picture must stay unchanged before it counts as settled. Defaults to 300.',
    },
    minChange: {
      type: 'number',
      description:
        'Fraction of sampled pixels that must differ (0..1) to count as a change. Defaults to 0.002 for waitForChange, and is the "still moving" threshold for waitUntilStable.',
    },
    pixelTolerance: {
      type: 'number',
      description:
        'Per-pixel colour distance (0..765, summed over RGB) ignored as noise by the wait actions. Defaults to 24, which rides out antialiasing and cursor blink.',
    },
    includeFiltered: {
      type: 'boolean',
      description:
        'For windows: also list the windows that were excluded from the list, each with the reason. Use when a window you can see on screen is missing.',
    },
    ensureForeground: {
      type: 'boolean',
      description:
        'For clicking actions: raise the window under the pointer before clicking, so Windows does not spend the click on activation. Defaults to true; set false to click without touching focus.',
    },
    newline: {
      type: 'string',
      enum: ['enter', 'shiftEnter'],
      description:
        'For type: which key to press for each newline in `text`. "enter" (default) for editors, "shiftEnter" for chat boxes where Enter sends.',
    },
  };

  /**
   * One delivered image. Every field here is plain JSON on purpose: the value is
   * JSON-snapshotted before `render` sees it, so the attachment reference has to
   * be part of the declared shape rather than an out-of-band side channel.
   *
   * `required: true` is deliberately absent: the value-schema DSL only supports
   * it on entries directly under `properties`, not inside array `items`.
   */
  const IMAGE_ENTRY_SCHEMA = {
    type: 'object',
    additionalProperties: true,
    properties: {
      attachment: {
        type: 'object',
        additionalProperties: true,
        description: 'Durable attachment reference for this capture.',
      },
      label: { type: 'string', description: 'What was captured: "full screen", "region", or a window title.' },
      width: { type: 'number', description: 'Image width in pixels.' },
      height: { type: 'number', description: 'Image height in pixels.' },
      region: { type: 'object', additionalProperties: true, description: 'Screen area this image covers.' },
      scale: { type: 'number', description: 'Image pixels per screen pixel. 1 means the image is native resolution.' },
      native: { type: 'boolean', description: 'True when the image is 1:1 with the screen.' },
      file: { type: 'string', description: 'Path of the PNG on disk, for read_image or for the user.' },
      hint: { type: 'string', description: 'How to convert a point on this image into a screen coordinate.' },
    },
  };

  const OUTPUT_SCHEMA = {
    type: 'object',
    additionalProperties: true,
    properties: {
      status: { type: 'string', required: true, description: 'ok, warning, or failed.' },
      message: { type: 'string', required: true, description: 'Human-readable outcome, including how to read coordinates.' },
      images: {
        type: 'array',
        description:
          'Images captured by this call, in capture order. These are attached to the result as real images; read `hint` on each to convert a point on the image into a screen coordinate.',
        items: IMAGE_ENTRY_SCHEMA,
      },
      screenshot: { type: 'object', additionalProperties: true, description: 'Capture metadata: region, scale, dimensions, file path.' },
      tiles: { type: 'array', description: 'Per-tile metadata for a tiled capture.', items: { type: 'object', additionalProperties: true } },
      screen: { type: 'object', additionalProperties: true, description: 'Desktop geometry and cursor, to anchor coordinates.' },
      cursor: { type: 'object', additionalProperties: true, description: 'Pointer position after the action.' },
      windows: { type: 'array', description: 'Visible top-level windows, largest first.', items: { type: 'object', additionalProperties: true } },
    },
  };

  /**
   * Build the model-facing content blocks for one call.
   *
   * Attachment references are read from `value.images`, an ordinary enumerable
   * array inside the declared output schema. This is forced by the dispatcher's
   * order of operations: it JSON-snapshots and deep-freezes the value *before*
   * calling `render`, so anything smuggled out-of-band — a Symbol property, a
   * WeakMap keyed by the returned object — is gone by the time `render` runs. The
   * symptom was subtle and misleading: the text block still arrived, so the model
   * was told "captured a 1920x1080 image" while receiving no image at all.
   *
   * @param value - the tool's JSON output value.
   * @returns content blocks.
   */
  function renderValue(value) {
    const blocks = [{ type: 'text', text: String(value?.message ?? 'done') }];
    for (const image of value?.images ?? []) {
      blocks.push({ type: 'image', attachment: image.attachment });
    }
    return blocks;
  }

  /**
   * Describe one delivered image for the model, including the arithmetic it needs
   * to turn a point measured on the image back into a screen coordinate.
   *
   * @param meta - capture metadata.
   * @param attachment - the stored attachment reference.
   * @returns the value-schema image entry.
   */
  function imageEntry(meta, attachment) {
    return {
      attachment,
      label: meta.label,
      width: meta.width,
      height: meta.height,
      region: meta.region,
      scale: meta.scale,
      native: meta.native,
      file: meta.file,
      hint: meta.native
        ? `Full resolution: image pixel + region origin (${meta.region.x}, ${meta.region.y}) = screen coordinate.`
        : `Downscaled by ${meta.scale}: screen = region origin + image point / ${meta.scale}.`,
    };
  }

  /**
   * Register one tool, attributing a failure to this specific instance.
   *
   * The tool registry rejects a duplicate name in one scope with
   * `tool "<name>" is already registered`, and this package is mounted in two
   * places. Without naming the instance, that error is unactionable — it was in
   * fact masked once, showing only as a red "异常" on the plugin list while the
   * mode worked normally.
   *
   * @param tool - the definition built by `defineTool`.
   */
  function registerTool(tool) {
    try {
      ctx.tools.register(tool);
      ctx.logger?.info?.('dsh-computer-use: registered `%s` — %s', tool.name, instanceLabel());
    } catch (error) {
      ctx.logger?.error?.(
        'dsh-computer-use: FAILED to register `%s` — %s. Cause: %s. ' +
          'If this says "already registered", another row for this package is registering the ' +
          'same tools in the same scope; only one row should carry it.',
        tool.name,
        instanceLabel(),
        error.message,
      );
      throw error;
    }
  }

  registerTool(
    defineTool({
      name: 'computer',
      description: TOOL_DESCRIPTION,
      parameters: COMMON_PARAMETERS,
      output: {
        schema: OUTPUT_SCHEMA,
        render: (_args, value) => renderValue(value),
      },
      async execute(args) {
        const action = String(args?.action ?? '');
        if (args?.sleep !== undefined && action !== 'sleep') await wait(args.sleep);
        return runAction(action, args ?? {});
      },
    }),
  );

  registerTool(
    defineTool({
      name: 'computer_batch',
      description: BATCH_DESCRIPTION,
      parameters: {
        actions: {
          type: 'array',
          required: true,
          description: 'Ordered actions to perform. Each entry uses the same fields as the `computer` tool, plus optional `sleep` in milliseconds.',
          items: {
            type: 'object',
            additionalProperties: true,
            properties: COMMON_PARAMETERS,
          },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
          properties: {
            status: { type: 'string', required: true },
            message: { type: 'string', required: true },
            completed: { type: 'number', required: true, description: 'How many actions ran successfully.' },
            total: { type: 'number', required: true, description: 'How many actions were requested.' },
            steps: { type: 'array', description: 'Per-step outcome.', items: { type: 'object', additionalProperties: true } },
            images: {
              type: 'array',
              description: 'One entry per captured image, in capture order.',
              items: { type: 'object', additionalProperties: true },
            },
          },
        },
        render: (_args, value) => renderValue(value),
      },
      async execute(args) {
        const list = Array.isArray(args?.actions) ? args.actions : [];
        if (list.length === 0) throw new Error('computer_batch needs a non-empty `actions` array');
        if (list.length > cfg.maxBatchActions) {
          throw new Error(
            `computer_batch accepts at most ${cfg.maxBatchActions} actions per call (got ${list.length}). ` +
              'Split the sequence, and capture the screen between batches to confirm progress.',
          );
        }

        const images = [];
        const steps = [];
        let failure = null;

        for (let index = 0; index < list.length; index += 1) {
          const step = list[index] ?? {};
          const action = String(step.action ?? '');
          try {
            if (step.sleep !== undefined && action !== 'sleep') await wait(step.sleep);
            const value = await runAction(action, step);
            // Carried at the batch level so a capture mid-sequence still reaches
            // the model as an image, not just a line in the step log.
            for (const entry of value?.images ?? []) images.push(entry);
            const detail = stepDetail(action, value);
            steps.push({
              index,
              action,
              status: value?.status ?? 'ok',
              message: detail,
              ...(value?.screenshot ? { screenshot: value.screenshot } : {}),
              ...(value?.tiles ? { tiles: value.tiles } : {}),
            });
            // A batch may chain sleeps without the caller spelling out `sleep`.
            if (action === 'sleep') continue;
          } catch (error) {
            failure = { index, action, message: error.message };
            steps.push({ index, action, status: 'failed', message: error.message });
            break;
          }
        }

        const stepLog = steps
          .map((s) => `${s.index}. ${s.action} [${s.status}] ${s.message}`)
          .join('\n');
        const value = {
          status: failure ? 'failed' : 'ok',
          message: `${
            failure
              ? `Stopped at step ${failure.index} (${failure.action}): ${failure.message} ` +
                `${steps.length - 1} of ${list.length} actions completed before that.`
              : `Completed all ${list.length} action(s).`
          }\n${stepLog}`,
          completed: failure ? steps.length - 1 : steps.length,
          total: list.length,
          steps,
          images,
        };
        if (failure) value.failure = failure;
        return value;
      },
    }),
  );

  // Guidance the tool descriptions cannot carry: this is workflow policy for the
  // whole mode, and `TOOL_COMPUTER_USE` is the section slot the harness reserves
  // for exactly this.
  const systemPrompt = ctx.get?.('systemPrompt');
  if (systemPrompt && typeof systemPrompt.section === 'function') {
    const order = systemPrompt.getSectionOrder?.('TOOL_COMPUTER_USE') ?? 3000;
    systemPrompt.section({
      name: 'computer:policy',
      order,
      text: () =>
        [
          'Use the screen only when the task depends on something that exists only visually: an application with no CLI or API, a GUI-only setting, a rendered layout, a dialog. A file, command or API is exact and cheaper, so reach for one of those first.',
          '',
          'Work in small, verified steps. Capture, act on one thing, capture again. Never fire a long unbroken sequence of blind clicks: a GUI that has shifted by one control turns confidence into damage. `computer_batch` is for short mechanical runs (click, type, Enter), not for exploring an unfamiliar interface. Close what you opened and hand the desktop back as you found it.',
          '',
          'Before anything destructive or hard to reverse — deleting, overwriting, sending, purchasing, closing unsaved work — say what you are about to do and confirm with the user. Describe credentials and private content that appears on screen only as far as you need to; never echo secrets into the conversation. Never click through a security or elevation prompt (UAC, antivirus, "allow access"): that decision belongs to the user, so stop and ask instead.',
          '',
          'Ground every claim in something you actually observed. Measure a position on a native-resolution capture of that area rather than estimating it from a scaled-down overview, and read the facts a tool has already handed you — the window list names the current foreground window, and clicking reports whether it had to activate one — before inventing a mechanism to explain what you saw. Say plainly when you are inferring rather than reporting, and if a capture arrives without its image, say so instead of describing a screen you cannot see.',
          '',
          'To start an application, work down the four routes in the `computer` tool description and stop at the first that works: reuse a running instance, else the desktop, else Start menu search, and only then a command line. Reuse beats a fresh launch, and a route that failed twice should be replaced rather than repeated.',
        ].join('\n'),
    });
  }

  ctx.logger?.info?.(
    'dsh-computer-use: registered `computer` and `computer_batch` (captures -> %s)',
    outDir,
  );
}

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

/** @returns a promise resolved after `ms` milliseconds. */
function wait(ms) {
  const delay = Math.max(0, Math.min(120000, Math.round(ms)));
  return new Promise((resolvePromise) => setTimeout(resolvePromise, delay));
}

/**
 * Block the calling thread briefly. Used for the sub-50ms gaps inside a single
 * gesture (between a double-click's two presses, or along a drag path) where any
 * longer pause would break the gesture.
 */
function sleepSync(ms) {
  const shared = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(shared, 0, 0, ms);
}

/** Write a file, surfacing a clearer error than the raw fs failure. */
function writeFileSyncSafe(file, data) {
  try {
    writeFileSync(file, data);
    // Verify it really landed; a sandboxed or redirected path would otherwise
    // report success and hand the model a path that does not exist.
    const stats = statSync(file);
    if (stats.size !== data.length) {
      throw new Error(`wrote ${stats.size} bytes but expected ${data.length}`);
    }
  } catch (error) {
    throw new Error(`dsh-computer-use: cannot write the capture to ${file} (${error.message})`);
  }
}

module.exports = { name, inject, Config, apply };

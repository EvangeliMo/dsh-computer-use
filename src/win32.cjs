/**
 * dsh-computer-use —Win32 FFI layer.
 *
 * The DSH plugin host is an Electron *Node-mode* child process: `require('electron')`
 * fails, so `desktopCapturer` is unreachable. It can, however, load native addons.
 * `koffi` is a top-level dependency of the installation, so we bind Win32 directly.
 *
 * COORDINATE SPACE (the single most important invariant in this package)
 * ---------------------------------------------------------------------
 * Measured in the live host process: thread DPI awareness = PER_MONITOR_AWARE,
 * GetDpiForSystem() = 120, SM_CXSCREEN = DESKTOPHORZRES = 1920.
 * Therefore screenshots, GetSystemMetrics, GetCursorPos and SetCursorPos all
 * operate in the *same* physical-pixel space and need no conversion. We never
 * rescale coordinates; the only scaling in this package is on the image we hand
 * to the model, and that scale factor is reported back to it explicitly.
 *
 * All bindings are lazy: `require()` of koffi happens on first use so a broken
 * koffi install degrades to a clear tool error instead of killing plugin load.
 */

'use strict';

const { requireFromInstall } = require('../lib/loader.cjs');

/** Virtual key codes we expose to the model, by lower-case canonical name. */
const VK = {
  backspace: 0x08,
  tab: 0x09,
  enter: 0x0d,
  return: 0x0d,
  shift: 0x10,
  ctrl: 0x11,
  control: 0x11,
  alt: 0x12,
  menu: 0x12,
  pause: 0x13,
  capslock: 0x14,
  escape: 0x1b,
  esc: 0x1b,
  space: 0x20,
  pageup: 0x21,
  pgup: 0x21,
  pagedown: 0x22,
  pgdn: 0x22,
  end: 0x23,
  home: 0x24,
  left: 0x25,
  arrowleft: 0x25,
  up: 0x26,
  arrowup: 0x26,
  right: 0x27,
  arrowright: 0x27,
  down: 0x28,
  arrowdown: 0x28,
  select: 0x29,
  print: 0x2a,
  printscreen: 0x2c,
  insert: 0x2d,
  ins: 0x2d,
  delete: 0x2e,
  del: 0x2e,
  win: 0x5b,
  lwin: 0x5b,
  rwin: 0x5c,
  numpad0: 0x60,
  numpad1: 0x61,
  numpad2: 0x62,
  numpad3: 0x63,
  numpad4: 0x64,
  numpad5: 0x65,
  numpad6: 0x66,
  numpad7: 0x67,
  numpad8: 0x68,
  numpad9: 0x69,
  multiply: 0x6a,
  add: 0x6b,
  subtract: 0x6d,
  decimal: 0x6e,
  divide: 0x6f,
  f1: 0x70,
  f2: 0x71,
  f3: 0x72,
  f4: 0x73,
  f5: 0x74,
  f6: 0x75,
  f7: 0x76,
  f8: 0x77,
  f9: 0x78,
  f10: 0x79,
  f11: 0x7a,
  f12: 0x7b,
  numlock: 0x90,
  scrolllock: 0x91,
};

/** Modifier aliases accepted inside a `shortcut` string. */
const MODIFIER_ALIASES = {
  ctrl: 'ctrl',
  control: 'ctrl',
  shift: 'shift',
  alt: 'alt',
  win: 'win',
  meta: 'win',
  cmd: 'win',
  super: 'win',
};

/** Mouse button name -> (downFlag, upFlag, dataField). */
const BUTTONS = {
  left: { down: 0x0002, up: 0x0004, data: 0 },
  right: { down: 0x0008, up: 0x0010, data: 0 },
  middle: { down: 0x0020, up: 0x0040, data: 0 },
  x1: { down: 0x0080, up: 0x0100, data: 1 },
  x2: { down: 0x0080, up: 0x0100, data: 2 },
};

let cached = null;

/**
 * Bind every Win32 entry point once. Throws a descriptive error when koffi or a
 * symbol is unavailable, so the tool layer can surface it to the model.
 *
 * @returns the bound API surface.
 */
function load() {
  if (cached) return cached;

  let koffi;
  try {
    koffi = requireFromInstall('koffi', 'screen capture and input synthesis');
  } catch (error) {
    throw new Error(
      'dsh-computer-use: cannot load `koffi`, which this plugin needs for screen capture and ' +
        `input synthesis. The DSH installation normally ships it as a top-level dependency. (${error.message})`,
    );
  }

  const user32 = koffi.load('user32.dll');
  const gdi32 = koffi.load('gdi32.dll');
  const dwmapi = koffi.load('dwmapi.dll');
  const kernel32 = koffi.load('kernel32.dll');

  const fn = (lib, signature) => {
    const name = signature.slice(0, signature.indexOf('(')).trim().split(/\s+/).pop();
    try {
      return lib.func(signature);
    } catch (error) {
      throw new Error(`dsh-computer-use: Win32 symbol ${name} is unavailable (${error.message})`);
    }
  };

  // ---- structs -------------------------------------------------------------
  const MOUSEINPUT = koffi.struct('MOUSEINPUT', {
    dx: 'int32',
    dy: 'int32',
    mouseData: 'uint32',
    dwFlags: 'uint32',
    time: 'uint32',
    dwExtraInfo: 'uint64',
  });
  const KEYBDINPUT = koffi.struct('KEYBDINPUT', {
    wVk: 'uint16',
    wScan: 'uint16',
    dwFlags: 'uint32',
    time: 'uint32',
    dwExtraInfo: 'uint64',
  });
  const HARDWAREINPUT = koffi.struct('HARDWAREINPUT', {
    uMsg: 'uint32',
    wParamL: 'uint16',
    wParamH: 'uint16',
  });
  const INPUTUNION = koffi.union('INPUTUNION', {
    mi: MOUSEINPUT,
    ki: KEYBDINPUT,
    hi: HARDWAREINPUT,
  });
  const INPUT = koffi.struct('INPUT', { type: 'uint32', u: INPUTUNION });

  const RECT = koffi.struct('RECT', {
    left: 'int32',
    top: 'int32',
    right: 'int32',
    bottom: 'int32',
  });
  // BITMAPINFO is a 40-byte header followed by a colour table. For a 32-bit
  // BI_RGB DIB the table is unused, and `bmiColors[1]` may be passed there.
  // Modelling it as a flat 44-byte struct avoids koffi array-padding ambiguity,
  // while keeping the header fields at their documented offsets (0..40).
  const BITMAPINFO = koffi.struct('BITMAPINFO', {
    biSize: 'uint32',
    biWidth: 'int32',
    biHeight: 'int32',
    biPlanes: 'uint16',
    biBitCount: 'uint16',
    biCompression: 'uint32',
    biSizeImage: 'uint32',
    biXPelsPerMeter: 'int32',
    biYPelsPerMeter: 'int32',
    biClrUsed: 'uint32',
    biClrImportant: 'uint32',
    bmiColors: 'uint32',
  });
  const POINT = koffi.struct('POINT', { x: 'int32', y: 'int32' });

  // EnumWindows needs a declared callback *type*. The working koffi form is a
  // named prototype plus a `Proto*` parameter, with a plain JavaScript function
  // passed at call time — `koffi.register()` is rejected with "Unexpected
  // EnumWindowsProc type, expected <callback> * type" for this signature.
  const EnumWindowsProc = koffi.proto('bool EnumWindowsProc(void* hwnd, intptr_t lParam)');

  const api = {
    koffi,

    // ---- desktop geometry --------------------------------------------------
    GetSystemMetrics: fn(user32, 'int GetSystemMetrics(int nIndex)'),
    GetDpiForSystem: fn(user32, 'uint32 GetDpiForSystem()'),
    GetDpiForWindow: fn(user32, 'uint32 GetDpiForWindow(void* hwnd)'),
    GetThreadDpiAwarenessContext: fn(user32, 'void* GetThreadDpiAwarenessContext()'),
    GetAwarenessFromDpiAwarenessContext: fn(
      user32,
      'int GetAwarenessFromDpiAwarenessContext(void* value)',
    ),
    SetThreadDpiAwarenessContext: fn(
      user32,
      'void* SetThreadDpiAwarenessContext(void* value)',
    ),

    // ---- cursor & input ----------------------------------------------------
    GetCursorPos: fn(user32, 'bool GetCursorPos(_Out_ POINT* lpPoint)'),
    SetCursorPos: fn(user32, 'bool SetCursorPos(int X, int Y)'),
    SendInput: fn(user32, 'uint32 SendInput(uint32 nInputs, INPUT* pInputs, int cbSize)'),

    // ---- windows -----------------------------------------------------------
    EnumWindows: fn(user32, 'bool EnumWindows(EnumWindowsProc* cb, intptr_t lParam)'),
    IsWindowVisible: fn(user32, 'bool IsWindowVisible(void* hwnd)'),
    IsIconic: fn(user32, 'bool IsIconic(void* hwnd)'),
    GetWindowTextLengthW: fn(user32, 'int GetWindowTextLengthW(void* hwnd)'),
    GetWindowTextW: fn(user32, 'int GetWindowTextW(void* hwnd, char16_t* buf, int max)'),
    GetWindowRect: fn(user32, 'bool GetWindowRect(void* hwnd, _Out_ RECT* rect)'),
    GetClientRect: fn(user32, 'bool GetClientRect(void* hwnd, _Out_ RECT* rect)'),
    GetWindowThreadProcessId: fn(
      user32,
      'uint32 GetWindowThreadProcessId(void* hwnd, _Out_ uint32* pid)',
    ),
    GetForegroundWindow: fn(user32, 'void* GetForegroundWindow()'),
    SetForegroundWindow: fn(user32, 'bool SetForegroundWindow(void* hwnd)'),
    ShowWindow: fn(user32, 'bool ShowWindow(void* hwnd, int cmd)'),
    IsWindow: fn(user32, 'bool IsWindow(void* hwnd)'),
    GetWindowLongPtrW: fn(user32, 'intptr_t GetWindowLongPtrW(void* hwnd, int index)'),
    // Hit-testing and activation. A click lands on whatever *child* owns the
    // pixel, but "is this window in front" is a property of the top-level
    // ancestor, so both are needed to decide whether a click will be eaten by
    // Windows' activate-on-first-click behaviour.
    WindowFromPoint: fn(user32, 'void* WindowFromPoint(POINT point)'),
    GetAncestor: fn(user32, 'void* GetAncestor(void* hwnd, uint32 flags)'),
    BringWindowToTop: fn(user32, 'bool BringWindowToTop(void* hwnd)'),
    AttachThreadInput: fn(user32, 'bool AttachThreadInput(uint32 attachFrom, uint32 attachTo, bool attach)'),
    GetCurrentThreadId: fn(kernel32, 'uint32 GetCurrentThreadId()'),
    // Reports the composited window frame, which excludes the invisible resize
    // border that GetWindowRect includes.
    //
    // Two bindings for one export: the attribute's payload type differs per
    // attribute id (a RECT for the frame, a uint32 for the cloaked flag), and
    // koffi resolves a function by name at bind time but marshals strictly by
    // the declared signature. Declaring the second parameter as `void*` would
    // make every call ambiguous, so each shape gets its own binding.
    DwmGetWindowAttribute: fn(
      dwmapi,
      'int32 DwmGetWindowAttribute(void* hwnd, uint32 attr, _Out_ RECT* out, uint32 size)',
    ),
    DwmGetWindowAttributeU32: fn(
      dwmapi,
      'int32 DwmGetWindowAttribute(void* hwnd, uint32 attr, _Out_ uint32* out, uint32 size)',
    ),

    // ---- capturing ---------------------------------------------------------
    GetDC: fn(user32, 'void* GetDC(void* hwnd)'),
    ReleaseDC: fn(user32, 'int ReleaseDC(void* hwnd, void* hdc)'),
    PrintWindow: fn(user32, 'bool PrintWindow(void* hwnd, void* hdc, uint32 flags)'),
    CreateDCW: fn(
      gdi32,
      'void* CreateDCW(const char16_t* driver, const char16_t* device, const char16_t* port, void* initData)',
    ),
    DeleteDC: fn(gdi32, 'bool DeleteDC(void* hdc)'),
    CreateCompatibleDC: fn(gdi32, 'void* CreateCompatibleDC(void* hdc)'),
    DeleteObject: fn(gdi32, 'bool DeleteObject(void* ho)'),
    CreateCompatibleBitmap: fn(gdi32, 'void* CreateCompatibleBitmap(void* hdc, int cx, int cy)'),
    SelectObject: fn(gdi32, 'void* SelectObject(void* hdc, void* h)'),
    BitBlt: fn(
      gdi32,
      'bool BitBlt(void* hdcDest, int x, int y, int cx, int cy, void* hdcSrc, int x1, int y1, uint32 rop)',
    ),
    StretchBlt: fn(
      gdi32,
      'bool StretchBlt(void* hdcDest, int x, int y, int cx, int cy, void* hdcSrc, int x1, int y1, int cx1, int cy1, uint32 rop)',
    ),
    SetStretchBltMode: fn(gdi32, 'int SetStretchBltMode(void* hdc, int mode)'),
    GetDIBits: fn(
      gdi32,
      'int GetDIBits(void* hdc, void* hbm, uint32 start, uint32 lines, _Out_ uint8* bits, _Inout_ BITMAPINFO* bmi, uint32 usage)',
    ),
    GetDeviceCaps: fn(gdi32, 'int GetDeviceCaps(void* hdc, int index)'),
    CreateRoundRectRgn: fn(
      gdi32,
      'void* CreateRoundRectRgn(int l, int t, int r, int b, int w, int h)',
    ),
    GetStockObject: fn(gdi32, 'void* GetStockObject(int i)'),
    GetWindowDC: fn(user32, 'void* GetWindowDC(void* hwnd)'),

    // ---- structs / enums used by callers -----------------------------------
    structs: { INPUT, MOUSEINPUT, KEYBDINPUT, HARDWAREINPUT, RECT, BITMAPINFO, POINT },
    butts: BUTTONS,
    vk: VK,
  };

  // Convenience wrappers -----------------------------------------------------

  api.INPUT_SIZE = koffi.sizeof(INPUT);

  /** @returns {{x: number, y: number}} current cursor position in physical pixels. */
  api.cursorPosition = () => {
    const point = {};
    if (!api.GetCursorPos(point)) throw new Error('GetCursorPos failed');
    return { x: point.x, y: point.y };
  };

  /**
   * Send a batch of INPUT records.
   * @param records - array of INPUT-shaped objects.
   * @returns number of events the OS accepted.
   */
  api.send = (records) => {
    if (records.length === 0) return 0;
    return api.SendInput(records.length, records, api.INPUT_SIZE);
  };

  /** Full virtual-desktop geometry in physical pixels. */
  api.desktop = () => ({
    x: api.GetSystemMetrics(76), // SM_XVIRTUALSCREEN
    y: api.GetSystemMetrics(77), // SM_YVIRTUALSCREEN
    width: api.GetSystemMetrics(78), // SM_CXVIRTUALSCREEN
    height: api.GetSystemMetrics(79), // SM_CYVIRTUALSCREEN
    primaryWidth: api.GetSystemMetrics(0),
    primaryHeight: api.GetSystemMetrics(1),
    monitors: api.GetSystemMetrics(80), // SM_CMONITORS
    dpi: api.GetDpiForSystem(),
    awareness: api.GetAwarenessFromDpiAwarenessContext(api.GetThreadDpiAwarenessContext()),
  });

  cached = api;
  return api;
}

/** @returns the lazily-bound Win32 API surface. */
function win32() {
  return load();
}

/** @returns whether the native layer can be bound at all, without throwing. */
function probeWin32() {
  try {
    load();
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error.message };
  }
}

// ---------------------------------------------------------------------------
// Input synthesis helpers
// ---------------------------------------------------------------------------

const MOUSEEVENTF = {
  MOVE: 0x0001,
  LEFTDOWN: 0x0002,
  LEFTUP: 0x0004,
  RIGHTDOWN: 0x0008,
  RIGHTUP: 0x0010,
  MIDDLEDOWN: 0x0020,
  MIDDLEUP: 0x0040,
  WHEEL: 0x0800,
  HWHEEL: 0x1000,
  ABSOLUTE: 0x8000,
  VIRTUALDESK: 0x4000,
};

const KEYEVENTF = {
  EXTENDEDKEY: 0x0001,
  KEYUP: 0x0002,
  UNICODE: 0x0004,
  SCANCODE: 0x0008,
};

/**
 * Normalise a physical-pixel point into the 0..65535 absolute range SendInput
 * expects for the virtual desktop. We deliberately use the virtual-desktop
 * mapping (VIRTUALDESK) so multi-monitor coordinates work unchanged.
 *
 * @param x - physical x.
 * @param y - physical y.
 * @returns {{dx: number, dy: number}} normalised absolute coordinates.
 */
function toAbsolute(x, y) {
  const api = win32();
  const d = api.desktop();
  const sx = Math.max(1, d.width - 1);
  const sy = Math.max(1, d.height - 1);
  // 65535 spans the whole virtual desktop; add 0.5 to land on the nearest pixel.
  return {
    dx: Math.round(((x - d.x) * 65535) / sx),
    dy: Math.round(((y - d.y) * 65535) / sy),
  };
}

/** @returns whether a button name is one we synthesise. */
function isKnownButton(name) {
  return Object.hasOwn(BUTTONS, name);
}

/**
 * Move the cursor to an absolute physical-pixel position.
 * @param x - physical x.
 * @param y - physical y.
 */
function moveCursor(x, y, { absolute = true } = {}) {
  const api = win32();
  if (!absolute) {
    // SetCursorPos is simpler and, being DPI-aware in this process, uses the
    // same physical space. Used for teleporting before a drag.
    if (!api.SetCursorPos(Math.round(x), Math.round(y))) {
      throw new Error(`SetCursorPos(${x}, ${y}) failed`);
    }
    return;
  }
  const { dx, dy } = toAbsolute(x, y);
  const sent = api.send([
    {
      type: 0,
      u: {
        mi: {
          dx,
          dy,
          mouseData: 0,
          dwFlags: MOUSEEVENTF.MOVE | MOUSEEVENTF.ABSOLUTE | MOUSEEVENTF.VIRTUALDESK,
          time: 0,
          dwExtraInfo: 0,
        },
      },
    },
  ]);
  if (sent !== 1) throw new Error('SendInput(MOVE) was blocked by the OS');
}

/** Mouse flag pair for a button name, or throw a useful error. */
function buttonFlags(button) {
  const spec = BUTTONS[button];
  if (!spec) {
    throw new Error(
      `unknown mouse button "${button}" —use one of ${Object.keys(BUTTONS).join(', ')}`,
    );
  }
  return spec;
}

/** @param button - left|right|middle|x1|x2 */
function mouseDown(button) {
  const api = win32();
  const spec = buttonFlags(button);
  const sent = api.send([
    {
      type: 0,
      u: { mi: { dx: 0, dy: 0, mouseData: spec.data, dwFlags: spec.down, time: 0, dwExtraInfo: 0 } },
    },
  ]);
  if (sent !== 1) throw new Error(`SendInput(${button} down) was blocked by the OS`);
}

/** @param button - left|right|middle|x1|x2 */
function mouseUp(button) {
  const api = win32();
  const spec = buttonFlags(button);
  const sent = api.send([
    {
      type: 0,
      u: { mi: { dx: 0, dy: 0, mouseData: spec.data, dwFlags: spec.up, time: 0, dwExtraInfo: 0 } },
    },
  ]);
  if (sent !== 1) throw new Error(`SendInput(${button} up) was blocked by the OS`);
}

/**
 * Scroll the wheel.
 * @param clicks - positive scrolls up/away, negative down/toward.
 * @param horizontal - when true use the horizontal wheel.
 */
function scroll(clicks, horizontal = false) {
  const api = win32();
  const whole = Math.trunc(clicks);
  if (whole === 0) return;
  const step = 120; // WHEEL_DELTA
  const records = [];
  const flags = horizontal ? MOUSEEVENTF.HWHEEL : MOUSEEVENTF.WHEEL;
  const batch = Math.max(1, Math.min(Math.abs(whole), 8));
  const sign = Math.sign(whole);
  const per = Math.trunc((Math.abs(whole) * step) / batch) || step;
  for (let i = 0; i < batch; i += 1) {
    records.push({
      type: 0,
      u: {
        mi: {
          dx: 0,
          dy: 0,
          mouseData: (sign * per) >>> 0,
          dwFlags: flags,
          time: 0,
          dwExtraInfo: 0,
        },
      },
    });
  }
  api.send(records);
}

/**
 * Resolve one key specifier to a virtual key code.
 * @param key - a name from {@link VK}, a single character, or `0x`-prefixed hex.
 * @returns the virtual key code.
 */
function resolveKey(key) {
  const raw = String(key).trim();
  if (raw.length === 0) throw new Error('empty key name');
  const lower = raw.toLowerCase();
  if (Object.hasOwn(VK, lower)) return VK[lower];
  if (/^0x[0-9a-f]+$/i.test(lower)) return Number.parseInt(lower, 16);
  if (/^vk_\d+$/i.test(lower)) return Number.parseInt(lower.slice(3), 10);
  if (raw.length === 1) {
    const code = raw.toUpperCase().charCodeAt(0);
    if (code >= 0x30 && code <= 0x5a) return code; // 0-9 and A-Z map to their ASCII VK
  }
  throw new Error(
    `unknown key "${key}" —use a named key (enter, tab, escape, left, f5, ...), a single character, or vk_<code>`,
  );
}

/** Key names that need the extended-key flag to disambiguate them. */
const EXTENDED_KEYS = new Set([
  0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x2c, 0x2d, 0x2e, 0x5b, 0x5c, 0x6f, 0x90,
]);

/**
 * Press and release one virtual key.
 * @param key - key specifier.
 */
function keyTap(key) {
  const api = win32();
  const vk = resolveKey(key);
  const extended = EXTENDED_KEYS.has(vk) ? KEYEVENTF.EXTENDEDKEY : 0;
  api.send([
    { type: 1, u: { ki: { wVk: vk, wScan: 0, dwFlags: extended, time: 0, dwExtraInfo: 0 } } },
    {
      type: 1,
      u: { ki: { wVk: vk, wScan: 0, dwFlags: extended | KEYEVENTF.KEYUP, time: 0, dwExtraInfo: 0 } },
    },
  ]);
}

/** @param key - key specifier. */
function keyDown(key) {
  const api = win32();
  const vk = resolveKey(key);
  const extended = EXTENDED_KEYS.has(vk) ? KEYEVENTF.EXTENDEDKEY : 0;
  api.send([
    { type: 1, u: { ki: { wVk: vk, wScan: 0, dwFlags: extended, time: 0, dwExtraInfo: 0 } } },
  ]);
}

/** @param key - key specifier. */
function keyUp(key) {
  const api = win32();
  const vk = resolveKey(key);
  const extended = EXTENDED_KEYS.has(vk) ? KEYEVENTF.EXTENDEDKEY : 0;
  api.send([
    {
      type: 1,
      u: { ki: { wVk: vk, wScan: 0, dwFlags: extended | KEYEVENTF.KEYUP, time: 0, dwExtraInfo: 0 } },
    },
  ]);
}

/**
 * Type a literal string through the Unicode scan-code path. This is the only
 * reliable way to enter arbitrary text —including CJK —because it bypasses
 * the active keyboard layout entirely.
 *
 * @param text - text to type.
 */
function typeText(text) {
  const api = win32();
  const records = [];
  for (const char of text) {
    const code = char.codePointAt(0);
    if (code === 0x0a) {
      // A newline in a `text` payload means Enter.
      records.push({ type: 1, u: { ki: { wVk: VK.enter, wScan: 0, dwFlags: 0, time: 0, dwExtraInfo: 0 } } });
      records.push({
        type: 1,
        u: { ki: { wVk: VK.enter, wScan: 0, dwFlags: KEYEVENTF.KEYUP, time: 0, dwExtraInfo: 0 } },
      });
      continue;
    }
    if (code === 0x0d) continue; // a CRLF pair contributes one Enter
    for (const unit of encodeUtf16(char)) {
      records.push({
        type: 1,
        u: { ki: { wVk: 0, wScan: unit, dwFlags: KEYEVENTF.UNICODE, time: 0, dwExtraInfo: 0 } },
      });
      records.push({
        type: 1,
        u: {
          ki: {
            wVk: 0,
            wScan: unit,
            dwFlags: KEYEVENTF.UNICODE | KEYEVENTF.KEYUP,
            time: 0,
            dwExtraInfo: 0,
          },
        },
      });
    }
  }
  // SendInput caps out well below this, but chunking keeps a huge paste from
  // building an unbounded array and lets a partial failure be reported.
  const CHUNK = 256;
  for (let i = 0; i < records.length; i += CHUNK) {
    const slice = records.slice(i, i + CHUNK);
    const sent = api.send(slice);
    if (sent !== slice.length) {
      throw new Error(
        `SendInput typed ${i + sent} of ${records.length} key events —the OS rejected the rest (a higher-integrity window may hold focus)`,
      );
    }
  }
  return records.length / 2;
}

/**
 * UTF-16 code units for one character, as SendInput expects them (a
 * non-BMP character becomes a surrogate pair of KEYEVENTF_UNICODE events).
 *
 * @param char - one code point as a string.
 * @returns code units.
 */
function encodeUtf16(char) {
  const units = [];
  const code = char.codePointAt(0);
  if (code <= 0xffff) return [code];
  const offset = code - 0x10000;
  units.push(0xd800 + (offset >> 10), 0xdc00 + (offset & 0x3ff));
  return units;
}

/**
 * Parse and execute a `ctrl+shift+s`-style chord.
 *
 * @param combo - the chord string.
 * @returns the canonical description that was executed.
 */
function shortcut(combo) {
  const parts = String(combo)
    .split('+')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length === 0) throw new Error('empty shortcut');

  const modifiers = [];
  const keys = [];
  for (const part of parts) {
    const alias = MODIFIER_ALIASES[part.toLowerCase()];
    if (alias) modifiers.push(alias);
    else keys.push(part);
  }
  if (keys.length === 0) {
    throw new Error(`shortcut "${combo}" has modifiers but no key to press`);
  }

  const held = [];
  for (const mod of modifiers) {
    const vk = VK[mod];
    held.push(vk);
    keyDownVk(vk);
  }
  try {
    for (const key of keys) {
      // keyTap resolves named keys and characters through the same table.
      keyTap(key);
    }
  } finally {
    for (const vk of held.reverse()) keyUpVk(vk);
  }
  return [...modifiers, ...keys].join('+');
}

/** @param vk - virtual key code. */
function keyDownVk(vk) {
  const api = win32();
  api.send([{ type: 1, u: { ki: { wVk: vk, wScan: 0, dwFlags: 0, time: 0, dwExtraInfo: 0 } } }]);
}

/** @param vk - virtual key code. */
function keyUpVk(vk) {
  const api = win32();
  const extended = EXTENDED_KEYS.has(vk) ? KEYEVENTF.EXTENDEDKEY : 0;
  api.send([
    {
      type: 1,
      u: { ki: { wVk: vk, wScan: 0, dwFlags: extended | KEYEVENTF.KEYUP, time: 0, dwExtraInfo: 0 } },
    },
  ]);
}

// ---------------------------------------------------------------------------
// Window enumeration
// ---------------------------------------------------------------------------

/** Windows that exist but are never useful targets for a model. */
const WINDOW_CLASS_DENYLIST = new Set([
  'Shell_TrayWnd',
  'Shell_SecondaryTrayWnd',
  'Progman',
  'WorkerW',
  'Windows.UI.Core.CoreWindow',
  'ApplicationFrameWindow.Hidden',
  'MultitaskingViewFrame',
  'ForegroundStaging',
  'XamlExplorerHostIslandWindow',
]);

const GWL_EXSTYLE = -20;
const WS_EX_TOOLWINDOW = 0x00000080;
const WS_EX_NOREDIRECTIONBITMAP = 0x00200000;

/** GetAncestor flag: walk up to the top-level (root) window. */
const GA_ROOT = 2;

/** DWMWA_EXTENDED_FRAME_BOUNDS: the frame the user actually sees. */
const DWMWA_EXTENDED_FRAME_BOUNDS = 9;

/** DWMWA_CLOAKED: non-zero when DWM is hiding the window from the user. */
const DWMWA_CLOAKED = 14;

/**
 * Whether DWM reports a window as cloaked.
 *
 * A cloaked window is alive and technically visible but not shown to the user —
 * UWP apps suspended in the background, and the hidden input-method and
 * shell-experience windows that would otherwise clutter a window list with
 * several identically titled entries. `IsWindowVisible` returns true for these,
 * so only DWM can tell us.
 *
 * @param hwnd - the window handle.
 * @returns true only when DWM positively reports the window as cloaked. A
 *   failed or unsupported query counts as NOT cloaked, so a real window is
 *   never dropped just because the attribute could not be read.
 */
function isCloaked(hwnd) {
  const api = win32();
  const out = [0];
  try {
    const hr = api.DwmGetWindowAttributeU32(hwnd, DWMWA_CLOAKED, out, 4);
    if (hr < 0) return false; // Attribute unsupported here; do not over-filter.
    return out[0] !== 0;
  } catch {
    return false;
  }
}

/**
 * Whether a rectangle overlaps the virtual desktop at all.
 *
 * Filters the ghost top-level windows that occupy off-screen coordinates (for
 * example a hidden input-method surface parked at 1536x864 on a 1920x1080
 * desktop). A window the user cannot reach is not a capture target.
 *
 * @param bounds - the window rectangle in screen pixels.
 * @returns true when any part of it lies on the desktop.
 */
function isOnScreen(bounds) {
  const d = win32().desktop();
  return (
    bounds.x < d.x + d.width &&
    bounds.y < d.y + d.height &&
    bounds.x + bounds.width > d.x &&
    bounds.y + bounds.height > d.y
  );
}

/**
 * The visible rectangle of a window, preferring the DWM's reported frame.
 *
 * `GetWindowRect` includes the invisible resize border DWM reserves around a
 * window, so a capture cropped to it ends up with black margins on the right and
 * bottom (the classic "shadow border" offset). `DWMWA_EXTENDED_FRAME_BOUNDS`
 * reports the composited frame instead, which is what a user would call the
 * window. Older systems and some windows do not answer the attribute, so the
 * GetWindowRect result stays the fallback.
 *
 * @param hwnd - the window handle.
 * @param rect - the `GetWindowRect` result already read for this window.
 * @returns `{x, y, width, height}` in screen pixels.
 */
function visibleBounds(hwnd, rect) {
  const fallback = {
    x: rect.left,
    y: rect.top,
    width: rect.right - rect.left,
    height: rect.bottom - rect.top,
  };

  try {
    const api = win32();
    const out = {};
    const hr = api.DwmGetWindowAttribute(
      hwnd,
      DWMWA_EXTENDED_FRAME_BOUNDS,
      out,
      api.koffi.sizeof(api.structs.RECT),
    );
    // A negative HRESULT means DWM declined; keep the GetWindowRect answer.
    if (hr < 0) return fallback;
    const width = out.right - out.left;
    const height = out.bottom - out.top;
    // Guard against a nonsense frame (some windows report zero while hidden).
    if (width <= 0 || height <= 0) return fallback;
    return { x: out.left, y: out.top, width, height };
  } catch {
    return fallback;
  }
}

/**
 * Read every fact the filter chain needs about one top-level window.
 *
 * Kept separate from {@link listWindows} so the same facts can be reported for a
 * window that was *excluded*. An agent that can see a dialog on screen but not
 * in the list needs the reason, not a shorter list — that is the difference
 * between "there is no such window" and "I dropped it, here is why".
 *
 * @param hwnd - the window handle.
 * @returns a window record, or null when the handle cannot be read at all.
 */
function describeWindow(hwnd) {
  const api = win32();
  try {
    const visible = Boolean(api.IsWindowVisible(hwnd));
    const cloaked = isCloaked(hwnd);
    const exStyle = Number(api.GetWindowLongPtrW(hwnd, GWL_EXSTYLE));
    const length = api.GetWindowTextLengthW(hwnd);
    const buffer = Buffer.alloc((Math.max(length, 0) + 1) * 2);
    const written = api.GetWindowTextW(hwnd, buffer, Math.max(length, 0) + 1);
    const title = buffer.toString('utf16le', 0, written * 2);

    const rect = {};
    const hasRect = Boolean(api.GetWindowRect(hwnd, rect));
    const minimized = Boolean(api.IsIconic(hwnd));
    const bounds = hasRect ? visibleBounds(hwnd, rect) : { x: 0, y: 0, width: 0, height: 0 };

    const pidRef = [0];
    api.GetWindowThreadProcessId(hwnd, pidRef);

    return {
      handle: Number(api.koffi.address(hwnd)),
      title,
      minimized,
      visible,
      cloaked,
      toolWindow: (exStyle & WS_EX_TOOLWINDOW) !== 0,
      // True for GPU-composited surfaces without a redirection bitmap; a
      // PrintWindow against these may yield a blank image.
      noRedirection: (exStyle & WS_EX_NOREDIRECTIONBITMAP) !== 0,
      bounds,
      hasRect,
      onScreen: isOnScreen(bounds),
      pid: pidRef[0],
    };
  } catch {
    // A window can vanish mid-enumeration; skipping it is correct.
    return null;
  }
}

/**
 * Why a record is not offered as an interactive window, or null to keep it.
 *
 * @param record - a {@link describeWindow} result.
 * @param options - the same options {@link listWindows} accepts.
 * @returns a human-readable reason, or null when the window passes every rule.
 */
function exclusionReason(record, options = {}) {
  const {
    includeMinimized = true,
    titlesOnly = true,
    includeCloaked = false,
    includeOffscreen = false,
  } = options;

  if (!record.visible) return 'not visible (WS_VISIBLE is off)';
  if (!includeCloaked && record.cloaked) return 'cloaked by DWM (alive but hidden from the user)';
  if (titlesOnly && record.toolWindow) return 'tool window (WS_EX_TOOLWINDOW)';
  if (titlesOnly && record.title.trim().length === 0) return 'empty title';
  if (!record.hasRect) return 'GetWindowRect failed';
  if (record.bounds.width <= 0 || record.bounds.height <= 0) {
    return `zero area (${record.bounds.width}x${record.bounds.height})`;
  }
  if (record.minimized && !includeMinimized) return 'minimised';
  if (!includeOffscreen && !record.minimized && !record.onScreen) return 'entirely offscreen';
  return null;
}

/**
 * Enumerate top-level windows that a user could plausibly interact with.
 *
 * @param options - filtering options.
 * @returns window records in z-order as reported by EnumWindows.
 */
function listWindows(options = {}) {
  return inspectWindows(options).windows;
}

/**
 * Enumerate top-level windows, keeping the rejected ones alongside their reason.
 *
 * @param options - filtering options.
 * @returns `{windows, filtered}`, where each filtered entry carries `reason`.
 */
function inspectWindows(options = {}) {
  const api = win32();
  const windows = [];
  const filtered = [];

  api.EnumWindows((hwnd) => {
    const record = describeWindow(hwnd);
    if (!record) return true;
    const reason = exclusionReason(record, options);
    if (reason) filtered.push({ ...record, reason });
    else windows.push(record);
    return true;
  }, 0);

  return { windows, filtered };
}

/** Find the best window record matching a caller-supplied selector. */
function findWindow(selector) {
  const windows = listWindows({ includeMinimized: true });
  const wanted = String(selector).trim();

  // An explicit numeric handle always wins.
  if (/^\d+$/.test(wanted)) {
    const handle = Number(wanted);
    return windows.find((w) => w.handle === handle) ?? null;
  }

  const needle = wanted.toLowerCase();
  const exact = windows.find((w) => w.title.toLowerCase() === needle);
  if (exact) return exact;
  const partial = windows.filter((w) => w.title.toLowerCase().includes(needle));
  if (partial.length === 0) return null;
  // Prefer the largest match: a dialog often shares a prefix with its parent.
  partial.sort((a, b) => b.bounds.width * b.bounds.height - a.bounds.width * a.bounds.height);
  return partial[0];
}

/** $1 @returns the foreground window record, or null. */
function foregroundWindow() {
  const api = win32();
  const hwnd = api.GetForegroundWindow();
  if (!hwnd) return null;
  const address = Number(api.koffi.address(hwnd));
  return listWindows({ includeMinimized: true }).find((w) => w.handle === address) ?? null;
}

/**
 * Bring a window to the foreground, un-minimising it first.
 *
 * @param handle - native window handle.
 * @returns whether the window ended up foreground.
 */
function focusWindow(handle) {
  const api = win32();
  const hwnd = api.koffi.as(handle, 'void*');
  if (!api.IsWindow(hwnd)) throw new Error(`window handle ${handle} is no longer valid`);
  if (api.IsIconic(hwnd)) api.ShowWindow(hwnd, 9); // SW_RESTORE
  const ok = api.SetForegroundWindow(hwnd);
  return { ok: Boolean(ok), foreground: Number(api.koffi.address(api.GetForegroundWindow())) };
}

/**
 * The top-level window under a screen point, or null over bare desktop.
 *
 * `WindowFromPoint` answers with the deepest *child* at that pixel; activation
 * and z-order belong to the root window, so the ancestor is what gets returned.
 *
 * @param x - screen x in physical pixels.
 * @param y - screen y in physical pixels.
 * @returns a window record, or null when nothing readable is under the point.
 */
function windowFromPoint(x, y) {
  const api = win32();
  const child = api.WindowFromPoint({ x: Math.round(x), y: Math.round(y) });
  if (!child) return null;
  const root = api.GetAncestor(child, GA_ROOT) ?? child;
  return describeWindow(root);
}

/**
 * Make a window foreground, so a following click is delivered rather than eaten.
 *
 * Windows consumes the first click on an inactive window to activate it, which
 * makes a single click look like it "did nothing". Raising the window first
 * removes the problem at its source instead of asking the model to click twice.
 *
 * `SetForegroundWindow` is refused when the caller does not own the foreground
 * window (the anti-focus-stealing rule). Attaching to the foreground thread's
 * input queue lifts that restriction for the duration of the call; that is the
 * documented workaround, and it is why two attempts are made.
 *
 * IMPORTANT: this only *requests* the change. The shell applies it
 * asynchronously, so `GetForegroundWindow` read immediately afterwards may
 * still report the old window — or 0 — even though the raise succeeded. Callers
 * must poll ({@link foregroundHandle}) before concluding anything; that is why
 * no `ok` field is returned here. Treating the immediate read as the answer is
 * exactly how a "focus failed" false negative is born.
 *
 * @param handle - native window handle.
 * @returns `{requested, previous, foreground}` — the API's answer, the window
 *   that was in front, and an immediate (unverified) read of the foreground.
 */
function activateWindow(handle) {
  const api = win32();
  const hwnd = api.koffi.as(handle, 'void*');
  if (!api.IsWindow(hwnd)) throw new Error(`window handle ${handle} is no longer valid`);

  // A window handle *is* its address, so the caller's number is already the
  // answer. Asking koffi to convert it back (`address(as(handle))`) fails: the
  // value produced by `as()` is a typed pointer, which `address()` rejects.
  const address = Number(handle);
  const previous = foregroundHandle();

  if (api.IsIconic(hwnd)) api.ShowWindow(hwnd, 9); // SW_RESTORE
  api.BringWindowToTop(hwnd);

  let requested = Boolean(api.SetForegroundWindow(hwnd));
  let foreground = foregroundHandle();

  if (foreground !== address) {
    try {
      const current = api.GetCurrentThreadId();
      const owner = api.GetWindowThreadProcessId(api.GetForegroundWindow(), [0]);
      if (owner && current !== owner && api.AttachThreadInput(current, owner, true)) {
        try {
          requested = Boolean(api.SetForegroundWindow(hwnd)) || requested;
          foreground = foregroundHandle();
        } finally {
          api.AttachThreadInput(current, owner, false);
        }
      }
    } catch {
      // Best effort only: the caller verifies by polling.
    }
  }

  return { requested, previous, foreground, alreadyForeground: previous === address };
}

/**
 * The foreground window's handle as a plain number, or 0 when there is none.
 *
 * @returns the handle, safe to compare against a window record's `handle`.
 */
function foregroundHandle() {
  const api = win32();
  const hwnd = api.GetForegroundWindow();
  if (!hwnd) return 0;
  return Number(api.koffi.address(hwnd));
}

module.exports = {
  VK,
  win32,
  probeWin32,
  isKnownButton,
  moveCursor,
  mouseDown,
  mouseUp,
  scroll,
  resolveKey,
  keyTap,
  keyDown,
  keyUp,
  typeText,
  shortcut,
  listWindows,
  inspectWindows,
  findWindow,
  windowFromPoint,
  foregroundWindow,
  foregroundHandle,
  focusWindow,
  activateWindow,
  visibleBounds,
};

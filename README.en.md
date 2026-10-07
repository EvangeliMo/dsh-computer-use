# dsh-computer-use-mode

[中文](README.md) | English

A fifth agent preset for **DeepSeek Harness** — *电脑操作模式* (computer-use mode). It keeps everything the standard mode can do and adds **screen capture** and **mouse/keyboard control**, for operating software that exposes no agent-facing integration and for reading information that exists only on screen.

Windows only. Screen capture goes through GDI, and everything else is Win32.

## Quick start

Requires the DeepSeek Harness desktop app.

**From the Harness plugin dialog (recommended).** Open the plugin page, click “Add plugin”, and enter either the package name:

```
dsh-computer-use-mode
```

or the repository URL (this route does not need npm):

```
https://github.com/EvangeliMo/dsh-computer-use-mode
```

**From a clone:**

```powershell
git clone https://github.com/EvangeliMo/dsh-computer-use-mode.git
cd dsh-computer-use-mode
powershell.exe -NoProfile -ExecutionPolicy Bypass -File install.ps1
```

The script locates your profile automatically — preferring `desktop`, and refusing to guess (with a clear error) when none is present. Run it with `-WhatIf` first to see what it would change without writing anything.

Then **restart Harness** and pick 电脑操作模式 when starting a new task.

**There is no `npm install` step.** The plugin declares no runtime dependencies: `koffi`, `fflate` and the `@deepseek-ai/*` packages are all resolved out of the Harness installation by `lib/loader.cjs`, which derives its location from `process.resourcesPath`. That is why it works from any directory and needs no network.

## What it provides

| Tool | Purpose |
|---|---|
| `computer` | One action: `screenshot` / `screen_info` / `windows` / `focus_window` / `click` / `double_click` / `right_click` / `middle_click` / `move` / `drag` / `scroll` / `type` / `shortcut` / `key` / `cursor` / `sleep` / `waitForChange` / `waitUntilStable` |
| `computer_batch` | A sequence of actions in one call, each with an optional `sleep` — for mechanical runs like click → type → Enter |

`waitForChange` and `waitUntilStable` sample the screen until it settles, so a caller does not have to guess a delay and re-capture to find out whether it was long enough.

Plus one system-prompt section, registered in the `TOOL_COMPUTER_USE` slot the harness reserves (order 3000), covering the workflow and the safety rules.

## Design notes worth knowing before changing anything

**Captures are native resolution.** The model downsamples images itself, so a 1920×1080 desktop is delivered as a 1920×1080 image and the agent decides what to look at. A full-screen capture has a coordinate ruler and numbered quadrant markers painted onto it, which is how a position gets read without arithmetic; a small `region` re-capture is how fine detail gets read.

**Coordinate space needs no conversion.** Measured in the live plugin host: thread DPI awareness is per-monitor and `SM_CXSCREEN` equals the physical panel size, so capture, `GetSystemMetrics`, `GetCursorPos` and `SetCursorPos` share one physical-pixel space. Do not add DPI scaling.

**The plugin must be CommonJS.** `koffi` ships inside the installation's `app.asar`, and only a CommonJS `require` goes through Electron's asar-aware resolver — an ESM import of a bare specifier fails with `ERR_MODULE_NOT_FOUND` even though `require` succeeds. Bundling copies of those packages is not an option either: a second `cordis` instance would break service identity.

**Image references must be plain enumerable JSON inside the declared output schema.** The tool registry JSON-snapshots and deep-freezes a value *before* calling `output.render`, so anything smuggled out-of-band — a `Symbol` property, a `WeakMap` keyed by the returned object — is gone by the time `render` runs. The failure mode is nasty: the text block still arrives, so the model is told “captured a 1920×1080 image” while receiving no image at all.

**Only `output.render` reaches the model.** A declared-but-unrendered field is invisible: an early version returned a window list that the agent could not name a single entry from. Every fact meant for the model must appear in the rendered blocks.

**PNG `IDAT` must be a zlib stream.** `fflate.deflateSync` emits bare deflate, which libpng rejects, yet a raw inflater decodes it happily — a misleading combination. Use `fflate.zlibSync`.

**Window rectangles come from `DWMWA_EXTENDED_FRAME_BOUNDS`, not `GetWindowRect`.** The latter includes DWM's invisible resize border (about 9px per side), which both leaves black margins in a capture and shifts click coordinates by that offset.

**Do not also insert a top-level host-plane row for this package.** That was the original shape and it produced a red “异常” on the plugin list while the mode worked fine: the tool registry rejects a duplicate tool name in one scope, so the second load failed its fiber. The Web surface deliberately keeps the agent plane out of the host plane — `dsh-web-app` disables every `tool-*` row and lets each session's preset compose them.

## Installing from source, and rolling back

`install.ps1` backs the profile configuration up to a timestamped directory, copies the plugin into the profile as a **real directory**, and adds it to `dsh.profile.bundles`.

It never uses junctions: the app's recovery flow (“disable third-party plugins, back up profile patch, restart”) follows junctions and deletes their targets, which destroys plugin sources.

It never modifies a file inside the Harness installation, so an upgrade or reinstall cannot overwrite it.

Roll back with:

```powershell
Copy-Item '<backup-dir>\*' "$env:USERPROFILE\.dsh\profiles\desktop" -Force
Remove-Item "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-computer-use-mode" -Recurse -Force
```

## Tests

Run them under the host runtime so module resolution matches production:

```powershell
$dsh = "<install>\DeepSeek Harness.exe"
$env:ELECTRON_RUN_AS_NODE = "1"
& $dsh scripts\test-native.cjs       # 20 checks: FFI, GDI capture, PNG
& $dsh scripts\test-plugin.cjs       # 39 checks: registration, actions, batches
& $dsh scripts\verify-deployed.cjs   # deployed copy vs source, byte for byte
```

`test-native.cjs` moves the mouse but never clicks and never types, so it is safe to run on a live desktop. Captures land in `test-output/` and can be inspected with `read_image`.

## Known limitations

- **UAC and the secure desktop cannot be captured**, and input cannot be injected into an elevated window (UIPI).
- **A GUI process started from a foreground command is torn down when the command returns.** Use a background job for an app that must outlive the call.
- **GPU-composited windows may capture blank.** They are flagged `gpu-composited` in the window list; capture the screen region instead.
- **Input injection is refused from a restricted-token process.** Diagnosing capture from a sandboxed shell reports `SetCursorPos` failing while the real host works fine — do not mistake that for a product defect.

## License

MIT

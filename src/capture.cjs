/**
 * dsh-computer-use —GDI screen capture.
 *
 * Captures through a screen DC with `BitBlt`, then `GetDIBits` into a 32-bit
 * top-down DIB. A screen DC does not accept `SelectObject` on a bitmap the way
 * a memory DC does, so the copy always lands in an intermediate compatible DC.
 *
 * DIB rows come back BGRA; every caller in this package wants RGBA.
 */

const win32Module = require('./win32.cjs');
const { win32 } = win32Module;

// Raster op: copy source to destination.
const SRCCOPY = 0x00cc0020;
// StretchBlt mode: colour-on-colour, the only one that preserves text quality.
const HALFTONE = 4;
// PrintWindow flag that asks the app to render DWM-composited content.
const PW_RENDERFULLCONTENT = 0x00000002;
// DIB_RGB_COLORS
const DIB_RGB_COLORS = 0;

const BI_RGB = 0;

/**
 * Convert a top-down BGRA DIB buffer to RGBA.
 *
 * @param bgra - raw DIB bytes.
 * @param pixelCount - number of pixels.
 * @returns RGBA bytes.
 */
function bgraToRgba(bgra, pixelCount) {
  const rgba = new Uint8ClampedArray(pixelCount * 4);
  for (let i = 0; i < pixelCount; i += 1) {
    const o = i * 4;
    rgba[o] = bgra[o + 2]; // R <- B
    rgba[o + 1] = bgra[o + 1]; // G
    rgba[o + 2] = bgra[o]; // B <- R
    // GDI leaves alpha at 0 for screen content; the image is opaque either way.
    rgba[o + 3] = 255;
  }
  return rgba;
}

/**
 * Copy a rectangle out of a source DC through a memory DC.
 *
 * @param srcDc - source device context.
 * @param x - source left.
 * @param y - source top.
 * @param width - source width.
 * @param height - source height.
 * @param options - `scaleX`/`scaleY` below 1 request a StretchBlt resize.
 * @returns RGBA pixels.
 */
function blitFromDc(srcDc, x, y, width, height, { scaleX = 1, scaleY = 1 } = {}) {
  const api = win32();

  const dstWidth = Math.max(1, Math.round(width * scaleX));
  const dstHeight = Math.max(1, Math.round(height * scaleY));

  const memDc = api.CreateCompatibleDC(srcDc);
  if (!memDc) throw new Error('CreateCompatibleDC failed');
  let bitmap = null;

  try {
    bitmap = api.CreateCompatibleBitmap(srcDc, dstWidth, dstHeight);
    if (!bitmap) throw new Error(`CreateCompatibleBitmap(${dstWidth}x${dstHeight}) failed`);
    const previous = api.SelectObject(memDc, bitmap);

    let copied;
    if (dstWidth === width && dstHeight === height) {
      copied = api.BitBlt(memDc, 0, 0, dstWidth, dstHeight, srcDc, x, y, SRCCOPY);
    } else {
      api.SetStretchBltMode(memDc, HALFTONE);
      copied = api.StretchBlt(
        memDc,
        0,
        0,
        dstWidth,
        dstHeight,
        srcDc,
        x,
        y,
        width,
        height,
        SRCCOPY,
      );
    }
    if (!copied) throw new Error('BitBlt/StretchBlt failed to copy the screen');

    const info = {
      biSize: 40,
      biWidth: dstWidth,
      // A negative height asks for a top-down DIB, matching image row order.
      biHeight: -dstHeight,
      biPlanes: 1,
      biBitCount: 32,
      biCompression: BI_RGB,
      biSizeImage: dstWidth * dstHeight * 4,
      biXPelsPerMeter: 0,
      biYPelsPerMeter: 0,
      biClrUsed: 0,
      biClrImportant: 0,
      bmiColors: 0,
    };

    const stride = dstWidth * 4;
    const bits = Buffer.alloc(stride * dstHeight);
    const scanned = api.GetDIBits(memDc, bitmap, 0, dstHeight, bits, info, DIB_RGB_COLORS);
    if (scanned === 0) throw new Error('GetDIBits returned no scanlines');

    api.SelectObject(memDc, previous);
    return bgraToRgba(bits, dstWidth * dstHeight);
  } finally {
    if (bitmap) api.DeleteObject(bitmap);
    api.DeleteDC(memDc);
  }
}

/**
 * Capture a rectangle of the desktop, in physical pixels.
 *
 * @param region - `{x, y, width, height}`; defaults to the whole virtual desktop.
 * @param options - optional `scaleX`/`scaleY` for a capture-time resize.
 * @returns `{width, height, pixels, region}`.
 */
function captureRegion(region, options = {}) {
  const api = win32();
  const area = region ?? api.desktop();
  if (area.width <= 0 || area.height <= 0) {
    throw new Error(`capture region has no area (${area.width}x${area.height})`);
  }

  const screenDc = api.CreateDCW('DISPLAY', null, null, null);
  if (!screenDc) throw new Error('CreateDCW("DISPLAY") failed —no interactive desktop?');

  try {
    const dstWidth = Math.max(1, Math.round(area.width * (options.scaleX ?? 1)));
    const dstHeight = Math.max(1, Math.round(area.height * (options.scaleY ?? 1)));
    const pixels = blitFromDc(screenDc, area.x, area.y, area.width, area.height, options);
    return { width: dstWidth, height: dstHeight, pixels, region: area };
  } finally {
    api.DeleteDC(screenDc);
  }
}

/**
 * Capture one window's client pixels.
 *
 * `PrintWindow` is tried first because it captures a window that is partially
 * occluded or offscreen; when an app does not answer it (common for GPU-composited
 * surfaces and some Electron/Chromium windows) we fall back to copying the screen
 * region the window occupies, which is what the user actually sees anyway.
 *
 * The captured rectangle is the DWM extended frame, matching what `windows`
 * reports. `GetWindowRect` includes an invisible resize border (about 8px per
 * side), so cropping to it left black margins along the right and bottom edges.
 *
 * @param handle - native window handle.
 * @param options - optional `scaleX`/`scaleY`, plus `forceScreen` to skip PrintWindow.
 * @returns `{width, height, pixels, region, method, windowBounds}`.
 */
function captureWindow(handle, options = {}) {
  const api = win32();
  const hwnd = api.koffi.as(handle, 'void*');
  if (!api.IsWindow(hwnd)) throw new Error(`window handle ${handle} is no longer valid`);

  const rect = {};
  if (!api.GetWindowRect(hwnd, rect)) throw new Error('GetWindowRect failed on that window');
  const bounds = win32Module.visibleBounds(hwnd, rect);
  if (bounds.width <= 0 || bounds.height <= 0) {
    throw new Error(
      `window has no visible area (${bounds.width}x${bounds.height}); it may be minimised - restore it first`,
    );
  }

  const dstWidth = Math.max(1, Math.round(bounds.width * (options.scaleX ?? 1)));
  const dstHeight = Math.max(1, Math.round(bounds.height * (options.scaleY ?? 1)));

  if (!options.forceScreen) {
    const windowDc = api.GetWindowDC(hwnd);
    if (windowDc) {
      try {
        const memDc = api.CreateCompatibleDC(windowDc);
        if (memDc) {
          let bitmap = null;
          try {
            bitmap = api.CreateCompatibleBitmap(windowDc, bounds.width, bounds.height);
            if (bitmap) {
              const previous = api.SelectObject(memDc, bitmap);
              const printed = api.PrintWindow(hwnd, memDc, PW_RENDERFULLCONTENT);
              if (printed) {
                const info = {
                  biSize: 40,
                  biWidth: bounds.width,
                  biHeight: -bounds.height,
                  biPlanes: 1,
                  biBitCount: 32,
                  biCompression: BI_RGB,
                  biSizeImage: bounds.width * bounds.height * 4,
                  biXPelsPerMeter: 0,
                  biYPelsPerMeter: 0,
                  biClrUsed: 0,
                  biClrImportant: 0,
                  bmiColors: 0,
                };
                const bits = Buffer.alloc(bounds.width * bounds.height * 4);
                const scanned = api.GetDIBits(
                  memDc,
                  bitmap,
                  0,
                  bounds.height,
                  bits,
                  info,
                  DIB_RGB_COLORS,
                );
                api.SelectObject(memDc, previous);
                if (scanned !== 0) {
                  let pixels = bgraToRgba(bits, bounds.width * bounds.height);
                  if (dstWidth !== bounds.width || dstHeight !== bounds.height) {
                    pixels = resize(pixels, bounds.width, bounds.height, dstWidth, dstHeight);
                  }
                  return {
                    width: dstWidth,
                    height: dstHeight,
                    pixels,
                    region: bounds,
                    method: 'printwindow',
                    windowBounds: bounds,
                  };
                }
              } else {
                api.SelectObject(memDc, previous);
              }
            }
          } finally {
            if (bitmap) api.DeleteObject(bitmap);
            api.DeleteDC(memDc);
          }
        }
      } finally {
        api.ReleaseDC(hwnd, windowDc);
      }
    }
  }

  const screenDc = api.CreateDCW('DISPLAY', null, null, null);
  if (!screenDc) throw new Error('CreateDCW("DISPLAY") failed');
  try {
    const pixels = blitFromDc(screenDc, bounds.x, bounds.y, bounds.width, bounds.height, options);
    return {
      width: dstWidth,
      height: dstHeight,
      pixels,
      region: bounds,
      method: 'screen',
      windowBounds: bounds,
    };
  } finally {
    api.DeleteDC(screenDc);
  }
}

/**
 * A small integer-ratio resize used only on the PrintWindow path, where the
 * capture and the requested scale do not coincide.
 *
 * @param src - source RGBA.
 * @param srcWidth - source width.
 * @param srcHeight - source height.
 * @param dstWidth - target width.
 * @param dstHeight - target height.
 * @returns resized RGBA.
 */
function resize(src, srcWidth, srcHeight, dstWidth, dstHeight) {
  const out = new Uint8ClampedArray(dstWidth * dstHeight * 4);
  const xRatio = srcWidth / dstWidth;
  const yRatio = srcHeight / dstHeight;
  for (let dy = 0; dy < dstHeight; dy += 1) {
    const sy = Math.min(srcHeight - 1, Math.floor((dy + 0.5) * yRatio));
    for (let dx = 0; dx < dstWidth; dx += 1) {
      const sx = Math.min(srcWidth - 1, Math.floor((dx + 0.5) * xRatio));
      const so = (sy * srcWidth + sx) * 4;
      const dofs = (dy * dstWidth + dx) * 4;
      out[dofs] = src[so];
      out[dofs + 1] = src[so + 1];
      out[dofs + 2] = src[so + 2];
      out[dofs + 3] = src[so + 3];
    }
  }
  return out;
}

module.exports = { captureRegion, captureWindow };

/**
 * dsh-computer-use-mode — minimal PNG writer.
 *
 * Deliberately dependency-free apart from `fflate` (already a top-level
 * dependency of the DSH installation) so screenshot capture cannot break when
 * the Harness is upgraded. `sharp` also ships with DSH and produces smaller
 * files, but depending on a native image stack for a core path buys nothing a
 * few hundred lines of PNG container code cannot do.
 *
 * All buffers are RGBA, 8 bits per channel, non-interlaced — the only shape
 * `read_image` and the attachment normaliser accept (16-bit PNGs are rejected).
 */

'use strict';

const { requireFromInstall } = require('../lib/loader.cjs');
// `zlibSync`, not `deflateSync`: a PNG IDAT payload is a *zlib* stream (2-byte
// header + deflate + Adler-32). `deflateSync` emits bare deflate, which libpng
// rejects with "vipspng: libpng read error" even though the bytes inflate
// cleanly with a raw inflater — verified by A/B against a zlib-wrapped stream.
const { zlibSync } = requireFromInstall('fflate', 'PNG compression');

const PNG_SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * PNG chunk CRC-32 (IEEE 802.3, reflected, init/final 0xFFFFFFFF).
 *
 * Implemented here rather than imported: `fflate`'s public entry points do not
 * export a `crc32`, and a small table-driven CRC is not worth adding a
 * dependency to the capture path.
 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/**
 * @param bytes - chunk type followed by payload.
 * @returns the CRC-32 value.
 */
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** @param type - 4 ASCII bytes. @param data - chunk payload. @returns a PNG chunk. */
function chunk(type, data) {
  const length = data.length;
  const out = new Uint8Array(12 + length);
  const view = new DataView(out.buffer);
  view.setUint32(0, length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  // The CRC covers the type and the payload, never the length.
  view.setUint32(8 + length, crc32(out.subarray(4, 8 + length)) >>> 0);
  return out;
}

/**
 * Encode an RGBA buffer as a PNG.
 *
 * @param width - pixel width.
 * @param height - pixel height.
 * @param rgba - `width * height * 4` bytes.
 * @param options - `level` 0-9 controls deflate effort.
 * @returns PNG bytes.
 */
function encodePng(width, height, rgba, { level = 6 } = {}) {
  if (width <= 0 || height <= 0) throw new Error(`encodePng: bad size ${width}x${height}`);
  const expected = width * height * 4;
  if (rgba.length !== expected) {
    throw new Error(`encodePng: expected ${expected} bytes for ${width}x${height}, got ${rgba.length}`);
  }

  // Filter type 0 (None) per scanline. Screenshots are usually flat enough that
  // a smarter filter is not worth the CPU here; up-scaling the deflate level is
  // cheaper than running five candidate filters.
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }

  const signature = PNG_SIGNATURE;
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width);
  ihdrView.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: truecolour with alpha
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  const idat = zlibSync(raw, { level });
  const chunks = [
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', new Uint8Array(0)),
  ];

  let total = 0;
  for (const part of chunks) total += part.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of chunks) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * The model reads a downscaled thumbnail far more reliably when coordinates are
 * painted onto it. A labelled ruler writes the *screen* coordinate of each grid
 * line directly into the image, which removes the mental arithmetic that makes
 * low-resolution vision models mis-click.
 *
 * @param width - thumbnail width.
 * @param height - thumbnail height.
 * @param rgba - thumbnail pixels (mutated in place).
 * @param mapping - how a thumbnail pixel maps back to screen pixels.
 * @param options - grid spacing and label cadence, in screen pixels.
 */
function drawRulers(width, height, rgba, mapping, options = {}) {
  const step = Math.max(20, options.step ?? 200);
  const labelEvery = Math.max(1, options.labelEvery ?? 2);
  const mutable = rgba instanceof Uint8ClampedArray ? rgba : new Uint8ClampedArray(rgba.buffer.slice(0));

  const spanX = mapping.originX + width / mapping.scaleX;
  const spanY = mapping.originY + height / mapping.scaleY;

  const columns = [];
  let index = 0;
  for (let screenX = Math.ceil(mapping.originX / step) * step; screenX <= spanX; screenX += step) {
    const x = Math.round((screenX - mapping.originX) * mapping.scaleX);
    if (x >= 0 && x < width) {
      const major = index % labelEvery === 0;
      paintColumn(mutable, width, height, x, major ? 0x78 : 0x38);
      if (major) columns.push({ x: x + 3, text: String(screenX) });
    }
    index += 1;
  }

  const rows = [];
  index = 0;
  for (let screenY = Math.ceil(mapping.originY / step) * step; screenY <= spanY; screenY += step) {
    const y = Math.round((screenY - mapping.originY) * mapping.scaleY);
    if (y >= 0 && y < height) {
      const major = index % labelEvery === 0;
      paintRow(mutable, width, height, y, major ? 0x78 : 0x38);
      if (major) rows.push({ y: y + 3, text: String(screenY) });
    }
    index += 1;
  }

  // X labels ride the top edge; Y labels ride the left edge. Their plates would
  // otherwise cover each other in the corner, so nudge the first few apart.
  for (let i = 0; i < columns.length; i += 1) {
    labelAt(mutable, width, height, columns[i].x, 2, columns[i].text);
  }
  let y = 2;
  for (let i = 0; i < rows.length; i += 1) {
    const placed = Math.max(rows[i].y, y);
    if (placed + GLYPH_H * GLYPH_SCALE > height) break;
    labelAt(mutable, width, height, 2, placed, rows[i].text);
    y = placed + GLYPH_H * GLYPH_SCALE + 2;
  }

  // Origin corner marker.
  for (let i = 0; i < 7; i += 1) paintColumn(mutable, width, height, i, 0xd0);
  return mutable;
}

/** Blend a cyan-ish grid line down a whole column. */
function paintColumn(rgba, width, height, x, alpha) {
  if (x < 0 || x >= width) return;
  for (let y = 0; y < height; y += 1) blend(rgba, (y * width + x) * 4, 0x35, 0xd0, 0xff, alpha);
}

/** Blend a grid line across a whole row. */
function paintRow(rgba, width, height, y, alpha) {
  if (y < 0 || y >= height) return;
  const base = y * width * 4;
  for (let x = 0; x < width; x += 1) blend(rgba, base + x * 4, 0x35, 0xd0, 0xff, alpha);
}

/** Alpha-blend one pixel toward a colour. */
function blend(rgba, offset, r, g, b, alpha) {
  const a = alpha / 255;
  const inv = 1 - a;
  rgba[offset] = rgba[offset] * inv + r * a;
  rgba[offset + 1] = rgba[offset + 1] * inv + g * a;
  rgba[offset + 2] = rgba[offset + 2] * inv + b * a;
}

/**
 * Box-filter downscale. Averaging is essential: nearest-neighbour sampling makes
 * thin UI text shimmer into noise, which is exactly the detail a low-resolution
 * vision model already struggles with.
 *
 * @param src - source RGBA pixels.
 * @param srcWidth - source width.
 * @param srcHeight - source height.
 * @param dstWidth - target width.
 * @param dstHeight - target height.
 * @returns downscaled RGBA pixels.
 */
function downscale(src, srcWidth, srcHeight, dstWidth, dstHeight) {
  const out = new Uint8ClampedArray(dstWidth * dstHeight * 4);
  const xRatio = srcWidth / dstWidth;
  const yRatio = srcHeight / dstHeight;

  for (let dy = 0; dy < dstHeight; dy += 1) {
    const y0 = Math.floor(dy * yRatio);
    const y1 = Math.min(srcHeight, Math.max(y0 + 1, Math.floor((dy + 1) * yRatio)));
    for (let dx = 0; dx < dstWidth; dx += 1) {
      const x0 = Math.floor(dx * xRatio);
      const x1 = Math.min(srcWidth, Math.max(x0 + 1, Math.floor((dx + 1) * xRatio)));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let y = y0; y < y1; y += 1) {
        let offset = (y * srcWidth + x0) * 4;
        for (let x = x0; x < x1; x += 1) {
          r += src[offset];
          g += src[offset + 1];
          b += src[offset + 2];
          a += src[offset + 3];
          n += 1;
          offset += 4;
        }
      }
      const o = (dy * dstWidth + dx) * 4;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
      out[o + 3] = a / n;
    }
  }
  return out;
}

/** A 5x7 bitmap font for digits, minus and dot —enough for coordinate rulers. */
const GLYPHS = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};

const GLYPH_W = 5;
const GLYPH_H = 7;
const GLYPH_SCALE = 2; // 10x14 px labels stay legible after downscaling

/**
 * Draw a short numeric string on a dark backing plate so it stays readable over
 * arbitrary screenshot content.
 *
 * @param rgba - canvas pixels.
 * @param width - canvas width.
 * @param height - canvas height.
 * @param x - left edge.
 * @param y - top edge.
 * @param text - digits, minus and dot only.
 */
function labelAt(rgba, width, height, x, y, text) {
  const w = text.length * (GLYPH_W + 1) * GLYPH_SCALE;
  const h = GLYPH_H * GLYPH_SCALE;
  const plateX = Math.max(0, Math.min(width - w - 2, Math.round(x)));
  const plateY = Math.max(0, Math.min(height - h - 2, Math.round(y)));
  if (plateX + w + 2 > width || plateY + h + 2 > height) return;

  for (let py = -1; py <= h; py += 1) {
    for (let px = -1; px <= w; px += 1) {
      const tx = plateX + px;
      const ty = plateY + py;
      if (tx < 0 || ty < 0 || tx >= width || ty >= height) continue;
      blend(rgba, (ty * width + tx) * 4, 0x00, 0x00, 0x00, 0xb8);
    }
  }

  let cursor = plateX + GLYPH_SCALE;
  for (const char of text) {
    const glyph = GLYPHS[char] ?? GLYPHS[' '];
    for (let gy = 0; gy < GLYPH_H; gy += 1) {
      for (let gx = 0; gx < GLYPH_W; gx += 1) {
        if (glyph[gy][gx] !== '1') continue;
        for (let sy = 0; sy < GLYPH_SCALE; sy += 1) {
          for (let sx = 0; sx < GLYPH_SCALE; sx += 1) {
            const px = cursor + gx * GLYPH_SCALE + sx;
            const py = plateY + gy * GLYPH_SCALE + sy;
            if (px < 0 || py < 0 || px >= width || py >= height) continue;
            const o = (py * width + px) * 4;
            rgba[o] = 0x5f;
            rgba[o + 1] = 0xff;
            rgba[o + 2] = 0xff;
            rgba[o + 3] = 255;
          }
        }
      }
    }
    cursor += (GLYPH_W + 1) * GLYPH_SCALE;
  }
}

/** Label width in pixels for a string of the given length. */
function labelWidth(text) {
  return text.length * (GLYPH_W + 1) * GLYPH_SCALE;
}

/**
 * Draw a numbered quadrant guide. Corner markers give the model an unambiguous
 * anchor to name in its own reasoning, which measurably reduces coordinate drift
 * on low-resolution image inputs: "the Save button is in quadrant 2, about a
 * third of the way across" survives downscaling better than a raw pixel guess.
 *
 * Mutates and returns the pixel buffer, so it composes with `drawRulers` and
 * `encodePng`. The caller words the quadrant legend, since only it knows the
 * region being captured.
 *
 * @param width - thumbnail width.
 * @param height - thumbnail height.
 * @param rgba - thumbnail pixels (mutated in place).
 * @returns the same pixel buffer.
 */
function drawQuadrants(width, height, rgba) {
  const mutable = rgba instanceof Uint8ClampedArray ? rgba : new Uint8ClampedArray(rgba.buffer.slice(0));
  const midX = Math.floor(width / 2);
  const midY = Math.floor(height / 2);
  for (let y = 0; y < height; y += 1) {
    if (y % 8 >= 4) blend(mutable, (y * width + midX) * 4, 0xff, 0xa5, 0x00, 0xa0);
  }
  for (let x = 0; x < width; x += 1) {
    if (x % 8 >= 4) blend(mutable, (midY * width + x) * 4, 0xff, 0xa5, 0x00, 0xa0);
  }
  // One marker per quadrant, placed in that quadrant's outer corner.
  markAt(mutable, width, height, 6, 6, '1');
  markAt(mutable, width, height, Math.max(midX + 6, width - 26), 6, '2');
  markAt(mutable, width, height, 6, Math.max(midY + 6, height - 22), '3');
  markAt(
    mutable,
    width,
    height,
    Math.max(midX + 6, width - 26),
    Math.max(midY + 6, height - 22),
    '4',
  );
  return mutable;
}

/**
 * The human-readable legend for {@link drawQuadrants}, in screen coordinates.
 *
 * @param region - the captured region.
 * @returns one line per quadrant.
 */
function quadrantLegend(region) {
  const midX = region.x + Math.floor(region.width / 2);
  const midY = region.y + Math.floor(region.height / 2);
  return [
    `1 = top-left     x ${region.x}-${midX}, y ${region.y}-${midY}`,
    `2 = top-right    x ${midX}-${region.x + region.width}, y ${region.y}-${midY}`,
    `3 = bottom-left  x ${region.x}-${midX}, y ${midY}-${region.y + region.height}`,
    `4 = bottom-right x ${midX}-${region.x + region.width}, y ${midY}-${region.y + region.height}`,
  ];
}

/**
 * Draw one quadrant digit at an explicit thumbnail position, clipped safely.
 *
 * @param rgba - thumbnail pixels.
 * @param width - canvas width.
 * @param height - canvas height.
 * @param x - left edge.
 * @param y - top edge.
 * @param char - a single glyph.
 */
function markAt(rgba, width, height, x, y, char) {
  const glyph = GLYPHS[char];
  if (!glyph) return;
  const scale = 3;
  const w = GLYPH_W * scale;
  const h = GLYPH_H * scale;
  for (let py = -2; py < h + 2; py += 1) {
    for (let px = -2; px < w + 2; px += 1) {
      const tx = x + px;
      const ty = y + py;
      if (tx < 0 || ty < 0 || tx >= width || ty >= height) continue;
      blend(rgba, (ty * width + tx) * 4, 0x00, 0x00, 0x00, 0xc0);
    }
  }
  for (let gy = 0; gy < GLYPH_H; gy += 1) {
    for (let gx = 0; gx < GLYPH_W; gx += 1) {
      if (glyph[gy][gx] !== '1') continue;
      for (let sy = 0; sy < scale; sy += 1) {
        for (let sx = 0; sx < scale; sx += 1) {
          const tx = x + gx * scale + sx;
          const ty = y + gy * scale + sy;
          if (tx < 0 || ty < 0 || tx >= width || ty >= height) continue;
          const o = (ty * width + tx) * 4;
          rgba[o] = 0xff;
          rgba[o + 1] = 0xc0;
          rgba[o + 2] = 0x40;
          rgba[o + 3] = 255;
        }
      }
    }
  }
}

module.exports = { encodePng, drawRulers, drawQuadrants, quadrantLegend, downscale, labelWidth };

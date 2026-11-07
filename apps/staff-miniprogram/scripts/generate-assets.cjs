"use strict";
/**
 * 生成小程序的品牌与 Tab 图标资源（纯 Node，不依赖图像库）：
 *   - src/assets/logo.png        品牌横版 Logo（来自根目录 assets，裁边后缩放到 480px 宽）
 *   - src/assets/logo-mark.png   品牌圆环符号 128px（头像占位、空态）
 *   - src/assets/tab/*.png       4 个 Tab × 2 态，81×81，线性图标由 SDF 光栅化生成
 *
 * 用法：node scripts/generate-assets.cjs
 * 产物已入库；只有品牌资源或图标形状变化时才需要重新运行。
 */
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const root = path.resolve(__dirname, "..");
const repo = path.resolve(root, "..", "..");
const assets = path.join(root, "src", "assets");
fs.mkdirSync(path.join(assets, "tab"), { recursive: true });

/* ---------------- PNG 编解码（RGBA8） ---------------- */
const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}
function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}
function decodePng(file) {
  const buffer = fs.readFileSync(file);
  let offset = 8;
  let width = 0, height = 0, colorType = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[12] !== 0) throw new Error(`${file}: 只支持 8 位非隔行 PNG`);
      colorType = data[9];
    } else if (type === "IDAT") idat.push(data);
    offset += 12 + length;
  }
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : 1;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const out = Buffer.alloc(width * height * 4);
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i += 1) {
      const a = i >= bpp ? line[i - bpp] : 0;
      const b = previous[i];
      const c = i >= bpp ? previous[i - bpp] : 0;
      let value = line[i];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += Math.floor((a + b) / 2);
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[i] = value & 255;
    }
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 4;
      if (bpp === 4) { out[o] = line[x * 4]; out[o + 1] = line[x * 4 + 1]; out[o + 2] = line[x * 4 + 2]; out[o + 3] = line[x * 4 + 3]; }
      else if (bpp === 3) { out[o] = line[x * 3]; out[o + 1] = line[x * 3 + 1]; out[o + 2] = line[x * 3 + 2]; out[o + 3] = 255; }
      else if (bpp === 2) { out[o] = out[o + 1] = out[o + 2] = line[x * 2]; out[o + 3] = line[x * 2 + 1]; }
      else { out[o] = out[o + 1] = out[o + 2] = line[x]; out[o + 3] = 255; }
    }
    previous = line;
  }
  return { width, height, data: out };
}

/** 裁掉透明边并按面积平均缩放（预乘 alpha，避免透明边缘发黑）。 */
/** 整幅按比例缩放到目标宽度（不裁剪，用于不透明背景等需保留满幅的图）。 */
function scaleImage(image, targetWidth) {
  const scale = targetWidth / image.width;
  const outW = targetWidth, outH = Math.max(1, Math.round(image.height * scale));
  const out = Buffer.alloc(outW * outH * 4);
  for (let oy = 0; oy < outH; oy += 1) for (let ox = 0; ox < outW; ox += 1) {
    const sx0 = ox / scale, sx1 = (ox + 1) / scale, sy0 = oy / scale, sy1 = (oy + 1) / scale;
    let r = 0, g = 0, b = 0, a = 0, n = 0;
    for (let sy = Math.floor(sy0); sy < Math.ceil(sy1); sy += 1) for (let sx = Math.floor(sx0); sx < Math.ceil(sx1); sx += 1) {
      if (sx < 0 || sy < 0 || sx >= image.width || sy >= image.height) { n += 1; continue; }
      const i = (sy * image.width + sx) * 4;
      const alpha = image.data[i + 3] / 255;
      r += image.data[i] * alpha; g += image.data[i + 1] * alpha; b += image.data[i + 2] * alpha; a += alpha; n += 1;
    }
    const o = (oy * outW + ox) * 4;
    if (a > 0) { out[o] = Math.round(r / a); out[o + 1] = Math.round(g / a); out[o + 2] = Math.round(b / a); out[o + 3] = Math.round((a / n) * 255); }
  }
  return { width: outW, height: outH, data: out };
}

function cropAndScale(image, targetWidth, padding = 0) {
  let minX = image.width, minY = image.height, maxX = -1, maxY = -1;
  for (let y = 0; y < image.height; y += 1) for (let x = 0; x < image.width; x += 1) {
    if (image.data[(y * image.width + x) * 4 + 3] > 8) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  const cropW = maxX - minX + 1, cropH = maxY - minY + 1;
  const scale = (targetWidth - padding * 2) / cropW;
  const outW = targetWidth, outH = Math.round(cropH * scale) + padding * 2;
  const out = Buffer.alloc(outW * outH * 4);
  for (let oy = 0; oy < outH; oy += 1) for (let ox = 0; ox < outW; ox += 1) {
    const sx0 = minX + (ox - padding) / scale, sx1 = minX + (ox + 1 - padding) / scale;
    const sy0 = minY + (oy - padding) / scale, sy1 = minY + (oy + 1 - padding) / scale;
    let r = 0, g = 0, b = 0, a = 0, n = 0;
    for (let sy = Math.floor(sy0); sy < Math.ceil(sy1); sy += 1) for (let sx = Math.floor(sx0); sx < Math.ceil(sx1); sx += 1) {
      if (sx < 0 || sy < 0 || sx >= image.width || sy >= image.height) { n += 1; continue; }
      const i = (sy * image.width + sx) * 4;
      const alpha = image.data[i + 3] / 255;
      r += image.data[i] * alpha; g += image.data[i + 1] * alpha; b += image.data[i + 2] * alpha; a += alpha; n += 1;
    }
    const o = (oy * outW + ox) * 4;
    if (a > 0) { out[o] = Math.round(r / a); out[o + 1] = Math.round(g / a); out[o + 2] = Math.round(b / a); out[o + 3] = Math.round((a / n) * 255); }
  }
  return { width: outW, height: outH, data: out };
}

/* ---------------- 竖版锁定图合成（启动页） ---------------- */
function trimBBox(image) {
  let minX = image.width, minY = image.height, maxX = -1, maxY = -1;
  for (let y = 0; y < image.height; y += 1) for (let x = 0; x < image.width; x += 1) {
    if (image.data[(y * image.width + x) * 4 + 3] > 8) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  return { minX, minY, maxX, maxY };
}
function subImage(image, minX, minY, maxX, maxY) {
  const w = maxX - minX + 1, h = maxY - minY + 1;
  const data = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y += 1) image.data.copy(data, y * w * 4, ((minY + y) * image.width + minX) * 4, ((minY + y) * image.width + minX + w) * 4);
  return { width: w, height: h, data };
}
/** 横版“主标识+标语”里，圆环符号在最左；切掉左侧符号块，只保留右侧“Rental OS + 标语”字标块。 */
function wordmarkBlock(image) {
  const bb = trimBBox(image);
  const inked = (x) => { for (let y = bb.minY; y <= bb.maxY; y += 1) if (image.data[(y * image.width + x) * 4 + 3] > 8) return true; return false; };
  let x = bb.minX;
  while (x <= bb.maxX && inked(x)) x += 1;        // 跳过最左符号块
  while (x <= bb.maxX && !inked(x)) x += 1;        // 跳过符号与字标之间的空隙
  const textStart = Math.min(x, bb.maxX);
  return subImage(image, textStart, bb.minY, bb.maxX, bb.maxY);
}
/** 竖直堆叠若干已缩放子图（顶对齐居中），透明底，返回合成图。 */
function stackVertical(parts, gap) {
  const width = Math.max(...parts.map((p) => p.width));
  const height = parts.reduce((sum, p) => sum + p.height, 0) + gap * (parts.length - 1);
  const out = Buffer.alloc(width * height * 4);
  let oy = 0;
  for (const part of parts) {
    const ox = Math.round((width - part.width) / 2);
    for (let y = 0; y < part.height; y += 1) part.data.copy(out, ((oy + y) * width + ox) * 4, y * part.width * 4, (y + 1) * part.width * 4);
    oy += part.height + gap;
  }
  return { width, height, data: out };
}

/* ---------------- SDF 线性图标 ---------------- */
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const sdRoundRect = (px, py, cx, cy, hw, hh, r) => {
  const dx = Math.abs(px - cx) - hw + r, dy = Math.abs(py - cy) - hh + r;
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - r;
};
const sdCircle = (px, py, cx, cy, r) => Math.hypot(px - cx, py - cy) - r;
const sdSegment = (px, py, ax, ay, bx, by) => {
  const abx = bx - ax, aby = by - ay, apx = px - ax, apy = py - ay;
  const t = clamp((apx * abx + apy * aby) / (abx * abx + aby * aby || 1), 0, 1);
  return Math.hypot(apx - abx * t, apy - aby * t);
};
const sdArc = (px, py, cx, cy, r, fromDeg, toDeg) => {
  // 圆弧：角度落在区间内取到圆周的距离，否则取到端点的距离。
  let angle = (Math.atan2(py - cy, px - cx) * 180) / Math.PI;
  if (angle < 0) angle += 360;
  const inside = fromDeg <= toDeg ? angle >= fromDeg && angle <= toDeg : angle >= fromDeg || angle <= toDeg;
  if (inside) return Math.abs(Math.hypot(px - cx, py - cy) - r);
  const p1 = [cx + r * Math.cos((fromDeg * Math.PI) / 180), cy + r * Math.sin((fromDeg * Math.PI) / 180)];
  const p2 = [cx + r * Math.cos((toDeg * Math.PI) / 180), cy + r * Math.sin((toDeg * Math.PI) / 180)];
  return Math.min(Math.hypot(px - p1[0], py - p1[1]), Math.hypot(px - p2[0], py - p2[1]));
};
/** 每个图标在 24×24 坐标系内描述，stroke 为线宽；primitive: ["rr",cx,cy,w,h,r] | ["c",cx,cy,r] | ["l",x1,y1,x2,y2] | ["arc",cx,cy,r,from,to] | ["dot",cx,cy,r] */
const ICONS = {
  home: [["l", 4, 11, 12, 4.5], ["l", 12, 4.5, 20, 11], ["l", 6, 10, 6, 19.5], ["l", 18, 10, 18, 19.5], ["l", 6, 19.5, 18, 19.5], ["rr", 12, 16.5, 4, 6, 1]],
  orders: [["rr", 12, 12, 13, 17, 2], ["l", 8.5, 9, 15.5, 9], ["l", 8.5, 12.5, 15.5, 12.5], ["l", 8.5, 16, 12.5, 16]],
  scan: [["l", 4, 8, 4, 5.5], ["l", 4, 5.5, 6.5, 5.5], ["l", 17.5, 5.5, 20, 5.5], ["l", 20, 5.5, 20, 8], ["l", 20, 16, 20, 18.5], ["l", 20, 18.5, 17.5, 18.5], ["l", 6.5, 18.5, 4, 18.5], ["l", 4, 18.5, 4, 16], ["l", 5, 12, 19, 12]],
  me: [["c", 12, 8.5, 4], ["arc", 12, 22, 8, 210, 330]]
};
function rasterIcon(name, color, size = 81, stroke = 1.7) {
  const primitives = ICONS[name];
  const out = Buffer.alloc(size * size * 4);
  const ss = 4;
  const scale = size / 24;
  const [r, g, b] = [parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16)];
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    let coverage = 0;
    for (let sy = 0; sy < ss; sy += 1) for (let sx = 0; sx < ss; sx += 1) {
      const px = (x + (sx + 0.5) / ss) / scale, py = (y + (sy + 0.5) / ss) / scale;
      let d = Infinity;
      for (const p of primitives) {
        let v;
        if (p[0] === "rr") v = Math.abs(sdRoundRect(px, py, p[1], p[2], p[3] / 2, p[4] / 2, p[5]));
        else if (p[0] === "c") v = Math.abs(sdCircle(px, py, p[1], p[2], p[3]));
        else if (p[0] === "l") v = sdSegment(px, py, p[1], p[2], p[3], p[4]);
        else if (p[0] === "arc") v = sdArc(px, py, p[1], p[2], p[3], p[4], p[5]);
        else v = sdCircle(px, py, p[1], p[2], p[3]) + stroke / 2;
        d = Math.min(d, v);
      }
      if (d <= stroke / 2) coverage += 1;
    }
    const alpha = Math.round((coverage / (ss * ss)) * 255);
    const o = (y * size + x) * 4;
    out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = alpha;
  }
  return { width: size, height: size, data: out };
}


/* ---------------- 生成：员工端只生成 4 个 Tab 图标 ---------------- */
const INACTIVE = "#8A94A6", ACTIVE = "#1677FF";
fs.mkdirSync(path.join(assets, "tab"), { recursive: true });
for (const name of Object.keys(ICONS)) {
  const off = rasterIcon(name, INACTIVE);
  const on = rasterIcon(name, ACTIVE, 81, 2);
  fs.writeFileSync(path.join(assets, "tab", name + ".png"), encodePng(off.width, off.height, off.data));
  fs.writeFileSync(path.join(assets, "tab", name + "-active.png"), encodePng(on.width, on.height, on.data));
}
process.stdout.write(`assets: tab icons ${Object.keys(ICONS).length}x2
`);

// Generator for the "IUF" CRT-amber app-icon mark (PWA installability slice 1).
// No external deps (sharp isn't installed in this repo) — hand-rolled minimal
// PNG/ICO encoders, zlib is Node built-in. The pixel grid built here is the
// single source of truth for both the checked-in SVGs and PNG rasters, so
// they stay visually identical.
//
// Usage: node apps/web/scripts/generate-pwa-icons.mjs apps/web
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

// ---- palette (from apps/web/app/globals.css :root tokens) ----
const BG = [0x08, 0x0b, 0x10]; // --night
const FG = [0xe2, 0xb8, 0x5c]; // --gold-bright

// ---- 5x7 dot-matrix font, just I / U / F ----
const FONT = {
  I: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "#####"],
  U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  F: ["#####", "#....", "#####", "#....", "#....", "#....", "#...."],
};

function buildTextGrid(word) {
  const letters = word.split("").map((ch) => FONT[ch]);
  const rows = 7;
  const width = letters.length * 5 + (letters.length - 1) * 1;
  const grid = Array.from({ length: rows }, () => new Array(width).fill(false));
  letters.forEach((glyph, li) => {
    const xOff = li * 6;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < 5; c++) {
        if (glyph[r][c] === "#") grid[r][xOff + c] = true;
      }
    }
  });
  return { grid, width, height: rows };
}

// Compose the full icon grid: text centered on a square canvas, plus
// optional HUD corner-bracket ticks (skipped for maskable — safe-zone risk).
function buildIconGrid({ canvasSize, corners }) {
  const { grid: text, width: tw, height: th } = buildTextGrid("IUF");
  const canvas = Array.from({ length: canvasSize }, () => new Array(canvasSize).fill(false));
  const offX = Math.round((canvasSize - tw) / 2);
  const offY = Math.round((canvasSize - th) / 2);
  for (let r = 0; r < th; r++) {
    for (let c = 0; c < tw; c++) {
      if (text[r][c]) canvas[offY + r][offX + c] = true;
    }
  }
  if (corners) {
    const len = Math.max(2, Math.round(canvasSize * 0.09));
    const inset = Math.max(1, Math.round(canvasSize * 0.06));
    const marks = [
      [inset, inset, "h"], [inset, inset, "v"],
      [inset, canvasSize - 1 - inset, "h"], [inset, canvasSize - 1 - inset, "v"],
      [canvasSize - 1 - inset, inset, "h"], [canvasSize - 1 - inset, inset, "v"],
      [canvasSize - 1 - inset, canvasSize - 1 - inset, "h"], [canvasSize - 1 - inset, canvasSize - 1 - inset, "v"],
    ];
    for (const [r0, c0, dir] of marks) {
      for (let i = 0; i < len; i++) {
        const rSign = r0 < canvasSize / 2 ? 1 : -1;
        const cSign = c0 < canvasSize / 2 ? 1 : -1;
        if (dir === "h") canvas[r0][c0 + i * cSign] = true;
        else canvas[r0 + i * rSign][c0] = true;
      }
    }
  }
  return canvas;
}

// Nearest-neighbor upscale a boolean grid to an RGBA raster of size px*px.
function rasterize(grid, px) {
  const n = grid.length;
  const raster = new Uint8Array(px * px * 4);
  for (let y = 0; y < px; y++) {
    const gy = Math.min(n - 1, Math.floor((y / px) * n));
    for (let x = 0; x < px; x++) {
      const gx = Math.min(n - 1, Math.floor((x / px) * n));
      const on = grid[gy][gx];
      const [r, g, b] = on ? FG : BG;
      const i = (y * px + x) * 4;
      raster[i] = r; raster[i + 1] = g; raster[i + 2] = b; raster[i + 3] = 255;
    }
  }
  return raster;
}

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })());
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(raster, px) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(px, 0);
  ihdrData.writeUInt32BE(px, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // color type RGBA
  ihdrData[10] = 0; ihdrData[11] = 0; ihdrData[12] = 0;
  const ihdr = chunk("IHDR", ihdrData);

  const stride = px * 4;
  const raw = Buffer.alloc((stride + 1) * px);
  for (let y = 0; y < px; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    raster.subarray(y * stride, y * stride + stride).forEach((v, i) => {
      raw[y * (stride + 1) + 1 + i] = v;
    });
  }
  const idat = chunk("IDAT", deflateSync(raw));
  const iend = chunk("IEND", Buffer.alloc(0));
  return Buffer.concat([sig, ihdr, idat, iend]);
}

function encodeIco(pngBuf, px) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry[0] = px >= 256 ? 0 : px;
  entry[1] = px >= 256 ? 0 : px;
  entry[2] = 0; entry[3] = 0;
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(pngBuf.length, 8);
  entry.writeUInt32LE(22, 12); // offset: 6 header + 16 entry
  return Buffer.concat([header, entry, pngBuf]);
}

function writeOut(path, buf) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buf);
  console.log("wrote", path, buf.length, "bytes");
}

function gridToSvg(grid, bgHex, fgHex) {
  const n = grid.length;
  const rects = [];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (grid[y][x]) rects.push(`<rect x="${x}" y="${y}" width="1" height="1"/>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}">
  <rect x="0" y="0" width="${n}" height="${n}" fill="${bgHex}"/>
  <g fill="${fgHex}">${rects.join("")}</g>
</svg>
`;
}

const ROOT = process.argv[2];
if (!ROOT) throw new Error("usage: node gen-icons.mjs <apps/web dir>");

// Standard (any-purpose) icons: base 25x25 grid + HUD corner ticks
const anyGrid = buildIconGrid({ canvasSize: 25, corners: true });
// Maskable icon: bigger padded canvas (safe-zone friendly), no corner ticks
const maskGrid = buildIconGrid({ canvasSize: 41, corners: false });

for (const px of [192, 512]) {
  writeOut(`${ROOT}/public/icons/icon-${px}.png`, encodePng(rasterize(anyGrid, px), px));
}
writeOut(`${ROOT}/public/icons/icon-maskable-512.png`, encodePng(rasterize(maskGrid, 512), 512));

const bgHex = "#080b10";
const fgHex = "#e2b85c";
writeOut(`${ROOT}/public/icons/iuf-mark.svg`, Buffer.from(gridToSvg(anyGrid, bgHex, fgHex), "utf8"));
writeOut(`${ROOT}/public/icons/iuf-mark-maskable.svg`, Buffer.from(gridToSvg(maskGrid, bgHex, fgHex), "utf8"));

// apple-icon.png / icon.png / favicon.ico via Next.js file-convention paths (app/)
writeOut(`${ROOT}/app/apple-icon.png`, encodePng(rasterize(anyGrid, 180), 180));
writeOut(`${ROOT}/app/icon.png`, encodePng(rasterize(anyGrid, 32), 32));

const favPng = encodePng(rasterize(anyGrid, 32), 32);
writeOut(`${ROOT}/app/favicon.ico`, encodeIco(favPng, 32));

console.log("done");

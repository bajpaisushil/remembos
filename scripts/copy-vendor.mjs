// Copies browser assets that must be served as static files into public/vendor/.
// Runs automatically before dev/build (see package.json). public/vendor/ is git-ignored.
//
// - pdf.worker.min.mjs: pdf.js parsing worker
// - pdfjs/{cmaps,standard_fonts,wasm,iccs}: decoder, font and colour-profile files pdf.js fetches only when
//   a PDF needs them (CJK text, non-embedded fonts, JBIG2/JPEG 2000 scans). Self-hosting them keeps PDF
//   reading working without any third-party CDN.
import { copyFileSync, cpSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public", "vendor");
mkdirSync(out, { recursive: true });

const files = [["node_modules/pdfjs-dist/build/pdf.worker.min.mjs", "pdf.worker.min.mjs"]];
const dirs = [
  ["node_modules/pdfjs-dist/cmaps", "pdfjs/cmaps"],
  ["node_modules/pdfjs-dist/standard_fonts", "pdfjs/standard_fonts"],
  ["node_modules/pdfjs-dist/wasm", "pdfjs/wasm"],
  ["node_modules/pdfjs-dist/iccs", "pdfjs/iccs"],
];

let missing = 0;
for (const [from, to] of files) {
  const src = join(root, from);
  if (!existsSync(src)) {
    console.warn(`[copy-vendor] missing ${from} — run npm install`);
    missing++;
    continue;
  }
  copyFileSync(src, join(out, to));
}
for (const [from, to] of dirs) {
  const src = join(root, from);
  if (!existsSync(src)) {
    console.warn(`[copy-vendor] missing ${from} — run npm install`);
    missing++;
    continue;
  }
  const dest = join(out, to);
  rmSync(dest, { recursive: true, force: true });
  cpSync(src, dest, { recursive: true });
}
console.log(missing ? `[copy-vendor] done with ${missing} missing` : "[copy-vendor] done");

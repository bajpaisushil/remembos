// After `next build`: list every static app file in out/ for the service worker to precache, and stamp a
// build version into out/sw.js so each deploy installs a fresh offline copy (and cleans up the old one).
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const out = fileURLToPath(new URL("../out/", import.meta.url));
const files = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (!name.endsWith(".map")) files.push(relative(out, p).split(sep).join("/"));
  }
}
walk(join(out, "_next", "static"));
// The PDF reader's helper and the AI background workers are fetched on first use — precache them too.
for (const dir of ["vendor", "workers"]) {
  try {
    walk(join(out, dir));
  } catch {
    /* folder missing — nothing to add */
  }
}
files.sort();

const hash = createHash("sha256");
for (const f of files) hash.update(f);
for (const page of ["index.html", "404.html"]) {
  try {
    hash.update(readFileSync(join(out, page)));
  } catch {
    /* page missing — still fine */
  }
}
const version = hash.digest("hex").slice(0, 12);

writeFileSync(join(out, "precache-manifest.json"), JSON.stringify({ version, files }));
const swPath = join(out, "sw.js");
const sw = readFileSync(swPath, "utf8");
const stamped = sw.replace(/const VERSION = "[^"]*";/, `const VERSION = "${version}";`);
if (stamped === sw) throw new Error("[precache] could not stamp VERSION into out/sw.js");
writeFileSync(swPath, stamped);
console.log(`[precache] ${files.length} files, version ${version}`);

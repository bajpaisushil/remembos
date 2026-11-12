// Files and text shared into the installed app from other apps (Android share sheet → Web Share Target).
//
// ── Storage format (the contract with public/sw.js — keep both sides in sync) ─────────────────────────────
// The manifest's `share_target` POSTs multipart form data to the app. The service worker answers that POST by
// storing everything shared in Cache Storage, cache "remembos-share" (STORAGE_NAMES.shareCache), and then
// redirecting to "./?shared=1". One cache entry per shared thing:
//
//   key     a GET Request for "__share/<timestamp>/<n>" resolved against the service-worker scope,
//           e.g. https://example.com/__share/1762871400000/0
//             <timestamp>  Date.now() when the share arrived (one value for everything in that share)
//             <n>          0, 1, 2… — position within that share
//   value   a Response whose body is the shared content, with headers:
//             x-shared-kind    "file" | "text"
//             x-file-name      the file's name (files only), encodeURIComponent-encoded so any name fits
//                              in a header; a raw name is accepted too
//             content-type     the file's MIME type (files), "text/plain;charset=utf-8" (text)
//             x-last-modified  optional: the file's lastModified in ms
//
//   Text (the share's title / text / url fields) is ONE "text" entry per share with the fields combined into
//   one string, one per line, empty ones left out. A JSON body {"title","text","url"} sent with
//   content-type "application/json" is accepted as well (then combined here).
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
//
// The page calls consumeSharedItems() on start (always safe — it returns 0 when nothing is waiting). It adds
// files with ingestFiles and text with ingestText(kind "text"), removes each entry once handled (so nothing
// is added twice), and returns how many memories were created.
import { toast } from "sonner";
import { STORAGE_NAMES } from "./config";
import { ingestFiles, ingestText } from "./ingest";

const KEY_RE = /__share\/(\d+)\/(\d+)\/?$/;

interface SharedEntry {
  request: Request;
  at: number;
  index: number;
}

function sortKey(request: Request): { at: number; index: number } {
  const m = KEY_RE.exec(new URL(request.url).pathname);
  return m ? { at: Number(m[1]), index: Number(m[2]) } : { at: Number.MAX_SAFE_INTEGER, index: 0 };
}

function decodeName(raw: string | null): string {
  if (!raw) return "";
  try {
    return decodeURIComponent(raw).trim();
  } catch {
    return raw.trim();
  }
}

/** Extensions for common shared types (anything else is named without one and detected by its MIME type). */
const EXT_FOR_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
  "application/pdf": "pdf",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/webm": "weba",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/x-m4v": "m4v",
  "text/plain": "txt",
  "text/markdown": "md",
  "text/csv": "csv",
  "text/html": "html",
};

/** A name for a file that arrived without one ("Shared image 2026-11-11 15.30.png"). */
function fallbackName(type: string, when: number, n: number): string {
  const d = new Date(when);
  const p = (x: number) => String(x).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}`;
  const mime = type.split(";")[0].trim().toLowerCase();
  const group = mime.split("/")[0];
  const label = group === "image" ? "image" : group === "video" ? "video" : group === "audio" ? "recording" : "file";
  const ext = EXT_FOR_TYPE[mime];
  return `Shared ${label} ${stamp}${n > 0 ? ` (${n + 1})` : ""}${ext ? `.${ext}` : ""}`;
}

/** Title / text / url as one block: one per line, without repeats (apps often put the link inside the text too). */
export function combineSharedText(parts: Array<string | null | undefined>): string {
  const out: string[] = [];
  for (const part of parts) {
    const value = (part ?? "").replace(/\r\n?/g, "\n").trim();
    if (!value) continue;
    if (out.some((existing) => existing.includes(value))) continue;
    // A later, longer field that contains an earlier one replaces it ("title" inside "text").
    for (let i = out.length - 1; i >= 0; i--) if (value.includes(out[i])) out.splice(i, 1);
    out.push(value);
  }
  return out.join("\n");
}

function sharedText(body: string, contentType: string | null): { text: string; title?: string } {
  if (/json/i.test(contentType ?? "")) {
    try {
      const data = JSON.parse(body) as { title?: unknown; text?: unknown; url?: unknown };
      const str = (v: unknown) => (typeof v === "string" ? v : "");
      const title = str(data.title).trim();
      const text = combineSharedText([title, str(data.text), str(data.url)]);
      // The page title of a shared link makes a better memory title than the link itself.
      return { text, title: title && text !== title ? title.slice(0, 120) : undefined };
    } catch {
      /* not JSON after all — treat as plain text */
    }
  }
  return { text: body.replace(/\r\n?/g, "\n").trim() };
}

let consuming: Promise<number> | null = null;

/** Ingest pending shared files/text. Returns how many memories were added. Safe to call when nothing is pending. */
export function consumeSharedItems(): Promise<number> {
  if (typeof caches === "undefined") return Promise.resolve(0);
  // One run at a time (the page may call this twice while starting up).
  if (!consuming) {
    consuming = consume().finally(() => {
      consuming = null;
    });
  }
  return consuming;
}

async function consume(): Promise<number> {
  const name = STORAGE_NAMES.shareCache;
  let cache: Cache;
  let entries: SharedEntry[];
  try {
    // caches.open would create the cache; check first so a normal start leaves nothing behind.
    if (!(await caches.has(name))) return 0;
    cache = await caches.open(name);
    entries = (await cache.keys()).map((request) => ({ request, ...sortKey(request) }));
  } catch {
    return 0;
  }
  if (!entries.length) {
    await caches.delete(name).catch(() => false);
    return 0;
  }
  entries.sort((a, b) => a.at - b.at || a.index - b.index);

  const files: File[] = [];
  const texts: { text: string; title?: string }[] = [];
  const handled: Request[] = [];
  for (const entry of entries) {
    try {
      const res = await cache.match(entry.request);
      if (!res) continue;
      const declared = res.headers.get("x-shared-kind");
      const fileName = decodeName(res.headers.get("x-file-name"));
      const kind = declared === "file" || declared === "text" ? declared : fileName ? "file" : "text";
      if (kind === "file") {
        const blob = await res.blob();
        const type = res.headers.get("content-type") || blob.type || "";
        const modified = Number(res.headers.get("x-last-modified"));
        const at = Number.isFinite(entry.at) && entry.at < Number.MAX_SAFE_INTEGER ? entry.at : Date.now();
        files.push(
          new File([blob], fileName || fallbackName(type, at, files.length), {
            type: type.split(";")[0].trim(),
            lastModified: Number.isFinite(modified) && modified > 0 ? modified : at,
          }),
        );
      } else {
        const shared = sharedText(await res.text(), res.headers.get("content-type"));
        if (shared.text) texts.push(shared);
      }
      handled.push(entry.request);
    } catch {
      // Unreadable entry: drop it so it doesn't fail again on every start.
      handled.push(entry.request);
    }
  }

  let added = 0;
  try {
    if (files.length) added += (await ingestFiles(files)).length;
    for (const shared of texts) {
      try {
        await ingestText(shared.text, { kind: "text", ...(shared.title ? { title: shared.title } : {}) });
        added++;
      } catch {
        /* ingestText already showed why (e.g. storage is full) */
      }
    }
  } finally {
    // Everything read is cleared — even files that were skipped (their toast explained why) — so a share
    // is never imported twice.
    await Promise.all(handled.map((request) => cache.delete(request).catch(() => false)));
    try {
      if (!(await cache.keys()).length) await caches.delete(name);
    } catch {
      /* best effort */
    }
  }

  if (added > 0) {
    toast.success(`Added ${added} shared ${added === 1 ? "item" : "items"}`, {
      id: "share-received",
      description: files.length ? "Reading them on this device — nothing is uploaded." : "Saved on this device and searchable now.",
    });
  }
  return added;
}

/*
 * Remembos service worker — offline app shell + share target.
 *
 * Caches only Remembos's own static files (HTML pages, JS/CSS chunks, fonts, icons) so the app
 * opens without a connection. It never stores user data (that lives in IndexedDB) and never
 * touches cross-origin requests: AI model files from CDNs are cached by their own libraries.
 *
 * Strategies (same-origin GET requests inside the registration scope only):
 *   /_next/static/*      → cache-first (content-hashed, immutable)
 *   page navigations     → network-first, falling back to the cached page, then the 404 page for
 *                          unknown paths, then the cached home page
 *   RSC payloads (.txt)  → network-first, falling back to cache
 *   everything else      → stale-while-revalidate
 *
 * Share target (installed app, Android share sheet): a POST to <scope>share-target/ is never cached
 * or sent anywhere. Its files/text are handed to the page through the Cache Storage cache
 * "remembos-share" and the page is opened at <scope>?shared=1, which remembers them and clears it.
 *
 * Works under a base path: every URL is derived from self.registration.scope.
 */

const VERSION = "v2";
const CACHE_PREFIX = "remembos-shell-";
const CACHE_NAME = CACHE_PREFIX + VERSION;
/** Must match STORAGE_NAMES.shareCache in src/lib/config.ts. */
const SHARE_CACHE = "remembos-share";

const SCOPE = new URL(self.registration.scope);
const BASE = SCOPE.pathname.endsWith("/") ? SCOPE.pathname : SCOPE.pathname + "/";
const ORIGIN = self.location.origin;
const SCOPE_URL = new URL(BASE, ORIGIN).href;

/** App routes (static export with trailing slashes), precached so every screen opens offline. */
const PAGES = ["", "search/", "library/", "item/", "graph/", "data/", "storage/", "storage/explorer/", "help/", "404.html"];
const ROUTE_PATHS = new Set(PAGES.filter((page) => page === "" || page.endsWith("/")).map((page) => BASE + page));
const EXTRA_ASSETS = [
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "icons/apple-touch-icon.png",
];

/** Upper bound for cached files (old hashed chunks from past deploys are trimmed first). */
const MAX_ENTRIES = 600;
let putsSinceTrim = 0;

// ---------------------------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------------------------

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(precache());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

/** Best effort: a failed page or asset never blocks installation. */
async function precache() {
  const cache = await caches.open(CACHE_NAME);
  const assets = new Set(EXTRA_ASSETS.map((path) => new URL(BASE + path, ORIGIN).href));

  // Every app file of this build (written by scripts/precache-manifest.mjs), so on-demand screens and
  // dialogs also work offline right after the first visit.
  try {
    const res = await fetch(new URL(BASE + "precache-manifest.json", ORIGIN).href, { cache: "no-cache" });
    if (res.ok) {
      const { files } = await res.json();
      for (const file of files) assets.add(new URL(BASE + file, ORIGIN).href);
    }
  } catch {
    /* no manifest (dev) — pages below still bring their own assets */
  }

  await Promise.all(
    PAGES.map(async (page) => {
      const url = new URL(BASE + page, ORIGIN).href;
      try {
        const res = await fetch(url, { cache: "no-cache", credentials: "same-origin" });
        if (!isCacheable(res)) return;
        const html = await res.clone().text();
        await cache.put(url, cleanResponse(res));
        for (const match of html.matchAll(/(?:src|href)="([^"]*\/_next\/static\/[^"]+)"/g)) {
          const assetUrl = new URL(match[1].replace(/&amp;/g, "&"), url);
          if (assetUrl.origin === ORIGIN) assets.add(assetUrl.href);
        }
      } catch {
        /* offline or not deployed — skip */
      }
    }),
  );

  await Promise.all(
    [...assets].map(async (url) => {
      try {
        if (await cache.match(url)) return;
        const res = await fetch(url, { credentials: "same-origin" });
        if (isCacheable(res)) await cache.put(url, cleanResponse(res));
      } catch {
        /* skip */
      }
    }),
  );
}

// ---------------------------------------------------------------------------------------------
// Fetch routing
// ---------------------------------------------------------------------------------------------

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method === "POST" && isShareTarget(url)) {
    event.respondWith(receiveShare(request));
    return;
  }
  if (request.method !== "GET") return;

  // AI helpers' public code files (versioned, immutable URLs on jsDelivr): keep a copy so OCR, meaning search
  // and transcription also start offline. Model weights are cached by the libraries themselves.
  if (url.hostname === "cdn.jsdelivr.net") {
    event.respondWith(cdnCacheFirst(request));
    return;
  }
  // Never touch other cross-origin requests or other apps on this origin.
  if (url.origin !== ORIGIN || !url.pathname.startsWith(BASE)) return;
  // Media range requests and the worker script itself go straight to the network.
  if (request.headers.has("range") || url.pathname === BASE + "sw.js") return;

  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(event));
    return;
  }
  if (url.pathname.startsWith(BASE + "_next/static/")) {
    event.respondWith(cacheFirst(event));
    return;
  }
  if (isRscRequest(request, url)) {
    event.respondWith(networkFirst(event, rscCacheKey(url)));
    return;
  }
  event.respondWith(staleWhileRevalidate(event));
});

async function handleNavigation(event) {
  const cache = await caches.open(CACHE_NAME);
  const key = pageKey(event.request.url);
  try {
    const res = await fetch(event.request);
    if (isCacheable(res)) event.waitUntil(store(cache, key, res.clone()));
    return res;
  } catch {
    const cached = (await cache.match(key)) || (await cache.match(event.request, { ignoreSearch: true }));
    if (cached) return cached;
    // A path that isn't one of the app's screens gets the friendly 404 page; a known screen the home page.
    const known = ROUTE_PATHS.has(new URL(key).pathname);
    const fallback =
      (!known && (await cache.match(new URL(BASE + "404.html", ORIGIN).href))) || (await cache.match(SCOPE_URL));
    return fallback || offlinePage();
  }
}

async function cacheFirst(event) {
  const cache = await caches.open(CACHE_NAME);
  const hit = await cache.match(event.request);
  if (hit) return hit;
  const res = await fetch(event.request);
  if (isCacheable(res)) event.waitUntil(store(cache, event.request, res.clone()));
  return res;
}

async function networkFirst(event, key) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const res = await fetch(event.request);
    if (isCacheable(res)) event.waitUntil(store(cache, key, res.clone()));
    return res;
  } catch (err) {
    const hit = await cache.match(key);
    if (hit) return hit;
    throw err;
  }
}

async function staleWhileRevalidate(event) {
  const cache = await caches.open(CACHE_NAME);
  const hit = await cache.match(event.request);
  const update = fetch(event.request).then(async (res) => {
    if (isCacheable(res)) await store(cache, event.request, res.clone());
    return res;
  });
  if (hit) {
    event.waitUntil(update.catch(() => undefined));
    return hit;
  }
  return update;
}

// ---------------------------------------------------------------------------------------------
// Share target
// ---------------------------------------------------------------------------------------------

function isShareTarget(url) {
  if (url.origin !== ORIGIN) return false;
  return url.pathname === BASE + "share-target/" || url.pathname === BASE + "share-target";
}

/**
 * Keep what was shared in the "remembos-share" cache (one entry per file, plus one for title/text/link),
 * then open the app, which remembers the entries and clears them. Always redirects, so a failure never
 * leaves the person on an error page.
 */
async function receiveShare(request) {
  try {
    const form = await request.formData();
    const cache = await caches.open(SHARE_CACHE);
    const ts = Date.now();
    let n = 0;
    const puts = [];

    for (const file of form.getAll("files")) {
      if (!file || typeof file === "string") continue;
      if (file.size === 0 && !file.name) continue;
      puts.push(
        cache.put(
          new Request(SCOPE_URL + "__share/" + ts + "/" + n++),
          new Response(file, {
            headers: {
              "content-type": file.type || "application/octet-stream",
              "x-file-name": encodeURIComponent(file.name || "Shared file"),
              "x-shared-kind": "file",
            },
          }),
        ),
      );
    }

    const text = ["title", "text", "url"]
      .map((key) => form.get(key))
      .filter((value) => typeof value === "string" && value.trim())
      .join("\n");
    if (text) {
      puts.push(
        cache.put(
          new Request(SCOPE_URL + "__share/" + ts + "/" + n++),
          new Response(text, { headers: { "content-type": "text/plain; charset=utf-8", "x-shared-kind": "text" } }),
        ),
      );
    }

    await Promise.all(puts);
  } catch {
    /* unreadable form or storage full — the app still opens; nothing is pending */
  }
  return Response.redirect(SCOPE_URL + "?shared=1", 303);
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

function isCacheable(res) {
  return Boolean(res) && res.status === 200 && res.type === "basic";
}

/** Responses that followed a redirect can't be replayed for navigations; store a clean copy. */
function cleanResponse(res) {
  if (!res.redirected) return res;
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: res.headers });
}

async function store(cache, key, res) {
  try {
    await cache.put(key, cleanResponse(res));
    putsSinceTrim += 1;
    if (putsSinceTrim >= 25) {
      putsSinceTrim = 0;
      await trim(cache);
    }
  } catch {
    /* quota exceeded or opaque body — the network response was still served */
  }
}

/** Drop the oldest non-page entries once the cache grows past MAX_ENTRIES. */
async function trim(cache) {
  const keys = await cache.keys();
  const excess = keys.length - MAX_ENTRIES;
  if (excess <= 0) return;
  const removable = keys.filter((req) => {
    const path = new URL(req.url).pathname;
    return !path.endsWith("/") && !path.endsWith(".html");
  });
  await Promise.all(removable.slice(0, excess).map((req) => cache.delete(req)));
}

/** Pages are cached by path only ("/item/?id=…" → "/item/"); "/library" → "/library/". */
function pageKey(href) {
  const url = new URL(href);
  let path = url.pathname;
  if (!path.endsWith("/") && !/\.[a-z0-9]+$/i.test(path)) path += "/";
  return new URL(path, ORIGIN).href;
}

function isRscRequest(request, url) {
  return request.headers.get("RSC") === "1" || url.searchParams.has("_rsc") || url.pathname.endsWith(".txt");
}

function rscCacheKey(url) {
  const clean = new URL(url.href);
  clean.searchParams.delete("_rsc");
  return clean.href;
}

function offlinePage() {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline · Remembos</title><style>
:root{color-scheme:light dark;--bg:#fbfbfd;--fg:#18181b;--muted:#63636e;--card:#fff;--line:rgba(228,228,231,.8)}
@media (prefers-color-scheme:dark){:root{--bg:#0a0a12;--fg:#f4f4f6;--muted:#a3a3b2;--card:rgba(255,255,255,.04);--line:rgba(255,255,255,.1)}}
*{box-sizing:border-box}body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:24px;background:var(--bg);color:var(--fg);font:16px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:420px;text-align:center;background:var(--card);border:1px solid var(--line);border-radius:24px;padding:36px 28px;box-shadow:0 18px 40px -16px rgba(20,20,43,.2)}
.mark{width:56px;height:56px;margin:0 auto 18px;border-radius:16px;background:linear-gradient(135deg,#6366f1,#8b5cf6 55%,#d946ef)}
h1{margin:0 0 8px;font-size:22px;letter-spacing:-.01em}p{margin:0 0 22px;color:var(--muted)}
button{font:inherit;font-weight:600;color:#fff;border:0;border-radius:12px;padding:10px 18px;cursor:pointer;background:linear-gradient(135deg,#6366f1,#8b5cf6 55%,#d946ef)}
</style></head><body><main><div class="mark" aria-hidden="true"></div><h1>You're offline</h1><p>This page hasn't been saved for offline use yet. Your memories are safe on this device — reconnect and try again.</p><button type="button" onclick="location.reload()">Try again</button></main></body></html>`;
  return new Response(html, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

// ---------------------------------------------------------------------------------------------
// Public CDN code for the on-device AI helpers
// ---------------------------------------------------------------------------------------------

const CDN_CACHE = "remembos-cdn";

/** Versioned jsDelivr URLs never change, so the first copy is good forever. Never caches opaque responses. */
async function cdnCacheFirst(request) {
  const cache = await caches.open(CDN_CACHE);
  const hit = await cache.match(request, { ignoreVary: true });
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok && res.type !== "opaque" && /@v?\d/.test(new URL(request.url).pathname)) {
    cache.put(request, res.clone()).catch(() => {});
  }
  return res;
}

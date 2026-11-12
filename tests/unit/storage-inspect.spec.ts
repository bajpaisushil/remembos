import { expect, test } from "@playwright/test";
import { STORAGE_NAMES } from "@/lib/config";
import {
  browsersFor,
  chromiumOriginId,
  chunkItemId,
  chunkKeyPrefix,
  clampPage,
  classifyCache,
  classifyDatabase,
  classifyOS,
  describeUsageDetails,
  describeValue,
  diskLocations,
  DISK_BROWSER_LABELS,
  EXPLORER_PAGE_SIZE,
  firefoxOriginDir,
  folderForTable,
  formatInspectionReport,
  isOwnKey,
  logicalAddress,
  numberedPiecesNote,
  OCR_DB_EXPLANATION,
  OS_CHOICES,
  pageCount,
  pageOf,
  pageSpan,
  parseCookieNames,
  parseOrigin,
  readWebStorage,
  REMEMBOS_TABLES,
  rowBelongsTo,
  safeOpenType,
  storedFileName,
  TABLE_EXPLANATIONS,
  toDiskBrowser,
  webStorageBytes,
  type DiskBrowserId,
  type OSId,
  type StorageInspection,
} from "@/lib/storage-inspect";

const PROD = "https://remembos.app";
const DEV = "http://localhost:3000";

const UA = {
  macChrome:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
  macSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
  winEdge:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0",
  winFirefox: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:145.0) Gecko/20100101 Firefox/145.0",
  linuxFirefox: "Mozilla/5.0 (X11; Linux x86_64; rv:145.0) Gecko/20100101 Firefox/145.0",
  linuxChrome: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
  android:
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36",
  iphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
  chromebook: "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
  vivaldi:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Vivaldi/7.6",
};

// ───────────────────────────── OS & browser detection ─────────────────────────────

test.describe("classifyOS", () => {
  test("reads the user agent", () => {
    const cases: [string, OSId][] = [
      [UA.macChrome, "macos"],
      [UA.macSafari, "macos"],
      [UA.winEdge, "windows"],
      [UA.winFirefox, "windows"],
      [UA.linuxFirefox, "linux"],
      [UA.linuxChrome, "linux"],
      [UA.android, "android"],
      [UA.iphone, "ios"],
      [UA.chromebook, "chromeos"],
      ["", "other"],
    ];
    for (const [userAgent, os] of cases) expect(classifyOS({ userAgent }), userAgent).toBe(os);
  });

  test("Android is not mistaken for Linux", () => {
    expect(classifyOS({ userAgent: UA.android, platform: "Linux armv8l" })).toBe("android");
  });

  test("iPadOS pretending to be a Mac is detected by touch points", () => {
    expect(classifyOS({ userAgent: UA.macSafari, platform: "MacIntel", maxTouchPoints: 5 })).toBe("ios");
    expect(classifyOS({ userAgent: UA.macSafari, platform: "MacIntel", maxTouchPoints: 0 })).toBe("macos");
  });

  test("client-hint platform wins over the user agent", () => {
    expect(classifyOS({ userAgent: UA.linuxChrome, uaPlatform: "Chrome OS" })).toBe("chromeos");
    expect(classifyOS({ userAgent: UA.macChrome, uaPlatform: "macOS" })).toBe("macos");
    expect(classifyOS({ userAgent: "", uaPlatform: "Windows" })).toBe("windows");
    expect(classifyOS({ userAgent: "", uaPlatform: "Android" })).toBe("android");
    expect(classifyOS({ userAgent: "", uaPlatform: "Linux" })).toBe("linux");
  });

  test("falls back to navigator.platform", () => {
    expect(classifyOS({ userAgent: "Something", platform: "MacIntel" })).toBe("macos");
    expect(classifyOS({ userAgent: "Something", platform: "Win32" })).toBe("windows");
    expect(classifyOS({ userAgent: "Something", platform: "Linux x86_64" })).toBe("linux");
  });
});

test.describe("toDiskBrowser", () => {
  test("keeps browsers the generic detector already knows", () => {
    for (const b of ["edge", "brave", "opera", "firefox", "samsung"] as const) {
      expect(toDiskBrowser(b, { userAgent: "" })).toBe(b);
    }
    expect(toDiskBrowser("safari", { userAgent: UA.macSafari })).toBe("safari");
    expect(toDiskBrowser("ios-safari", { userAgent: UA.iphone })).toBe("safari");
  });

  test("tells Chrome look-alikes apart", () => {
    expect(toDiskBrowser("chrome", { userAgent: UA.macChrome })).toBe("chrome");
    expect(toDiskBrowser("chrome", { userAgent: UA.macChrome, isArc: true })).toBe("arc");
    expect(toDiskBrowser("chrome", { userAgent: UA.vivaldi })).toBe("vivaldi");
    expect(toDiskBrowser("chrome", { userAgent: UA.linuxChrome, brands: ["Vivaldi", "Chromium"] })).toBe("vivaldi");
    expect(toDiskBrowser("chrome", { userAgent: "Mozilla/5.0 (X11; Linux x86_64) Chromium/120.0 Chrome/120.0 Safari/537.36" })).toBe(
      "chromium",
    );
  });

  test("unknown browsers fall back sensibly", () => {
    expect(toDiskBrowser("other", { userAgent: UA.linuxFirefox })).toBe("firefox");
    expect(toDiskBrowser("other", { userAgent: UA.macSafari })).toBe("safari");
    expect(toDiskBrowser("other", { userAgent: "" })).toBe("chrome");
  });
});

test.describe("browsersFor", () => {
  test("only offers browsers that exist for the system", () => {
    expect(browsersFor("windows")).not.toContain("safari");
    expect(browsersFor("linux")).not.toContain("safari");
    expect(browsersFor("linux")).not.toContain("arc");
    expect(browsersFor("macos")).toEqual(expect.arrayContaining(["chrome", "edge", "brave", "opera", "vivaldi", "arc", "chromium", "firefox", "safari"]));
    expect(browsersFor("android")).toContain("samsung");
    expect(browsersFor("macos")).not.toContain("samsung");
    for (const os of OS_CHOICES) expect(browsersFor(os).length, os).toBeGreaterThan(0);
  });
});

// ───────────────────────────── origins ─────────────────────────────

test.describe("origin folder names", () => {
  test("parseOrigin normalises default ports and rejects non-web origins", () => {
    expect(parseOrigin("https://remembos.app")).toEqual({ scheme: "https", host: "remembos.app", port: null, origin: "https://remembos.app" });
    expect(parseOrigin("https://remembos.app:443")?.port).toBeNull();
    expect(parseOrigin("http://localhost:3000")?.port).toBe(3000);
    expect(parseOrigin("file:///Users/me/index.html")).toBeNull();
    expect(parseOrigin("not a url")).toBeNull();
  });

  test("Chromium uses scheme_host_port with 0 for the default port", () => {
    expect(chromiumOriginId(PROD)).toBe("https_remembos.app_0");
    expect(chromiumOriginId("https://me.github.io")).toBe("https_me.github.io_0");
    expect(chromiumOriginId(DEV)).toBe("http_localhost_3000");
    expect(chromiumOriginId("http://example.com")).toBe("http_example.com_0");
    expect(chromiumOriginId("https://example.com:8443")).toBe("https_example.com_8443");
    expect(chromiumOriginId("http://[::1]:8080")).toBe("http_[__1]_8080");
  });

  test("Firefox uses scheme+++host with +port only when non-default", () => {
    expect(firefoxOriginDir(PROD)).toBe("https+++remembos.app");
    expect(firefoxOriginDir(DEV)).toBe("http+++localhost+3000");
    expect(firefoxOriginDir("https://example.com:8443")).toBe("https+++example.com+8443");
    expect(firefoxOriginDir("http://[::1]:8080")).toBe("http+++[++1]+8080");
  });

  test("unparseable origins get a readable placeholder", () => {
    expect(chromiumOriginId("")).toContain("<this-site>");
    expect(firefoxOriginDir("")).toContain("<this-site>");
  });
});

// ───────────────────────────── diskLocations ─────────────────────────────

const pathOf = (os: OSId, browser: DiskBrowserId, id: string, origin = PROD) =>
  diskLocations(os, browser, origin).locations.find((l) => l.id === id)?.path;

test.describe("diskLocations — Chromium family", () => {
  test("Chrome on macOS, Windows and Linux", () => {
    expect(pathOf("macos", "chrome", "indexeddb")).toBe(
      "~/Library/Application Support/Google/Chrome/Default/IndexedDB/https_remembos.app_0.indexeddb.leveldb",
    );
    expect(pathOf("macos", "chrome", "indexeddb-blobs")).toBe(
      "~/Library/Application Support/Google/Chrome/Default/IndexedDB/https_remembos.app_0.indexeddb.blob",
    );
    expect(pathOf("windows", "chrome", "indexeddb")).toBe(
      "%LOCALAPPDATA%\\Google\\Chrome\\User Data\\Default\\IndexedDB\\https_remembos.app_0.indexeddb.leveldb",
    );
    expect(pathOf("linux", "chrome", "indexeddb")).toBe("~/.config/google-chrome/Default/IndexedDB/https_remembos.app_0.indexeddb.leveldb");
  });

  test("shared stores and caches use the standard sub-folders", () => {
    expect(pathOf("macos", "chrome", "local-storage")).toBe("~/Library/Application Support/Google/Chrome/Default/Local Storage/leveldb");
    expect(pathOf("macos", "chrome", "session-storage")).toBe("~/Library/Application Support/Google/Chrome/Default/Session Storage");
    expect(pathOf("macos", "chrome", "cache-storage")).toBe("~/Library/Application Support/Google/Chrome/Default/Service Worker/CacheStorage");
    expect(pathOf("windows", "chrome", "local-storage")).toBe("%LOCALAPPDATA%\\Google\\Chrome\\User Data\\Default\\Local Storage\\leveldb");
    expect(pathOf("windows", "chrome", "cookies")).toBe("%LOCALAPPDATA%\\Google\\Chrome\\User Data\\Default\\Network\\Cookies");
    const g = diskLocations("macos", "chrome", PROD);
    expect(g.locations.find((l) => l.id === "local-storage")?.scope).toBe("shared");
    expect(g.locations.find((l) => l.id === "indexeddb")?.scope).toBe("remembos");
    expect(g.locations.find((l) => l.id === "cache-storage")?.hashed).toBe(true);
  });

  test("the real origin (with port) is substituted", () => {
    expect(pathOf("linux", "chromium", "indexeddb", DEV)).toBe("~/.config/chromium/Default/IndexedDB/http_localhost_3000.indexeddb.leveldb");
  });

  test("every Chromium browser has its own profile root per OS", () => {
    const roots: [OSId, DiskBrowserId, string][] = [
      ["macos", "edge", "~/Library/Application Support/Microsoft Edge/Default"],
      ["windows", "edge", "%LOCALAPPDATA%\\Microsoft\\Edge\\User Data\\Default"],
      ["linux", "edge", "~/.config/microsoft-edge/Default"],
      ["macos", "brave", "~/Library/Application Support/BraveSoftware/Brave-Browser/Default"],
      ["windows", "brave", "%LOCALAPPDATA%\\BraveSoftware\\Brave-Browser\\User Data\\Default"],
      ["linux", "brave", "~/.config/BraveSoftware/Brave-Browser/Default"],
      ["macos", "opera", "~/Library/Application Support/com.operasoftware.Opera"],
      ["windows", "opera", "%APPDATA%\\Opera Software\\Opera Stable"],
      ["linux", "opera", "~/.config/opera"],
      ["macos", "vivaldi", "~/Library/Application Support/Vivaldi/Default"],
      ["windows", "vivaldi", "%LOCALAPPDATA%\\Vivaldi\\User Data\\Default"],
      ["linux", "vivaldi", "~/.config/vivaldi/Default"],
      ["macos", "arc", "~/Library/Application Support/Arc/User Data/Default"],
      ["macos", "chromium", "~/Library/Application Support/Chromium/Default"],
      ["windows", "chromium", "%LOCALAPPDATA%\\Chromium\\User Data\\Default"],
    ];
    for (const [os, browser, root] of roots) {
      const g = diskLocations(os, browser, PROD);
      expect(g.profile?.path, `${browser} on ${os}`).toBe(root);
      expect(g.locations.length, `${browser} on ${os}`).toBeGreaterThan(0);
      for (const l of g.locations) expect(l.path.startsWith(root), `${l.id}: ${l.path}`).toBe(true);
    }
  });

  test("Windows paths only use backslashes; Unix paths only forward slashes", () => {
    for (const browser of browsersFor("windows")) {
      const g = diskLocations("windows", browser, PROD);
      expect(g.separator).toBe("\\");
      for (const l of g.locations) expect(l.path, l.path).not.toContain("/");
    }
    for (const os of ["macos", "linux"] as const) {
      for (const browser of browsersFor(os)) {
        for (const l of diskLocations(os, browser, PROD).locations) expect(l.path, l.path).not.toContain("\\");
      }
    }
  });

  test("tells people how to find the exact profile folder", () => {
    expect(diskLocations("macos", "chrome", PROD).finder).toMatchObject({ url: "chrome://version", look: "Profile Path" });
    expect(diskLocations("windows", "edge", PROD).finder?.url).toBe("edge://version");
    expect(diskLocations("linux", "brave", PROD).finder?.url).toBe("brave://version");
    expect(diskLocations("windows", "opera", PROD).finder?.url).toBe("opera://about");
    expect(diskLocations("macos", "vivaldi", PROD).finder?.url).toBe("vivaldi://about");
    expect(diskLocations("macos", "chrome", PROD).notes.join(" ")).toMatch(/Profile 1/);
  });

  test("Linux install variants are listed", () => {
    const chromium = diskLocations("linux", "chromium", PROD).profile?.variants.map((v) => v.path) ?? [];
    expect(chromium).toContain("~/snap/chromium/common/chromium/Default");
    const chrome = diskLocations("linux", "chrome", PROD).profile?.variants.map((v) => v.path) ?? [];
    expect(chrome).toContain("~/.var/app/com.google.Chrome/config/google-chrome/Default");
  });
});

test.describe("diskLocations — Firefox", () => {
  test("site folder with idb, ls and cache inside", () => {
    expect(pathOf("macos", "firefox", "site-folder")).toBe(
      "~/Library/Application Support/Firefox/Profiles/<xxxxxxxx>.default-release/storage/default/https+++remembos.app",
    );
    expect(pathOf("macos", "firefox", "indexeddb")).toMatch(/storage\/default\/https\+\+\+remembos\.app\/idb$/);
    expect(pathOf("macos", "firefox", "local-storage")).toMatch(/https\+\+\+remembos\.app\/ls$/);
    expect(pathOf("macos", "firefox", "cache-storage")).toMatch(/https\+\+\+remembos\.app\/cache$/);
    expect(pathOf("windows", "firefox", "indexeddb")).toBe(
      "%APPDATA%\\Mozilla\\Firefox\\Profiles\\<xxxxxxxx>.default-release\\storage\\default\\https+++remembos.app\\idb",
    );
    expect(pathOf("linux", "firefox", "indexeddb", DEV)).toBe(
      "~/.mozilla/firefox/<xxxxxxxx>.default-release/storage/default/http+++localhost+3000/idb",
    );
    expect(pathOf("linux", "firefox", "cookies")).toBe("~/.mozilla/firefox/<xxxxxxxx>.default-release/cookies.sqlite");
  });

  test("snap and flatpak variants plus the profile finder", () => {
    const g = diskLocations("linux", "firefox", PROD);
    const variants = g.profile?.variants.map((v) => v.path).join("\n") ?? "";
    expect(variants).toContain("~/snap/firefox/common/.mozilla/firefox/");
    expect(variants).toContain("~/.var/app/org.mozilla.firefox/.mozilla/firefox/");
    expect(g.finder?.url).toBe("about:profiles");
    expect(g.finder?.alternative).toContain("about:support");
  });
});

test.describe("diskLocations — Safari", () => {
  test("hashed WebKit folders on macOS, with the older readable location", () => {
    const g = diskLocations("macos", "safari", PROD);
    expect(g.available).toBe(true);
    expect(g.profile?.path).toBe("~/Library/Containers/com.apple.Safari/Data/Library/WebKit/WebsiteData/Default");
    const idb = g.locations.find((l) => l.id === "indexeddb");
    expect(idb?.path).toBe("~/Library/Containers/com.apple.Safari/Data/Library/WebKit/WebsiteData/Default/<hashed>/<hashed>/IndexedDB");
    expect(idb?.hashed).toBe(true);
    expect(g.locations.find((l) => l.id === "legacy-indexeddb")?.path).toBe("~/Library/Safari/Databases/___IndexedDB/https_remembos.app_0");
    expect(g.notes.join(" ")).toMatch(/hash|protect/i);
    expect(g.locations.find((l) => l.id === "site-folder")?.description).toMatch(/origin/);
  });

  test("not offered on Windows or Linux", () => {
    for (const os of ["windows", "linux"] as const) {
      const g = diskLocations(os, "safari", PROD);
      expect(g.available).toBe(false);
      expect(g.locations).toEqual([]);
      expect(g.message).toContain("Safari");
    }
    expect(diskLocations("linux", "arc", PROD).available).toBe(false);
  });
});

test.describe("diskLocations — sandboxed systems", () => {
  test("phones, tablets and Chromebooks are not browsable and point to backups", () => {
    for (const [os, browser] of [
      ["ios", "safari"],
      ["android", "chrome"],
      ["android", "samsung"],
      ["chromeos", "chrome"],
    ] as const) {
      const g = diskLocations(os, browser, PROD);
      expect(g.browsable, os).toBe(false);
      expect(g.locations, os).toEqual([]);
      expect(g.message, os).toMatch(/backup/i);
    }
  });

  test("every offered OS × browser combination yields a coherent guide", () => {
    for (const os of OS_CHOICES) {
      for (const browser of browsersFor(os)) {
        const g = diskLocations(os, browser, PROD);
        expect(g.available, `${browser} on ${os}`).toBe(true);
        if (g.browsable) {
          expect(g.profile?.path, `${browser} on ${os}`).toBeTruthy();
          expect(g.locations.some((l) => l.id === "indexeddb"), `${browser} on ${os}`).toBe(true);
          for (const l of g.locations) {
            expect(l.label.length).toBeGreaterThan(0);
            expect(l.description.length).toBeGreaterThan(0);
          }
        } else expect(g.message, `${browser} on ${os}`).toBeTruthy();
      }
    }
    expect(Object.keys(DISK_BROWSER_LABELS).length).toBe(10);
  });
});

// ───────────────────────────── parsing helpers ─────────────────────────────

test.describe("classification helpers", () => {
  test("databases and caches", () => {
    expect(classifyDatabase(STORAGE_NAMES.appDb)).toBe("app");
    expect(classifyDatabase(STORAGE_NAMES.ocrDb)).toBe("ocr");
    expect(classifyDatabase("__dbnames")).toBe("helper");
    expect(classifyDatabase("something-else")).toBe("other");
    for (const name of STORAGE_NAMES.modelCaches) expect(classifyCache(name)).toBe("models");
    expect(classifyCache(`${STORAGE_NAMES.swCachePrefix}v1`)).toBe("shell");
    expect(classifyCache(STORAGE_NAMES.shareCache)).toBe("share");
    expect(classifyCache("workbox-precache")).toBe("other");
  });

  test("own keys and byte sizes", () => {
    expect(isOwnKey(STORAGE_NAMES.settingsKey)).toBe(true);
    expect(isOwnKey("remembos:session:notice")).toBe(true);
    expect(isOwnKey("theme")).toBe(false);
    expect(webStorageBytes("ab", "cde")).toBe(10);
    expect(webStorageBytes("", "")).toBe(0);
  });
});

test.describe("readWebStorage", () => {
  function fakeStorage(data: Record<string, string>) {
    const keys = Object.keys(data);
    return {
      get length() {
        return keys.length;
      },
      key: (i: number) => keys[i] ?? null,
      getItem: (k: string) => (k in data ? data[k] : null),
    };
  }

  test("lists our keys first with sizes and totals", () => {
    const report = readWebStorage(
      fakeStorage({ zeta: "1", [STORAGE_NAMES.settingsKey]: '{"theme":"dark"}', alpha: "xyz", "remembos:session:a": "1" }),
    );
    expect(report.entries.map((e) => e.key)).toEqual(["remembos:session:a", STORAGE_NAMES.settingsKey, "alpha", "zeta"]);
    expect(report.entries[1]).toEqual({ key: STORAGE_NAMES.settingsKey, bytes: (STORAGE_NAMES.settingsKey.length + 16) * 2, ours: true });
    expect(report.entries[2]).toEqual({ key: "alpha", bytes: 16, ours: false });
    expect(report.ours.count).toBe(2);
    expect(report.totalBytes).toBe(report.entries.reduce((n, e) => n + e.bytes, 0));
    expect(report.ours.bytes).toBe(report.entries[0].bytes + report.entries[1].bytes);
  });

  test("empty storage", () => {
    expect(readWebStorage(fakeStorage({}))).toEqual({ entries: [], totalBytes: 0, ours: { count: 0, bytes: 0 } });
  });
});

test.describe("parseCookieNames", () => {
  test("names only, unique, trimmed", () => {
    expect(parseCookieNames("")).toEqual([]);
    expect(parseCookieNames("   ")).toEqual([]);
    expect(parseCookieNames("a=1; b=2;c=3")).toEqual(["a", "b", "c"]);
    expect(parseCookieNames("a=1; a=2")).toEqual(["a"]);
    expect(parseCookieNames("token=abc=def; _ga=GA1.2")).toEqual(["token", "_ga"]);
    expect(parseCookieNames("justavalue")).toEqual(["(unnamed)"]);
    expect(parseCookieNames("a=1;;  ; b=")).toEqual(["a", "b"]);
  });
});

test.describe("describeUsageDetails", () => {
  test("labels known keys, drops zeros, sorts by size", () => {
    const out = describeUsageDetails({ caches: 2_000, indexedDB: 50_000, serviceWorkerRegistrations: 0, fileSystemDirectories: 10 });
    expect(out.map((d) => d.key)).toEqual(["indexedDB", "caches", "fileSystemDirectories"]);
    expect(out[0].label).toMatch(/IndexedDB/);
    expect(out[1].label).toMatch(/Cache Storage/);
    expect(describeUsageDetails(undefined)).toEqual([]);
    expect(describeUsageDetails({ someNewThing: 5 })[0].label).toBe("Some New Thing");
  });
});

test.describe("formatInspectionReport", () => {
  const report: StorageInspection = {
    origin: PROD,
    checkedAt: Date.UTC(2026, 10, 11, 12, 0, 0),
    secureContext: true,
    estimate: { supported: true, usage: 5 * 1024 * 1024, quota: 10 * 1024 * 1024 * 1024, usageDetails: { indexedDB: 4 * 1024 * 1024 } },
    persisted: false,
    indexedDB: {
      supported: true,
      listed: true,
      databases: [
        { name: "remembos", version: 10, role: "app", exists: true, records: null },
        { name: "keyval-store", version: 1, role: "ocr", exists: true, records: 1 },
      ],
      tables: { items: 12, files: 8, thumbs: 8, chunks: 40, entities: 30, meta: 1 },
    },
    localStorage: {
      supported: true,
      entries: [{ key: STORAGE_NAMES.settingsKey, bytes: 300, ours: true }],
      totalBytes: 300,
      ours: { count: 1, bytes: 300 },
    },
    sessionStorage: { supported: true, entries: [], totalBytes: 0, ours: { count: 0, bytes: 0 } },
    cookies: { supported: true, names: [] },
    cacheStorage: { supported: true, caches: [{ name: "transformers-cache", role: "models", entries: 7 }] },
    serviceWorker: { supported: true, controlled: true, registrations: [{ scope: `${PROD}/`, state: "activated", scriptURL: `${PROD}/sw.js`, ours: true }] },
  };

  test("summarises names, counts and sizes", () => {
    const text = formatInspectionReport(report);
    expect(text).toContain(`Site: ${PROD}`);
    expect(text).toContain("2026-11-11T12:00:00.000Z");
    expect(text).toContain("Used: 5.0 MB of 10.0 GB allowed");
    expect(text).toContain("Protected from automatic clean-up: no");
    expect(text).toContain("remembos tables: items 12, files 8, thumbs 8, chunks 40, entities 30, meta 1");
    expect(text).toContain("keyval-store (ocr): present, version 1, 1 records");
    expect(text).toContain(`${STORAGE_NAMES.settingsKey}: 300 B (Remembos)`);
    expect(text).toContain("transformers-cache (models): 7 entries");
    expect(text).toMatch(/Cookies\n {2}None/);
    expect(text).toContain("activated (Remembos)");
  });

  test("handles unsupported sections", () => {
    const text = formatInspectionReport({
      ...report,
      estimate: { supported: false, usage: 0, quota: 0 },
      persisted: null,
      cookies: { supported: false, names: [] },
      cacheStorage: { supported: false, caches: [] },
      serviceWorker: { supported: false, controlled: false, registrations: [] },
      localStorage: { supported: false, entries: [], totalBytes: 0, ours: { count: 0, bytes: 0 }, error: "SecurityError" },
    });
    expect(text).toContain("Not reported by this browser");
    expect(text).toContain("Protected from automatic clean-up: unknown");
    expect(text).toContain("Not available (SecurityError)");
    expect(text).toContain("Not readable");
  });
});

// ───────────────────────────── storage explorer ─────────────────────────────

test.describe("storage explorer — copy and addresses", () => {
  test("every table has a one-line, plain-language explanation", () => {
    for (const t of REMEMBOS_TABLES) {
      expect(TABLE_EXPLANATIONS[t].title.length, t).toBeGreaterThan(0);
      expect(TABLE_EXPLANATIONS[t].explain, t).not.toMatch(/\n/);
      expect(TABLE_EXPLANATIONS[t].explain.length, t).toBeLessThan(120);
    }
    expect(TABLE_EXPLANATIONS.files.explain).toMatch(/original/i);
    expect(TABLE_EXPLANATIONS.files.explain).toMatch(/video/i);
    expect(TABLE_EXPLANATIONS.chunks.explain).toMatch(/vector/i);
    expect(TABLE_EXPLANATIONS.entities.explain).toMatch(/phone/i);
    expect(OCR_DB_EXPLANATION.explain).toMatch(/none of your memories/i);
  });

  test("logical addresses name the database, table and key", () => {
    expect(logicalAddress("files", "abc123")).toBe("IndexedDB › remembos › files › abc123");
    expect(logicalAddress("items")).toBe("IndexedDB › remembos › items");
    expect(logicalAddress("keyval", "./eng.traineddata", STORAGE_NAMES.ocrDb)).toBe("IndexedDB › keyval-store › keyval › ./eng.traineddata");
  });
});

test.describe("storage explorer — paging", () => {
  test("page counts, offsets and spans", () => {
    expect(EXPLORER_PAGE_SIZE).toBe(50);
    expect(pageCount(0)).toBe(1);
    expect(pageCount(50)).toBe(1);
    expect(pageCount(51)).toBe(2);
    expect(pageCount(230)).toBe(5);
    expect(pageOf(0)).toBe(0);
    expect(pageOf(49)).toBe(0);
    expect(pageOf(50)).toBe(1);
    expect(pageOf(-3)).toBe(0);
    expect(pageOf(Number.NaN)).toBe(0);
    expect(clampPage(9, 230)).toBe(4);
    expect(clampPage(-1, 230)).toBe(0);
    expect(clampPage(2, 0)).toBe(0);
    expect(pageSpan(1, 230)).toEqual({ first: 51, last: 100 });
    expect(pageSpan(4, 230)).toEqual({ first: 201, last: 230 });
    expect(pageSpan(0, 0)).toEqual({ first: 0, last: 0 });
    expect(pageSpan(0, 10, 4)).toEqual({ first: 1, last: 4 });
  });
});

test.describe("storage explorer — rows of one memory", () => {
  test("items, files and thumbs share the memory's id; chunks use id:index", () => {
    for (const t of ["items", "files", "thumbs"] as const) {
      expect(rowBelongsTo(t, "abc", "abc"), t).toBe(true);
      expect(rowBelongsTo(t, "abcd", "abc"), t).toBe(false);
    }
    expect(chunkKeyPrefix("abc")).toBe("abc:");
    expect(rowBelongsTo("chunks", "abc:0", "abc")).toBe(true);
    expect(rowBelongsTo("chunks", "abc:12", "abc")).toBe(true);
    expect(rowBelongsTo("chunks", "abcd:0", "abc")).toBe(false);
    expect(rowBelongsTo("chunks", "abc:x:1", "abc")).toBe(false);
    expect(chunkItemId("sample_note:3")).toBe("sample_note");
    expect(chunkItemId("nocolon")).toBeNull();
  });

  test("entities belong through their item list; meta never does", () => {
    expect(rowBelongsTo("entities", "phone:5550134", "abc", ["x", "abc"])).toBe(true);
    expect(rowBelongsTo("entities", "phone:5550134", "abc", ["x"])).toBe(false);
    expect(rowBelongsTo("entities", "phone:5550134", "abc")).toBe(false);
    expect(rowBelongsTo("meta", "abc", "abc")).toBe(false);
    expect(rowBelongsTo("items", "", "")).toBe(false);
  });
});

test.describe("storage explorer — opening stored files safely", () => {
  test("anything that could run as a page opens as plain text", () => {
    for (const t of ["text/html", "TEXT/HTML; charset=utf-8", "image/svg+xml", "application/xhtml+xml", "text/xml", "application/xml", "application/rss+xml", "text/javascript", "application/javascript", "multipart/related"]) {
      expect(safeOpenType(t), t).toBe("text/plain");
    }
  });

  test("viewable media keeps its type; unknown types download", () => {
    expect(safeOpenType("image/png")).toBe("image/png");
    expect(safeOpenType("application/pdf")).toBe("application/pdf");
    expect(safeOpenType("video/mp4")).toBe("video/mp4");
    expect(safeOpenType("audio/webm;codecs=opus")).toBe("audio/webm");
    expect(safeOpenType("text/plain")).toBe("text/plain");
    expect(safeOpenType("")).toBe("application/octet-stream");
    expect(safeOpenType(undefined)).toBe("application/octet-stream");
  });

  test("file names: stored name, then the original name, then the title", () => {
    expect(storedFileName({ type: "image/png", name: "Screenshot 1.png" }, { sourceName: "other.png", title: "T" })).toBe("Screenshot 1.png");
    expect(storedFileName({ type: "application/pdf" }, { sourceName: "Invoice.pdf", title: "Invoice" })).toBe("Invoice.pdf");
    expect(storedFileName({ type: "application/pdf" }, { title: "Northwind / invoice: May" })).toBe("Northwind invoice May.pdf");
    expect(storedFileName({ type: "" }, null)).toBe("memory.bin");
    expect(storedFileName({ type: "image/webp", name: "x.png" }, { title: "Receipt" }, "preview")).toBe("Receipt (preview).webp");
  });
});

test.describe("storage explorer — the folder that holds a table", () => {
  test("Chromium keeps files in the .blob folder and records in .leveldb", () => {
    const g = diskLocations("macos", "chrome", PROD);
    expect(folderForTable(g, "files")?.path).toMatch(/IndexedDB\/https_remembos\.app_0\.indexeddb\.blob$/);
    expect(folderForTable(g, "thumbs")?.id).toBe("indexeddb-blobs");
    expect(folderForTable(g, "items")?.path).toMatch(/IndexedDB\/https_remembos\.app_0\.indexeddb\.leveldb$/);
    expect(folderForTable(g, "ocr")?.id).toBe("indexeddb");
  });

  test("Firefox and Safari keep everything under IndexedDB", () => {
    expect(folderForTable(diskLocations("windows", "firefox", PROD), "files")?.path).toMatch(/https\+\+\+remembos\.app\\idb$/);
    expect(folderForTable(diskLocations("macos", "safari", PROD), "files")?.id).toBe("indexeddb");
  });

  test("no folder on sandboxed systems or for unavailable browsers", () => {
    expect(folderForTable(diskLocations("ios", "safari", PROD), "files")).toBeNull();
    expect(folderForTable(diskLocations("android", "chrome", PROD), "items")).toBeNull();
    expect(folderForTable(diskLocations("windows", "safari", PROD), "files")).toBeNull();
  });

  test("the numbered-pieces note is honest for every browser", () => {
    for (const b of Object.keys(DISK_BROWSER_LABELS) as DiskBrowserId[]) {
      const note = numberedPiecesNote(b, "Invoice.pdf");
      expect(note, b).toContain("“Invoice.pdf”");
      expect(note, b).toMatch(/numbered/);
      expect(note, b).toMatch(/no names/);
    }
    expect(numberedPiecesNote("chrome")).toMatch(/under its own name/);
  });
});

test.describe("storage explorer — describing values", () => {
  test("kinds, previews and sizes", () => {
    expect(describeValue(null)).toEqual({ type: "empty", preview: "—", bytes: 0 });
    expect(describeValue(["a", "b"])).toMatchObject({ type: "list of 2", preview: '["a","b"]' });
    expect(describeValue(42)).toMatchObject({ type: "number", preview: "42", bytes: 2 });
    expect(describeValue(true)).toMatchObject({ type: "yes/no", preview: "true" });
    expect(describeValue("héllo")).toMatchObject({ type: "text", preview: "héllo", bytes: 6 });
    expect(describeValue({ a: 1 })).toMatchObject({ type: "record", preview: '{"a":1}' });
    expect(describeValue(new Uint8Array(10))).toMatchObject({ type: "binary", bytes: 10 });
    const long = describeValue("x".repeat(500), 20);
    expect(long.preview.length).toBe(20);
    expect(long.preview.endsWith("…")).toBe(true);
    expect(long.bytes).toBe(500);
  });
});

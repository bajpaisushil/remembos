// Shared helpers for the end-to-end suite (runs against the static export in out/ — `npm run build` first).
import { expect, type BrowserContext, type Page } from "@playwright/test";

export const SETTINGS_KEY = "remembos:settings:v1";
/** Set REMEMBOS_E2E_NETWORK=1 to run checks that download public model files (OCR / speech). */
export const NETWORK = process.env.REMEMBOS_E2E_NETWORK === "1";

/** Console noise that is not an app error (third-party model hosts, favicon probes). */
const IGNORED = [/favicon/i, /cdn\.jsdelivr\.net/i, /huggingface\.co/i, /hf\.co\//i];

export interface Watch {
  errors: string[];
  allow404: boolean;
}

export function watch(page: Page): Watch {
  const w: Watch = { errors: [], allow404: false };
  page.on("pageerror", (err) => w.errors.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    const where = msg.location()?.url ?? "";
    if (IGNORED.some((re) => re.test(text) || re.test(where))) return;
    if (w.allow404 && /status of 404/.test(text)) return;
    w.errors.push(`console: ${text} ${where}`);
  });
  return w;
}

/** Start as a returning visitor with meaning search off (no model download) unless overridden. */
export async function presetSettings(page: Page | BrowserContext, extra: Record<string, unknown> = {}) {
  await page.addInitScript(
    ([key, preset]) => {
      try {
        if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(preset));
      } catch {
        /* storage blocked: the app falls back to defaults */
      }
    },
    [SETTINGS_KEY, { onboarded: true, semanticSearch: false, transcribeAudio: false, ...extra }] as const,
  );
}

export interface StoredItem {
  id: string;
  kind: string;
  status: string;
  sourceName?: string;
  title: string;
  text: string;
  hasFile: number;
}

/** Item rows read straight from IndexedDB. */
export async function storedItems(page: Page): Promise<StoredItem[]> {
  return page.evaluate(
    () =>
      new Promise<StoredItem[]>((resolve, reject) => {
        const req = indexedDB.open("remembos");
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("items")) {
            db.close();
            return resolve([]);
          }
          const all = db.transaction("items", "readonly").objectStore("items").getAll();
          all.onsuccess = () => {
            db.close();
            resolve(
              (all.result as Array<StoredItem & { text?: string }>).map((i) => ({
                id: i.id,
                kind: i.kind,
                status: i.status,
                sourceName: i.sourceName,
                title: i.title,
                hasFile: i.hasFile,
                text: (i.text ?? "").slice(0, 2000),
              })),
            );
          };
          all.onerror = () => reject(all.error);
        };
      }),
  );
}

export async function waitForReady(page: Page, match: (i: StoredItem) => boolean, timeout: number): Promise<StoredItem> {
  let found: StoredItem | undefined;
  await expect
    .poll(
      async () => {
        found = (await storedItems(page)).find(match);
        return found?.status ?? "missing";
      },
      { timeout, intervals: [300, 700, 1000] },
    )
    .toBe("ready");
  return found!;
}

export const bySource = (name: string) => (i: StoredItem) => i.sourceName === name;

/** Load the 10 sample memories through the UI (home tip or empty state). */
export async function loadSamples(page: Page) {
  await page.goto("/");
  await page.getByTestId("try-samples").first().click();
  await expect
    .poll(async () => (await storedItems(page)).filter((i) => i.id.startsWith("sample_") && i.status === "ready").length, {
      timeout: 20_000,
    })
    .toBe(10);
}

export async function search(page: Page, q: string) {
  await page.goto(`/search/?q=${encodeURIComponent(q)}`);
  await expect(page.getByTestId("search-result").first()).toBeVisible();
}

export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "page scrolls sideways").toBeLessThanOrEqual(1);
}

export async function upload(page: Page, file: { name: string; mimeType: string; buffer: Buffer }) {
  await page.getByTestId("global-file-input").setInputFiles(file);
}

/** PNG with large black text, rendered in the page. */
export async function makePng(page: Page, lines: string[]): Promise<Buffer> {
  const bytes = await page.evaluate(async (lines) => {
    const c = document.createElement("canvas");
    c.width = 1200;
    c.height = 140 + lines.length * 110;
    const g = c.getContext("2d")!;
    g.fillStyle = "#fff";
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = "#000";
    g.font = "bold 64px Arial, Helvetica, sans-serif";
    lines.forEach((l, i) => g.fillText(l, 60, 130 + i * 110));
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), "image/png"));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  }, lines);
  return Buffer.from(bytes);
}

/** A small text PDF generated by Chrome from HTML. */
export async function makePdf(context: BrowserContext, html: string): Promise<Buffer> {
  const p = await context.newPage();
  await p.setContent(html);
  const pdf = await p.pdf({ format: "A4" });
  await p.close();
  return pdf;
}

/** ~3 s WebM video of a canvas showing big text (recorded in the page with MediaRecorder). */
export async function makeWebm(page: Page, lines: string[]): Promise<Buffer> {
  const bytes = await page.evaluate(async (lines) => {
    const c = document.createElement("canvas");
    c.width = 1280;
    c.height = 720;
    const g = c.getContext("2d")!;
    const draw = (t: number) => {
      g.fillStyle = "#fff";
      g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = "#000";
      g.font = "bold 84px Arial, Helvetica, sans-serif";
      lines.forEach((l, i) => g.fillText(l, 60, 220 + i * 140));
      g.fillStyle = `hsl(${t % 360} 70% 50%)`;
      g.fillRect(c.width - 60, c.height - 60, 40, 40);
    };
    draw(0);
    const stream = c.captureStream(15);
    const rec = new MediaRecorder(stream, { mimeType: "video/webm" });
    const parts: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
    const done = new Promise((r) => (rec.onstop = r));
    rec.start(250);
    const start = performance.now();
    await new Promise<void>((resolve) => {
      const tick = () => {
        const t = performance.now() - start;
        draw(t);
        if (t < 3000) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
    rec.stop();
    await done;
    const blob = new Blob(parts, { type: "video/webm" });
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  }, lines);
  return Buffer.from(bytes);
}

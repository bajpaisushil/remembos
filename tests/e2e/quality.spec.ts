// Quality & PWA: readable hover states in light and dark (regression for "white text on white hover"),
// installable manifest, offline app shell, install prompt, app shortcuts and "Open with Remembos".
import { expect, test, type Page } from "@playwright/test";
import { loadSamples, presetSettings, storedItems, waitForReady, watch, type Watch } from "./helpers";

let w: Watch;
test.beforeEach(({ page }) => {
  w = watch(page);
});
test.afterEach(() => {
  expect(w.errors, "console or page errors").toEqual([]);
});

/** Hover every visible control and return the ones whose text becomes hard to read (contrast < 3:1). */
async function hoverContrastProblems(page: Page): Promise<string[]> {
  const handles = await page.$$("header a, header button, main a, main button, footer a, footer button");
  const problems: string[] = [];
  for (const h of handles.slice(0, 90)) {
    if (!(await h.isVisible())) continue;
    const text = (await h.evaluate((el) => (el as HTMLElement).innerText.trim())).slice(0, 40);
    if (!text) continue;
    await h.hover({ timeout: 2_000 }).catch(() => {});
    await page.waitForTimeout(160);
    const ratio = await h.evaluate((el) => {
      const parse = (c: string): [number, number, number, number] | null => {
        const ctx = document.createElement("canvas").getContext("2d")!;
        ctx.fillStyle = "#000";
        ctx.fillStyle = c;
        ctx.fillRect(0, 0, 1, 1);
        const d = ctx.getImageData(0, 0, 1, 1).data;
        const alpha = /\/\s*([\d.]+)\)|,\s*([\d.]+)\)$/.exec(c);
        const a = c === "transparent" ? 0 : alpha ? Number(alpha[1] ?? alpha[2]) : 1;
        return [d[0], d[1], d[2], a];
      };
      const lum = ([r, g, b]: number[]) => {
        const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      // Text colour of the deepest element holding the label.
      let leaf: Element = el;
      while (leaf.firstElementChild && (leaf.firstElementChild as HTMLElement).innerText?.trim() === (leaf as HTMLElement).innerText.trim()) leaf = leaf.firstElementChild;
      const fg = parse(getComputedStyle(leaf).color)!;
      // Effective background: first ancestor with a gradient (brand = dark) or an opaque-ish colour.
      let node: Element | null = el;
      let bg: number[] | null = null;
      while (node) {
        const cs = getComputedStyle(node);
        if (cs.backgroundImage.includes("gradient")) {
          bg = [124, 58, 237];
          break;
        }
        const c = parse(cs.backgroundColor);
        if (c && c[3] >= 0.6) {
          bg = c;
          break;
        }
        node = node.parentElement;
      }
      bg ??= document.documentElement.classList.contains("dark") ? [10, 10, 18] : [251, 251, 253];
      const [l1, l2] = [lum(fg), lum(bg)].sort((a, b) => b - a);
      return (l1 + 0.05) / (l2 + 0.05);
    });
    if (ratio < 3) problems.push(`"${text}" contrast ${ratio.toFixed(2)} on hover`);
  }
  return problems;
}

for (const theme of ["light", "dark"] as const) {
  test(`hover never hides button text (${theme})`, async ({ page, isMobile }) => {
    test.skip(isMobile, "Hover is a pointer-device concern");
    test.slow();
    await presetSettings(page, { theme });
    await loadSamples(page);
    const problems: string[] = [];
    for (const path of ["/", "/library/", "/search/?q=priya", "/data/", "/storage/", "/storage/explorer/", "/help/"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      problems.push(...(await hoverContrastProblems(page)).map((p) => `${path}: ${p}`));
    }
    expect(problems).toEqual([]);
  });
}

test("installable manifest with icons, screenshots, shortcuts, share target and file handlers", async ({ page, request }) => {
  await page.goto("/");
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(href).toBeTruthy();
  const manifest = await (await request.get(new URL(href!, page.url()).href)).json();
  expect(manifest).toMatchObject({ short_name: "Remembos", display: "standalone", start_url: expect.any(String), scope: expect.any(String) });
  expect(manifest.id).toBeTruthy();
  expect(manifest.theme_color && manifest.background_color).toBeTruthy();
  expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === "maskable")).toBe(true);
  for (const img of [...manifest.icons, ...manifest.screenshots]) {
    const [wantW, wantH] = String(img.sizes).split("x").map(Number);
    const size = await page.evaluate(async (src) => {
      const el = new Image();
      el.src = src;
      await el.decode();
      return [el.naturalWidth, el.naturalHeight];
    }, new URL(img.src, new URL(href!, page.url())).href);
    expect(size, img.src).toEqual([wantW, wantH]);
  }
  expect(manifest.shortcuts.map((s: { url: string }) => s.url).join(" ")).toMatch(/action=upload/);
  expect(manifest.share_target?.method).toBe("POST");
  expect(manifest.file_handlers?.length).toBeGreaterThan(0);
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
  await expect(page.locator('meta[name="theme-color"]').first()).toHaveAttribute("content", /.+/);
});

test("works offline after the first visit", async ({ page, context }) => {
  await presetSettings(page);
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload(); // let the service worker control the page and cache what it serves
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await page.waitForTimeout(1500);
  await context.setOffline(true);
  for (const path of ["/", "/library/", "/search/", "/storage/explorer/", "/help/"]) {
    await page.goto(path);
    await expect(page.locator("h1").first(), path).toBeVisible();
  }
  await expect(page.getByTestId("offline-pill").first()).toBeVisible();
  await context.setOffline(false);
  // Offline, the browser logs each network attempt the app falls back from — expected. App files must all come
  // from the offline cache, though: any failed /_next/static/ file is a real gap.
  expect(w.errors.filter((e) => e.includes("/_next/static/"))).toEqual([]);
  w.errors = w.errors.filter((e) => !/ERR_INTERNET_DISCONNECTED/.test(e));
});

test("Install app appears when the browser offers it and opens the browser's install dialog", async ({ page, isMobile }) => {
  await presetSettings(page);
  await page.addInitScript(() => {
    window.addEventListener("load", () => {
      setTimeout(() => {
        const e = new Event("beforeinstallprompt", { cancelable: true }) as Event & {
          prompt: () => Promise<void>;
          userChoice: Promise<{ outcome: string; platform: string }>;
        };
        e.prompt = async () => {
          (window as unknown as { __prompted: boolean }).__prompted = true;
        };
        e.userChoice = Promise.resolve({ outcome: "accepted", platform: "web" });
        window.dispatchEvent(e);
      }, 300);
    });
  });
  await page.goto("/");
  if (isMobile) {
    await page.getByTestId("mobile-add").click();
    await page.getByTestId("add-sheet-install").click();
  } else {
    await page.getByTestId("header-add-menu").click();
    await page.getByTestId("add-menu-install").click();
  }
  await expect.poll(() => page.evaluate(() => (window as unknown as { __prompted?: boolean }).__prompted === true)).toBe(true);
});

test.describe("iPhone", () => {
  test.use({
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  });
  test("shows Add to Home Screen steps instead of an install prompt", async ({ page, isMobile }) => {
    await presetSettings(page);
    await page.goto("/");
    if (isMobile) {
      await page.getByTestId("mobile-add").click();
      await page.getByTestId("add-sheet-install").click();
    } else {
      await page.getByTestId("header-add-menu").click();
      await page.getByTestId("add-menu-install").click();
    }
    await expect(page.getByTestId("install-help-ios")).toBeVisible();
    await expect(page.getByTestId("install-help-ios")).toContainText(/Add to Home Screen/i);
  });
});

test("home-screen shortcuts: ?action=record opens the recorder, ?action=upload focuses the upload area", async ({ page }) => {
  await presetSettings(page);
  await page.goto("/?action=record");
  await expect(page.getByTestId("voice-recorder")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.goto("/?action=upload");
  await expect(page).toHaveURL(/#upload$|\/$/);
  await expect(page.getByTestId("drop-zone")).toBeInViewport();
});

test("files opened with the installed app (launch queue) become memories", async ({ page }) => {
  await presetSettings(page);
  // Chrome ships a real (read-only) window.launchQueue, so capture the consumer the app registers on it.
  await page.addInitScript(() => {
    const capture = (fn: unknown) => {
      (window as unknown as { __launch: unknown }).__launch = fn;
    };
    const proto = (window as unknown as { LaunchQueue?: { prototype: { setConsumer: unknown } } }).LaunchQueue?.prototype;
    if (proto) proto.setConsumer = capture;
    else Object.defineProperty(window, "launchQueue", { value: { setConsumer: capture }, configurable: true });
  });
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => typeof (window as unknown as { __launch?: unknown }).__launch)).toBe("function");
  await page.evaluate(() => {
    const consumer = (window as unknown as { __launch: (p: unknown) => void }).__launch;
    consumer({ files: [{ kind: "file", name: "launch.txt", getFile: async () => new File(["Opened with Remembos from the desktop"], "launch.txt", { type: "text/plain" }) }] });
  });
  await waitForReady(page, (i) => i.sourceName === "launch.txt", 30_000);
  expect((await storedItems(page)).length).toBe(1);
});

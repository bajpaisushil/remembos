// The full offline promise, end to end, the way a laptop uses the installed app:
// 1. first visit online → install the app (models download automatically) → add memories → close the browser
// 2. reopen the same browser profile with NO network at all → every screen opens and every feature works:
//    OCR on screenshots, PDFs, video frames, voice recording + transcription, keyword and meaning search, backup.
// Needs the network for step 1 (public model downloads): REMEMBOS_E2E_NETWORK=1.
import { chromium, expect, test, type BrowserContext, type Page } from "@playwright/test";
import { bySource, makePdf, makePng, makeWebm, NETWORK, SETTINGS_KEY, storedItems, upload, waitForReady } from "./helpers";

const channel = process.env.PW_CHANNEL ?? "chrome";
const FAKE_MIC = ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"];

async function open(profile: string, baseURL: string, offline: boolean): Promise<BrowserContext> {
  return chromium.launchPersistentContext(profile, {
    channel: channel || undefined,
    baseURL,
    offline,
    headless: true,
    viewport: { width: 1280, height: 860 },
    acceptDownloads: true,
    permissions: ["microphone"],
    args: FAKE_MIC,
  });
}

function realErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    // Offline, the browser logs each network attempt the app falls back from (and model hosts) — expected.
    if (/ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|favicon/i.test(t)) return;
    errors.push(`console: ${t}`);
  });
  return errors;
}

test("installed app works entirely offline after closing and reopening the browser", async ({ isMobile, baseURL }) => {
  test.skip(!NETWORK, "Downloads the AI models once; set REMEMBOS_E2E_NETWORK=1 to run");
  test.skip(isMobile, "Laptop scenario — runs once, on desktop");
  test.setTimeout(600_000);
  const profile = test.info().outputPath("profile");

  // ---------- 1. Online: first visit, install, add memories ----------
  let ctx = await open(profile, baseURL!, false);
  let page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.addInitScript((key) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ onboarded: true, semanticSearch: true, transcribeAudio: true, snoozed: {} }));
  }, SETTINGS_KEY);
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  // The browser says "installed" → Remembos downloads every AI model by itself.
  await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Ready for offline" })).toBeVisible({ timeout: 420_000 });
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || "{}").offlinePreparedAt > 0, SETTINGS_KEY)).toBe(true);

  await page.getByTestId("try-samples").first().click();
  await expect.poll(async () => (await storedItems(page)).filter((i) => i.status === "ready").length, { timeout: 30_000 }).toBe(10);
  // Let meaning search finish preparing the samples.
  await page.goto("/search/?q=Priya%20phone%20number");
  await expect(page.getByTestId("meaning-status")).toContainText("Meaning search on", { timeout: 120_000 });
  await ctx.close();

  // ---------- 2. Reopen with NO network ----------
  ctx = await open(profile, baseURL!, true);
  page = ctx.pages()[0] ?? (await ctx.newPage());
  const errors = realErrors(page);
  const external: string[] = [];
  page.on("requestfailed", (r) => {
    if (!r.url().startsWith(baseURL!)) external.push(r.url());
  });

  for (const path of ["/", "/library/", "/search/", "/graph/", "/data/", "/storage/", "/storage/explorer/", "/help/"]) {
    await page.goto(path);
    await expect(page.locator("h1").first(), `${path} opens offline`).toBeVisible();
  }
  await expect(page.getByTestId("offline-pill").first()).toBeVisible();

  // Keyword search, smart answers and meaning search — offline.
  await page.goto("/search/?q=Priya%20phone%20number");
  await expect(page.getByTestId("smart-answer").first()).toContainText("555-0134");
  await expect(page.getByTestId("meaning-status")).toContainText("Meaning search on", { timeout: 60_000 });

  // A screenshot is read (OCR) offline.
  await page.goto("/");
  await upload(page, { name: "offline-shot.png", mimeType: "image/png", buffer: await makePng(page, ["Offline Orange Bicycle"]) });
  expect((await waitForReady(page, bySource("offline-shot.png"), 120_000)).text.toLowerCase()).toContain("bicycle");

  // A PDF is read offline (pdf.js helper from the offline copy).
  const pdf = await makePdf(ctx, "<h1>Offline invoice</h1><p>Glacier tea subscription renews on May 9 for 18 euros.</p>");
  await upload(page, { name: "offline-invoice.pdf", mimeType: "application/pdf", buffer: pdf });
  expect((await waitForReady(page, bySource("offline-invoice.pdf"), 60_000)).text).toContain("Glacier tea");

  // A video's on-screen text is read offline.
  await upload(page, { name: "offline-clip.webm", mimeType: "video/webm", buffer: await makeWebm(page, ["Quiet Harbor", "Ferry Times"]) });
  expect((await waitForReady(page, bySource("offline-clip.webm"), 180_000)).text.toLowerCase()).toContain("harbor");

  // A voice note is recorded and transcribed offline (the fake mic plays a tone, so the transcript may be empty —
  // what matters is that the voice model ran without the network and the memory is saved).
  await page.getByTestId("home-record").click();
  await page.getByTestId("recorder-start").click();
  await expect(page.getByTestId("recorder-timer")).toContainText(/0:0[2-9]/, { timeout: 15_000 });
  await page.getByTestId("recorder-stop").click();
  const voice = await waitForReady(page, (i) => i.kind === "voice" && /voice memo/i.test(i.sourceName ?? ""), 180_000);
  expect(voice.hasFile).toBe(1);
  expect(await page.evaluate(() => document.body.innerText)).not.toMatch(/Couldn.t (download|load) the voice transcriber/);

  // Backups work offline.
  await page.goto("/data/");
  const download = page.waitForEvent("download");
  await page.getByTestId("export-backup").click();
  expect((await download).suggestedFilename()).toMatch(/\.zip$/);

  expect(errors, "no real errors while offline").toEqual([]);
  await ctx.close();
  test.info().annotations.push({ type: "offline-network-attempts", description: `${external.length} external requests failed (expected offline)` });
});

// Offline guidance: the steps to take BEFORE switching the internet off, and calm behaviour when someone goes
// offline before finishing them (no red errors; screenshots added offline are read once back online).
import { expect, test } from "@playwright/test";
import { loadSamples, makePng, NETWORK, presetSettings, storedItems, upload, waitForReady, watch, type Watch } from "./helpers";

let w: Watch;
test.beforeEach(({ page }) => {
  w = watch(page);
});
test.afterEach(() => {
  // Offline, the browser logs each network attempt the app falls back from — expected noise.
  expect(w.errors.filter((e) => !/ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED/.test(e))).toEqual([]);
});

test("offline steps are shown before going offline, and going offline unprepared stays calm", async ({ page, context, isMobile }) => {
  await presetSettings(page, { semanticSearch: true, transcribeAudio: true });
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  // 1. Home warns ahead of time and opens the checklist.
  await expect(page.getByTestId("offline-setup-card")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("offline-setup-open").click();
  const dialog = page.getByTestId("offline-setup-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("offline-step-open")).toHaveAttribute("data-state", "done");
  await expect(dialog.getByTestId("offline-step-models")).toHaveAttribute("data-state", "todo");
  await expect(dialog.getByTestId("offline-step-done")).toHaveAttribute("data-state", "blocked");
  await expect(dialog).toContainText("Download the AI models once");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // Same checklist on the Help and Data pages.
  await page.goto("/help/");
  await expect(page.getByTestId("help-offline").getByTestId("offline-setup")).toBeVisible();
  await page.goto("/data/");
  await expect(page.getByTestId("offline-ready-card").getByTestId("offline-setup")).toBeVisible();

  await loadSamples(page);

  // 2. Internet off before finishing setup → one calm notice with the steps, no red errors.
  await context.setOffline(true);
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "isn't fully set up" })).toBeVisible({ timeout: 15_000 });
  if (!isMobile) {
    await page.getByTestId("offline-pill").first().click();
    await expect(page.getByTestId("offline-pill-steps")).toBeVisible();
    await page.keyboard.press("Escape");
  }

  // Keyword search and smart answers still work; meaning search offers the setup instead of failing.
  await page.goto("/search/?q=Priya%20phone%20number");
  await expect(page.getByTestId("smart-answer").first()).toContainText("555-0134");
  await expect(page.getByTestId("meaning-status-offline")).toBeVisible();
  await expect(page.locator('[data-sonner-toast][data-type="error"]')).toHaveCount(0);

  // 3. A screenshot added offline is kept, waiting for the internet …
  await page.goto("/");
  await upload(page, { name: "while-offline.png", mimeType: "image/png", buffer: await makePng(page, ["Copper Kettle", "Market Stall 7"]) });
  await expect
    .poll(async () => (await storedItems(page)).find((i) => i.sourceName === "while-offline.png")?.status, { timeout: 30_000 })
    .toBe("error");
  const waiting = await page.evaluate(
    () =>
      new Promise<string>((res) => {
        const r = indexedDB.open("remembos");
        r.onsuccess = () => {
          const all = r.result.transaction("items").objectStore("items").getAll();
          all.onsuccess = () => res((all.result as { sourceName?: string; error?: string }[]).find((i) => i.sourceName === "while-offline.png")?.error ?? "");
        };
      }),
  );
  expect(waiting).toMatch(/Waiting for internet/);
  await expect(page.locator('[data-sonner-toast][data-type="error"]')).toHaveCount(0);

  // … and read automatically once the connection is back.
  if (!NETWORK) return;
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  const item = await waitForReady(page, (i) => i.sourceName === "while-offline.png", 150_000);
  expect(item.text.toLowerCase()).toContain("kettle");
});

// Storage safety: warnings when the browser's space runs low, imports blocked before they fail, backup →
// wipe → restore round trip, and the storage guide explaining every storage medium.
import { expect, test, type Page } from "@playwright/test";
import { loadSamples, presetSettings, storedItems, upload, watch, type Watch } from "./helpers";

let w: Watch;
test.beforeEach(({ page }) => {
  w = watch(page);
});
test.afterEach(() => {
  expect(w.errors, "console or page errors").toEqual([]);
});

/**
 * Make the browser report a nearly full site quota (navigator.storage.estimate is what the app reads).
 * Chrome ignores DevTools quota overrides for this origin, so the report itself is simulated.
 */
async function fakeStorage(page: Page, usageRatio: number, quota = 5 * 1024 ** 3) {
  await page.addInitScript(
    ([ratio, q]) => {
      const real = navigator.storage.estimate.bind(navigator.storage);
      navigator.storage.estimate = async () => ({ ...(await real()), quota: q, usage: Math.round(q * ratio) });
    },
    [usageRatio, quota] as const,
  );
}

test("warns when storage is getting full and points to Manage storage", async ({ page }) => {
  await presetSettings(page);
  await loadSamples(page);
  await fakeStorage(page, 0.93);
  await page.reload();
  const t = page.locator("[data-sonner-toast]").filter({ hasText: /Storage is \d+% full/ });
  await expect(t).toBeVisible({ timeout: 30_000 });
  await t.getByRole("button", { name: /Manage storage/i }).click();
  await expect(page).toHaveURL(/\/data\/$/);
  await expect(page.getByTestId("storage-meter")).toBeVisible();
  await expect(page.getByTestId("storage-quota-explainer")).toContainText(/ceiling/i);
});

test("an upload that would not fit is refused before anything is written", async ({ page }) => {
  await presetSettings(page);
  await fakeStorage(page, 0.975);
  await page.goto("/");
  await upload(page, { name: "big-notes.txt", mimeType: "text/plain", buffer: Buffer.alloc(400_000, "a") });
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: /Not enough space/i })).toBeVisible({ timeout: 15_000 });
  expect(await storedItems(page)).toEqual([]);
});

test("backup → delete everything → restore brings every memory back", async ({ page }) => {
  await presetSettings(page);
  await loadSamples(page);
  await page.goto("/data/");
  const download = page.waitForEvent("download");
  await page.getByTestId("export-backup").click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^remembos-backup-\d{4}-\d{2}-\d{2}\.zip$/);
  const path = await file.path();

  await page.getByTestId("delete-everything").click();
  await page.getByTestId("confirm-input").fill("DELETE");
  await page.getByTestId("confirm-button").click();
  await page.waitForURL((url) => url.pathname === "/", { timeout: 20_000 });
  await expect.poll(async () => (await storedItems(page)).length).toBe(0);

  await page.goto("/data/");
  await page.getByTestId("restore-input").setInputFiles(path);
  await expect.poll(async () => (await storedItems(page)).filter((i) => i.status === "ready").length, { timeout: 30_000 }).toBe(10);
  await page.goto("/search/?q=Priya%20phone%20number");
  await expect(page.getByTestId("smart-answer").first()).toContainText("555-0134");
});

test("the storage guide lists every storage medium and what Remembos keeps there", async ({ page }) => {
  await presetSettings(page);
  await loadSamples(page);
  await page.goto("/storage/");
  const inspector = page.getByTestId("storage-inspector");
  await expect(inspector).toBeVisible();
  await expect(page.getByTestId("inspector-indexeddb")).toContainText("remembos", { timeout: 10_000 });
  await expect(inspector).toContainText("remembos:settings:v1");
  await expect(inspector).toContainText(/cookie/i);
  for (const medium of ["IndexedDB", "localStorage", "sessionStorage", "Cookies", "Cache"]) {
    await expect(page.locator("main")).toContainText(medium);
  }
  // Safety checklist: what erases memories vs. what is safe.
  await expect(page.locator("main")).toContainText(/Cookies and (other )?site data/i);
});

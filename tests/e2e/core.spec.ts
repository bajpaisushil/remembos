// Core flows: pages render, upload-first home, adding things (files, paste, notes), search answers,
// item page + "where is this stored", theme, delete everything. Runs on desktop and phone viewports.
import { expect, test } from "@playwright/test";
import {
  bySource,
  expectNoHorizontalScroll,
  loadSamples,
  makePdf,
  presetSettings,
  search,
  storedItems,
  upload,
  waitForReady,
  watch,
  type Watch,
} from "./helpers";

let w: Watch;
test.beforeEach(({ page }) => {
  w = watch(page);
});
test.afterEach(() => {
  expect(w.errors, "console or page errors").toEqual([]);
});

test("every page renders on an empty device without sideways scrolling", async ({ page }) => {
  await presetSettings(page);
  for (const path of [
    "/",
    "/search/",
    "/library/",
    "/item/?id=missing",
    "/graph/",
    "/data/",
    "/storage/",
    "/storage/explorer/",
    "/storage/explorer/?item=missing",
    "/help/",
  ]) {
    await page.goto(path);
    await expect(page.locator("h1").first(), path).toBeVisible();
    await expectNoHorizontalScroll(page);
  }
  w.allow404 = true;
  await page.goto("/no-such-page/");
  await expect(page.locator("h1").first()).toBeVisible();
});

test("first visit lands on the upload area — no blocking dialog — and samples load from the tip", async ({ page }) => {
  await page.goto("/");
  const zone = page.getByTestId("drop-zone");
  await expect(zone).toBeInViewport();
  await expect(page.getByTestId("home-upload")).toBeInViewport();
  await expect(page.getByTestId("onboarding")).toHaveCount(0);
  await expect(page.locator('[aria-modal="true"]')).toHaveCount(0);
  // No search box on home: search lives in the header and the Search tab.
  await expect(page.getByTestId("home-search")).toHaveCount(0);
  await expect(page.getByTestId("home-guide")).toBeVisible();
  await page.getByTestId("try-samples").first().click();
  await expect
    .poll(async () => (await storedItems(page)).filter((i) => i.status === "ready").length, { timeout: 20_000 })
    .toBe(10);
  await page.goto("/library/");
  await expect(page.getByTestId("memory-card")).toHaveCount(10, { timeout: 15_000 });
});

test("Upload opens the file picker immediately (header on desktop, + sheet on phones)", async ({ page, isMobile }) => {
  await presetSettings(page);
  await page.goto("/");
  if (isMobile) {
    await page.getByTestId("mobile-add").click();
    await expect(page.getByTestId("add-sheet")).toBeVisible();
    const chooser = page.waitForEvent("filechooser");
    await page.getByTestId("add-sheet-upload").click();
    expect((await chooser).isMultiple()).toBe(true);
  } else {
    const chooser = page.waitForEvent("filechooser");
    await page.getByTestId("header-upload").click();
    expect((await chooser).isMultiple()).toBe(true);
  }
  // The big home button does the same.
  const chooser2 = page.waitForEvent("filechooser");
  await page.getByTestId("home-upload").click();
  await chooser2;
});

test("search gives smart answers and ranks the right memory first", async ({ page }) => {
  await presetSettings(page);
  await loadSamples(page);

  await search(page, "Priya phone number");
  await expect(page.getByTestId("smart-answer").first()).toContainText("555-0134");

  // The owner's own phrasings.
  await search(page, "which document mentioned this amount 2,340");
  await expect(page.getByTestId("smart-answer").first()).toContainText("2,340");
  await search(page, "how much was the Northwind invoice");
  await expect(page.getByTestId("smart-answer").first()).toContainText("2,340");

  await search(page, "what did I decide about Atlas last month");
  const first = page.getByTestId("search-result").first();
  await expect(first).toHaveAttribute("data-item-id", "sample_decision");
  await expect(page.getByTestId("date-chip").first()).toBeVisible();

  await first.click();
  await expect(page.getByTestId("item-page")).toBeVisible();
  await expect(page.getByTestId("item-title")).toContainText("Atlas");
  await expectNoHorizontalScroll(page);
});

test("pasting text saves it instantly, with Undo", async ({ page }) => {
  await presetSettings(page);
  await page.goto("/");
  await page.waitForFunction(() => document.readyState === "complete");
  const text = "Locker code for the gym on 5th street is 4471, remember the blue lock";
  // Paste listener is installed shortly after load; retry until the memory appears.
  await expect
    .poll(
      async () => {
        await page.evaluate((t) => {
          const dt = new DataTransfer();
          dt.setData("text/plain", t);
          document.body.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
        }, text);
        return (await storedItems(page)).filter((i) => i.text.includes("Locker code")).length;
      },
      { timeout: 10_000, intervals: [400, 800] },
    )
    .toBe(1);
  const toastEl = page.locator("[data-sonner-toast]").filter({ hasText: "Saved from clipboard" });
  await expect(toastEl).toBeVisible();
  await expect(page.getByTestId("recent-card").first()).toContainText(/Locker code/i);
  // Undo removes it (nothing else may cover the Undo button).
  await toastEl.getByRole("button", { name: "Undo" }).click();
  await expect.poll(async () => (await storedItems(page)).length, { timeout: 10_000 }).toBe(0);
});

test("a note added from the add menu is saved and found by search", async ({ page, isMobile }) => {
  await presetSettings(page);
  await page.goto("/");
  if (isMobile) {
    await page.getByTestId("mobile-add").click();
    await page.getByTestId("add-sheet-note").click();
  } else {
    await page.getByTestId("header-add-menu").click();
    await page.getByTestId("add-menu-note").click();
  }
  await expect(page.getByTestId("quick-add")).toBeVisible();
  await page.getByTestId("quick-add-text").fill("The spare key for the garden shed is under the blue flowerpot by the zebra statue.");
  await page.getByTestId("quick-add-save").click();
  await expect(page.getByTestId("quick-add")).toBeHidden({ timeout: 15_000 });

  await search(page, "zebra flowerpot");
  await expect(page.getByTestId("search-result").first()).toContainText("garden shed");
});

test("text and PDF files become searchable memories; items appear instantly", async ({ page, context }) => {
  await presetSettings(page);
  await page.goto("/");

  await upload(page, {
    name: "packing-list.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Packing list for the Lisbon trip: passport, sunscreen, travel adapter, rain jacket."),
  });
  // Instant feedback: a card shows up on home right away.
  await expect(page.getByTestId("recent-card").first()).toBeVisible({ timeout: 3_000 });
  const txt = await waitForReady(page, bySource("packing-list.txt"), 30_000);

  const pdf = await makePdf(
    context,
    "<h1>Quarterly llama grooming report</h1><p>The alpaca shearing contract with Hilltop Farms renews on March 3. Total cost 812 dollars.</p>",
  );
  await upload(page, { name: "llama-report.pdf", mimeType: "application/pdf", buffer: pdf });
  const doc = await waitForReady(page, bySource("llama-report.pdf"), 60_000);
  expect(doc.text).toContain("alpaca shearing");

  await search(page, "Lisbon passport");
  await expect(page.getByTestId("search-result").first()).toHaveAttribute("data-item-id", txt.id);
  await search(page, "llama grooming");
  await expect(page.getByTestId("search-result").first()).toHaveAttribute("data-item-id", doc.id);
});

test("unsupported files are refused with a clear message and nothing is stored", async ({ page }) => {
  await presetSettings(page);
  await page.goto("/");
  await upload(page, { name: "setup.exe", mimeType: "application/x-msdownload", buffer: Buffer.from("MZ binary") });
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: /skipped|isn.t supported|can.t/i }).first()).toBeVisible();
  expect(await storedItems(page)).toEqual([]);
});

test("item page: open original, where it is stored, and the storage explorer", async ({ page, context, isMobile }) => {
  await presetSettings(page);
  await page.goto("/");
  await upload(page, { name: "receipt.txt", mimeType: "text/plain", buffer: Buffer.from("Receipt: blue ceramic teapot, 49 dollars, Harbor Street market.") });
  const item = await waitForReady(page, bySource("receipt.txt"), 30_000);

  await page.goto(`/item/?id=${item.id}`);
  await expect(page.getByTestId("item-page")).toBeVisible();

  const popup = context.waitForEvent("page");
  await page.getByTestId("open-original").click();
  const tab = await popup;
  await tab.waitForLoadState();
  expect(tab.url()).toMatch(/^blob:/);
  await expect(tab.locator("body")).toContainText("teapot");
  await tab.close();

  await page.getByTestId("where-stored-toggle").click();
  const where = page.getByTestId("where-stored");
  await expect(where).toContainText("IndexedDB");
  await expect(page.getByTestId("where-stored-address")).toContainText(item.id);
  if (isMobile) {
    // Phones keep browser storage in a sandbox nobody can browse — the panel must say so instead of a path.
    await expect(where).toContainText(/can.t be browsed|sandbox|not browsable|backup/i);
  } else {
    await expect(page.getByTestId("where-stored-path").first()).toContainText(/localhost/);
  }

  await page.getByTestId("open-explorer").first().click();
  await expect(page).toHaveURL(new RegExp(`/storage/explorer/\\?item=${item.id}`));
  const card = page.getByTestId("explorer-item");
  await expect(card).toBeVisible();
  await expect(card).toContainText("receipt.txt");
  await expect(page.getByTestId("explorer-item-address")).toContainText(item.id);
  if (isMobile) await expect(page.getByTestId("explorer-item-folder-sandboxed")).toBeVisible();
  else await expect(page.getByTestId("explorer-item-folder").first()).toContainText(/localhost/);
});

test("dark mode can be switched on and is remembered", async ({ page }) => {
  await presetSettings(page);
  await page.goto("/");
  await page.getByTestId("theme-switcher-dark").click();
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  await page.goto("/library/");
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  await page.getByTestId("theme-switcher-light").click();
  await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
});

test("delete everything empties the library", async ({ page }) => {
  await presetSettings(page);
  await loadSamples(page);
  await page.goto("/data/");
  await page.getByTestId("delete-everything").click();
  await page.getByTestId("confirm-input").fill("DELETE");
  await page.getByTestId("confirm-button").click();
  await page.waitForURL((url) => url.pathname === "/", { timeout: 20_000 });
  await page.goto("/library/");
  await expect(page.getByTestId("library-empty")).toBeVisible();
  expect(await storedItems(page)).toEqual([]);
});

test("recent memories on home: Copy for text, Download for files — without opening the memory", async ({ page, context, isMobile }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await presetSettings(page);
  await page.goto("/");
  if (isMobile) {
    await page.getByTestId("mobile-add").click();
    await page.getByTestId("add-sheet-note").click();
  } else {
    await page.getByTestId("header-add-menu").click();
    await page.getByTestId("add-menu-note").click();
  }
  await page.getByTestId("quick-add-text").fill("Wi-Fi at the cabin: network PineLodge, password maple-syrup-42");
  await page.getByTestId("quick-add-save").click();
  await expect(page.getByTestId("quick-add")).toBeHidden({ timeout: 15_000 });

  await page.getByTestId("recent-copy").first().click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain("maple-syrup-42");
  await expect(page).toHaveURL(/\/$/); // stayed on home

  await upload(page, { name: "boarding-pass.txt", mimeType: "text/plain", buffer: Buffer.from("Gate B12, seat 14C, boarding 7:40") });
  await waitForReady(page, bySource("boarding-pass.txt"), 30_000);
  const download = page.waitForEvent("download");
  await page.getByTestId("recent-download").first().click();
  expect((await download).suggestedFilename()).toBe("boarding-pass.txt");
  await expect(page).toHaveURL(/\/$/);
});

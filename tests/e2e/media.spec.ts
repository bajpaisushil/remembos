// Media: screenshots (OCR), videos (OCR of sampled frames), in-app voice recording, Android share target.
// OCR downloads the public text-reader model once — set REMEMBOS_E2E_NETWORK=1 to run those checks.
import { expect, test } from "@playwright/test";
import { bySource, makePng, makeWebm, NETWORK, presetSettings, search, storedItems, upload, waitForReady, watch, type Watch } from "./helpers";

// A fake microphone for the recorder test (harmless for the others).
test.use({ launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] } });

let w: Watch;
test.beforeEach(({ page }) => {
  w = watch(page);
});
test.afterEach(() => {
  expect(w.errors, "console or page errors").toEqual([]);
});

test("screenshot text is read on the device and found by search", async ({ page }) => {
  test.skip(!NETWORK, "Downloads the OCR model; set REMEMBOS_E2E_NETWORK=1 to run");
  test.slow();
  await presetSettings(page);
  await page.goto("/");
  const png = await makePng(page, ["Blue Ceramic Teapot", "49 dollars"]);
  await upload(page, { name: "teapot.png", mimeType: "image/png", buffer: png });
  const item = await waitForReady(page, bySource("teapot.png"), 150_000);
  expect(item.kind).toBe("image");
  expect(item.text.toLowerCase()).toContain("teapot");
  await search(page, "teapot");
  await expect(page.getByTestId("search-result").first()).toHaveAttribute("data-item-id", item.id);
});

test("video: on-screen text is read from frames, with a player on the item page", async ({ page, isMobile }) => {
  test.skip(!NETWORK, "Downloads the OCR model; set REMEMBOS_E2E_NETWORK=1 to run");
  test.skip(isMobile, "Recording a test video is done once, on desktop");
  test.slow();
  await presetSettings(page);
  await page.goto("/");
  const webm = await makeWebm(page, ["Purple Llama", "Conference 2026"]);
  await upload(page, { name: "llama-conference.webm", mimeType: "video/webm", buffer: webm });
  const item = await waitForReady(page, bySource("llama-conference.webm"), 170_000);
  expect(item.kind).toBe("video");
  expect(item.text.toLowerCase()).toContain("llama");
  await search(page, "llama conference");
  await expect(page.getByTestId("search-result").first()).toHaveAttribute("data-item-id", item.id);
  await page.goto(`/item/?id=${item.id}`);
  await expect(page.getByTestId("item-video")).toBeVisible();
});

test.describe("voice recorder", () => {
  test("records from the microphone and saves a voice memory", async ({ page, context, isMobile }) => {
    await context.grantPermissions(["microphone"]);
    await presetSettings(page); // transcription off → no model download
    await page.goto("/");
    if (isMobile) {
      await page.getByTestId("mobile-add").click();
      await page.getByTestId("add-sheet-record").click();
    } else {
      await page.getByTestId("home-record").click();
    }
    const dialog = page.getByTestId("voice-recorder");
    await expect(dialog).toBeVisible();
    await page.getByTestId("recorder-start").click();
    await expect(page.getByTestId("recorder-timer")).toContainText(/0:0[1-9]/, { timeout: 10_000 });
    await page.getByTestId("recorder-stop").click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
    const voice = await waitForReady(page, (i) => i.kind === "voice" && /voice memo/i.test(i.sourceName ?? i.title), 30_000);
    expect(voice.hasFile).toBe(1);
  });
});

test("files shared from another app (Android share sheet) are added", async ({ page }) => {
  await presetSettings(page);
  await page.goto("/");
  // What the service worker stores when the installed app receives a share (see src/lib/share-receiver.ts).
  await page.evaluate(async () => {
    const cache = await caches.open("remembos-share");
    const scope = new URL("/", location.href).href;
    const ts = Date.now();
    await cache.put(
      new Request(`${scope}__share/${ts}/0`),
      new Response(new Blob(["Shared note: the plumber is Marco, call him on +44 20 7946 0958"], { type: "text/plain" }), {
        headers: { "content-type": "text/plain", "x-file-name": encodeURIComponent("plumber.txt"), "x-shared-kind": "file" },
      }),
    );
    await cache.put(
      new Request(`${scope}__share/${ts}/1`),
      new Response("Great ramen spot\nhttps://example.com/ramen", { headers: { "content-type": "text/plain", "x-shared-kind": "text" } }),
    );
  });
  await page.goto("/?shared=1");
  await waitForReady(page, bySource("plumber.txt"), 30_000);
  await expect.poll(async () => (await storedItems(page)).some((i) => i.text.includes("ramen")), { timeout: 15_000 }).toBe(true);
  await expect.poll(() => page.evaluate(async () => (await (await caches.open("remembos-share")).keys()).length)).toBe(0);
  await expect(page).not.toHaveURL(/shared=1/);
});

test("Get ready for offline → screenshots are read with the internet off", async ({ page, context, isMobile }) => {
  test.skip(!NETWORK, "Downloads the OCR model; set REMEMBOS_E2E_NETWORK=1 to run");
  test.skip(isMobile, "One run is enough");
  test.slow();
  await presetSettings(page); // meaning search + transcription off → only the text reader is needed
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  await page.goto("/data/");
  await page.getByTestId("offline-ready").click();
  await expect(page.getByTestId("offline-step-done")).toHaveAttribute("data-state", "done", { timeout: 150_000 });

  await context.setOffline(true);
  await page.goto("/");
  const png = await makePng(page, ["Offline Orange Bicycle"]);
  await upload(page, { name: "offline.png", mimeType: "image/png", buffer: png });
  const item = await waitForReady(page, bySource("offline.png"), 90_000);
  expect(item.text.toLowerCase()).toContain("bicycle");
  await context.setOffline(false);
  w.errors = w.errors.filter((e) => !/ERR_INTERNET_DISCONNECTED/.test(e));
});

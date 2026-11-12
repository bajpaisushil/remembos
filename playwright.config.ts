import { defineConfig, devices } from "@playwright/test";

// Unit tests run in Node. E2E tests run against the static export in out/ (run `npm run build` first).
// Uses the locally installed Google Chrome by default; set PW_CHANNEL="" to use Playwright's Chromium.
const channel = process.env.PW_CHANNEL ?? "chrome";
const PORT = Number(process.env.PORT || 4310);

/** Projects picked with --project (none = all). Unit tests run in Node and need no web server. */
function selectedProjects(argv: string[]): string[] {
  const picked: string[] = [];
  argv.forEach((arg, i) => {
    if (arg.startsWith("--project=")) picked.push(arg.slice("--project=".length));
    else if (arg === "--project" && argv[i + 1]) picked.push(argv[i + 1]);
  });
  return picked;
}
const picked = selectedProjects(process.argv);
const unitOnly = picked.length > 0 && picked.every((p) => p === "unit");

export default defineConfig({
  testDir: "tests",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "unit", testDir: "tests/unit" },
    {
      name: "desktop",
      testDir: "tests/e2e",
      use: { ...devices["Desktop Chrome"], channel: channel || undefined, viewport: { width: 1366, height: 900 } },
    },
    {
      name: "mobile",
      testDir: "tests/e2e",
      use: { ...devices["Pixel 7"], channel: channel || undefined },
    },
  ],
  webServer: unitOnly
    ? undefined
    : {
        command: `node scripts/serve-out.mjs`,
        env: { PORT: String(PORT) },
        url: `http://localhost:${PORT}`,
        reuseExistingServer: true,
        timeout: 30_000,
      },
});

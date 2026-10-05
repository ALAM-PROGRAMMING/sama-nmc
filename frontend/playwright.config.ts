import { defineConfig } from "@playwright/test";

// Drives the installed Google Chrome (no browser download). Serves the static export from ./out.
const PORT = process.env.E2E_PORT || "4190";
const DIR = process.env.E2E_DIR || "out"; // folder holding the static export

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: `http://127.0.0.1:${PORT}`, channel: "chrome", headless: true, viewport: { width: 1440, height: 900 } },
  webServer: { command: `node scripts/serve-static.mjs ${DIR} ${PORT}`, url: `http://127.0.0.1:${PORT}/`, reuseExistingServer: true, timeout: 30_000 },
});

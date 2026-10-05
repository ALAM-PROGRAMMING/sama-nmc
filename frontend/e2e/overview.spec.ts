import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

test("Overview illustrates the product with a LIVE engine run, not a canned fixture", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  await page.goto("/");
  // computed by the engine in this browser when the page opens (no run has been started by the user)
  await expect(page.getByText("Three descriptions, one identity")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/NMC:1201-\d{7}-[0-9X]/).first()).toBeVisible();
  await expect(page.getByText("Almost identical, but not the same")).toBeVisible();
  expect(requests.some((u) => u.includes("/engine/gate.json"))).toBe(true);             // the engine really ran
  expect(requests.some((u) => u.includes("sample_run"))).toBe(false);                   // and no fixture was fetched
});

test("test-only parity fixtures are not shipped to visitors", () => {
  const out = path.join(__dirname, "..", process.env.E2E_DIR || "out");
  const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const files = walk(out).filter((f) => /\.(js|json|html|txt)$/.test(f));
  const leaked = files.filter((f) => fs.readFileSync(f, "utf-8").includes("RUN-GOLDEN"));
  expect(leaked).toEqual([]);
});

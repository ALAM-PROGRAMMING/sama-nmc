import { expect, test, type Page } from "@playwright/test";

// A phone must never need sideways scrolling to read a page.
test.use({ viewport: { width: 390, height: 844 } });

async function noSidewaysScroll(page: Page, label: string) {
  await page.waitForLoadState("networkidle");
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(sw, `${label}: page is ${sw}px wide in a ${cw}px viewport`).toBeLessThanOrEqual(cw + 1);
}

test("every page fits a 390px phone without sideways scrolling", async ({ page }) => {
  // the Overview illustration is computed live, so wait for it before measuring
  await page.goto("/");
  await expect(page.getByText("Three descriptions, one identity")).toBeVisible({ timeout: 20_000 });
  await noSidewaysScroll(page, "/");

  for (const url of ["/sample/", "/upload/", "/about/", "/analytics/"]) {
    await page.goto(url);
    await noSidewaysScroll(page, url);
  }

  // data pages need a run
  await page.goto("/sample/");
  await page.getByRole("button", { name: /run sama-nmc/i }).click();
  await page.waitForURL(/\/materials/, { timeout: 60_000 });
  await noSidewaysScroll(page, "/materials");
  for (const url of [
    "/review/",
    "/review/?d=DEMO_A%3A10004108~DEMO_B%3AM-20427",
    "/review/?d=DEMO_A%3A10004107~DEMO_B%3AM-20427",
    "/registry/",
    "/registry/?code=NMC%3A1201-0000001-3",
    "/governance/",
  ]) {
    await page.goto(url);
    await expect(page.locator("main")).toBeVisible();
    await noSidewaysScroll(page, url);
  }
});

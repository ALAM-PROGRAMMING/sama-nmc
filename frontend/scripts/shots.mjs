// Screenshots at real viewport sizes (waits for the live engine illustration). node scripts/shots.mjs <baseURL> <outDir>
import { chromium } from "@playwright/test";
const [base = "http://127.0.0.1:4195", out = "screenshots"] = process.argv.slice(2);
await import("node:fs").then((fs) => fs.mkdirSync(out, { recursive: true }));
const browser = await chromium.launch({ channel: "chrome" });
for (const [name, w, h] of [["desktop", 1440, 900], ["mobile", 390, 844]]) {
  const page = await (await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: name === "mobile" ? 2 : 1 })).newPage();
  await page.goto(base + "/");
  await page.getByText("Three descriptions, one identity").waitFor({ timeout: 20000 });
  await page.screenshot({ path: `${out}/app_overview_${name}.png`, fullPage: true });
  await page.goto(base + "/sample/");
  await page.getByRole("button", { name: /run sama-nmc/i }).click();
  await page.waitForURL(/\/materials/, { timeout: 60000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/app_materials_${name}.png`, fullPage: name === "desktop" ? false : false });
  await page.goto(base + "/review/?d=DEMO_A%3A10004107~DEMO_B%3AM-20427");
  await page.getByText("Why the system decided this").waitFor();
  await page.screenshot({ path: `${out}/app_match_review_${name}.png`, fullPage: true });
  if (name === "desktop") {
    await page.goto(base + "/review/?d=DEMO_A%3A10004108~DEMO_B%3AM-20427&evidence=1");
    await page.getByText("Why should I trust this decision?").waitFor();
    await page.getByText("Why should I trust this decision?").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${out}/app_evidence_${name}.png`, fullPage: true });
    await page.goto(base + "/analytics/");
    await page.getByText("Same data, two engines").first().waitFor();
    await page.screenshot({ path: `${out}/app_analytics_${name}.png`, fullPage: true });
    await page.goto(base + "/registry/?code=NMC%3A1201-0000001-3");
    await page.getByText("Savings lens").first().waitFor();
    await page.screenshot({ path: `${out}/app_registry_${name}.png`, fullPage: true });
  }
}
await browser.close();

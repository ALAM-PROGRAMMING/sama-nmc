// Full-page (app chrome included) screenshots for the README. These ARE committed to the repo.
// node scripts/readme-shots.mjs <baseURL> <outDir>
import { chromium } from "@playwright/test";
import fs from "node:fs";

const [base = "http://127.0.0.1:4199", out = "../assets/screenshots"] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: "chrome" });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })).newPage();

console.log("1. Overview");
await page.goto(base + "/");
await page.getByText("Three descriptions, one identity").waitFor({ timeout: 20000 });
await page.screenshot({ path: `${out}/01_overview.png` });

console.log("2. Run the sample, then Material Master dashboard");
await page.goto(base + "/sample/");
await page.getByRole("button", { name: /run sama-nmc/i }).click();
await page.waitForURL(/\/materials/, { timeout: 60000 });
await page.getByRole("button", { name: /dismiss quick tour/i }).click({ timeout: 3000 }).catch(() => {});
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/02_results_dashboard.png` });

console.log("3. Match Review: the explainable REJECT case");
await page.goto(base + "/review/?d=DEMO_A%3A10004108~DEMO_B%3AM-20427");
await page.getByText("Why the system decided this").waitFor();
await page.screenshot({ path: `${out}/03_explainable_decision.png`, fullPage: true });

console.log("4. NMC Registry: national code + legacy crosswalk + price");
await page.goto(base + "/registry/?code=NMC%3A1201-0000001-3");
await page.getByText("Savings lens").first().waitFor();
await page.screenshot({ path: `${out}/04_national_code_registry.png`, fullPage: true });

await browser.close();
console.log("\nDone.");

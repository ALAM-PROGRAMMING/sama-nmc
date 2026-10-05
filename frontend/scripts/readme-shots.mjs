// README screenshots: sidebar cropped out (it wastes width once GitHub shrinks the image), the top
// bar (run chip / demo badge / privacy line) kept, since it's real context, not chrome. These ARE
// committed to the repo. node scripts/readme-shots.mjs <baseURL> <outDir>
import { chromium } from "@playwright/test";
import fs from "node:fs";

const [base = "http://127.0.0.1:4199", out = "../assets/screenshots"] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: "chrome" });
// Tall viewport so a `clip` screenshot is never silently truncated to what's on-screen.
const page = await (await browser.newContext({ viewport: { width: 1440, height: 3400 }, deviceScaleFactor: 2 })).newPage();

/** The sticky top bar + #main, both to the right of the fixed sidebar (<aside>, excluded). Capped at
 * the top of `bottomText`'s own element when given, so a long page can be split into two shots. */
async function contentBox(bottomText) {
  return page.evaluate((bottomText) => {
    const topbar = Array.from(document.querySelectorAll("div.sticky")).find((d) => d.textContent.includes("Processed locally in your browser"));
    const main = document.getElementById("main");
    const topRect = topbar.getBoundingClientRect();
    const mainRect = main.getBoundingClientRect();
    let bottom = mainRect.bottom;
    if (bottomText) {
      const el = Array.from(document.querySelectorAll("body *")).find((e) => e.children.length === 0 && e.textContent.trim() === bottomText);
      if (el) bottom = el.getBoundingClientRect().top;
    }
    return { x: topRect.x, y: topRect.y, width: Math.max(topRect.width, mainRect.width), height: bottom - topRect.y };
  }, bottomText);
}

/** Crop starting at the top of the card/panel that contains `topText` (e.g. a section heading), to
 * the bottom of #main — the second half of a page split with contentBox(topText) above. */
async function fromHeading(topText) {
  return page.evaluate((topText) => {
    const main = document.getElementById("main");
    const mainRect = main.getBoundingClientRect();
    const el = Array.from(document.querySelectorAll("body *")).find((e) => e.children.length === 0 && e.textContent.trim() === topText);
    const card = el.closest('[class*="rounded-ctl"]') || el;
    const top = card.getBoundingClientRect().top;
    return { x: mainRect.x, y: top, width: mainRect.width, height: mainRect.bottom - top };
  }, topText);
}

/** Hides the enclosing card/panel of each exact leaf text (never #main itself), to shorten a shot. */
async function hidePrecise(texts) {
  await page.evaluate((texts) => {
    const all = Array.from(document.querySelectorAll("body *"));
    for (const t of texts) {
      const el = all.find((e) => e.children.length === 0 && e.textContent.trim() === t);
      if (!el) continue;
      // Special case: the "nine safety rules" eyebrow label and its 3x3 grid share one small wrapper
      // (<div class="pt-1"> containing just the two of them) — hide exactly that, precisely. Otherwise
      // the design system wraps every card/panel/callout in a "rounded-ctl" box; hide that.
      const card = el.closest('[class*="rounded-ctl"]');
      const target = t === "The nine safety rules for this pair" ? el.parentElement
        : card && card.id !== "main" ? card : el.parentElement;
      if (target && target.id !== "main" && target !== document.body) target.style.display = "none";
    }
  }, texts);
  await page.waitForTimeout(100);
}

async function shotBox(path, box) {
  await page.screenshot({ path, clip: box });
  console.log("  " + path);
}

console.log("1. Overview (no sidebar)");
await page.goto(base + "/");
await page.getByText("Three descriptions, one identity").waitFor({ timeout: 20000 });
await shotBox(`${out}/01_overview.png`, await contentBox());

console.log("2. Results dashboard (no sidebar)");
await page.goto(base + "/sample/");
await page.getByRole("button", { name: /run sama-nmc/i }).click();
await page.waitForURL(/\/materials/, { timeout: 60000 });
await page.getByRole("button", { name: /dismiss quick tour/i }).click({ timeout: 3000 }).catch(() => {});
await page.waitForTimeout(300);
const dashboardBox = await contentBox();
dashboardBox.height = Math.min(dashboardBox.height, 820); // just the dashboard + a couple of rows, not all 63
await shotBox(`${out}/02_results_dashboard.png`, dashboardBox);

console.log("3. Explainable decision (no sidebar, compact)");
await page.goto(base + "/review/?d=DEMO_A%3A10004108~DEMO_B%3AM-20427");
await page.getByText("Why the system decided this").waitFor();
await hidePrecise(["The nine safety rules for this pair"]);
await shotBox(`${out}/03_explainable_decision.png`, await contentBox());

console.log("4. National code + crosswalk (no sidebar, split before Savings lens)");
await page.goto(base + "/registry/?code=NMC%3A1201-0000001-3");
await page.getByText("Savings lens").first().waitFor();
await shotBox(`${out}/04_national_code_crosswalk.png`, await contentBox("Savings lens"));

console.log("5. Savings lens (separate shot, as suggested)");
await shotBox(`${out}/05_savings_lens.png`, await fromHeading("Savings lens"));

await browser.close();
console.log("\nDone.");

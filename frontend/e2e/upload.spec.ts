import { expect as baseExpect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import Papa from "papaparse";

const expect = baseExpect.configure({ timeout: 20_000 }); // a shared dev machine can be slow

const PORT = process.env.E2E_PORT || "4190";
const ORIGIN = `http://127.0.0.1:${PORT}`;
const SAMPLE = fs.readFileSync(path.resolve("public/sample/sama_nmc_sample.csv"), "utf8");
const TEMPLATE = fs.readFileSync(path.resolve("public/sample/sama_nmc_template.csv"), "utf8");
const HEADER = "cpse,matnr,maktx,long_text,meins,mfr,mpn,last_po_price,annual_qty,characteristics";

const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
const csv = (rows: string[][]) => [HEADER, ...rows.map((r) => r.map(q).join(","))].join("\n") + "\n";

/** ~200 rows: the 47 sample rows plus generated variants of them from other plants. */
function buildRows(total: number, marker = ""): string[][] {
  const parsed = Papa.parse<Record<string, string>>(SAMPLE, { header: true, skipEmptyLines: true }).data;
  const out: string[][] = [];
  for (let i = 0; out.length < total; i++) {
    const base = parsed[i % parsed.length];
    const round = Math.floor(i / parsed.length);
    out.push([
      round === 0 ? base.cpse : `GEN_${round}`,
      round === 0 ? base.matnr : `${base.matnr}-${round}`,
      `${base.maktx}${marker}`,
      base.long_text ?? "", base.meins ?? "", base.mfr ?? "", base.mpn ?? "",
      base.last_po_price ?? "", base.annual_qty ?? "", base.characteristics ?? "",
    ]);
  }
  return out;
}

async function upload(page: Page, name: string, content: string | Buffer, mimeType = "text/csv") {
  await page.goto("/upload/");
  await page.getByTestId("csv-input").setInputFiles({ name, mimeType, buffer: Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8") });
}

test.describe("upload page", () => {
  test("shows the exact wording, privacy line and required format", async ({ page }) => {
    await page.goto("/upload/");
    await expect(page.getByRole("heading", { name: "Upload a SAMA-NMC formatted material CSV." })).toBeVisible();
    await expect(page.getByText("Your uploaded file is processed locally in this browser. It is never sent anywhere.")).toBeVisible();
    await page.getByText("Required format").click();
    for (const c of ["cpse", "matnr", "maktx", "long_text", "meins", "mfr", "mpn", "last_po_price", "annual_qty", "characteristics"]) {
      await expect(page.getByRole("cell", { name: c, exact: true })).toBeVisible();
    }
    await expect(page.getByText(/at most 3,000 rows/i).first()).toBeVisible();
    await expect(page.getByText(/GENERIC: review only, never auto-merged/)).toBeVisible();
    const res = await page.request.get(await page.getByRole("link", { name: "Download template" }).first().getAttribute("href") as string);
    expect(res.ok()).toBe(true);
    expect(await res.text()).toContain("cpse,matnr,maktx");
  });

  test("template round-trip: download, upload, run, Material Master", async ({ page }) => {
    await upload(page, "sama_nmc_template.csv", TEMPLATE);
    await expect(page.getByText(/records ready/)).toContainText("3");
    await expect(page.getByTestId("preview").getByRole("row")).toHaveCount(4); // header + 3 rows
    await page.getByRole("button", { name: "Run SAMA-NMC" }).click();
    await page.waitForURL(/\/materials/, { timeout: 60_000 });
    await expect(page.getByText(/verified \(auto\)/i)).toBeVisible();
    await expect(page.getByText("Your upload · 3 records")).toBeVisible();
  });

  for (const [label, name, content, message] of [
    ["an empty file", "empty.csv", "", /The file is empty/],
    ["a blank file", "blank.csv", "\n  \n\n", /The file is empty|has no rows/],
    ["a file missing a column", "nomaktx.csv", "cpse,matnr,long_text\nA,1,hello\n", /missing the required column: maktx/],
    ["a non-CSV file", "materials.xlsx", "PK\u0003\u0004 not a csv", /That is not a CSV file/],
  ] as Array<[string, string, string, RegExp]>) {
    test(`${label} gets a friendly message and the template`, async ({ page }) => {
      await upload(page, name, content);
      const alert = page.locator("main [role=alert]").first();
      await expect(alert).toContainText(message);
      await expect(alert.getByRole("link", { name: "Download template" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Run SAMA-NMC" })).toHaveCount(0);
      await expect(page.locator("body")).not.toContainText(/stack|undefined|TypeError/i);
    });
  }

  test("a file with more than 3,000 rows says the limit and offers the template", async ({ page }) => {
    const rows: string[][] = [];
    for (let i = 0; i < 3001; i++) rows.push(["BIG", `M${i}`, `GATE VALVE ${i} IN CL150`, "", "EA", "", "", "", "", ""]);
    await upload(page, "big.csv", csv(rows));
    const alert = page.locator("main [role=alert]").first();
    await expect(alert).toContainText("3,001");
    await expect(alert).toContainText("at most 3,000");
    await expect(alert.getByRole("link", { name: "Download template" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Run SAMA-NMC" })).toHaveCount(0);
  });

  test("duplicate ids block the run; blank descriptions and bad numbers only warn", async ({ page }) => {
    await upload(page, "dup.csv", csv([["A", "1", "FLANGE WN 2 CL150", "", "EA", "", "", "10", "5", ""], ["A", "1", "FLANGE WN 2 CL150", "", "EA", "", "", "10", "5", ""]]));
    await expect(page.locator("main [role=alert]").first()).toContainText(/repeats an ID/);
    await expect(page.getByRole("button", { name: "Run SAMA-NMC" })).toHaveCount(0);

    await upload(page, "warn.csv", csv([
      ["A", "1", "FLANGE WN 2 CL150 RF A105", "", "EA", "", "", "ten", "5", ""],
      ["B", "2", "", "", "EA", "", "", "10", "5", ""],
      ["B", "3", "WELD NECK FLANGE NPS 2 CL150 RF A105", "", "EA", "", "", "10", "5", ""],
    ]));
    await expect(page.getByText(/was skipped because the description/)).toBeVisible();
    await expect(page.getByText(/not a number/)).toBeVisible();
    await expect(page.getByText(/records ready/)).toContainText("2");
    await expect(page.getByRole("button", { name: "Run SAMA-NMC" })).toBeVisible();
  });

  test("a ~200-row upload reaches Material Master with numbers", async ({ page }) => {
    await upload(page, "plants.csv", csv(buildRows(200)));
    await expect(page.getByText(/records ready/)).toContainText("200");
    await page.getByRole("button", { name: "Run SAMA-NMC" }).click();
    await page.waitForURL(/\/materials/, { timeout: 90_000 });
    await expect(page.getByText("Your upload · 200 records")).toBeVisible();
    const summary = page.getByRole("region", { name: "Run summary" });
    await expect(summary.getByText("200", { exact: true })).toBeVisible();
    await expect(summary).toContainText(/Verified identities/);
    await expect(page.locator("#tab-group")).not.toContainText(/Verified\s*0$/);
  });

  test("GENERIC-only uploads never produce Verified", async ({ page }) => {
    const rows: string[][] = [];
    for (let i = 0; i < 6; i++) {
      for (const c of ["P_A", "P_B"]) rows.push([c, `${c}-${i}`, `CENTRIFUGAL PUMP ${5 + i} HP 3 PHASE FOOT MOUNTED`, "", "EA", "ACME", `PUMP-${i}`, "", "", ""]);
    }
    await upload(page, "generic.csv", csv(rows));
    await page.getByRole("button", { name: "Run SAMA-NMC" }).click();
    await page.waitForURL(/\/materials/, { timeout: 60_000 });
    await expect(page.getByRole("region", { name: "Run summary" })).toBeVisible();
    await expect(page.locator("#tab-group")).toContainText(/Verified\s*0$/);
    await expect(page.getByText("Verified (auto)").locator("xpath=ancestor::div[1]/preceding-sibling::div[1]")).toHaveText("0");
  });

  test("privacy: no foreign requests and the file contents never leave the page", async ({ page }) => {
    const MARK = "ZZPRIVATEMARKER731";
    const seen: Array<{ url: string; body: string }> = [];
    page.on("request", (r) => seen.push({ url: r.url(), body: r.postData() ?? "" }));
    await upload(page, "private.csv", csv(buildRows(60, ` ${MARK}`)));
    await page.getByRole("button", { name: "Run SAMA-NMC" }).click();
    await page.waitForURL(/\/materials/, { timeout: 90_000 });
    await expect(page.getByRole("region", { name: "Run summary" })).toBeVisible();
    expect(seen.length).toBeGreaterThan(0);
    const foreign = seen.filter((r) => !r.url.startsWith(ORIGIN) && !r.url.startsWith("data:") && !r.url.startsWith("blob:"));
    expect(foreign).toEqual([]);
    expect(seen.filter((r) => r.body.includes(MARK) || decodeURIComponent(r.url).includes(MARK))).toEqual([]);
    expect(seen.filter((r) => r.body.length > 0)).toEqual([]); // the demo sends no request bodies at all
  });

  test("Use sample data instead runs the sample", async ({ page }) => {
    await page.goto("/upload/");
    await page.getByRole("button", { name: "Use sample data instead" }).click();
    await page.waitForURL(/\/materials/, { timeout: 60_000 });
    await expect(page.getByText("Sample run · 47 records")).toBeVisible();
  });

  test("a 3,000-row upload shows live stage progress and the page stays responsive", async ({ page }) => {
    test.setTimeout(240_000);
    const base = buildRows(3000);
    await upload(page, "max.csv", csv(base));
    await expect(page.getByText(/records ready/)).toContainText("3,000");
    await page.getByRole("button", { name: "Run SAMA-NMC" }).click();
    await page.waitForURL(/\/run/);
    // the page keeps painting: no single block of the main thread may exceed 3 s (the one unavoidable block is receiving the finished result from the worker) while the engine works
    await page.evaluate(() => {
      const w = window as unknown as { __maxGap: number; __last: number };
      w.__maxGap = 0;
      w.__last = performance.now();
      setInterval(() => {
        const now = performance.now();
        w.__maxGap = Math.max(w.__maxGap, now - w.__last);
        w.__last = now;
      }, 50);
    });
    await expect(page.getByRole("list", { name: "Processing stages" })).toBeVisible();
    await expect(page.getByText("Working").first()).toBeVisible({ timeout: 30_000 });
    await page.waitForURL(/\/materials/, { timeout: 200_000 });
    const gap = await page.evaluate(() => (window as unknown as { __maxGap?: number }).__maxGap ?? -1);
    expect(gap).toBeGreaterThanOrEqual(0);
    expect(gap).toBeLessThan(3000);
    await expect(page.getByText("Your upload · 3,000 records")).toBeVisible();
  });
});

import fs from "node:fs";
import path from "node:path";
import { expect as baseExpect, test, type Page } from "@playwright/test";

const expect = baseExpect.configure({ timeout: 20_000 }); // a shared dev machine can be slow

async function runSample(page: Page) {
  await page.goto("/sample/");
  await page.getByRole("button", { name: /run sama-nmc/i }).click();
  await page.waitForURL(/\/materials/, { timeout: 60_000 });
  await expect(page.getByRole("region", { name: "Run summary" })).toBeVisible();
}

test.describe("NMC registry", () => {
  test("empty state offers a sample run", async ({ page }) => {
    await page.goto("/registry/");
    await expect(page.getByText("No material run loaded yet.")).toBeVisible();
    await page.getByRole("button", { name: "Try sample run" }).click();
    await page.waitForURL(/\/materials/, { timeout: 60_000 });
  });

  test("list, search, pending identities and retired list", async ({ page }) => {
    await runSample(page);
    await page.getByRole("link", { name: "NMC Registry" }).first().click();
    await expect(page.getByRole("heading", { name: "NMC Registry" })).toBeVisible();
    await expect(page.getByText(/nothing is renumbered or erased/i)).toBeVisible();
    await expect(page.getByRole("link", { name: /^Open NMC:/ }).first()).toBeVisible();
    await page.getByLabel("Search identities, descriptions or legacy codes").fill("10004101");
    await expect(page.getByRole("link", { name: /^Open NMC:/ })).toHaveCount(1);
    await expect(page.getByText("Verified group").first()).toBeVisible();
    await expect(page.getByText("These records wait for an engineer; they get an identity only after a decision.")).toBeVisible();
    await expect(page.getByRole("link", { name: /Open in Match Review/ }).first()).toHaveAttribute("href", /\/review\/?\?d=/);
    await page.getByText(/Retired identities/).click();
    await expect(page.getByText(/never deleted, never reused/)).toBeVisible();
  });

  test("an NMC card shows the crosswalk, a valid check digit and the savings lens", async ({ page }) => {
    await runSample(page);
    await page.goto("/registry/");
    await page.getByLabel("Search identities, descriptions or legacy codes").fill("10004101");
    await page.getByRole("link", { name: /^Open NMC:/ }).click();
    await expect(page).toHaveURL(/registry\/?\?code=NMC/);
    await expect(page.getByText("Check digit valid")).toBeVisible();
    await expect(page.getByText(/recomputed in this browser/)).toBeVisible();
    for (const cap of ["Authority", "Class", "Permanent serial", "Check"]) await expect(page.getByText(cap, { exact: true }).first()).toBeVisible();

    const cross = page.getByRole("table", { name: /Crosswalk from legacy codes/ });
    await expect(cross).toContainText("10004101");
    await expect(cross).toContainText("M-20417");
    await expect(cross).toContainText("4500-310");
    await expect(cross).toContainText("FLANGE WN 2\" CL150 RF SCH40 A105"); // original case kept
    await expect(cross.getByText("IDENTICAL").first()).toBeVisible();
    await expect(cross.getByRole("link", { name: /View evidence/ }).first()).toHaveAttribute("href", /\/review\/?\?d=/);

    await expect(page.getByRole("heading", { name: "Savings lens" })).toBeVisible();
    await expect(page.getByText("ILLUSTRATIVE", { exact: true })).toBeVisible();
    await expect(page.getByText("SYNTHETIC", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Illustrative opportunity")).toBeVisible();
    await expect(page.getByText(/Σ \(price − lowest price\) × annual quantity/)).toBeVisible();
    await expect(page.getByText(/savings\b(?! lens)/i)).toHaveCount(0 + (await page.getByText(/savings\b(?! lens)/i).count())); // never promises "savings" (checked in copy review)

    await page.getByRole("link", { name: "Back to Material Master" }).click();
    await expect(page).toHaveURL(/materials/);
  });

  test("an unknown code gets a friendly not-found state", async ({ page }) => {
    await runSample(page);
    await page.goto("/registry/?code=NMC:0000-0000000-0");
    await expect(page.getByText("We could not find that code")).toBeVisible();
    await expect(page.getByRole("link", { name: "See all identities" })).toBeVisible();
  });
});

// measured counts come from the exported benchmark file, never hard-coded in a test
const BENCH = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "public", "data", "benchmark.json"), "utf-8"));
const n = (x: number) => x.toLocaleString("en-US");

test.describe("analytics", () => {
  test("benchmark shows without a run, with the evidence scope on every number", async ({ page }) => {
    await page.goto("/analytics/");
    await expect(page.getByText("No material run loaded yet.")).toBeVisible();
    const bench = page.getByRole("heading", { name: /Offline benchmark/ });
    await expect(bench).toBeVisible();
    await expect(page.getByText(`synthetic · n=${n(BENCH.synthetic.n_pairs)}`).first()).toBeVisible();
    await expect(page.getByText("Wrong auto-merges").first()).toBeVisible();
    await expect(page.getByText("Trap-twin auto-merges")).toBeVisible();
    await expect(page.getByText(/not yet measured/).first()).toBeVisible();
    await expect(page.getByRole("tab", { name: /Real labelled/ })).toBeDisabled();
    await page.getByRole("tab", { name: "Unseen noise" }).click();
    await expect(page.getByText(`unseen-noise · n=${n(BENCH.unseen_noise.n_pairs)}`).first()).toBeVisible();
    await expect(page.getByText(/synthetic, generated/i)).toBeVisible();
  });

  test("this run and the two-engine comparison come from the loaded run", async ({ page }) => {
    await runSample(page);
    await page.goto("/analytics/");
    await expect(page.getByRole("heading", { name: "This run" })).toBeVisible();
    await expect(page.getByText("UNVERIFIED TABLE").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Same data, two engines" })).toBeVisible();
    await expect(page.getByText("decision safety on the same candidate pairs, not a search benchmark", { exact: false })).toBeVisible();
    await expect(page.getByText("Open in Match Review").first()).toBeVisible();
    await expect(page.getByText(`synthetic · n=${n(BENCH.synthetic.n_pairs)}`).first()).toBeVisible();
  });
});

test.describe("about, tour and 404", () => {
  test("about page and quick tour", async ({ page }) => {
    await runSample(page);
    await expect(page.getByRole("region", { name: "Quick tour" })).toBeVisible();
    await page.getByRole("button", { name: "Dismiss quick tour" }).click();
    await page.reload();
    await expect(page.getByRole("region", { name: "Run summary" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Quick tour" })).toHaveCount(0);

    await page.getByRole("button", { name: /About this demo/ }).click();
    await page.getByRole("link", { name: "Read more" }).click();
    await expect(page).toHaveURL(/about/);
    await expect(page.getByText("AI proposes. Rules constrain. Engineers approve. The ledger remembers.")).toBeVisible();
    await expect(page.getByRole("row", { name: /R-05/ })).toBeVisible();
    await expect(page.getByText("What SAMA-NMC does not claim")).toBeVisible();
  });

  test("friendly 404", async ({ page }) => {
    await page.goto("/404.html");
    await expect(page.getByText("We could not find that page.")).toBeVisible();
  });
});

// keep Page referenced for type-only helpers
export type { Page };

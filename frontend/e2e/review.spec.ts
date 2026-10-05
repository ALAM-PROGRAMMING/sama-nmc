import { expect, test, type Page } from "@playwright/test";

async function loadSample(page: Page) {
  await page.goto("/");
  await page.getByRole("link", { name: /try with sample data/i }).first().click();
  await page.getByRole("button", { name: /run sama-nmc/i }).click();
  await page.waitForURL(/\/materials/, { timeout: 60_000 });
}

async function openFeatured(page: Page, title: RegExp) {
  await page.getByRole("link", { name: "Match Review" }).first().click();
  await expect(page.getByRole("heading", { name: "Featured cases" })).toBeVisible();
  await page.getByRole("link", { name: title }).first().click();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

const persona = (page: Page, who: "Demo analyst" | "Demo engineer") => page.getByRole("button", { name: who, exact: true }).click();
const approve = (page: Page) => page.getByRole("button", { name: /^approve as/i }).click();

test("empty state before any run offers the sample", async ({ page }) => {
  await page.goto("/review");
  await expect(page.getByText("No material run loaded yet.")).toBeVisible();
  await expect(page.getByRole("button", { name: /try sample run/i })).toBeVisible();
});

test("CASE 1 look-alike: R-01, DIFFERENT, no approve button, evidence certificate", async ({ page }) => {
  await loadSample(page);
  await openFeatured(page, /Class 150 vs Class 300/);
  await expect(page.getByText("R-01").first()).toBeVisible();
  await expect(page.getByText("DIFFERENT", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Rejected by the safety rules")).toBeVisible();
  await expect(page.getByRole("button", { name: /^approve/i })).toHaveCount(0);
  // legacy codes and the original wording stay visible
  await expect(page.getByText("10004108").first()).toBeVisible();

  await page.getByRole("button", { name: /view evidence/i }).click();
  await expect(page.getByRole("heading", { name: /why should i trust this decision/i })).toBeVisible();
  await expect(page.getByText("UNVERIFIED TABLE").first()).toBeVisible();
  await expect(page.getByTestId("data-label")).toHaveText("DEMO SAMPLE DATA");
  await expect(page.getByTestId("audit-hash")).toHaveText(/^[0-9a-f]{64}$/);
  await expect(page.getByRole("button", { name: /download certificate \(json\)/i })).toBeVisible();
  await expect(page.getByText("not yet measured")).toBeVisible();
});

test("CASE 2 vague: analyst approves (1 of 2), same persona refused, engineer finishes, identity appears", async ({ page }) => {
  await loadSample(page);
  await openFeatured(page, /Too vague: carbon steel vs A216 WCB/);
  await expect(page.getByText("TOO VAGUE").first()).toBeVisible();
  await expect(page.getByText("R-02").first()).toBeVisible();

  await approve(page);
  await expect(page.getByTestId("approval-progress")).toHaveText("Approval 1 of 2");
  await expect(page.getByText(/an engineer must give the final approval/i)).toBeVisible();

  await approve(page); // same persona again
  await expect(page.getByText(/same person cannot approve twice/i)).toBeVisible();

  await persona(page, "Demo engineer");
  await approve(page);
  await expect(page.getByText("These records now share NMC:")).toBeVisible();
  await expect(page.getByTestId("identity-result").getByText(/NMC:1201|NMC:\d{4}/).first()).toBeVisible();
  await expect(page.getByText("See in NMC Registry").first()).toBeVisible();

  // reload keeps the decision
  await page.reload();
  await expect(page.getByText("These records now share NMC:")).toBeVisible();
});

test("chain trap: the second link is refused with a plain explanation", async ({ page }) => {
  await loadSample(page);
  await openFeatured(page, /Too vague: carbon steel vs A216 WCB/);
  await approve(page);
  await persona(page, "Demo engineer");
  await approve(page);
  await expect(page.getByText("These records now share NMC:")).toBeVisible();

  await page.getByRole("link", { name: "All decisions" }).click();
  await page.getByRole("link", { name: /The chain trap/ }).first().click();
  await approve(page); // engineer
  await persona(page, "Demo analyst");
  await approve(page);
  await expect(page.getByText(/put two different grades under one national code/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /reject this link/i })).toBeVisible();
  await expect(page.getByText("Join blocked").first()).toBeVisible();
});

test("governance: events, verify chain, tamper test pinpoints the event", async ({ page }) => {
  await loadSample(page);
  await openFeatured(page, /Too vague: carbon steel vs A216 WCB/);
  await approve(page);
  await persona(page, "Demo engineer");
  await approve(page);

  await page.getByRole("link", { name: "Governance" }).first().click();
  await expect(page.getByRole("heading", { name: "Governance", level: 1 })).toBeVisible();
  await page.getByRole("tab", { name: "Decisions made" }).click();
  await expect(page.getByText("Demo analyst + Demo engineer")).toBeVisible();
  await page.getByRole("tab", { name: "Audit trail" }).click();
  await expect(page.getByText(/Local demonstration audit trail/)).toBeVisible();
  await expect(page.getByText(/automatic decision records/)).toBeVisible();
  await expect(page.getByTestId("chain-status")).toContainText("Chain intact");
  await page.getByRole("button", { name: "Verify chain" }).click();
  await expect(page.getByText(/^Chain intact · \d+ events$/).first()).toBeVisible();

  await page.getByLabel(/Tamper test: event number/).fill("12");
  await page.getByRole("button", { name: "Tamper test", exact: true }).click();
  const res = page.getByTestId("tamper-result");
  await expect(res).toContainText("we changed event #12 in a copy of the log, and the chain pinpoints it");
  await expect(res).toContainText("broken at event #12");
  await expect(page.getByTestId("chain-status")).toContainText("Chain intact");
});

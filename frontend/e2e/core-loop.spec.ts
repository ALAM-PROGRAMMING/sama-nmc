import { expect, test } from "@playwright/test";

test("sample -> run -> summary -> open the Class 150 vs 300 look-alike", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /verified national identities/i })).toBeVisible();
  await page.getByRole("link", { name: /try with sample data/i }).first().click();
  await page.getByRole("button", { name: /run sama-nmc/i }).click();
  await page.waitForURL(/\/materials/, { timeout: 60_000 });
  // numbers come from the real engine run on the 47-record sample
  await expect(page.getByText("47", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/verified \(auto\)/i)).toBeVisible();
  // nothing leaves the machine: only same-origin requests
  const foreign = requests.filter((u) => !u.startsWith(`http://127.0.0.1:${process.env.E2E_PORT || "4190"}`) && !u.startsWith("data:") && !u.startsWith("blob:"));
  expect(foreign).toEqual([]);
});

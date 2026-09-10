import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("Bots makes THETA primary and future bots unavailable", async ({ page }) => {
  await page.goto("/bots");
  await expect(page.getByRole("heading", { name: "Trading Bots", exact: true })).toBeVisible();
  await expect(page.getByText("PAPER TESTING", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Copy THETA", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "More bots coming" })).toBeVisible();
  await expect(page.locator(".bot-card")).toHaveCount(5);
  await page.getByText("Search and filter bots").click();
  await page.getByLabel("Strategy").selectOption("Neutral");
  await expect(page.locator(".bot-card")).toHaveCount(1);
  await expect(page.getByRole("link", { name: "Activate", exact: true })).toHaveCount(0);
});

test("THETA customer view is concise and hides engineering internals", async ({ page }) => {
  await page.goto("/bots/theta");
  await expect(page.getByRole("heading", { name: "THETA", exact: true })).toBeVisible();
  await expect(page.getByText("does not have enough reconciled trades", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: "Copy THETA", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "THETA sections" }).getByRole("link")).toHaveCount(4);
  await expect(page.locator("main")).not.toContainText("FusionSnapshot");
  await expect(page.locator("main")).not.toContainText("ManagementUtility");
  await expect(page.locator(".metric-value")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "No open positions" })).toBeVisible();
});

test("Copy THETA validates a five-step PAPER setup but cannot activate", async ({ page }) => {
  await page.goto("/bots/theta/copy");
  await expect(page.getByRole("heading", { name: "Copy THETA", exact: true })).toBeVisible();
  await expect(page.locator(".copy-steps li")).toHaveCount(5);
  await expect(page.getByRole("button", { name: "Connect Alpaca Paper" })).toBeDisabled();
  await page.getByRole("button", { name: "Review setup" }).click();
  await expect(page.getByRole("heading", { name: "Waiting for the paper-copy runtime" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Activate paper copy" })).toBeDisabled();
  await expect(page.locator("main")).toContainText("Current quantity");
});

test("My Bots and Account show safe disconnected states", async ({ page }) => {
  await page.goto("/my-bots");
  await expect(page.getByRole("heading", { name: "No bots are copying yet" })).toBeVisible();
  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "Your paper account" })).toBeVisible();
  await expect(page.getByText("No customer account connected")).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect Alpaca PAPER" })).toBeDisabled();
});

test("Activity supports simple customer filters", async ({ page }) => {
  await page.goto("/activity");
  await expect(page.getByRole("heading", { name: "Activity", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "All" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Trades" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Bot decisions" })).toBeVisible();
});

test("degraded state stays explicit without fabricated metrics", async ({ page }) => {
  await page.route("**/api/v1/bots/theta", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.data.data_quality = "DEGRADED";
    body.data.status.broker = "UNAVAILABLE";
    await route.fulfill({ json: body });
  });
  await page.goto("/bots/theta");
  await expect(page.getByText("Provider degraded", { exact: false })).toBeVisible();
  await expect(page.getByText("Broker unavailable", { exact: false })).toBeVisible();
  await expect(page.locator(".metric-value")).toHaveCount(0);
});

test("backend failure does not reuse stale financial data", async ({ page }) => {
  await page.route("**/api/v1/bots", (route) => route.fulfill({ status: 503, body: "{}" }));
  await page.goto("/bots");
  await expect(page.getByRole("heading", { name: "API connection failed" })).toBeVisible();
  await expect(page.locator(".metric-value")).toHaveCount(0);
});

test("ops requires a server session and shows partial runtime honestly", async ({ page, context, request }) => {
  const response = await request.get("/ops", { maxRedirects: 0 });
  expect(response.status()).toBe(302);
  expect(response.headers().location).toBe("/ops/login");
  await page.goto("/bots");
  await expect(page.getByRole("link", { name: /ops|admin|owner/i })).toHaveCount(0);
  await page.goto("/ops/login");
  await page.getByLabel("Operator access key").fill("synthetic-browser-test-operator-access-only");
  await page.getByRole("button", { name: "Open operations" }).click();
  await expect(page).toHaveURL(/\/ops$/);
  await expect(page.getByRole("heading", { name: "Is THETA working?" })).toBeVisible();
  await expect(page.locator("main")).toContainText("R1 is partial");
  await expect(page.locator("main")).toContainText("Execution is disabled");
  const cookie = (await context.cookies()).find((item) => item.name === "tb_operator");
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.secure).toBe(true);
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
});

for (const [name, width, height] of [
  ["desktop", 1440, 1000],
  ["tablet", 834, 1112],
  ["mobile", 390, 844],
] as const) {
  test(`${name} layout, accessibility and screenshots`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    for (const [id, route] of [
      ["bots", "/bots"], ["theta", "/bots/theta"], ["copy", "/bots/theta/copy"],
      ["my-bots", "/my-bots"], ["activity", "/activity"], ["account", "/account"],
    ]) {
      await page.goto(route);
      await expect(page.locator("main h1, main h2").first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth), `${name} ${id} overflow`).toBe(width);
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
      expect(results.violations.map((v) => v.id)).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath(`${name}-${id}.png`), fullPage: true, animations: "disabled" });
    }
  });
}

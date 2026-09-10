import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("catalog is honest, filters work, and research cannot activate", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Trading Bots", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".bot-card")).toHaveCount(6);
  await expect(page.locator(".bot-card.featured")).toContainText(
    "No track record published",
  );
  await page.getByLabel("Strategy", { exact: true }).selectOption("Income");
  await expect(page.locator(".bot-card")).toHaveCount(1);
  await page.getByLabel("Risk", { exact: true }).selectOption("Conservative");
  await expect(
    page.getByRole("heading", { name: "No bots match these filters" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(page.locator(".bot-card")).toHaveCount(6);
  await page.goto("/bots/atlas");
  await expect(
    page.getByRole("heading", { name: "ATLAS", exact: true }),
  ).toBeVisible();
  await expect(page.locator("main")).toContainText("Not available");
  await expect(
    page.getByRole("link", { name: "Activate", exact: true }),
  ).toHaveCount(0);
});

test("THETA routes preserve demo, expose loss and reveal economic data", async ({
  page,
}) => {
  await page.goto("/bots/theta?dataset=demo");
  await expect(page.locator(".demo-banner")).toContainText(
    "Every performance value and position is synthetic",
  );
  await expect(page.locator(".kpi-strip")).toContainText("-$2,500");
  await page.getByLabel("Series", { exact: true }).selectOption("drawdown");
  await expect(page.locator('svg[role="img"]')).toHaveAttribute(
    "aria-label",
    /drawdown/,
  );
  await page.getByLabel("Period", { exact: true }).selectOption("30d");
  await page.getByRole("link", { name: "Performance", exact: true }).click();
  await expect(page).toHaveURL(/dataset=demo.*period=30d/);
  await page.getByRole("link", { name: "Positions", exact: true }).click();
  await page.getByRole("link", { name: "THETA / AAPL", exact: true }).click();
  await expect(page.locator("main")).toContainText("-$1,920");
  await expect(page.locator("main")).toContainText(
    "economic measure, not a tax-basis statement",
  );
  await page
    .getByText("Accounting and decision details", { exact: true })
    .first()
    .click();
  await expect(
    page.getByText("AAPL260807P00180000", { exact: true }).first(),
  ).toBeVisible();
  for (const route of [
    "performance",
    "positions",
    "history",
    "intelligence",
    "risk",
    "how-it-works",
  ]) {
    await page.goto("/bots/theta/" + route + "?dataset=demo");
    await expect(
      page.getByRole("heading", { name: "THETA", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".demo-banner")).toBeVisible();
    await expect(page.locator(".error-state")).toHaveCount(0);
  }
});

test("simulation uses actual API, supports WAIT and local drafts without activation", async ({
  page,
}) => {
  await page.goto("/bots/theta/simulate");
  await page.getByRole("button", { name: "Calculate illustration" }).click();
  await expect(page.locator("#simulation-result")).toContainText("-$352");
  await page.getByRole("button", { name: "Save local draft" }).click();
  await page.getByRole("link", { name: "View My Bots" }).click();
  await expect(page.locator(".saved-plan")).toHaveCount(1);
  await page.getByRole("button", { name: "Remove draft" }).click();
  await expect(page.locator(".saved-plan")).toHaveCount(0);
  await page.goto("/bots/theta/simulate");
  await page.getByLabel("Available capital ($)", { exact: true }).fill("0");
  await page.getByRole("button", { name: "Calculate illustration" }).click();
  await expect(
    page.getByRole("heading", { name: "WAIT · Quantity zero" }),
  ).toBeVisible();
  await expect(page.locator("main")).toContainText(
    "Copy trading is unavailable",
  );
});

test("compare and published empty states remain useful", async ({ page }) => {
  await page.goto("/compare");
  await expect(page.getByRole("table")).toBeVisible();
  await page.getByLabel("NEXUS", { exact: true }).check();
  await page.getByLabel("VEGA", { exact: true }).check();
  await expect(page.getByLabel("EVENT", { exact: true })).toBeDisabled();
  for (const route of [
    "/overview",
    "/my-bots",
    "/activity",
    "/settings",
    "/bots/theta/positions",
    "/bots/theta/history",
    "/bots/theta/performance",
  ]) {
    await page.goto(route);
    await expect(page.locator("main h1")).toBeVisible();
    await expect(page.locator(".error-state")).toHaveCount(0);
    await expect(page.locator(".demo-banner")).toHaveCount(0);
  }
});

test("loading, network failure, API failure and recovery do not fabricate data", async ({
  page,
}) => {
  await page.route("**/api/v1/bots", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 700));
    await route.abort();
  });
  await page.goto("/bots");
  await expect(
    page.getByRole("heading", { name: "Loading your workspace" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Your data is unavailable" }),
  ).toBeVisible();
  await page.unroute("**/api/v1/bots");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.locator(".bot-card")).toHaveCount(6);
  await page.route("**/api/v1/bots", (route) =>
    route.fulfill({ status: 503, body: "{}" }),
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "API connection failed" }),
  ).toBeVisible();
});

for (const state of [
  "STALE",
  "DEGRADED",
  "INVALID",
  "PAUSED",
  "CLOSED",
  "BROKER_UNAVAILABLE",
  "SHADOW",
  "LIVE_SMALL",
  "LIVE",
]) {
  test("explicit rendering: " + state, async ({ page }) => {
    await page.route("**/api/v1/bots/theta", async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      if (["STALE", "DEGRADED", "INVALID"].includes(state))
        body.data.data_quality = state;
      if (state === "PAUSED") body.data.status.automation = "PAUSED";
      if (state === "CLOSED") body.data.status.market_session = "CLOSED";
      if (state === "BROKER_UNAVAILABLE")
        body.data.status.broker = "UNAVAILABLE";
      if (["SHADOW", "LIVE_SMALL", "LIVE"].includes(state))
        body.data.environment = state;
      await route.fulfill({ json: body });
    });
    await page.goto("/bots/theta");
    await expect(page.locator('.notice[role="status"]')).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Activate", exact: true }),
    ).toHaveCount(0);
    await expect(page.locator(".metric-value").first()).toHaveText("—");
  });
}

test("owner access is private and uses a short-lived HttpOnly session", async ({
  page,
  context,
}) => {
  await page.goto("/owner");
  await expect(
    page.getByRole("heading", { name: "Owner access" }),
  ).toBeVisible();
  await page
    .getByLabel("Operator access key")
    .fill("synthetic-browser-test-operator-access-only");
  await page.getByRole("button", { name: "Open owner workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "Release & operational visibility" }),
  ).toBeVisible();
  const cookie = (await context.cookies()).find(
    (c) => c.name === "tb_operator",
  );
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.secure).toBe(true);
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByLabel("Operator access key")).toBeVisible();
});

for (const [name, width, height] of [
  ["desktop", 1440, 1000],
  ["tablet", 834, 1112],
  ["mobile", 390, 844],
] as const) {
  test(
    name + " accessibility, keyboard, layout and reference screenshots",
    async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height });
      for (const [id, path] of [
        ["bots", "/bots"],
        ["theta", "/bots/theta?dataset=demo"],
        ["positions", "/bots/theta/positions?dataset=demo"],
        ["simulate", "/bots/theta/simulate"],
        ["compare", "/compare"],
      ]) {
        await page.goto(path);
        await expect(page.locator("main h1")).toBeVisible();
        const overflow = await page.evaluate(() => ({
          viewport: innerWidth,
          document: document.documentElement.scrollWidth,
        }));
        expect(overflow, `${name} ${id} must not overflow the page`).toEqual({
          viewport: width,
          document: width,
        });
        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
          .analyze();
        expect(
          results.violations.map((v) => ({
            id: v.id,
            impact: v.impact,
            nodes: v.nodes.map((n) => n.target),
          })),
        ).toEqual([]);
        await page.screenshot({
          path: testInfo.outputPath(name + "-" + id + ".png"),
          fullPage: true,
          animations: "disabled",
        });
      }
      await page.goto("/bots");
      await page.keyboard.press("Tab");
      await expect(
        page.getByRole("link", { name: "Skip to content" }),
      ).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.locator("#main")).toBeFocused();
    },
  );
}

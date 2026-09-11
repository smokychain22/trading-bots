import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("Bots makes THETA primary and future bots unavailable", async ({ page }) => {
  await page.goto("/bots");
  await expect(page.getByRole("heading", { name: "Trading Bots", exact: true })).toBeVisible();
  await expect(page.getByText("PAPER TESTING", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Copy THETA", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Future bots" })).toBeVisible();
  await expect(page.locator(".bot-card")).toHaveCount(5);
  await page.getByText("Filter future bots").click();
  await page.getByLabel("Strategy").selectOption("Neutral");
  await expect(page.locator(".bot-card")).toHaveCount(1);
  await expect(page.getByRole("link", { name: "Activate", exact: true })).toHaveCount(0);
});

test("THETA customer view is concise and hides engineering internals", async ({ page }) => {
  await page.goto("/bots/theta");
  await expect(page.getByRole("heading", { name: "THETA", exact: true })).toBeVisible();
  await expect(page.getByText("Paper track record is being built", { exact: false }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Copy THETA", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "THETA sections" }).getByRole("link")).toHaveCount(5);
  await expect(page.getByRole("link", { name: "My Results" })).toBeVisible();
  await expect(page.locator("main")).not.toContainText("FusionSnapshot");
  await expect(page.locator("main")).not.toContainText("ManagementUtility");
  await expect(page.locator(".metric-value")).toHaveCount(6);
  await expect(page.locator(".metric-value")).toHaveText(["—", "—", "—", "—", "—", "—"]);
  await expect(page.getByRole("heading", { name: "No open positions" })).toBeVisible();
});

test("Copy THETA shows one simple connection step when OAuth is unavailable", async ({ page }) => {
  await page.goto("/bots/theta/copy");
  await expect(page.getByRole("heading", { name: "Copy THETA", exact: true })).toBeVisible();
  await expect(page.getByText("STEP 1 OF 3")).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect Alpaca" })).toBeDisabled();
  await expect(page.getByText(/private paper testing/)).toBeVisible();
  await expect(page.getByText("How much should THETA use?")).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText("token storage");
});

test("My Bots and Account show safe disconnected states", async ({ page }) => {
  await page.goto("/my-bots");
  await expect(page.getByRole("heading", { name: "No bots are copying yet" })).toBeVisible();
  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "Your paper account" })).toBeVisible();
  await expect(page.getByText("Not connected", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect Alpaca" })).toBeDisabled();
  await expect(page.getByText(/private paper testing/)).toBeVisible();
  await expect(page.locator("main")).not.toContainText("OAuth");
  await expect(page.locator("main")).not.toContainText("token storage");
});

test("private team can enter masked Paper credentials and receives only safe account data", async ({ page }, testInfo) => {
  let connected = false;
  await page.route("**/api/v1/copy/readiness", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.data.private_paper_api_key = {
      configured: true, state: "READY", credential_storage: "ENCRYPTED_SERVER_SIDE", order_submission: "LOCKED",
    };
    if (connected) body.data.follower_account = {
      ...body.data.follower_account, connected: true, ready_for_theta: true,
      connection_method: "PAPER_API_KEY_PRIVATE_BETA", masked_account: "••••abcd",
      account_status: "ACTIVE", equity: 25000, buying_power: 48000, cash: 12000,
      options_buying_power: 12000,
      options_approved_level: 2, options_trading_level: 2, open_positions: 1,
      open_orders: 0, market_open: false, last_sync_at: "2026-09-11T10:00:00.000Z",
    };
    await route.fulfill({ json: body });
  });
  await page.route("**/api/v1/alpaca/connection", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const payload = route.request().postDataJSON();
    expect(payload).toEqual({ api_key_id: "paper-test-key", secret_key: "paper-test-secret" });
    connected = true;
    await route.fulfill({ status: 201, json: { api_version: "v1", data: {
      connected: true, connection_method: "PAPER_API_KEY_PRIVATE_BETA",
      masked_account: "••••abcd", account_status: "ACTIVE", equity: 25000,
      buying_power: 48000, orders_submitted: false,
    } } });
  });
  await page.goto("/account");
  await page.screenshot({ path: testInfo.outputPath("private-paper-connect-form.png"), fullPage: true, animations: "disabled" });
  await expect(page.getByLabel("Paper Secret Key")).toHaveAttribute("type", "password");
  await page.getByLabel("Paper API Key ID").fill("paper-test-key");
  await page.getByLabel("Paper Secret Key").fill("paper-test-secret");
  await page.getByRole("button", { name: "Connect Paper Account" }).click();
  await expect(page.getByText("Connected · ••••abcd")).toBeVisible();
  await expect(page.getByText("$25,000")).toBeVisible();
  await expect(page.getByText("$12,000")).toHaveCount(2);
  await expect(page.locator("body")).not.toContainText("paper-test-secret");
  await expect(page.locator("body")).not.toContainText("paper-test-key");
  await expect(page.getByRole("button", { name: /submit order/i })).toHaveCount(0);
});

test("Copy THETA distinguishes tester sign-in and returns to the broker step", async ({ page }, testInfo) => {
  let authenticated = false;
  await page.route("**/api/v1/copy/readiness", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.data.private_paper_api_key = {
      configured: true,
      state: authenticated ? "READY" : "CUSTOMER_LOGIN_REQUIRED",
      credential_storage: "ENCRYPTED_SERVER_SIDE",
      order_submission: "LOCKED",
    };
    body.data.oauth.state = "NOT_CONFIGURED";
    await route.fulfill({ json: body });
  });
  await page.route("**/api/v1/auth/login", async (route) => {
    const payload = route.request().postDataJSON();
    expect(payload.return_to).toBe("/bots/theta/copy");
    authenticated = true;
    await route.fulfill({ json: { api_version: "v1", data: {
      authenticated: true,
      email: "tester@example.invalid",
      return_to: "/bots/theta/copy",
    } } });
  });

  await page.goto("/bots/theta/copy");
  await expect(page.getByRole("heading", { name: "Sign in to Trading Bots" })).toBeVisible();
  await expect(page.getByText("Alpaca Paper API credentials come next.")).toBeVisible();
  await page.getByRole("link", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/account\?signin=required.*returnTo=/);
  await expect(page.getByRole("heading", { name: "Sign in to Trading Bots", exact: true }).first()).toBeVisible();
  await expect(page.getByText("They are not Alpaca credentials.")).toBeVisible();
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("trading-bots-sign-in.png"), fullPage: true, animations: "disabled" });
  await page.getByLabel("Trading Bots email").fill("tester@example.invalid");
  await page.getByLabel("Trading Bots password").fill("synthetic-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).last().click();
  await expect(page).toHaveURL(/\/bots\/theta\/copy$/);
  await expect(page.getByLabel("Paper API Key ID")).toBeVisible();
  await expect(page.getByLabel("Paper Secret Key")).toHaveAttribute("type", "password");
  await expect(page.getByRole("button", { name: "Connect Paper Account" })).toBeVisible();
  await expect(page.getByRole("button", { name: /submit order/i })).toHaveCount(0);
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("copy-paper-credentials.png"), fullPage: true, animations: "disabled" });
});

test("Activity supports simple customer filters", async ({ page }) => {
  await page.goto("/activity");
  await expect(page.getByRole("heading", { name: "Activity", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "All" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Trades" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Bot activity" })).toBeVisible();
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
  await expect(page.locator(".metric-value")).toHaveCount(6);
  await expect(page.locator(".metric-value")).toHaveText(["—", "—", "—", "—", "—", "—"]);
});

test("backend failure does not reuse stale financial data", async ({ page }) => {
  await page.route("**/api/v1/bots", (route) => route.fulfill({ status: 503, body: "{}" }));
  await page.goto("/bots");
  await expect(page.getByRole("heading", { name: "API connection failed" })).toBeVisible();
  await expect(page.locator(".metric-value")).toHaveCount(0);
});

test("home calls to action navigate to working customer routes", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "THETA is in private paper testing." })).toBeVisible();
  await page.getByRole("link", { name: "View THETA" }).click();
  await expect(page).toHaveURL(/\/bots\/theta$/);
  await page.goto("/");
  await page.getByRole("link", { name: "View THETA" }).click();
  await expect(page).toHaveURL(/\/bots\/theta$/);
});

test("customer performance, positions, and trades use one clean empty state", async ({ page }) => {
  await page.goto("/bots/theta/my-results");
  await expect(page.getByRole("heading", { name: "No personal results yet" })).toBeVisible();
  await expect(page.locator("main")).toContainText("Master performance and your results are separate");
  await page.goto("/bots/theta/performance");
  await expect(page.getByRole("heading", { name: "THETA is building its paper track record" })).toBeVisible();
  await expect(page.locator("main")).not.toContainText("Independent N");
  await expect(page.locator("main")).not.toContainText("Calibration quality");
  await page.goto("/bots/theta/positions");
  await expect(page.getByRole("heading", { name: "No open positions" })).toBeVisible();
  await page.goto("/bots/theta/history");
  await expect(page.getByRole("heading", { name: "No trades yet" })).toBeVisible();
});

test("active follower fixture shows automatic-copy semantics without trade controls", async ({ page }) => {
  await page.route("**/api/v1/copy/readiness", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.data.participation = "COPY_NEW_AND_MANAGE";
    body.data.follower_account.state = "READY";
    body.data.follower_account.connected = true;
    body.data.follower_account.ready_for_theta = true;
    body.data.follower_account.masked_account = "•••• 0184";
    body.data.follower_account.buying_power = 25000;
    body.data.follower_account.cash = 15000;
    body.data.follower_account.options_enabled = true;
    body.data.follower_account.last_sync_at = "2026-09-10T14:00:00Z";
    await route.fulfill({ json: body });
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Track your THETA paper copy." })).toBeVisible();
  await expect(page.getByRole("link", { name: "View my results" })).toBeVisible();
  await page.goto("/my-bots");
  await expect(page.getByRole("heading", { name: "Paper setup saved" })).toBeVisible();
  await expect(page.locator("main")).toContainText("Order submission remains locked");
  await page.goto("/account");
  await expect(page.getByText("Connected · •••• 0184")).toBeVisible();
  await expect(page.getByRole("button", { name: "Disconnect", exact: true })).toBeEnabled();
  await expect(page.locator("main")).not.toContainText("token revocation");
});

test("customer position and history views never expose manual trade actions", async ({ page }) => {
  for (const route of [
    "/bots/theta/positions?dataset=demo",
    "/bots/theta/history?dataset=demo",
  ]) {
    await page.goto(route);
    await expect(page.getByRole("button", { name: /close|roll|buy|sell|cancel|replace/i })).toHaveCount(0);
  }
});

test("visible customer controls either work or explain why they are unavailable", async ({ page }) => {
  await page.goto("/activity");
  await page.getByRole("button", { name: "Trades" }).click();
  await expect(page.getByRole("button", { name: "Trades" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Bot activity" }).click();
  await expect(page.getByRole("button", { name: "Bot activity" })).toHaveAttribute("aria-pressed", "true");

  await page.route("**/api/v1/copy/readiness", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.data.follower_account.state = "READY";
    body.data.follower_account.connected = true;
    body.data.follower_account.ready_for_theta = true;
    body.data.follower_account.masked_account = "••••0184";
    body.data.oauth.state = "READY";
    body.data.oauth.configured = true;
    body.data.activation_allowed = true;
    await route.fulfill({ json: body });
  });
  await page.route("**/api/v1/copy/policy/validate", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.data.activation_allowed = true;
    body.data.stage = "READY_TO_COPY";
    await route.fulfill({ json: body });
  });
  await page.goto("/bots/theta/copy");
  await expect(page.getByText("STEP 2 OF 3")).toBeVisible();
  await page.getByRole("button", { name: "Custom" }).click();
  await page.getByLabel("Custom allocation ($)").fill("12000");
  await expect(page.locator("#allocation-output")).toHaveText("$12,000");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("STEP 3 OF 3")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save setup" })).toBeEnabled();
  await expect(page.locator("#activation-note")).toContainText("cannot place an order");

  await page.goto("/account");
  await expect(page.getByRole("button", { name: "Connect Alpaca" })).toHaveCount(0);
});

test("ops requires a server session and shows partial runtime honestly", async ({ page, context, request }, testInfo) => {
  for (const route of ["/ops", "/ops/theta", "/ops/trading", "/ops/copy", "/ops/system"]) {
    const response = await request.get(route, { maxRedirects: 0 });
    expect(response.status()).toBe(302);
    expect(response.headers().location).toBe("/ops/login");
  }
  await page.goto("/bots");
  await expect(page.getByRole("link", { name: /ops|admin|owner/i })).toHaveCount(0);
  await page.goto("/ops/login");
  await page.getByLabel("Operator access key").fill("synthetic-browser-test-operator-access-only");
  await page.getByRole("button", { name: "Open operations" }).click();
  await expect(page).toHaveURL(/\/ops$/);
  await expect(page.getByRole("heading", { name: "Operations overview" })).toBeVisible();
  await expect(page.locator("main")).toContainText("Order submission remains locked");
  await expect(page.getByRole("navigation", { name: "Operations" }).getByRole("link")).toHaveCount(5);
  for (const route of ["/ops/theta", "/ops/trading", "/ops/copy", "/ops/system"]) {
    await page.goto(route);
    await expect(page.locator("main h1:visible")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1280);
    const overflowCount = await page.locator(".ops-health article, .ops-control-card").evaluateAll((elements) =>
      elements.filter((element) => element.scrollWidth > element.clientWidth).length,
    );
    expect(overflowCount).toBe(0);
    const accessibility = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(accessibility.violations.map((violation) => violation.id)).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath(`${route.split("/").at(-1)}.png`),
      fullPage: true,
      animations: "disabled",
    });
  }
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
      ["home", "/"], ["bots", "/bots"], ["theta", "/bots/theta"], ["copy", "/bots/theta/copy"],
      ["results", "/bots/theta/my-results"], ["positions", "/bots/theta/positions"], ["trades", "/bots/theta/history"], ["performance", "/bots/theta/performance"],
      ["my-bots", "/my-bots"], ["activity", "/activity"], ["account", "/account"], ["ops-login", "/ops/login"],
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

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import { botDetail, botSummaries } from "../src/customer/catalog.js";
import handler, { simulateCapital, validSession } from "../src/customer/api.js";

let server: Server;
let base: string;
const priorKey = process.env.THETA_READINESS_TOKEN;
const key = randomBytes(32).toString("hex");
before(async () => {
  process.env.THETA_READINESS_TOKEN = key;
  server = createServer((req, res) => void handler(req, res));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  base = `http://127.0.0.1:${address.port}`;
});
after(async () => {
  if (priorKey === undefined) delete process.env.THETA_READINESS_TOKEN;
  else process.env.THETA_READINESS_TOKEN = priorKey;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
const input = {
  capital: 10000,
  strike: 50,
  premium: 1.5,
  stock_at_exit: 45,
  max_contracts: 1,
  costs_per_contract: 2,
  dte: 30,
  min_dte: 7,
  max_dte: 60,
  max_daily_loss: 500,
  max_slippage: 0.1,
  min_open_interest: 500,
  join_existing: false,
};
test("published catalog has no invented results or activation permissions", () => {
  const bots = botSummaries();
  assert.equal(bots.length, 6);
  for (const bot of bots) {
    assert.equal(bot.status.activation_allowed, false);
    assert.equal(bot.status.copy_available, false);
    assert.equal(bot.capital_minimum, null);
    assert(bot.metrics.every((m) => m.value === null));
    if (bot.bot_id !== "theta") {
      assert.equal(bot.environment, "RESEARCH");
      assert.equal(bot.provenance, "RESEARCH");
      assert.equal(bot.available, false);
    }
  }
  assert.equal(botDetail("theta")?.performance.equity.length, 0);
  assert.equal(
    botDetail("theta")?.performance.track_record.open_positions_included,
    null,
  );
});
test("demo economic equity, drawdown, attribution and open chain reconcile", () => {
  const detail = botDetail("theta", true);
  assert(detail);
  assert.equal(detail.provenance, "DEMO_DATA");
  const performance = detail.performance;
  for (const p of performance.equity)
    assert.equal(p.total, 100000 + p.realized + p.unrealized);
  assert.equal(performance.equity.at(-1)?.total, 103950);
  assert.equal(
    performance.attribution.reduce((sum, a) => sum + a.pnl, 0),
    3950,
  );
  assert.equal(
    performance.metrics.find((m) => m.technical_name === "Maximum Drawdown")
      ?.value,
    Math.min(...performance.equity.map((p) => p.drawdown)),
  );
  assert.equal(
    performance.metrics.find((m) => m.technical_name === "Profit Factor")
      ?.value,
    16500 / 10630,
  );
  const chain = detail.chains[0];
  assert(chain);
  assert.equal(
    chain.events.reduce((sum, e) => sum + e.realized_pnl, 0) +
      (chain.events.at(-1)?.unrealized_pnl ?? 0),
    chain.whole_chain_pnl,
  );
  assert.equal(chain.whole_chain_pnl, -1920);
  assert.equal(chain.capital_days, 18000 * 24);
  assert.equal(performance.track_record.independent_n, null);
});
test("illustrative sizing allows zero, excludes premium from collateral and includes stock losses", () => {
  assert.equal(simulateCapital(input).economic_pnl, -352);
  assert.equal(simulateCapital({ ...input, capital: 5001 }).quantity, 0);
  assert.equal(simulateCapital({ ...input, capital: 5002 }).quantity, 1);
  assert.equal(simulateCapital({ ...input, max_contracts: 0 }).quantity, 0);
  assert.equal(simulateCapital({ ...input, dte: 3 }).quantity, 0);
  assert.equal(
    simulateCapital({ ...input, capital: 0 }).assignment_assumed,
    false,
  );
  assert.equal(
    simulateCapital({ ...input, stock_at_exit: 60 }).economic_pnl,
    148,
  );
  for (const invalid of [
    { capital: null },
    { premium: 51 },
    { max_contracts: 1.5 },
    { join_existing: true },
    { dte: 0 },
    { extra: "field" },
  ]) {
    assert.throws(() => simulateCapital({ ...input, ...invalid }));
  }
});
test("versioned routes fail closed and expose no account fields", async () => {
  for (const section of [
    "",
    "/status",
    "/performance",
    "/equity",
    "/positions",
    "/history",
    "/risk",
    "/intelligence",
    "/activity",
  ]) {
    const res = await fetch(base + "/api/v1/bots/theta" + section);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.api_version, "v1");
    assert.equal(body.dataset, "published");
    assert(!JSON.stringify(body).includes(key));
    assert(
      !/account_id|api_key|secret_key|authorization/i.test(
        JSON.stringify(body),
      ),
    );
  }
  assert.equal(
    (await fetch(base + "/api/v1/bots/theta?dataset=bogus")).status,
    400,
  );
  assert.equal(
    (await fetch(base + "/api/v1/bots/theta/orders", { method: "POST" }))
      .status,
    405,
  );
  assert.equal((await fetch(base + "/api/v1/bots/unknown")).status, 404);
  assert.equal(
    (await fetch(base + "/api/v1/bots/theta/chains/demo-aapl-001")).status,
    404,
  );
  assert.equal(
    (await fetch(base + "/api/v1/bots/theta/chains/demo-aapl-001?dataset=demo"))
      .status,
    200,
  );
  const sim = await fetch(base + "/api/v1/bots/theta/simulate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  assert.equal(sim.status, 200);
  assert.equal((await sim.json()).data.execution_authorized, false);
});
test("Vercel nested-route rewrite passes the complete route value", async () => {
  const res = await fetch(
    base + "/api/customer?route=bots/theta/performance&dataset=demo",
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.data.bot_id, "theta");
  assert.equal(body.data.provenance, "DEMO_DATA");
});
test("operator access needs a strong key, same origin and signed expiring session", async () => {
  assert.equal((await fetch(base + "/api/v1/operator/status")).status, 401);
  const login = (token: string, origin: string) =>
    fetch(base + "/api/v1/operator/session", {
      method: "POST",
      headers: { origin, "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
  assert.equal((await login(key, "https://untrusted.invalid")).status, 403);
  assert.equal((await login("invalid", base)).status, 401);
  const res = await login(key, base);
  assert.equal(res.status, 200);
  const cookie = res.headers.get("set-cookie") ?? "";
  assert.match(cookie, /HttpOnly; Secure; SameSite=Strict/);
  assert(!cookie.includes(key));
  assert(validSession(cookie, key));
  assert(!validSession(cookie, key, Date.now() + 901000));
  assert(!validSession(cookie, randomBytes(32).toString("hex")));
  assert.equal(
    (await fetch(base + "/api/v1/operator/status", { headers: { cookie } }))
      .status,
    200,
  );
  assert.equal(
    (
      await fetch(base + "/api/v1/operator/orders", {
        headers: { cookie },
        method: "POST",
      })
    ).status,
    403,
  );
  const status = await fetch(base + "/api/v1/operator/status", {
    headers: { cookie },
  });
  assert.equal((await status.json()).data.trading, "DISABLED");
});

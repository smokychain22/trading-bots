import { esc, money, badge, link, table } from "./ui.js";

export function howItWorks() {
  const steps = [
    [
      "Select underlyings",
      "Evaluate ownership suitability, events, liquidity and portfolio context.",
    ],
    [
      "Evaluate CSP candidates",
      "Compare strikes, expirations and economic outcomes. Delta is not a realized win probability.",
    ],
    [
      "Choose to wait",
      "When data, costs or risk do not support new exposure, WAIT is valid.",
    ],
    [
      "Open a selected CSP",
      "Cash secures the shares that may be assigned. A limit fill and risk approval are required.",
    ],
    [
      "Manage the option",
      "Compare close, expiry, roll and assignment from the same timestamped state.",
    ],
    [
      "Evaluate recovery",
      "Assigned shares remain part of economic P&L. Recovery can take time and tie up capital.",
    ],
    [
      "Consider a covered call",
      "Sell only against confirmed shares when the economics justify limiting upside.",
    ],
    [
      "Resolve the full chain",
      "Include all option and stock gains, losses, dividends and costs.",
    ],
  ];
  return `<section class="panel how-intro"><p class="eyebrow">UNDERSTAND THE STRATEGY</p><h2>Income is only the beginning.</h2><p class="lede">THETA follows the full Wheel, including the moments when waiting is the right action.</p><div class="steps">${steps.map(([title, text], i) => `<article><span class="step-number">${i + 1}</span><h3>${title}</h3><p>${text}</p></article>`).join("")}</div></section><section class="panel"><h2>The lifecycle</h2><div class="lifecycle-map"><div>Cash → CSP</div><div class="branches"><span>Close</span><span>Expire</span><span>Roll = close old + open new</span><span>Assignment → stock</span></div><div>Stock → Recovery wait</div><div class="branches"><span>Close stock</span><span>Covered call → close / expire / roll / call away</span></div><div>Economic resolution → Closed</div></div><p>Old realized losses stay in the chain after every roll. Assignment does not erase a stock loss or count as an automatic win.</p></section><div class="two-columns"><section class="panel"><h2>Potentially supportive conditions</h2>${badge("RESEARCH", "violet")}<p>Liquid options, suitable underlyings and adequate compensation for downside and capital use are research conditions to evaluate. No best-performing regime has been validated yet.</p></section><section class="panel" id="risks"><h2>Where it can struggle</h2><p>Sharp stock declines, gaps, concentrated exposure, poor liquidity and long inventory recovery can outweigh premium income. Covered calls can limit rebound participation.</p></section><section class="panel"><h2>What assignment means</h2><p>A short put can require purchase of shares at the strike. Confirmed stock enters the same Wheel chain. The bot evaluates recovery and stock exit alongside covered calls.</p><p>Economic break-even and broker or tax basis are different concepts. The platform identifies each measure explicitly.</p></section><section class="panel"><h2>Why capital can stay committed</h2><p>Cash secures the put. After assignment, capital remains in stock until an exit or call-away. A recovery may be lengthy and a price recovery is not guaranteed.</p></section></div><section class="panel"><h2>What you can do today</h2><p>Explore the interface and test an illustrative capital scenario. THETA is in development with a paper broker environment. There is no validated customer track record, active copy engine or live activation.</p>${link("/bots/theta/simulate", "Explore a capital scenario", "button primary")}</section>`;
}

export function simulationPage() {
  const field = (name, text, value, min, max, step = "1") =>
    `<label>${text}<input name="${name}" type="number" value="${value}" min="${min}" max="${max}" step="${step}" required></label>`;
  return `<div class="section-heading"><div><p class="eyebrow">ILLUSTRATIVE SCENARIO</p><h2>Start with your capital</h2><p>This is a learning tool, not a forecast, backtest or offer to trade.</p></div>${badge("DEMO DATA", "demo")}</div><div class="two-columns"><form class="panel simulation-form" id="simulation"><fieldset><legend>1. The essentials</legend>${field("capital", "Capital you want to illustrate ($)", 10000, 0, 10000000)}<div class="preference-choice"><span>Would you be willing to receive assigned shares?</span><label><input type="radio" name="assignment_preference" value="yes" checked> Yes, show an assigned-stock example</label><label><input type="radio" name="assignment_preference" value="no"> No, explain why assignment matters</label></div><p class="control-note"><strong>What happens next</strong><br>We calculate an explicitly hypothetical position size. A result of zero means WAIT, which is a valid result.</p></fieldset><details class="advanced-assumptions"><summary>Advanced assumptions</summary><p>These assumptions make the illustration concrete. They are not live quotes, recommendations or broker controls.</p><div class="advanced-fields">${field("strike", "Illustrative put strike ($ per share)", 50, 0.01, 100000, "0.01")}${field("premium", "Illustrative opening premium ($ per share)", 1.5, 0, 100000, "0.01")}${field("stock_at_exit", "Illustrative stock value at expiry ($ per share)", 45, 0, 100000, "0.01")}${field("dte", "Illustrative days to expiry", 30, 1, 730)}${field("max_contracts", "Maximum illustrative contracts", 1, 0, 1000)}${field("costs_per_contract", "Modeled fees and slippage ($ per contract)", 2, 0, 10000, "0.01")}${field("min_dte", "Minimum DTE preference", 7, 1, 730)}${field("max_dte", "Maximum DTE preference", 60, 1, 730)}${field("max_daily_loss", "Daily loss preference ($)", 500, 0, 10000000)}${field("max_slippage", "Slippage preference ($ per share)", 0.1, 0, 100, "0.01")}${field("min_open_interest", "Open-interest preference", 500, 0, 100000000)}</div></details><p class="caption">0DTE is outside this illustration. No account is connected and no existing position can be joined.</p><button class="button primary" type="submit">Calculate illustration</button><p id="simulation-error" role="alert"></p></form><section class="panel simulation-output" aria-live="polite"><p class="eyebrow">YOUR ILLUSTRATION</p><h2>See the economic consequence</h2><p>Enter capital and calculate. The result includes assigned-stock value, not option premium alone.</p><div id="simulation-result"></div></section></div>`;
}
export function bindSimulation() {
  const form = document.querySelector("#simulation");
  let lastInput;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    button.textContent = "Calculating…";
    document.querySelector("#simulation-error").textContent = "";
    const raw = new FormData(form);
    const input = Object.fromEntries(
      [...raw]
        .filter(([k]) => k !== "assignment_preference")
        .map(([k, v]) => [k, Number(v)]),
    );
    input.join_existing = false;
    try {
      const response = await fetch("/api/v1/bots/theta/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok)
        throw new Error(
          "Check the DTE range and confirm premium is below strike.",
        );
      const { data: r } = await response.json();
      lastInput = input;
      const assignmentPreference = raw.get("assignment_preference");
      document.querySelector("#simulation-result").innerHTML =
        `${badge("DEMO DATA", "demo")}<h3>${r.quantity === 0 ? "WAIT · Quantity zero" : `${r.quantity} illustrative contract${r.quantity > 1 ? "s" : ""}`}</h3><p class="plain-result">${r.quantity === 0 ? "Your selected capital or limits do not support a contract in this illustration. WAIT preserves cash in this example." : r.assignment_assumed ? "This example includes assignment. The stock loss stays visible in total economic P&L." : "This example assumes the option expires without assignment."}</p>${table(
          ["Component", "Hypothetical value"],
          [
            ["Cash collateral", money(r.collateral)],
            ["Opening premium", money(r.premium)],
            ["Fees and modeled slippage", money(-r.costs)],
            ["Assigned-stock MTM", money(r.stock_mtm)],
            [
              "Total economic P&L",
              `<strong class="${r.economic_pnl < 0 ? "negative" : "positive"}">${money(r.economic_pnl)}</strong>`,
            ],
          ],
          "DEMO DATA · Your assumptions",
        )}<p>${assignmentPreference === "no" ? "You marked assignment as unsuitable. A future controlled experience would need real enforcement. This illustration does not enforce a broker rule." : ""}</p><details><summary>Assumptions & limitations</summary><ul>${r.limitations.map((s) => `<li>${esc(s)}</li>`).join("")}</ul></details><button class="button secondary" id="save-plan">Save local draft</button><p id="save-result" role="status"></p>`;
      document.querySelector("#save-plan").addEventListener("click", () => {
        try {
          let plans = JSON.parse(
            localStorage.getItem("tb.demo.plans.v1") ?? "[]",
          );
          if (!Array.isArray(plans)) plans = [];
          plans.push({ ...lastInput, id: crypto.randomUUID() });
          localStorage.setItem(
            "tb.demo.plans.v1",
            JSON.stringify(plans.slice(-20)),
          );
          document.querySelector("#save-result").innerHTML =
            `Saved in this browser. ${link("/my-bots", "View My Bots", "text-link")}`;
          document.querySelector("#save-plan").disabled = true;
        } catch {
          document.querySelector("#save-result").textContent =
            "Browser storage is unavailable. The calculation is still shown above.";
        }
      });
    } catch (error) {
      document.querySelector("#simulation-error").textContent =
        error.name === "TimeoutError"
          ? "The calculation timed out. Try again."
          : error.message === "Failed to fetch"
            ? "Network unavailable. Try again."
            : error.message;
    } finally {
      button.disabled = false;
      button.textContent = "Calculate illustration";
    }
  });
}

export function accountPage(readiness) {
  const connected = readiness.follower_account.state === "READY";
  return `<div class="page-heading"><div><p class="eyebrow">ACCOUNT</p><h1>Your paper account</h1><p class="lede">Connect Alpaca through a secure PAPER-only authorization flow when customer access is released.</p></div>${badge("PAPER ONLY", "blue")}</div><section class="account-connection"><div><span class="connection-mark" aria-hidden="true">A</span><div><h2>Alpaca PAPER</h2><p>${connected ? `Connected as ${esc(readiness.follower_account.masked_account)}` : "No customer account connected"}</p></div></div>${badge(readiness.follower_account.state, connected ? "green" : "amber")}</section><div class="two-columns"><section class="panel"><h2>Connection method</h2><p>Customer accounts will use Alpaca OAuth. API keys and access tokens will never be entered into this page, redisplayed, or stored in browser storage.</p><dl class="facts"><div><dt>Environment</dt><dd>PAPER</dd></div><div><dt>Authorization</dt><dd>Server-side OAuth</dd></div><div><dt>Token storage</dt><dd>Encrypted secret reference required</dd></div></dl><button class="button primary" disabled aria-describedby="connect-reason">Connect Alpaca PAPER</button><p id="connect-reason" class="notice amber">${esc(readiness.reason)}</p></section><section class="panel"><h2>What happens after connection</h2><ol class="plain-steps"><li>Authorize a PAPER account with Alpaca.</li><li>Verify account status, options approval, buying power, positions, market data, and session state.</li><li>Set follower-specific capital and risk limits.</li><li>Review the setup. Activation stays blocked until the copy runtime passes its release gates.</li></ol>${link("/bots/theta/copy", "Preview paper-copy setup", "button secondary")}</section></div>`;
}

export function paperCopyPage(readiness) {
  const number = (name, text, value, min, max, step = "1") =>
    `<label>${text}<input name="${name}" type="number" value="${value}" min="${min}" max="${max}" step="${step}" required></label>`;
  return `<div class="copy-heading"><div><p class="eyebrow">PAPER COPY SETUP</p><h2>Copy THETA</h2><p>Choose how much THETA may use and review your safety limits. No order or broker authorization is created.</p></div>${badge("PAPER", "blue")}</div><ol class="copy-steps" aria-label="Paper copy setup steps"><li aria-current="step"><span>1</span>Connect Alpaca</li><li><span>2</span>Copy amount</li><li><span>3</span>Safety</li><li><span>4</span>Review</li><li><span>5</span>Activate</li></ol><section class="connection-blocked"><div><h3>Connect your Alpaca Paper account</h3><p>${esc(readiness.reason)}</p></div><button class="button primary" disabled>Connect Alpaca Paper</button></section><form id="copy-policy" class="panel copy-policy"><div class="section-heading"><div><p class="eyebrow">COPY AMOUNT</p><h2>How much should THETA use?</h2><p>Cash-secured puts require enough cash to buy assigned shares.</p></div>${badge("NOT ACTIVE", "amber")}</div><fieldset><legend>Copy and safety limits</legend><div class="advanced-fields">${number("allocation_usd", "Amount to use ($)", 25000, 0, 10000000)}${number("max_bot_capital_pct", "Maximum account allocation (%)", 25, 0, 100, "0.1")}${number("max_open_positions", "Maximum open positions", 3, 0, 1000)}${number("max_daily_loss_usd", "Daily loss safety limit ($)", 500, 0, 10000000)}</div></fieldset><details><summary>Advanced limits</summary><fieldset><div class="advanced-fields">${number("max_ticker_exposure_pct", "Maximum one-ticker exposure (%)", 10, 0, 100, "0.1")}${number("max_contracts", "Maximum contracts per order", 1, 0, 1000)}${number("min_dte", "Minimum DTE", 7, 0, 730)}${number("max_dte", "Maximum DTE", 60, 0, 730)}${number("max_slippage_per_contract_usd", "Maximum slippage per contract ($)", 10, 0, 100000, "0.01")}${number("min_open_interest", "Minimum open interest", 500, 0, 100000000)}</div><label class="check-row"><input type="checkbox" name="allow_0dte"> Allow 0DTE trades</label></fieldset></details><label class="check-row locked"><input type="checkbox" name="start_new_trades_only" checked disabled> Start new trades only</label><label class="check-row locked"><input type="checkbox" name="join_existing_positions" disabled> Join existing positions</label><p class="caption">Some THETA trades may be skipped or reduced to respect your account limits.</p><button class="button primary" type="submit">Review setup</button><p id="copy-error" role="alert"></p></form><section id="copy-review" class="panel copy-review" aria-live="polite"><h2>Review</h2><p>Review your limits to see whether paper activation is available.</p></section>`;
}

export function bindPaperCopy() {
  const form = document.querySelector("#copy-policy");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    document.querySelector("#copy-error").textContent = "";
    const data = new FormData(form);
    const policy = Object.fromEntries(
      [...data]
        .filter(([name]) => !["allow_0dte"].includes(name))
        .map(([name, value]) => [name, Number(value)]),
    );
    policy.allow_0dte = data.has("allow_0dte");
    policy.join_existing_positions = false;
    policy.start_new_trades_only = true;
    try {
      const response = await fetch("/api/v1/copy/policy/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(policy),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error("Review the DTE range and risk limits.");
      const { data: review } = await response.json();
      document.querySelector("#copy-review").innerHTML = `<div class="section-heading"><div><p class="eyebrow">REVIEW</p><h2>Waiting for the paper-copy runtime</h2></div>${badge("BLOCKED", "amber")}</div><dl class="review-grid"><div><dt>Capital budget</dt><dd>${money(review.policy.allocation_usd)}</dd></div><div><dt>Max contracts</dt><dd>${esc(review.policy.max_contracts)}</dd></div><div><dt>DTE range</dt><dd>${esc(review.policy.min_dte)}–${esc(review.policy.max_dte)}</dd></div><div><dt>Join existing</dt><dd>Off</dd></div><div><dt>Current quantity</dt><dd>0</dd></div><div><dt>Sizing</dt><dd>Follower preflight required</dd></div></dl><p class="notice amber">Activation is unavailable. Customer IAM, OAuth callback verification, encrypted token persistence, master-fill ingestion, follower preflight, sizing, child-order lifecycle, and reconciliation are not released.</p><button class="button primary" disabled>Activate paper copy</button>`;
    } catch (error) {
      document.querySelector("#copy-error").textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
}

export function ownerPage() {
  return `<div class="page-heading"><div><p class="eyebrow">PRIVATE OPERATIONS</p><h1>THETA operations</h1><p class="lede">Runtime, provider, execution, accounting, and copy readiness.</p></div>${badge("READ ONLY", "blue")}</div><section class="panel owner-panel"><form id="owner-login"><h2>Authorized access</h2><label>Operator access key<input type="password" name="token" required minlength="32" autocomplete="off" spellcheck="false"></label><p class="caption">The credential is exchanged for a 15-minute HttpOnly session and is never stored in browser storage.</p><button class="button primary">Open operations</button><p id="owner-error" role="alert"></p></form><div id="owner-data"></div></section>`;
}
export function bindOwner() {
  const form = document.querySelector("#owner-login");
  async function read() {
    const res = await fetch("/api/v1/operator/status", {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return false;
    const { data } = await res.json();
    form.hidden = true;
    document.querySelector("#owner-data").innerHTML =
      `<div class="section-heading"><div><p class="eyebrow">SYSTEM STATE</p><h2>Is THETA working?</h2></div><button id="logout" class="button secondary">Sign out</button></div><div class="ops-health">${Object.entries(data.systems).map(([name, state]) => `<article><span>${esc(name.replaceAll("_", " "))}</span>${badge(state, state === "HEALTHY" ? "green" : state === "BLOCKED" ? "amber" : "")}</article>`).join("")}</div><section class="ops-section"><div class="section-heading"><div><h2>THETA engine</h2><p>R1 is partial. Contracts and deterministic models exist, while runtime I/O remains gated.</p></div>${badge(data.runtime_detail.stage, "amber")}</div><dl class="capability-grid"><div><dt>Policy version</dt><dd>${esc(data.runtime_detail.policy_version ?? "Not active")}</dd></div><div><dt>Last snapshot</dt><dd>${esc(data.runtime_detail.last_market_snapshot ?? "Unknown")}</dd></div><div><dt>Last scan</dt><dd>${esc(data.runtime_detail.last_scan ?? "Unknown")}</dd></div><div><dt>Last decision</dt><dd>${esc(data.runtime_detail.last_decision ?? "Unknown")}</dd></div><div><dt>Candidates evaluated</dt><dd>${esc(data.runtime_detail.candidates_evaluated ?? "Unknown")}</dd></div><div><dt>Q=0</dt><dd>${esc(data.runtime_detail.candidates_q_zero ?? "Unknown")}</dd></div><div><dt>Pending orders</dt><dd>${esc(data.runtime_detail.pending_orders ?? "Unknown")}</dd></div><div><dt>Unknown submissions</dt><dd>${esc(data.runtime_detail.unknown_submissions ?? "Unknown")}</dd></div></dl></section><section class="operator-readiness"><div><h2>Alpaca master PAPER</h2><p>Read-only checks cover account, clock, calendar, positions, contracts, market data, activities, and corporate actions. No order endpoint is called.</p></div><button id="verify-master" class="button secondary">Verify connection</button><div id="master-result" aria-live="polite"></div></section><div class="two-columns ops-columns"><section class="panel"><h2>Opportunity engine</h2><p>No live candidate feed is connected. Frontier outcomes, alternatives, next evaluation, and regret measures remain unavailable.</p>${badge("BLOCKED", "amber")}</section><section class="panel"><h2>Trading and ledger</h2><p>Execution is disabled. Persistent order, fill, Wheel lineage, and reconciliation views are waiting for runtime persistence.</p>${badge("BLOCKED", "amber")}</section><section class="panel"><h2>Copy engine</h2><p>Follower eligibility, follower-specific risk, sizing, execution, and reconciliation aren’t implemented.</p>${badge("BLOCKED", "amber")}</section><section class="panel"><h2>Release gates</h2><ul>${data.gates.map((g) => `<li>${esc(g)}</li>`).join("")}</ul></section></div><p class="caption">${esc(data.security)}</p>`;
    document.querySelector("#verify-master").addEventListener("click", async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      button.textContent = "Verifying…";
      const target = document.querySelector("#master-result");
      try {
        const readinessResponse = await fetch("/api/v1/operator/master-readiness", {
          method: "POST",
          signal: AbortSignal.timeout(30000),
        });
        const payload = await readinessResponse.json();
        if (!readinessResponse.ok && readinessResponse.status !== 207)
          throw new Error(payload.error?.message ?? "Verification unavailable.");
        const result = payload.data;
        target.innerHTML = `<p class="notice ${result.connection_state === "GOOD" ? "green" : "amber"}"><strong>${esc(result.connection_state)}</strong> · ${esc(result.masked_account ?? "Account identity unavailable")} · checked ${esc(result.checked_at ?? "unknown")}</p><dl class="capability-grid">${Object.entries(result.capabilities).map(([capability, state]) => `<div><dt>${esc(capability)}</dt><dd>${badge(state, state === "GOOD" ? "green" : "amber")}</dd></div>`).join("")}</dl>`;
      } catch (error) {
        target.innerHTML = `<p class="notice amber">${esc(error.message)} No order was submitted.</p>`;
      } finally {
        button.disabled = false;
        button.textContent = "Verify PAPER connection";
      }
    });
    document.querySelector("#logout").addEventListener("click", async () => {
      await fetch("/api/v1/operator/session", { method: "DELETE" });
      location.assign("/ops/login");
    });
    return true;
  }
  read().catch(() => {
    document.querySelector("#owner-error").textContent =
      "Owner service unavailable. Try again.";
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const token = form.elements.token.value;
    form.elements.token.value = "";
    const button = form.querySelector("button");
    button.disabled = true;
    try {
      const res = await fetch("/api/v1/operator/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok)
        throw new Error(
          "Access denied. An authorized operator credential is required.",
        );
      if (location.pathname !== "/ops") {
        location.assign("/ops");
        return;
      }
      if (!(await read()))
        throw new Error("Session unavailable. HTTPS is required.");
    } catch (error) {
      document.querySelector("#owner-error").textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
}

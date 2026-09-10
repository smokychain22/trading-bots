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
  return `<div class="page-heading"><div><p class="eyebrow">ACCOUNT</p><h1>Your paper account</h1><p class="lede">Connect an Alpaca Paper account to prepare for copy trading.</p></div>${badge("PAPER ONLY", "blue")}</div><section class="panel account-simple"><div class="account-connection"><div><span class="connection-mark" aria-hidden="true">A</span><div><h2>Alpaca Paper</h2><p>${connected ? `Connected · ${esc(readiness.follower_account.masked_account)}` : "Not connected"}</p></div></div>${badge(connected ? "CONNECTED" : "NOT CONNECTED", connected ? "green" : "")}</div>${connected ? `<dl class="account-facts"><div><dt>Buying power</dt><dd>—</dd></div><div><dt>Available cash</dt><dd>—</dd></div><div><dt>Options enabled</dt><dd>—</dd></div><div><dt>Last sync</dt><dd>—</dd></div></dl><button class="button secondary" disabled aria-describedby="disconnect-note">Disconnect</button><p id="disconnect-note" class="simple-status">Account management is being enabled.</p>` : `<p>Your brokerage account stays with Alpaca. This platform will request access only through Alpaca’s account connection flow.</p><button class="button primary" disabled aria-describedby="connect-note">Connect Alpaca Paper</button><p id="connect-note" class="simple-status">Alpaca Paper connection is being enabled.</p>`}</section>`;
}

export function paperCopyPage() {
  const number = (name, text, value, min, max, step = "1") =>
    `<label>${text}<input name="${name}" type="number" value="${value}" min="${min}" max="${max}" step="${step}" required></label>`;
  return `<div class="copy-heading"><div><p class="eyebrow">PAPER COPY SETUP</p><h2>Copy THETA</h2><p>Choose your paper account preferences. No order or broker authorization is created.</p></div>${badge("PAPER ONLY", "blue")}</div><ol class="copy-steps four" aria-label="Paper copy setup steps"><li><span>1</span>Connect account</li><li><span>2</span>Choose allocation</li><li><span>3</span>Choose risk</li><li><span>4</span>Review</li></ol><section class="connection-blocked"><div><p class="step-label">STEP 1</p><h3>Connect Alpaca Paper</h3><p>Alpaca Paper connection is being enabled.</p></div><button class="button primary" disabled aria-describedby="copy-connect-note">Connect Alpaca Paper</button><span id="copy-connect-note" class="sr-only">Connection is not available yet.</span></section><form id="copy-policy" class="copy-policy customer-copy-form"><section class="panel"><div class="section-heading"><div><p class="step-label">STEP 2</p><h2>Choose allocation</h2><p>How much paper buying power should THETA be allowed to use?</p></div><output id="allocation-output">$10,000</output></div><input type="hidden" name="allocation_usd" value="10000"><div class="allocation-choices" role="group" aria-label="Allocation"><button type="button" class="choice" data-allocation="5000">$5,000</button><button type="button" class="choice active" data-allocation="10000">$10,000</button><button type="button" class="choice" data-allocation="25000">$25,000</button><button type="button" class="choice" data-allocation="custom">Custom</button></div><label id="custom-allocation" hidden>Custom allocation ($)<input type="number" min="0" max="10000000" step="100" value="10000"></label></section><section class="panel"><p class="step-label">STEP 3</p><h2>Choose risk profile</h2><p>This preference helps shape your account limits. THETA’s risk engine always has final authority.</p><div class="risk-choices"><label><input type="radio" name="risk_profile" value="Conservative"><span><strong>Conservative</strong><small>Lower account limits</small></span></label><label><input type="radio" name="risk_profile" value="Balanced" checked><span><strong>Balanced</strong><small>Moderate account limits</small></span></label><label><input type="radio" name="risk_profile" value="Growth"><span><strong>Growth</strong><small>Higher account limits</small></span></label></div></section><details class="panel advanced-copy"><summary>Advanced settings</summary><p>Optional account-level limits. THETA’s strategy rules can’t be changed here.</p><div class="advanced-fields">${number("max_open_positions", "Maximum open positions", 3, 0, 1000)}${number("max_bot_capital_pct", "Maximum account allocation (%)", 25, 0, 100, "0.1")}${number("max_daily_loss_usd", "Daily loss limit ($)", 500, 0, 10000000)}${number("max_slippage_per_contract_usd", "Slippage preference per contract ($)", 10, 0, 100000, "0.01")}</div><label class="check-row locked"><input type="checkbox" name="join_existing_positions" disabled> Join existing positions</label><p class="caption">Join existing positions stays off. New trades only is the default.</p></details><button class="button primary review-button" type="submit">Review setup</button><p id="copy-error" role="alert"></p></form><section id="copy-review" class="panel copy-review" aria-live="polite"><p class="step-label">STEP 4</p><h2>Review</h2><p>Your paper-copy summary will appear here.</p></section>`;
}

export function bindPaperCopy() {
  const form = document.querySelector("#copy-policy");
  const allocation = form.elements.allocation_usd;
  const output = document.querySelector("#allocation-output");
  const custom = document.querySelector("#custom-allocation");
  const customInput = custom.querySelector("input");
  document.querySelectorAll("[data-allocation]").forEach((choice) => {
    choice.addEventListener("click", () => {
      document.querySelectorAll("[data-allocation]").forEach((item) => item.classList.toggle("active", item === choice));
      const isCustom = choice.dataset.allocation === "custom";
      custom.hidden = !isCustom;
      if (!isCustom) {
        allocation.value = choice.dataset.allocation;
        output.textContent = money(Number(allocation.value));
      } else {
        customInput.focus();
      }
    });
  });
  customInput.addEventListener("input", () => {
    allocation.value = customInput.value;
    output.textContent = money(Number(customInput.value));
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    document.querySelector("#copy-error").textContent = "";
    const data = new FormData(form);
    const riskProfile = data.get("risk_profile");
    const policy = {
      allocation_usd: Number(data.get("allocation_usd")),
      max_bot_capital_pct: Number(data.get("max_bot_capital_pct")),
      max_open_positions: Number(data.get("max_open_positions")),
      max_daily_loss_usd: Number(data.get("max_daily_loss_usd")),
      max_slippage_per_contract_usd: Number(data.get("max_slippage_per_contract_usd")),
      max_ticker_exposure_pct: 10,
      max_contracts: 1,
      min_dte: 7,
      max_dte: 60,
      min_open_interest: 500,
      allow_0dte: false,
    };
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
      document.querySelector("#copy-review").innerHTML = `<div class="section-heading"><div><p class="step-label">STEP 4</p><h2>Review your setup</h2></div>${badge("NOT ACTIVE")}</div><dl class="review-grid customer-review"><div><dt>Paper account</dt><dd>Alpaca</dd></div><div><dt>Allocation</dt><dd>${money(review.policy.allocation_usd)}</dd></div><div><dt>Risk</dt><dd>${esc(riskProfile)}</dd></div><div><dt>New trades only</dt><dd>Yes</dd></div></dl><button class="button primary" disabled aria-describedby="activation-note">Start Paper Copying</button><p id="activation-note" class="simple-status">Paper copying is being enabled. You can review this setup, but activation isn’t available yet.</p>`;
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
function opsGroup(title, description, entries) {
  return `<section class="panel ops-control-card"><div class="section-heading"><div><h2>${esc(title)}</h2><p>${esc(description)}</p></div></div><dl>${entries.map(([name, value, tone = ""]) => `<div><dt>${esc(name)}</dt><dd>${badge(value, tone)}</dd></div>`).join("")}</dl></section>`;
}
export function bindOwner() {
  const form = document.querySelector("#owner-login");
  async function read() {
    const res = await fetch("/api/v1/operator/status", {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return false;
    const { data } = await res.json();
    const system = (name) => data.systems[name] ?? "UNKNOWN";
    const tone = (value) => value === "HEALTHY" ? "green" : value === "BLOCKED" ? "amber" : "";
    const runtimeGroups = [
      opsGroup("Market and decisions", "Live runtime evidence and opportunity selection.", [
        ["Market snapshot", data.runtime_detail.last_market_snapshot ?? "UNKNOWN"],
        ["Candidate scan", data.runtime_detail.last_scan ?? "UNKNOWN"],
        ["Router decision", data.runtime_detail.last_decision ?? "UNKNOWN"],
        ["Opportunity count", data.runtime_detail.candidates_passing ?? "UNKNOWN"],
        ["WAIT and PASS reasons", data.runtime_detail.candidates_waiting ?? "UNKNOWN"],
        ["AEGIS", system("aegis"), tone(system("aegis"))],
      ]),
      opsGroup("Execution and reconciliation", "Orders remain disabled. Unknown broker state is never treated as success.", [
        ["Execution", system("execution"), tone(system("execution"))],
        ["Open option orders", data.runtime_detail.pending_orders ?? "UNKNOWN"],
        ["Partial fills", "UNKNOWN"],
        ["Unknown submissions", data.runtime_detail.unknown_submissions ?? "UNKNOWN"],
        ["Reconciliation", system("reconciliation"), tone(system("reconciliation"))],
        ["Assignments and recovery", "UNKNOWN"],
      ]),
      opsGroup("Economic record", "Whole-chain accounting and performance evidence.", [
        ["Ledger", system("ledger"), tone(system("ledger"))],
        ["Whole-chain P&L", "UNKNOWN"],
        ["Win rate", "UNKNOWN"],
        ["Profit factor", "UNKNOWN"],
        ["Drawdown", "UNKNOWN"],
        ["After-cost EV", "UNKNOWN"],
        ["Slippage and fill quality", "UNKNOWN"],
      ]),
      opsGroup("Copy engine", "Follower accounts, safety checks, and child-order state.", [
        ["Copy runtime", system("copy_engine"), tone(system("copy_engine"))],
        ["Followers", system("followers"), tone(system("followers"))],
        ["Follower sizing", "BLOCKED", "amber"],
        ["Child orders", "BLOCKED", "amber"],
        ["Follower reconciliation", "BLOCKED", "amber"],
      ]),
      opsGroup("Infrastructure", "Services required for a repeatable paper runtime.", [
        ["Scheduler", system("scheduler"), tone(system("scheduler"))],
        ["Python bridge", system("python_bridge"), tone(system("python_bridge"))],
        ["Worker jobs", "UNKNOWN"],
        ["Database state", "UNKNOWN"],
        ["Provider freshness", system("market_data"), tone(system("market_data"))],
        ["Errors and incidents", system("system_errors"), tone(system("system_errors"))],
      ]),
    ].join("");
    form.hidden = true;
    document.querySelector("#owner-data").innerHTML =
      `<div class="section-heading"><div><p class="eyebrow">SYSTEM STATE</p><h2>Is THETA working?</h2></div><button id="logout" class="button secondary">Sign out</button></div><div class="ops-health">${Object.entries(data.systems).map(([name, state]) => `<article><span>${esc(name.replaceAll("_", " "))}</span>${badge(state, tone(state))}</article>`).join("")}</div><section class="ops-section"><div class="section-heading"><div><h2>THETA engine</h2><p>R1 is partial. Deterministic contracts and models exist, while runtime I/O remains gated.</p></div>${badge(data.runtime_detail.stage, "amber")}</div><dl class="capability-grid"><div><dt>Bot mode</dt><dd>${badge(data.bot_mode, "blue")}</dd></div><div><dt>Trading</dt><dd>${badge(data.trading, "amber")}</dd></div><div><dt>Copy</dt><dd>${badge(data.copy, "amber")}</dd></div><div><dt>Policy version</dt><dd>${esc(data.runtime_detail.policy_version ?? "Not active")}</dd></div><div><dt>Last snapshot</dt><dd>${esc(data.runtime_detail.last_market_snapshot ?? "Unknown")}</dd></div><div><dt>Last scan</dt><dd>${esc(data.runtime_detail.last_scan ?? "Unknown")}</dd></div><div><dt>Last decision</dt><dd>${esc(data.runtime_detail.last_decision ?? "Unknown")}</dd></div><div><dt>Candidates evaluated</dt><dd>${esc(data.runtime_detail.candidates_evaluated ?? "Unknown")}</dd></div></dl></section><section class="operator-readiness"><div><h2>Alpaca master PAPER</h2><p>Run read-only checks for account, clock, calendar, positions, contracts, market data, activities, and corporate actions.</p></div><button id="verify-master" class="button secondary">Verify PAPER connection</button><div id="master-result" aria-live="polite"></div></section><div class="ops-control-grid">${runtimeGroups}</div><section class="panel release-gates"><h2>Release gates</h2><ul>${data.gates.map((g) => `<li>${esc(g)}</li>`).join("")}</ul></section><p class="caption">${esc(data.security)}</p>`;
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

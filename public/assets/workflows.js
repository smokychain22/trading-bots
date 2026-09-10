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
  return `<div class="section-heading"><div><p class="eyebrow">ILLUSTRATIVE SCENARIO</p><h2>Simulate your capital</h2><p>Explore the effect of size and assignment. These inputs are hypothetical, not a strategy forecast.</p></div>${badge("DEMO DATA", "demo")}</div><div class="two-columns"><form class="panel simulation-form" id="simulation"><fieldset><legend>1. Your illustration</legend>${field("capital", "Available capital ($)", 10000, 0, 10000000)}${field("strike", "Put strike ($ per share)", 50, 0.01, 100000, "0.01")}${field("premium", "Assumed opening premium ($ per share)", 1.5, 0, 100000, "0.01")}${field("stock_at_exit", "Stock value at expiry ($ per share)", 45, 0, 100000, "0.01")}${field("max_contracts", "Maximum contracts", 1, 0, 1000)}${field("costs_per_contract", "Total modeled fees and slippage ($ per contract)", 2, 0, 10000, "0.01")}${field("dte", "Contract days to expiry", 30, 1, 730)}</fieldset><fieldset><legend>2. Copy preferences for later</legend><p class="caption">Preferences are saved with the local draft. They are not enforced against a broker. Copy trading is unavailable.</p>${field("min_dte", "Minimum DTE", 7, 1, 730)}${field("max_dte", "Maximum DTE", 60, 1, 730)}${field("max_daily_loss", "Maximum daily loss preference ($)", 500, 0, 10000000)}${field("max_slippage", "Maximum slippage preference ($ per share)", 0.1, 0, 100, "0.01")}${field("min_open_interest", "Minimum open interest preference", 500, 0, 100000000)}<div class="control-note"><strong>0DTE blocked</strong><p>Same-day expiry is outside this THETA illustration.</p></div><div class="control-note"><strong>Start with new positions only</strong><p>Existing positions cannot be joined. Any later copy service must reconcile each user’s own fills, collateral and inventory.</p></div></fieldset><button class="button primary" type="submit">Calculate illustration</button><p id="simulation-error" role="alert"></p></form><section class="panel simulation-output" aria-live="polite"><h2>Your scenario</h2><p>Enter your assumptions, then calculate. Quantity can be zero when capital or limits do not allow a contract.</p><div id="simulation-result"></div></section></div>`;
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
    const input = Object.fromEntries(
      [...new FormData(form)].map(([k, v]) => [k, Number(v)]),
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
      document.querySelector("#simulation-result").innerHTML =
        `${badge("DEMO DATA", "demo")}<h3>${r.quantity === 0 ? "WAIT · Quantity zero" : `${r.quantity} illustrative contract${r.quantity > 1 ? "s" : ""}`}</h3>${table(
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
        )}<p>${r.assignment_assumed ? "This simplified scenario assumes assignment because the stock value is below strike." : "This simplified scenario assumes expiration without assignment."}</p><p>${r.quantity === 0 ? "Capital, maximum quantity or DTE preferences prevented the illustration from sizing a contract." : ""}</p><details open><summary>Assumptions & limitations</summary><ul>${r.limitations.map((s) => `<li>${esc(s)}</li>`).join("")}</ul></details><button class="button secondary" id="save-plan">Save local draft</button><p id="save-result" role="status"></p>`;
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

export function ownerPage() {
  return `<div class="page-heading"><div><p class="eyebrow">PRIVATE WORKSPACE</p><h1>Owner access</h1><p class="lede">Release visibility for authorized operators.</p></div>${badge("READ ONLY", "blue")}</div><section class="panel owner-panel"><form id="owner-login"><label>Operator access key<input type="password" name="token" required minlength="32" autocomplete="off" spellcheck="false"></label><p class="caption">Use the existing operator credential. It is sent only to this origin, never stored in browser storage, and exchanged for a 15-minute HttpOnly session.</p><button class="button primary">Open owner workspace</button><p id="owner-error" role="alert"></p></form><div id="owner-data"></div></section>`;
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
      `<div class="section-heading"><h2>Release & operational visibility</h2><button id="logout" class="button secondary">Sign out</button></div><dl class="facts"><div><dt>Website</dt><dd>${esc(data.website)}</dd></div><div><dt>Bot environment</dt><dd>${esc(data.bot_mode)}</dd></div><div><dt>Order execution</dt><dd>${esc(data.trading)}</dd></div><div><dt>Copy service</dt><dd>${esc(data.copy)}</dd></div><div><dt>Current provider state</dt><dd>${esc(data.provider_runtime)}</dd></div><div><dt>Deployment</dt><dd class="mono">${esc(data.deployment_sha ?? "Local development")}</dd></div></dl><h3>Release gates</h3><ul>${data.gates.map((g) => `<li>${esc(g)}</li>`).join("")}</ul><p>${esc(data.security)}</p>`;
    document.querySelector("#logout").addEventListener("click", async () => {
      await fetch("/api/v1/operator/session", { method: "DELETE" });
      location.reload();
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
      if (!(await read()))
        throw new Error("Session unavailable. HTTPS is required.");
    } catch (error) {
      document.querySelector("#owner-error").textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
}

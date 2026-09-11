import { esc, money, date, badge, link, table } from "./ui.js";

function paperApiKeyForm() {
  return `<form id="paper-api-key-connect" class="customer-auth broker-credential-form"><div class="form-intro"><h3>Connect Alpaca Paper</h3><p>Use the API credentials from your Alpaca Paper account. Your credentials are encrypted server-side and are never shown again after connection.</p><p class="notice blue"><strong>Paper API credentials only.</strong> Do not enter your Alpaca website password.</p></div><label>Paper API Key ID<input name="api_key_id" type="text" autocomplete="off" spellcheck="false" data-lpignore="true" data-1p-ignore required maxlength="256"></label><label>Paper Secret Key<input name="secret_key" type="password" autocomplete="new-password" spellcheck="false" data-lpignore="true" data-1p-ignore required maxlength="512"></label><button class="button primary" type="submit">Connect Paper Account</button><p class="caption">Verification uses paper-api.alpaca.markets. Order submission remains locked.</p><p id="paper-connect-result" role="alert"></p></form>`;
}

function bindPaperCredentialForm() {
  document.querySelector("#paper-api-key-connect")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("[type=submit]");
    const result = form.querySelector("#paper-connect-result");
    button.disabled = true;
    button.textContent = "Verifying Paper account…";
    try {
      const response = await fetch("/api/v1/alpaca/connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(new FormData(form))),
        signal: AbortSignal.timeout(20000),
      });
      const body = await response.json();
      if (!response.ok) {
        const messages = {
          INVALID_AUTH: "We couldn’t verify this Alpaca Paper account. Check the Paper API key and secret and try again.",
          ACCOUNT_NOT_READY: "This Paper account is connected, but its options permissions do not currently meet THETA’s requirements.",
          ALPACA_PAPER_HOST_REJECTED: "This private test currently supports Alpaca Paper accounts only.",
          AMBIGUOUS_NETWORK: "Alpaca is temporarily unavailable. Your saved connection has not been changed.",
          RATE_LIMITED: "Alpaca is temporarily unavailable. Your saved connection has not been changed.",
          BROKER_REJECTED: "Alpaca is temporarily unavailable. Your saved connection has not been changed.",
          CONNECTION_SERVICE_UNAVAILABLE: "The secure connection service is temporarily unavailable. No credential was stored.",
        };
        throw new Error(messages[body.error?.code] ?? "The Paper account could not be verified.");
      }
      form.reset();
      result.textContent = "Alpaca Paper connected. No order was submitted.";
      setTimeout(() => location.reload(), 500);
    } catch (error) {
      result.textContent = error.name === "TimeoutError" ? "Alpaca verification timed out. No credential was stored." : error.message;
    } finally {
      button.disabled = false;
      button.textContent = "Connect Paper Account";
    }
  });
}

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
  const connected = readiness.follower_account.connected === true;
  const ready = readiness.follower_account.ready_for_theta === true;
  const params = new URL(location.href).searchParams;
  const loginRequired = readiness.private_paper_api_key?.state === "CUSTOMER_LOGIN_REQUIRED" || readiness.oauth.state === "CUSTOMER_LOGIN_REQUIRED";
  const authMode = params.get("authMode") === "register" ? "register" : "login";
  const requestedReturn = params.get("returnTo") === "/bots/theta/copy" ? "/bots/theta/copy" : "/account";
  const value = (input, formatter = String) =>
    input == null ? "—" : formatter(input);
  const apiKeyForm = paperApiKeyForm();
  const connect = readiness.private_paper_api_key?.state === "READY"
    ? apiKeyForm
    : readiness.oauth.state === "READY"
      ? `<a class="button primary" href="/api/v1/alpaca/oauth/start">Connect with Alpaca OAuth</a>`
    : loginRequired
      ? `<form id="customer-auth" class="customer-auth"><div class="form-intro"><h2>Sign in to Trading Bots</h2><p>First sign in to your Trading Bots tester account. After signing in, you’ll securely connect your Alpaca Paper account.</p><p class="caption">These are your Trading Bots account details. They are not Alpaca credentials.</p></div><div class="auth-mode" role="group" aria-label="Trading Bots account action"><button type="button" class="choice ${authMode === "login" ? "active" : ""}" data-auth-mode="login">Sign in</button><button type="button" class="choice ${authMode === "register" ? "active" : ""}" data-auth-mode="register">Create tester account</button></div><input type="hidden" name="return_to" value="${esc(requestedReturn)}"><label>Trading Bots email<input name="email" type="email" autocomplete="email" required></label><label>Trading Bots password<input name="password" type="password" autocomplete="${authMode === "register" ? "new-password" : "current-password"}" minlength="12" required></label><button class="button primary" type="submit">${authMode === "register" ? "Create tester account" : "Sign in"}</button><p id="auth-result" role="alert"></p></form>`
      : `<button class="button primary" disabled>Connect Alpaca</button><p class="simple-status">THETA is in private paper testing. Account connection opens after Alpaca Connect approval.</p>`;
  const headingTitle = loginRequired ? "Sign in to Trading Bots" : "Your paper account";
  const headingCopy = loginRequired
    ? "Authenticate your tester identity first. Your Alpaca Paper API credentials are entered in the next step."
    : "Connect Alpaca Paper so THETA can prepare follower-specific paper trades within your chosen amount.";
  return `<div class="page-heading"><div><p class="eyebrow">ACCOUNT</p><h1>${headingTitle}</h1><p class="lede">${headingCopy}</p></div>${badge("PAPER ONLY", "blue")}</div><section class="panel account-simple">${loginRequired ? "" : `<div class="account-connection"><div><span class="connection-mark" aria-hidden="true">A</span><div><h2>Alpaca Paper</h2><p>${connected ? `Connected · ${esc(readiness.follower_account.masked_account ?? "Paper account")}` : "Not connected"}</p></div></div>${badge(connected ? (ready ? "READY" : "NEEDS ATTENTION") : "NOT CONNECTED", connected ? (ready ? "green" : "amber") : "")}</div>`}${connected ? `<dl class="account-facts"><div><dt>Account status</dt><dd>${value(readiness.follower_account.account_status)}</dd></div><div><dt>Paper equity</dt><dd>${value(readiness.follower_account.equity, money)}</dd></div><div><dt>Cash</dt><dd>${value(readiness.follower_account.cash, money)}</dd></div><div><dt>Buying power</dt><dd>${value(readiness.follower_account.buying_power, money)}</dd></div><div><dt>Options buying power</dt><dd>${value(readiness.follower_account.options_buying_power, money)}</dd></div><div><dt>Options approval</dt><dd>${value(readiness.follower_account.options_approved_level, (v) => `Level ${v}`)}</dd></div><div><dt>Options trading level</dt><dd>${value(readiness.follower_account.options_trading_level, (v) => `Level ${v}`)}</dd></div><div><dt>Open positions</dt><dd>${value(readiness.follower_account.open_positions)}</dd></div><div><dt>Open orders</dt><dd>${value(readiness.follower_account.open_orders)}</dd></div><div><dt>Market</dt><dd>${readiness.follower_account.market_open == null ? "—" : readiness.follower_account.market_open ? "Open" : "Closed"}</dd></div><div><dt>Last verified</dt><dd>${value(readiness.follower_account.verified_at ?? readiness.follower_account.last_sync_at, date)}</dd></div></dl>${ready ? "" : '<p class="notice amber">This Paper account is connected, but its options permissions do not currently meet THETA’s requirements.</p>'}<div class="heading-actions"><button id="verify-account" class="button primary">Reverify</button><button id="disconnect-account" class="button secondary">Disconnect</button><button id="customer-signout" class="button quiet">Sign out</button></div>${readiness.private_paper_api_key?.state === "READY" ? `<details class="advanced-copy"><summary>Replace credentials</summary>${apiKeyForm}</details>` : ""}<p id="account-result" role="status"></p>` : `${loginRequired ? "" : "<p>Your credentials stay encrypted on this server and are used only with Alpaca Paper.</p>"}${connect}`}</section>`;
}

export function bindAccount() {
  let mode = document.querySelector("[data-auth-mode].active")?.dataset.authMode ?? "login";
  document.querySelectorAll("[data-auth-mode]").forEach((button) => button.addEventListener("click", () => {
    mode = button.dataset.authMode;
    document.querySelectorAll("[data-auth-mode]").forEach((item) => item.classList.toggle("active", item === button));
    const submit = document.querySelector("#customer-auth [type=submit]");
    submit.textContent = mode === "login" ? "Sign in" : "Create tester account";
    const password = document.querySelector("#customer-auth [name=password]");
    password.autocomplete = mode === "login" ? "current-password" : "new-password";
  }));
  document.querySelector("#customer-auth")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const result = document.querySelector("#auth-result");
    const body = Object.fromEntries(new FormData(form));
    try {
      const response = await fetch(`/api/v1/auth/${mode}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json();
      if (!response.ok) throw new Error(response.status === 409 ? "An account already exists for this email." : "Sign in wasn’t completed.");
      location.assign(payload.data.return_to);
    } catch (error) { result.textContent = error.message; }
  });
  bindPaperCredentialForm();
  document.querySelector("#disconnect-account")?.addEventListener("click", async () => {
    const result = document.querySelector("#account-result");
    const response = await fetch("/api/v1/alpaca/connection", { method: "DELETE" });
    result.textContent = response.ok ? "Alpaca Paper disconnected." : "The account couldn’t be disconnected.";
    if (response.ok) location.reload();
  });
  document.querySelector("#verify-account")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const result = document.querySelector("#account-result");
    button.disabled = true;
    button.textContent = "Verifying…";
    try {
      const response = await fetch("/api/v1/alpaca/connection/verify", { method: "POST", signal: AbortSignal.timeout(15000) });
      result.textContent = response.ok ? "Alpaca Paper connection verified. No order was submitted." : "The connection needs attention. Reconnect Alpaca Paper if this continues.";
      if (response.ok) setTimeout(() => location.reload(), 600);
    } catch {
      result.textContent = "Verification is unavailable right now. No order was submitted.";
    } finally {
      button.disabled = false;
      button.textContent = "Reverify";
    }
  });
  document.querySelector("#customer-signout")?.addEventListener("click", async () => {
    await fetch("/api/v1/auth/session", { method: "DELETE" });
    location.assign("/account");
  });
}

export function paperCopyPage(readiness) {
  const saved = readiness.saved_policy;
  const recommended = !saved || saved.limit_mode === "RECOMMENDED";
  const amount = saved?.allocation_usd ?? 10000;
  const limit = (name, text, max, step = "1") => {
    const value = saved?.[name] ?? null;
    const custom = !recommended && value !== null;
    return `<div><label>${text}<select data-limit="${name}" ${recommended ? "disabled" : ""}><option value="none" ${!custom ? "selected" : ""}>No additional user limit</option><option value="custom" ${custom ? "selected" : ""}>Set my own limit</option></select></label><label ${custom ? "" : "hidden"} data-limit-field="${name}">${text}, custom value<input name="${name}" type="number" min="0" max="${max}" step="${step}" value="${value ?? ""}" ${custom ? "required" : "disabled"}></label></div>`;
  };
  const connected = readiness.follower_account.connected === true;
  const ready = readiness.follower_account.ready_for_theta === true;
  const status = new URL(location.href).searchParams.get("connection");
  if (readiness.follower_account.account_role === "MASTER_THETA_PAPER")
    return `<section class="panel copy-focus"><h2>THETA Paper master account</h2><p>This account is designated for THETA. It cannot copy itself. Use a separate Paper account to test follower copying.</p><p>Order submission remains locked.</p>${link("/account", "View account", "button secondary")}</section>`;
  if (!connected) {
    const action = readiness.private_paper_api_key?.state === "READY"
      ? paperApiKeyForm()
      : readiness.oauth.state === "READY"
        ? `<a class="button primary" href="/api/v1/alpaca/oauth/start">Connect with Alpaca OAuth</a>`
      : readiness.private_paper_api_key?.state === "CUSTOMER_LOGIN_REQUIRED" || readiness.oauth.state === "CUSTOMER_LOGIN_REQUIRED"
        ? `<div class="signin-first"><h3>Sign in to Trading Bots</h3><p>First sign in to your Trading Bots tester account. After signing in, you’ll securely connect your Alpaca Paper account.</p><div class="heading-actions">${link("/account?signin=required&returnTo=%2Fbots%2Ftheta%2Fcopy", "Sign in", "button primary")}${link("/account?signin=required&authMode=register&returnTo=%2Fbots%2Ftheta%2Fcopy", "Create tester account", "button secondary")}</div><p class="caption">Use your Trading Bots email and password here. Alpaca Paper API credentials come next.</p></div>`
        : `<button class="button primary" disabled>Connect Alpaca</button><p class="simple-status">THETA is in private paper testing. Account connection opens after Alpaca Connect approval.</p>`;
    const message = status === "denied" ? "Connection was canceled." : status === "invalid" ? "That connection request expired. Start again." : status === "failed" ? "Alpaca couldn’t be verified." : "Connect your Alpaca Paper account.";
    return `<div class="copy-heading"><div><p class="eyebrow">PAPER COPY SETUP</p><h2>Copy THETA</h2><p>Connect, choose an amount, then review.</p></div>${badge("PAPER ONLY", "blue")}</div><section class="panel copy-focus"><p class="step-label">STEP 1 OF 3</p><h2>Connect Alpaca</h2><p>${esc(message)}</p>${action}</section>`;
  }
  if (!ready) {
    return `<div class="copy-heading"><div><p class="eyebrow">PAPER COPY SETUP</p><h2>Copy THETA</h2><p>Your Alpaca Paper account is connected, but needs attention.</p></div>${badge("NEEDS ATTENTION", "amber")}</div><section class="panel copy-focus"><p class="step-label">STEP 1 OF 3</p><h2>Verify account readiness</h2><p>THETA requires options level 1 or higher for cash-secured puts. Recheck your connection before choosing an amount.</p>${link("/account", "Review account", "button primary")}</section>`;
  }
  return `<div class="copy-heading"><div><p class="eyebrow">PAPER COPY SETUP</p><h2>Copy THETA</h2><p>Your Alpaca Paper account is connected.</p></div>${badge("CONNECTED", "green")}</div>
    <form id="copy-policy" class="copy-policy customer-copy-form" data-saved-policy="${esc(JSON.stringify(saved ?? {}))}"><section class="panel copy-focus">
    <div class="section-heading"><div><p class="step-label">STEP 2 OF 3</p><h2>How much should THETA use?</h2><p>THETA manages position sizing, entries and exits within this amount.</p></div><output id="allocation-output">${money(amount)}</output></div>
    <input type="hidden" name="allocation_usd" value="${amount}"><div class="allocation-choices" role="group" aria-label="Allocation">${[5000,10000,25000].map((value) => `<button type="button" class="choice ${amount === value ? "active" : ""}" data-allocation="${value}">${money(value)}</button>`).join("")}<button type="button" class="choice" data-allocation="custom">Custom</button></div>
    <label id="custom-allocation" hidden>Custom allocation ($)<input type="number" min="0" max="10000000" step="0.01" value="${amount}"></label>
    <label><input type="checkbox" id="recommended-limits" ${recommended ? "checked" : ""}> Use THETA recommended account limits</label>
    <details class="advanced-copy"><summary>Advanced account limits</summary><p>These limits are optional. THETA still applies its own trading and risk controls. Zero means no permission, not unlimited.</p><div class="advanced-fields">${limit("max_open_positions", "Maximum open positions", 1000)}${limit("max_bot_capital_pct", "Maximum account allocation (%)", 100, "0.1")}${limit("max_daily_loss_usd", "Daily loss pause ($)", 10000000, "0.01")}${limit("max_slippage_per_contract_usd", "Price protection ($ per contract)", 100000, "0.01")}</div></details>
    <button class="button primary review-button" type="submit">Continue</button><p id="copy-error" role="alert"></p></section></form><section id="copy-review" class="panel copy-review" aria-live="polite" hidden></section>`;
}

export function bindPaperCopy() {
  bindPaperCredentialForm();
  const form = document.querySelector("#copy-policy");
  if (!form) return;
  const allocation = form.elements.allocation_usd;
  const output = document.querySelector("#allocation-output");
  const custom = document.querySelector("#custom-allocation");
  const customInput = custom.querySelector("input");
  const recommended = document.querySelector("#recommended-limits");
  const savedPolicy = JSON.parse(form.dataset.savedPolicy);
  const updateLimits = () => form.querySelectorAll("[data-limit]").forEach((select) => {
    select.disabled = recommended.checked;
    const field = form.querySelector(`[data-limit-field="${select.dataset.limit}"]`);
    const enabled = !recommended.checked && select.value === "custom";
    field.hidden = !enabled;
    field.querySelector("input").disabled = !enabled;
    field.querySelector("input").required = enabled;
  });
  recommended.addEventListener("change", updateLimits);
  form.querySelectorAll("[data-limit]").forEach((select) => select.addEventListener("change", updateLimits));
  document.querySelectorAll("[data-allocation]").forEach((choice) => {
    choice.addEventListener("click", () => {
      document.querySelectorAll("[data-allocation]").forEach((item) => item.classList.toggle("active", item === choice));
      const isCustom = choice.dataset.allocation === "custom";
      custom.hidden = !isCustom;
      customInput.required = isCustom;
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
    const optionalLimit = (name) => {
      if (recommended.checked || form.querySelector(`[data-limit="${name}"]`).value !== "custom") return null;
      const value = data.get(name);
      return value === null || String(value).trim() === "" ? null : Number(value);
    };
    const policy = {
      allocation_usd: Number(data.get("allocation_usd")),
      limit_mode: recommended.checked ? "RECOMMENDED" : "CUSTOM",
      max_bot_capital_pct: optionalLimit("max_bot_capital_pct"),
      max_open_positions: optionalLimit("max_open_positions"),
      max_daily_loss_usd: optionalLimit("max_daily_loss_usd"),
      max_slippage_per_contract_usd: optionalLimit("max_slippage_per_contract_usd"),
      ...Object.fromEntries(["max_ticker_exposure_pct","max_contracts","min_dte","max_dte","min_open_interest"].map((name) => [name, recommended.checked ? null : savedPolicy[name] ?? null])),
      allow_0dte: recommended.checked ? false : savedPolicy.allow_0dte ?? false,
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
      form.hidden = true;
      const target = document.querySelector("#copy-review");
      target.hidden = false;
      target.innerHTML = `<div class="section-heading"><div><p class="step-label">STEP 3 OF 3</p><h2>Review</h2></div>${badge("PAPER", "blue")}</div><dl class="review-grid customer-review"><div><dt>Bot</dt><dd>THETA</dd></div><div><dt>Account</dt><dd>Alpaca Paper, connected</dd></div><div><dt>Amount</dt><dd>${money(review.policy.allocation_usd)}</dd></div><div><dt>Copy status</dt><dd>Prepared, execution locked</dd></div></dl><p>Save this paper allocation now. THETA will not submit an order until paper execution is separately released.</p><button id="start-copying" class="button primary">Save setup</button><p id="activation-note" class="simple-status">Saving this setup cannot place an order.</p>`;
      document.querySelector("#start-copying")?.addEventListener("click", async () => {
        const start = document.querySelector("#start-copying");
        start.disabled = true;
        const response = await fetch("/api/v1/copy/participation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(review.policy) });
        document.querySelector("#activation-note").textContent = response.ok
          ? "Your paper-copy setup was saved. Order submission is still locked."
          : "Your setup couldn’t be saved.";
        if (response.ok) setTimeout(() => location.assign("/my-bots"), 600);
      });
    } catch (error) {
      document.querySelector("#copy-error").textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
}

export function ownerPage() {
  return `<div><section class="panel owner-panel"><form id="owner-login"><div class="page-heading"><div><p class="eyebrow">PRIVATE OPERATIONS</p><h1>THETA operations</h1><p class="lede">Runtime, provider, execution, accounting, and copy readiness.</p></div>${badge("READ ONLY", "blue")}</div><h2>Authorized access</h2><label>Operator access key<input type="password" name="token" required minlength="32" autocomplete="off" spellcheck="false"></label><p class="caption">The credential is exchanged for a 15-minute HttpOnly session and is never stored in browser storage.</p><button class="button primary">Open operations</button><p id="owner-error" role="alert"></p></form></section><div id="owner-data"></div></div>`;
}
function opsGroup(title, description, entries) {
  return `<section class="panel ops-control-card"><div class="section-heading"><div><h2>${esc(title)}</h2><p>${esc(description)}</p></div></div><dl>${entries.map(([name, value, tone = ""]) => `<div><dt>${esc(name)}</dt><dd>${badge(value, tone)}</dd></div>`).join("")}</dl></section>`;
}
export function bindOwner() {
  const form = document.querySelector("#owner-login");
  const page = location.pathname;
  const systemTone = (value) =>
    value === "HEALTHY" || value === "GOOD" || value === "CONNECTED" || value === "READY"
      ? "green"
      : value === "BLOCKED" || value === "DEGRADED"
        ? "amber"
        : "";
  const signOut =
    '<button id="logout" class="button secondary">Sign out</button>';
  const readinessPanel = () =>
    `<section class="operator-readiness"><div><h2>Readiness verification</h2><p>Run independent read-only checks from the deployed server.</p></div><div class="heading-actions"><button id="verify-master" class="button secondary">Verify Alpaca Paper</button><button id="verify-optionomics" class="button secondary">Verify Optionomics</button><button id="verify-database" class="button secondary">Verify database</button></div><div id="master-result" aria-live="polite"></div><div id="optionomics-result" aria-live="polite"></div><div id="database-result" aria-live="polite"></div></section>`;

  function renderPage(data) {
    const system = (name) => data.systems[name] ?? "UNKNOWN";
    const title = `<div class="section-heading"><div><p class="eyebrow">PRIVATE OPERATIONS</p><h1>${page === "/ops" ? "Operations overview" : page === "/ops/theta" ? "THETA engine" : page === "/ops/trading" ? "Trading operations" : page === "/ops/copy" ? "Follower copy" : "System readiness"}</h1></div>${signOut}</div>`;
    if (page === "/ops/theta")
      return `${title}<div class="ops-control-grid">${opsGroup("Current action", "No action is inferred without a running scheduler and persisted decision.", [["Last decision", data.runtime_detail.last_decision ?? "UNKNOWN"], ["Next scan", data.runtime_detail.next_scan ?? "UNKNOWN"], ["AEGIS", system("aegis"), systemTone(system("aegis"))], ["Execution authority", data.trading, "amber"]])}${opsGroup("Decision pipeline", "Deterministic contracts exist. Runtime inputs and orchestration remain gated.", [["Runtime stage", data.runtime_detail.stage, "amber"], ["Last snapshot", data.runtime_detail.last_market_snapshot ?? "UNKNOWN"], ["Last scan", data.runtime_detail.last_scan ?? "UNKNOWN"], ["Candidates evaluated", data.runtime_detail.candidates_evaluated ?? "UNKNOWN"], ["Policy version", data.runtime_detail.policy_version ?? "NOT ACTIVE"]])}${opsGroup("Economic truth", "Whole-chain accounting includes option and assigned-stock economics.", [["Ledger runtime", system("ledger"), systemTone(system("ledger"))], ["Whole-chain P&L", "UNKNOWN"], ["Drawdown", "UNKNOWN"], ["After-cost EV", "UNKNOWN"], ["Open inventory MTM", "UNKNOWN"]])}</div>`;
    if (page === "/ops/trading")
      return `${title}${readinessPanel()}<div class="ops-control-grid">${opsGroup("Positions", "Broker-reconciled master PAPER exposure only.", [["Open positions", data.runtime_detail.open_positions ?? "UNKNOWN"], ["Assignment inventory", "UNKNOWN"], ["Recovery positions", "UNKNOWN"], ["Corporate actions", "UNKNOWN"]])}${opsGroup("Orders and fills", "The adapter is ready, but release flags stay locked and no order mutation is exposed.", [["Master paper execution", data.execution_control.master_paper_execution, "amber"], ["Pause new orders", data.execution_control.pause_new_orders ? "ON" : "OFF", data.execution_control.pause_new_orders ? "amber" : "green"], ["Pending orders", data.runtime_detail.pending_orders ?? "UNKNOWN"], ["Partial fills", "UNKNOWN"], ["Unknown submissions", data.runtime_detail.unknown_submissions ?? "UNKNOWN"], ["Reconciliation", system("reconciliation"), systemTone(system("reconciliation"))]])}</div>`;
    if (page === "/ops/copy")
      return `${title}<div class="ops-control-grid">${opsGroup("Copy engine", "Follower intent contracts and the shared PAPER adapter are present. Broker submission remains locked.", [["Contract", "READY", "green"], ["Database", data.database.state, systemTone(data.database.state)], ["Execution", system("copy_engine"), systemTone(system("copy_engine"))], ["Follower execution", data.execution_control.follower_paper_execution, "amber"], ["Quantity zero", "VALID", "green"]])}${opsGroup("Followers", "Connections remain tenant-scoped and independently verified.", [["Connected followers", data.database.active_followers ?? "UNKNOWN"], ["Private beta followers", data.copy_platform.private_paper_beta.follower_count], ["Alpaca Connect", data.copy_platform.oauth], ["Token vault", data.copy_platform.token_vault], ["Follower adapter", data.copy_platform.follower_broker_adapter]])}${opsGroup("Private Paper Beta", data.copy_platform.private_paper_beta.reason, [["State", data.copy_platform.private_paper_beta.state, "amber"], ["Policy", data.copy_platform.private_paper_beta.policy_status, "amber"], ["Raw-key endpoint", "UNAVAILABLE"], ["Public raw-key form", "PROHIBITED"]])}</div>`;
    if (page === "/ops/system")
      return `${title}<div class="ops-health">${Object.entries(data.systems).map(([name, state]) => `<article><span>${esc(name.replaceAll("_", " "))}</span>${badge(state, systemTone(state))}</article>`).join("")}</div>${readinessPanel()}<section class="panel release-gates"><h2>Release gates</h2><ul>${data.gates.map((gate) => `<li>${esc(gate)}</li>`).join("")}</ul></section><p class="caption">${esc(data.security)}</p>`;
    return `${title}<section class="ops-section"><div class="section-heading"><div><h2>THETA runtime</h2><p>Provider checks run independently. Order submission remains locked.</p></div>${badge(data.runtime_detail.stage, "amber")}</div><dl class="capability-grid"><div><dt>Website</dt><dd>${badge(data.website, "blue")}</dd></div><div><dt>Master mode</dt><dd>${badge(data.bot_mode, "blue")}</dd></div><div><dt>THETA Shadow</dt><dd>${badge("READY, NOT RUNNING", "amber")}</dd></div><div><dt>Execution</dt><dd>${badge(data.execution_control.master_paper_execution, "amber")}</dd></div></dl></section>${readinessPanel()}<div class="ops-control-grid">${opsGroup("Master THETA", "Independent platform account and research providers.", [["Alpaca Paper", data.master_connection.connection_state, systemTone(data.master_connection.connection_state)], ["Optionomics", data.provider_runtime], ["THETA Shadow", "REAL INPUT PARTIAL", "amber"], ["Database", data.database.state, systemTone(data.database.state)], ["Market data", system("market_data")], ["Execution", data.execution_control.master_paper_execution, "amber"]])}${opsGroup("Customer Copy", "Separate follower connection and persistence readiness.", [["Customer IAM", data.copy_platform.customer_iam, systemTone(data.copy_platform.customer_iam)], ["Private Paper Beta", data.copy_platform.private_paper_beta.state, "amber"], ["Alpaca Connect", data.copy_platform.oauth, systemTone(data.copy_platform.oauth)], ["Token vault", data.copy_platform.token_vault, systemTone(data.copy_platform.token_vault)], ["Follower adapter", data.copy_platform.follower_broker_adapter, "green"], ["Copy engine", data.copy_platform.copy_execution, "amber"], ["Follower execution", data.execution_control.follower_paper_execution, "amber"]])}${opsGroup("Current action", "No decision is displayed without persisted runtime evidence.", [["Last decision", data.runtime_detail.last_decision ?? "UNKNOWN"], ["Next scan", data.runtime_detail.next_scan ?? "UNKNOWN"]])}${opsGroup("Attention", "Select a verification above or resolve these release gates.", data.gates.map((gate) => [gate, "OPEN", "amber"]))}</div>`;
  }

  function bindRuntimeActions() {
    document.querySelector("#verify-master")?.addEventListener("click", async (event) => {
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
        const shown = (value, formatter = String) => value == null ? "—" : formatter(value);
        target.innerHTML = `<p class="notice ${result.connection_state === "CONNECTED" ? "green" : "amber"}"><strong>MASTER THETA PAPER · ${esc(result.connection_state)}</strong><br>${esc(result.masked_account ?? "Account identity unavailable")} · checked ${esc(result.checked_at ?? "not verified")}</p><dl class="capability-grid"><div><dt>Account status</dt><dd>${esc(shown(result.account_status))}</dd></div><div><dt>Equity</dt><dd>${esc(shown(result.equity, money))}</dd></div><div><dt>Cash</dt><dd>${esc(shown(result.cash, money))}</dd></div><div><dt>Buying power</dt><dd>${esc(shown(result.buying_power, money))}</dd></div><div><dt>Options buying power</dt><dd>${esc(shown(result.options_buying_power, money))}</dd></div><div><dt>Options approved</dt><dd>${esc(shown(result.options_approved_level, (value) => `Level ${value}`))}</dd></div><div><dt>Options trading</dt><dd>${esc(shown(result.options_trading_level, (value) => `Level ${value}`))}</dd></div><div><dt>Open positions</dt><dd>${esc(shown(result.open_positions))}</dd></div><div><dt>Open orders</dt><dd>${esc(shown(result.open_orders))}</dd></div><div><dt>Market</dt><dd>${esc(result.market_open == null ? "Unknown" : result.market_open ? "Open" : "Closed")}</dd></div><div><dt>Market data</dt><dd>${esc(result.market_data_feed)}</dd></div></dl>`;
      } catch (error) {
        target.innerHTML = `<p class="notice amber">${esc(error.message)} No order was submitted.</p>`;
      } finally {
        button.disabled = false;
        button.textContent = "Verify Alpaca Paper";
      }
    });
    document.querySelector("#verify-optionomics")?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      button.textContent = "Verifying…";
      const target = document.querySelector("#optionomics-result");
      try {
        const response = await fetch("/api/v1/operator/optionomics-readiness", { method: "POST", signal: AbortSignal.timeout(30000) });
        const payload = await response.json();
        if (!response.ok && response.status !== 207) throw new Error("Optionomics verification unavailable.");
        const result = payload.data;
        target.innerHTML = `<p class="notice ${result.state === "CONNECTED" ? "green" : "amber"}"><strong>OPTIONOMICS · ${esc(result.state)}</strong><br>Checked ${esc(result.checked_at)} · latency ${esc(result.latency_ms == null ? "unknown" : `${result.latency_ms} ms`)}</p><p class="caption">${esc(result.capabilities.length)} documented capability checks returned.</p>`;
      } catch (error) {
        target.innerHTML = `<p class="notice amber">${esc(error.message)}</p>`;
      } finally {
        button.disabled = false;
        button.textContent = "Verify Optionomics";
      }
    });
    document.querySelector("#verify-database")?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      button.textContent = "Verifying…";
      const target = document.querySelector("#database-result");
      try {
        const response = await fetch("/api/v1/operator/database-readiness", { method: "POST", signal: AbortSignal.timeout(10000) });
        const payload = await response.json();
        if (!response.ok && response.status !== 207) throw new Error("Database verification unavailable.");
        const result = payload.data;
        target.innerHTML = `<p class="notice ${result.state === "CONNECTED" ? "green" : "amber"}"><strong>POSTGRESQL · ${esc(result.state)}</strong><br>Runtime: transaction pooled · migrations: direct or session pooled</p><p class="caption">Latest migration: ${esc(result.latest_migration ?? "not available")}. Required: ${esc(result.required_migration)}.</p>`;
      } catch (error) {
        target.innerHTML = `<p class="notice amber">${esc(error.message)}</p>`;
      } finally {
        button.disabled = false;
        button.textContent = "Verify database";
      }
    });
    document.querySelector("#logout")?.addEventListener("click", async () => {
      await fetch("/api/v1/operator/session", { method: "DELETE" });
      location.assign("/ops/login");
    });
  }

  async function read() {
    const res = await fetch("/api/v1/operator/status", {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return false;
    const { data } = await res.json();
    form.closest(".owner-panel").hidden = true;
    document.querySelector("#owner-data").innerHTML = renderPage(data);
    bindRuntimeActions();
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

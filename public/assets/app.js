import {
  esc,
  money,
  date,
  label,
  badge,
  metricCard,
  empty,
  link,
  table,
  trackRecord,
  chart,
  lifecycle,
} from "./ui.js";
import {
  howItWorks,
  simulationPage,
  bindSimulation,
  ownerPage,
  bindOwner,
  accountPage,
  paperCopyPage,
  bindPaperCopy,
} from "./workflows.js";

const url = new URL(location.href);
const demo = url.searchParams.get("dataset") === "demo";
const path = url.pathname.replace(/\/$/, "") || "/";
const q = demo ? "?dataset=demo" : "";
const root = document.querySelector("#app");
const nav = [
  ["/overview", "Home", "◫"],
  ["/bots", "Bots", "▦"],
  ["/my-bots", "My Bots", "◈"],
  ["/activity", "Activity", "≋"],
  ["/account", "Account", "○"],
];
const botTabs = [
  ["", "Overview"],
  ["positions", "Positions"],
  ["history", "History"],
  ["performance", "Performance"],
];
let detail;
let catalog;
let abort;

function shell(content) {
  if (path.startsWith("/ops")) {
    root.innerHTML = `<div class="ops-shell"><header class="ops-topbar"><a class="brand" href="/ops"><img src="/assets/mark.svg" width="34" height="34" alt=""><span>Trading Bots<small>PRIVATE OPERATIONS</small></span></a>${badge("PAPER ONLY", "blue")}</header><main id="main" tabindex="-1">${content}</main></div>`;
    return;
  }
  root.innerHTML = `<aside class="sidebar"><a class="brand" href="/bots"><img src="/assets/mark.svg" width="34" height="34" alt=""><span>trading<span class="brand-light">bots</span><small>AUTOMATED STRATEGIES</small></span></a><div class="nav-label">ACCOUNT</div><nav aria-label="Primary">${nav.map(([href, text, icon]) => `<a href="${href}${q}" ${path === href || (href === "/bots" && (path === "/" || path.startsWith("/bots"))) ? 'aria-current="page"' : ""}><span aria-hidden="true">${icon}</span>${text}</a>`).join("")}</nav><div class="sidebar-bottom"><div class="workspace-card"><span class="status-dot"></span><div>Paper environment<small>Live trading disabled</small></div></div></div></aside><div class="workspace"><header class="topbar"><span class="breadcrumb">Workspace <span>/</span> ${path.startsWith("/bots/theta") ? "Bots / THETA" : "Trading Bots"}</span><div class="top-actions"><span class="website-state"><span class="status-dot"></span>Platform online</span>${badge("PAPER ONLY", "blue")}<span class="avatar" aria-label="Visitor workspace">V</span></div></header><main id="main" tabindex="-1">${demo ? `<div class="demo-banner" role="status"><div><strong>DEMO DATA</strong> You’re viewing a test fixture. Values are synthetic.</div>${link(path, "Exit demo", "text-link")}</div>` : ""}${content}</main><footer><span>Trading Bots</span><span>Paper trading only. Activation unavailable.</span><a href="/bots/theta/how-it-works#risks">Options risk disclosure</a></footer></div>`;
}
function heading(eyebrow, title, description, actions = "") {
  return `<div class="page-heading"><div><p class="eyebrow">${esc(eyebrow)}</p><h1>${esc(title)}</h1><p class="lede">${esc(description)}</p></div><div class="heading-actions">${actions}</div></div>`;
}
function card(bot) {
  return `<article class="bot-card ${bot.available ? "featured" : ""}"><div class="card-top"><span class="bot-monogram ${esc(bot.bot_id)}" aria-hidden="true">${{ theta: "Θ", atlas: "A", nexus: "N", vega: "V", event: "E", pulse: "P" }[bot.bot_id]}</span>${badge(bot.environment, bot.available ? "blue" : "")}</div><div class="card-name"><h2>${esc(bot.name)}</h2><span class="caption">${esc(bot.category)}</span></div><p class="card-description">${esc(bot.description)}</p><div class="card-properties"><span>Risk <strong>Unrated</strong></span><span>Capital <strong>Not established</strong></span><span>Holding <strong>${esc(bot.holding)}</strong></span></div>${
    bot.available
      ? `<div class="card-metrics">${bot.metrics
          .slice(0, 3)
          .map(
            (m) => `<div><span>${esc(m.label)}</span><strong>—</strong></div>`,
          )
          .join("")}</div>`
      : `<div class="research-note"><span class="tiny-square"></span>Not available <span>Coming later</span></div>`
  }<p class="card-provenance">${bot.available ? "Paper testing is in progress. Results will appear after reconciled trades." : "Coming later"}</p><div class="card-actions">${link(`/bots/${bot.bot_id}${q}`, bot.available ? "View bot" : "Details", "button secondary grow")}${bot.available ? link("/bots/theta/copy", "Copy THETA", "button primary") : ""}</div></article>`;
}
function discovery() {
  shell(
    heading(
      "PAPER COPY TRADING",
      "Trading Bots",
      "Choose a bot and connect your paper account to copy its trades.",
    ) +
      `<section class="theta-launch"><div><p class="eyebrow">AVAILABLE NOW</p><div class="launch-title"><span class="bot-monogram large theta" aria-hidden="true">Θ</span><div><h2>THETA</h2><p class="lede">Assignment-aware premium income.</p></div></div><p>THETA trades options in an Alpaca paper environment and keeps assignment, recovery, and costs in one economic record.</p><div class="launch-actions">${link("/bots/theta", "View bot", "button secondary")}${link("/bots/theta/copy", "Copy THETA", "button primary")}</div></div><aside><div class="receipt-label">BOT STATUS</div>${badge("PAPER TESTING", "blue")}<h3>Preparing</h3><p>Paper testing is in progress. Performance will appear after reconciled trades.</p></aside></section><section class="section-heading discovery-title"><div><p class="eyebrow">ROADMAP</p><h2>More bots coming</h2><p>These bots aren’t available yet.</p></div></section><div id="bot-grid" class="bot-grid research-grid"></div><details class="roadmap-browser"><summary>Search and filter bots</summary><form id="filters" class="filters compact-filters"><label class="search-field">Search<input name="search" type="search" placeholder="Bot name" value="${esc(url.searchParams.get("search") ?? "")}"></label>${[
        [
          "strategy",
          "Strategy",
          [
            "Income",
            "Directional",
            "Neutral",
            "Volatility",
            "Event",
            "Intraday",
          ],
        ],
        [
          "status",
          "Status",
          ["Live", "Live Small", "Paper", "Shadow", "Research"],
        ],
      ]
        .map(
          ([name, title, options]) =>
            `<label>${title}<select name="${name}" aria-label="${title}"><option value="">All</option>${options.map((v) => `<option ${url.searchParams.get(name) === v ? "selected" : ""}>${esc(v)}</option>`).join("")}</select></label>`,
        )
        .join("")}<input type="hidden" name="sort" value="strategy"><button type="reset" class="button quiet">Reset</button></form><p id="results-caption" class="caption" aria-live="polite"></p></details>`,
  );
  const form = document.querySelector("#filters");
  form.elements.sort.value = url.searchParams.get("sort") ?? "strategy";
  function filter() {
    const f = Object.fromEntries(new FormData(form));
    const result = catalog.filter(
      (b) =>
        (!f.search ||
          `${b.name} ${b.category} ${b.description}`
            .toLowerCase()
            .includes(f.search.toLowerCase())) &&
        (!f.strategy || b.strategy === f.strategy) &&
        (!f.status ||
          label(b.environment).toLowerCase() === f.status.toLowerCase()),
    );
    if (f.sort === "strategy")
      result.sort(
        (a, b) =>
          Number(b.available) - Number(a.available) ||
          a.strategy.localeCompare(b.strategy),
      );
    const research = result.filter((b) => !b.available);
    document.querySelector("#bot-grid").innerHTML = research.length
      ? research.map(card).join("")
      : empty(
          "No bots match these filters",
          "Research bots are not yet risk-rated or available for activation. Reset filters to see the roadmap.",
        );
    document.querySelector("#results-caption").textContent =
      `${result.length} ${result.length === 1 ? "strategy" : "strategies"}${f.sort !== "strategy" ? " · Ranking unavailable without validated comparable evidence. Catalog order retained." : ""}`;
    const next = new URL(location.href);
    for (const [k, v] of Object.entries(f)) {
      if (v && !(k === "sort" && v === "strategy")) next.searchParams.set(k, v);
      else next.searchParams.delete(k);
    }
    history.replaceState(null, "", next);
  }
  form.addEventListener("input", filter);
  form.addEventListener("reset", () => setTimeout(filter));
  filter();
}
function detailHeader(section) {
  return `<div class="theta-context"><div class="bot-identity"><div class="bot-monogram theta" aria-hidden="true">Θ</div><div><div class="identity-line"><h1>THETA</h1>${badge(detail.environment, "blue")}</div><p>Premium Income</p></div></div><div class="heading-actions">${link("/bots/theta/copy", "Copy THETA", "button primary")}</div></div><div class="theta-context-copy"><p>THETA trades options using an assignment-aware premium strategy.</p><span>Paper copy is being prepared.</span></div><nav class="tabs theta-tabs" aria-label="THETA sections">${botTabs.map(([key, text]) => `<a href="/bots/theta${key ? "/" + key : ""}${q}" ${section === key ? 'aria-current="page"' : ""}>${text}</a>`).join("")}</nav>`;
}
function dataState() {
  const messages = [];
  if (detail.data_quality === "STALE")
    messages.push(
      "Data stale. Last known values are not current market state.",
    );
  if (detail.data_quality === "DEGRADED")
    messages.push("Provider degraded. Some data is unavailable or incomplete.");
  if (detail.data_quality === "INVALID")
    messages.push("Data invalid. Do not use this view for a trading decision.");
  if (detail.status.automation === "PAUSED")
    messages.push(
      "Bot paused. Existing exposure may still require management.",
    );
  if (detail.status.market_session === "CLOSED")
    messages.push("Market closed. Quotes may reflect the previous session.");
  if (detail.status.broker === "UNAVAILABLE")
    messages.push(
      "Broker unavailable. Current positions and execution cannot be confirmed.",
    );
  if (detail.status.runtime === "SAFE_HOLD")
    messages.push("SAFE HOLD. New risk is blocked while existing exposure remains under management.");
  if (detail.status.runtime === "KILLED")
    messages.push("KILLED. New activity is disabled. Reconciliation and risk-reducing exits remain visible.");
  if (detail.environment === "SHADOW")
    messages.push(
      "Shadow mode. Observations do not represent executed orders.",
    );
  if (detail.environment.startsWith("LIVE"))
    messages.push(
      "Live-style status is display-only in this release. Activation remains unavailable.",
    );
  return messages
    .map(
      (message) =>
        `<div class="notice amber" role="status">${esc(message)}</div>`,
    )
    .join("");
}
function equityPanel(drawdown = false) {
  return `<section class="panel equity-panel"><div class="section-heading"><div><p class="eyebrow">${demo ? "ILLUSTRATIVE ECONOMICS" : "PERFORMANCE"}</p><h2>${drawdown ? "Drawdown" : "Economic equity"}</h2></div><div class="chart-controls"><label>Series<select id="series" aria-label="Series"><option value="${drawdown ? "drawdown" : "total"}">${drawdown ? "Drawdown" : "Total economic equity"}</option>${drawdown ? "" : '<option value="realized">Realized P&L</option><option value="unrealized">Unrealized P&L</option><option value="benchmark">Benchmark</option><option value="drawdown">Drawdown</option><option value="capital_utilized">Capital utilized</option>'}</select></label><label>Period<select id="period" aria-label="Period"><option value="all">All</option><option value="30d">30d</option><option value="90d">90d</option><option value="1y">1y</option></select></label></div></div><div id="equity-chart">${chart(detail.performance.equity, drawdown ? "drawdown" : "total")}</div><p class="caption chart-caption">${demo ? "DEMO DATA · Starting equity $100,000 · Fees and modeled slippage included. All values are hypothetical." : "No published broker equity series. Missing values are unavailable, never zero."}</p><details class="chart-data"><summary>View chart values and accounting method</summary><p>Economic equity = starting capital + options realized + options unrealized + stock realized + stock unrealized + dividends − costs. Fill prices embed execution slippage; do not subtract it twice.</p>${table(
    ["Date", "Total equity", "Realized", "Unrealized", "Drawdown"],
    detail.performance.equity.map((p) => [
      esc(p.date),
      money(p.total),
      money(p.realized),
      money(p.unrealized),
      p.drawdown.toFixed(2) + "%",
    ]),
    "Equity observations, DEMO DATA when populated",
  )}</details></section>`;
}
function statusPanel() {
  return `<aside class="panel status-panel"><div class="section-heading"><h2>Bot status</h2>${badge(detail.status.runtime === "RUNNING" ? "RUNNING" : "PREPARING", detail.status.runtime === "RUNNING" ? "green" : "amber")}</div><dl class="facts"><div><dt>Environment</dt><dd>${badge(detail.status.mode, "blue")}</dd></div><div><dt>Broker</dt><dd>${detail.status.broker === "CONNECTED" ? "Alpaca Paper connected" : "Not connected"}</dd></div><div><dt>Risk status</dt><dd>${detail.status.runtime === "RUNNING" ? "Normal" : "Unavailable"}</dd></div><div><dt>Capital in use</dt><dd>${demo ? "DEMO: $18,000" : "Unavailable"}</dd></div><div><dt>Open positions</dt><dd>${detail.positions.length}</dd></div><div><dt>Next check</dt><dd>${date(detail.status.next_evaluation)}</dd></div></dl><p class="notice">${demo ? "Test fixture values aren’t a running paper account." : "Current account and market data will appear after the paper runtime is connected."}</p>${link("/account", "Account connection", "text-link")}</aside>`;
}

function performanceHeadline() {
  if (demo || detail.performance.metrics.some((metric) => metric.value != null))
    return `<div class="kpi-strip">${detail.performance.metrics.map((m) => metricCard(m, demo)).join("")}</div>`;
  return `<section class="track-building"><div><p class="eyebrow">PAPER TESTING</p><h2>Building a paper track record</h2><p>THETA does not have enough reconciled trades for a performance record yet. Open stock losses, costs, and assignment remain part of the result.</p></div><div><strong>${esc(detail.performance.track_record.resolved_episodes ?? 0)}</strong><span>resolved trades</span></div></section>`;
}
function decisionReceipt() {
  const activity = detail.activity.at(-1);
  if (!activity)
    return `<section class="decision-receipt"><p class="eyebrow">LATEST DECISION</p><h2>No paper decision yet</h2><p>When the runtime is connected, this receipt will show the action, reason, account impact, and next check.</p></section>`;
  return `<section class="decision-receipt"><div class="receipt-top"><div><p class="eyebrow">LATEST DECISION</p><h2>${esc(customerDecision(activity.kind))}</h2></div>${badge(demo ? "DEMO DATA" : "PAPER", demo ? "demo" : "blue")}</div><p class="receipt-reason">${esc(activity.message)}</p><dl class="receipt-facts"><div><dt>Reason</dt><dd>${esc(activity.detail)}</dd></div><div><dt>Next check</dt><dd>${date(detail.status.next_evaluation)}</dd></div></dl><div class="receipt-footer"><span>${date(activity.time)}</span></div></section>`;
}

function customerDecision(kind) {
  return ({
    WAIT_PRICE: "Waiting for a better price",
    WAIT_VOL: "Waiting for better option premium",
    WAIT_LIQUIDITY: "Waiting for better liquidity",
    WAIT_EVENT: "Waiting for an upcoming event to pass",
    WAIT_REGIME: "Waiting for market conditions to improve",
    PASS: "Opportunity skipped",
    OPEN_REDUCED: "Opened a smaller position",
    OPEN_ALTERNATE_CONTRACT: "Selected a better contract",
  })[kind] ?? label(kind);
}
function overview() {
  return `<section class="runtime-strip"><div><span>STATUS</span><strong>Preparing</strong></div><div><span>BROKER</span><strong>Alpaca Paper</strong></div><div><span>LAST CHECKED</span><strong>${date(detail.as_of)}</strong></div><div><span>LAST DECISION</span><strong>${date(detail.status.last_decision)}</strong></div><div><span>OPEN POSITIONS</span><strong>${detail.positions.length}</strong></div></section>${performanceHeadline()}<div class="overview-grid"><div>${decisionReceipt()}<section class="panel"><div class="section-heading"><h2>Current positions</h2>${link("/bots/theta/positions" + q, "View all", "text-link")}</div>${detail.positions.length ? positionRows(detail.positions.slice(0, 3)) : empty("No open positions", "Positions will appear after broker reconciliation.")}</section><section class="panel"><div class="section-heading"><h2>Recent activity</h2>${link("/activity", "View all", "text-link")}</div>${activityList(detail.activity.slice(-4))}</section></div>${statusPanel()}</div><section class="panel about-theta"><h2>About THETA</h2><p>THETA sells cash-secured puts, manages assignment as stock ownership, and uses recovery or covered calls only when the economics support them. Some trades may be skipped or reduced to respect account limits.</p></section>`;
}
function performance() {
  return `${performanceHeadline()}${equityPanel()}<div class="two-columns"><section class="panel"><h2>Monthly returns</h2>${detail.performance.monthly.length ? `<div class="returns">${detail.performance.monthly.map((m) => `<div><span>${esc(m.month)}</span><strong class="${m.return_pct < 0 ? "negative" : "positive"}">${m.return_pct.toFixed(2)}%</strong><small>DEMO DATA</small></div>`).join("")}</div>` : empty("No monthly record", "Returns require published economic equity, including open inventory.")}</section><section class="panel"><h2>Attribution</h2>${
    detail.performance.attribution.length
      ? table(
          ["Lifecycle outcome", "Economic P&L", "Episodes"],
          detail.performance.attribution.map((a) => [
            esc(a.label),
            money(a.pnl),
            String(a.episodes),
          ]),
          "DEMO DATA · Economic attribution",
        )
      : empty(
          "No supported attribution",
          "Regime, underlying, DTE, ownership, volatility and management cohorts need validated evidence.",
        )
  }</section></div><section class="panel"><h2>Rolling metrics</h2><p>30d, 90d, 1y and all-time PF, episode WR, after-cost EV and drawdown require dated, resolved episode records. ${demo ? "The illustration has an equity series, but not enough dated episode records for rolling performance." : ""}</p>${badge("INSUFFICIENT DATA")}</section><details class="panel"><summary>Advanced metrics & statistical confidence</summary><div class="advanced-grid">${detail.performance.advanced.map((m) => metricCard(m, demo)).join("")}</div><p>Raw N ${demo ? "= 5 synthetic episodes" : "is unknown"}. Independent N, confidence intervals and untouched OOS evidence are unavailable. No performance claim can be inferred.</p></details><section class="panel"><h2>Execution quality</h2>${empty("No measured fill quality", "Slippage, fill probability and markouts require broker fills and contemporaneous benchmarks. No midpoint fills are assumed.")}</section>${trackRecord(detail.performance.track_record)}`;
}
function positions() {
  return `<section class="panel"><div class="section-heading"><div><h2>Positions & inventory</h2><p>Each position belongs to a complete economic chain.</p></div>${badge(demo ? "DEMO_DATA" : "PAPER", demo ? "demo" : "blue")}</div><label class="inline-filter">Lifecycle<select id="position-filter" aria-label="Lifecycle"><option value="">All states</option>${["CSP", "Assignment", "Stock", "Recovery", "Covered Call", "Roll", "Closing"].map((v) => `<option>${v}</option>`).join("")}</select></label><div id="positions-table">${positionRows(detail.positions)}</div></section>`;
}
function positionRows(rows) {
  return rows.length
    ? table(
        [
          "Bot / Symbol",
          "Lifecycle",
          "Contract / position",
          "Entry / close",
          "Capital",
          "Open MTM",
          "Whole-chain P&L",
          "Current action",
          "Next evaluation",
        ],
        rows.map((p) => [
          link(
            `/bots/theta/chains/${p.chain_id}${q}`,
            `THETA / ${p.symbol}`,
            "text-link",
          ),
          badge(p.lifecycle_state, "amber"),
          `<span class="mono">${esc(p.contract ?? p.position)}</span><small>${p.expiration ? `${esc(p.expiration)} · ${money(p.strike)}` : esc(p.position)}</small>`,
          `<span>${money(p.entry_credit)} credit</span><small>${p.current_close_debit == null ? "Close debit unavailable" : `${money(p.current_close_debit)} close debit`}</small>`,
          `${money(p.capital_committed)}<small>Economic basis ${money(p.economic_basis)}</small>`,
          `<span class="${p.open_mtm < 0 ? "negative" : "positive"}">${money(p.open_mtm)}</span><small>Stock MTM ${money(p.stock_mtm)}</small>`,
          `<span class="negative">${money(p.whole_chain_pnl)}</span>`,
          `<strong>${esc(label(p.current_action))}</strong><small>${esc(p.reason)}</small>`,
          p.next_evaluation ? date(p.next_evaluation) : esc(p.next_action),
        ]),
        "Position lifecycle ledger · DEMO DATA",
      )
    : empty(
        "No positions to display",
        "No reconciled position data is published for this view. This does not assert that a brokerage account has zero exposure.",
      );
}
function tradeHistory() {
  return `<section class="panel"><h2>Trade history</h2><p>Semantic actions keep rolls, assignment and recovery understandable.</p>${
    detail.history.length
      ? table(
          [
            "Time",
            "Bot / Symbol",
            "Action",
            "Contract",
            "Qty",
            "Expected",
            "Fill",
            "Slippage",
            "P&L effect",
            "Chain",
            "Status",
          ],
          detail.history.map((t) => [
            date(t.time),
            `THETA / ${esc(t.symbol)}`,
            `<details><summary>${esc(label(t.action))}</summary><p>${esc(t.reasons.join(" "))}</p><dl class="facts"><div><dt>AEGIS</dt><dd>${esc(t.aegis)}</dd></div><div><dt>Snapshot</dt><dd>${esc(t.snapshot_ref)}</dd></div><div><dt>Management</dt><dd>${esc(t.management_state)}</dd></div></dl></details>`,
            `<span class="mono">${esc(t.contract ?? "Stock / cash")}</span>`,
            String(t.qty),
            money(t.expected),
            money(t.fill),
            money(t.slippage),
            money(t.pnl_effect),
            link(
              `/bots/theta/chains/${t.chain_id}${q}`,
              "View chain",
              "text-link",
            ),
            badge(t.status, "demo"),
          ]),
          "Illustrative ledger events, not a live trade record",
        )
      : empty(
          "No trades published",
          "Executed, skipped and reconciled actions will appear with decision reasons and chain references.",
        )
  }</section>`;
}
function intelligence() {
  return `<div class="intelligence-heading"><span class="eyebrow">EVIDENCE BEFORE INSIGHT</span><h2>Strategy intelligence</h2><p>Understand behavior, outcomes and uncertainty in context.</p></div><div class="two-columns">${detail.intelligence.sections.map((s) => `<section class="panel"><div class="section-heading"><h2>${esc(s.title)}</h2>${badge(s.evidence, "violet")}</div><p>${esc(s.summary)}</p></section>`).join("")}<section class="panel"><div class="section-heading"><h2>Model health</h2>${badge("MODEL UNAVAILABLE")}</div><p>${esc(detail.intelligence.model.explanation)}</p><dl class="facts"><div><dt>Calibration</dt><dd>Unknown</dd></div><div><dt>Drift</dt><dd>Unknown</dd></div><div><dt>Confidence quality</dt><dd>Insufficient data</dd></div></dl></section></div>`;
}
function risk() {
  return `<div class="notice amber">Risk classification is unvalidated. Selling puts creates downside and inventory risk even when the premium is small.</div><div class="kpi-strip three">${detail.risk_view.metrics.map((m) => metricCard(m, demo)).join("")}</div><div class="two-columns"><section class="panel"><h2>Largest risk</h2><p>${demo ? "DEMO DATA: assigned AAPL shares hold $18,000 of capital and a $2,500 unrealized loss. Further stock declines would increase that loss." : "Current exposure is unavailable. Assignment can create concentrated stock ownership and a prolonged recovery period."}</p><h3>Ticker exposure</h3>${
    detail.risk_view.exposures.length
      ? table(
          ["Underlying", "Committed capital"],
          detail.risk_view.exposures.map((e) => [
            esc(e.symbol),
            money(e.capital),
          ]),
          "DEMO DATA · Exposure",
        )
      : empty(
          "Exposure unknown",
          "A current account and position snapshot is required.",
        )
  }</section><section class="panel"><h2>Stress scenarios</h2>${table(
    ["Scenario", "Estimated loss"],
    detail.risk_view.stress.map((s) => [esc(s.scenario), "Unavailable"]),
    "Stress estimates",
  )}<p class="caption">Scenario tests are estimates, not guarantees. No stress result is fabricated without a portfolio and validated model.</p></section></div><details class="panel"><summary>Advanced portfolio risk</summary><dl class="facts">${["Delta", "Gamma", "Vega", "Theta", "Sector concentration", "Correlation", "Expected Shortfall"].map((n) => `<div><dt>${n}</dt><dd>Unknown</dd></div>`).join("")}</dl><p>Greeks require source, time, units and normalization. Unknown correlation is not zero correlation.</p></details>`;
}
function activityList(items) {
  return items.length
    ? `<ol class="activity-list">${[...items]
        .reverse()
        .map(
          (a) =>
            `<li data-activity-type="${a.order_status === "NOT_APPLICABLE" ? "decision" : "trade"}"><span class="activity-mark" aria-hidden="true">◇</span><div><p class="activity-kind">${esc(customerDecision(a.kind))}${demo ? " · DEMO DATA" : ""}</p><h3>${esc(a.message)}</h3><time>${date(a.time)}</time><details><summary>Why</summary><p>${esc(a.detail)}</p><dl class="facts"><div><dt>Trade status</dt><dd>${esc(label(a.order_status))}</dd></div><div><dt>Economic result</dt><dd>${money(a.economic_result)}</dd></div><div><dt>Updated</dt><dd>${date(a.as_of)}</dd></div></dl></details></div></li>`,
        )
        .join("")}</ol>`
    : empty(
        "No activity published",
        "Trades and bot decisions will appear here after the paper runtime is connected.",
      );
}
function chain() {
  const chainId = path.split("/")[4];
  const c = detail.chains.find((c) => c.id === chainId);
  if (!c)
    return empty(
      "Chain unavailable",
      "This record is not published. Example chains are available only in explicitly labeled demo mode.",
      link("/bots/theta/positions" + q, "Back to positions"),
    );
  return `<section class="panel"><div class="section-heading"><div><p class="eyebrow">DEMO DATA · THETA CHAIN</p><h2>${esc(c.symbol)} / ${esc(c.id)}</h2></div>${badge(c.state, "amber")}</div><div class="summary-strip"><div><span>Whole-chain P&L</span><strong class="negative">${money(c.whole_chain_pnl)}</strong></div><div><span>Capital committed</span><strong>${money(c.capital_committed)}</strong></div><div><span>Capital-days, Aug 7–31</span><strong>$${c.capital_days.toLocaleString()} days</strong></div></div><p>Broker acquisition price: $180 per share. Economic break-even after $600 premium and $20 costs: $174.20. This is an economic measure, not a tax-basis statement.</p>${lifecycle(c.events)}</section>`;
}
function bindDetail() {
  const period = document.querySelector("#period"),
    series = document.querySelector("#series");
  if (period && series) {
    period.value = url.searchParams.get("period") ?? "all";
    function redraw() {
      const end = Date.parse(detail.as_of ?? "2026-08-31T20:00:00Z");
      const days =
        { "30d": 30, "90d": 90, "1y": 365 }[period.value] ?? Infinity;
      const points = detail.performance.equity.filter(
        (p) => end - Date.parse(p.date) <= days * 86400000,
      );
      document.querySelector("#equity-chart").innerHTML = chart(
        points,
        series.value,
      );
      const next = new URL(location.href);
      next.searchParams.set("period", period.value);
      history.replaceState(null, "", next);
      document.querySelectorAll(".tabs a").forEach((a) => {
        const tab = new URL(a.href);
        tab.searchParams.set("period", period.value);
        a.href = tab.href;
      });
    }
    period.addEventListener("change", redraw);
    series.addEventListener("change", redraw);
    redraw();
  }
  document
    .querySelector("#position-filter")
    ?.addEventListener("change", (e) => {
      const mapping = {
        CSP: "CSP",
        Assignment: "ASSIGN",
        Stock: "STOCK",
        Recovery: "RECOVERY",
        "Covered Call": "CC",
        Roll: "ROLL",
        Closing: "CLOS",
      };
      document.querySelector("#positions-table").innerHTML = positionRows(
        detail.positions.filter(
          (p) =>
            !e.target.value ||
            p.lifecycle_state.includes(mapping[e.target.value]),
        ),
      );
    });
}
function compare() {
  shell(
    heading(
      "SIDE BY SIDE",
      "Compare bots",
      "Compare strategy intent and evidence. Allocation recommendations require validated portfolio logic.",
    ) +
      `<fieldset class="panel compare-picks"><legend>Select 2–4 bots</legend>${catalog.map((b, i) => `<label><input type="checkbox" name="compare" value="${b.bot_id}" ${i < 2 ? "checked" : ""}>${esc(b.name)}</label>`).join("")}</fieldset><div id="comparison"></div>`,
  );
  const redraw = () => {
    const selected = [
      ...document.querySelectorAll('[name="compare"]:checked'),
    ].map((e) => e.value);
    document
      .querySelectorAll('[name="compare"]')
      .forEach((e) => (e.disabled = selected.length >= 4 && !e.checked));
    const bots = catalog.filter((b) => selected.includes(b.bot_id));
    if (bots.length < 2) {
      document.querySelector("#comparison").innerHTML = empty(
        "Select at least two bots",
        "You can compare up to four strategy profiles.",
      );
      return;
    }
    const rows = [
      ["Strategy", (b) => b.category],
      ["Status", (b) => b.environment],
      ["Risk", () => "Unrated"],
      ["Capital", () => "Not established"],
      ["Holding period", (b) => b.holding],
      ["Return", () => "Unavailable"],
      ["Profit factor", () => "Unavailable"],
      ["Managed episode WR", () => "Unavailable"],
      ["Max drawdown", () => "Unavailable"],
      ["Expected Shortfall", () => "Insufficient data"],
      ["Frequency", () => "Not validated"],
      [
        "Assignment",
        (b) => (b.bot_id === "theta" ? "Part of lifecycle" : "Not established"),
      ],
      ["Live record", () => "Not available"],
      ["Paper record", () => "Not published"],
      ["Correlation", () => "Unknown"],
    ];
    document.querySelector("#comparison").innerHTML =
      `<section class="panel">${table(
        ["Attribute", ...bots.map((b) => b.name)],
        rows.map(([name, get]) => [esc(name), ...bots.map((b) => esc(get(b)))]),
        "Strategy comparison. No performance rankings are inferred.",
      )}<p class="notice">ATLAS, NEXUS, VEGA, EVENT and PULSE are research roadmap entries. They are not available for use.</p></section>`;
  };
  document
    .querySelectorAll('[name="compare"]')
    .forEach((e) => e.addEventListener("change", redraw));
  redraw();
}
function myBots() {
  shell(
    heading(
      "YOUR BOTS",
      "My Bots",
      "Manage the bots connected to your paper account.",
      link("/bots/theta/copy", "Copy THETA", "button primary"),
    ) +
      `<section class="panel my-bots-empty">${empty("No bots are copying yet", "Connect an Alpaca Paper account, choose a copy amount, and review your safety limits.", link("/bots/theta/copy", "Set up THETA", "button primary"))}<p class="notice">Paper copy is being prepared. Pause and stop controls will appear only after activation is released.</p></section>`,
  );
}
async function load() {
  shell(
    `<div class="loading" role="status" aria-busy="true"><span class="loading-bar"></span><h1>Loading your workspace</h1><p>Retrieving the published bot catalog…</p></div>`,
  );
  abort?.abort();
  abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 12000);
  try {
    const response = await fetch("/api/v1/bots", { signal: abort.signal });
    if (!response.ok) throw new Error("API");
    const body = await response.json();
    if (body.api_version !== "v1" || !Array.isArray(body.data))
      throw new Error("contract");
    catalog = body.data;
    if (path === "/" || path === "/bots") discovery();
    else if (path === "/compare") compare();
    else if (path === "/my-bots") myBots();
    else if (path === "/ops" || path === "/ops/login" || path === "/owner") {
      shell(ownerPage());
      bindOwner();
    } else if (path === "/account") {
      const readinessResponse = await fetch("/api/v1/copy/readiness", { signal: abort.signal });
      if (!readinessResponse.ok) throw new Error("API");
      shell(accountPage((await readinessResponse.json()).data));
    } else if (path === "/settings") {
      shell(
        heading(
          "PREFERENCES",
          "Settings",
          "This browser stores only local simulation drafts.",
        ) +
          `<section class="panel"><h2>Workspace data</h2><p>No account credentials are stored in browser storage. Owner sessions use short-lived HttpOnly cookies.</p><button id="clear-drafts" class="button secondary">Clear simulation drafts</button><p id="settings-result" role="status"></p></section>`,
      );
      document.querySelector("#clear-drafts").addEventListener("click", () => {
        try {
          localStorage.removeItem("tb.demo.plans.v1");
          document.querySelector("#settings-result").textContent =
            "Simulation drafts cleared.";
        } catch {
          document.querySelector("#settings-result").textContent =
            "Browser storage is unavailable.";
        }
      });
    } else if (
      !path.startsWith("/bots/") &&
      !["/overview", "/activity"].includes(path)
    )
      shell(
        empty(
          "Page not found",
          "Choose a page from the navigation.",
          link("/bots", "Explore bots"),
        ),
      );
    else {
      const id = path.startsWith("/bots/") ? path.split("/")[2] : "theta";
      const res = await fetch(`/api/v1/bots/${encodeURIComponent(id)}${q}`, {
        signal: abort.signal,
      });
      if (res.status === 404) {
        shell(
          empty(
            "Bot not found",
            "Choose a bot from the catalog.",
            link("/bots", "View bots"),
          ),
        );
        return;
      }
      if (!res.ok) throw new Error("API");
      detail = (await res.json()).data;
      if (
        !detail?.status ||
        !detail.performance ||
        !Array.isArray(detail.positions)
      )
        throw new Error("contract");
      if (!demo && detail.provenance === "DEMO_DATA")
        throw new Error("dataset_mismatch");
      if (path === "/activity") {
        shell(
          heading(
            "YOUR TIMELINE",
            "Activity",
            "Trades and bot decisions in one chronological feed.",
          ) +
            `<div class="activity-filters" role="group" aria-label="Activity filter"><button class="button secondary" data-feed="all" aria-pressed="true">All</button><button class="button quiet" data-feed="trade" aria-pressed="false">Trades</button><button class="button quiet" data-feed="decision" aria-pressed="false">Bot decisions</button></div><section class="panel">${activityList(detail.activity)}</section>`,
        );
        document.querySelectorAll("[data-feed]").forEach((button) => button.addEventListener("click", () => {
          const kind = button.dataset.feed;
          document.querySelectorAll("[data-feed]").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
          document.querySelectorAll("[data-activity-type]").forEach((item) => { item.hidden = kind !== "all" && item.dataset.activityType !== kind; });
        }));
      }
      else if (path === "/overview")
        shell(
          heading(
            "WORKSPACE OVERVIEW",
            "Systematic, with perspective.",
            "Start with a strategy. Understand its behavior. Follow the evidence.",
            link("/bots", "Explore strategies", "button primary"),
          ) +
            `<div class="two-columns"><section class="panel feature-overview"><span class="eyebrow">IN DEVELOPMENT</span><h2>THETA</h2><p class="lede">Premium income, across the whole Wheel.</p><p>Cash-secured puts, assignment-aware management and patient stock recovery.</p>${link("/bots/theta" + q, "Explore THETA →", "text-link")}</section>${statusPanel()}</div><section class="panel"><h2>Platform activity</h2>${activityList(detail.activity)}</section>`,
        );
      else if (id !== "theta")
        shell(
          heading("RESEARCH ROADMAP", detail.name, detail.description) +
            `<section class="panel">${badge("RESEARCH")} ${badge("COMING LATER")}<h2>${esc(detail.category)}</h2><p>Not available. No validated performance, capital requirement, risk rating or release date is established.</p>${link("/bots", "Back to bots")}</section>`,
        );
      else if (path.endsWith("/copy")) {
        const readinessResponse = await fetch("/api/v1/copy/readiness", { signal: abort.signal });
        if (!readinessResponse.ok) throw new Error("API");
        shell(detailHeader("") + paperCopyPage((await readinessResponse.json()).data));
        bindPaperCopy();
      } else if (path.endsWith("/simulate")) {
        shell(detailHeader("") + simulationPage());
        bindSimulation();
      } else {
        const section = path.split("/")[3] ?? "";
        const view = {
          "": overview,
          performance,
          positions,
          history: tradeHistory,
          intelligence,
          risk,
          "how-it-works": howItWorks,
          chains: chain,
        }[section];
        shell(
          detailHeader(section) +
            dataState() +
            (view
              ? view()
              : empty(
                  "Page not found",
                  "Return to THETA overview.",
                  link("/bots/theta", "THETA overview"),
                )),
        );
        bindDetail();
      }
    }
    document.title = `${document.querySelector("h1")?.textContent ?? "Workspace"} | Trading Bots`;
  } catch {
    shell(
      heading(
        "CONNECTION INTERRUPTED",
        "Your data is unavailable",
        "We couldn’t load the published data. No cached figure is being presented as current.",
      ) +
        `<section class="panel error-state" role="alert"><h2>${navigator.onLine ? "API connection failed" : "Network unavailable"}</h2><p>Check your connection or retry. Bot execution is not controlled by this page.</p><button id="retry" class="button primary">Try again</button></section>`,
    );
    document.querySelector("#retry").addEventListener("click", load);
  } finally {
    clearTimeout(timer);
  }
}
load();

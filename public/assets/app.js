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
} from "./workflows.js";

const url = new URL(location.href);
const demo = url.searchParams.get("dataset") === "demo";
const path = url.pathname.replace(/\/$/, "") || "/";
const q = demo ? "?dataset=demo" : "";
const root = document.querySelector("#app");
const nav = [
  ["/overview", "Overview", "◫"],
  ["/bots", "Bots", "▦"],
  ["/my-bots", "My Bots", "◈"],
  ["/activity", "Activity", "≋"],
];
const botTabs = [
  ["", "Overview"],
  ["performance", "Performance"],
  ["positions", "Positions"],
  ["history", "Activity"],
  ["risk", "Risk"],
];
let detail;
let catalog;
let abort;

function shell(content) {
  root.innerHTML = `<aside class="sidebar"><a class="brand" href="/bots"><img src="/assets/mark.svg" width="34" height="34" alt=""><span>trading<span class="brand-light">bots</span><small>THE STRATEGY PLATFORM</small></span></a><div class="nav-label">WORKSPACE</div><nav aria-label="Primary">${nav.map(([href, text, icon]) => `<a href="${href}${q}" ${path === href || (href === "/bots" && (path === "/" || path.startsWith("/bots"))) ? 'aria-current="page"' : ""}><span aria-hidden="true">${icon}</span>${text}</a>`).join("")}</nav><div class="sidebar-bottom"><div class="workspace-card"><span class="status-dot"></span><div>Independent platform<small>Research & paper environments</small></div></div><a href="/bots/theta/how-it-works">Understand THETA <span aria-hidden="true">↗</span></a><a href="/compare">Compare roadmap</a><a href="/settings">Settings</a></div></aside><div class="workspace"><header class="topbar"><span class="breadcrumb">Workspace <span>/</span> ${path.startsWith("/bots/theta") ? "Bots / THETA" : path === "/owner" ? "Private operator area" : "Trading Bots"}</span><div class="top-actions"><span class="website-state"><span class="status-dot"></span>Platform online</span>${badge("PAPER ONLY", "blue")}<span class="avatar" aria-label="Visitor workspace">V</span></div></header><main id="main" tabindex="-1">${demo ? `<div class="demo-banner" role="status"><div><strong>DEMO DATA</strong> You’re exploring an illustration. Every performance value and position is synthetic.</div>${link(path, "Exit demo", "text-link")}</div>` : ""}${content}</main><footer><span>Trading Bots · Independent strategy platform</span><span>Website in production. Trading activation unavailable.</span><a href="/bots/theta/how-it-works#risks">Options risk & data disclosures</a></footer></div>`;
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
      : `<div class="research-note"><span class="tiny-square"></span>Research roadmap <span>Coming later</span></div>`
  }<p class="card-provenance">${bot.available ? "No track record published · Updated when evidence is available" : "Not available · No validated performance"}</p><div class="card-actions">${link(`/bots/${bot.bot_id}${q}`, bot.available ? "View Bot" : "View Research", "button secondary grow")}${bot.available ? link("/bots/theta/simulate", "Simulate", "button primary") : ""}</div></article>`;
}
function discovery() {
  shell(
    heading(
      "SYSTEMATIC STRATEGIES",
      "Trading Bots",
      "One assignment-aware strategy is available to explore. The rest of the platform is a transparent research pipeline.",
    ) +
      `<section class="theta-launch"><div><p class="eyebrow">AVAILABLE FOR EXPLORATION NOW</p><div class="launch-title"><span class="bot-monogram large theta" aria-hidden="true">Θ</span><div><h2>THETA</h2><p class="lede">Assignment-aware premium income, designed to show the whole Wheel.</p></div></div><p>Explore what the bot is designed to decide, how assignment changes the economic picture, and an explicitly illustrative capital scenario.</p><div class="launch-actions">${link("/bots/theta", "Explore THETA", "button primary")}${link("/bots/theta/how-it-works", "Understand the Wheel", "button secondary")}</div></div><aside><div class="receipt-label">CURRENT RELEASE</div>${badge("PAPER", "blue")}<h3>Exploration only</h3><p>No customer capital is connected. No performance record is published. Simulation is illustrative and never activates trading.</p>${link("/bots/theta/simulate", "Simulate capital", "text-link")}</aside></section><section class="section-heading discovery-title"><div><p class="eyebrow">RESEARCH PIPELINE</p><h2>What comes later</h2><p>These strategy concepts have no validated performance or customer availability.</p></div><span class="caption">No artificial rankings.</span></section><div id="bot-grid" class="bot-grid research-grid"></div><details class="roadmap-browser"><summary>Browse and filter the research roadmap</summary><p>Filters are available for research exploration. They do not establish a risk rating, capital requirement or comparative performance.</p><form id="filters" class="filters"><label class="search-field">Search bots<input name="search" type="search" placeholder="Name or strategy" value="${esc(url.searchParams.get("search") ?? "")}"></label>${[
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
          "risk",
          "Risk",
          ["Conservative", "Moderate", "Aggressive", "Experimental", "Unrated"],
        ],
        [
          "status",
          "Status",
          ["Live", "Live Small", "Paper", "Shadow", "Research"],
        ],
        [
          "capital",
          "Capital",
          ["<$5k", "$5k–$25k", "$25k–$100k", "$100k+", "Not established"],
        ],
        ["holding", "Holding", ["Intraday", "Days", "Weeks", "Lifecycle"]],
        ["instrument", "Instrument", ["Stocks", "Options", "Index Options"]],
      ]
        .map(
          ([name, title, options]) =>
            `<label>${title}<select name="${name}" aria-label="${title}"><option value="">All</option>${options.map((v) => `<option ${url.searchParams.get(name) === v ? "selected" : ""}>${esc(v)}</option>`).join("")}</select></label>`,
        )
        .join("")}<label>Sort by<select name="sort" aria-label="Sort by"><option value="strategy">Strategy type</option><option value="record">Track record</option><option value="capital">Capital requirement</option><option value="risk">Risk-adjusted</option></select></label><button type="reset" class="button quiet">Reset</button></form><p id="results-caption" class="caption" aria-live="polite"></p></details><section class="principles"><div><span class="eyebrow">DESIGNED FOR ACCOUNTABILITY</span><h2>See the whole trade.</h2><p>Premium is one part of the story. THETA keeps assignment, stock exposure, recovery and costs connected to each decision.</p>${link("/bots/theta/how-it-works", "Understand the Wheel →", "text-link")}</div><div class="mini-wheel"><span>Cash</span><i>→</i><span>CSP</span><i>→</i><span>Assignment</span><i>→</i><span>Recovery</span><i>→</i><span>Covered call</span><p>Waiting is a decision, too.</p></div></section>`,
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
        (!f.risk || f.risk === "Unrated") &&
        (!f.status ||
          label(b.environment).toLowerCase() === f.status.toLowerCase()) &&
        (!f.capital || f.capital === "Not established") &&
        (!f.holding || b.holding === f.holding) &&
        (!f.instrument || b.instruments.includes(f.instrument)),
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
  const isMore = ["intelligence", "how-it-works", "chains"].includes(section);
  return `<div class="theta-context"><div class="bot-identity"><div class="bot-monogram theta" aria-hidden="true">Θ</div><div><div class="identity-line"><h1>THETA</h1>${badge(detail.environment, "blue")}</div><p>Premium income · Assignment-aware Wheel</p></div></div><div class="heading-actions">${link("/bots/theta/simulate", "Simulate capital", "button primary")}</div></div><div class="theta-context-copy"><p>A cash-secured put can become stock. THETA keeps the option, assignment, recovery and costs in one economic chain.</p><span>Exploration only. No published customer performance.</span></div><nav class="tabs theta-tabs" aria-label="THETA sections">${botTabs.map(([key, text]) => `<a href="/bots/theta${key ? "/" + key : ""}${q}" ${section === key ? 'aria-current="page"' : ""}>${text}</a>`).join("")}<details class="more-tabs" ${isMore ? "open" : ""}><summary ${isMore ? 'aria-current="page"' : ""}>More</summary><div>${link("/bots/theta/intelligence" + q, "Intelligence", "text-link")}${link("/bots/theta/how-it-works" + q, "How THETA works", "text-link")}${link("/bots/theta/chains/demo-aapl-001" + q, "Lifecycle example", "text-link")}</div></details></nav>`;
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
  return `<aside class="panel status-panel"><div class="section-heading"><h2>Bot status</h2>${badge("NOT ENABLED", "amber")}</div><dl class="facts"><div><dt>Broker environment</dt><dd>${badge("PAPER", "blue")}</dd></div><div><dt>AEGIS</dt><dd>Unknown</dd></div><div><dt>Risk classification</dt><dd>Unrated</dd></div><div><dt>Capital utilization</dt><dd>${demo ? "DEMO: 18.0%" : "Unavailable"}</dd></div><div><dt>Current regime</dt><dd>Unknown</dd></div><div><dt>Market session</dt><dd>Unknown</dd></div><div><dt>Data freshness</dt><dd>${demo ? "Frozen illustration" : "No current feed"}</dd></div></dl><p class="notice">${demo ? "Example values explain the interface. They are not a running paper account." : "Provider connectivity has been tested. Current trading data and a validated performance record are not published."}</p>${link("/bots/theta/risk" + q, "View risk details →", "text-link")}</aside>`;
}
function decisionReceipt() {
  const activity = detail.activity.at(-1);
  if (!activity)
    return `<section class="decision-receipt"><p class="eyebrow">LATEST DECISION</p><h2>No published decision yet</h2><p>When a decision is released, this receipt will state the action, plain-English reason, risk, AEGIS result and evidence freshness.</p>${link("/bots/theta/how-it-works" + q, "Understand a WAIT decision", "text-link")}</section>`;
  return `<section class="decision-receipt"><div class="receipt-top"><div><p class="eyebrow">LATEST DECISION · ${demo ? "DEMO DATA" : "PUBLISHED"}</p><h2>${esc(label(activity.kind))}</h2></div>${badge("RECOVERY_WAIT", "amber")}</div><p class="receipt-reason">${esc(activity.message)}</p><dl class="receipt-facts"><div><dt>Why</dt><dd>${esc(activity.detail)}</dd></div><div><dt>Capital affected</dt><dd>${demo ? "$18,000 demo inventory" : "Unavailable"}</dd></div><div><dt>AEGIS</dt><dd>${demo ? "Demo: HOLD_ONLY" : "Unknown"}</dd></div><div><dt>Evidence</dt><dd>${demo ? "Frozen illustration" : "No published decision feed"}</dd></div></dl><div class="receipt-footer"><span>${date(activity.time)}</span>${activity.chain_id ? link(`/bots/theta/chains/${activity.chain_id}${q}`, "Open economic chain", "text-link") : ""}</div></section>`;
}
function overview() {
  return `<section class="theta-hero"><div><p class="eyebrow">WHAT THETA DOES</p><h2>Sell puts only when ownership and recovery risk still make economic sense.</h2><p>It can trade, reduce, roll, accept assignment, wait for recovery, sell a covered call when justified, or simply WAIT.</p><div class="launch-actions">${link("/bots/theta/how-it-works" + q, "How the Wheel works", "button secondary")}${link("/bots/theta/simulate", "Simulate capital", "button primary")}</div></div><div class="hero-truth"><span>STATUS</span>${badge("PAPER", "blue")}<strong>Available for exploration</strong><p>There is no validated customer performance record yet.</p></div></section><div class="kpi-strip">${detail.performance.metrics.map((m) => metricCard(m, demo)).join("")}</div><div class="overview-grid"><div>${decisionReceipt()}${equityPanel()}</div>${statusPanel()}</div><div class="two-columns"><section class="panel lifecycle-summary"><div class="section-heading"><div><p class="eyebrow">THE COMPLETE ECONOMIC STORY</p><h2>What assignment changes</h2></div>${link("/bots/theta/positions" + q, "View positions →", "text-link")}</div><div class="wheel-path"><span>Cash</span><i>→</i><span>Cash-secured put</span><i>→</i><span>Close / expire / roll / assign</span><i>→</i><span>Stock</span><i>→</i><span>Recovery wait</span><i>→</i><span>Covered call or exit</span></div><p>WAIT is valid before and after any lifecycle stage. Assignment means shares are now part of the same P&L, not an erased option loss.</p>${demo ? `<a href="/bots/theta/chains/demo-aapl-001?dataset=demo" class="chain-preview"><strong>AAPL <small>DEMO DATA · ASSIGNED STOCK</small></strong><span>${badge("RECOVERY_WAIT", "amber")}</span><span class="negative">-$1,920<small>Whole-chain P&L</small></span><span aria-hidden="true">→</span></a>` : `<div class="evidence-empty"><strong>Economic chains require reconciled evidence</strong><span>When published, they will include option cashflows, stock MTM, costs and recovery outcomes.</span></div>`}</section>${trackRecord(detail.performance.track_record)}</div>`;
}
function performance() {
  return `<div class="kpi-strip">${detail.performance.metrics.map((m) => metricCard(m, demo)).join("")}</div>${equityPanel()}<div class="two-columns"><section class="panel"><h2>Monthly returns</h2>${detail.performance.monthly.length ? `<div class="returns">${detail.performance.monthly.map((m) => `<div><span>${esc(m.month)}</span><strong class="${m.return_pct < 0 ? "negative" : "positive"}">${m.return_pct.toFixed(2)}%</strong><small>DEMO DATA</small></div>`).join("")}</div>` : empty("No monthly record", "Returns require published economic equity, including open inventory.")}</section><section class="panel"><h2>Attribution</h2>${
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
          "Position",
          "Cost basis",
          "Current price",
          "Collateral",
          "Premium collected",
          "Stock MTM",
          "Whole-chain P&L",
          "DTE",
          "AEGIS",
          "Next expected action",
        ],
        rows.map((p) => [
          link(
            `/bots/theta/chains/${p.chain_id}${q}`,
            `THETA / ${p.symbol}`,
            "text-link",
          ),
          badge(p.lifecycle_state, "amber"),
          esc(p.position),
          money(p.cost_basis),
          money(p.current_price),
          money(p.collateral),
          money(p.premium_collected),
          `<span class="negative">${money(p.stock_mtm)}</span>`,
          `<span class="negative">${money(p.whole_chain_pnl)}</span>`,
          p.dte == null ? "Not applicable" : String(p.dte),
          esc(p.aegis),
          esc(p.next_action),
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
            `<li><span class="activity-mark" aria-hidden="true">◇</span><div><p class="activity-kind">${esc(label(a.kind))} · ${demo ? "DEMO DATA" : "PUBLISHED"}</p><h3>${esc(a.message)}</h3><time>${date(a.time)}</time><details><summary>Why this decision</summary><p>${esc(a.detail)}</p><dl class="facts"><div><dt>Data provenance</dt><dd>${esc(a.provenance)}</dd></div><div><dt>Freshness</dt><dd>${date(a.as_of)}</dd></div></dl>${a.chain_id ? link(`/bots/theta/chains/${a.chain_id}${q}`, "Open economic chain", "text-link") : ""}</details></div></li>`,
        )
        .join("")}</ol>`
    : empty(
        "No activity published",
        "Candidate evaluations, skipped entries, fills and risk decisions will appear here once the activity feed is connected.",
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
  let plans = [];
  try {
    plans = JSON.parse(localStorage.getItem("tb.demo.plans.v1") ?? "[]");
    if (!Array.isArray(plans)) plans = [];
    plans = plans.filter(
      (p) =>
        p &&
        typeof p.id === "string" &&
        Number.isFinite(p.capital) &&
        Number.isInteger(p.max_contracts),
    );
  } catch {
    plans = [];
  }
  shell(
    heading(
      "YOUR WORKSPACE",
      "My Bots",
      "Review your saved illustrations. No brokerage account or copy subscription is active.",
      link("/bots", "Explore bots"),
    ) +
      `<section class="panel"><h2>Saved simulation plans</h2>${plans.length ? plans.map((p) => `<article class="saved-plan"><div><h3>THETA · Local draft</h3>${badge("DEMO DATA", "demo")}<p>Illustrative capital ${money(p.capital)} · Maximum ${esc(p.max_contracts)} contracts</p><small>Stored only in this browser. It does not allocate capital or start a bot.</small></div><button class="button secondary" data-remove="${esc(p.id)}">Remove draft</button></article>`).join("") : empty("Your first bot starts with understanding", "Explore THETA, review its risks, and try an illustrative capital scenario.", link("/bots/theta/simulate", "Simulate THETA", "button primary"))}</section><section class="panel"><h2>Automation & copy status</h2><p>Copy activation, pause, stop and join-existing-position controls will become available after account isolation, execution and reconciliation pass their release gates.</p>${badge("NOT AVAILABLE")}</section>`,
  );
  document.querySelectorAll("[data-remove]").forEach((b) =>
    b.addEventListener("click", () => {
      try {
        localStorage.setItem(
          "tb.demo.plans.v1",
          JSON.stringify(
            plans.filter((p) => String(p.id) !== b.dataset.remove),
          ),
        );
        myBots();
      } catch {
        b.textContent = "Browser storage unavailable";
      }
    }),
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
    else if (path === "/owner") {
      shell(ownerPage());
      bindOwner();
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
      if (path === "/activity")
        shell(
          heading(
            "DECISIONS & EVENTS",
            "Activity",
            "Every action should have a reason and a record.",
            link(
              demo ? "/activity" : "/activity?dataset=demo",
              demo ? "Published activity" : "Explore demo activity",
            ),
          ) +
            `<section class="panel">${activityList(detail.activity)}</section>`,
        );
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
      else if (path.endsWith("/simulate")) {
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

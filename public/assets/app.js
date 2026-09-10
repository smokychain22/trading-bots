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
  ["history", "Trades"],
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
  root.innerHTML = `<aside class="sidebar"><a class="brand" href="/"><img src="/assets/mark.svg" width="34" height="34" alt=""><span>trading<span class="brand-light">bots</span><small>AUTOMATED STRATEGIES</small></span></a><div class="nav-label">ACCOUNT</div><nav aria-label="Primary">${nav.map(([href, text, icon]) => `<a href="${href}${q}" ${path === href || (href === "/overview" && path === "/") || (href === "/bots" && path.startsWith("/bots")) ? 'aria-current="page"' : ""}><span aria-hidden="true">${icon}</span>${text}</a>`).join("")}</nav><div class="sidebar-bottom"><div class="workspace-card"><span class="status-dot"></span><div>Paper environment<small>Live trading disabled</small></div></div></div></aside><div class="workspace"><header class="topbar"><span class="breadcrumb">Workspace <span>/</span> ${path.startsWith("/bots/theta") ? "Bots / THETA" : path === "/" || path === "/overview" ? "Home" : "Trading Bots"}</span><div class="top-actions"><span class="website-state"><span class="status-dot"></span>Platform online</span>${badge("PAPER ONLY", "blue")}<span class="avatar" aria-label="Visitor workspace">V</span></div></header><main id="main" tabindex="-1">${demo ? `<div class="demo-banner" role="status"><div><strong>DEMO DATA</strong> You’re viewing a test fixture. Values are synthetic.</div>${link(path, "Exit demo", "text-link")}</div>` : ""}${content}</main><footer><span>Trading Bots</span><span>Paper trading only. Activation unavailable.</span><a href="/bots/theta/how-it-works#risks">Options risk disclosure</a></footer></div>`;
}
function heading(eyebrow, title, description, actions = "") {
  return `<div class="page-heading"><div><p class="eyebrow">${esc(eyebrow)}</p><h1>${esc(title)}</h1><p class="lede">${esc(description)}</p></div><div class="heading-actions">${actions}</div></div>`;
}
function card(bot) {
  return `<article class="bot-card roadmap-card"><div class="card-top"><span class="bot-monogram ${esc(bot.bot_id)}" aria-hidden="true">${{ theta: "Θ", atlas: "A", nexus: "N", vega: "V", event: "E", pulse: "P" }[bot.bot_id]}</span>${badge("COMING LATER")}</div><div class="card-name"><h2>${esc(bot.name)}</h2><span class="caption">${esc(bot.category)}</span></div><p class="card-description">Future ${esc(bot.strategy.toLowerCase())} strategy.</p><div class="research-note"><span class="tiny-square"></span>Not available</div><div class="card-actions">${link(`/bots/${bot.bot_id}`, "View details", "button secondary grow")}</div></article>`;
}
function discovery() {
  shell(
    heading(
      "PAPER COPY TRADING",
      "Trading Bots",
      "Choose a bot and connect your paper account to copy its trades.",
    ) +
      `<section class="theta-product-card"><div class="theta-product-main"><div class="card-top"><div class="launch-title"><span class="bot-monogram large theta" aria-hidden="true">Θ</span><div><p class="eyebrow">PREMIUM INCOME</p><h2>THETA</h2></div></div>${badge("PAPER TESTING", "blue")}</div><p class="lede">An assignment-aware options strategy designed to collect premium and manage the full position when shares are assigned.</p><div class="product-metrics"><div><span>Return</span><strong>—</strong></div><div><span>Win rate</span><strong>—</strong></div><div><span>Max drawdown</span><strong>—</strong></div><div><span>Trades</span><strong>0</strong></div></div><p class="track-note">No validated track record yet.</p><div class="launch-actions">${link("/bots/theta", "View bot", "button secondary")}${link("/bots/theta/copy", "Copy THETA", "button primary")}</div></div><aside><h3>Paper testing</h3><p>THETA is preparing to build a reconciled paper track record. No customer orders can be placed from this site.</p>${link("/bots/theta/how-it-works", "How THETA works", "text-link")}</aside></section><section class="section-heading discovery-title"><div><p class="eyebrow">COMING LATER</p><h2>Future bots</h2><p>Five additional strategies are on the roadmap.</p></div></section><div id="bot-grid" class="bot-grid research-grid"></div><details class="roadmap-browser"><summary>Filter future bots</summary><form id="filters" class="filters compact-filters"><label class="search-field">Search<input name="search" type="search" placeholder="Bot name" value="${esc(url.searchParams.get("search") ?? "")}"></label>${[
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
          "Reset the filters to see the roadmap.",
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
  return `<div class="theta-context"><div class="bot-identity"><div class="bot-monogram theta" aria-hidden="true">Θ</div><div><p class="eyebrow">PREMIUM INCOME</p><div class="identity-line"><h1>THETA</h1>${badge("PAPER TESTING", "blue")}</div><p>Assignment-aware options income</p></div></div><div class="heading-actions">${link("/bots/theta/copy", "Copy THETA", "button primary")}${link("/bots/theta/history", "View trades", "button secondary")}</div></div><div class="theta-context-copy"><p>THETA sells cash-secured puts and manages assignment, recovery, and covered calls as one complete position.</p><span>Paper track record is being built.</span></div><nav class="tabs theta-tabs" aria-label="THETA sections">${botTabs.map(([key, text]) => `<a href="/bots/theta${key ? "/" + key : ""}${q}" ${section === key ? 'aria-current="page"' : ""}>${text}</a>`).join("")}</nav>`;
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
  return `<section class="panel equity-panel"><div class="section-heading"><div><p class="eyebrow">${demo ? "DEMO DATA" : "PAPER PERFORMANCE"}</p><h2>${drawdown ? "Drawdown" : "Equity curve"}</h2></div>${detail.performance.equity.length ? `<div class="chart-controls"><label>View<select id="series" aria-label="Chart view"><option value="${drawdown ? "drawdown" : "total"}">${drawdown ? "Drawdown" : "Total equity"}</option>${drawdown ? "" : '<option value="realized">Realized</option><option value="unrealized">Unrealized</option><option value="drawdown">Drawdown</option>'}</select></label><label>Period<select id="period" aria-label="Period"><option value="all">All</option><option value="30d">30d</option><option value="90d">90d</option><option value="1y">1y</option></select></label></div>` : ""}</div><div id="equity-chart">${chart(detail.performance.equity, drawdown ? "drawdown" : "total")}</div>${demo ? '<p class="caption chart-caption">DEMO DATA. Synthetic values, not a track record.</p>' : ""}${detail.performance.equity.length ? `<details class="chart-data"><summary>View chart values</summary>${table(
    ["Date", "Total equity", "Realized", "Unrealized", "Drawdown"],
    detail.performance.equity.map((p) => [
      esc(p.date),
      money(p.total),
      money(p.realized),
      money(p.unrealized),
      p.drawdown.toFixed(2) + "%",
    ]),
    "Equity observations, DEMO DATA when populated",
  )}</details>` : ""}</section>`;
}
function performanceHeadline() {
  const byName = (name) => detail.performance.metrics.find((item) => item.technical_name === name)?.value ?? null;
  const pnl = byName("Whole-Chain P&L");
  const rows = [
    { label: "Total return", technical_name: "Economic return", unit: "PERCENT", value: demo && pnl != null ? pnl / 1000 : null, explanation: "Total economic gain or loss relative to starting capital.", reason: "" },
    { label: "Total P&L", technical_name: "Whole-Chain P&L", unit: "USD", value: pnl, explanation: "Options, assigned stock, dividends, fees, and costs.", reason: "" },
    { label: "Win rate", technical_name: "Managed Episode WR", unit: "PERCENT", value: byName("Managed Episode WR"), explanation: "Share of completed economic episodes that ended profitably.", reason: "" },
    { label: "Max drawdown", technical_name: "Maximum Drawdown", unit: "PERCENT", value: byName("Maximum Drawdown"), explanation: "Largest decline from a prior equity peak.", reason: "" },
    { label: "Trades", technical_name: "Completed trades", unit: "COUNT", value: demo ? detail.performance.track_record.resolved_episodes : null, explanation: "Completed and reconciled paper episodes.", reason: "" },
    { label: "Open positions", technical_name: "Open positions", unit: "COUNT", value: demo ? detail.positions.length : null, explanation: "Broker-reconciled positions currently open.", reason: "" },
  ];
  return `<div class="kpi-strip customer-kpis">${rows.map((item) => metricCard(item, demo)).join("")}</div>`;
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
  return `${performanceHeadline()}${!demo && !detail.performance.metrics.some((item) => item.value != null) ? '<p class="track-note centered">Paper track record is being built. Performance will appear after completed paper trades.</p>' : ""}<div class="overview-grid customer-overview"><div><section class="panel"><div class="section-heading"><div><h2>Current positions</h2><p>What THETA is trading now.</p></div>${link("/bots/theta/positions" + q, "View all", "text-link")}</div>${detail.positions.length ? positionRows(detail.positions.slice(0, 3)) : empty("No open positions", "THETA has no published paper positions right now.")}</section><section class="panel"><div class="section-heading"><h2>Recent activity</h2>${link("/activity", "View all", "text-link")}</div>${activityList(detail.activity.slice(-4))}</section></div><aside class="panel theta-summary"><h2>Before you copy</h2><ul class="plain-list"><li>Cash-secured puts can lead to share assignment.</li><li>Assigned shares can lose value and tie up capital.</li><li>Covered calls are used only when the economics support them.</li><li>Your account limits can cause trades to be reduced or skipped.</li></ul>${link("/bots/theta/how-it-works", "How THETA works", "text-link")}</aside></div>`;
}
function performance() {
  const hasRecord = demo || detail.performance.track_record.resolved_episodes > 0;
  if (!hasRecord)
    return `<section class="panel performance-empty">${empty("THETA is building its paper track record", "Performance will appear after completed paper trades.", link("/bots/theta", "Back to THETA", "button secondary"))}</section>`;
  const profitFactor = detail.performance.metrics.find((item) => item.technical_name === "Profit Factor") ?? { label: "Profit factor", technical_name: "Profit Factor", unit: "RATIO", value: null, explanation: "Gross wins divided by gross losses." };
  return `${performanceHeadline()}<div class="single-kpi">${metricCard(profitFactor, demo)}</div>${equityPanel()}<div class="two-columns"><section class="panel"><h2>Monthly returns</h2><div class="returns">${detail.performance.monthly.map((m) => `<div><span>${esc(m.month)}</span><strong class="${m.return_pct < 0 ? "negative" : "positive"}">${m.return_pct.toFixed(2)}%</strong><small>DEMO DATA</small></div>`).join("")}</div></section><section class="panel"><h2>Recent completed trades</h2>${tradeRows(detail.history.slice(-5))}</section></div><details class="panel customer-more"><summary>More statistics</summary><p>Additional validated customer metrics will appear as the reconciled paper sample grows. Detailed model, execution, and statistical diagnostics remain in the private operator console.</p></details>`;
}
function positions() {
  return `<section class="panel"><div class="section-heading"><div><h2>Positions</h2><p>Open positions copied by THETA.</p></div>${badge(demo ? "DEMO DATA" : "PAPER", demo ? "demo" : "blue")}</div><div id="positions-table">${positionRows(detail.positions)}</div></section>`;
}
function positionRows(rows) {
  return rows.length
    ? table(
        [
          "Symbol",
          "Strategy",
          "Position",
          "Strike",
          "Expiry",
          "Entry",
          "Current value",
          "P&L",
          "Status",
        ],
        rows.map((p) => [
          link(`/bots/theta/chains/${p.chain_id}${q}`, p.symbol, "text-link"),
          "THETA",
          `<span class="mono">${esc(p.contract ?? p.position)}</span>`,
          p.strike == null ? "—" : money(p.strike),
          p.expiration ?? "—",
          money(p.entry_credit),
          p.current_price == null ? "—" : money(p.current_price),
          `<span class="${p.whole_chain_pnl < 0 ? "negative" : "positive"}">${money(p.whole_chain_pnl)}</span>`,
          badge(customerPositionStatus(p.lifecycle_state), "amber"),
        ]),
        demo ? "Open positions, DEMO DATA" : "Open positions",
      )
    : empty(
        "No open positions",
        "THETA has no published paper positions right now.",
      );
}
function customerPositionStatus(value) {
  return ({ CSP_OPEN: "Put open", ASSIGNMENT: "Assigned", STOCK: "Shares held", RECOVERY_WAIT: "Waiting for recovery", COVERED_CALL: "Covered call", ROLL: "Rolling", CLOSING: "Closing" })[value] ?? label(value);
}
function customerTradeAction(value) {
  return ({ OPEN_CSP: "Opened put", CLOSE_CSP: "Closed put", EXPIRE: "Put expired", ROLL: "Rolled position", ACCEPT_ASSIGNMENT: "Assigned shares", STOCK_HELD: "Held shares", RECOVERY_WAIT: "Waiting for recovery", SELL_CC: "Sold covered call", CLOSE_CC: "Closed covered call", CALL_AWAY: "Shares called away", CLOSE_STOCK: "Sold shares", REDEPLOY: "Ready for next trade" })[value] ?? label(value);
}
function tradeRows(rows) {
  return rows.length ? table(
    ["Date", "Symbol", "Action", "Contract", "Entry / exit", "P&L", "Status"],
    rows.map((t) => [date(t.time), esc(t.symbol), esc(customerTradeAction(t.action)), `<span class="mono">${esc(t.contract ?? "Shares")}</span>`, t.fill == null ? "—" : money(t.fill), money(t.pnl_effect), badge(t.status, demo ? "demo" : "blue")]),
    demo ? "Completed trades, DEMO DATA" : "Completed paper trades",
  ) : empty("No trades yet", "Completed paper trades will appear here.");
}
function tradeHistory() {
  return `<section class="panel"><div class="section-heading"><div><h2>Trade history</h2><p>Completed THETA paper trades.</p></div>${badge(demo ? "DEMO DATA" : "PAPER", demo ? "demo" : "blue")}</div>${tradeRows(detail.history)}</section>`;
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
        "Trades and bot activity will appear here after the paper runtime is connected.",
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
      `<section class="panel my-bots-empty">${empty("No bots are copying yet", "Connect an Alpaca Paper account and choose how much you want THETA to use.", link("/bots/theta/copy", "Copy THETA", "button primary"))}<p class="simple-status">Paper copying is being enabled. Pause and stop controls will appear after activation is available.</p></section>`,
  );
}
function home() {
  shell(
    `<section class="home-hero"><div><p class="eyebrow">AUTOMATED OPTIONS BOTS</p><h1>Copy options strategies with your Alpaca Paper account.</h1><p class="lede">Start with THETA, review its paper performance, and choose how much capital you want it to use.</p><div class="heading-actions">${link("/bots/theta", "View THETA", "button secondary")}${link("/bots/theta/copy", "Copy THETA", "button primary")}</div></div><aside><div class="launch-title"><span class="bot-monogram large theta" aria-hidden="true">Θ</span><div><h2>THETA</h2><p>Assignment-aware premium strategy</p></div></div>${badge("PAPER TESTING", "blue")}<dl class="home-bot-facts"><div><dt>Track record</dt><dd>Building</dd></div><div><dt>Open positions</dt><dd>—</dd></div><div><dt>Customer copying</dt><dd>Coming soon</dd></div></dl></aside></section><section class="home-steps"><div><span>1</span><p><strong>Choose a bot</strong>Understand the strategy and risks.</p></div><div><span>2</span><p><strong>Connect Alpaca Paper</strong>Your brokerage account stays with Alpaca.</p></div><div><span>3</span><p><strong>Set your limits</strong>Choose capital and a risk preference.</p></div><div><span>4</span><p><strong>Track results</strong>See positions, trades, and economic P&amp;L.</p></div></section>`,
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
    if (path === "/") home();
    else if (path === "/bots") discovery();
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
            "Your trades and THETA activity in one place.",
          ) +
            `<div class="activity-filters" role="group" aria-label="Activity filter"><button class="button secondary" data-feed="all" aria-pressed="true">All</button><button class="button quiet" data-feed="trade" aria-pressed="false">Trades</button><button class="button quiet" data-feed="decision" aria-pressed="false">Bot activity</button></div><section class="panel">${activityList(detail.activity)}</section>`,
        );
        document.querySelectorAll("[data-feed]").forEach((button) => button.addEventListener("click", () => {
          const kind = button.dataset.feed;
          document.querySelectorAll("[data-feed]").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
          document.querySelectorAll("[data-activity-type]").forEach((item) => { item.hidden = kind !== "all" && item.dataset.activityType !== kind; });
        }));
      }
      else if (path === "/overview")
        home();
      else if (id !== "theta")
        shell(
          heading("COMING LATER", detail.name, detail.description) +
            `<section class="panel future-detail">${badge("NOT AVAILABLE")}<h2>${esc(detail.category)}</h2><p>This bot isn’t available yet. THETA is the only strategy currently in paper testing.</p>${link("/bots", "Back to bots")}</section>`,
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

export const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const money = (value) =>
  typeof value !== "number" || !Number.isFinite(value)
    ? "Unavailable"
    : `${value < 0 ? "-" : ""}$${Math.abs(value).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
export const date = (value) =>
  value
    ? new Date(value).toLocaleString("en-US", {
        timeZone: "UTC",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }) + " UTC"
    : "Not yet available";
export const label = (value) => String(value).replaceAll("_", " ");
export function badge(text, tone = "") {
  return `<span class="badge ${esc(tone)}">${esc(label(text))}</span>`;
}
export function metricCard(m, demo = false) {
  const value =
    m.value == null
      ? "—"
      : m.unit === "USD"
        ? money(m.value)
        : m.unit === "PERCENT"
          ? `${m.value.toFixed(2)}%`
          : Number(m.value).toLocaleString("en-US", {
              maximumFractionDigits: 2,
            });
  const caption = demo && m.value != null
    ? "DEMO DATA"
    : m.value == null
      ? m.reason === "" ? "" : "Paper track record is being built"
      : m.reason ?? m.technical_name;
  return `<article class="metric"><div class="metric-title">${esc(m.label)}<details class="tooltip"><summary aria-label="About ${esc(m.label)}">i</summary><p><strong>${esc(m.technical_name)}</strong><br>${esc(m.explanation)}</p></details></div><p class="metric-value ${m.value != null && m.unit === "USD" ? (m.value < 0 ? "negative" : "positive") : ""}">${value}</p>${caption ? `<span class="caption">${esc(caption)}</span>` : ""}</article>`;
}
export function empty(title, text, action = "") {
  return `<div class="empty"><span class="empty-symbol" aria-hidden="true">⌁</span><h3>${esc(title)}</h3><p>${esc(text)}</p>${action}</div>`;
}
export const link = (href, text, cls = "button secondary") =>
  `<a class="${cls}" href="${esc(href)}">${esc(text)}</a>`;
export function table(headers, rows, caption) {
  return `<div class="table-scroll" tabindex="0" role="region" aria-label="${esc(caption)}"><table><caption>${esc(caption)}</caption><thead><tr>${headers.map((h) => `<th scope="col">${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}
export function chart(points, series = "total") {
  if (!points.length)
    return empty(
      "Paper track record is being built",
      "The equity curve will appear after completed paper trades.",
    );
  const values = points.map((p) => p[series]);
  if (values.some((v) => v == null))
    return empty(
      "Benchmark unavailable",
      "No matched benchmark series has been published for this illustration.",
    );
  const min = Math.min(...values),
    max = Math.max(...values),
    range = max - min || 1;
  const coords = values.map((v, i) => [
    65 + (i * 770) / Math.max(values.length - 1, 1),
    210 - ((v - min) / range) * 160,
  ]);
  const ticks = [0, 1, 2, 3]
    .map((i) => {
      const y = 50 + (i * 160) / 3;
      const v = max - (i * range) / 3;
      return `<line x1="65" x2="835" y1="${y}" y2="${y}" class="gridline"/><text x="54" y="${y + 4}" text-anchor="end">${series === "drawdown" ? v.toFixed(1) + "%" : "$" + (v / 1000).toFixed(1) + "k"}</text>`;
    })
    .join("");
  const path = coords.map(([x, y], i) => `${i ? "L" : "M"}${x},${y}`).join(" ");
  return `<div class="chart"><svg viewBox="0 0 880 260" role="img" aria-label="DEMO DATA. ${esc(series)} chart with ${points.length} observations. Values are also in the expandable table."><title>Illustrative ${esc(series)} series, not live data</title>${ticks}<path d="${path} L835,220 L65,220 Z" class="chart-area"/><path d="${path}" class="chart-line ${series === "drawdown" ? "loss-line" : ""}"/>${coords.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="3" class="chart-point"><title>${esc(points[i].date)}: ${values[i]}</title></circle>`).join("")}<text x="65" y="249">${esc(points[0].date)}</text><text x="450" y="249" text-anchor="middle">DEMO DATA · Not a track record</text><text x="835" y="249" text-anchor="end">${esc(points.at(-1).date)}</text></svg></div>`;
}
export function lifecycle(events) {
  return `<ol class="timeline">${events.map((e) => `<li><time>${date(e.timestamp)}</time><div><h3>${esc(label(e.action))}</h3><p>${esc(e.reason)}</p><details><summary>Accounting and decision details</summary><dl class="facts"><div><dt>Contract</dt><dd class="mono">${esc(e.contract ?? "Stock / cash")}</dd></div><div><dt>Cashflow</dt><dd>${money(e.cashflow)}</dd></div><div><dt>Realized P&L effect</dt><dd>${money(e.realized_pnl)}</dd></div><div><dt>Stock MTM</dt><dd>${money(e.unrealized_pnl)}</dd></div><div><dt>Option price</dt><dd>${e.option_price == null ? "Not applicable" : "$" + e.option_price.toFixed(2)}</dd></div><div><dt>Strategy version</dt><dd>${esc(e.strategy_version)}</dd></div></dl></details></div></li>`).join("")}</ol>`;
}

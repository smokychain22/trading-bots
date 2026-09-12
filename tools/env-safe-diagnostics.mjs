import { readFileSync } from "node:fs";
import { parse } from "dotenv";

const source = process.argv[2] ?? ".env.local";
const values = source === "--process-env" ? process.env : parse(readFileSync(source));
const alpaca = values.ALPACA_BASE_URL ?? "";
const email = values.OPTIONOMICS_EMAIL ?? "";
let parsed = { protocol: null, hostname: null, pathname: null };
try {
  const url = new URL(alpaca);
  parsed = {
    protocol: url.protocol,
    hostname: url.hostname,
    pathname: url.pathname,
  };
} catch {
  // Malformed values remain null. The value itself is never printed.
}
const quoted = (value) => ({
  startsWithQuote: /^["']/.test(value),
  endsWithQuote: /["']$/.test(value),
});
console.info(
  JSON.stringify({
    alpaca: {
      source: source === "--process-env" ? "Vercel Production process environment" : `${source} parsed by dotenv`,
      length: alpaca.length,
      ...quoted(alpaca),
      ...parsed,
    },
    optionomicsEmail: {
      source: source === "--process-env" ? "Vercel Production process environment" : `${source} parsed by dotenv`,
      length: email.length,
      ...quoted(email),
      containsAt: email.includes("@"),
      atCount: email.match(/@/g)?.length ?? 0,
    },
    precedence: [
      "explicit dotenv file parsed by dotenv",
      "process environment fallback",
      "schema defaults",
    ],
    processFallbackPresent: {
      alpacaBase: Boolean(process.env.ALPACA_BASE_URL),
      optionomicsEmail: Boolean(process.env.OPTIONOMICS_EMAIL),
    },
    sensitivePresence: Object.fromEntries([
      "CRON_SECRET", "PAPER_COPY_TOKEN_ENCRYPTION_KEY", "ALPACA_API_KEY",
      "ALPACA_SECRET_KEY", "OPTIONOMICS_API_KEY",
    ].map((name) => [name, {
      present: typeof values[name] === "string" && values[name].length > 0,
      length: typeof values[name] === "string" ? values[name].length : 0,
      redacted: values[name] === "[SENSITIVE]",
    }])),
  }),
);

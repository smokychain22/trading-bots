import type { IncomingMessage, ServerResponse } from "node:http";
import { validSession } from "./api.js";

const shell = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0c1017"><meta name="robots" content="noindex,nofollow"><title>Operations | Trading Bots</title><link rel="stylesheet" href="/assets/styles.css"><script type="module" src="/assets/app.js"></script></head><body><a class="skip-link" href="#main">Skip to content</a><div id="app"><main id="main" class="initial" aria-busy="true"><h1>Operations</h1><p role="status">Loading the private workspace...</p></main></div></body></html>`;

export function hasOperatorSession(cookie = ""): boolean {
  return validSession(cookie, process.env.THETA_READINESS_TOKEN ?? "");
}

export function serveOps(
  request: IncomingMessage,
  response: ServerResponse,
): void {
  if (!hasOperatorSession(request.headers.cookie ?? "")) {
    response.statusCode = 302;
    response.setHeader("Location", "/ops/login");
    response.setHeader("Cache-Control", "no-store");
    response.end();
    return;
  }
  response.statusCode = 200;
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Robots-Tag", "noindex, nofollow");
  response.end(shell);
}

export default function opsHandler(
  request: IncomingMessage,
  response: ServerResponse,
): void {
  if (request.method !== "GET") {
    response.statusCode = 405;
    response.setHeader("Allow", "GET");
    response.end();
    return;
  }
  serveOps(request, response);
}

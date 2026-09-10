import express from "express";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import customerHandler from "./customer/api.js";
import { hasOperatorSession } from "./customer/ops-access.js";

export const app = express();
app.disable("x-powered-by");
// Keep local security behavior identical to the deployed static site.
const deployment = JSON.parse(readFileSync(resolve("vercel.json"), "utf8")) as {
  headers: { headers: { key: string; value: string }[] }[];
};
const reticleDev = (() => {
  if (process.env.NODE_ENV !== "development") return null;
  try {
    const token = readFileSync(
      resolve(homedir(), ".reticle", "pairing-token"),
      "utf8",
    ).trim();
    const project = JSON.parse(
      readFileSync(resolve(".reticle.json"), "utf8"),
    ) as { projectId?: string };
    if (!token || !project.projectId) return null;
    const nonce = randomBytes(16).toString("base64url");
    return {
      nonce,
      script:
        '<script type="importmap" nonce="' +
        nonce +
        '">{"imports":{"@reticlehq/core":"/__reticle/core/index.js","zod":"/__reticle/zod/index.js"}}</script><script type="module" nonce="' +
        nonce +
        '">import { reticle } from "/__reticle/index.js"; reticle.connect({ projectId: ' +
        JSON.stringify(project.projectId) +
        ", token: " +
        JSON.stringify(token) +
        ' });</script>',
    };
  } catch {
    return null;
  }
})();
app.use((_request, response, next) => {
  for (const header of deployment.headers[0]?.headers ?? []) {
    let value = header.value;
    if (reticleDev && header.key === "Content-Security-Policy") {
      value = value
        .replace("script-src 'self'", "script-src 'self' 'nonce-" + reticleDev.nonce + "'")
        .replace(
          "connect-src 'self'",
          "connect-src 'self' ws://localhost:4400 ws://127.0.0.1:4400",
        );
    }
    response.setHeader(header.key, value);
  }
  next();
});
app.get("/healthz", (_request, response) => response.json({ status: "ok" }));
app.get("/readyz", (_request, response) =>
  response.json({ status: "not-ready", trading: "disabled" }),
);
app.use("/api/v1", (request, response) => {
  request.url = request.originalUrl;
  void customerHandler(request, response);
});
app.get("/ops", (request, response) => {
  if (!hasOperatorSession(request.headers.cookie ?? "")) {
    response.redirect(302, "/ops/login");
    return;
  }
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Robots-Tag", "noindex, nofollow");
  response.sendFile(resolve("public/index.html"));
});
app.use(
  "/__reticle",
  express.static(resolve("node_modules/@reticlehq/browser/dist")),
);
app.use(
  "/__reticle/core",
  express.static(resolve("node_modules/@reticlehq/core/dist")),
);
app.use("/__reticle/zod", express.static(resolve("node_modules/zod")));
app.use((request, response, next) => {
  if (
    !reticleDev ||
    request.method !== "GET" ||
    request.path.startsWith("/api/") ||
    request.path.startsWith("/__reticle") ||
    request.path.includes(".")
  ) {
    next();
    return;
  }
  const html = readFileSync(resolve("public/index.html"), "utf8");
  response
    .type("html")
    .send(html.replace("</body>", reticleDev.script + "</body>"));
});
app.use(express.static(resolve("public")));
app.get("/{*path}", (_request, response) =>
  response.sendFile(resolve("public/index.html")),
);

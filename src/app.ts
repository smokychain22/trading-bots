import express from "express";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import customerHandler from "./customer/api.js";

export const app = express();
app.disable("x-powered-by");
// Keep local security behavior identical to the deployed static site.
const deployment = JSON.parse(readFileSync(resolve("vercel.json"), "utf8")) as {
  headers: { headers: { key: string; value: string }[] }[];
};
app.use((_request, response, next) => {
  for (const header of deployment.headers[0]?.headers ?? [])
    response.setHeader(header.key, header.value);
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
app.use(express.static(resolve("public")));
app.get("/{*path}", (_request, response) =>
  response.sendFile(resolve("public/index.html")),
);

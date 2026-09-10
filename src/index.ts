import { app } from "./app.js";
import pino from "pino";
import { loadEnvironment } from "./config/environment.js";

const environment = loadEnvironment();
const logger = pino({
  level: "info",
  redact: ["req.headers.authorization", "*.apiKey", "*.secret", "*.token"],
});
app.listen(environment.PORT, () => {
  logger.info(
    {
      port: environment.PORT,
      nodeEnv: environment.NODE_ENV,
      trading: "disabled",
    },
    "THETA control plane started",
  );
});

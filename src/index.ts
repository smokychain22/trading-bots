import express from 'express';
import pino from 'pino';
import { loadEnvironment } from './config/environment.js';

const environment = loadEnvironment();
const logger = pino({ level: 'info', redact: ['req.headers.authorization', '*.apiKey', '*.secret', '*.token'] });
const app = express();

app.get('/healthz', (_request, response) => response.status(200).json({ status: 'ok' }));
app.get('/readyz', (_request, response) => response.status(200).json({ status: 'not-ready', trading: 'disabled' }));

app.listen(environment.PORT, () => {
  logger.info({ port: environment.PORT, nodeEnv: environment.NODE_ENV, trading: 'disabled' }, 'THETA control plane started');
});

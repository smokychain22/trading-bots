# trading-bots

THETA is a paper-first, assignment-aware premium-selling Wheel control plane. It uses Alpaca for broker and executable-market truth and Optionomics for contextual options intelligence.

Trading is disabled in this Phase 0 foundation. Read [the supplied THETA v1.1 specifications](../) before strategy or execution work. Do not commit environment files or provider credentials.

## Local checks

```powershell
npm ci
npm run lint
npm run check
npm test
npm run build
```

`npm run validate:env` prints configuration status and missing variable names only. It never prints secret values.

# Trading Bots design system

## Direction

Institutional trading software with a calm, approachable interface. Original wordmark and T glyph, near-black navy canvas, charcoal surfaces, thin cool borders, restrained violet primary action. No neon profit treatments, casino effects or competitor assets.

Implementation lives in public/assets/styles.css, ui.js and app.js. Static ES modules avoid adding a frontend framework to this small existing TypeScript service. Components render frontend-safe contracts, independent from trading logic.

## Tokens and layout

Spacing follows 4, 8, 12, 16, 24, 32 and 48 pixel increments. Desktop uses a persistent navigation rail, a constrained professional workspace and a primary 8/4 overview split. Cards use three columns where space allows, two on tablet and one on mobile. Data tables have labeled, keyboard-focusable horizontal scrolling regions.

Finance uses tabular numerals and contextual money precision. IDs and option contracts use monospace. Primary reading text uses the system sans-serif stack, avoiding external font requests and font-loading instability.

Semantic green means positive or healthy, red means loss or danger, amber means warning, blue means system/environment, violet means research/intelligence and neutral means unknown or inactive. State labels accompany color.

## Reusable primitives

BotCard, environment/status/provenance badges, metric cards with accessible disclosures, equity/drawdown chart, monthly return cells, lifecycle timeline, scrollable tables, risk summary, intelligence panels, empty/error states, stale/degraded banners and comparison table.

Small rendering functions are preferred over one class per visual. Workflow binding is separate from primitive rendering. The view models stay in src/customer and contain no HTML.

## Accessibility

Skip link, semantic navigation and headings, visible focus, associated form labels, native selects and disclosures, reduced-motion support, chart accessible name and table alternative. Tables retain row and column semantics. Unknown states do not depend on color. Automated checks target WCAG 2 A/AA, 2.1 AA and 2.2 AA, accompanied by keyboard and viewport checks.

Automated axe checks are not a legal certification or a substitute for a screen-reader usability study. OS-native controls and screen-reader combinations still require broader user testing.

## Required states

Published empty, demo, research, shadow, paper, display-only live-style, loading, request error, network failure, stale, degraded, invalid, paused, closed market, broker unavailable, model unavailable and insufficient evidence. A live-style test fixture cannot reveal Activate because release capability remains false.

Reference screenshots and the verification report are in docs/visual and docs/BOTS_VERIFICATION.md. CI retains browser traces and screenshots as build artifacts.

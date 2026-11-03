# Verification record

Implementation branch: `codex/bubble-player`. This document distinguishes automated evidence from physical-device release gates.

## Automated local evidence

- TypeScript strict checking and Vite production build at `/19-bubble-pwa/`.
- Exact scorer: 5,184 exhaustive small graph/value cases, 1,000 seeded random cases, certificate checks, hand-calculated and independently discovered counterexamples.
- Protocol: ten immutable Python cross-checked golden vectors and dictionary digests; 1,000 generated-code graph/range/connectivity/legal-history checks; checksum collision/ambiguity, correction, leading-zero, version and stream separation tests.
- Arithmetic: all 36 die pairs and all five operations. Phase, occupied-node and operation-capacity rejection checks.
- Result imports: valid complete histories and malformed schema, code, move count, node, operation, duplicate node, encoding, and size rejection.
- Chrome 156.0.8078.80: complete UI game, persisted revealed roll, result replay, narrow layout, keyboard activation, transaction revision conflict, quota failure, retained malformed records, offline cold page followed by all 19 moves, result text and a new offline game, and safe service-worker update tests. Exact final browser results are recorded in the PR.

Desktop benchmark: macOS arm64, Node 24, 1,000 generated boards with coordinate gradients and random values. Initial run: p95 3.72 ms, maximum 26.94 ms; ascending 19-node chain 0.45 ms. Timings vary between runs. This is not a mobile-device performance claim and does not measure peak memory.

## Outstanding release gates requiring real devices

- Actual iPad Safari portrait/landscape touch and screen-reader checks; record model, iPadOS, and Safari version.
- Install/Add to Home Screen and standalone offline cold launch on a physical iPad.
- Native share sheet and clipboard fallback with real device permissions.
- Representative mobile benchmark: at least 1,000 boards, p95 ≤250 ms target, maximum time and peak memory. Worker responsiveness must remain acceptable even for outliers.
- Final contrast and practical touch-target review on the actual generated layouts. SVG bubbles scale to fit the viewport; the expandable Large bubble controls provide 54 px minimum-height buttons on narrow layouts.

WebKit iPad emulation is useful automated coverage, but cannot close these physical-device gates. No deployment or physical-device testing is claimed.

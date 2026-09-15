# MULTI-LOAN PORTFOLIO UPDATE

Verified 16 September 2026. The application remains a static browser application with no runtime dependencies or financial-data uploads.

## Completion checklist

| Check | Result |
| --- | --- |
| Existing single-loan functionality preserved | PASS |
| Legacy saved data migration | PASS |
| Multiple mortgages | PASS |
| Different interest rates | PASS |
| Different banks | PASS |
| Independent flexi balances | PASS |
| Different rate-change schedules | PASS |
| Portfolio dashboard | PASS |
| Total outstanding calculation | PASS |
| Portfolio future interest | PASS |
| Portfolio settlement date | PASS |
| Highest-rate-first simulation | PASS |
| Lowest-balance-first simulation | PASS |
| Equal allocation | PASS |
| Proportional allocation | PASS |
| Custom allocation | PASS |
| Payment rollover | PASS |
| Target portfolio payoff | PASS |
| Lump-sum simulator | PASS |
| Flexi reallocation simulator | PASS |
| Rate shock simulator | PASS |
| JSON backup/restore | PASS |
| CSV export | PASS |
| Print report | PASS |
| Existing tests | PASS |
| New portfolio tests | PASS |
| Phone portrait | PASS |
| Phone landscape | PASS |
| Tablet | PASS |
| Desktop | PASS |
| Production build | PASS |

## Test totals

**121 passing tests:**

- 42 unchanged original engine/storage tests.
- 15 unchanged original browser tests.
- 43 new portfolio engine/storage tests.
- 21 new portfolio browser tests.

Commands: `npm test`, `npm run test:browser`, `npm run build`.

The in-app browser connector was unavailable. Browser tests used the installed Microsoft Edge through Playwright. Screenshots and PDF renderings were inspected. No page errors or console errors appeared in the viewport checks. No new runtime dependencies were added.

### Critical regressions

The previous demo, pinned to 15 September 2026, remains unchanged: RM 350,000 at 4.15% daily Actual/365, RM 2,000 normal plus RM 1,000 extra, payment day 1, no parked funds. It settles **1 March 2039**, with **RM 98,078.28** interest, **150** payments and **RM 1,078.28** final payment.

The ordinary `calculate()` result and a no-extra/no-rollover portfolio stream produce identical individual schedules. Existing daily, monthly, leap-year, flexi, rate-change, target-solver and final-payment tests remain intact. The engine formulas were not duplicated into the portfolio modules.

## Manual two-loan verification

Both calculation snapshots start 1 January 2026, with zero fixed extra payments.

| Loan | Principal | Rate | Method | Payment | Day | First interest | Future interest | Settlement |
| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | --- |
| A / Maybank | RM 100,000.00 | 3.65% | Daily | RM 2,000.00 | 1 | RM 310.00 | RM 8,637.24 | 1 August 2030 |
| B / Public Bank | RM 180,000.00 | 6.00% | Monthly | RM 2,000.00 | 20 | RM 551.61 | RM 59,102.02 | 20 December 2035 |

Independent first-period arithmetic:

- A: RM 100,000 × 0.0365 × 31 / 365 = RM 310.00, first payment 1 February.
- B: RM 180,000 × 0.06 / 12 × 19 / 31 = RM 551.612903…, first payment 20 January (partial first cycle).

Portfolio principal is **RM 280,000.00**; required monthly instalments **RM 4,000.00**; interest **RM 67,739.26**; final payoff **20 December 2035**, the later individual date. The weighted descriptive current rate is **5.160714…%** and is not used for amortization.

## Manual three-loan verification

Add Loan C / CIMB: RM 95,000 at 3.95%, daily Actual/365, RM 1,500/month on day 28, RM 15,000 parked with offset enabled, starting 1 January 2026.

- First interest: (RM 95,000 − RM 15,000) × 0.0395 × 27 / 365 = **RM 233.753424…**.
- Loan C settles **28 September 2031**, with **RM 8,076.71** future interest.
- Portfolio principal: **RM 375,000.00**.
- Required instalments: **RM 5,500.00/month**.
- Flexi money: **RM 15,000.00**, kept in Loan C.
- Effective interest-bearing balance: **RM 360,000.00**, summing each loan's own offset result.
- Portfolio future interest: **RM 75,815.97**, summing full-precision loan totals.
- Final settlement remains **20 December 2035**.

Displayed rounded loan interest can differ from the rounded combined figure by one cent; aggregation uses unrounded values.

## Rollover and target checks

Independent zero-interest check: Loan A owes RM 100, pays RM 100 on 5 January; Loan B owes RM 300, pays RM 100 on the 20th. Without rollover, B finishes **20 March 2026**. With rollover, A's RM 100 becomes available in February and B finishes **20 February 2026**. Combined actual payments are exactly **RM 400**, with no same-month double-spending.

Multiple simultaneous settlements release each normal + fixed-extra payment exactly once. Added allocation budget is not released again. Monthly cash outflow stayed within the original recurring total plus additional budget for all five tested strategies. Variable overrides continue to apply before the allocation is added.

Target check: two RM 1,000 zero-interest loans, each paying RM 100 monthly from 1 February 2026, targeting 1 June 2026 with equal allocation, require **RM 400 total per month**, or **RM 200 additional**. Reducing the computed additional amount by one cent fails to meet the target. The same feasibility check passes with mixed methods, payment dates, offsets and future rate changes.

## Data and scenario verification

- Actual legacy v1 fields, including transactions, variable payments and future rates, migrate without altering the old record.
- Valid backup import/export round trips preserve loan IDs, property associations, original details and financial state.
- Invalid JSON, unsupported schema versions, duplicate IDs, blank names, invalid numeric values and malformed history are rejected before replacement.
- Future/corrupt local schemas are retained, with automatic overwriting blocked.
- Previews never mutate saved data. Applying a preview is explicit. Changing its inputs invalidates the apply action.
- Loan settlement preserves the previous configuration in history, removes its custom allocation and excludes its future totals. Archive and confirmed delete work independently.
- Flexi transfers cannot exceed source funds or spend a same-day parked lump sum that posts after the withdrawal event.
- Rate shocks adjust each loan's starting and scheduled future rates independently.
- Combined balance points equal the sum of per-loan balances at every event date; yearly totals reconcile to individual contributions.
- Unsettled-loan yearly reports include scheduled cash flow through the full projection horizon and do not invent a final payoff or complete future-interest figure.

## Responsive and print checks

Both original and portfolio layouts pass without horizontal page overflow at **320×740, 360×800, 375×812, 390×844, 412×915, 430×932, 844×390, 768×1024, 1024×768 and 1440×1000**. Portfolio loan cards stack on phones, tables scroll within their containers, charts resize and advanced simulators remain collapsible.

Individual CSV/clipboard/print regression checks pass. Portfolio CSV and summary contain calculated totals. JSON import requires confirmation. The portfolio print report contains summary, loan table, timeline, interest breakdown, strategy, individual details and assumptions, with navigation and buttons hidden. The PDF was rendered for visual inspection.

These are Edge/Chromium viewport checks, not physical-device Safari or Firefox testing.

## Performance

A 10-loan mixed daily/monthly comparison over long mortgage terms completed in approximately **118–136 ms** in local engine tests. This is a local measurement, not a guarantee on every device. Strategy comparisons and target solving run in a browser worker; unchanged individual schedules are reused. No artificial loan-count cap is imposed.

## Files created

- `portfolio.css`
- `src/allocationEngine.js`
- `src/portfolioEngine.js`
- `src/strategyEngine.js`
- `src/targetSolver.js`
- `src/storage.js`
- `src/session.js`
- `src/portfolioWorker.js`
- `src/portfolioUI.js`
- `src/portfolioMarkup.js`
- `src/loanUI.js`
- `src/portfolioCharts.js`
- `src/portfolioExport.js`
- `tests/portfolio.test.js`
- `tests/portfolio.browser.spec.js`
- `PORTFOLIO_VERIFICATION.md`

## Files modified

- `src/engine.js`: exposes its existing event ledger as a generator and retains the original `calculate()` interface and formulas.
- `src/app.js`: connects the existing calculator to the selected portfolio loan and handles actual settled status.
- `src/charts.js`: exposes the shared chart renderer and preserves all event points for portfolio step charts.
- `index.html`: portfolio bootstrap, stylesheet and page metadata.
- `scripts/build.mjs`: includes the portfolio stylesheet; all new modules are copied with `src/`.
- `README.md`: portfolio usage, migration, architecture, assumptions and test instructions.

The original engine/storage/browser test files and v1 persistence helpers were preserved.

## Assumptions to verify with each bank

1. Daily Actual/365 divisor, leap-day handling and transaction value dates.
2. Monthly cycle proration, interest posting and whether unpaid interest compounds. This engine carries unpaid interest separately without compounding.
3. Flexi eligibility/caps, whether repayments draw from parked funds, overdraft rates and redraw restrictions. Funds are never silently moved across loans.
4. Fees, insurance, penalties, opening unpaid interest and bank-specific rounding; these are not modeled.
5. All scheduled payments remain monthly. Allocation happens on a calendar-month envelope; released normal + fixed-extra payments roll from the next month, without reusing final-payment surplus within the settlement month.
6. Target budgets retain existing payment commitments and dated events. Custom targets scale the entered proportions. The result is a feasible estimate under this model, not a bank settlement quotation or a recommendation of one strategy.
7. Original-loan fields and bank-specific notes are informational. Bank names do not infer rules. Different start dates are independent snapshots, held constant before their dates in combined reports.

The updated bank/portfolio disclaimer appears in the app and printable report.

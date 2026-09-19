# Flexi Mortgage Portfolio & Payoff Calculator

A mobile-friendly, standalone mortgage portfolio planner for Malaysian ringgit. All calculations and saved data stay in the browser. No backend, runtime framework, external fonts, chart services or analytics are used.

## Multi-loan portfolio

One loan opens in the familiar individual calculator. Use **My Housing Loans** or **Add Housing Loan** to manage loans. With multiple saved loans, the app opens the portfolio dashboard. Every loan has its own name, bank, optional property/reference, original-loan information, notes, calculation settings and dated transactions.

The Dashboard, Loans, Strategies, Timeline, Reports and Settings tabs provide:

- Independent loan cards, sorting, duplication, archive/restore and confirmed deletion.
- Aggregated principal, payments, flexi funds, future interest, payoff dates and cash-flow budget.
- Portfolio and individual balance lines, loan interest/payment breakdowns, and an expandable yearly report.
- Highest-rate-first, lowest-balance-first, equal, proportional and custom additional-payment simulations, with optional rollover.
- An iterative target portfolio budget solver; individual target solvers remain available inside each loan.
- Isolated lump-sum, flexi transfer and rate-shock previews. **Apply Scenario** is required to change saved events or rate assumptions. Editing an input invalidates its old preview.
- Optional property records shared by multiple mortgages.
- Versioned JSON backups with validation and confirmation before import, portfolio CSV, clipboard summary and a printable portfolio report.

Bank names are labels, not rule selectors. Original amount, rate, tenure, start date and instalment are informational only. Free-text bank assumptions are notes; they do not introduce additional financial formulas.

### Portfolio architecture and timing

`src/engine.js` remains the sole mortgage formula implementation. It now exposes its existing event loop as `loanSimulation()`, a resumable stream. `calculate()` runs that same stream with no portfolio additions, preserving prior results. The portfolio coordinator interleaves separate streams by date and supplies only the allocated extra cash. Principal is never combined before calculating interest; the weighted average current rate is for reporting only.

Each loan still has monthly scheduled payments. Daily/monthly selects the interest method, not a new payment frequency. Allocation envelopes are determined once per calendar month for loans with a payment due that month, using their current balance and month-start rate. Additional amounts are paid on the recipient's own scheduled payment day, on top of any existing variable override. Configured normal plus fixed extra payments from settled loans are available for rollover **from the following month**. Unused money from a capped final payment is not spent again within that month. The same additional budget remains available in later months; rollover does not count it twice.

Custom allocation uses the entered total, which may be below the available budget. After a simulated settlement, it distributes that total and any rollover among remaining custom weights; if all remaining weights are zero, it splits equally. The target solver scales custom weights and solves for the additional amount while retaining existing payments and dated events. A strategy may require multiple calendar cycles even when a very large budget is available; impossible targets show an error.

Lump sums follow the selected dated allocation. Priority lump sums fill a loan's debt and spill the remainder to the next loan. Excess over all debt stays unused. Flexi transfers use dated withdrawal/deposit events and cannot transfer unavailable cash, including a parked lump sum that posts later on the same day. Rate shocks shift both the entered starting rate and that loan's future scheduled rates; rates must remain within 0–100%.

Different loan start dates are supported as independent snapshots. For combined charts/yearly reports, each entered principal is held constant before its own start date. Portfolio durations are measured from the earliest calculation start. Unsettled loans keep their scheduled cash flow through their 100-year projection horizon; portfolio payoff and full future interest remain unavailable when any active loan does not settle. Charts show principal, excluding separately carried unpaid interest.

Projected payoff never silently retires a saved loan. Enter actual principal zero or choose Settled to retain the previous configuration in history and exclude that loan from future portfolio totals. Archive also excludes a loan without deleting its data. There is no application limit on loan count, subject to browser storage and memory.

### Storage migration and privacy

The current key is `flexi-mortgage-portfolio-v3`, with `schemaVersion: 3`. Existing v2 portfolios migrate without changing loan settings; their original v2 storage entry remains intact. A prior `flexi-mortgage-v1` record, a `singleLoanState` record, or wrapped legacy state migrates into the first loan named **Home Loan** unless it already has a name. All calculation fields are retained. The legacy record is deliberately left untouched. Invalid/future saved schemas block automatic overwriting and show a recovery warning. Subsequent edits and imports use the v3 key. Each loan retains independent calibration records, profiles, thresholds and profile revisions.

Backups include optional account references and notes. They are downloaded directly from the browser, never uploaded by the app. Import is validated before confirmation and does not replace saved data until the user confirms. Simulations run in a local module worker; unchanged individual schedules are memoized.

### Portfolio verification

**121 tests pass:** the unchanged original 42 engine/storage tests and 15 browser tests, plus 43 portfolio engine/storage tests and 21 portfolio browser tests. See [PORTFOLIO_VERIFICATION.md](./PORTFOLIO_VERIFICATION.md) for the complete completion checklist, manual two-/three-loan checks, mobile sizes, assumptions and file inventory. The earlier single-loan verification remains in [VERIFICATION.md](./VERIFICATION.md).

## Run locally

Requires Node.js 20 or later. No dependency installation is needed to run the app or engine tests.

```sh
npm run dev
```

Open **http://127.0.0.1:5173**. The initial values are labeled as a demo: RM 350,000 principal, 4.15% annual interest, RM 2,000 normal instalment, RM 1,000 extra monthly, no parked flexi money. The start date defaults to the device's current local date. Use **None** for no extra payment, or replace any value. Original loan amount is not required.

## Features

- Actual-date daily reducing balance and monthly reducing balance.
- Separate ledgers for principal, unpaid accrued interest and parked flexi funds.
- Configurable monthly payment day, including days 29–31.
- Fixed extra payments, editable monthly overrides and multiple dated lump sums.
- Flexi deposits, withdrawals, optional overdraft treatment and an interest-offset switch.
- Multiple future interest-rate changes.
- Baseline comparison, adaptive extra-payment scenarios and interactive charts.
- Fixed-budget exploration and a target-date solver using numerical bisection.
- Exact capped final payments, insufficient-payment detection and validation.
- Monthly event schedule, yearly summary, CSV export, clipboard summary and print/PDF layout.
- Versioned localStorage persistence and a confirmed reset to demo values.

Advanced editors start collapsed. Tables scroll within their own containers. On phones, the payoff dashboard appears first; **Edit loan details** takes you directly to the inputs.

## Calculation model and assumptions

### Daily reducing balance

For each interval between dated events:

```text
effective balance = max(0, principal - flexi balance)  [offset enabled]
effective balance = principal                       [offset disabled]
interest = effective balance × (annual percentage / 100) × actual days / 365
```

The engine splits intervals at every payment, flexi movement and rate change. UTC calendar arithmetic avoids daylight-saving drift; the input start date itself is selected using the user's local calendar. A leap day earns another day's interest with the same 365 divisor.

### Monthly reducing balance

An unchanged complete payment cycle earns:

```text
interest = effective balance × (annual percentage / 100) / 12
```

Partial first cycles and dated events within a cycle use the fraction of actual days in that payment cycle. This preserves the ordinary monthly annuity formula for full unchanged cycles while making the treatment of dated changes explicit.

### Payment allocation

1. Accrue interest up to, but excluding, the event date.
2. Apply a payment to accrued interest first.
3. Apply the remainder to principal.
4. Cap payment at principal plus accrued interest; neither ledger can go negative.

Unpaid interest is carried separately and is **not compounded**. A scheduled payment that fails to cover accrued interest is flagged. A plan may still settle if it has a future lump sum or favorable rate change; the engine does not prematurely reject such plans.

### Timing and flexi behavior

- The first regular payment is strictly **after** the start date. Same-day starting lump sums and flexi transactions are allowed.
- Payment days that do not exist in a month use that month's final valid day. A day-31 plan returns to the 31st in the next applicable month.
- Same-day order: rate change, flexi transactions in entry order, parked lump sums, principal lump sums, then regular payment.
- Deposits remain parked until a dated withdrawal. Regular payments use separate funds and do not automatically withdraw from flexi.
- There is no offset cap beyond the zero floor on the effective balance. Flexi money is never automatically applied to close the principal.
- Without overdraft, withdrawals are capped at available flexi funds and a warning is displayed. With overdraft, negative flexi money increases the interest-bearing balance at the loan rate; separate overdraft rates/fees are excluded.
- Variable rows replace both normal and extra payments for the selected month.
- Total payments exclude flexi deposits. The schedule and CSV distinguish movements from payments and show unpaid accrued interest.
- Counts include nonzero monthly and lump-sum payment events. Durations round partial months up. Projection limit: 1,200 regular monthly dates / 100 years.
- No fees, penalties, insurance, taxes, opening unpaid interest, or bank-specific intermediate rounding are modeled. Calculations retain full JavaScript numerical precision; displayed RM amounts have two decimal places.

### Comparisons and target solving

The **normal-payment baseline** retains starting flexi funds, flexi transactions, parked lump sums and rate changes. It excludes principal lump sums, extra monthly payments and variable overrides.

The **extra-payment table**, **budget tool** and **target solver** keep dated events, including principal lump sums, but exclude variable overrides so the proposed monthly amount applies consistently. The table compares interest savings against its own RM 0 extra row. Applying one of these fixed plans clears overrides.

The target solver repeatedly runs the same calculation engine, bisecting the monthly amount until the mortgage settles by the selected date. It rounds the required payment **up** to the next cent. If there is no payment date before the target, a sufficiently large dated lump sum is required.

### Verify these details with your bank

Confirm the day-count divisor, when interest is posted, any compounding of unpaid interest, the outstanding principal and already-accrued interest, payment-value dates, fees, offset limits, whether instalments draw from parked funds, redraw rules and the treatment of advance payments.

General references: [CFPB's explanation of mortgage amortization](https://www.consumerfinance.gov/ask-cfpb/how-does-paying-down-a-mortgage-work-en-1943/) and [Hong Leong Bank's example of a daily flexi-account offset](https://www.hlb.com.my/en/personal-banking/loans/property-loan/mortgage-plus.html). These explain the concepts; this app is not an exact implementation of any specific bank's product.

## Tests

```sh
npm test
```

For browser tests:

```sh
npm ci
npm run test:browser
```

Windows browser tests use installed Microsoft Edge in headless mode. On other systems, run `npx playwright install chromium` first. Playwright starts the local server automatically or reuses one already on port 5173. Browser dependencies are development-only.

The test suites cover formulas, payment allocation, offsets, dated movements, rate changes, leap years, final payments, numerical target solving, payment monotonicity, persistence, all requested phone widths, tablet/desktop layouts, interactions, CSV, clipboard and printing. See [VERIFICATION.md](./VERIFICATION.md) for measured results.

## Deploy

```sh
npm run build
```

This copies deployable static assets into `dist/`. No server is needed in production.

- **GitHub Pages:** publish the contents of `dist/`, or publish this repository's root. Asset URLs are relative so project subpaths work.
- **Vercel:** import the project; `vercel.json` sets the build command and `dist` output directory. No environment variables are required.
- **Any static host:** serve the contents of `dist/` over HTTPS.

Use a local HTTP server instead of opening `index.html` directly with `file://`, because browsers restrict ES module loading from local files. Clipboard access requires HTTPS or localhost. Browser storage can be unavailable in restricted/private modes; the app shows a status message if saving fails.

## Files

| File | Responsibility |
| --- | --- |
| `index.html` | Accessible app structure and editable controls |
| `styles.css` | Responsive layouts, tables, charts and print styles |
| `favicon.svg` | Local brand icon |
| `src/engine.js` | Input validation, event simulation and yearly totals |
| `src/dates.js` | Date parsing, month clamping and duration calculations |
| `src/flexi.js` | Interest-bearing balance and flexi ledger movements |
| `src/scenarios.js` | Baseline, scenario ladder and target-date solver |
| `src/app.js` | UI rendering, state changes and interactions |
| `src/charts.js` | Responsive, accessible SVG charts |
| `src/format.js` | Currency, date and duration presentation |
| `src/persistence.js` | Defaults and versioned local browser storage |
| `src/export.js` | Plain-language summary, CSV generation and download |
| `tests/engine.test.js` | Financial engine regression and formula tests |
| `tests/persistence.test.js` | Storage restoration and failure handling |
| `tests/app.browser.spec.js` | Responsive and functional browser tests |
| `scripts/serve.mjs` | Local static development server |
| `scripts/build.mjs` | Static distribution build |
| `scripts/inspect-browser.mjs` | Optional desktop/mobile screenshot capture using Edge |
| `playwright.config.js` | Browser test setup |
| `package.json`, `package-lock.json` | Scripts and locked development dependencies |
| `vercel.json` | Static deployment configuration |
| `.gitignore` | Excludes generated artifacts and local QA dependencies |

All files were created in an initially empty project. Generated screenshots, browser reports, and print verification output are kept under ignored `artifacts/` and `test-results/`; they are excluded from the production build.


## Bank Statement Calibration

Open **Calibration** in portfolio navigation, or **Calibrate Against Bank Statement** on a loan. Enter inclusive statement dates, actual opening/closing principal, interest, payment and annual rate. Basic Mode accepts summary amounts; Advanced Mode adds exact dated payments, lump sums, flexi movements, interest postings, fees, signed adjustments and historical rates. Dated rows replace their matching summary category. The interface warns about missing dates, mismatched totals and unexplained balance changes.

Run Comparison previews the current statement. Save Statement retains it locally, with tested assumptions, results, warnings and timestamps. Lock Statement saves current edits and protects the record; Unlock preserves it. Select saved periods to compare their mean absolute, maximum absolute and mean absolute percentage interest differences. Compare Assumptions ranks 24 configurations by mean absolute difference and labels the closest tested match without claiming to identify a bank formula.

Save Profile appends a timestamped revision. Duplicate and Revert create further revisions. Select an older profile to revert to its assumptions. Use for Comparison does not alter loan settings. **Apply Profile** names the mortgage and assumptions in a confirmation dialog, preserves previous settings in loan history, then updates future calculations. Ordinary loan method and offset controls continue to work after application.

### Exact calibration conventions

- Dates include both the first and last statement day. The engine receives an exclusive boundary on the next day.
- Actual/365 and fixed 365 are equivalent constant divisors, as are Actual/366 and fixed 366. They are not Actual/Actual; leap days count normally. Equivalent fixed choices are omitted from the comparison grid.
- Monthly / 12 uses actual-day proration within the loan's payment-day cycle, including rate and balance changes. Monthly traces show real cycle segments, not artificial daily-interest values.
- Beginning-of-day movements affect that day's interest. End-of-day movements affect the following day. Rate changes always apply at the start of their effective date. Payments cover accrued interest first, then principal.
- Daily offsets follow dated movements; monthly offsets use the calendar-month opening snapshot. Both have a zero effective-balance floor. Capped is an explicit alias for that existing cap. Ignored disables offsets.
- Interest posting is an independent reporting ledger: daily, calendar-month end, statement end, or explicit statement posting dates. It does not capitalize unpaid interest; changing posting frequency alone does not change interest. No bank-specific rounding or compounding is inferred.
- Fees and signed adjustments affect reconciliation only. They neither become interest nor earn interest. The engine closing principal excludes unpaid interest and fees. The separately displayed account balance includes them. The reconciliation uses opening + actual interest + fees/adjustments ? total payments, and flags any residual against the actual closing figure; a bank principal-only closing figure may exclude some components.
- Match thresholds use amount OR relative difference. They are configurable display indicators. Undefined percentages for nonzero predictions against zero actual interest are omitted from the percentage mean, with the count disclosed.

CSV import uses the downloadable template and validates all rows before a preview. An invalid row prevents the whole import. CSV adds statements; calibration JSON restores records/profiles for matching loan IDs, including locked records, only after a replacement preview. Exports include statement data, results, assumptions, warnings, reconciliation and notes. Full portfolio JSON backups also retain calibration data. Copy and print reports are generated from the current comparison.

Everything runs locally: no statement upload, OCR, analytics or new network dependency. Export files contain personal financial data and remain under your control. See [CALIBRATION_VERIFICATION.md](CALIBRATION_VERIFICATION.md) for recovery evidence, tests and deterministic examples.
# Fixed Monthly Mortgage Commitment

Open **Strategies → Fixed Monthly Mortgage Commitment**, select a start month and either the current scheduled total or a custom monthly budget, then choose **Run Fixed Commitment Scenario**. This is a simulation; it never applies payments to the saved loans.

The coordinator reserves each active loan's required payment and distributes the remaining monthly budget using highest rate, lowest balance, earliest existing payoff, largest balance, equal split, proportional balance, custom priority, or custom percentages. Loans keep their own payment dates, interest methods, rate histories, flexi ledgers, and calibrated assumptions. The original mortgage ledger calculates every interest and payoff amount.

Recurring extras are included by default and preserved when the budget can afford them. Turn inclusion off to pay existing extras in addition to the fixed budget. Dated lump sums remain separate; parked flexi cash is never counted as recurring payment money. Temporary monthly overrides remain explicit exceptions. A budget below scheduled required instalments is rejected with the required amount, selected amount, and shortfall.

Following-calendar-month rollover is the default, preserving the existing convention. A partial payoff can leave some budget unspent in a settlement month; next month's allocation still uses the configured target. The optional next-eligible-payment-date setting redistributes only unused cash to strictly later scheduled payments. It never spends an already-paid allocation twice or invents an extra payment date. Final payments are capped by the original loan ledger.

Results include portfolio and individual payoff comparisons, interest and time differences, recurring-payment and balance charts, a rollover timeline, expandable yearly groups of monthly allocations, and allocation CSV export. Time differences compare payoff calendar months. Save multiple named configurations and select them for a factual comparison. Saving locks the resolved monthly commitment and stores configuration in the optional `portfolio.fixedCommitmentScenarios` field; existing schema version 3, loans, calibration records, and migrations are retained. Loading or comparing a saved configuration recalculates it against current loan records.

Run `node scripts/verify-fixed-commitment.mjs` to reproduce the RM8,000 cascading example and independently replay a second mixed-interest example. See [FIXED_COMMITMENT_VERIFICATION.md](FIXED_COMMITMENT_VERIFICATION.md) for the completion checklist, test counts, exact examples, and changed files.

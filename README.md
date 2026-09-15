# Flexi Home Mortgage Payoff Calculator

A mobile-friendly, standalone mortgage planner for Malaysian ringgit. All calculations and saved data stay in the browser. No backend, runtime framework, external fonts, chart services or analytics are used.

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

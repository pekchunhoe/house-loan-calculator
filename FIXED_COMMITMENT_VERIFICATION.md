# FIXED MONTHLY COMMITMENT / PAYMENT ROLLOVER UPDATE

The fixed commitment simulator is available at the top of the existing Strategies page. It coordinates the original independent loan simulations and saves scenario configuration only.

## Completion checks

| Check | Result |
| --- | --- |
| Existing mortgage engine preserved | PASS — original interest, flexi, ledger and payoff formulas retained |
| Existing portfolio calculations preserved | PASS — original aggregation and strategy engines retained |
| Calibration mode preserved | PASS — historical records, locked results, profiles and assumptions remain unchanged |
| User-selected start month | PASS — every earlier event matches the original simulation |
| Fixed commitment | PASS — monthly envelope stays fixed; actual payments respect documented exceptions |
| Required payments protected | PASS — insufficient budgets reject with required, selected and shortfall amounts |
| Automatic released-payment rollover | PASS |
| Cascading rollover | PASS — release includes previous recurring allocations |
| Following-month rollover | PASS — preserves existing convention |
| Next-payment-date option | PASS — unused cash only, strictly later scheduled dates |
| Highest-rate allocation | PASS |
| Lowest-balance allocation | PASS |
| Earliest existing payoff allocation | PASS |
| Largest balance allocation | PASS |
| Equal allocation | PASS |
| Proportional allocation | PASS |
| Custom priority | PASS |
| Custom percentages | PASS — validation and renormalization after settlement |
| Rate-change priority update | PASS — month-start rates; transfers use effective transfer-date rates |
| Final loan gets full commitment | PASS |
| Final payment capped | PASS — no negative principal |
| Different payment dates | PASS |
| Flexi compatibility | PASS — offsets, deposits, withdrawals and non-offset loans |
| Mixed daily/monthly loans | PASS — includes calibrated end-of-day month-boundary payments |
| Lump-sum compatibility | PASS — outside recurring budget |
| Existing recurring extras included/excluded | PASS |
| Scenario save/reload | PASS — configuration only; backup round-trip retained |
| Scenario comparison | PASS — baseline and selected scenarios, no rankings |
| Portfolio payoff recalculated | PASS |
| Future interest recalculated | PASS — reconciles across independently replayed loans |
| Existing tests | PASS — all 186 retained tests |
| New tests | PASS — 42 unit and 14 browser tests |
| Phone portrait | PASS — 320, 360, 375, 390, 412 and 430 px |
| Phone landscape | PASS — 844 × 390 |
| Tablet | PASS — 768 × 1024 and 1024 × 768 |
| Desktop | PASS — 1440 × 1000 |
| Production build | PASS — static build and worker-driven scenario from dist/index.html |

## Before vs After Example

This intentionally uses zero interest for an independently checkable arithmetic proof. Start: January 2026. Payment dates: fifth of each month. Current recurring payments: A RM2,000; B RM1,500; C RM2,500; D RM2,000. Starting balances: A RM8,000; B RM3,000; C RM25,000; D RM24,000. Fixed commitment: RM8,000/month. Custom priority: C, A, D, B. Following-month rollover.

| Month | Loan A | Loan B | Loan C | Loan D | Actual total |
| --- | ---: | ---: | ---: | ---: | ---: |
| Jan 2026 | 2,000 | 1,500 | 2,500 | 2,000 | 8,000 |
| Feb 2026 | 2,000 | 1,500 | 2,500 | 2,000 | 8,000 |
| Mar 2026 | 2,000 | 0 | 4,000 | 2,000 | 8,000 |
| Apr 2026 | 2,000 | 0 | 4,000 | 2,000 | 8,000 |
| May 2026 | 0 | 0 | 6,000 | 2,000 | 8,000 |
| Jun 2026 | 0 | 0 | 6,000 | 2,000 | 8,000 |
| Jul 2026 | 0 | 0 | 0 | 8,000 | 8,000 |
| Aug 2026 | 0 | 0 | 0 | 4,000 | 4,000 |

All figures in RM. Loan B settles on 5 February, releasing RM1,500/month to C from March. Loan A settles on 5 April, releasing RM2,000/month to C from May. Loan C settles on 5 June and releases its full RM6,000/month allocation to D from July. Loan D receives the full RM8,000 in July and a capped RM4,000 in August.

Current portfolio payoff: **5 December 2026**. Fixed commitment payoff: **5 August 2026**, four calendar months earlier. Principal repaid: **RM60,000** under both strategies. Future interest: **RM0** under both. Seven full RM8,000 payments plus RM4,000 exactly repay the portfolio.

The second reproducible example multiplies these balances by ten, uses rates of 4.0%, 4.2%, 4.4% and 4.6%, alternating daily/monthly methods and payment days 1, 5, 15 and 28, with highest-rate allocation:

| Metric | Current strategy | Fixed commitment |
| --- | --- | --- |
| Portfolio payoff | 28 May 2039 | 15 May 2033 |
| Future interest | RM150,176.75 | RM103,227.73 |
| Interest difference | | RM46,949.02 less |
| Calendar-month difference | | 6 years earlier |
| Final recurring payment | | RM595.79 |

Each allocated schedule is replayed through the original `calculate()` function independently. The verification script asserts exact equality of every returned loan result and reconciles total payments to starting principal plus future interest. It contains no replacement interest formula.

## Test Counts

Baseline verified: **133 unit + 53 browser = 186 passing tests**. All original test files are preserved.

| Test group | Existing passed | New passed | Total passed |
| --- | ---: | ---: | ---: |
| Unit | 133 | 42 | 175 |
| Browser | 53 | 14 | 67 |
| Total | **186** | **56** | **242** |

Final full runs completed with zero failures. Production build, deterministic replay script, and `git diff --check` also passed. Original regression coverage includes single-loan payoff, daily/monthly interest, flexi, dashboard, strategies, target solver, calibration, statement import/export, schema migration, saved data, print, and export.

New unit coverage includes every allocation rule, constant budget, start dates, pre-start event identity, cascading releases, final cap, both timing options, same-date exclusions, preventing double spending after a later lump sum, multiple same-month settlements, date/rate differences, one-off overrides, extras inclusion/exclusion, flexi, mixed methods, calibrated dates, immutable history, storage validation, save/reload, comparison, and independent payoff/interest reconciliation.

The 14 new browser tests cover ten viewport sizes, custom controls, charts, timeline/results, insufficient-budget recovery, stale-result invalidation, scenario save/load/delete/comparison, CSV export, storage isolation, and the production build. Runtime and console errors are asserted absent. Screenshots are generated under `artifacts/fixed-commitment/`; mobile and desktop screenshots were visually inspected. The Browser skill runtime reported no available browser; browser verification used the project's existing Playwright/Edge test setup.

Commands:

```text
npm test
npm run test:browser
npm run build
node scripts/verify-fixed-commitment.mjs
git diff --check
```

## Conventions and limits

- A fixed monthly budget is an envelope. Actual spending can be lower in a partial settlement month under the preserved following-month convention; unused cash does not accumulate as an additional future budget. The final payoff is capped. Temporary monthly overrides and payment-date effects remain explicit exceptions.
- Next-payment-date rollover transfers only unused current-month allocation to later scheduled dates, including repeated transfers if another recipient settles. A full payment already spent becomes available again only in the next month's budget. Same-day payments are not treated as later dates.
- Included regular extras are retained where affordable. When a custom commitment covers required instalments but cannot cover all prior extras, the discretionary remainder follows the selected allocation strategy. Excluded extras are additional outflow; their own configured amount stops when that loan settles.
- Lump sums are separate and parked flexi funds are never treated as mortgage instalments. The existing engine owns all dated events and interest accrual. No new unscheduled daily payoff behavior is introduced.
- Required instalments are checked each allocation month, including future loan starts and explicit monthly overrides. An inadequate later budget invalidates the scenario rather than displaying a partial result as a successful payoff.
- Current commitment uses regular scheduled payments for loans active at the selected month, excluding loans projected to settle earlier. Saving locks the resolved amount. Saved scenarios recalculate against current loans.
- Time differences compare payoff calendar months. Remaining duration uses the existing rounded-up duration convention. Full future interest is measured from entered loan snapshots, including unchanged months before the strategy begins; differences isolate the scenario's effect.
- The original 100-year projection horizon remains. An unsettled loan produces no fabricated final payoff or full-lifetime interest total.

## Files Created

- `src/fixedCommitmentModel.js` — options, allocation labels, saved configuration validation.
- `src/fixedCommitmentEngine.js` — independent loan-event coordination, allocation, reporting, comparison.
- `src/fixedCommitmentUI.js` — scenario configuration, results, charts, timeline, allocation table, saves and CSV.
- `tests/fixedCommitment.test.js` — 42 new unit tests.
- `tests/fixedCommitment.browser.spec.js` — 14 new browser tests.
- `scripts/verify-fixed-commitment.mjs` — executable deterministic and independent-replay proofs.
- `FIXED_COMMITMENT_VERIFICATION.md` — this completion report.

## Files Modified

- `src/engine.js` — backward-compatible optional discretionary-extra override and cumulative recurring-payment snapshot. Existing numeric additional-payment API and all interest/flexi/payment-cap formulas remain intact.
- `src/storage.js` — validate the optional separate scenario collection without changing schema version or legacy migrations.
- `src/portfolioWorker.js` — fixed scenario and comparison handlers.
- `src/portfolioUI.js` — mount the feature and refresh its controls.
- `portfolio.css` — responsive scenario styling.
- `README.md` — feature usage and conventions.

The existing portfolio, allocation, target, calibration, single-loan, export and migration implementations were retained. Generated `dist`, screenshots and test output remain in their existing ignored directories.

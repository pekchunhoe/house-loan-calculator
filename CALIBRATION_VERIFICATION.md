# BANK STATEMENT CALIBRATION MODE — CONTINUATION COMPLETE

Verified on 19 September 2026 in the existing repository. No project regeneration, rollback, or replacement of the interrupted modules was performed.

## Repository recovery

Before editing, `git status` showed modified `src/engine.js` and `src/storage.js`, plus four untracked files: `calibrationEngine.js`, `calibrationModel.js`, `calibrationStore.js`, and `calibrationExport.js` under `src/`. These files, their interfaces, existing application integration points and test suites were inspected.

- Already completed: opt-in dated-payment/day-count simulation foundations, inclusive historical wrapper, statement validation, assumption ranking, schema v3 migration retaining old storage, and initial profile/statement/import/export functions.
- Partially completed: missing-date detection, reconciliation warnings, statement timestamps, posting behavior, monthly traces, and export/report fields.
- Not implemented: calibration navigation, loan entry points, basic/advanced forms, transaction editors, results/dashboard, import previews, profile controls, responsive styling and calibration tests.

Before further implementation, all 85 original unit tests and all 36 original browser cases reported passing. The first browser runner remained in Windows server teardown after its last passing case. A later complete run exited successfully and verified those same 36 cases along with the new workflow tests.

## Completion checklist

| Requirement | Result |
| --- | --- |
| Repository state recovered | PASS |
| Existing interrupted work preserved | PASS |
| Historical simulation | PASS |
| Schema v3 migration | PASS |
| Calibration tab | PASS |
| Per-loan calibration | PASS |
| Basic workflow | PASS |
| Advanced workflow | PASS |
| Multiple statement periods | PASS |
| Actual vs predicted interest | PASS |
| Closing-balance comparison | PASS |
| Balance reconciliation | PASS |
| Missing-date warning | PASS |
| Transaction mismatch warning | PASS |
| Unexplained residual warning | PASS |
| Actual/365 | PASS |
| Actual/366 | PASS |
| Actual/360 | PASS |
| Monthly method | PASS |
| Beginning/end-of-day timing | PASS |
| Flexi calibration | PASS |
| Rate-change calibration | PASS |
| Assumption comparison | PASS |
| Closest-tested-match handling | PASS |
| Multi-period metrics | PASS |
| Daily trace | PASS |
| Calibration profiles | PASS |
| Profile history | PASS |
| Explicit profile application | PASS |
| Statement locking | PASS |
| CSV import | PASS |
| CSV export | PASS |
| JSON export/import | PASS |
| Copy summary | PASS |
| Print report | PASS |
| Privacy/local-only storage | PASS |
| Existing regression tests | PASS |
| New calibration tests | PASS |
| Phone portrait | PASS |
| Phone landscape | PASS |
| Tablet | PASS |
| Desktop | PASS |
| Production build | PASS |

## Test counts and commands

| Tests | Existing | New | Total passed |
| --- | ---: | ---: | ---: |
| Node unit tests | 85 | 48 | 133 |
| Edge/Playwright browser tests | 36 | 17 | 53 |
| Total | 121 | 65 | 186 |

- `npm test`: 133 passed, zero failures.
- `npx playwright test`: 51 passed, zero failures; all original browser cases and the first 15 calibration browser tests.
- `npx playwright test tests/calibration.browser.spec.js --grep 'advanced transaction|production build'`: two additional tests passed, zero failures. These were added after the full run to check every advanced transaction type, historical rate persistence, threshold edits, and `/dist/index.html` with no missing resources.
- `npm run build`: successful static production output including the new stylesheet and modules.
- Syntax checks for the edited application UI and calibration UI succeeded; `git diff --check` found no whitespace errors.

The retained engine regressions cover the standard mortgage, daily interest, flexi, single-loan payoff, independent portfolio totals, strategy allocations, rollover and target-date solving. Original storage and browser import/restore tests passed alongside the new v2/v3 and legacy migration tests.

Browser workflow tests use 320×740, 360×800, 375×812, 390×844, 412×915, 430×932, 844×390, 768×1024, 1024×768 and 1440×1000. They check page-level overflow, phone input font sizes, comparison results, internal transaction scrolling, browser errors and requests leaving localhost. Additional tests exercise modal cancellation via Escape, explicit profile application, statement lock/unlock, reload persistence, copy/downloads, atomic import validation and replacement previews. Print media hides the application and shows the report; a 71 KB PDF was generated. Mobile and print screenshots were visually inspected.

The in-app browser runtime reported no available browser. Verification therefore used the repository's installed Playwright/Edge configuration. Other browser engines, screen-reader output and a physical printer were not tested.

Generated, ignored evidence is under `artifacts/calibration/`, including viewport screenshots, `print.png` and `report.pdf`. No bank statement data was uploaded; all test data was synthetic.

## Files created in this continuation

- `src/calibrationUI.js`
- `calibration.css`
- `tests/calibration.test.js`
- `tests/calibration.browser.spec.js`
- `CALIBRATION_VERIFICATION.md`

## Files modified in this continuation

- Existing interrupted files: `src/calibrationEngine.js`, `src/calibrationModel.js`, `src/calibrationStore.js`, `src/calibrationExport.js`, `src/engine.js`.
- Application integration: `src/app.js`, `src/portfolioUI.js`, `src/portfolioMarkup.js`, `index.html`, `scripts/build.mjs`.
- Documentation: `README.md`.

`src/storage.js` was already modified when this continuation began; its v3 implementation was reused unchanged and verified. The four interrupted calibration modules remain untracked relative to Git's HEAD, but were present before this continuation and were extended in place.

## Existing work reused

Calibration continues to call `calculate()` in the existing mortgage engine. The event ledger, payment allocation, date arithmetic, flexi behavior and portfolio orchestration were retained. Daily and monthly traces originate in that same engine. The existing calibration wrapper, assumption validator, period metrics, profile helpers and CSV parser were extended rather than replaced. The original schema-v3 migration, old-key preservation, session persistence, download helper and portfolio navigation architecture were reused.

## Deterministic verification examples

1. **Daily interest:** RM100,000 at 3.65%, 1–31 August 2026 inclusive, no payments or offset: `100000 × 0.0365 × 31 / 365 = RM310.00`. Actual interest RM310 gives zero difference. An end-of-day RM1,310 payment on 31 August leaves principal RM99,000 and zero reconciliation residual.
2. **Flexi:** same principal/rate/period, beginning-of-day deposit RM10,000 on 16 August: first 15 days RM150, next 16 days RM144, total **RM294.00**. A RM5,000 withdrawal on 26 August adds RM3 over six days, giving **RM297.00**. Moving the original deposit to end-of-day instead gives RM295.00.
3. **Multiple periods:** independent August and September statements, each opening RM100,000 at 3.65%, predict RM310 and RM300. Actual figures RM312 and RM297 produce differences −RM2 and +RM3: **2 periods**, mean absolute difference **RM2.50**, maximum absolute difference **RM3.00**, mean absolute percentage difference **0.82556%**. A separate monthly-mode January–February test at 6% yields RM500 per complete cycle, RM1,000 total.
4. **Balance reconciliation:** opening RM100,000 + actual interest RM310 + maintenance fee RM10 − payments RM0 = closing account balance **RM100,320**, residual **RM0** against that entered closing amount. Predicted interest remains RM310; the fee does not become interest. The engine principal remains RM100,000, displayed separately from the account balance. If the bank's field excludes accrued interest/fees, the resulting residual is shown rather than adjusted away.

## Interpretation and remaining bank-specific unknowns

Statement dates are inclusive. Actual/365 and fixed 365 are equivalent here; Actual/366 and fixed 366 are equivalent constant divisors, not Actual/Actual. Monthly mode prorates within the loan payment-day cycle. Dated rates apply at beginning of day; payment/flexi timing can be beginning or end of day. Monthly flexi uses the calendar-month opening snapshot. Effective balance never falls below zero.

Posting is a separate reporting ledger without capitalization or compounding. Different posting dates can change the posting breakdown while leaving total interest unchanged. Fees and adjustments affect reconciliation only and do not accrue interest. A principal-only statement balance can differ from the reconciliation account balance. These conventions are visible in the application, copy summary and print report.

The closest tested result does not prove the bank's formula. Statement data alone cannot establish hidden posting cut-offs, undisclosed rounding, same-day internal ordering, bank-specific fee capitalization, restricted flexi-offset caps, redraw rules, opening unpaid-interest ledgers, or whether a bank's closing field includes all accrued charges. No OCR, bank API integration or unsupported inference was added.

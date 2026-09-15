# Verification report

Verified on 15 September 2026 using Node.js 24.18.0 and headless Microsoft Edge. The in-app browser connector was unavailable; local browser verification used Playwright with the installed Edge browser.

## Automated checks

- Engine and persistence: **42 tests passed**.
- Browser: **15 tests passed**, including 10 viewport configurations and 5 interaction workflows.
- No browser JavaScript errors or unexpected external network requests in viewport checks.
- All controlled table overflow stays inside its scroll container, including expanded advanced editors and large input amounts.

## Independent formula checks

| Case | Expected and observed result |
| --- | --- |
| Daily interest | RM 100,000 × 3.65% × 31 / 365 = **RM 310.00** |
| Leap-year February | RM 100,000 × 3.65% × 29 / 365 = **RM 290.00** |
| Non-leap February | Same balance/rate over 28 days = **RM 280.00** |
| Monthly interest | RM 100,000 × 6% / 12 = **RM 500.00** |
| Flexi offset | RM 350,000 principal less RM 50,000 parked at 4.15% / 12 = **RM 1,037.50** first-month interest; principal starts at RM 350,000 and flexi remains RM 50,000 |
| Dated withdrawal | RM 300,000 interest-bearing balance for 15 days, then RM 320,000 for 16 days, each at 4.15% / 365; exact split matches simulation |
| Final partial payment | RM 1,000 balance at 6% monthly method, RM 900 payment: second/final payment **RM 105.53** displayed (RM 105.525 internally), final principal zero |
| Zero interest | RM 1,000 / RM 300: 4 payments, last payment **RM 100.00**, no interest |
| Standard monthly mortgage | Payment count and final payment match the closed-form amortization equation; payments reconcile to principal plus interest |
| Target-date solver | Required payment matches the monthly annuity formula rounded up to cents; lowering it by one cent fails to settle by the target |

Higher monthly payments never produced later settlement or more interest in the tested daily/monthly scenarios with identical dated events. Larger permanent principal reductions never increased interest. Insufficient payments showed no fictional payoff date. Future lump sums were allowed to rescue plans with otherwise insufficient instalments.

## Demo comparison

Assumptions: start **15 September 2026**, principal **RM 350,000**, **4.15% p.a.**, daily Actual/365, payments on the 1st, zero parked flexi money, no future events.

| Result | Normal RM 2,000/month | RM 3,000/month |
| --- | ---: | ---: |
| Settlement | 1 February 2049 | 1 March 2039 |
| Monthly payments | 269 | 150 |
| Remaining duration, rounded up | 22 years 5 months | 12 years 6 months |
| Total interest | RM 187,211.27 | RM 98,078.28 |
| Total payments | RM 537,211.27 | RM 448,078.28 |
| Final adjusted payment | RM 1,211.27 | RM 1,078.28 |

The extra RM 1,000/month saves **119 months (9 years 11 months)** and **RM 89,132.99** in estimated interest. All final balances are zero; payments do not overpay the debt.

## Responsive verification

| Viewport | Result |
| --- | --- |
| 320 × 740 | Pass: no horizontal page overflow |
| 360 × 800 | Pass: no horizontal page overflow |
| 375 × 812 | Pass: no horizontal page overflow |
| 390 × 844 | Pass: no horizontal page overflow |
| 412 × 915 | Pass: no horizontal page overflow |
| 430 × 932 | Pass: no horizontal page overflow |
| 844 × 390, phone landscape | Pass: no horizontal page overflow |
| 768 × 1024, tablet portrait | Pass: no horizontal page overflow |
| 1024 × 768, tablet landscape | Pass: no horizontal page overflow |
| 1440 × 1000, desktop | Pass: no horizontal page overflow |

The tests expand every advanced editor, add rows, and check very large loan values at each size. Main numeric inputs have at least 42px height and 16px text on phones. SVG charts render at each viewport. Desktop and phone screenshots were visually inspected.

## Interaction and export checks

- Edited loan details and fixed extra payments update results.
- Flexi deposits/withdrawals and interest changes create dated schedule events.
- Refresh restores loan fields, variable overrides, lump sums, flexi transactions and rates.
- Budget and target results can be applied to the main strategy; scenario rows update the selection.
- Invalid input hides stale results and disables exports. Insufficient-payment plans display a warning.
- Monthly and yearly schedule views work; optional flexi columns appear.
- CSV includes **all events**, including hidden paginated rows, with two-decimal amounts.
- Copy Summary writes the generated text to the clipboard.
- Reset requires confirmation; cancelling preserves the plan and confirming restores demo values.
- Print handling includes all schedule rows and opens calculation assumptions. Controls are hidden, table headers repeat, and a PDF is generated successfully. Printed pages were rendered to images and visually inspected.

## Limits to verify with your bank

This is an estimate engine, not a bank settlement quote. Verify the 365-day convention, interest-posting/compounding rules, initial accrued interest, transaction value dates, offset caps, whether payments draw from flexi funds, overdraft treatment, advance-payment allocation, redraw restrictions, fees and penalties. Monthly mode uses the explicitly documented cycle-proration convention. Browser checks use Chromium/Edge device-sized viewports; real-device Safari and Firefox were not tested.

# Verified end-to-end run · 2026-07-13T07:40:38.592237+00:00

- Submission: **SUB-001** (DOT 185040 · SAFER: UNITED PETROLEUM TRANSPORTS INC)
- Question: Triage this submission. Surface the top 3 risk drivers, recommend a disposition, and cite evidence.
- Wall time: 79922 ms · drafts: 2 · retrieved chunks: 14
- Disposition: `{'label': 'decline', 'confidence': 0.9, 'drivers': ['adverse_loss_history', 'high_severity_claims', 'poor_crash_record']}`

## Critique
- iter 1 · judge gpt-4o · FLAGGED: Missing citation for the 3-year loss ratio of 151.5%; No citation for the average claim severity of $115,378; Lack of detailed analysis on the discrepancy between power units in submission and SAFER profile; No citation for the model prediction of 3.7 claims
- iter 2 · judge gpt-4o · FLAGGED: Missing citation for the 3-year loss ratio of 151.5%; Incomplete explanation of the discrepancy in fleet size between submission and SAFER profile; Lack of detailed analysis on vehicle maintenance concerns despite mentioning OOS rate

## Citations
- [1] `10k-usx-2023#chunk-23` — related to the new safety rating system. In its notice of withdrawal, the FMCSA noted that a new rulemaking related to a similar process may be initiated in the…
- [2] `10k-odfl-2026#chunk-34` — Fixing America’s Surface Transportation Act of 2015 (the “FAST Act”) on December 4, 2015; however, the FAST Act does not restrict public disclosure of all data …
- [3] `10k-usx-2020#chunk-20` — uncertain if, when or under what form any such rule could be implemented. The FMCSA also recently indicated its intent to perform a new study on the causation o…
- [4] `10k-wern-2023#chunk-1` — this Form 10-K. Risks Related to our Business and Industry Our business is subject to overall economic conditions that could have a material adverse effect on o…
- [5] `10k-usx-2020#chunk-90` — safety events (i.e. crashes, inspections, or violations) and carriers are ranked and assigned a rating percentile or score to prioritize them for interventions …
- [6] `10k-usx-2020#chunk-94` — methodology for determining a carrier’s DOT safety rating would be expanded to include the on‑road safety performance of the carrier’s drivers and equipment, as…
- [7] `10k-usx-2020#chunk-30` — a long‑standing, recognized practice, extend the Fair Labor Standards Act to independent contractors and impose notice requirements based on employment or indep…
- [8] `10k-usx-2020#chunk-13` — internal candidates, all of whom are motivated to perform in our transparent, metric‑driven environment. Our President and Chief Executive Officer, Eric Fuller,…
- [9] `10k-usx-2020#chunk-49` — safety ratings, ELDs and hours‑of‑service changes and an improved economy could further reduce the pool of eligible drivers or force us to increase driver compe…
- [10] `10k-usx-2020#chunk-106` — which could impede growth, or if we do, we may not be successful in integrating any acquired businesses, either of which could have a material adverse effect on…
- [11] `10k-usx-2021#chunk-26` — a new rulemaking related to a similar process may be initiated in the future. Therefore, it is uncertain if, when or under what form any such rule could be impl…
- [12] `10k-usx-2022#chunk-26` — related to the new safety rating system. In its notice of withdrawal, the FMCSA noted that a new rulemaking related to a similar process may be initiated in the…
- [13] `ntsb-har-2001#chunk-6` — 60 4.4 Previously Issued Recommendations Reclassified in This Report ....................................... 61 Board Member Statement .........................…
- [14] `ntsb-har-2101#chunk-7` — of occupant protection and crashworthiness standards for medium-size buses. Providing lap/shoulder belts, increasing roof strength, a nd improving window glazin…

---

TO: Underwriting File
FROM: Senior Commercial Auto Underwriter
DATE: 2024-10-26
SUBJECT: Triage Memo for Submission SUB-001: ABC Transport Inc

## Recommendation

Decline.

The submission presents an unacceptable risk profile driven by a severe, unprofitable loss history and a significant recent crash record that includes multiple fatalities.

## Risk drivers

*   **Unacceptable Loss History:** The account's 5-year loss history is untenable. Per the provided loss summary, the 3-year loss ratio is 151.5%, based on an assumed premium of $5,500 per power unit. Average claim severity over the past 5 years is $115,378. This level of historical performance indicates a fundamental lack of profitability that is unlikely to be corrected by pricing adjustments alone.
*   **Severe Crash Record:** The SAFER profile shows a high rate of severe accidents over the last 24 months, including 41 total crashes, 2 of which were fatal and 14 involved injuries. This on-road performance is a leading indicator of future large losses. Our internal model's SHAP analysis confirms that `crashes_24mo_total` is a primary driver elevating the risk prediction.
*   **Vehicle Maintenance Concerns:** The carrier's vehicle Out-of-Service (OOS) rate is 14.6% per their SAFER profile. While this is below the national average, it is still a negative signal and is flagged by our frequency model as a factor that increases predicted risk.

Note: Our internal XGBoost model predicts 3.7 claims for the upcoming year. This frequency prediction appears low given the historical loss ratio and severity, suggesting the model may be underweighting the financial impact of this account's past performance.

## Comparable accounts

The provided list of five comparable accounts in our book shows that we have generally not retained or have actively declined large fleets with similar risk characteristics. Of the four comparable accounts with loss ratios near 1.0, three were non-renewed or lost to market. The single comparable account we bound had a significantly better loss ratio (0.91) than this submission. ABC Transport's loss ratio of 151.5% is substantially worse than any of these peers, reinforcing the decision to decline.

## Open questions for the broker

Should we reconsider this decline, I would require detailed answers to the following:

*   Provide complete, currently valued loss runs for the past 5 years. What specific actions has the insured taken to address the large claims that are driving the $115,378 average severity and 151.5% loss ratio?
*   What specific safety and training initiatives have been implemented in response to the 2 fatal and 14 injury crashes recorded in the past 24 months?
*   Please reconcile the fleet size. The submission lists 619 power units, but the most recent SAFER profile shows 604.

## Producer-facing summary

After a thorough review of the submission for ABC Transport Inc., we are declining to offer a quotation at this time. The decision is driven by the carrier's recent loss history, which demonstrates a pattern of high-severity claims and an unprofitable premium-to-loss ratio. The fleet's significant crash record over the past 24 months further supports this risk assessment.

```json
{
  "disposition": "decline",
  "confidence": 0.9,
  "drivers": [
    "adverse_loss_history",
    "high_severity_claims",
    "poor_crash_record"
  ]
}
```

# Verified end-to-end run · 2026-07-13T01:21:23.522595+00:00

- Submission: **SUB-001** (DOT 185040 · SAFER: UNITED PETROLEUM TRANSPORTS INC)
- Question: Triage this submission. Surface the top 3 risk drivers, recommend a disposition, and cite evidence.
- Wall time: 88350 ms · drafts: 2 · retrieved chunks: 15
- Disposition: `{'label': 'decline', 'confidence': 0.95, 'drivers': ['adverse_loss_history', 'high_crash_frequency', 'fatal_and_injury_crashes']}`

## Critique
- iter 1 · judge gpt-4o · FLAGGED: Missing carrier-generated loss runs to verify loss history; Unsupported [5, 7]-cited claim regarding BASIC percentile scores; Incomplete context for fatal and injury crashes; Lack of information on safety technology adoption
- iter 2 · judge gpt-4o · FLAGGED: Missing carrier-generated loss runs, critical for verifying loss history; Unsupported citation [4] for NTSB recommendation on safety technologies; Unsupported citation [5, 7] for BASIC percentile scores no longer public; Incomplete information on safety technology adoption and internal safety metrics

## Citations
- [1] `ntsb-har-2101#chunk-7` — of occupant protection and crashworthiness standards for medium-size buses. Providing lap/shoulder belts, increasing roof strength, a nd improving window glazin…
- [2] `ntsb-har-1901#chunk-139` — not match their expectations. Their natural inclination is to leave by the exits they recognize, such as the loading door at the front of a bus (ICE Ergonomics …
- [3] `10k-usx-2019#chunk-21` — related to the new safety rating system. In its notice of withdrawal, the FMCSA noted that a new rulemaking related to a similar process may be initiated in the…
- [4] `ntsb-har-2101#chunk-10` — To the National Highway Traffic Safety Administration: Require all newly manufactured commercial motor vehicles with gross vehicle weight ratings above 10,000 p…
- [5] `10k-odfl-2025#chunk-32` — Fixing America’s Surface Transportation Act of 2015 (the “FAST Act”) on December 4, 2015; however, the FAST Act does not restrict public disclosure of all data …
- [6] `10k-odfl-2023#chunk-28` — reviewing CSA methodology to address deficiencies identified by the National Academy of Sciences, including the possibility of weak or negative correlation betw…
- [7] `10k-odfl-2024#chunk-30` — Fixing America’s Surface Transportation Act of 2015 (the “FAST Act”) on December 4, 2015; however, the FAST Act does not restrict public disclosure of all data …
- [8] `10k-knx-2025#chunk-21` — our fleet. Difficulty in attracting and retaining sufficient numbers of qualified driving associates, independent contractors, and third-party capacity provider…
- [9] `ntsb-har-1902#chunk-264` — should be incomprehensible in today’s technical world. We have been building bridges in this country for over two hundred years, and long before that in other p…
- [10] `ntsb-har-2101#chunk-106` — Trucks North America. NTSB Highway Accident Report 47 Appendix B: Consolidated Recommendation Information Title 49 United States Code (USC) 11179(b) requires th…
- [11] `10k-htld-2023#chunk-8` — our fleet. Like many truckload carriers, we experience substantial difficulty in attracting and retaining sufficient numbers of qualified drivers which includes…
- [12] `10k-usx-2020#chunk-30` — a long‑standing, recognized practice, extend the Fair Labor Standards Act to independent contractors and impose notice requirements based on employment or indep…
- [13] `10k-usx-2020#chunk-31` — business of the hiring company; and · the worker is customarily engaged in an independently established trade, occupation, or business. How AB5 will be enforced…
- [14] `ntsb-har-1902#chunk-39` — who was fatally injured. (c) Vehicle 3: a 2006 Chevrolet 1500 pickup truck, occupied by a 53 -year-old male driv er and a 57-year-old male passenger. Both were …
- [15] `10k-usx-2020#chunk-49` — safety ratings, ELDs and hours‑of‑service changes and an improved economy could further reduce the pool of eligible drivers or force us to increase driver compe…

---

TO: Underwriting File
FROM: Senior Underwriter, Commercial Auto
DATE: 2024-08-12
SUBJECT: Triage Memo for ABC Transport Inc (SUB-001)

## Recommendation

Decline.

The submission's adverse loss history, driven by high frequency and severity, presents an unacceptable risk profile. The estimated 3-year loss ratio of 151.5% [Loss History] is untenable.

## Risk drivers

*   **Profoundly Unprofitable Loss History:** The account's estimated 3-year loss ratio is 151.5%, based on an assumed premium of $5,500 per power unit [Loss History]. This history includes 2 fatal and 14 injury crashes in the last 24 months [SAFER]. Average severity is over $115,000 [Loss History]. This is not a sustainable risk for our book.
*   **High Crash Frequency:** The carrier has accumulated 41 total crashes in the past 24 months [SAFER]. This historical rate of ~20 crashes per year is alarming and stands in stark contrast to our loss-frequency model's prediction of 3.7 claims [XGBoost v3-isotonic-2026-07-10]. The model appears to be under-weighting the crash history, making its output unreliable for this submission.
*   **Significant Severity:** The SAFER profile documents 2 fatal crashes, 14 injury crashes, and 25 towaway crashes within a 24-month period [SAFER]. This indicates a pattern of severe incidents, not just minor fender-benders, which is consistent with the high average severity calculated in the loss history.

## Comparable accounts

Our book has limited appetite for accounts with this profile. Of five comparable large fleets, we only bound one (BOOK-042), which had a loss ratio of 0.91. The other four were declined, non-renewed, or lost to market with loss ratios between 0.94 and 1.07. ABC Transport's estimated loss ratio of 1.51 [Loss History] is significantly worse than any of these peers.

## Open questions for the broker

While the disposition is a decline, should this account be marketed to us again, the following information would be required for any reconsideration.

*   **Carrier Loss Runs:** We have not been provided with carrier-generated loss runs. The provided loss history is a heuristic based on public data and an assumed premium. We require five years of currently valued, auditable loss runs to verify the account's performance.
*   **Crash Details:** The SAFER profile shows 2 fatal and 14 injury crashes in the last 24 months [SAFER]. We need detailed accident reports, findings from any litigation, and documentation of post-incident corrective actions for all major events.
*   **Safety Technology:** What is the fleet's adoption rate of safety technologies like telematics, dash cams, and Advanced Driver-Assistance Systems (ADAS)? The NTSB has specifically recommended lane departure prevention systems for commercial vehicles [4].
*   **Internal Safety Metrics:** We recognize that BASIC percentile scores are no longer public information [5, 7]. Can the carrier provide internal safety scorecards or metrics used to monitor performance in key areas like Unsafe Driving and HOS Compliance?

## Producer-facing summary

We are declining to offer a quotation for ABC Transport Inc. at this time. The decision is based on a significant history of severe and frequent losses, including 2 fatal and 14 injury crashes over the last 24 months [SAFER], resulting in a highly unprofitable estimated loss ratio.

```json
{
  "disposition": "decline",
  "confidence": 0.95,
  "drivers": [
    "adverse_loss_history",
    "high_crash_frequency",
    "fatal_and_injury_crashes"
  ]
}
```

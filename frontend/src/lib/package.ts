export type LossYear = { year: number; claims: number; incurred_usd: string | number };
export type SafetyProfile = {
  legal_name: string; operating_status: string; power_units: number; drivers: number;
  crashes_24mo_total: number; crashes_24mo_fatal: number; crashes_24mo_injury: number;
  oos_rate_vehicle: number; oos_rate_driver: number;
};
export type FullSubmission = {
  id: string; carrier_name: string; dot_number: string; safer_legal_name?: string;
  fleet_size: number; vehicle_mix: Record<string, number>; states_of_operation: string[];
  effective_date: string; loss_run: LossYear[]; broker_email: string; commodity: string;
  _safer_snapshot?: SafetyProfile;
};
export type PackageCitation = { ref: string; doc_id: string; snippet: string };
export type PackageRun = {
  run_id: string;
  values: {
    submission?: FullSubmission; safer_profile?: SafetyProfile; memo_md?: string;
    memo?: { body_md: string; producer_summary?: string; disposition?: Disposition };
    disposition?: Disposition; citations?: PackageCitation[];
    retrieved?: { doc_id: string; source: string; text: string; score: number }[];
    loss_stats?: Record<string, unknown>; xgb_pred?: Record<string, unknown>;
    comparables?: Record<string, unknown>[]; tool_results?: unknown[];
    critique_judge?: string; critique_pass?: boolean; critique_error?: string | null;
    critique_warning?: string | null; critique_gaps?: string[]; rubric_scores?: Record<string, number>;
    missing_documents?: string[]; draft_packet_hash?: string; review_packet_hash?: string;
  };
};
export type Disposition = { label: string; confidence: number; drivers: string[] };

export const submissionFields = [
  ["id", "String", "Unique submission reference, for example SUB-001."],
  ["carrier_name / dot_number", "String / digits", "Synthetic account alias and public carrier identifier."],
  ["fleet_size / vehicle_mix", "Integer / fractions", "Power-unit count and vehicle-type mix; fractions normalize to one."],
  ["states_of_operation / commodity", "String array / string", "Territory and the declared hauling exposure."],
  ["effective_date", "YYYY-MM-DD", "Requested inception date."],
  ["broker_email", "String", "The complete broker cover note or email body."],
  ["loss_run[]", "Annual records", "One year, claim count, and total incurred dollars per record."],
];
export const claimFields = [
  ["claim_id", "String", "Unique claim reference; link it to its submission."],
  ["loss_date / reported_date", "YYYY-MM-DD", "When the loss happened and when it was reported."],
  ["claim_type / status", "String", "Coverage or loss category, and whether the claim is open or closed."],
  ["paid_usd / case_reserve_usd", "Nonnegative dollars", "Amounts paid and the outstanding case reserve at the valuation date."],
  ["incurred_usd", "Dollars", "Paid plus outstanding case reserves; identify recoveries separately."],
  ["valuation_date", "YYYY-MM-DD", "The date the financial amounts were evaluated."],
  ["description / location_state", "String", "Loss narrative and territory; avoid personal identifiers in demo records."],
  ["injuries / fatalities", "Nonnegative integers", "Known severity indicators; distinguish unknown from zero."],
];
export const exampleClaim = {
  claim_id: "ILLUSTRATIVE-001", submission_id: "EXAMPLE-SUBMISSION",
  loss_date: "2025-04-12", reported_date: "2025-04-13", valuation_date: "2026-01-01",
  claim_type: "auto_liability", status: "open", paid_usd: 35000, case_reserve_usd: 15000,
  incurred_usd: 50000, description: "Illustrative rear-end collision; not part of the saved demo packet.",
  location_state: "TX", injuries: 1, fatalities: 0,
};

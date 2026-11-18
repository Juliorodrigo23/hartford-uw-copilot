"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, ClipboardList, Download, FileText, ShieldCheck } from "lucide-react";
import { MemoContent } from "@/components/chat/MessageStream";
import { appPath, dataPath, type ShowcaseRun } from "@/lib/api";
import { useData } from "@/lib/useData";
import { claimFields, exampleClaim, submissionFields, type FullSubmission, type PackageRun } from "@/lib/package";

type View = "briefing" | "package" | "format";
const views: { id: View; label: string }[] = [{ id: "briefing", label: "Underwriter briefing" }, { id: "package", label: "Entire package" }, { id: "format", label: "Submission & claim format" }];
const dollars = (value: number | string) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(value));

export default function PackagePage() {
  const { data: packets, status } = useData<{ submissions: FullSubmission[] }>("submissions_full.json");
  const { data: showcase } = useData<ShowcaseRun>("showcase_run.json");
  const [selectedId, setSelectedId] = useState("SUB-001");
  const [view, setView] = useState<View>("briefing");
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<PackageRun | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [loadingRun, setLoadingRun] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setSelectedId(params.get("submission") || "SUB-001");
    setRunId(params.get("run"));
    if (params.get("view") === "format") setView("format");
  }, []);

  useEffect(() => {
    if (!runId) return;
    const ac = new AbortController();
    setLoadingRun(true);
    setRunError(null);
    fetch(appPath(`/api/runs/${encodeURIComponent(runId)}`), { signal: ac.signal, cache: "no-store" })
      .then(async (r) => {
        const payload = await r.json();
        if (!r.ok) throw new Error(payload.error || "The package could not be loaded.");
        return payload as PackageRun;
      })
      .then((value) => { setRun(value); if (value.values.submission) setSelectedId(value.values.submission.id); })
      .catch((error) => { if (!ac.signal.aborted) setRunError(error instanceof Error ? error.message : "Unable to load this run."); })
      .finally(() => { if (!ac.signal.aborted) setLoadingRun(false); });
    return () => ac.abort();
  }, [runId]);

  const stored = packets?.submissions.find((s) => s.id === selectedId);
  const submission = run?.values.submission ?? stored;
  const recorded = !runId && showcase?.submission.id === selectedId ? showcase : null;
  const values = run?.values;
  const memo = values?.memo?.body_md || values?.memo_md || recorded?.memo_md || "";
  const disposition = values?.disposition ?? values?.memo?.disposition ?? recorded?.disposition;
  const citations = values?.citations ?? recorded?.citations ?? [];
  const safer = values?.safer_profile ?? stored?._safer_snapshot;
  const review = recorded?.critiques.at(-1);
  const judge = values?.critique_judge ?? review?.judge;
  const reviewError = values?.critique_error ?? review?.error;
  const reviewPassed = values?.critique_pass ?? review?.passed;
  const missingDocuments = values?.missing_documents ?? [];
  const gaps = values?.critique_gaps ?? review?.gaps ?? [];
  const totalClaims = submission?.loss_run.reduce((n, y) => n + y.claims, 0) ?? 0;
  const totalIncurred = submission?.loss_run.reduce((n, y) => n + Number(y.incurred_usd), 0) ?? 0;
  const fullPackage = { provenance: run ? "Live analysis of a synthetic submission" : recorded ? "Recorded historical analysis of a synthetic submission" : "Synthetic packet; no memo generated", submission, saved_public_safer_profile: safer, analysis: values ?? recorded ?? null };

  function select(id: string) {
    setSelectedId(id); setRunId(null); setRun(null); setRunError(null); setLoadingRun(false);
    window.history.replaceState(null, "", appPath(`/package?submission=${encodeURIComponent(id)}`));
  }
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(fullPackage, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `${submission?.id ?? "submission"}-underwriting-package.json`; link.click(); URL.revokeObjectURL(url);
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-6">
        <div className="max-w-2xl">
          <div className="section-eyebrow">Submission package · format, evidence, decision support</div>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">The underwriter’s desk.</h1>
          <p className="mt-3 leading-relaxed text-ink-muted">Open the broker’s packet, inspect its loss history, and read the exact memo prepared for the underwriter. The inputs and evidence stay beside the recommendation.</p>
        </div>
        <Link href={`/chat?demo=${encodeURIComponent(selectedId)}`} className="btn-primary"><ArrowUpRight size={15} /> Analyze this submission</Link>
      </header>

      <div className="card mb-5 flex flex-wrap items-center justify-between gap-4 border-l-2 border-l-brand-500 px-4 py-4">
        <label className="flex flex-wrap items-center gap-3 text-sm"><ClipboardList size={17} className="text-brand-400" /><span className="font-mono text-2xs uppercase tracking-wider text-ink-dim">Account</span>
          <select aria-label="Select submission package" value={selectedId} onChange={(e) => select(e.target.value)} className="max-w-full rounded-md border border-border bg-bg-panel px-3 py-2 text-sm text-ink">
            {packets?.submissions.map((s) => <option key={s.id} value={s.id}>{s.id} · {s.carrier_name}</option>)}
          </select>
        </label>
        <span className="rounded border border-border bg-bg-panel px-2.5 py-1.5 font-mono text-2xs text-ink-muted">{run ? "Live run package" : recorded ? "Recorded historical package" : "Synthetic submission packet"}</span>
      </div>
      <p className="mb-6 text-xs leading-relaxed text-ink-dim">Submission aliases and loss records are synthetic. Carrier safety snapshots and retrieved source documents are public evidence. The historical sample is labeled; opening it does not invoke a model.</p>

      <div role="tablist" aria-label="Package views" className="mb-7 flex gap-1 overflow-x-auto border-b border-border">
        {views.map((item) => <button key={item.id} id={`tab-${item.id}`} role="tab" aria-selected={view === item.id} aria-controls={`panel-${item.id}`} onClick={() => setView(item.id)} className={`shrink-0 border-b-2 px-4 py-3 text-sm transition-colors ${view === item.id ? "border-brand-400 text-ink" : "border-transparent text-ink-muted hover:text-ink"}`}>{item.label}</button>)}
      </div>
      {status === "loading" && <p className="card p-6 text-ink-muted">Loading complete submission packets…</p>}
      {status === "missing" && <p role="alert" className="card p-6 text-warn-400">The submission packets could not be loaded. Please refresh the page.</p>}
      {loadingRun && <p role="status" className="mb-4 text-sm text-ink-muted">Loading the completed analysis and its evidence…</p>}
      {runError && <div role="alert" className="mb-5 rounded-md border border-warn-500/40 bg-warn-500/10 p-4 text-sm text-warn-400">{runError}<button onClick={() => select("SUB-001")} className="ml-3 underline">Open the recorded sample</button></div>}

      <section role="tabpanel" id={`panel-${view}`} aria-labelledby={`tab-${view}`}>
        {view === "briefing" && submission && (
          <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
            <aside className="space-y-4">
              <div className="card border-t-2 border-t-brand-500 p-5">
                <div className="font-mono text-2xs uppercase tracking-[0.2em] text-ink-dim">Account brief · {submission.id}</div>
                <h2 className="mt-3 text-xl font-semibold">{submission.carrier_name}</h2>
                <div className="mt-4 space-y-3"><Fact label="DOT" value={submission.dot_number} /><Fact label="Requested effective date" value={submission.effective_date} /><Fact label="Declared commodity" value={submission.commodity.replaceAll("_", " ")} /><Fact label="Submitted fleet" value={`${submission.fleet_size} power units`} /><Fact label="Territory" value={submission.states_of_operation.join(" · ")} /></div>
              </div>
              <div className="card p-5"><div className="section-eyebrow">Loss-run totals</div><div className="mt-3 text-2xl font-semibold tabular-nums">{dollars(totalIncurred)}</div><p className="mt-1 text-sm text-ink-muted">{totalClaims} claims across {submission.loss_run.length} reported years</p><p className="mt-3 text-xs leading-relaxed text-ink-dim">Annual aggregates. Individual claim files are not included in this saved packet.</p></div>
              {safer && <div className="card p-5"><div className="flex items-center gap-2 text-sm font-medium"><ShieldCheck size={15} className="text-accent-400" />Public SAFER profile</div><p className="mt-2 text-xs leading-relaxed text-ink-muted">{safer.legal_name}</p><div className="mt-4 space-y-3"><Fact label="Operating status" value={safer.operating_status} /><Fact label="Profile fleet" value={`${safer.power_units} power units`} /><Fact label="Crashes in 24 months" value={`${safer.crashes_24mo_total} · ${safer.crashes_24mo_fatal} fatal`} /></div>{safer.power_units !== submission.fleet_size && <p className="mt-3 text-xs text-warn-400">Fleet counts differ between the submitted packet and the saved SAFER profile; reconcile before quoting.</p>}</div>}
            </aside>
            <div className="min-w-0 space-y-5">
              {disposition && <div className="card flex flex-wrap items-center justify-between gap-4 px-5 py-4"><div><div className="section-eyebrow">Memo recommendation · decision support</div><div className="mt-1 text-lg font-semibold capitalize">{disposition.label.replaceAll("_", " ")}</div></div><div className="text-right"><div className="font-mono text-xl tabular-nums">{Math.round(disposition.confidence * 100)}%</div><div className="text-xs text-ink-dim">Model-reported confidence</div></div></div>}
              {judge && <div className={`rounded-md border p-4 text-sm ${reviewError || reviewPassed === false ? "border-warn-500/40 bg-warn-500/10 text-warn-400" : "border-accent-500/30 bg-accent-500/5 text-ink-muted"}`}><strong>Review: {judge}</strong> · {reviewError ? "Automated review unavailable — human review required." : reviewPassed ? "Rubric passed; an underwriter retains the decision." : "Unresolved review gaps — human review required."}{values?.critique_warning && <p className="mt-2">{values.critique_warning}</p>}{missingDocuments.length > 0 && <div className="mt-2"><strong>Broker documents still required</strong><ul className="mt-1 list-disc pl-5">{missingDocuments.map(document => <li key={document}>{document}</li>)}</ul></div>}{gaps.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-5">{gaps.map((gap) => <li key={gap}>{gap}</li>)}</ul>}</div>}
              <article className="card p-5 sm:p-8"><div className="mb-5 flex flex-wrap items-center justify-between gap-2 border-b border-border pb-4"><h2 className="flex items-center gap-2 font-medium"><FileText size={16} className="text-brand-400" />Underwriter briefing memo</h2><span className="font-mono text-2xs text-ink-dim">{run ? `RUN ${run.run_id.slice(0, 10)}` : recorded ? `RECORDED ${recorded.generated_at.slice(0, 10)}` : "NOT GENERATED"}</span></div>{memo ? <div className="text-sm leading-relaxed"><MemoContent text={memo} citations={citations} /></div> : <div className="py-10 text-sm leading-relaxed text-ink-muted">{loadingRun ? "Loading the memo…" : "This submission has a complete input packet, but no briefing memo is attached to this view. Choose “Analyze this submission” to generate one, then open the completed run’s package."}</div>}</article>
              {citations.length > 0 && <div className="card p-5"><h3 className="mb-4 font-medium">Evidence cited in this memo</h3><div className="space-y-3">{citations.map((c) => <div key={`${c.ref}-${c.doc_id}`} className="border-l border-border pl-3"><p className="font-mono text-xs text-info-400">{c.ref} {c.doc_id}</p><p className="mt-1 text-sm leading-relaxed text-ink-muted">{c.snippet}</p></div>)}</div></div>}
            </div>
          </div>
        )}

        {view === "package" && submission && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-semibold">Everything in this package</h2><p className="mt-1 text-sm text-ink-muted">The original structured submission, broker note, annual losses, safety snapshot, analysis evidence, and generated memo.</p></div><button onClick={download} className="btn-secondary"><Download size={14} />Download package JSON</button></div>
            <div className="card grid gap-4 p-5 text-sm sm:grid-cols-2"><div><span className="text-accent-400">Included</span><p className="mt-2 text-ink-muted">Broker cover note · structured submission · annual loss run · saved SAFER profile{memo ? " · briefing memo and review" : ""}</p></div><div><span className="text-warn-400">Not supplied in this demo</span><p className="mt-2 text-ink-muted">Individual claim files · original ACORD PDF · driver MVR attachments · supporting claim documents. A broker’s reference to an attachment does not mean its source file is present here.</p></div></div>
            <details open className="card p-5"><summary className="cursor-pointer font-medium">01 · Broker cover email</summary><pre className="mt-4 whitespace-pre-wrap font-sans text-sm leading-relaxed text-ink-muted">{submission.broker_email}</pre></details>
            <div className="card overflow-hidden"><h3 className="border-b border-border p-5 font-medium">02 · Annual loss run</h3><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-bg-panel font-mono text-2xs uppercase text-ink-dim"><tr><th className="px-5 py-3">Loss year</th><th className="px-5 py-3">Claims</th><th className="px-5 py-3">Incurred</th></tr></thead><tbody>{submission.loss_run.map((year) => <tr key={year.year} className="border-t border-border"><td className="px-5 py-3">{year.year}</td><td className="px-5 py-3 tabular-nums">{year.claims}</td><td className="px-5 py-3 tabular-nums">{dollars(year.incurred_usd)}</td></tr>)}</tbody><tfoot className="border-t border-border font-medium"><tr><td className="px-5 py-3">Total</td><td className="px-5 py-3">{totalClaims}</td><td className="px-5 py-3">{dollars(totalIncurred)}</td></tr></tfoot></table></div></div>
            <JsonSection title="03 · Complete stored submission" value={submission} />
            <JsonSection title="04 · Public SAFER snapshot" value={safer} />
            <JsonSection title="05 · Model, loss statistics, comparables, and tool results" value={values ? { loss_stats: values.loss_stats, xgb_pred: values.xgb_pred, comparables: values.comparables, tool_results: values.tool_results, rubric_scores: values.rubric_scores } : recorded?.tool_calls} />
            <JsonSection title="06 · Retrieved evidence and citations" value={values ? { retrieved: values.retrieved, citations } : recorded ? { citations, retrieved_count: recorded.retrieved_count } : null} />
            <JsonSection title="07 · Complete memo and recommendation" value={memo ? { memo, disposition, judge, review_passed: reviewPassed, review_error: reviewError, gaps } : null} />
            <JsonSection title="08 · Entire analysis state" value={values ?? recorded} />
          </div>
        )}

        {view === "format" && (
          <div className="space-y-8">
            <div className="max-w-3xl"><div className="section-eyebrow">Input contract</div><h2 className="mt-2 text-2xl font-semibold">One packet per account. One record per loss.</h2><p className="mt-3 leading-relaxed text-ink-muted">An insurance submission describes the account applying for coverage. Claims describe past loss events inside that account’s loss history. The current demo consumes annual claim counts and incurred totals; a claim-level record is shown below as a format reference.</p></div>
            <FieldTable title="Submission fields used by the running agent" rows={submissionFields} />
            <div className="card p-5"><h3 className="font-medium">Current annual loss format</h3><p className="mt-2 text-sm text-ink-muted">Each loss-run row has a year, a claim count, and total incurred dollars. These are aggregates, so the demo cannot reconstruct each claim’s cause, dates, or individual financial amounts.</p><pre className="mt-4 overflow-x-auto rounded-md bg-bg-panel p-4 font-mono text-xs">{JSON.stringify({ loss_run: [{ year: 2025, claims: 4, incurred_usd: "250000" }] }, null, 2)}</pre><a href={dataPath("submission_schema.json")} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-sm text-info-400">Open the exact input JSON schema <ArrowUpRight size={13} /></a></div>
            <FieldTable title="Claim-level format reference" rows={claimFields} />
            <div className="card p-5"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-medium">Example individual claim record</h3><span className="font-mono text-2xs text-warn-400">ILLUSTRATIVE · NOT A SAVED CLAIM</span></div><p className="mt-2 text-sm text-ink-muted">This reference is separate from the current agent input schema. To use claim-level records, validate them and aggregate them by loss year before supplying the annual loss run. Original claim files should remain linked as evidence.</p><pre className="mt-4 overflow-x-auto rounded-md bg-bg-panel p-4 font-mono text-xs leading-relaxed">{JSON.stringify(exampleClaim, null, 2)}</pre></div>
            <div className="card p-5"><h3 className="font-medium">What the underwriter is briefed on</h3><ol className="mt-4 list-decimal space-y-3 pl-5 text-sm leading-relaxed text-ink-muted"><li>The broker’s request, fleet, declared commodity, territory, and effective date.</li><li>Loss frequency, severity, trend, and the assumptions behind estimated loss ratios.</li><li>The public carrier profile, retrieved evidence, comparable accounts, and model provenance.</li><li>A cited recommendation, material risk drivers, open questions, and producer-facing summary.</li><li>The reviewer used, rubric outcome, unresolved gaps, and whether human review is required.</li></ol><button onClick={() => setView("briefing")} className="btn-secondary mt-5">Read the briefing memo →</button></div>
          </div>
        )}
      </section>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div><div className="font-mono text-[10px] uppercase tracking-wider text-ink-dim">{label}</div><div className="mt-0.5 text-sm text-ink-muted">{value}</div></div>;
}
function JsonSection({ title, value }: { title: string; value: unknown }) {
  return <details className="card p-5"><summary className="cursor-pointer font-medium">{title}</summary>{value ? <pre className="mt-4 max-h-[600px] overflow-auto whitespace-pre-wrap break-words rounded-md bg-bg-panel p-4 font-mono text-xs leading-relaxed text-ink-muted">{JSON.stringify(value, null, 2)}</pre> : <p className="mt-4 text-sm text-ink-dim">Not available in this packet. Run a live analysis to attach its output.</p>}</details>;
}
function FieldTable({ title, rows }: { title: string; rows: string[][] }) {
  return <div className="card overflow-hidden"><h3 className="border-b border-border p-5 font-medium">{title}</h3><div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead className="bg-bg-panel font-mono text-2xs uppercase text-ink-dim"><tr><th className="px-5 py-3">Field</th><th className="px-5 py-3">Format</th><th className="px-5 py-3">Purpose</th></tr></thead><tbody>{rows.map(([field, format, description]) => <tr key={field} className="border-t border-border"><th className="px-5 py-4 font-mono text-xs font-normal text-ink">{field}</th><td className="px-5 py-4 text-xs text-ink-muted">{format}</td><td className="px-5 py-4 leading-relaxed text-ink-muted">{description}</td></tr>)}</tbody></table></div></div>;
}

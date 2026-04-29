import { cn } from "@/lib/cn";
import type { ReactNode } from "react";

type Props = {
  id: string;
  number: number;
  eyebrow: string;
  title: string;
  lede?: string;
  children: ReactNode;
  className?: string;
};

export function Section({ id, number, eyebrow, title, lede, children, className }: Props) {
  return (
    <section id={id} className={cn("scroll-mt-20 border-b border-border py-14", className)}>
      <div className="mb-6">
        <div className="font-mono text-2xs uppercase tracking-[0.22em] text-ink-dim">
          {String(number).padStart(2, "0")} · {eyebrow}
        </div>
        <h2 className="mt-2 text-balance text-2xl font-semibold tracking-tight md:text-3xl">{title}</h2>
        {lede && <p className="mt-3 max-w-3xl text-base leading-relaxed text-ink-muted">{lede}</p>}
      </div>
      <div className="space-y-6">{children}</div>
    </section>
  );
}

export function Caption({ children }: { children: ReactNode }) {
  return <div className="text-2xs text-ink-dim">{children}</div>;
}

export function Note({ children, kind = "info" }: { children: ReactNode; kind?: "info" | "warn" | "ok" }) {
  const colors: Record<string, string> = {
    info: "border-info-500/40 bg-info-500/8 text-info-400",
    warn: "border-warn-500/40 bg-warn-500/8 text-warn-400",
    ok: "border-accent-500/40 bg-accent-500/8 text-accent-400",
  };
  return (
    <div className={cn("rounded-md border px-3 py-2 text-xs leading-relaxed", colors[kind])}>{children}</div>
  );
}

/** PlainEnglish — friendly explainer that introduces a section before any
 *  technical detail. Reads as a primer for non-domain-experts. */
export function PlainEnglish({
  title = "In plain English",
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <div className="mb-6 rounded-xl border border-accent-500/30 bg-gradient-to-br from-accent-500/8 via-info-500/5 to-transparent p-5">
      <div className="mb-2 flex items-center gap-2 font-mono text-2xs uppercase tracking-[0.2em] text-accent-400">
        <span aria-hidden>🎓</span> {title}
      </div>
      <div className="space-y-2 text-[15px] leading-relaxed text-ink">{children}</div>
    </div>
  );
}

/** Glossary — tight inline definitions, rendered as a 2-column grid. */
export function Glossary({ items }: { items: { term: string; def: ReactNode }[] }) {
  return (
    <div className="mt-3 grid grid-cols-1 gap-2 rounded-md border border-border bg-bg-subtle/40 p-3 sm:grid-cols-2">
      {items.map((it, i) => (
        <div key={i} className="text-xs">
          <span className="font-mono text-ink">{it.term}</span>{" "}
          <span className="text-ink-muted">— {it.def}</span>
        </div>
      ))}
    </div>
  );
}

export function ProseRow({
  children,
  side,
  reverse,
}: {
  children: ReactNode;
  side: ReactNode;
  reverse?: boolean;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.4fr]",
        reverse && "lg:[&>:first-child]:order-2",
      )}
    >
      <div className="prose-tight space-y-3 text-[15px]">{children}</div>
      <div className="min-w-0">{side}</div>
    </div>
  );
}

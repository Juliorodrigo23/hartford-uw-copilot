"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";

export type Section = { id: string; label: string };

export function SectionRail({ sections }: { sections: Section[] }) {
  const [active, setActive] = useState<string>(sections[0]?.id ?? "");

  useEffect(() => {
    const elements = sections
      .map((s) => document.getElementById(s.id))
      .filter((e): e is HTMLElement => !!e);
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-30% 0px -55% 0px", threshold: [0.1, 0.5, 1] },
    );
    elements.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [sections]);

  return (
    <aside className="sticky top-20 hidden h-[calc(100vh-6rem)] w-56 shrink-0 overflow-y-auto pr-4 lg:block">
      <div className="mb-3 font-mono text-2xs uppercase tracking-[0.18em] text-ink-dim">
        Walkthrough
      </div>
      <ol className="space-y-1 border-l border-border">
        {sections.map((s, i) => (
          <li key={s.id}>
            <a
              href={`#${s.id}`}
              className={cn(
                "-ml-px block border-l-2 py-1.5 pl-3 text-sm transition-colors",
                active === s.id
                  ? "border-brand-500 text-ink"
                  : "border-transparent text-ink-muted hover:border-border-strong hover:text-ink",
              )}
            >
              <span className="mr-2 font-mono text-2xs text-ink-dim">
                {String(i + 1).padStart(2, "0")}
              </span>
              {s.label}
            </a>
          </li>
        ))}
      </ol>
    </aside>
  );
}

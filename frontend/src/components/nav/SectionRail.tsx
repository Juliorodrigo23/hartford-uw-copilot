"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";

export type Section = { id: string; label: string };

/**
 * SectionRail — scroll spy.
 *
 * Position-based rather than IntersectionObserver-ratio-based: with sections
 * much taller than the viewport, intersection ratios are tiny and unstable,
 * which made the highlight flicker or stick. Instead we pick the LAST
 * section whose top has crossed a reading line 35% down the viewport, on a
 * passive rAF-throttled scroll listener.
 */
export function SectionRail({ sections }: { sections: Section[] }) {
  const [active, setActive] = useState<string>(sections[0]?.id ?? "");

  useEffect(() => {
    let raf = 0;

    const measure = () => {
      raf = 0;
      const line = window.innerHeight * 0.35;
      let current = sections[0]?.id ?? "";
      for (const s of sections) {
        const el = document.getElementById(s.id);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= line) current = s.id;
        else break;
      }
      // Bottom of page: force the last section active.
      if (window.innerHeight + window.scrollY >= document.body.scrollHeight - 4) {
        current = sections[sections.length - 1]?.id ?? current;
      }
      setActive(current);
    };

    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
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

"use client";

/**
 * Motion hygiene for a long-scroll page.
 *
 * useInView    — IntersectionObserver-backed visibility for a container.
 *                Every self-advancing visualization gates its timers and
 *                animation loops on this, so (a) nothing burns CPU/GPU while
 *                offscreen (the source of the scroll jank), and (b) each
 *                animation plays when the reader actually arrives at it
 *                instead of having finished minutes earlier.
 *
 * usePrefersReducedMotion — respects the OS-level accessibility setting;
 *                components skip autoplay entirely when it's on.
 */

import { useEffect, useRef, useState } from "react";

export function useInView<T extends HTMLElement = HTMLDivElement>(
  amount = 0.25,
): { ref: React.RefObject<T | null>; inView: boolean } {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => setInView(entries.some((e) => e.isIntersecting)),
      { threshold: amount },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [amount]);

  return { ref, inView };
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/** Convenience: true only when the element is visible AND the user hasn't
 *  asked for reduced motion. The standard gate for autoplaying visuals. */
export function useAnimationGate<T extends HTMLElement = HTMLDivElement>(
  amount = 0.25,
): { ref: React.RefObject<T | null>; active: boolean; inView: boolean; reduced: boolean } {
  const { ref, inView } = useInView<T>(amount);
  const reduced = usePrefersReducedMotion();
  return { ref, active: inView && !reduced, inView, reduced };
}

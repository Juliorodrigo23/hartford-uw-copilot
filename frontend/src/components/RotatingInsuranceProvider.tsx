"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";

const PROVIDERS = [
  "a commercial insurance provider",
  "The Hartford",
  "Travelers",
  "Progressive",
  "Chubb's",
] as const;

export function RotatingInsuranceProvider() {
  const [index, setIndex] = useState(0);
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    if (prefersReducedMotion) return;

    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % PROVIDERS.length);
    }, 2200);

    return () => window.clearInterval(timer);
  }, [prefersReducedMotion]);

  return (
    <span className="inline-block font-extrabold">
      <span className="sr-only">a commercial insurance provider</span>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={PROVIDERS[index]}
          aria-hidden="true"
          className="provider-rainbow-text inline-block"
          initial={prefersReducedMotion ? false : { opacity: 0, y: 8, filter: "blur(5px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={prefersReducedMotion ? undefined : { opacity: 0, y: -8, filter: "blur(5px)" }}
          transition={{ duration: 0.35, ease: "easeOut" }}
        >
          {PROVIDERS[index]}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

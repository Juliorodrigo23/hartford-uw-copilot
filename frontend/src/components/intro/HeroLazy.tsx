"use client";

import dynamic from "next/dynamic";

const Hero = dynamic(() => import("./Hero").then((m) => m.Hero), {
  ssr: false,
  loading: () => (
    <div className="h-[440px] w-full animate-pulse rounded-2xl border border-border bg-bg-panel" />
  ),
});

export default function HeroLazy() {
  return <Hero />;
}

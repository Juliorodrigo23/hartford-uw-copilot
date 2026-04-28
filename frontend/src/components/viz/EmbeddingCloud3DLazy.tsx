"use client";

import dynamic from "next/dynamic";

const EmbeddingCloud3D = dynamic(
  () => import("./EmbeddingCloud3D").then((m) => m.EmbeddingCloud3D),
  {
    ssr: false,
    loading: () => (
      <div className="h-[400px] w-full animate-pulse rounded-lg border border-border bg-bg-panel" />
    ),
  },
);

export default function EmbeddingCloud3DLazy() {
  return <EmbeddingCloud3D />;
}

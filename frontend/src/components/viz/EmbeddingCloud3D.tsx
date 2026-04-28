"use client";

/**
 * EmbeddingCloud3D — rotating 3D UMAP scatter of all RAG documents.
 * Reads /data/embeddings_umap.json (precomputed by backend script 08).
 *
 * Visual contract:
 *  - Each point is a chunk; color = source corpus.
 *  - Camera auto-rotates; mouse drag overrides for inspection.
 *  - Hover a point → snippet preview floats in a side panel.
 *  - Source filter chips toggle visibility (animated dim).
 *
 * Data shape (frontend ships a sample fallback if backend hasn't generated yet):
 *   { points: [{x:number, y:number, z:number, src:string, doc_id:string, snippet:string}, ...] }
 */

import { Canvas, ThreeEvent, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { dataPath } from "@/lib/api";

type Pt = { x: number; y: number; z: number; src: string; doc_id: string; snippet: string };
type Cloud = { points: Pt[] };

const SRC_COLORS: Record<string, string> = {
  ntsb: "#60a5fa",
  "10k": "#fbbf24",
  forms: "#34d399",
  fmcsa: "#f87171",
  industry: "#c084fc",
};

const DEFAULT_SRC = "#9aa6b8";

function useEmbeddings(): Cloud {
  const [cloud, setCloud] = useState<Cloud>({ points: makeFallback() });
  useEffect(() => {
    fetch(dataPath("embeddings_umap.json"))
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && d.points) setCloud(d);
      })
      .catch(() => {});
  }, []);
  return cloud;
}

function Points({
  cloud,
  visible,
  onHover,
}: {
  cloud: Cloud;
  visible: Set<string>;
  onHover: (i: number | null) => void;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null!);
  const N = cloud.points.length;

  // Build per-instance attributes
  const colorArr = useMemo(() => {
    const arr = new Float32Array(N * 3);
    cloud.points.forEach((p, i) => {
      const c = new THREE.Color(SRC_COLORS[p.src] ?? DEFAULT_SRC);
      arr[i * 3 + 0] = c.r;
      arr[i * 3 + 1] = c.g;
      arr[i * 3 + 2] = c.b;
    });
    return arr;
  }, [cloud, N]);

  useEffect(() => {
    const m = meshRef.current;
    if (!m) return;
    const dummy = new THREE.Object3D();
    cloud.points.forEach((p, i) => {
      const show = visible.has(p.src);
      dummy.position.set(p.x, p.y, p.z);
      dummy.scale.setScalar(show ? 1 : 0.001);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  }, [cloud, visible]);

  useFrame(({ clock }) => {
    const m = meshRef.current;
    if (!m) return;
    m.rotation.y = clock.elapsedTime * 0.04;
  });

  const handleMove = (e: ThreeEvent<PointerEvent>) => {
    if (e.instanceId == null) return;
    onHover(e.instanceId);
  };
  const handleOut = () => onHover(null);

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, N]}
      onPointerMove={handleMove}
      onPointerOut={handleOut}
    >
      <sphereGeometry args={[0.06, 8, 8]} />
      <meshStandardMaterial vertexColors emissiveIntensity={0.7} />
      <instancedBufferAttribute
        attach="instanceColor"
        args={[colorArr, 3]}
      />
    </instancedMesh>
  );
}

export function EmbeddingCloud3D() {
  const cloud = useEmbeddings();
  const sources = useMemo(() => {
    const s = new Set(cloud.points.map((p) => p.src));
    return Array.from(s);
  }, [cloud]);
  const [visible, setVisible] = useState<Set<string>>(new Set());
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  useEffect(() => setVisible(new Set(sources)), [sources]);

  function toggle(src: string) {
    setVisible((prev) => {
      const next = new Set(prev);
      next.has(src) ? next.delete(src) : next.add(src);
      return next;
    });
  }

  const hovered = hoverIdx != null ? cloud.points[hoverIdx] : null;

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
        <div className="font-mono text-2xs uppercase tracking-[0.18em] text-ink-dim">
          UMAP · 3D · {cloud.points.length.toLocaleString()} chunks · BAAI/bge-large-en-v1.5
        </div>
        <div className="ml-auto flex flex-wrap gap-1.5">
          {sources.map((s) => {
            const on = visible.has(s);
            const c = SRC_COLORS[s] ?? DEFAULT_SRC;
            return (
              <button
                key={s}
                onClick={() => toggle(s)}
                className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-2xs uppercase tracking-[0.16em] transition-opacity ${
                  on ? "opacity-100" : "opacity-40"
                }`}
                style={{ borderColor: c + "55", color: c, background: c + "12" }}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: c }} />
                {SRC_LABEL[s] ?? s}
              </button>
            );
          })}
        </div>
      </div>

      <div className="relative grid grid-cols-1 lg:grid-cols-[1fr_280px]">
        <div className="relative h-[400px]">
          <Canvas
            camera={{ position: [4, 3, 4], fov: 50 }}
            dpr={[1, 2]}
            gl={{ antialias: true, alpha: true }}
          >
            <color attach="background" args={["#0a0d12"]} />
            <ambientLight intensity={0.6} />
            <pointLight position={[6, 6, 6]} intensity={1.2} />
            <Points cloud={cloud} visible={visible} onHover={setHoverIdx} />
            <OrbitControls
              enablePan={false}
              enableDamping
              dampingFactor={0.08}
              minDistance={2}
              maxDistance={12}
            />
          </Canvas>
          <div className="pointer-events-none absolute bottom-2 right-2 font-mono text-2xs text-ink-dim">
            drag to rotate · scroll to zoom
          </div>
        </div>

        <div className="border-t border-border p-4 lg:border-l lg:border-t-0">
          <div className="font-mono text-2xs uppercase tracking-[0.18em] text-ink-dim">
            Hover preview
          </div>
          <div className="mt-2 min-h-[200px] text-sm text-ink-muted">
            {hovered ? (
              <>
                <div className="mb-1 font-mono text-2xs text-accent-400">{SRC_LABEL[hovered.src] ?? hovered.src}</div>
                <div className="mb-1 font-mono text-2xs text-ink-dim">{hovered.doc_id}</div>
                <div className="leading-relaxed">{hovered.snippet}</div>
              </>
            ) : (
              <span className="text-ink-dim">
                Hover a point to inspect the underlying chunk. Clusters that
                form by source corpus indicate the embedding is
                source-discriminative; clusters that mix sources around a topic
                (e.g. "fatigue" or "lane departure") are the ones we want to
                surface during retrieval.
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const SRC_LABEL: Record<string, string> = {
  ntsb: "NTSB",
  "10k": "10-K",
  forms: "ISO Forms",
  fmcsa: "FMCSA",
  industry: "Industry",
};

// Fallback so the visualization isn't blank before the backend exports
// the real UMAP. A torus-cluster mock; replaced once real data is fetched.
function makeFallback(): Pt[] {
  const out: Pt[] = [];
  const srcs = Object.keys(SRC_COLORS);
  let id = 0;
  srcs.forEach((s, idx) => {
    const cx = Math.cos((idx * 2 * Math.PI) / srcs.length) * 1.8;
    const cz = Math.sin((idx * 2 * Math.PI) / srcs.length) * 1.8;
    for (let i = 0; i < 220; i++) {
      const r = Math.random() * 0.9;
      const a = Math.random() * Math.PI * 2;
      const b = (Math.random() - 0.5) * 1.2;
      out.push({
        x: cx + r * Math.cos(a),
        y: b,
        z: cz + r * Math.sin(a),
        src: s,
        doc_id: `${s}-${id++}`,
        snippet: `Sample chunk from ${s} corpus. Replaced once the backend exports the real UMAP via script 08.`,
      });
    }
  });
  return out;
}

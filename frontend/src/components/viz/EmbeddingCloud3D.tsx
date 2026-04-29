"use client";

/**
 * EmbeddingCloud3D — rotating 3D UMAP scatter of all RAG documents.
 * Reads /data/embeddings_umap.json (precomputed by backend script 08).
 *
 * Implementation notes:
 *  - Uses the proven <points> + BufferGeometry + vertexColors pattern (same as
 *    Hero). InstancedMesh + setColorAt was unreliable in r3f v9 / our build.
 *  - Per-source toggling via separate <points> objects, each with `visible`
 *    bound to the source's chip state.
 *  - Hover is via the Canvas-level raycaster with a Points threshold; the
 *    intersection's `index` maps back to the chunk in the source's array.
 *  - OrbitControls is locked passive (auto-rotate) until the user clicks.
 *    Keeps page scroll free of canvas wheel-capture in the long-scroll page.
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

type SourceGroup = { src: string; pts: Pt[]; geom: THREE.BufferGeometry };

function buildGroup(src: string, pts: Pt[]): SourceGroup {
  const positions = new Float32Array(pts.length * 3);
  const colors = new Float32Array(pts.length * 3);
  const c = new THREE.Color(SRC_COLORS[src] ?? DEFAULT_SRC);
  pts.forEach((p, i) => {
    positions[i * 3 + 0] = p.x;
    positions[i * 3 + 1] = p.y;
    positions[i * 3 + 2] = p.z;
    colors[i * 3 + 0] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  });
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geom.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return { src, pts, geom };
}

function PointsCloud({
  cloud,
  visible,
  onHover,
}: {
  cloud: Cloud;
  visible: Set<string>;
  onHover: (p: Pt | null) => void;
}) {
  const groupRef = useRef<THREE.Group>(null!);

  const groups = useMemo(() => {
    const bySrc = new Map<string, Pt[]>();
    for (const p of cloud.points) {
      const arr = bySrc.get(p.src) ?? [];
      arr.push(p);
      bySrc.set(p.src, arr);
    }
    return Array.from(bySrc.entries()).map(([src, pts]) => buildGroup(src, pts));
  }, [cloud]);

  // Cleanup geometries on unmount / cloud change
  useEffect(() => {
    return () => {
      groups.forEach((g) => g.geom.dispose());
    };
  }, [groups]);

  useFrame(({ clock }) => {
    if (groupRef.current) groupRef.current.rotation.y = clock.elapsedTime * 0.04;
  });

  return (
    <group ref={groupRef}>
      {groups.map((g) => (
        <points
          key={g.src}
          geometry={g.geom}
          visible={visible.has(g.src)}
          onPointerMove={(e: ThreeEvent<PointerEvent>) => {
            if (e.index != null) onHover(g.pts[e.index] ?? null);
          }}
          onPointerOut={() => onHover(null)}
        >
          <pointsMaterial
            vertexColors
            size={0.12}
            sizeAttenuation
            transparent
            opacity={0.92}
            depthWrite={false}
            toneMapped={false}
          />
        </points>
      ))}
    </group>
  );
}

export function EmbeddingCloud3D() {
  const cloud = useEmbeddings();
  const sources = useMemo(() => {
    const s = new Set(cloud.points.map((p) => p.src));
    return Array.from(s);
  }, [cloud]);
  const [visible, setVisible] = useState<Set<string>>(new Set());
  const [hovered, setHovered] = useState<Pt | null>(null);
  const [interactive, setInteractive] = useState(false);

  useEffect(() => setVisible(new Set(sources)), [sources]);

  function toggle(src: string) {
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(src)) next.delete(src);
      else next.add(src);
      return next;
    });
  }

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
            raycaster={{ params: { Points: { threshold: 0.15 } } as never }}
          >
            <color attach="background" args={["#0a0d12"]} />
            <PointsCloud cloud={cloud} visible={visible} onHover={setHovered} />
            <OrbitControls
              enablePan={false}
              enableZoom={interactive}
              enableRotate={interactive}
              enableDamping
              dampingFactor={0.08}
              autoRotate={!interactive}
              autoRotateSpeed={0.4}
              minDistance={2}
              maxDistance={12}
            />
          </Canvas>

          {!interactive && (
            <button
              onClick={() => setInteractive(true)}
              className="absolute inset-0 flex items-end justify-center pb-3 font-mono text-2xs text-ink-dim transition-colors hover:text-ink"
              aria-label="Engage 3D controls"
            >
              <span className="rounded-full border border-border bg-bg/70 px-3 py-1 backdrop-blur">
                click to interact · scroll the page freely
              </span>
            </button>
          )}
          {interactive && (
            <button
              onClick={() => setInteractive(false)}
              className="absolute right-3 top-3 rounded-full border border-border bg-bg/80 px-3 py-1 font-mono text-2xs text-ink-muted backdrop-blur hover:text-ink"
            >
              release
            </button>
          )}
          <div className="pointer-events-none absolute bottom-2 right-2 font-mono text-2xs text-ink-dim">
            {interactive ? "drag · scroll to zoom" : "auto-rotating"}
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
                (e.g. &ldquo;fatigue&rdquo; or &ldquo;lane departure&rdquo;) are the ones we want to
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

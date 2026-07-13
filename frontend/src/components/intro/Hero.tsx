"use client";

/**
 * Hero — Three.js particle convergence.
 * Particles spawn from labeled "data sources" at the perimeter and converge
 * into a soft toroidal cloud that rotates slowly. Cheap GPU cost (~3k pts),
 * no postprocessing. Disabled SSR (loaded via next/dynamic on the page).
 */
import { Canvas, useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useAnimationGate } from "@/lib/useInView";

const SOURCES = [
  { label: "FMCSA", color: "#34d399", anchor: [-9, 4, -2] },
  { label: "NTSB", color: "#60a5fa", anchor: [9, 3, -2] },
  { label: "SEC 10-K", color: "#fbbf24", anchor: [-8, -4, 2] },
  { label: "Loss Runs", color: "#f87171", anchor: [8, -3, 2] },
  { label: "ACORD", color: "#c084fc", anchor: [0, 6, -3] },
];

const N = 3200;

function ParticleField() {
  const mesh = useRef<THREE.Points>(null!);
  const geom = useMemo(() => {
    const positions = new Float32Array(N * 3);
    const colors = new Float32Array(N * 3);
    const targets = new Float32Array(N * 3);
    const speeds = new Float32Array(N);
    const palette = SOURCES.map((s) => new THREE.Color(s.color));
    for (let i = 0; i < N; i++) {
      const src = SOURCES[i % SOURCES.length];
      positions[i * 3 + 0] = src.anchor[0] + (Math.random() - 0.5) * 1.2;
      positions[i * 3 + 1] = src.anchor[1] + (Math.random() - 0.5) * 1.2;
      positions[i * 3 + 2] = src.anchor[2] + (Math.random() - 0.5) * 1.2;
      // Target on a torus
      const a = Math.random() * Math.PI * 2;
      const b = Math.random() * Math.PI * 2;
      const R = 3.4;
      const r = 1.0 + Math.random() * 0.4;
      targets[i * 3 + 0] = (R + r * Math.cos(b)) * Math.cos(a);
      targets[i * 3 + 1] = r * Math.sin(b);
      targets[i * 3 + 2] = (R + r * Math.cos(b)) * Math.sin(a);
      const c = palette[i % palette.length];
      colors[i * 3 + 0] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
      speeds[i] = 0.005 + Math.random() * 0.012;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    g.setAttribute("aTarget", new THREE.BufferAttribute(targets, 3));
    g.setAttribute("aSpeed", new THREE.BufferAttribute(speeds, 1));
    return g;
  }, []);

  useFrame((state) => {
    const pos = mesh.current.geometry.attributes.position as THREE.BufferAttribute;
    const tgt = mesh.current.geometry.attributes.aTarget as THREE.BufferAttribute;
    const spd = mesh.current.geometry.attributes.aSpeed as THREE.BufferAttribute;
    const t = state.clock.elapsedTime;
    for (let i = 0; i < N; i++) {
      const ix = i * 3;
      const px = pos.array[ix] as number;
      const py = pos.array[ix + 1] as number;
      const pz = pos.array[ix + 2] as number;
      const tx = tgt.array[ix] as number;
      const ty = tgt.array[ix + 1] as number;
      const tz = tgt.array[ix + 2] as number;
      const s = spd.array[i] as number;
      // Move toward target with a soft orbit
      const orbit = 0.0015 * Math.sin(t * 0.6 + i * 0.07);
      (pos.array as Float32Array)[ix] = px + (tx - px) * s + orbit;
      (pos.array as Float32Array)[ix + 1] = py + (ty - py) * s;
      (pos.array as Float32Array)[ix + 2] = pz + (tz - pz) * s - orbit;
    }
    pos.needsUpdate = true;
    mesh.current.rotation.y = t * 0.08;
    mesh.current.rotation.x = Math.sin(t * 0.2) * 0.08;
  });

  return (
    <points ref={mesh} geometry={geom}>
      <pointsMaterial
        size={0.045}
        vertexColors
        sizeAttenuation
        transparent
        opacity={0.9}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

function SourceLabels() {
  return (
    <>
      {SOURCES.map((s) => (
        <group key={s.label} position={s.anchor as [number, number, number]}>
          <mesh>
            <sphereGeometry args={[0.18, 16, 16]} />
            <meshBasicMaterial color={s.color} transparent opacity={0.9} />
          </mesh>
        </group>
      ))}
    </>
  );
}

export function Hero() {
  // Freeze the particle loop when the hero scrolls out of view (or the user
  // prefers reduced motion) — 3,200 particles animating offscreen was one of
  // the main sources of scroll jank on the landing page.
  const { ref: gateRef, active: gateActive } = useAnimationGate<HTMLDivElement>(0.1);
  return (
    <div
      ref={gateRef}
      className="relative h-[440px] w-full overflow-hidden rounded-2xl border border-border bg-gradient-to-b from-bg-panel to-bg"
    >
      <Canvas
        camera={{ position: [0, 0, 12], fov: 55 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
        frameloop={gateActive ? "always" : "never"}
      >
        <color attach="background" args={["#0a0d12"]} />
        <ambientLight intensity={0.6} />
        <ParticleField />
        <SourceLabels />
      </Canvas>
      {/* Source label overlays (HTML, easier than DOMElement) */}
      <div className="pointer-events-none absolute inset-0">
        {SOURCES.map((s, idx) => {
          const positions = [
            { left: "8%", top: "30%" },
            { right: "8%", top: "32%" },
            { left: "12%", bottom: "26%" },
            { right: "12%", bottom: "28%" },
            { left: "50%", top: "8%", transform: "translateX(-50%)" },
          ];
          return (
            <div
              key={s.label}
              className="absolute text-2xs font-mono uppercase tracking-[0.22em]"
              style={{ ...(positions[idx] as React.CSSProperties), color: s.color }}
            >
              <span className="rounded border border-current/40 bg-bg/50 px-2 py-0.5 backdrop-blur-sm">
                {s.label}
              </span>
            </div>
          );
        })}
      </div>
      <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 text-center">
        <div className="font-mono text-2xs text-ink-dim">
          ~3,200 documents · 5 sources · one decision surface
        </div>
      </div>
    </div>
  );
}

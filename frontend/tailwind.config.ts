import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: "#0a0d12",
          panel: "#10141b",
          card: "#141923",
          subtle: "#1a2030",
        },
        border: {
          DEFAULT: "#1f2733",
          strong: "#2b3645",
        },
        ink: {
          DEFAULT: "#e6ebf2",
          muted: "#9aa6b8",
          dim: "#6c7689",
        },
        // Hartford brand-adjacent. Deep red anchor + emerald data accent.
        brand: {
          50: "#fef2f2",
          100: "#fee2e2",
          400: "#f87171",
          500: "#ef4444",
          600: "#dc2626",
          700: "#b91c1c",
          900: "#7f1d1d",
        },
        accent: {
          400: "#34d399",
          500: "#10b981",
          600: "#059669",
        },
        warn: {
          400: "#fbbf24",
          500: "#f59e0b",
        },
        info: {
          400: "#60a5fa",
          500: "#3b82f6",
        },
      },
      fontFamily: {
        sans: ["InterVariable", "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: [
          "JetBrains Mono",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "monospace",
        ],
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],
      },
      animation: {
        "slow-spin": "spin 30s linear infinite",
        "pulse-slow": "pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "fade-in": "fade-in 0.6s ease-out forwards",
        "shimmer": "shimmer 2.5s linear infinite",
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
      backgroundImage: {
        "grid-fade":
          "linear-gradient(180deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0) 60%), radial-gradient(circle at top, rgba(220,38,38,0.08), transparent 50%)",
      },
    },
  },
  plugins: [],
};

export default config;

import type { NextConfig } from "next";

// Set NEXT_PUBLIC_BASE_PATH to "/hartford" to nest under a subpath (juliooo.com/hartford),
// or leave it empty / unset to serve at root (e.g. hartford.juliooo.com).
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const config: NextConfig = {
  ...(basePath ? { basePath, assetPrefix: basePath } : {}),
  reactStrictMode: true,
  experimental: {
    optimizePackageImports: ["lucide-react", "framer-motion", "d3", "three"],
  },
  transpilePackages: ["three"],
  // With a basePath set, the domain root serves nothing and 404s (which is
  // what you hit when clicking the URL Vercel prints after a deploy).
  // Redirect / → basePath so every entry link lands on the app.
  async redirects() {
    if (!basePath) return [];
    return [
      {
        source: "/",
        destination: basePath,
        basePath: false as const,
        permanent: false,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default config;

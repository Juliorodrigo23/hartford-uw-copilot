import type { NextConfig } from "next";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "/hartford";

const config: NextConfig = {
  basePath,
  assetPrefix: basePath,
  reactStrictMode: true,
  experimental: {
    optimizePackageImports: ["lucide-react", "framer-motion", "d3", "three"],
  },
  transpilePackages: ["three"],
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

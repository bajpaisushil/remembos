import type { NextConfig } from "next";

// Remembos is a 100% client-side app: `output: "export"` produces plain static
// files (the `out/` folder) that can be hosted for free on any static host.
// There is no server, no API routes, and no database outside the user's browser.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

const nextConfig: NextConfig = {
  output: "export",
  basePath: basePath || undefined,
  trailingSlash: true,
  images: { unoptimized: true },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;

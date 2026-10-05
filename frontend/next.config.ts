import type { NextConfig } from "next";

// Static export: `npm run build` writes a fully offline site to ./out.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

const nextConfig: NextConfig = {
  output: "export",
  // parallel work can build into separate folders: NEXT_DIST_DIR=.next-a npm run build (static site lands there)
  distDir: process.env.NEXT_DIST_DIR || undefined,
  trailingSlash: true,
  images: { unoptimized: true },
  basePath: basePath || undefined,
};

export default nextConfig;

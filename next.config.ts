import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // The dev "N" badge sat on top of the mixer's bottom-left controls.
  devIndicators: { position: "bottom-right" },
  cacheComponents: true,
  partialPrefetching: true,
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

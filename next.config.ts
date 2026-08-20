import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingExcludes: {
    "/*": ["**/*.test.ts", "**/*.test.tsx"],
  },
};

export default nextConfig;

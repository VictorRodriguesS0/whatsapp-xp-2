import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["file-type"],
  outputFileTracingExcludes: {
    "/*": ["**/*.test.ts", "**/*.test.tsx"],
  },
};

export default nextConfig;

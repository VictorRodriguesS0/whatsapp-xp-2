import { describe, expect, it } from "vitest";

import nextConfig from "../../next.config";

describe("production Next.js configuration", () => {
  it("keeps file-type external so its dynamic runtime modules work in standalone", () => {
    expect(nextConfig.serverExternalPackages).toContain("file-type");
  });
});

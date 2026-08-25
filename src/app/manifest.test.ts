import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import manifest from "./manifest";

const publicPath = (...segments: string[]) => join(process.cwd(), "public", ...segments);
const layoutIcons = ["icons/xp-16.png", "icons/xp-32.png", "icons/xp-180.png"];

describe("PWA manifest", () => {
  it("declares the XP Atendimento install contract with local icons only", () => {
    const result = manifest();

    expect(result).toMatchObject({
      name: "XP Atendimento",
      short_name: "XP Atendimento",
      start_url: "/conversas",
      scope: "/",
      display: "standalone",
      background_color: "#050505",
      theme_color: "#050505",
    });
    expect(result.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ src: "/icons/xp-192.png", sizes: "192x192" }),
        expect.objectContaining({ src: "/icons/xp-512.png", sizes: "512x512", purpose: "any" }),
        expect.objectContaining({ src: "/icons/xp-maskable-512.png", purpose: "maskable" }),
      ]),
    );

    for (const icon of result.icons ?? []) {
      const localPath = publicPath(icon.src.replace(/^\//, ""));
      expect(existsSync(localPath), `${icon.src} exists`).toBe(true);
      expect(statSync(localPath).size, `${icon.src} is non-empty`).toBeGreaterThan(0);
    }
    for (const icon of layoutIcons) {
      const localPath = publicPath(icon);
      expect(existsSync(localPath), `/${icon} exists`).toBe(true);
      expect(statSync(localPath).size, `/${icon} is non-empty`).toBeGreaterThan(0);
    }
    expect(existsSync(publicPath("sw.js"))).toBe(false);
  });
});

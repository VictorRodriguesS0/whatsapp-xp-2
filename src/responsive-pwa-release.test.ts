import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (path: string) => readFileSync(resolve(root, path), "utf8");

function productionSourceFiles(directory: string): string[] {
  return readdirSync(resolve(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) return productionSourceFiles(path);
    if (![".ts", ".tsx", ".js", ".mjs"].includes(extname(entry.name))) return [];
    if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(entry.name)) return [];

    return [path];
  });
}

describe("responsive PWA release contract", () => {
  it("mounts the theme provider and publishes a standalone manifest with a maskable icon", () => {
    const layout = source("src/app/layout.tsx");
    const manifest = source("src/app/manifest.ts");

    expect(layout).toContain("ThemeProvider");
    expect(layout).toContain('manifest: "/manifest.webmanifest"');
    expect(manifest).toContain('display: "standalone"');
    expect(manifest).toContain('src: "/icons/xp-maskable-512.png"');
    expect(existsSync(resolve(root, "public/icons/xp-maskable-512.png"))).toBe(true);
    expect(source("next.config.ts")).toContain('output: "standalone"');
  });

  it("keeps the approved responsive breakpoints and desktop column clamps together", () => {
    const styles = source("src/app/globals.css");

    expect(styles).toContain("@media (max-width: 767px)");
    expect(styles).toContain("clamp(320px, 23vw, 370px)");
    expect(styles).toContain("clamp(280px, 20vw, 330px)");
    expect(styles).toContain("safe-area-inset-bottom");
    expect(styles).toContain("@media (max-width: 767px) and (prefers-reduced-motion: no-preference)");
    expect(styles).not.toContain("min-inline-size: 20rem");
    expect(styles).not.toContain("scrollbar-gutter: stable both-edges");
    expect(styles).not.toContain("@media (prefers-reduced-motion: no-preference)");
  });

  it("uses the responsive settings representation for users", () => {
    const usersScreen = source("src/components/users/users-screen.tsx");

    expect(usersScreen).toContain("ResponsiveSettingsList");
    expect(existsSync(resolve(root, "src/components/users/responsive-settings-list.tsx"))).toBe(true);
  });

  it("does not ship or register a service worker or Workbox cache", () => {
    const applicationSource = [
      ...productionSourceFiles("src"),
      ...productionSourceFiles("scripts"),
      "next.config.ts",
      "package.json",
    ].map(source).join("\n");

    expect(existsSync(resolve(root, "public/sw.js"))).toBe(false);
    expect(applicationSource).not.toMatch(/serviceWorker\s*\.\s*register/i);
    expect(applicationSource).not.toMatch(/(?:from|require\s*\()\s*["'][^"']*workbox/i);
    expect(source("package.json")).not.toMatch(/["']workbox(?:-|["'])/i);
  });
});

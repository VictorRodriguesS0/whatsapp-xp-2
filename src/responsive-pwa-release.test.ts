import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join, relative, resolve } from "node:path";
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

function recursiveFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];

  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? recursiveFiles(path) : [path];
  });
}

function prohibitedPwaArtifacts(projectRoot: string): string[] {
  const findings: string[] = [];
  const relativePath = (path: string) => relative(projectRoot, path).replaceAll("\\", "/");
  const publicFiles = recursiveFiles(resolve(projectRoot, "public"));
  const workerFile = /^(?:sw(?:\.[^.]+)+|service-worker(?:\.[^.]+)+|workbox[^/]*)$/i;

  for (const path of publicFiles) {
    if (workerFile.test(basename(path))) findings.push(relativePath(path));
  }

  const sourceExtensions = new Set([".cjs", ".cts", ".html", ".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"]);
  const sourceFiles = [
    ...recursiveFiles(resolve(projectRoot, "src")),
    ...recursiveFiles(resolve(projectRoot, "scripts")),
    ...publicFiles,
    ...["next.config.js", "next.config.mjs", "next.config.ts", "package.json"]
      .map((path) => resolve(projectRoot, path))
      .filter(existsSync),
  ].filter((path) => sourceExtensions.has(extname(path)) || basename(path) === "package.json");

  for (const path of sourceFiles) {
    if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path)) continue;
    const contents = readFileSync(path, "utf8");
    const displayPath = relativePath(path);

    if (/\b(?:navigator\s*\.\s*)?serviceWorker\s*\.\s*register\s*\(/i.test(contents)) {
      findings.push(`${displayPath}:service-worker-registration`);
    }
    if (/\bworkbox(?:-[a-z0-9-]+)?\b/i.test(contents)) {
      findings.push(`${displayPath}:workbox`);
    }
  }

  return findings.sort();
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
    expect(prohibitedPwaArtifacts(root)).toEqual([]);
  });

  it("detects recursive worker files and registration/cache source in an isolated fixture", () => {
    const fixture = mkdtempSync(join(tmpdir(), "xp-responsive-pwa-contract-"));

    try {
      mkdirSync(resolve(fixture, "public", "nested"), { recursive: true });
      mkdirSync(resolve(fixture, "src"), { recursive: true });
      writeFileSync(resolve(fixture, "public", "nested", "sw.js"), "self.addEventListener('install', () => {});");
      writeFileSync(resolve(fixture, "public", "nested", "service-worker.prod.js"), "self.addEventListener('fetch', () => {});");
      writeFileSync(resolve(fixture, "public", "nested", "workbox-runtime.js"), "/* cache runtime */");
      writeFileSync(resolve(fixture, "src", "register.ts"), "navigator.serviceWorker.register('/service-worker.prod.js'); importScripts('workbox-runtime.js');");
      writeFileSync(resolve(fixture, "package.json"), JSON.stringify({ dependencies: { "workbox-window": "1.0.0" } }));

      expect(prohibitedPwaArtifacts(fixture)).toEqual(expect.arrayContaining([
        "public/nested/sw.js",
        "public/nested/service-worker.prod.js",
        "public/nested/workbox-runtime.js",
        "src/register.ts:service-worker-registration",
        "src/register.ts:workbox",
        "package.json:workbox",
      ]));
    } finally {
      rmSync(fixture, { force: true, recursive: true });
    }
  });
});

import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

function sourceFiles(path: string): string[] {
  const absolute = resolve(process.cwd(), path);
  return readdirSync(absolute).flatMap((entry) => {
    const child = resolve(absolute, entry);
    if (statSync(child).isDirectory()) return sourceFiles(child);
    return /\.(?:ts|tsx)$/.test(entry) ? [child] : [];
  });
}

describe("WhatsApp catalog Release A", () => {
  it("maps the optional catalog ID only through server-side runtime configuration", () => {
    const envExample = source(".env.example");
    const compose = source("deploy/kvm/docker-compose.yml");
    const envSchema = source("src/lib/env.ts");
    const verifyKvm = source("scripts/verify-kvm-deployment.ps1");

    expect(envExample).toMatch(/^WHATSAPP_CATALOG_ID=$/m);
    expect(compose).toMatch(
      /^\s{6}WHATSAPP_CATALOG_ID: \$\{WHATSAPP_CATALOG_ID:-\}$/m,
    );
    expect(envSchema).toContain("WHATSAPP_CATALOG_ID");
    expect(verifyKvm).toMatch(/"WHATSAPP_CATALOG_ID"/);

    const publicCatalogVariable = ["NEXT_PUBLIC", "WHATSAPP_CATALOG_ID"].join("_");
    expect(envExample).not.toContain(publicCatalogVariable);
    expect(compose).not.toContain(publicCatalogVariable);
    expect(envSchema).not.toContain(publicCatalogVariable);

    for (const file of sourceFiles("src/components/catalog")) {
      expect(readFileSync(file, "utf8"), file).not.toContain("WHATSAPP_CATALOG_ID");
    }
    for (const file of sourceFiles("src/hooks")) {
      expect(readFileSync(file, "utf8"), file).not.toContain("WHATSAPP_CATALOG_ID");
    }
  });

  it("ships authenticated read-only routes and an admin diagnostics page", () => {
    expect(source("src/app/api/catalog/products/route.ts")).toContain("requireUser");

    const imageRoute = source(
      "src/app/api/catalog/products/[retailerId]/image/route.ts",
    );
    expect(imageRoute).toContain("requireUser");
    expect(imageRoute).toContain("getCatalogProductImage");
    expect(imageRoute).toContain('"X-Content-Type-Options": "nosniff"');

    expect(source("src/app/api/settings/whatsapp/catalog/route.ts")).toContain(
      "requireAdmin",
    );
    expect(
      source("src/app/api/settings/whatsapp/catalog/refresh/route.ts"),
    ).toContain("requireAdmin");

    const adminPage = source("src/app/configuracoes/catalogo/page.tsx");
    expect(adminPage).toContain('user.role !== "ADMIN"');
    expect(adminPage).toContain("CatalogSettingsScreen");
  });

  it("keeps Meta as the sole product source and exposes no catalog send route", () => {
    const prisma = source("prisma/schema.prisma");
    expect(prisma).not.toMatch(/\bmodel\s+(?:Catalog)?Product(?:Item)?\b/);
    expect(prisma).not.toMatch(/@@map\("(?:catalog_)?products?"\)/);

    const catalogRouteFiles = sourceFiles("src/app/api/catalog").map((path) =>
      path.replaceAll("\\", "/"),
    );
    expect(catalogRouteFiles.some((path) => /\/send\/route\.ts$/.test(path))).toBe(
      false,
    );
    expect(source("src/modules/catalog/graph-client.ts")).toContain(
      "config.catalogId",
    );
    expect(source("src/modules/catalog/types.ts")).toContain(
      "availableToSend: boolean",
    );
    expect(source("src/components/catalog/catalog-picker.tsx")).toContain(
      "Disponível na próxima etapa",
    );
  });

  it("mutation-tests removal of catalog wiring and rejects non-app recreation", () => {
    const deploymentTests = source("scripts/test-deployment.ps1");
    expect(deploymentTests).toContain(
      "remove existing WhatsApp catalog server wiring",
    );
    expect(deploymentTests).toContain(
      "compose up -d --no-deps --force-recreate --wait --wait-timeout 120 app",
    );
    expect(deploymentTests).toContain(
      "Mutation test aceitou recriação non-app",
    );
    expect(deploymentTests).toContain("database app");
  });
});

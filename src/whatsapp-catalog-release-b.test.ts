import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

function requireFreeFormGuard(value: string) {
  if (!value.includes("assertFreeFormSendAllowed")) {
    throw new Error("catalog sends must retain the Meta free-form window guard");
  }
}

describe("WhatsApp catalog Release B", () => {
  it("ships all three official operations behind server-owned catalog configuration", () => {
    const provider = source("src/modules/whatsapp/provider.ts");
    const meta = source("src/modules/whatsapp/meta-provider.ts");
    const route = source("src/app/api/conversations/[id]/catalog-messages/route.ts");

    expect(provider).toContain("sendProduct(");
    expect(provider).toContain("sendProductList(");
    expect(provider).toContain("sendCatalog(");
    expect(meta).toContain('type: "product"');
    expect(meta).toContain('type: "product_list"');
    expect(meta).toContain('type: "catalog_message"');
    expect(meta).toContain("configuredCatalogId");
    expect(route).toContain("sendCatalogMessage");
    expect(route).not.toMatch(/WHATSAPP_CATALOG_ID|catalogId|catalog_id/u);
  });

  it("keeps browser input minimal and catalog snapshots safe", () => {
    const input = source("src/modules/catalog/send-schemas.ts");
    const content = source("src/modules/catalog/message-content.ts");

    expect(input).toContain('z.literal("PRODUCT")');
    expect(input).toContain('z.literal("PRODUCT_LIST")');
    expect(input).toContain('z.literal("CATALOG")');
    expect(input).toContain(".strict()");
    expect(input).not.toMatch(/catalogId|catalog_id|priceText|imageUrl/u);
    expect(content).toContain('kind: z.literal("catalogProduct")');
    expect(content).toContain('kind: z.literal("catalogProductList")');
    expect(content).not.toMatch(/imageUrl:\s*z\./u);
  });

  it("retains policy, live revalidation, idempotency, retry and safe history", () => {
    const preflight = source("src/modules/catalog/send-service.ts");
    const messages = source("src/modules/messages/service.ts");
    const hook = source("src/hooks/use-inbox.ts");
    const picker = source("src/components/catalog/catalog-picker.tsx");
    const richHistory = source("src/components/inbox/message-rich-content.tsx");

    requireFreeFormGuard(preflight);
    requireFreeFormGuard(messages);
    expect(messages).toContain("revalidateForSend");
    expect(messages).toContain("sendPreparedCatalogMessage");
    expect(messages).toContain("clientRequestId");
    expect(hook).toContain("/catalog-messages");
    expect(picker).toContain("Enviar produto");
    expect(picker).toContain("Enviar catálogo completo");
    expect(picker).not.toContain("Disponível na próxima etapa");
    expect(richHistory).toContain("CatalogProductCard");
    expect(richHistory).toContain("CatalogProductListCard");
    expect(richHistory).toContain("CompleteCatalogCard");

    expect(() => requireFreeFormGuard(
      preflight.replaceAll("assertFreeFormSendAllowed", "removedGuard"),
    )).toThrow(/free-form window guard/u);
  });

  it("keeps the release app-only and documents Meta-compliant sending", () => {
    const deployment = source("scripts/test-deployment.ps1");
    const readme = source("README.md");

    expect(deployment).toContain(
      "compose up -d --no-deps --force-recreate --wait --wait-timeout 120 app",
    );
    expect(deployment).toContain("Mutation test aceitou recriação non-app");
    expect(readme).toContain("Catálogo oficial da XP — leitura e envio");
    expect(readme).toContain("até 30 produtos");
    expect(readme).toContain("janela de atendimento de 24 horas");
  });
});

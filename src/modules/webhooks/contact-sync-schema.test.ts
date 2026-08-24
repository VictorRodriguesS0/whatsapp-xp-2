// @vitest-environment node

import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("WhatsApp Business App contact schema contract", () => {
  it("defines additive address-book storage and a nullable Contact link", async () => {
    const schema = await readFile("prisma/schema.prisma", "utf8");

    expect(schema).toContain("model WhatsAppAppContact {");
    expect(schema).toContain('@@map("whatsapp_app_contacts")');
    expect(schema).toContain(
      "whatsappAppContactId String?",
    );
    expect(schema).toContain("onDelete: SetNull");
  });
});

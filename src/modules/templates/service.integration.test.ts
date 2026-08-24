// @vitest-environment node

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  UserRole,
  WhatsAppPolicyMode,
  WhatsAppTemplateFunction,
  WhatsAppTemplateSyncStatus,
} from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { DemoWhatsAppProvider } from "@/modules/whatsapp/demo-provider";
import { WhatsAppProviderError } from "@/modules/whatsapp/meta-provider";
import type { ProviderTemplate } from "@/modules/whatsapp/provider";
import { resetTestDatabase } from "@/test/database";

import {
  assignServiceResumptionTemplate,
  createPrismaTemplateRepository,
  setWhatsAppPolicyMode,
  syncWhatsAppTemplates,
} from "./service";

const now = new Date("2026-08-23T12:00:00.000Z");

function providerTemplate(
  overrides: Partial<ProviderTemplate> = {},
): ProviderTemplate {
  return {
    metaId: "meta-template-1",
    name: "retomar_atendimento",
    language: "pt_BR",
    category: "UTILITY",
    status: "APPROVED",
    qualityScore: "GREEN",
    components: [
      {
        type: "BODY",
        format: null,
        text: "Olá, {{1}}! Podemos continuar por aqui?",
      },
    ],
    ...overrides,
  };
}

describe("WhatsApp template policy in PostgreSQL", () => {
  beforeEach(resetTestDatabase);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("synchronizes a complete cache, assigns one eligible template and activates atomically", async () => {
    const actor = await prisma.user.create({
      data: {
        name: "Victor",
        email: "victor.templates@example.test",
        passwordHash: "not-used",
        role: UserRole.ADMIN,
      },
    });
    const provider = new DemoWhatsAppProvider();
    provider.listTemplates = async () => [
      providerTemplate(),
      providerTemplate({
        metaId: "meta-pending",
        name: "pendente",
        status: "PENDING",
      }),
    ];
    const dependencies = {
      repository: createPrismaTemplateRepository(prisma),
      provider,
      now: () => now,
    };

    const synchronized = await syncWhatsAppTemplates(actor, dependencies);
    const eligible = synchronized.templates.find(
      ({ name }) => name === "retomar_atendimento",
    )!;
    await assignServiceResumptionTemplate(actor, eligible.id, dependencies);
    const active = await setWhatsAppPolicyMode(
      actor,
      { mode: WhatsAppPolicyMode.ACTIVE },
      dependencies,
    );

    expect(active).toMatchObject({
      mode: "ACTIVE",
      version: 1,
      canActivate: true,
      assignment: {
        templateId: eligible.id,
        previewBody: "Olá, cliente! Podemos continuar por aqui?",
      },
    });
    await expect(
      prisma.whatsAppPolicyConfiguration.findUniqueOrThrow({
        where: { id: 1 },
        select: {
          mode: true,
          version: true,
          activatedAt: true,
          activatedByUserId: true,
          lastTemplateSyncStatus: true,
        },
      }),
    ).resolves.toEqual({
      mode: WhatsAppPolicyMode.ACTIVE,
      version: 1,
      activatedAt: now,
      activatedByUserId: actor.id,
      lastTemplateSyncStatus: WhatsAppTemplateSyncStatus.SUCCEEDED,
    });
    await expect(
      prisma.whatsAppTemplateAssignment.findUniqueOrThrow({
        where: { function: WhatsAppTemplateFunction.SERVICE_RESUMPTION },
        select: { templateId: true, assignedByUserId: true },
      }),
    ).resolves.toEqual({ templateId: eligible.id, assignedByUserId: actor.id });
    expect(JSON.stringify(active)).not.toContain("meta-template-1");
    expect(JSON.stringify(active)).not.toContain("components");
  });

  it("marks missing rows unavailable only after success and preserves the last cache on failure", async () => {
    const actor = await prisma.user.create({
      data: {
        name: "Victor",
        email: "victor.templates.failure@example.test",
        passwordHash: "not-used",
        role: UserRole.ADMIN,
      },
    });
    const provider = new DemoWhatsAppProvider();
    const dependencies = {
      repository: createPrismaTemplateRepository(prisma),
      provider,
      now: () => now,
    };
    provider.listTemplates = async () => [providerTemplate()];
    await syncWhatsAppTemplates(actor, dependencies);
    const before = await prisma.whatsAppTemplate.findFirstOrThrow();

    provider.listTemplates = async () => {
      throw new WhatsAppProviderError("unknown", "raw secret", null);
    };
    await expect(syncWhatsAppTemplates(actor, dependencies)).rejects.toMatchObject({
      code: "WHATSAPP_TEMPLATE_SYNC_FAILED",
    });
    await expect(
      prisma.whatsAppTemplate.findUniqueOrThrow({ where: { id: before.id } }),
    ).resolves.toMatchObject({
      status: "APPROVED",
      supported: true,
      definitionHash: before.definitionHash,
    });

    const next = new Date(now.getTime() + 1_000);
    dependencies.now = () => next;
    provider.listTemplates = async () => [];
    await syncWhatsAppTemplates(actor, dependencies);
    await expect(
      prisma.whatsAppTemplate.findUniqueOrThrow({ where: { id: before.id } }),
    ).resolves.toMatchObject({
      status: "UNAVAILABLE",
      supported: false,
      syncedAt: next,
    });
  });
});

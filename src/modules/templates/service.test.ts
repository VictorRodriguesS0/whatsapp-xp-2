// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  UserRole,
  WhatsAppPolicyMode,
  WhatsAppTemplateSyncStatus,
} from "@/generated/prisma/enums";
import type { SessionUser } from "@/modules/auth/session";
import { DemoWhatsAppProvider } from "@/modules/whatsapp/demo-provider";
import type { ProviderTemplate } from "@/modules/whatsapp/provider";

import {
  assignServiceResumptionTemplate,
  getWhatsAppPolicySettings,
  setWhatsAppPolicyMode,
  syncWhatsAppTemplates,
} from "./service";
import { whatsAppPolicyModeSchema } from "./schemas";
import type {
  PolicyConfigurationRecord,
  TemplateAssignmentRecord,
  TemplateRecord,
  TemplateRepository,
  TemplateServiceDependencies,
  TemplateSyncWrite,
} from "./types";

const admin: SessionUser = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Victor",
  email: "victor@example.test",
  role: UserRole.ADMIN,
};
const attendant = { ...admin, id: "00000000-0000-4000-8000-000000000002", role: UserRole.ATTENDANT };
const now = new Date("2026-08-23T12:00:00.000Z");

function record(
  overrides: Partial<TemplateRecord> = {},
): TemplateRecord {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    metaId: "meta-1",
    name: "retomar_atendimento",
    language: "pt_BR",
    category: "UTILITY",
    status: "APPROVED",
    qualityScore: "GREEN",
    components: [{ type: "BODY", format: null, text: "Olá, {{1}}" }],
    bodyText: "Olá, {{1}}",
    parameterCount: 1,
    supported: true,
    definitionHash: "a".repeat(64),
    syncedAt: now,
    ...overrides,
  };
}

function providerTemplate(
  overrides: Partial<ProviderTemplate> = {},
): ProviderTemplate {
  return {
    metaId: "meta-1",
    name: "retomar_atendimento",
    language: "pt_BR",
    category: "UTILITY",
    status: "APPROVED",
    qualityScore: "GREEN",
    components: [{ type: "BODY", format: null, text: "Olá, {{1}}" }],
    ...overrides,
  };
}

class MemoryTemplateRepository implements TemplateRepository {
  activeUsers = new Set([admin.id]);
  configuration: PolicyConfigurationRecord = {
    mode: WhatsAppPolicyMode.INACTIVE,
    version: 0,
    lastTemplateSyncStatus: WhatsAppTemplateSyncStatus.NEVER,
    lastTemplateSyncAt: null,
    lastTemplateSyncSucceededAt: null,
    lastTemplateSyncFailureCode: null,
    activatedAt: null,
    activatedByUserId: null,
  };
  templates: TemplateRecord[] = [];
  assignment: TemplateAssignmentRecord | null = null;

  async isActorActive(id: string) { return this.activeUsers.has(id); }
  async getConfiguration() { return { ...this.configuration }; }
  async listTemplates() { return this.templates.map((item) => ({ ...item })); }
  async getServiceResumptionAssignment() {
    return this.assignment ? { ...this.assignment } : null;
  }
  async findTemplate(id: string) {
    return this.templates.find((item) => item.id === id) ?? null;
  }
  async completeTemplateSync(items: TemplateSyncWrite[], syncedAt: Date) {
    const seen = new Set(items.map(({ name, language }) => `${name}\0${language}`));
    for (const item of this.templates) {
      if (!seen.has(`${item.name}\0${item.language}`)) {
        item.status = "UNAVAILABLE";
        item.supported = false;
        item.syncedAt = syncedAt;
      }
    }
    for (const item of items) {
      const existing = this.templates.find(
        (candidate) =>
          candidate.name === item.name && candidate.language === item.language,
      );
      if (existing) Object.assign(existing, item, { syncedAt });
      else this.templates.push({ ...item, id: `template-${this.templates.length + 1}`, syncedAt });
    }
    Object.assign(this.configuration, {
      lastTemplateSyncStatus: WhatsAppTemplateSyncStatus.SUCCEEDED,
      lastTemplateSyncAt: syncedAt,
      lastTemplateSyncSucceededAt: syncedAt,
      lastTemplateSyncFailureCode: null,
    });
  }
  async recordTemplateSyncFailure(at: Date, failureCode: string) {
    Object.assign(this.configuration, {
      lastTemplateSyncStatus: WhatsAppTemplateSyncStatus.FAILED,
      lastTemplateSyncAt: at,
      lastTemplateSyncFailureCode: failureCode,
    });
  }
  async assignServiceResumptionTemplate(templateId: string, actorUserId: string) {
    this.assignment = { templateId, assignedByUserId: actorUserId };
  }
  async updatePolicyMode(mode: WhatsAppPolicyMode, actorUserId: string, at: Date) {
    this.configuration.mode = mode;
    this.configuration.version += 1;
    this.configuration.activatedAt = mode === WhatsAppPolicyMode.ACTIVE ? at : null;
    this.configuration.activatedByUserId = mode === WhatsAppPolicyMode.ACTIVE ? actorUserId : null;
  }
  async updateTemplateStatus() { return false; }
  async updateTemplateQuality() { return false; }
  async transaction<T>(
    operation: (repository: TemplateRepository) => Promise<T>,
  ): Promise<T> {
    return operation(this);
  }
}

function dependencies(repository = new MemoryTemplateRepository()): TemplateServiceDependencies & { repository: MemoryTemplateRepository } {
  return {
    repository,
    provider: new DemoWhatsAppProvider(),
    now: () => now,
  };
}

describe("WhatsApp template policy service", () => {
  it("accepts only a strict policy-mode body", () => {
    expect(whatsAppPolicyModeSchema.parse({ mode: "ACTIVE" })).toEqual({
      mode: WhatsAppPolicyMode.ACTIVE,
    });
    expect(() =>
      whatsAppPolicyModeSchema.parse({ mode: "ACTIVE", force: true }),
    ).toThrow();
  });

  it("completes one full sync and marks previously cached missing rows unavailable", async () => {
    const state = dependencies();
    state.repository.templates.push(
      record({ id: "old-template", metaId: "old-meta", name: "antigo" }),
    );
    state.provider.listTemplates = async () => [providerTemplate()];

    const settings = await syncWhatsAppTemplates(admin, state);

    expect(state.repository.templates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "antigo", status: "UNAVAILABLE", supported: false }),
        expect.objectContaining({ name: "retomar_atendimento", supported: true, syncedAt: now }),
      ]),
    );
    expect(settings.lastSync).toEqual({
      status: "SUCCEEDED",
      attemptedAt: now.toISOString(),
      succeededAt: now.toISOString(),
      failureCode: null,
    });
  });

  it("preserves the cache and assignment when the provider sync fails", async () => {
    const state = dependencies();
    const existing = record();
    state.repository.templates.push(existing);
    state.repository.assignment = {
      templateId: existing.id,
      assignedByUserId: admin.id,
    };
    state.provider.listTemplates = async () => {
      throw new Error("token=secret raw provider payload");
    };

    await expect(syncWhatsAppTemplates(admin, state)).rejects.toMatchObject({
      status: 502,
      code: "WHATSAPP_TEMPLATE_SYNC_FAILED",
    });
    expect(state.repository.templates).toEqual([existing]);
    expect(state.repository.assignment?.templateId).toBe(existing.id);
    expect(state.repository.configuration).toMatchObject({
      lastTemplateSyncStatus: WhatsAppTemplateSyncStatus.FAILED,
      lastTemplateSyncFailureCode: "PROVIDER_UNKNOWN",
      lastTemplateSyncSucceededAt: null,
    });
  });

  it("rejects an ambiguous complete result without mutating the cache", async () => {
    const state = dependencies();
    const existing = record();
    state.repository.templates.push(existing);
    state.provider.listTemplates = async () => [
      providerTemplate(),
      providerTemplate({ metaId: "meta-duplicate" }),
    ];

    await expect(syncWhatsAppTemplates(admin, state)).rejects.toMatchObject({
      code: "WHATSAPP_TEMPLATE_SYNC_FAILED",
    });
    expect(state.repository.templates).toEqual([existing]);
    expect(state.repository.configuration.lastTemplateSyncFailureCode).toBe(
      "PROVIDER_INVALID_RESULT",
    );
  });

  it("rejects non-admin or inactive actors before contacting the provider", async () => {
    const state = dependencies();
    let providerCalls = 0;
    state.provider.listTemplates = async () => {
      providerCalls += 1;
      return [];
    };

    await expect(syncWhatsAppTemplates(attendant, state)).rejects.toMatchObject({ status: 403 });
    state.repository.activeUsers.delete(admin.id);
    await expect(syncWhatsAppTemplates(admin, state)).rejects.toMatchObject({ status: 403 });
    expect(providerCalls).toBe(0);
  });

  it.each([
    ["PENDING", true, "pt_BR", 1],
    ["REJECTED", true, "pt_BR", 1],
    ["PAUSED", true, "pt_BR", 1],
    ["APPROVED", false, "pt_BR", 1],
    ["APPROVED", true, "en_US", 1],
    ["APPROVED", true, "pt_BR", 2],
  ] as const)("refuses an ineligible assignment %#", async (status, supported, language, parameterCount) => {
    const state = dependencies();
    state.repository.configuration.lastTemplateSyncStatus = WhatsAppTemplateSyncStatus.SUCCEEDED;
    state.repository.configuration.lastTemplateSyncSucceededAt = now;
    state.repository.templates.push(record({ status, supported, language, parameterCount }));

    await expect(
      assignServiceResumptionTemplate(admin, state.repository.templates[0]!.id, state),
    ).rejects.toMatchObject({ status: 409, code: "WHATSAPP_TEMPLATE_NOT_ELIGIBLE" });
  });

  it("assigns an eligible synchronized template and activates only while the sync is fresh", async () => {
    const state = dependencies();
    const eligible = record();
    state.repository.templates.push(eligible);
    Object.assign(state.repository.configuration, {
      lastTemplateSyncStatus: WhatsAppTemplateSyncStatus.SUCCEEDED,
      lastTemplateSyncAt: now,
      lastTemplateSyncSucceededAt: now,
    });

    await assignServiceResumptionTemplate(admin, eligible.id, state);
    await expect(
      setWhatsAppPolicyMode(admin, { mode: "ACTIVE" }, state),
    ).resolves.toMatchObject({ mode: "ACTIVE", canActivate: true });

    state.repository.configuration.mode = WhatsAppPolicyMode.INACTIVE;
    state.repository.configuration.lastTemplateSyncSucceededAt = new Date(
      now.getTime() - 24 * 60 * 60 * 1_000 - 1,
    );
    eligible.syncedAt = state.repository.configuration.lastTemplateSyncSucceededAt;
    await expect(
      setWhatsAppPolicyMode(admin, { mode: "ACTIVE" }, state),
    ).rejects.toMatchObject({
      status: 409,
      code: "WHATSAPP_TEMPLATE_NOT_READY",
    });
  });

  it("rejects a definition outside the last successful sync and supports explicit deactivation", async () => {
    const state = dependencies();
    const eligible = record({ syncedAt: new Date(now.getTime() - 1) });
    state.repository.templates.push(eligible);
    Object.assign(state.repository.configuration, {
      lastTemplateSyncStatus: WhatsAppTemplateSyncStatus.SUCCEEDED,
      lastTemplateSyncAt: now,
      lastTemplateSyncSucceededAt: now,
    });
    await expect(
      assignServiceResumptionTemplate(admin, eligible.id, state),
    ).rejects.toMatchObject({
      status: 409,
      code: "WHATSAPP_TEMPLATE_NOT_ELIGIBLE",
    });

    eligible.syncedAt = now;
    await assignServiceResumptionTemplate(admin, eligible.id, state);
    await setWhatsAppPolicyMode(admin, { mode: "ACTIVE" }, state);
    await expect(
      setWhatsAppPolicyMode(admin, { mode: "INACTIVE" }, state),
    ).resolves.toMatchObject({ mode: "INACTIVE", version: 2 });
    expect(state.repository.configuration).toMatchObject({
      activatedAt: null,
      activatedByUserId: null,
    });
  });

  it("returns browser-safe settings without Meta ids or raw components", async () => {
    const state = dependencies();
    const eligible = record({ metaId: "secret-meta-id", components: [{ raw: "provider" }] });
    state.repository.templates.push(eligible);
    const settings = await getWhatsAppPolicySettings(admin, state);

    expect(settings.templates[0]).toMatchObject({
      id: eligible.id,
      name: eligible.name,
      bodyText: eligible.bodyText,
    });
    expect(JSON.stringify(settings)).not.toContain("secret-meta-id");
    expect(JSON.stringify(settings)).not.toContain("provider");
  });
});

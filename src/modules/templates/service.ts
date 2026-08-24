import "server-only";

import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import {
  UserRole,
  WhatsAppPolicyMode,
  WhatsAppTemplateFunction,
  WhatsAppTemplateSyncStatus,
} from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { getWhatsAppProvider } from "@/modules/whatsapp/factory";
import { WhatsAppProviderError } from "@/modules/whatsapp/meta-provider";

import {
  analyzeProviderTemplate,
  renderServiceResumption,
} from "./analysis";
import {
  whatsAppPolicyModeSchema,
  whatsAppTemplateIdSchema,
} from "./schemas";
import type {
  PolicyConfigurationRecord,
  TemplateActor,
  TemplateIdentityUpdate,
  TemplateRecord,
  TemplateRepository,
  TemplateServiceDependencies,
  TemplateSyncWrite,
  WhatsAppPolicySettingsDto,
} from "./types";

const FRESH_SYNC_MS = 24 * 60 * 60 * 1_000;

const configurationSelect = {
  mode: true,
  version: true,
  lastTemplateSyncStatus: true,
  lastTemplateSyncAt: true,
  lastTemplateSyncSucceededAt: true,
  lastTemplateSyncFailureCode: true,
  activatedAt: true,
  activatedByUserId: true,
} as const;

const templateSelect = {
  id: true,
  metaId: true,
  name: true,
  language: true,
  category: true,
  status: true,
  qualityScore: true,
  components: true,
  bodyText: true,
  parameterCount: true,
  supported: true,
  definitionHash: true,
  syncedAt: true,
} as const;

type PrismaTemplateRepositoryClient = Pick<
  PrismaClient,
  | "user"
  | "whatsAppPolicyConfiguration"
  | "whatsAppTemplate"
  | "whatsAppTemplateAssignment"
>;

function templateData(item: TemplateSyncWrite, syncedAt: Date) {
  return {
    metaId: item.metaId,
    name: item.name,
    language: item.language,
    category: item.category,
    status: item.status,
    qualityScore: item.qualityScore,
    components: item.components as unknown as Prisma.InputJsonValue,
    bodyText: item.bodyText,
    parameterCount: item.parameterCount,
    supported: item.supported,
    definitionHash: item.definitionHash,
    syncedAt,
  };
}

function createRepositoryForClient(
  client: PrismaTemplateRepositoryClient,
): TemplateRepository {
  const repository: TemplateRepository = {
    isActorActive: async (id) =>
      (await client.user.count({ where: { id, active: true } })) === 1,
    getConfiguration: () =>
      client.whatsAppPolicyConfiguration.findUniqueOrThrow({
        where: { id: 1 },
        select: configurationSelect,
      }),
    listTemplates: () =>
      client.whatsAppTemplate.findMany({
        orderBy: [{ language: "asc" }, { name: "asc" }, { id: "asc" }],
        select: templateSelect,
      }) as Promise<TemplateRecord[]>,
    getServiceResumptionAssignment: () =>
      client.whatsAppTemplateAssignment.findUnique({
        where: { function: WhatsAppTemplateFunction.SERVICE_RESUMPTION },
        select: { templateId: true, assignedByUserId: true },
      }),
    findTemplate: (id) =>
      client.whatsAppTemplate.findUnique({
        where: { id },
        select: templateSelect,
      }) as Promise<TemplateRecord | null>,
    completeTemplateSync: async (templates, syncedAt) => {
      for (const template of templates) {
        const data = templateData(template, syncedAt);
        await client.whatsAppTemplate.upsert({
          where: {
            name_language: {
              name: template.name,
              language: template.language,
            },
          },
          create: data,
          update: data,
        });
      }
      const seen = templates.map(({ name, language }) => ({ name, language }));
      await client.whatsAppTemplate.updateMany({
        where: seen.length > 0 ? { NOT: { OR: seen } } : {},
        data: { status: "UNAVAILABLE", supported: false, syncedAt },
      });
      await client.whatsAppPolicyConfiguration.update({
        where: { id: 1 },
        data: {
          lastTemplateSyncStatus: WhatsAppTemplateSyncStatus.SUCCEEDED,
          lastTemplateSyncAt: syncedAt,
          lastTemplateSyncSucceededAt: syncedAt,
          lastTemplateSyncFailureCode: null,
        },
      });
    },
    recordTemplateSyncFailure: async (at, failureCode) => {
      await client.whatsAppPolicyConfiguration.update({
        where: { id: 1 },
        data: {
          lastTemplateSyncStatus: WhatsAppTemplateSyncStatus.FAILED,
          lastTemplateSyncAt: at,
          lastTemplateSyncFailureCode: failureCode,
        },
      });
    },
    assignServiceResumptionTemplate: async (templateId, actorUserId) => {
      await client.whatsAppTemplateAssignment.upsert({
        where: { function: WhatsAppTemplateFunction.SERVICE_RESUMPTION },
        create: {
          function: WhatsAppTemplateFunction.SERVICE_RESUMPTION,
          templateId,
          assignedByUserId: actorUserId,
        },
        update: { templateId, assignedByUserId: actorUserId },
      });
    },
    updatePolicyMode: async (mode, actorUserId, at) => {
      await client.whatsAppPolicyConfiguration.update({
        where: { id: 1 },
        data: {
          mode,
          version: { increment: 1 },
          activatedAt: mode === WhatsAppPolicyMode.ACTIVE ? at : null,
          activatedByUserId:
            mode === WhatsAppPolicyMode.ACTIVE ? actorUserId : null,
        },
      });
    },
    updateTemplateStatus: async (identity, status) => {
      const result = await client.whatsAppTemplate.updateMany({
        where: {
          metaId: identity.metaTemplateId,
          name: identity.name,
          language: identity.language,
        },
        data: { status },
      });
      return result.count === 1;
    },
    updateTemplateQuality: async (identity, qualityScore) => {
      const result = await client.whatsAppTemplate.updateMany({
        where: {
          metaId: identity.metaTemplateId,
          name: identity.name,
          language: identity.language,
        },
        data: { qualityScore },
      });
      return result.count === 1;
    },
    transaction: async (operation) => operation(repository),
  };
  return repository;
}

function isPrismaConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2034"
  );
}

export function createPrismaTemplateRepository(
  client: PrismaClient,
): TemplateRepository {
  const repository = createRepositoryForClient(client);
  repository.transaction = async (operation) => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await client.$transaction(
          (transaction) => operation(createRepositoryForClient(transaction)),
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (!isPrismaConflict(error) || attempt === 2) throw error;
      }
    }
    throw new Error("Unreachable template transaction state");
  };
  return repository;
}

const defaultRepository = createPrismaTemplateRepository(prisma);
const defaultDependencies: TemplateServiceDependencies = {
  repository: defaultRepository,
  provider: getWhatsAppProvider(),
  now: () => new Date(),
};

async function requireActiveAdmin(
  actor: TemplateActor,
  repository: TemplateRepository,
): Promise<void> {
  if (
    actor.role !== UserRole.ADMIN ||
    !(await repository.isActorActive(actor.id))
  ) {
    throw new HttpError(403, "Acesso negado");
  }
}

function definitionIsEligible(
  template: TemplateRecord,
  configuration: PolicyConfigurationRecord,
): boolean {
  return (
    template.status === "APPROVED" &&
    template.supported &&
    template.language === "pt_BR" &&
    template.parameterCount === 1 &&
    configuration.lastTemplateSyncStatus ===
      WhatsAppTemplateSyncStatus.SUCCEEDED &&
    configuration.lastTemplateSyncSucceededAt !== null &&
    template.syncedAt.getTime() ===
      configuration.lastTemplateSyncSucceededAt.getTime()
  );
}

function syncIsFresh(
  configuration: PolicyConfigurationRecord,
  now: Date,
): boolean {
  const succeededAt = configuration.lastTemplateSyncSucceededAt;
  return (
    succeededAt !== null &&
    succeededAt.getTime() <= now.getTime() &&
    succeededAt.getTime() >= now.getTime() - FRESH_SYNC_MS
  );
}

async function settingsFromRepository(
  repository: TemplateRepository,
  now: Date,
): Promise<WhatsAppPolicySettingsDto> {
  const [configuration, templates, assignment] = await Promise.all([
    repository.getConfiguration(),
    repository.listTemplates(),
    repository.getServiceResumptionAssignment(),
  ]);
  const assignedTemplate = assignment
    ? templates.find(({ id }) => id === assignment.templateId) ?? null
    : null;
  let readinessReason: WhatsAppPolicySettingsDto["readinessReason"] = null;
  if (!assignment || !assignedTemplate) readinessReason = "NO_ASSIGNMENT";
  else if (!definitionIsEligible(assignedTemplate, configuration)) {
    readinessReason = "TEMPLATE_INELIGIBLE";
  } else if (!syncIsFresh(configuration, now)) readinessReason = "SYNC_STALE";

  return {
    mode: configuration.mode,
    version: configuration.version,
    lastSync: {
      status: configuration.lastTemplateSyncStatus,
      attemptedAt: configuration.lastTemplateSyncAt?.toISOString() ?? null,
      succeededAt:
        configuration.lastTemplateSyncSucceededAt?.toISOString() ?? null,
      failureCode: configuration.lastTemplateSyncFailureCode,
    },
    templates: templates.map((template) => ({
      id: template.id,
      name: template.name,
      language: template.language,
      category: template.category,
      status: template.status,
      qualityScore: template.qualityScore,
      supported: template.supported,
      bodyText: template.bodyText,
      parameterCount: template.parameterCount,
      syncedAt: template.syncedAt.toISOString(),
      assigned: template.id === assignment?.templateId,
    })),
    assignment: assignedTemplate
      ? {
          templateId: assignedTemplate.id,
          name: assignedTemplate.name,
          language: assignedTemplate.language,
          previewBody: renderServiceResumption(
            assignedTemplate.bodyText,
            null,
          ),
        }
      : null,
    canActivate: readinessReason === null,
    readinessReason,
  };
}

function safeSyncFailureCode(error: unknown): string {
  if (error instanceof InvalidTemplateSyncResultError) {
    return "PROVIDER_INVALID_RESULT";
  }
  if (error instanceof WhatsAppProviderError) {
    if (error.graphCode) return `GRAPH_${error.graphCode}`.slice(0, 64);
    return error.kind === "rejected"
      ? "PROVIDER_REJECTED"
      : "PROVIDER_UNKNOWN";
  }
  return "PROVIDER_UNKNOWN";
}

class InvalidTemplateSyncResultError extends Error {}

function assertUniqueTemplateResult(templates: TemplateSyncWrite[]): void {
  const identities = new Set<string>();
  const metaIds = new Set<string>();
  for (const template of templates) {
    const identity = `${template.name}\0${template.language}`;
    if (identities.has(identity) || metaIds.has(template.metaId)) {
      throw new InvalidTemplateSyncResultError();
    }
    identities.add(identity);
    metaIds.add(template.metaId);
  }
}

export async function getWhatsAppPolicySettings(
  actor: TemplateActor,
  dependencies: TemplateServiceDependencies = defaultDependencies,
): Promise<WhatsAppPolicySettingsDto> {
  await requireActiveAdmin(actor, dependencies.repository);
  return settingsFromRepository(
    dependencies.repository,
    dependencies.now(),
  );
}

export async function syncWhatsAppTemplates(
  actor: TemplateActor,
  dependencies: TemplateServiceDependencies = defaultDependencies,
): Promise<WhatsAppPolicySettingsDto> {
  await requireActiveAdmin(actor, dependencies.repository);
  const at = dependencies.now();
  let templates: TemplateSyncWrite[];
  try {
    templates = (await dependencies.provider.listTemplates()).map(
      analyzeProviderTemplate,
    );
    assertUniqueTemplateResult(templates);
  } catch (error) {
    await dependencies.repository.transaction((transaction) =>
      transaction.recordTemplateSyncFailure(at, safeSyncFailureCode(error)),
    );
    throw new HttpError(
      502,
      "Não foi possível sincronizar os templates com a Meta.",
      "WHATSAPP_TEMPLATE_SYNC_FAILED",
    );
  }

  await dependencies.repository.transaction(async (transaction) => {
    await requireActiveAdmin(actor, transaction);
    await transaction.completeTemplateSync(templates, at);
  });
  return settingsFromRepository(dependencies.repository, at);
}

export async function assignServiceResumptionTemplate(
  actor: TemplateActor,
  templateId: unknown,
  dependencies: TemplateServiceDependencies = defaultDependencies,
): Promise<WhatsAppPolicySettingsDto> {
  const parsedTemplateId = whatsAppTemplateIdSchema.parse(templateId);
  await dependencies.repository.transaction(async (transaction) => {
    await requireActiveAdmin(actor, transaction);
    const [template, configuration] = await Promise.all([
      transaction.findTemplate(parsedTemplateId),
      transaction.getConfiguration(),
    ]);
    if (!template) throw new HttpError(404, "Template não encontrado");
    if (!definitionIsEligible(template, configuration)) {
      throw new HttpError(
        409,
        "O template selecionado não está elegível para retomada.",
        "WHATSAPP_TEMPLATE_NOT_ELIGIBLE",
      );
    }
    await transaction.assignServiceResumptionTemplate(
      parsedTemplateId,
      actor.id,
    );
  });
  return settingsFromRepository(
    dependencies.repository,
    dependencies.now(),
  );
}

export async function setWhatsAppPolicyMode(
  actor: TemplateActor,
  input: unknown,
  dependencies: TemplateServiceDependencies = defaultDependencies,
): Promise<WhatsAppPolicySettingsDto> {
  const { mode } = whatsAppPolicyModeSchema.parse(input);
  const at = dependencies.now();
  await dependencies.repository.transaction(async (transaction) => {
    await requireActiveAdmin(actor, transaction);
    const configuration = await transaction.getConfiguration();
    if (configuration.mode === mode) return;
    if (mode === WhatsAppPolicyMode.ACTIVE) {
      const assignment = await transaction.getServiceResumptionAssignment();
      const template = assignment
        ? await transaction.findTemplate(assignment.templateId)
        : null;
      if (
        !template ||
        !definitionIsEligible(template, configuration) ||
        !syncIsFresh(configuration, at)
      ) {
        throw new HttpError(
          409,
          "Sincronize e selecione um template aprovado antes de ativar.",
          "WHATSAPP_TEMPLATE_NOT_READY",
        );
      }
    }
    await transaction.updatePolicyMode(mode, actor.id, at);
  });
  return settingsFromRepository(dependencies.repository, at);
}

export async function applyTemplateStatusUpdate(
  event: TemplateIdentityUpdate & { status: string },
  repository: TemplateRepository = defaultRepository,
): Promise<boolean> {
  return repository.updateTemplateStatus(event, event.status);
}

export async function applyTemplateQualityUpdate(
  event: TemplateIdentityUpdate & { qualityScore: string },
  repository: TemplateRepository = defaultRepository,
): Promise<boolean> {
  return repository.updateTemplateQuality(event, event.qualityScore);
}

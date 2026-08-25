import type {
  WhatsAppPolicyMode,
  WhatsAppTemplateSyncStatus,
} from "@/generated/prisma/enums";
import type { SessionUser } from "@/modules/auth/session";
import type { WhatsAppProvider } from "@/modules/whatsapp/provider";

import type { AnalyzedProviderTemplate } from "./analysis";

export type PolicyConfigurationRecord = {
  mode: WhatsAppPolicyMode;
  version: number;
  lastTemplateSyncStatus: WhatsAppTemplateSyncStatus;
  lastTemplateSyncAt: Date | null;
  lastTemplateSyncSucceededAt: Date | null;
  lastTemplateSyncFailureCode: string | null;
  activatedAt: Date | null;
  activatedByUserId: string | null;
};

export type TemplateRecord = {
  id: string;
  metaId: string | null;
  name: string;
  language: string;
  category: string;
  status: string;
  qualityScore: string | null;
  components: unknown;
  bodyText: string;
  parameterCount: number;
  supported: boolean;
  definitionHash: string;
  syncedAt: Date;
};

export type TemplateSyncWrite = AnalyzedProviderTemplate;

export type TemplateAssignmentRecord = {
  templateId: string;
  assignedByUserId: string;
};

export type TemplateIdentityUpdate = {
  metaTemplateId: string;
  name: string;
  language: string;
};

export type WhatsAppTemplateSummaryDto = {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  qualityScore: string | null;
  supported: boolean;
  bodyText: string;
  parameterCount: number;
  syncedAt: string;
  assigned: boolean;
};

export type WhatsAppPolicySettingsDto = {
  mode: "INACTIVE" | "ACTIVE";
  version: number;
  lastSync: {
    status: "NEVER" | "SUCCEEDED" | "FAILED";
    attemptedAt: string | null;
    succeededAt: string | null;
    failureCode: string | null;
  };
  templates: WhatsAppTemplateSummaryDto[];
  assignment: {
    templateId: string;
    name: string;
    language: string;
    previewBody: string;
  } | null;
  canActivate: boolean;
  readinessReason:
    | "NO_ASSIGNMENT"
    | "TEMPLATE_INELIGIBLE"
    | "SYNC_STALE"
    | null;
};

export type TemplateRepository = {
  isActorActive(id: string): Promise<boolean>;
  getConfiguration(): Promise<PolicyConfigurationRecord>;
  listTemplates(): Promise<TemplateRecord[]>;
  getServiceResumptionAssignment(): Promise<TemplateAssignmentRecord | null>;
  findTemplate(id: string): Promise<TemplateRecord | null>;
  completeTemplateSync(
    templates: TemplateSyncWrite[],
    syncedAt: Date,
  ): Promise<void>;
  recordTemplateSyncFailure(at: Date, failureCode: string): Promise<void>;
  assignServiceResumptionTemplate(
    templateId: string,
    actorUserId: string,
  ): Promise<void>;
  updatePolicyMode(
    mode: WhatsAppPolicyMode,
    actorUserId: string,
    at: Date,
  ): Promise<void>;
  updateTemplateStatus(
    identity: TemplateIdentityUpdate,
    status: string,
  ): Promise<boolean>;
  updateTemplateQuality(
    identity: TemplateIdentityUpdate,
    qualityScore: string,
  ): Promise<boolean>;
  transaction<T>(
    operation: (repository: TemplateRepository) => Promise<T>,
  ): Promise<T>;
};

export type TemplateServiceDependencies = {
  repository: TemplateRepository;
  provider: WhatsAppProvider;
  now(): Date;
};

export type TemplateActor = SessionUser & { active?: boolean };

import type {
  CreateContactDefinitionInput,
  UpdateContactDefinitionInput,
  UpdateContactInput,
} from "./schemas";
import type {
  ContactMessagingConsentAction,
  ContactMessagingConsentSource,
  ContactMessagingRestrictionAction,
} from "@/generated/prisma/enums";

export type DefinitionRecord = {
  id: string;
  displayName: string;
  normalizedName: string;
  color: string;
  position: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type DefinitionDto = Pick<
  DefinitionRecord,
  "id" | "displayName" | "color" | "position" | "active"
>;

export type ContactTagAssignmentRecord = {
  contactId: string;
  tagId: string;
};

export type ContactRecord = {
  id: string;
  name: string;
  preferredName: string | null;
  phone: string | null;
  whatsappAppContact?: { fullName: string | null; active: boolean } | null;
  messagingOptOutAt: Date | null;
  messagingConsentGrantedAt: Date | null;
  messagingConsentSource: ContactMessagingConsentSource | null;
  messagingConsentGrantedByUserId: string | null;
  messagingConsentGrantedByUser: { id: string; name: string } | null;
  messagingConsentNote: string | null;
  contactTypeId: string | null;
  contactType: DefinitionRecord | null;
  tagAssignments: Array<{ tag: DefinitionRecord }>;
};

export type ContactDto = {
  id: string;
  preferredName: string | null;
  whatsappAppName?: string | null;
  name: string;
  phone: string;
  messagingRestricted: boolean;
  type: ContactClassificationDto | null;
  tags: ContactClassificationDto[];
};

export type ContactClassificationDto = Pick<
  DefinitionRecord,
  "id" | "color" | "active"
> & { name: string };

export type ContactUpdateData = UpdateContactInput;

export type ContactMessagingRestrictionUpdateData = {
  messagingOptOutAt: Date | null;
  messagingRestrictionReason: string | null;
  messagingRestrictedByUserId: string | null;
};

export type ContactMessagingRestrictionEventCreateData = {
  contactId: string;
  actorUserId: string;
  action: ContactMessagingRestrictionAction;
  reason: string;
};

export type ContactMessagingRestrictionDto = {
  messagingRestricted: boolean;
};

export type ContactMessagingConsentUpdateData = {
  messagingConsentGrantedAt: Date | null;
  messagingConsentSource: ContactMessagingConsentSource | null;
  messagingConsentGrantedByUserId: string | null;
  messagingConsentNote: string | null;
};

export type ContactMessagingConsentEventCreateData = {
  contactId: string;
  actorUserId: string;
  action: ContactMessagingConsentAction;
  source: ContactMessagingConsentSource;
  note: string | null;
};

export type ContactMessagingConsentDto = {
  active: boolean;
  source: ContactMessagingConsentSource | null;
  grantedAt: string | null;
  grantedBy: { id: string; name: string } | null;
  note: string | null;
};

export type ContactMessagingConsentServiceDependencies = {
  repository: ContactRepository;
  now(): Date;
};

export type DefinitionCreateData = CreateContactDefinitionInput & {
  normalizedName: string;
};

export type DefinitionUpdateData = UpdateContactDefinitionInput & {
  normalizedName?: string;
  active?: boolean;
};

export type ContactRepository = {
  isActorActive(id: string): Promise<boolean>;
  findContact(id: string): Promise<ContactRecord | null>;
  updateContact(id: string, data: ContactUpdateData): Promise<ContactRecord>;
  lockContactForMessagingRestriction(id: string): Promise<ContactRecord | null>;
  updateContactMessagingRestriction(
    id: string,
    data: ContactMessagingRestrictionUpdateData,
  ): Promise<ContactRecord>;
  createContactMessagingRestrictionEvent(
    data: ContactMessagingRestrictionEventCreateData,
  ): Promise<void>;
  lockContactForMessagingConsent(id: string): Promise<ContactRecord | null>;
  updateContactMessagingConsent(
    id: string,
    data: ContactMessagingConsentUpdateData,
  ): Promise<ContactRecord>;
  createContactMessagingConsentEvent(
    data: ContactMessagingConsentEventCreateData,
  ): Promise<void>;

  listContactTypes(): Promise<DefinitionRecord[]>;
  listActiveContactTypes(): Promise<DefinitionRecord[]>;
  findContactType(id: string): Promise<DefinitionRecord | null>;
  createContactType(data: DefinitionCreateData): Promise<DefinitionRecord>;
  updateContactType(
    id: string,
    data: DefinitionUpdateData,
  ): Promise<DefinitionRecord>;

  listContactTags(): Promise<DefinitionRecord[]>;
  listActiveContactTags(): Promise<DefinitionRecord[]>;
  findContactTag(id: string): Promise<DefinitionRecord | null>;
  findActiveContactTags(ids: string[]): Promise<DefinitionRecord[]>;
  createContactTag(data: DefinitionCreateData): Promise<DefinitionRecord>;
  updateContactTag(
    id: string,
    data: DefinitionUpdateData,
  ): Promise<DefinitionRecord>;

  deleteContactTagAssignments(contactId: string): Promise<void>;
  createContactTagAssignments(
    assignments: ContactTagAssignmentRecord[],
  ): Promise<void>;
  transaction<T>(
    operation: (repository: ContactRepository) => Promise<T>,
  ): Promise<T>;
};

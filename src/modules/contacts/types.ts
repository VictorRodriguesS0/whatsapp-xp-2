import type {
  CreateContactDefinitionInput,
  UpdateContactDefinitionInput,
  UpdateContactInput,
} from "./schemas";

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
  contactTypeId: string | null;
  contactType: DefinitionRecord | null;
  tagAssignments: Array<{ tag: DefinitionRecord }>;
};

export type ContactDto = {
  id: string;
  preferredName: string | null;
  name: string;
  phone: string;
  type: ContactClassificationDto | null;
  tags: ContactClassificationDto[];
};

export type ContactClassificationDto = Pick<
  DefinitionRecord,
  "id" | "color" | "active"
> & { name: string };

export type ContactUpdateData = UpdateContactInput;

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

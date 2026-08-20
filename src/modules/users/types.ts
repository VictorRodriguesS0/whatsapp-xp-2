import type { UserRole } from "@/generated/prisma/enums";

import type {
  CreateUserInput,
  UpdateUserInput,
} from "./schemas";

export type UserRecord = {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type PublicUser = Omit<UserRecord, "passwordHash">;

export type CreateUserData = Omit<CreateUserInput, "password"> & {
  passwordHash: string;
};

export type UpdateUserData = UpdateUserInput & {
  passwordHash?: string;
};

export type UserRepository = {
  list(): Promise<UserRecord[]>;
  findById(id: string): Promise<UserRecord | null>;
  findByEmail(email: string): Promise<UserRecord | null>;
  countActiveAdmins(): Promise<number>;
  create(data: CreateUserData): Promise<UserRecord>;
  update(id: string, data: UpdateUserData): Promise<UserRecord>;
  deleteSessions(userId: string): Promise<void>;
};

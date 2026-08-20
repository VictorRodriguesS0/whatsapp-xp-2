// @vitest-environment node

import { describe, expect, it } from "vitest";

import { UserRole } from "@/generated/prisma/enums";
import { verifyPassword } from "@/modules/auth/password";
import type { SessionUser } from "@/modules/auth/session";

import { createUser, listUsers, resetUserPassword, updateUser } from "./service";
import type { UserRecord, UserRepository } from "./types";

const attendant: SessionUser = {
  id: "d81c96d1-9a8d-4a4e-8dd6-729512c9cc47",
  name: "Marcos",
  email: "marcos@example.test",
  role: UserRole.ATTENDANT,
};

const admin: SessionUser = { ...attendant, role: UserRole.ADMIN };

function user(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: "06a86959-3b28-4ff5-84df-b2fc7665154d",
    name: "Ana",
    email: "ana@example.test",
    passwordHash: "scrypt$v1$32768$8$1$8Gp0u5lNmSM0taTBeAhrHw$mhBrVycw8JD76ry4YusBmVpgGCMBZNUAk62loyySlyKJq2otTtRYfxSeZKKBbO23YEo_aEH8E3KwRO_L-x46_Q",
    role: UserRole.ATTENDANT,
    active: true,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

function createRepository(
  initialUsers: UserRecord[] = [],
): UserRepository & { records: UserRecord[]; deletedSessionUserIds: string[] } {
  const records = [...initialUsers];
  const deletedSessionUserIds: string[] = [];

  return {
    records,
    deletedSessionUserIds,
    list: async () => records,
    findById: async (id) => records.find((record) => record.id === id) ?? null,
    findByEmail: async (email) =>
      records.find((record) => record.email === email) ?? null,
    countActiveAdmins: async () =>
      records.filter(
        (record) => record.active && record.role === UserRole.ADMIN,
      ).length,
    create: async (data) => {
      const created = user({
        id: "787ca5ba-eb3b-4ae6-b1f4-ddd6e92d2f84",
        active: true,
        createdAt: new Date(1),
        updatedAt: new Date(1),
        ...data,
      });
      records.push(created);
      return created;
    },
    update: async (id, data) => {
      const record = records.find((candidate) => candidate.id === id);

      if (!record) {
        throw new Error("missing user");
      }

      Object.assign(record, data, { updatedAt: new Date(2) });
      return record;
    },
    deleteSessions: async (userId) => {
      deletedSessionUserIds.push(userId);
    },
  };
}

describe("user administration service", () => {
  it("prevents an attendant from creating users", async () => {
    await expect(
      createUser(attendant, {
        name: "Ana",
        email: "ana@example.test",
        password: "Senha-Demo-2026!",
        role: UserRole.ATTENDANT,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("normalizes an email before creating a user", async () => {
    const repository = createRepository();

    await createUser(
      admin,
      {
        name: "Ana",
        email: " ANA@EXAMPLE.TEST ",
        password: "Senha-Demo-2026!",
        role: UserRole.ATTENDANT,
      },
      repository,
    );

    expect(repository.records[0]?.email).toBe("ana@example.test");
  });

  it("stores a password hash and never returns it when creating a user", async () => {
    const repository = createRepository();

    const result = await createUser(
      admin,
      {
        name: "Ana",
        email: "ana@example.test",
        password: "Senha-Demo-2026!",
        role: UserRole.ATTENDANT,
      },
      repository,
    );

    expect(await verifyPassword("Senha-Demo-2026!", repository.records[0]!.passwordHash)).toBe(true);
    expect(result).not.toHaveProperty("passwordHash");
  });

  it("rejects a duplicate normalized email", async () => {
    const repository = createRepository([user()]);

    await expect(
      createUser(
        admin,
        {
          name: "Outra Ana",
          email: " ANA@EXAMPLE.TEST ",
          password: "Senha-Demo-2026!",
          role: UserRole.ATTENDANT,
        },
        repository,
      ),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("lists users without password hashes", async () => {
    const repository = createRepository([user()]);

    await expect(listUsers(admin, repository)).resolves.toEqual([
      expect.not.objectContaining({ passwordHash: expect.any(String) }),
    ]);
  });

  it("deactivates instead of deleting a referenced user and invalidates sessions", async () => {
    const marcos = user({
      id: "f697fbf1-10c6-4a06-a22f-2b742fcb1019",
      name: "Marcos",
    });
    const repository = createRepository([marcos]);

    await updateUser(admin, marcos.id, { active: false }, repository);

    expect(repository.records[0]?.active).toBe(false);
    expect(repository.deletedSessionUserIds).toEqual([marcos.id]);
  });

  it("rejects deactivation of the last active administrator", async () => {
    const soleAdmin = user({ id: admin.id, role: UserRole.ADMIN });
    const repository = createRepository([soleAdmin]);

    await expect(
      updateUser(admin, soleAdmin.id, { active: false }, repository),
    ).rejects.toMatchObject({ status: 409 });

    expect(repository.records[0]?.active).toBe(true);
  });

  it("revokes all sessions after resetting a password", async () => {
    const target = user();
    const repository = createRepository([target]);

    const result = await resetUserPassword(
      admin,
      target.id,
      "Nova-Senha-2026!",
      repository,
    );

    expect(await verifyPassword("Nova-Senha-2026!", repository.records[0]!.passwordHash)).toBe(true);
    expect(repository.deletedSessionUserIds).toEqual([target.id]);
    expect(result).not.toHaveProperty("passwordHash");
  });
});

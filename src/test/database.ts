import type { Conversation, User } from "@/generated/prisma/client";
import { UserRole } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";

function assertDedicatedTestDatabase(): void {
  const databaseUrl = process.env.DATABASE_URL;
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;

  if (
    process.env.NODE_ENV !== "test" ||
    !databaseUrl ||
    !testDatabaseUrl ||
    databaseUrl !== testDatabaseUrl
  ) {
    throw new Error("Refusing to reset a non-test database");
  }

  try {
    const databaseName = decodeURIComponent(new URL(databaseUrl).pathname).slice(
      1,
    );

    if (!databaseName.endsWith("_test")) {
      throw new Error("Refusing to reset a non-test database");
    }
  } catch {
    throw new Error("Refusing to reset a non-test database");
  }
}

export async function resetTestDatabase(): Promise<void> {
  assertDedicatedTestDatabase();

  await prisma.$transaction([
    prisma.contactMessagingRestrictionEvent.deleteMany(),
    prisma.conversationResumption.deleteMany(),
    prisma.whatsAppTemplateAssignment.deleteMany(),
    prisma.whatsAppTemplate.deleteMany(),
    prisma.metaConnectionAttempt.deleteMany(),
    prisma.metaOperationalAlert.deleteMany(),
    prisma.metaHealthSnapshot.deleteMany(),
    prisma.conversationRead.deleteMany(),
    prisma.whatsAppReadSync.deleteMany(),
    prisma.message.deleteMany(),
    prisma.mediaObject.deleteMany(),
    prisma.conversation.deleteMany(),
    prisma.contact.deleteMany(),
    prisma.whatsAppAppContact.deleteMany(),
    prisma.session.deleteMany(),
    prisma.webhookEvent.deleteMany(),
    prisma.user.deleteMany(),
    prisma.whatsAppPolicyConfiguration.deleteMany(),
    prisma.whatsAppPolicyConfiguration.create({
      data: { id: 1 },
    }),
  ]);
}

export async function seedReadFixture(): Promise<{
  conversation: Conversation;
  victor: User;
  marcos: User;
}> {
  const [victor, marcos] = await Promise.all([
    prisma.user.create({
      data: {
        name: "Victor",
        email: "victor.fixture@example.test",
        passwordHash: "not-used-by-this-fixture",
        role: UserRole.ADMIN,
      },
    }),
    prisma.user.create({
      data: {
        name: "Marcos",
        email: "marcos.fixture@example.test",
        passwordHash: "not-used-by-this-fixture",
        role: UserRole.ATTENDANT,
      },
    }),
  ]);
  const contact = await prisma.contact.create({
    data: {
      whatsappId: "5511999990000",
      phone: "+55 11 99999-0000",
      name: "Contato de teste",
    },
  });
  const conversation = await prisma.conversation.create({
    data: {
      contactId: contact.id,
      lastMessageAt: new Date(0),
    },
  });

  return { conversation, victor, marcos };
}

import "dotenv/config";

import { pathToFileURL } from "node:url";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";
import {
  MediaStatus,
  MessageDirection,
  MessageStatus,
  MessageType,
  UserRole,
} from "../src/generated/prisma/enums";
import { hashPassword } from "../src/modules/auth/password";

// Credencial exclusiva de desenvolvimento; remova-a antes de habilitar a Meta.
export const DEMO_PASSWORD = "Senha-Demo-2026!";

const ids = {
  clienteType: "10000000-0000-4000-8000-000000000001",
  interessadoType: "10000000-0000-4000-8000-000000000002",
  fornecedorParceiroType: "10000000-0000-4000-8000-000000000003",
  naoClienteType: "10000000-0000-4000-8000-000000000004",
  victor: "00000000-0000-4000-8000-000000000001",
  marcos: "00000000-0000-4000-8000-000000000002",
  joao: "00000000-0000-4000-8000-000000000003",
  carlos: "00000000-0000-4000-8000-000000000101",
  maria: "00000000-0000-4000-8000-000000000102",
  pedro: "00000000-0000-4000-8000-000000000103",
  carlosConversation: "00000000-0000-4000-8000-000000000201",
  mariaConversation: "00000000-0000-4000-8000-000000000202",
  pedroConversation: "00000000-0000-4000-8000-000000000203",
  carlosText: "00000000-0000-4000-8000-000000000301",
  carlosReply: "00000000-0000-4000-8000-000000000302",
  carlosImage: "00000000-0000-4000-8000-000000000303",
  mariaText: "00000000-0000-4000-8000-000000000304",
  mariaReply: "00000000-0000-4000-8000-000000000305",
  mariaDocument: "00000000-0000-4000-8000-000000000306",
  pedroText: "00000000-0000-4000-8000-000000000307",
  pedroReply: "00000000-0000-4000-8000-000000000308",
  pedroAudio: "00000000-0000-4000-8000-000000000309",
  image: "00000000-0000-4000-8000-000000000401",
  document: "00000000-0000-4000-8000-000000000402",
  audio: "00000000-0000-4000-8000-000000000403",
} as const;

const date = (value: string): Date => new Date(value);

export async function seedDemoData(prisma: PrismaClient): Promise<void> {
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  await prisma.$transaction(async (prisma) => {
    const initialSharedStateConversationIds = new Set<string>();

    const contactTypes = [
      {
        id: ids.clienteType,
        displayName: "Cliente",
        normalizedName: "cliente",
        color: "#176B52",
        position: 10,
        active: true,
      },
      {
        id: ids.interessadoType,
        displayName: "Interessado",
        normalizedName: "interessado",
        color: "#2563EB",
        position: 20,
        active: true,
      },
      {
        id: ids.fornecedorParceiroType,
        displayName: "Fornecedor/Parceiro",
        normalizedName: "fornecedor/parceiro",
        color: "#B7791F",
        position: 30,
        active: true,
      },
      {
        id: ids.naoClienteType,
        displayName: "Não cliente",
        normalizedName: "não cliente",
        color: "#6D746F",
        position: 40,
        active: true,
      },
    ];

    await prisma.contactType.createMany({
      data: contactTypes,
      skipDuplicates: true,
    });

    const users = [
      {
        id: ids.victor,
        name: "Victor",
        email: "victor@xpatendimento.local",
        role: UserRole.ADMIN,
      },
      {
        id: ids.marcos,
        name: "Marcos",
        email: "marcos@xpatendimento.local",
        role: UserRole.ATTENDANT,
      },
      {
        id: ids.joao,
        name: "João",
        email: "joao@xpatendimento.local",
        role: UserRole.ATTENDANT,
      },
    ];

    for (const user of users) {
      await prisma.user.createMany({
        data: [{ ...user, passwordHash, active: true }],
        skipDuplicates: true,
      });
    }

    const contacts = [
      {
        id: ids.carlos,
        whatsappId: "5511987651001",
        phone: "+55 11 98765-1001",
        name: "Carlos",
      },
      {
        id: ids.maria,
        whatsappId: "5511987651002",
        phone: "+55 11 98765-1002",
        name: "Maria",
      },
      {
        id: ids.pedro,
        whatsappId: "5511987651003",
        phone: "+55 11 98765-1003",
        name: "Pedro",
      },
    ];

    for (const contact of contacts) {
      await prisma.contact.createMany({
        data: [contact],
        skipDuplicates: true,
      });
    }

    const conversations = [
      {
        id: ids.carlosConversation,
        contactId: ids.carlos,
        responsibleUserId: ids.marcos,
        lastMessageAt: date("2026-08-18T14:12:00.000Z"),
      },
      {
        id: ids.mariaConversation,
        contactId: ids.maria,
        responsibleUserId: ids.joao,
        lastMessageAt: date("2026-08-18T15:25:00.000Z"),
      },
      {
        id: ids.pedroConversation,
        contactId: ids.pedro,
        responsibleUserId: ids.victor,
        lastMessageAt: date("2026-08-18T16:42:00.000Z"),
      },
    ];

    for (const conversation of conversations) {
      const existingConversation = await prisma.conversation.findUnique({
        where: { contactId: conversation.contactId },
        select: {
          id: true,
          teamLastReadMessageId: true,
          teamLastReadAt: true,
          manualUnreadAt: true,
          manualUnreadByUserId: true,
          awaitingResponseSince: true,
          _count: { select: { messages: true, reads: true } },
        },
      });

      if (
        !existingConversation ||
        (existingConversation._count.messages === 0 &&
          existingConversation._count.reads === 0 &&
          existingConversation.teamLastReadMessageId === null &&
          existingConversation.teamLastReadAt === null &&
          existingConversation.manualUnreadAt === null &&
          existingConversation.manualUnreadByUserId === null &&
          existingConversation.awaitingResponseSince === null)
      ) {
        initialSharedStateConversationIds.add(conversation.id);
      }
    }

    await prisma.conversation.createMany({
      data: conversations,
      skipDuplicates: true,
    });

    const media = [
      {
        id: ids.image,
        storageProvider: "local",
        storageKey: "demo/carlos-tv-danificada.jpg",
        originalFilename: "tv-danificada.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 248_320n,
        sha256:
          "85e9d67fa1c7428519f980f696306183f726c03b6eb986a981fcabd824127759",
        metaMediaId: "demo-media-image-carlos",
        status: MediaStatus.AVAILABLE,
      },
      {
        id: ids.document,
        storageProvider: "local",
        storageKey: "demo/maria-nota-fiscal.pdf",
        originalFilename: "nota-fiscal.pdf",
        mimeType: "application/pdf",
        sizeBytes: 96_512n,
        sha256:
          "1496f529bcea8e492c9c0b586814f857be4a2ea0f7908fcdeaf6e6a8ce715ff9",
        metaMediaId: "demo-media-document-maria",
        status: MediaStatus.AVAILABLE,
      },
      {
        id: ids.audio,
        storageProvider: "local",
        storageKey: "demo/pedro-audio-fone.ogg",
        originalFilename: "audio-fone.ogg",
        mimeType: "audio/ogg",
        sizeBytes: 41_216n,
        sha256:
          "6f27a47fdf75629c54e0de41ddf278595f6562cc2b5fe857ed1d89cecbfa746f",
        metaMediaId: "demo-media-audio-pedro",
        status: MediaStatus.AVAILABLE,
      },
    ];

    for (const mediaObject of media) {
      await prisma.mediaObject.createMany({
        data: [mediaObject],
        skipDuplicates: true,
      });
    }

    const messages = [
      {
        id: ids.carlosText,
        conversationId: ids.carlosConversation,
        whatsappMessageId: "demo-carlos-in-1",
        direction: MessageDirection.INBOUND,
        type: MessageType.TEXT,
        body: "Minha TV 4K chegou, mas a tela está com uma faixa escura.",
        status: MessageStatus.RECEIVED,
        externalTimestamp: date("2026-08-18T14:05:00.000Z"),
      },
      {
        id: ids.carlosReply,
        conversationId: ids.carlosConversation,
        whatsappMessageId: "demo-carlos-out-1",
        clientRequestId: "00000000-0000-4000-8000-000000000501",
        direction: MessageDirection.OUTBOUND,
        type: MessageType.TEXT,
        body: "Olá, Carlos. Pode nos enviar uma foto para avaliarmos a troca?",
        sentByUserId: ids.marcos,
        status: MessageStatus.DELIVERED,
        externalTimestamp: date("2026-08-18T14:08:00.000Z"),
      },
      {
        id: ids.carlosImage,
        conversationId: ids.carlosConversation,
        whatsappMessageId: "demo-carlos-in-2",
        direction: MessageDirection.INBOUND,
        type: MessageType.IMAGE,
        body: "Esta é a faixa que aparece na tela.",
        mediaObjectId: ids.image,
        status: MessageStatus.RECEIVED,
        externalTimestamp: date("2026-08-18T14:12:00.000Z"),
      },
      {
        id: ids.mariaText,
        conversationId: ids.mariaConversation,
        whatsappMessageId: "demo-maria-in-1",
        direction: MessageDirection.INBOUND,
        type: MessageType.TEXT,
        body: "O notebook novo descarrega em menos de duas horas.",
        status: MessageStatus.RECEIVED,
        externalTimestamp: date("2026-08-18T15:16:00.000Z"),
      },
      {
        id: ids.mariaReply,
        conversationId: ids.mariaConversation,
        whatsappMessageId: "demo-maria-out-1",
        clientRequestId: "00000000-0000-4000-8000-000000000502",
        direction: MessageDirection.OUTBOUND,
        type: MessageType.TEXT,
        body: "Maria, vou conferir a garantia. Você pode enviar a nota fiscal?",
        sentByUserId: ids.joao,
        status: MessageStatus.READ,
        externalTimestamp: date("2026-08-18T15:20:00.000Z"),
      },
      {
        id: ids.mariaDocument,
        conversationId: ids.mariaConversation,
        whatsappMessageId: "demo-maria-in-2",
        direction: MessageDirection.INBOUND,
        type: MessageType.DOCUMENT,
        body: "Segue a nota fiscal do notebook.",
        mediaObjectId: ids.document,
        status: MessageStatus.RECEIVED,
        externalTimestamp: date("2026-08-18T15:25:00.000Z"),
      },
      {
        id: ids.pedroText,
        conversationId: ids.pedroConversation,
        whatsappMessageId: "demo-pedro-in-1",
        direction: MessageDirection.INBOUND,
        type: MessageType.TEXT,
        body: "Meu fone Bluetooth fica desconectando do celular.",
        status: MessageStatus.RECEIVED,
        externalTimestamp: date("2026-08-18T16:34:00.000Z"),
      },
      {
        id: ids.pedroReply,
        conversationId: ids.pedroConversation,
        whatsappMessageId: "demo-pedro-out-1",
        clientRequestId: "00000000-0000-4000-8000-000000000503",
        direction: MessageDirection.OUTBOUND,
        type: MessageType.TEXT,
        body: "Pedro, grave um áudio mostrando o aviso que o aparelho emite.",
        sentByUserId: ids.victor,
        status: MessageStatus.SENT,
        externalTimestamp: date("2026-08-18T16:38:00.000Z"),
      },
      {
        id: ids.pedroAudio,
        conversationId: ids.pedroConversation,
        whatsappMessageId: "demo-pedro-in-2",
        direction: MessageDirection.INBOUND,
        type: MessageType.AUDIO,
        mediaObjectId: ids.audio,
        status: MessageStatus.RECEIVED,
        externalTimestamp: date("2026-08-18T16:42:00.000Z"),
      },
    ];

    for (const message of messages) {
      await prisma.message.createMany({
        data: [message],
        skipDuplicates: true,
      });
    }

    const reads = [
      {
        conversationId: ids.carlosConversation,
        userId: ids.victor,
        lastReadMessageId: ids.carlosImage,
        lastReadAt: date("2026-08-18T14:13:00.000Z"),
      },
      {
        conversationId: ids.carlosConversation,
        userId: ids.marcos,
        lastReadMessageId: ids.carlosText,
        lastReadAt: date("2026-08-18T14:06:00.000Z"),
      },
      {
        conversationId: ids.mariaConversation,
        userId: ids.joao,
        lastReadMessageId: ids.mariaReply,
        lastReadAt: date("2026-08-18T15:21:00.000Z"),
      },
      {
        conversationId: ids.pedroConversation,
        userId: ids.victor,
        lastReadMessageId: ids.pedroText,
        lastReadAt: date("2026-08-18T16:35:00.000Z"),
      },
    ];

    for (const read of reads) {
      await prisma.conversationRead.createMany({
        data: [read],
        skipDuplicates: true,
      });
    }

    const initialSharedState = [
      {
        conversationId: ids.carlosConversation,
        teamLastReadMessageId: ids.carlosImage,
        teamLastReadAt: date("2026-08-18T14:13:00.000Z"),
        awaitingResponseSince: date("2026-08-18T14:12:00.000Z"),
      },
      {
        conversationId: ids.mariaConversation,
        teamLastReadMessageId: ids.mariaReply,
        teamLastReadAt: date("2026-08-18T15:21:00.000Z"),
        awaitingResponseSince: date("2026-08-18T15:25:00.000Z"),
      },
      {
        conversationId: ids.pedroConversation,
        teamLastReadMessageId: ids.pedroText,
        teamLastReadAt: date("2026-08-18T16:35:00.000Z"),
        awaitingResponseSince: date("2026-08-18T16:42:00.000Z"),
      },
    ];

    for (const sharedState of initialSharedState) {
      if (!initialSharedStateConversationIds.has(sharedState.conversationId)) {
        continue;
      }

      await prisma.conversation.updateMany({
        where: {
          id: sharedState.conversationId,
          teamLastReadMessageId: null,
          teamLastReadAt: null,
          manualUnreadAt: null,
          manualUnreadByUserId: null,
          awaitingResponseSince: null,
        },
        data: {
          teamLastReadMessageId: sharedState.teamLastReadMessageId,
          teamLastReadAt: sharedState.teamLastReadAt,
          awaitingResponseSince: sharedState.awaitingResponseSince,
        },
      });
    }
  });
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is required to seed the database");
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });

  try {
    await seedDemoData(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

const isMainModule =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  main().catch((error: unknown) => {
    const message =
      error instanceof Error ? error.message : "Unknown seed error";
    process.stderr.write(`Seed failed: ${message}\n`);
    process.exitCode = 1;
  });
}

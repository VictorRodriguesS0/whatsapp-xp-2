import "server-only";

import { z } from "zod";

import { HttpError } from "@/lib/http";
import { getWhatsAppProvider } from "@/modules/whatsapp/factory";
import { WhatsAppProviderError } from "@/modules/whatsapp/meta-provider";

import { isSingleEmoji } from "./emoji";
import { prismaReactionRepository } from "./repository";
import type {
  BusinessReactionRecord,
  ReactionMutationDto,
  ReactionProvider,
  ReactionRepository,
  ReactionTargetRecord,
} from "./types";

const uuidSchema = z.string().uuid();

export const reactionInputSchema = z.object({
  emoji: z.string().max(64).refine((value) => value === "" || isSingleEmoji(value), {
    message: "Informe um único emoji",
  }),
  clientRequestId: uuidSchema,
}).strict();

export type ReactionInput = z.infer<typeof reactionInputSchema>;

export type ReactionServiceDependencies = {
  repository: ReactionRepository;
  provider: ReactionProvider;
  now?: () => Date;
  inFlight?: Map<string, Promise<ReactionMutationDto>>;
};

const defaultInFlight = new Map<string, Promise<ReactionMutationDto>>();
const defaultDependencies: ReactionServiceDependencies = {
  repository: prismaReactionRepository,
  provider: getWhatsAppProvider(),
  inFlight: defaultInFlight,
};
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1_000;

function toMutationDto(
  reaction: BusinessReactionRecord,
  overrides: Partial<Pick<ReactionMutationDto, "emoji" | "status" | "removed">> = {},
): ReactionMutationDto {
  return {
    id: reaction.id,
    messageId: reaction.messageId,
    reactor: "BUSINESS",
    emoji: overrides.emoji ?? reaction.emoji,
    status: overrides.status ?? reaction.status,
    removed: overrides.removed ?? false,
    sentBy: reaction.sentByUser,
  };
}

function assertEligibleTarget(target: ReactionTargetRecord, now: Date): asserts target is ReactionTargetRecord & {
  whatsappMessageId: string;
} {
  if (!target.whatsappMessageId) {
    throw new HttpError(409, "Esta mensagem ainda não pode receber reação");
  }
  if (!target.contactPhone) {
    throw new HttpError(409, "Contato sem telefone disponível");
  }
  if (target.externalTimestamp.getTime() < now.getTime() - THIRTY_DAYS_MS) {
    throw new HttpError(409, "A Meta permite reagir somente a mensagens dos últimos 30 dias");
  }
  if (target.revokedAt) {
    throw new HttpError(409, "Não é possível reagir a uma mensagem apagada");
  }
  if (target.isReactionMessage) {
    throw new HttpError(409, "Não é possível reagir a outra reação");
  }
}

async function setBusinessReactionOnce(
  actorId: string,
  messageId: string,
  input: ReactionInput,
  dependencies: ReactionServiceDependencies,
): Promise<ReactionMutationDto> {
  const repository = dependencies.repository;
  const clock = dependencies.now ?? (() => new Date());
  const actor = await repository.findActiveUser(actorId);
  if (!actor) throw new HttpError(403, "Usuário inativo ou sem acesso");

  const target = await repository.findTarget(messageId);
  if (!target) throw new HttpError(404, "Mensagem não encontrada");
  assertEligibleTarget(target, clock());

  const beginning = await repository.beginBusinessReaction({
    messageId,
    actorId: actor.id,
    actorName: actor.name,
    requestedEmoji: input.emoji,
    clientRequestId: input.clientRequestId,
  });
  if (beginning.kind === "EXISTING") return toMutationDto(beginning.reaction, {
    removed: beginning.reaction.emoji === "" && beginning.reaction.status === "SENT",
  });
  if (beginning.kind === "BUSY") {
    throw new HttpError(409, "Já existe uma reação sendo enviada para esta mensagem");
  }

  const { reaction, providerEmoji } = beginning;
  const attemptedAt = clock();
  const ownsAttempt = await repository.markProviderAttempt(
    reaction.id,
    input.clientRequestId,
    attemptedAt,
  );
  if (!ownsAttempt) throw new HttpError(409, "A reação foi atualizada por outra operação");

  try {
    const result = await dependencies.provider.sendReaction({
      to: target.contactPhone,
      targetWhatsappMessageId: target.whatsappMessageId,
      emoji: providerEmoji,
    });
    if (providerEmoji === "") {
      const removed = await repository.confirmRemoval(reaction.id, input.clientRequestId);
      if (!removed) throw new HttpError(409, "A reação foi atualizada por outra operação");
      return toMutationDto(reaction, { emoji: "", status: "SENT", removed: true });
    }
    const sent = await repository.markSent(reaction.id, input.clientRequestId, result.whatsappMessageId);
    if (!sent) throw new HttpError(409, "A reação foi atualizada por outra operação");
    return toMutationDto(sent);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    const rejected = error instanceof WhatsAppProviderError && error.kind === "rejected";
    const status = rejected ? "FAILED" : "OUTCOME_UNKNOWN";
    const failureReason = rejected ? "A Meta rejeitou a reação" : null;
    const failed = await repository.markFailed(
      reaction.id,
      input.clientRequestId,
      status,
      failureReason,
    );
    return toMutationDto(failed ?? { ...reaction, status, failureReason });
  }
}

export function setBusinessReaction(
  actorId: string,
  messageId: string,
  input: ReactionInput,
  dependencies: ReactionServiceDependencies = defaultDependencies,
): Promise<ReactionMutationDto> {
  const parsedActorId = uuidSchema.parse(actorId);
  const parsedMessageId = uuidSchema.parse(messageId);
  const parsedInput = reactionInputSchema.parse(input);
  const inFlight = dependencies.inFlight ?? defaultInFlight;
  const operationKey = `${parsedActorId}:${parsedMessageId}:${parsedInput.clientRequestId}`;
  const existing = inFlight.get(operationKey);
  if (existing) return existing;

  const operation = setBusinessReactionOnce(
    parsedActorId,
    parsedMessageId,
    parsedInput,
    dependencies,
  ).finally(() => {
    if (inFlight.get(operationKey) === operation) inFlight.delete(operationKey);
  });
  inFlight.set(operationKey, operation);
  return operation;
}

export async function retryBusinessReaction(
  actorId: string,
  reactionId: string,
  input: { clientRequestId: string },
  dependencies: ReactionServiceDependencies = defaultDependencies,
): Promise<ReactionMutationDto> {
  const parsedReactionId = uuidSchema.parse(reactionId);
  const parsedClientRequestId = uuidSchema.parse(input.clientRequestId);
  const current = await dependencies.repository.findBusinessReactionById(parsedReactionId);
  if (!current) throw new HttpError(404, "Reação não encontrada");
  if (current.status !== "FAILED" && current.status !== "OUTCOME_UNKNOWN") {
    throw new HttpError(409, "Esta reação não precisa ser reenviada");
  }
  return setBusinessReaction(
    actorId,
    current.messageId,
    { emoji: current.emoji, clientRequestId: parsedClientRequestId },
    dependencies,
  );
}

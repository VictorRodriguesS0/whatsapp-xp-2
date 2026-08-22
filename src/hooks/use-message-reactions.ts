"use client";

import { useCallback, useRef, useState } from "react";

import { publicErrorMessage } from "@/lib/public-error";
import type { MessageDto, ReactionDto } from "@/modules/conversations/types";
import type { ReactionMutationDto } from "@/modules/reactions/types";

type MutationState = { pending: boolean; error: string | null };
type Options = {
  actor: { id: string; name: string };
  getActiveConversationId(): string | null;
  getMessage(messageId: string): MessageDto | null;
  replaceReactions(messageId: string, reactions: ReactionDto[]): void;
};

type ApiEnvelope = {
  data: ReactionMutationDto | null;
  error: { message?: string } | null;
};

function upsertBusinessReaction(reactions: ReactionDto[], reaction: ReactionDto | null) {
  const retained = reactions.filter(({ reactor }) => reactor !== "BUSINESS");
  return reaction ? [...retained, reaction] : retained;
}

export function useMessageReactions(options: Options) {
  const [states, setStates] = useState<Record<string, MutationState>>({});
  const inFlight = useRef(new Map<string, Promise<ReactionMutationDto | null>>());

  const setState = useCallback((messageId: string, state: MutationState) => {
    setStates((current) => ({ ...current, [messageId]: state }));
  }, []);

  const mutate = useCallback((
    messageId: string,
    previous: ReactionDto[],
    conversationId: string,
    request: () => Promise<Response>,
  ) => {
    const currentOperation = inFlight.current.get(messageId);
    if (currentOperation) return currentOperation;

    const operation = (async () => {
      try {
        const response = await request();
        const payload = await response.json() as ApiEnvelope;
        if (!response.ok || !payload.data) throw new Error("reaction_request_failed");
        if (options.getActiveConversationId() !== conversationId) return payload.data;

        if (payload.data.status === "FAILED") {
          options.replaceReactions(messageId, previous);
          setState(messageId, { pending: false, error: publicErrorMessage("reaction") });
          return payload.data;
        }
        const next = payload.data.removed
          ? null
          : {
              id: payload.data.id,
              reactor: payload.data.reactor,
              emoji: payload.data.emoji,
              status: payload.data.status,
              sentBy: payload.data.sentBy,
            } satisfies ReactionDto;
        options.replaceReactions(messageId, upsertBusinessReaction(previous, next));
        setState(messageId, {
          pending: false,
          error: payload.data.status === "OUTCOME_UNKNOWN"
            ? publicErrorMessage("reaction-unknown")
            : null,
        });
        return payload.data;
      } catch {
        if (options.getActiveConversationId() === conversationId) {
          options.replaceReactions(messageId, previous);
          setState(messageId, { pending: false, error: publicErrorMessage("reaction") });
        }
        return null;
      } finally {
        inFlight.current.delete(messageId);
        setStates((current) => ({
          ...current,
          [messageId]: { ...(current[messageId] ?? { error: null }), pending: false },
        }));
      }
    })();
    inFlight.current.set(messageId, operation);
    return operation;
  }, [options, setState]);

  const react = useCallback((messageId: string, emoji: string) => {
    const existingOperation = inFlight.current.get(messageId);
    if (existingOperation) return existingOperation;
    const conversationId = options.getActiveConversationId();
    const message = options.getMessage(messageId);
    if (!conversationId || !message) return Promise.resolve(null);
    const previous = message.reactions;
    const currentBusiness = previous.find(({ reactor }) => reactor === "BUSINESS");
    const removing = currentBusiness?.emoji === emoji;
    const optimistic = removing
      ? null
      : {
          id: currentBusiness?.id ?? `optimistic:${crypto.randomUUID()}`,
          reactor: "BUSINESS" as const,
          emoji,
          status: "PENDING" as const,
          sentBy: options.actor,
        };
    options.replaceReactions(messageId, upsertBusinessReaction(previous, optimistic));
    setState(messageId, { pending: true, error: null });
    const clientRequestId = crypto.randomUUID();
    return mutate(messageId, previous, conversationId, () => fetch(`/api/messages/${messageId}/reaction`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emoji, clientRequestId }),
    }));
  }, [mutate, options, setState]);

  const retry = useCallback((messageId: string, reactionId: string) => {
    const existingOperation = inFlight.current.get(messageId);
    if (existingOperation) return existingOperation;
    const conversationId = options.getActiveConversationId();
    const message = options.getMessage(messageId);
    if (!conversationId || !message) return Promise.resolve(null);
    const previous = message.reactions;
    setState(messageId, { pending: true, error: null });
    const clientRequestId = crypto.randomUUID();
    return mutate(messageId, previous, conversationId, () => fetch(`/api/reactions/${reactionId}/retry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientRequestId }),
    }));
  }, [mutate, options, setState]);

  const stateFor = useCallback((messageId: string): MutationState => (
    states[messageId] ?? { pending: false, error: null }
  ), [states]);

  return { react, retry, stateFor };
}

import { z } from "zod";

import { requireUser } from "@/modules/auth/guards";
import { conversationIdSchema } from "@/modules/conversations/schemas";
import { loadMessageContext } from "@/modules/message-search/service";

import {
  conversationErrorResponse,
  conversationSuccessResponse,
} from "../../../../route";

export const runtime = "nodejs";

const messageIdSchema = z.uuid();
type RouteContext = { params: Promise<{ id: string; messageId: string }> };
type Dependencies = {
  requireUser: typeof requireUser;
  loadMessageContext: typeof loadMessageContext;
};

const defaults: Dependencies = { requireUser, loadMessageContext };

export function createMessageContextRouteHandlers(overrides: Partial<Dependencies> = {}) {
  const dependencies = { ...defaults, ...overrides };
  return {
    GET: async (_request: Request, context: RouteContext): Promise<Response> => {
      try {
        const actor = await dependencies.requireUser();
        const params = await context.params;
        const conversationId = conversationIdSchema.parse(params.id);
        const messageId = messageIdSchema.parse(params.messageId);
        return conversationSuccessResponse(
          await dependencies.loadMessageContext(actor.id, conversationId, messageId),
        );
      } catch (error) {
        return conversationErrorResponse(error);
      }
    },
  };
}

export const GET = createMessageContextRouteHandlers().GET;

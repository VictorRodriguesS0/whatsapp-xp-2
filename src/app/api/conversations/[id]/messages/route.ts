import { requireUser } from "@/modules/auth/guards";
import { conversationIdSchema } from "@/modules/conversations/schemas";
import { getConversation } from "@/modules/conversations/service";

import {
  conversationErrorResponse,
  conversationSuccessResponse,
} from "../../route";

export const runtime = "nodejs";

type ConversationMessagesRouteDependencies = {
  requireUser: typeof requireUser;
  getConversation: typeof getConversation;
};

type RouteContext = { params: Promise<{ id: string }> };

const defaultDependencies: ConversationMessagesRouteDependencies = {
  requireUser,
  getConversation,
};

export function createConversationMessagesRouteHandlers(
  dependencies: ConversationMessagesRouteDependencies = defaultDependencies,
) {
  return {
    GET: async (_request: Request, context: RouteContext): Promise<Response> => {
      try {
        const actor = await dependencies.requireUser();
        const { id } = await context.params;
        const parsedId = conversationIdSchema.parse(id);
        const conversation = await dependencies.getConversation(actor.id, parsedId);
        return conversationSuccessResponse(conversation);
      } catch (error) {
        return conversationErrorResponse(error);
      }
    },
  };
}

export const GET = createConversationMessagesRouteHandlers().GET;

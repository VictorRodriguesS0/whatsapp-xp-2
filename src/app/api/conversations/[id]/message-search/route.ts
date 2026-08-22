import { requireUser } from "@/modules/auth/guards";
import { conversationIdSchema } from "@/modules/conversations/schemas";
import { messageSearchSchema } from "@/modules/message-search/schemas";
import { searchConversationMessages } from "@/modules/message-search/service";

import {
  conversationErrorResponse,
  conversationSuccessResponse,
} from "../../route";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };
type Dependencies = {
  requireUser: typeof requireUser;
  searchConversationMessages: typeof searchConversationMessages;
};

const defaults: Dependencies = { requireUser, searchConversationMessages };

function scalarSearchParams(url: URL): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of url.searchParams) {
    if (values[key] !== undefined) throw new SyntaxError("Duplicate parameter");
    values[key] = value;
  }
  return values;
}

export function createConversationMessageSearchRouteHandlers(overrides: Partial<Dependencies> = {}) {
  const dependencies = { ...defaults, ...overrides };
  return {
    GET: async (request: Request, context: RouteContext): Promise<Response> => {
      try {
        const actor = await dependencies.requireUser();
        const conversationId = conversationIdSchema.parse((await context.params).id);
        const input = messageSearchSchema.parse(scalarSearchParams(new URL(request.url)));
        return conversationSuccessResponse(
          await dependencies.searchConversationMessages(actor.id, conversationId, input),
        );
      } catch (error) {
        return conversationErrorResponse(error);
      }
    },
  };
}

export const GET = createConversationMessageSearchRouteHandlers().GET;

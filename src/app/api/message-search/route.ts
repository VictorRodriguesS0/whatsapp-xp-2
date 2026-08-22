import { requireUser } from "@/modules/auth/guards";
import { messageSearchSchema } from "@/modules/message-search/schemas";
import { searchMessages } from "@/modules/message-search/service";

import {
  conversationErrorResponse,
  conversationSuccessResponse,
} from "../conversations/route";

export const runtime = "nodejs";

type Dependencies = {
  requireUser: typeof requireUser;
  searchMessages: typeof searchMessages;
};

const defaults: Dependencies = { requireUser, searchMessages };

function scalarSearchParams(url: URL): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of url.searchParams) {
    if (values[key] !== undefined) throw new SyntaxError("Duplicate parameter");
    values[key] = value;
  }
  return values;
}

export function createMessageSearchRouteHandlers(overrides: Partial<Dependencies> = {}) {
  const dependencies = { ...defaults, ...overrides };
  return {
    GET: async (request: Request): Promise<Response> => {
      try {
        const actor = await dependencies.requireUser();
        const input = messageSearchSchema.parse(scalarSearchParams(new URL(request.url)));
        return conversationSuccessResponse(await dependencies.searchMessages(actor.id, input));
      } catch (error) {
        return conversationErrorResponse(error);
      }
    },
  };
}

export const GET = createMessageSearchRouteHandlers().GET;

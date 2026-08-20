import { assertSameOrigin, requireUser } from "@/modules/auth/guards";
import {
  conversationIdSchema,
  markReadSchema,
} from "@/modules/conversations/schemas";
import { markRead } from "@/modules/conversations/service";
import { publishRealtime } from "@/modules/realtime/hub";

import {
  conversationErrorResponse,
  conversationSuccessResponse,
} from "../../route";

export const runtime = "nodejs";

type ConversationReadRouteDependencies = {
  assertSameOrigin: typeof assertSameOrigin;
  requireUser: typeof requireUser;
  markRead: typeof markRead;
  publishRealtime: typeof publishRealtime;
};

type RouteContext = { params: Promise<{ id: string }> };

const defaultDependencies: ConversationReadRouteDependencies = {
  assertSameOrigin,
  requireUser,
  markRead,
  publishRealtime,
};

export function createConversationReadRouteHandlers(
  dependencies: ConversationReadRouteDependencies = defaultDependencies,
) {
  return {
    POST: async (request: Request, context: RouteContext): Promise<Response> => {
      try {
        dependencies.assertSameOrigin(request);
        const actor = await dependencies.requireUser();
        const { id } = await context.params;
        const parsedId = conversationIdSchema.parse(id);
        const input = markReadSchema.parse(await request.json());
        const read = await dependencies.markRead(actor.id, parsedId, input.messageId);
        dependencies.publishRealtime({
          type: "read.updated",
          conversationId: parsedId,
          userId: actor.id,
        });
        return conversationSuccessResponse(read);
      } catch (error) {
        return conversationErrorResponse(error);
      }
    },
  };
}

export const POST = createConversationReadRouteHandlers().POST;

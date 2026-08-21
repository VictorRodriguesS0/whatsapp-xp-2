import { assertSameOrigin, requireUser } from "@/modules/auth/guards";
import { conversationIdSchema } from "@/modules/conversations/schemas";
import { markSharedUnread } from "@/modules/conversations/shared-state";
import { publishRealtime } from "@/modules/realtime/hub";

import {
  conversationErrorResponse,
  conversationSuccessResponse,
} from "../../route";

export const runtime = "nodejs";

type ConversationUnreadRouteDependencies = {
  assertSameOrigin: typeof assertSameOrigin;
  requireUser: typeof requireUser;
  markSharedUnread: typeof markSharedUnread;
  publishRealtime: typeof publishRealtime;
};

type RouteContext = { params: Promise<{ id: string }> };

const defaultDependencies: ConversationUnreadRouteDependencies = {
  assertSameOrigin,
  requireUser,
  markSharedUnread,
  publishRealtime,
};

export function createConversationUnreadRouteHandlers(
  dependencies: ConversationUnreadRouteDependencies = defaultDependencies,
) {
  return {
    POST: async (request: Request, context: RouteContext): Promise<Response> => {
      try {
        dependencies.assertSameOrigin(request);
        const actor = await dependencies.requireUser();
        const { id } = await context.params;
        const parsedId = conversationIdSchema.parse(id);
        const state = await dependencies.markSharedUnread(actor.id, parsedId);
        dependencies.publishRealtime({
          type: "conversation.updated",
          conversationId: parsedId,
          revision: state.revision,
        });
        return conversationSuccessResponse(state);
      } catch (error) {
        return conversationErrorResponse(error);
      }
    },
  };
}

export const POST = createConversationUnreadRouteHandlers().POST;

import { assertSameOrigin, requireUser } from "@/modules/auth/guards";
import {
  conversationIdSchema,
  pinConversationSchema,
} from "@/modules/conversations/schemas";
import { setConversationPinned } from "@/modules/conversations/service";
import { publishRealtime } from "@/modules/realtime/hub";

import {
  conversationErrorResponse,
  conversationSuccessResponse,
} from "../../route";

export const runtime = "nodejs";

type ConversationPinRouteDependencies = {
  assertSameOrigin: typeof assertSameOrigin;
  requireUser: typeof requireUser;
  setConversationPinned: typeof setConversationPinned;
  publishRealtime: typeof publishRealtime;
};

type RouteContext = { params: Promise<{ id: string }> };

const defaultDependencies: ConversationPinRouteDependencies = {
  assertSameOrigin,
  requireUser,
  setConversationPinned,
  publishRealtime,
};

export function createConversationPinRouteHandlers(
  dependencies: ConversationPinRouteDependencies = defaultDependencies,
) {
  return {
    PATCH: async (request: Request, context: RouteContext): Promise<Response> => {
      try {
        dependencies.assertSameOrigin(request);
        const actor = await dependencies.requireUser();
        const { id } = await context.params;
        const conversationId = conversationIdSchema.parse(id);
        const { pinned } = pinConversationSchema.parse(await request.json());
        const state = await dependencies.setConversationPinned(
          actor.id,
          conversationId,
          pinned,
        );
        dependencies.publishRealtime({
          type: "conversation.updated",
          conversationId,
          revision: state.revision,
        });
        return conversationSuccessResponse(state);
      } catch (error) {
        return conversationErrorResponse(error);
      }
    },
  };
}

export const PATCH = createConversationPinRouteHandlers().PATCH;

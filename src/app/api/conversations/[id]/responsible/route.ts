import { assertSameOrigin, requireUser } from "@/modules/auth/guards";
import {
  conversationIdSchema,
  responsibleSchema,
} from "@/modules/conversations/schemas";
import { setResponsible } from "@/modules/conversations/service";
import { publishRealtime } from "@/modules/realtime/hub";

import {
  conversationErrorResponse,
  conversationSuccessResponse,
} from "../../route";

export const runtime = "nodejs";

type ConversationResponsibleRouteDependencies = {
  assertSameOrigin: typeof assertSameOrigin;
  requireUser: typeof requireUser;
  setResponsible: typeof setResponsible;
  publishRealtime: typeof publishRealtime;
};

type RouteContext = { params: Promise<{ id: string }> };

const defaultDependencies: ConversationResponsibleRouteDependencies = {
  assertSameOrigin,
  requireUser,
  setResponsible,
  publishRealtime,
};

export function createConversationResponsibleRouteHandlers(
  dependencies: ConversationResponsibleRouteDependencies = defaultDependencies,
) {
  return {
    PATCH: async (request: Request, context: RouteContext): Promise<Response> => {
      try {
        dependencies.assertSameOrigin(request);
        const actor = await dependencies.requireUser();
        const { id } = await context.params;
        const parsedId = conversationIdSchema.parse(id);
        const input = responsibleSchema.parse(await request.json());
        const conversation = await dependencies.setResponsible(
          actor,
          parsedId,
          input.userId,
        );
        dependencies.publishRealtime({
          type: "responsible.updated",
          conversationId: parsedId,
        });
        return conversationSuccessResponse(conversation);
      } catch (error) {
        return conversationErrorResponse(error);
      }
    },
  };
}

export const PATCH = createConversationResponsibleRouteHandlers().PATCH;

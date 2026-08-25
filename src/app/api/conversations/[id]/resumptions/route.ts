import { assertSameOrigin, requireUser } from "@/modules/auth/guards";
import { conversationIdSchema } from "@/modules/conversations/schemas";
import { resumeConversationSchema } from "@/modules/resumptions/schemas";
import { resumeConversation } from "@/modules/resumptions/service";

import {
  conversationErrorResponse,
  conversationSuccessResponse,
} from "../../route";

export const runtime = "nodejs";

type ConversationResumptionRouteDependencies = {
  assertSameOrigin: typeof assertSameOrigin;
  requireUser: typeof requireUser;
  resumeConversation: typeof resumeConversation;
};

type RouteContext = { params: Promise<{ id: string }> };

const defaultDependencies: ConversationResumptionRouteDependencies = {
  assertSameOrigin,
  requireUser,
  resumeConversation,
};

export function createConversationResumptionRouteHandlers(
  dependencies: ConversationResumptionRouteDependencies = defaultDependencies,
) {
  return {
    POST: async (request: Request, context: RouteContext): Promise<Response> => {
      try {
        dependencies.assertSameOrigin(request);
        const actor = await dependencies.requireUser();
        const conversationId = conversationIdSchema.parse(
          (await context.params).id,
        );
        const input = resumeConversationSchema.parse(await request.json());
        const result = await dependencies.resumeConversation(
          actor,
          conversationId,
          input,
        );
        return conversationSuccessResponse(result);
      } catch (error) {
        return conversationErrorResponse(error);
      }
    },
  };
}

export const POST = createConversationResumptionRouteHandlers().POST;

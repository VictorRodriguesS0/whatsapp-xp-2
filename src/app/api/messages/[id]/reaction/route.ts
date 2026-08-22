import { z } from "zod";

import { HttpError } from "@/lib/http";
import { assertSameOrigin, requireUser } from "@/modules/auth/guards";
import {
  reactionInputSchema,
  setBusinessReaction,
} from "@/modules/reactions/service";

import {
  conversationErrorResponse,
  conversationSuccessResponse,
} from "../../../conversations/route";

export const runtime = "nodejs";

const messageIdSchema = z.string().uuid();
type RouteContext = { params: Promise<{ id: string }> };
type Dependencies = {
  assertSameOrigin: typeof assertSameOrigin;
  requireUser: typeof requireUser;
  setBusinessReaction: typeof setBusinessReaction;
};

const defaultDependencies: Dependencies = {
  assertSameOrigin,
  requireUser,
  setBusinessReaction,
};

export function createMessageReactionRouteHandlers(
  dependencies: Dependencies = defaultDependencies,
) {
  return {
    PUT: async (request: Request, context: RouteContext): Promise<Response> => {
      try {
        dependencies.assertSameOrigin(request);
        const actor = await dependencies.requireUser();
        const { id } = await context.params;
        const parsedId = messageIdSchema.safeParse(id);
        if (!parsedId.success) throw new HttpError(404, "Mensagem não encontrada");
        const input = reactionInputSchema.parse(await request.json());
        const reaction = await dependencies.setBusinessReaction(actor.id, parsedId.data, input);
        return conversationSuccessResponse(reaction);
      } catch (error) {
        return conversationErrorResponse(error);
      }
    },
  };
}

export const PUT = createMessageReactionRouteHandlers().PUT;

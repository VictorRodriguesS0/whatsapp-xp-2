import { z } from "zod";

import { HttpError } from "@/lib/http";
import { assertSameOrigin, requireUser } from "@/modules/auth/guards";
import { retryBusinessReaction } from "@/modules/reactions/service";

import {
  conversationErrorResponse,
  conversationSuccessResponse,
} from "../../../conversations/route";

export const runtime = "nodejs";

const uuidSchema = z.string().uuid();
const retryInputSchema = z.strictObject({ clientRequestId: uuidSchema });
type RouteContext = { params: Promise<{ id: string }> };
type Dependencies = {
  assertSameOrigin: typeof assertSameOrigin;
  requireUser: typeof requireUser;
  retryBusinessReaction: typeof retryBusinessReaction;
};

const defaultDependencies: Dependencies = {
  assertSameOrigin,
  requireUser,
  retryBusinessReaction,
};

export function createRetryReactionRouteHandlers(
  dependencies: Dependencies = defaultDependencies,
) {
  return {
    POST: async (request: Request, context: RouteContext): Promise<Response> => {
      try {
        dependencies.assertSameOrigin(request);
        const actor = await dependencies.requireUser();
        const { id } = await context.params;
        const parsedId = uuidSchema.safeParse(id);
        if (!parsedId.success) throw new HttpError(404, "Reação não encontrada");
        const input = retryInputSchema.parse(await request.json());
        const reaction = await dependencies.retryBusinessReaction(actor.id, parsedId.data, input);
        return conversationSuccessResponse(reaction);
      } catch (error) {
        return conversationErrorResponse(error);
      }
    },
  };
}

export const POST = createRetryReactionRouteHandlers().POST;

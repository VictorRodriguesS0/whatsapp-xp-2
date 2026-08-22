import { assertSameOrigin, requireUser } from "@/modules/auth/guards";
import { updateQuickReply } from "@/modules/quick-replies/service";

import { quickReplyErrorResponse, quickReplySuccessResponse } from "../route";

export const runtime = "nodejs";

type Dependencies = {
  assertSameOrigin: typeof assertSameOrigin;
  requireUser: typeof requireUser;
  updateQuickReply: typeof updateQuickReply;
};

const defaults: Dependencies = { assertSameOrigin, requireUser, updateQuickReply };
type Context = { params: Promise<{ id: string }> };

export function createQuickReplyItemRouteHandlers(dependencies: Dependencies = defaults) {
  return {
    PATCH: async (request: Request, context: Context): Promise<Response> => {
      try {
        dependencies.assertSameOrigin(request);
        await dependencies.requireUser();
        const { id } = await context.params;
        const result = await dependencies.updateQuickReply(id, await request.json());
        return quickReplySuccessResponse(result);
      } catch (error) { return quickReplyErrorResponse(error); }
    },
  };
}

const handlers = createQuickReplyItemRouteHandlers();
export const PATCH = handlers.PATCH;

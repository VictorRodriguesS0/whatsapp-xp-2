import { assertSameOrigin, requireUser } from "@/modules/auth/guards";
import { retryMessage } from "@/modules/messages/service";
import { toErrorResponse } from "@/lib/http";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };
type RetryRouteDependencies = {
  assertSameOrigin: typeof assertSameOrigin;
  requireUser: typeof requireUser;
  retryMessage: typeof retryMessage;
};

const defaultDependencies: RetryRouteDependencies = {
  assertSameOrigin,
  requireUser,
  retryMessage,
};

export function createRetryMessageRouteHandlers(
  dependencies: RetryRouteDependencies = defaultDependencies,
) {
  return {
    POST: async (request: Request, context: RouteContext): Promise<Response> => {
      try {
        dependencies.assertSameOrigin(request);
        const actor = await dependencies.requireUser();
        const { id } = await context.params;
        const message = await dependencies.retryMessage(actor, id);
        return Response.json({ data: message, error: null });
      } catch (error) {
        return toErrorResponse(error);
      }
    },
  };
}

export const POST = createRetryMessageRouteHandlers().POST;

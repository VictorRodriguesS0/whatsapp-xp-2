import { assertSameOrigin, requireUser } from "@/modules/auth/guards";
import { retryMessage } from "@/modules/messages/service";
import { HttpError, toErrorResponse } from "@/lib/http";
import { messageUuidSchema } from "@/modules/messages/schemas";

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
        const parsed = messageUuidSchema.safeParse(id);
        if (!parsed.success) throw new HttpError(404, "Mensagem não encontrada");
        const message = await dependencies.retryMessage(actor, parsed.data);
        return Response.json({ data: message, error: null });
      } catch (error) {
        return toErrorResponse(error);
      }
    },
  };
}

export const POST = createRetryMessageRouteHandlers().POST;

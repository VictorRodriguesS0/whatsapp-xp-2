import { assertSameOrigin, requireUser } from "@/modules/auth/guards";
import { HttpError, toErrorResponse } from "@/lib/http";
import { recoverMedia } from "@/modules/media/service";
import { messageUuidSchema } from "@/modules/messages/schemas";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };
type RecoverMediaRouteDependencies = {
  assertSameOrigin: typeof assertSameOrigin;
  requireUser: typeof requireUser;
  recoverMedia: typeof recoverMedia;
};

const defaultDependencies: RecoverMediaRouteDependencies = {
  assertSameOrigin,
  requireUser,
  recoverMedia,
};

async function readManual(request: Request): Promise<boolean> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new HttpError(400, "Solicitação inválida");
  }
  if (
    typeof body !== "object" ||
    body === null ||
    !("manual" in body) ||
    typeof body.manual !== "boolean"
  ) {
    throw new HttpError(400, "Solicitação inválida");
  }
  return body.manual;
}

export function createRecoverMediaRouteHandlers(
  dependencies: RecoverMediaRouteDependencies = defaultDependencies,
) {
  return {
    POST: async (request: Request, context: RouteContext): Promise<Response> => {
      try {
        dependencies.assertSameOrigin(request);
        const actor = await dependencies.requireUser();
        const { id } = await context.params;
        const parsed = messageUuidSchema.safeParse(id);
        if (!parsed.success) throw new HttpError(404, "Mídia não encontrada");
        const manual = await readManual(request);
        const state = await dependencies.recoverMedia(actor.id, parsed.data, manual);
        return Response.json({ data: state, error: null });
      } catch (error) {
        return toErrorResponse(error);
      }
    },
  };
}

export const POST = createRecoverMediaRouteHandlers().POST;

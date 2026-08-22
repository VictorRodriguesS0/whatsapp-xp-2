import { HttpError, toErrorResponse } from "@/lib/http";
import { assertSameOrigin, requireUser } from "@/modules/auth/guards";
import {
  QuickReplyConflictError,
  QuickReplyNotFoundError,
  QuickReplyValidationError,
  createQuickReply,
  listQuickReplies,
} from "@/modules/quick-replies/service";

export const runtime = "nodejs";

type Dependencies = {
  assertSameOrigin: typeof assertSameOrigin;
  requireUser: typeof requireUser;
  listQuickReplies: typeof listQuickReplies;
  createQuickReply: typeof createQuickReply;
};

const defaults: Dependencies = { assertSameOrigin, requireUser, listQuickReplies, createQuickReply };

function code(status: number) {
  return ({ 400: "INVALID_INPUT", 401: "UNAUTHORIZED", 403: "FORBIDDEN", 404: "NOT_FOUND", 409: "CONFLICT", 500: "INTERNAL_ERROR" }[status] ?? "REQUEST_FAILED");
}

export async function quickReplyErrorResponse(error: unknown): Promise<Response> {
  let mapped = error;
  if (error instanceof SyntaxError || error instanceof QuickReplyValidationError) mapped = new HttpError(400, "Dados inválidos");
  if (error instanceof QuickReplyConflictError) mapped = new HttpError(409, error.message);
  if (error instanceof QuickReplyNotFoundError) mapped = new HttpError(404, error.message);
  const response = toErrorResponse(mapped);
  const body = await response.json() as { error: string };
  return Response.json({ data: null, error: { code: code(response.status), message: body.error } }, { status: response.status });
}

export function quickReplySuccessResponse<T>(data: T, status = 200) {
  return Response.json({ data, error: null }, { status });
}

export function createQuickRepliesRouteHandlers(dependencies: Dependencies = defaults) {
  return {
    GET: async (request: Request): Promise<Response> => {
      try {
        await dependencies.requireUser();
        const activeOnly = new URL(request.url).searchParams.get("active") === "true";
        const quickReplies = await dependencies.listQuickReplies({ activeOnly });
        return quickReplySuccessResponse({ quickReplies });
      } catch (error) { return quickReplyErrorResponse(error); }
    },
    POST: async (request: Request): Promise<Response> => {
      try {
        dependencies.assertSameOrigin(request);
        await dependencies.requireUser();
        const result = await dependencies.createQuickReply(await request.json());
        return quickReplySuccessResponse(result, 201);
      } catch (error) { return quickReplyErrorResponse(error); }
    },
  };
}

const handlers = createQuickRepliesRouteHandlers();
export const GET = handlers.GET;
export const POST = handlers.POST;

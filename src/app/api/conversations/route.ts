import { ZodError } from "zod";

import { HttpError } from "@/lib/http";
import { requireUser } from "@/modules/auth/guards";
import { conversationListOptionsSchema } from "@/modules/conversations/schemas";
import { listConversations } from "@/modules/conversations/service";

export const runtime = "nodejs";

type ConversationsRouteDependencies = {
  requireUser: typeof requireUser;
  listConversations: typeof listConversations;
};

const defaultDependencies: ConversationsRouteDependencies = {
  requireUser,
  listConversations,
};

function errorCode(status: number): string {
  return (
    {
      400: "INVALID_INPUT",
      401: "UNAUTHORIZED",
      403: "FORBIDDEN",
      404: "NOT_FOUND",
      409: "CONFLICT",
      429: "RATE_LIMITED",
    }[status] ?? "REQUEST_FAILED"
  );
}

export function conversationErrorResponse(error: unknown): Response {
  if (error instanceof ZodError || error instanceof SyntaxError) {
    return Response.json(
      {
        data: null,
        error: { code: "INVALID_INPUT", message: "Dados inválidos" },
      },
      { status: 400 },
    );
  }

  if (error instanceof HttpError) {
    return Response.json(
      {
        data: null,
        error: { code: errorCode(error.status), message: error.message },
      },
      { status: error.status },
    );
  }

  return Response.json(
    {
      data: null,
      error: { code: "INTERNAL_ERROR", message: "Erro interno" },
    },
    { status: 500 },
  );
}

export function conversationSuccessResponse<T>(data: T, status = 200): Response {
  return Response.json({ data, error: null }, { status });
}

export function createConversationsRouteHandlers(
  dependencies: ConversationsRouteDependencies = defaultDependencies,
) {
  return {
    GET: async (request: Request): Promise<Response> => {
      try {
        const actor = await dependencies.requireUser();
        const url = new URL(request.url);
        const rawOptions: Record<string, string | string[]> = {};

        for (const [key, value] of url.searchParams) {
          if (key === "tagIds") {
            const current = rawOptions[key];
            rawOptions[key] = Array.isArray(current)
              ? [...current, value]
              : current === undefined
                ? [value]
                : [current, value];
            continue;
          }

          const current = rawOptions[key];
          rawOptions[key] = current === undefined
            ? value
            : Array.isArray(current)
              ? [...current, value]
              : [current, value];
        }

        const options = conversationListOptionsSchema.parse(rawOptions);
        const result = await dependencies.listConversations(actor.id, options);
        return conversationSuccessResponse(result);
      } catch (error) {
        return conversationErrorResponse(error);
      }
    },
  };
}

export const GET = createConversationsRouteHandlers().GET;

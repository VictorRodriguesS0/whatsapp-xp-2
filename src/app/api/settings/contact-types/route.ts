import { ZodError } from "zod";

import { HttpError, toErrorResponse } from "@/lib/http";
import { assertSameOrigin, requireAdmin } from "@/modules/auth/guards";
import { createContactDefinitionSchema } from "@/modules/contacts/schemas";
import { createContactType, listContactTypes } from "@/modules/contacts/service";
import { publishRealtime } from "@/modules/realtime/hub";

export const runtime = "nodejs";

type ContactTypesRouteDependencies = {
  assertSameOrigin: typeof assertSameOrigin;
  requireAdmin: typeof requireAdmin;
  listContactTypes: typeof listContactTypes;
  createContactType: typeof createContactType;
  publishRealtime: typeof publishRealtime;
};

const defaultDependencies: ContactTypesRouteDependencies = {
  assertSameOrigin,
  requireAdmin,
  listContactTypes,
  createContactType,
  publishRealtime,
};

const routeCreateDefinitionSchema = createContactDefinitionSchema.strict();

function errorCode(status: number): string {
  return (
    {
      400: "INVALID_INPUT",
      401: "UNAUTHORIZED",
      403: "FORBIDDEN",
      404: "NOT_FOUND",
      409: "CONFLICT",
      429: "RATE_LIMITED",
      500: "INTERNAL_ERROR",
    }[status] ?? "REQUEST_FAILED"
  );
}

export async function settingsErrorResponse(error: unknown): Promise<Response> {
  const sanitized = toErrorResponse(
    error instanceof ZodError || error instanceof SyntaxError
      ? new HttpError(400, "Dados inválidos")
      : error,
  );
  const body = (await sanitized.json()) as { error: string };
  return Response.json(
    {
      data: null,
      error: { code: errorCode(sanitized.status), message: body.error },
    },
    { status: sanitized.status },
  );
}

export function settingsSuccessResponse<T>(data: T, status = 200): Response {
  return Response.json({ data, error: null }, { status });
}

export function createContactTypesRouteHandlers(
  dependencies: ContactTypesRouteDependencies = defaultDependencies,
) {
  return {
    GET: async (): Promise<Response> => {
      try {
        const actor = await dependencies.requireAdmin();
        const items = await dependencies.listContactTypes(actor);
        return settingsSuccessResponse({ items });
      } catch (error) {
        return settingsErrorResponse(error);
      }
    },
    POST: async (request: Request): Promise<Response> => {
      try {
        dependencies.assertSameOrigin(request);
        const actor = await dependencies.requireAdmin();
        const input = routeCreateDefinitionSchema.parse(await request.json());
        const definition = await dependencies.createContactType(actor, input);
        dependencies.publishRealtime({ type: "settings.updated", scope: "contact-types" });
        return settingsSuccessResponse(definition, 201);
      } catch (error) {
        return settingsErrorResponse(error);
      }
    },
  };
}

const handlers = createContactTypesRouteHandlers();
export const GET = handlers.GET;
export const POST = handlers.POST;

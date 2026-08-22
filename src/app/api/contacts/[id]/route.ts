import { ZodError } from "zod";

import { HttpError, toErrorResponse } from "@/lib/http";
import { assertSameOrigin, requireUser } from "@/modules/auth/guards";
import { contactIdSchema, updateContactSchema } from "@/modules/contacts/schemas";
import { updateContact } from "@/modules/contacts/service";
import { publishRealtime } from "@/modules/realtime/hub";

export const runtime = "nodejs";

type ContactRouteDependencies = {
  assertSameOrigin: typeof assertSameOrigin;
  requireUser: typeof requireUser;
  updateContact: typeof updateContact;
  publishRealtime: typeof publishRealtime;
};

type RouteContext = { params: Promise<{ id: string }> };

const defaultDependencies: ContactRouteDependencies = {
  assertSameOrigin,
  requireUser,
  updateContact,
  publishRealtime,
};

const routeUpdateContactSchema = updateContactSchema.strict();

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

export async function contactErrorResponse(error: unknown): Promise<Response> {
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

export function contactSuccessResponse<T>(data: T, status = 200): Response {
  return Response.json({ data, error: null }, { status });
}

export function createContactRouteHandlers(
  dependencies: ContactRouteDependencies = defaultDependencies,
) {
  return {
    PATCH: async (request: Request, context: RouteContext): Promise<Response> => {
      try {
        dependencies.assertSameOrigin(request);
        const actor = await dependencies.requireUser();
        const contactId = contactIdSchema.parse((await context.params).id);
        const input = routeUpdateContactSchema.parse(await request.json());
        const contact = await dependencies.updateContact(actor, contactId, input);
        dependencies.publishRealtime({ type: "contact.updated", contactId });
        return contactSuccessResponse(contact);
      } catch (error) {
        return contactErrorResponse(error);
      }
    },
  };
}

export const PATCH = createContactRouteHandlers().PATCH;

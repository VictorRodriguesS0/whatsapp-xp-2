import { ZodError } from "zod";

import { HttpError, toErrorResponse } from "@/lib/http";
import { assertSameOrigin, requireAdmin } from "@/modules/auth/guards";
import { updateUser } from "@/modules/users/service";
import { updateUserSchema, userIdSchema } from "@/modules/users/schemas";
import { publishRealtime } from "@/modules/realtime/hub";

export const runtime = "nodejs";

type UserRouteDependencies = {
  assertSameOrigin: typeof assertSameOrigin;
  requireAdmin: typeof requireAdmin;
  updateUser: typeof updateUser;
  publishRealtime: typeof publishRealtime;
};

type RouteContext = { params: Promise<{ id: string }> };

const defaultDependencies: UserRouteDependencies = {
  assertSameOrigin,
  requireAdmin,
  updateUser,
  publishRealtime,
};

function errorResponse(error: unknown): Response {
  if (error instanceof ZodError || error instanceof SyntaxError) {
    return toErrorResponse(new HttpError(400, "Dados inválidos"));
  }

  return toErrorResponse(error);
}

export function createUserRouteHandlers(
  dependencies: UserRouteDependencies = defaultDependencies,
) {
  return {
    PATCH: async (
      request: Request,
      context: RouteContext,
    ): Promise<Response> => {
      try {
        dependencies.assertSameOrigin(request);
        const actor = await dependencies.requireAdmin();
        const { id } = await context.params;
        const parsedId = userIdSchema.parse(id);
        const input = updateUserSchema.parse(await request.json());
        const user = await dependencies.updateUser(actor, parsedId, input);
        dependencies.publishRealtime({ type: "user.updated", userId: user.id });
        return Response.json({ user });
      } catch (error) {
        return errorResponse(error);
      }
    },
  };
}

export const PATCH = createUserRouteHandlers().PATCH;

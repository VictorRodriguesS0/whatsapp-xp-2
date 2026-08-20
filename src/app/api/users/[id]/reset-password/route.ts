import { ZodError } from "zod";

import { HttpError, toErrorResponse } from "@/lib/http";
import { assertSameOrigin, requireAdmin } from "@/modules/auth/guards";
import { resetUserPassword } from "@/modules/users/service";
import {
  resetUserPasswordSchema,
  userIdSchema,
} from "@/modules/users/schemas";
import { publishRealtime } from "@/modules/realtime/hub";

export const runtime = "nodejs";

type ResetPasswordRouteDependencies = {
  assertSameOrigin: typeof assertSameOrigin;
  requireAdmin: typeof requireAdmin;
  resetUserPassword: typeof resetUserPassword;
  publishRealtime: typeof publishRealtime;
};

type RouteContext = { params: Promise<{ id: string }> };

const defaultDependencies: ResetPasswordRouteDependencies = {
  assertSameOrigin,
  requireAdmin,
  resetUserPassword,
  publishRealtime,
};

function errorResponse(error: unknown): Response {
  if (error instanceof ZodError || error instanceof SyntaxError) {
    return toErrorResponse(new HttpError(400, "Dados inválidos"));
  }

  return toErrorResponse(error);
}

export function createResetPasswordRouteHandlers(
  dependencies: ResetPasswordRouteDependencies = defaultDependencies,
) {
  return {
    POST: async (
      request: Request,
      context: RouteContext,
    ): Promise<Response> => {
      try {
        dependencies.assertSameOrigin(request);
        const actor = await dependencies.requireAdmin();
        const { id } = await context.params;
        const parsedId = userIdSchema.parse(id);
        const { password } = resetUserPasswordSchema.parse(await request.json());
        const user = await dependencies.resetUserPassword(actor, parsedId, password);
        dependencies.publishRealtime({ type: "user.updated", userId: user.id });
        return Response.json({ user });
      } catch (error) {
        return errorResponse(error);
      }
    },
  };
}

export const POST = createResetPasswordRouteHandlers().POST;

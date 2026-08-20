import { ZodError } from "zod";

import { HttpError, toErrorResponse } from "@/lib/http";
import { assertSameOrigin, requireAdmin } from "@/modules/auth/guards";
import {
  createUser,
  listUsers,
} from "@/modules/users/service";
import { createUserSchema } from "@/modules/users/schemas";
import { publishRealtime } from "@/modules/realtime/hub";

export const runtime = "nodejs";

type UsersRouteDependencies = {
  assertSameOrigin: typeof assertSameOrigin;
  requireAdmin: typeof requireAdmin;
  listUsers: typeof listUsers;
  createUser: typeof createUser;
  publishRealtime: typeof publishRealtime;
};

const defaultDependencies: UsersRouteDependencies = {
  assertSameOrigin,
  requireAdmin,
  listUsers,
  createUser,
  publishRealtime,
};

function invalidInputResponse(error: unknown): Response {
  if (error instanceof ZodError || error instanceof SyntaxError) {
    return toErrorResponse(new HttpError(400, "Dados inválidos"));
  }

  return toErrorResponse(error);
}

export function createUsersRouteHandlers(
  dependencies: UsersRouteDependencies = defaultDependencies,
) {
  return {
    GET: async (): Promise<Response> => {
      try {
        const actor = await dependencies.requireAdmin();
        const users = await dependencies.listUsers(actor);
        return Response.json({ users });
      } catch (error) {
        return invalidInputResponse(error);
      }
    },
    POST: async (request: Request): Promise<Response> => {
      try {
        dependencies.assertSameOrigin(request);
        const actor = await dependencies.requireAdmin();
        const input = createUserSchema.parse(await request.json());
        const user = await dependencies.createUser(actor, input);
        dependencies.publishRealtime({ type: "user.updated", userId: user.id });
        return Response.json({ user }, { status: 201 });
      } catch (error) {
        return invalidInputResponse(error);
      }
    },
  };
}

const handlers = createUsersRouteHandlers();

export const GET = handlers.GET;
export const POST = handlers.POST;

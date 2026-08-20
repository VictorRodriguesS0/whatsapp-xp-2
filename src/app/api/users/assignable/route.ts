import { toErrorResponse } from "@/lib/http";
import { requireUser } from "@/modules/auth/guards";
import { listAssignableUsers } from "@/modules/users/service";

export const runtime = "nodejs";

type AssignableUsersRouteDependencies = {
  requireUser: typeof requireUser;
  listAssignableUsers: typeof listAssignableUsers;
};

const defaultDependencies: AssignableUsersRouteDependencies = {
  requireUser,
  listAssignableUsers,
};

export function createAssignableUsersRouteHandlers(
  dependencies: AssignableUsersRouteDependencies = defaultDependencies,
) {
  return {
    GET: async (): Promise<Response> => {
      try {
        const actor = await dependencies.requireUser();
        const items = await dependencies.listAssignableUsers(actor);
        return Response.json({ data: { items }, error: null });
      } catch (error) {
        return toErrorResponse(error);
      }
    },
  };
}

export const GET = createAssignableUsersRouteHandlers().GET;

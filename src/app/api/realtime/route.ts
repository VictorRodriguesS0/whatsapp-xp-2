import { toErrorResponse } from "@/lib/http";
import { requireUser } from "@/modules/auth/guards";
import { subscribeRealtime } from "@/modules/realtime/hub";

export const runtime = "nodejs";

type RealtimeRouteDependencies = {
  requireUser: typeof requireUser;
  subscribeRealtime: typeof subscribeRealtime;
};

const defaultDependencies: RealtimeRouteDependencies = {
  requireUser,
  subscribeRealtime,
};

export function createRealtimeRouteHandlers(
  dependencies: RealtimeRouteDependencies = defaultDependencies,
) {
  return {
    GET: async (request: Request): Promise<Response> => {
      try {
        const user = await dependencies.requireUser();

        return new Response(dependencies.subscribeRealtime(request.signal, user.id), {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-store, no-transform",
            "X-Accel-Buffering": "no",
          },
        });
      } catch (error) {
        return toErrorResponse(error);
      }
    },
  };
}

export const GET = createRealtimeRouteHandlers().GET;

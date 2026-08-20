import { clearSessionCookieResponse, toErrorResponse } from "@/lib/http";
import { assertSameOrigin } from "@/modules/auth/guards";
import { revokeCurrentSession } from "@/modules/auth/session";

export const runtime = "nodejs";

type RevokeCurrentSession = () => Promise<void>;

export function createLogoutHandler(
  revokeSession: RevokeCurrentSession = revokeCurrentSession,
) {
  return async function logoutHandler(request: Request): Promise<Response> {
    try {
      assertSameOrigin(request);
      await revokeSession();
      return clearSessionCookieResponse();
    } catch (error) {
      return toErrorResponse(error);
    }
  };
}

export const POST = createLogoutHandler();

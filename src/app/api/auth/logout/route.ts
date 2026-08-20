import { clearSessionCookieResponse, toErrorResponse } from "@/lib/http";
import { assertSameOrigin } from "@/modules/auth/guards";
import { revokeCurrentSession } from "@/modules/auth/session";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    await revokeCurrentSession();
    return clearSessionCookieResponse();
  } catch (error) {
    return toErrorResponse(error);
  }
}

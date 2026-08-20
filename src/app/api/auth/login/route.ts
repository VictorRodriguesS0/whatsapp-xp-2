import { ZodError } from "zod";

import { toErrorResponse, HttpError, sessionCookieResponse } from "@/lib/http";
import { assertSameOrigin } from "@/modules/auth/guards";
import { loginRateLimiter } from "@/modules/auth/rate-limit";
import { authenticate, createSession, loginSchema } from "@/modules/auth/session";

export const runtime = "nodejs";

function requestIp(request: Request): string {
  return request.headers.get("x-real-ip") || "direct";
}

export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const input = loginSchema.parse(await request.json());
    const attempt = { email: input.email, ip: requestIp(request) };

    if (!loginRateLimiter.isAllowed(attempt)) {
      throw new HttpError(429, "Muitas tentativas. Tente novamente mais tarde");
    }

    try {
      const user = await authenticate(input);
      const token = await createSession(user.id);
      loginRateLimiter.reset(attempt);

      return sessionCookieResponse({ user }, token);
    } catch (error) {
      if (error instanceof HttpError && error.status === 401) {
        loginRateLimiter.recordFailure(attempt);
      }

      throw error;
    }
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError) {
      return toErrorResponse(new HttpError(400, "Dados inválidos"));
    }

    return toErrorResponse(error);
  }
}

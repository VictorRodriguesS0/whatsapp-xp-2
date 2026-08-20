import "server-only";

import { NextResponse } from "next/server";

export const SESSION_COOKIE_NAME = "xp_atendimento_session";
export const SESSION_DURATION_SECONDS = 7 * 24 * 60 * 60;

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function sessionCookieResponse<T>(body: T, token: string): NextResponse<T> {
  const response = NextResponse.json(body);

  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DURATION_SECONDS,
    secure: process.env.NODE_ENV !== "development",
  });

  return response;
}

export function clearSessionCookieResponse(): NextResponse {
  const response = new NextResponse(null, { status: 204 });
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
    secure: process.env.NODE_ENV !== "development",
  });

  return response;
}

export function toErrorResponse(error: unknown): NextResponse<{ error: string }> {
  if (error instanceof HttpError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  return NextResponse.json({ error: "Erro interno" }, { status: 500 });
}

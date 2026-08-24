import { ZodError } from "zod";

import { HttpError, toErrorResponse } from "@/lib/http";

export function metaHealthErrorResponse(error: unknown): Response {
  if (error instanceof ZodError || error instanceof SyntaxError) {
    return toErrorResponse(new HttpError(400, "Dados inválidos"));
  }
  return toErrorResponse(error);
}

export function scalarQuery(url: URL): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of url.searchParams) {
    if (result[key] !== undefined) throw new SyntaxError("Duplicate parameter");
    result[key] = value;
  }
  return result;
}

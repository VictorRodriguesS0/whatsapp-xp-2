import { ZodError } from "zod";

import { HttpError } from "@/lib/http";
import { CatalogServiceError } from "@/modules/catalog/service";

type ErrorBody = {
  data: null;
  error: { code: string; message: string };
};

function responseError(status: number, code: string, message: string): Response {
  return Response.json(
    { data: null, error: { code, message } } satisfies ErrorBody,
    { status },
  );
}

function statusCode(status: number): string {
  return ({
    400: "INVALID_INPUT",
    401: "UNAUTHORIZED",
    403: "FORBIDDEN",
    404: "NOT_FOUND",
    409: "CONFLICT",
    429: "RATE_LIMITED",
  }[status] ?? "INTERNAL_ERROR");
}

export function catalogApiErrorResponse(error: unknown): Response {
  if (error instanceof ZodError || error instanceof SyntaxError) {
    return responseError(400, "INVALID_INPUT", "Dados de catálogo inválidos");
  }
  if (error instanceof CatalogServiceError) {
    if (error.code === "CATALOG_NOT_CONFIGURED") {
      return responseError(503, "CATALOG_NOT_CONFIGURED", "Catálogo não configurado");
    }
    if (error.code === "CATALOG_PRODUCT_NOT_FOUND") {
      return responseError(404, "CATALOG_PRODUCT_NOT_FOUND", "Produto não encontrado");
    }
    return responseError(503, "CATALOG_UNAVAILABLE", "Catálogo temporariamente indisponível");
  }
  if (error instanceof HttpError) {
    if (error.status >= 500) {
      return responseError(500, "INTERNAL_ERROR", "Erro interno");
    }
    return responseError(error.status, statusCode(error.status), error.message);
  }
  return responseError(500, "INTERNAL_ERROR", "Erro interno");
}

export function catalogApiSuccessResponse<T>(data: T): Response {
  return Response.json({ data, error: null });
}

export function scalarCatalogQuery(url: URL): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of url.searchParams) {
    if (values[key] !== undefined) throw new SyntaxError("Duplicate parameter");
    values[key] = value;
  }
  return values;
}

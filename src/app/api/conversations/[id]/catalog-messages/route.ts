import { HttpError } from "@/lib/http";
import { assertSameOrigin, requireUser } from "@/modules/auth/guards";
import { catalogSendInputSchema } from "@/modules/catalog/send-schemas";
import { sendCatalogMessage } from "@/modules/catalog/send-service";
import { conversationIdSchema } from "@/modules/conversations/schemas";

import {
  conversationErrorResponse,
  conversationSuccessResponse,
} from "../../route";

export const runtime = "nodejs";
export const CATALOG_MESSAGE_JSON_MAX_BYTES = 4 * 1024;

type RouteContext = { params: Promise<{ id: string }> };
type CatalogMessagesRouteDependencies = {
  assertSameOrigin: typeof assertSameOrigin;
  requireUser: typeof requireUser;
  sendCatalogMessage: typeof sendCatalogMessage;
};

const defaults: CatalogMessagesRouteDependencies = {
  assertSameOrigin,
  requireUser,
  sendCatalogMessage,
};

async function readBoundedJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    throw new HttpError(415, "Formato de envio não suportado");
  }
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^\d+$/u.test(contentLength)) throw new HttpError(400, "JSON inválido");
    if (BigInt(contentLength) > BigInt(CATALOG_MESSAGE_JSON_MAX_BYTES)) {
      throw new HttpError(413, "Payload muito grande");
    }
  }
  if (!request.body) throw new HttpError(400, "JSON inválido");

  const reader = request.body.getReader();
  const bytes = new Uint8Array(CATALOG_MESSAGE_JSON_MAX_BYTES);
  let total = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      if (total + result.value.byteLength > CATALOG_MESSAGE_JSON_MAX_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new HttpError(413, "Payload muito grande");
      }
      bytes.set(result.value, total);
      total += result.value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(0, total),
    );
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new SyntaxError("JSON inválido");
  }
}

export function createCatalogMessagesRouteHandlers(
  dependencies: CatalogMessagesRouteDependencies = defaults,
) {
  return {
    POST: async (request: Request, context: RouteContext): Promise<Response> => {
      try {
        dependencies.assertSameOrigin(request);
        const actor = await dependencies.requireUser();
        const { id } = await context.params;
        const conversationId = conversationIdSchema.parse(id);
        const input = catalogSendInputSchema.parse(await readBoundedJson(request));
        const message = await dependencies.sendCatalogMessage(
          actor,
          conversationId,
          input,
        );
        return conversationSuccessResponse(message, 201);
      } catch (error) {
        return conversationErrorResponse(error);
      }
    },
  };
}

export const POST = createCatalogMessagesRouteHandlers().POST;

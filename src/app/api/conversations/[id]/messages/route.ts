import { HttpError } from "@/lib/http";
import { assertSameOrigin, requireUser } from "@/modules/auth/guards";
import { conversationIdSchema } from "@/modules/conversations/schemas";
import { getConversation } from "@/modules/conversations/service";
import { outboundMediaFieldsSchema, outboundTextSchema } from "@/modules/messages/schemas";
import { sendMessage, type SendMessageInput } from "@/modules/messages/service";
import { getServerEnv } from "@/lib/env";
import { parseMediaMultipartRequest } from "@/modules/media/multipart";

import {
  conversationErrorResponse,
  conversationSuccessResponse,
} from "../../route";

export const runtime = "nodejs";
export const OUTBOUND_JSON_MAX_BODY_BYTES = 8 * 1024;

type ConversationMessagesRouteDependencies = {
  assertSameOrigin: typeof assertSameOrigin;
  requireUser: typeof requireUser;
  getConversation: typeof getConversation;
  sendMessage: typeof sendMessage;
  mediaRoot: string;
};

type RouteContext = { params: Promise<{ id: string }> };

const defaultDependencies: ConversationMessagesRouteDependencies = {
  assertSameOrigin,
  requireUser,
  getConversation,
  sendMessage,
  mediaRoot: getServerEnv().MEDIA_ROOT,
};

async function parseSendInput(request: Request, mediaRoot: string): Promise<SendMessageInput> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";

  if (contentType.startsWith("application/json")) {
    const contentLength = request.headers.get("content-length");
    if (contentLength !== null) {
      if (!/^\d+$/.test(contentLength)) throw new HttpError(400, "JSON inválido");
      if (BigInt(contentLength) > BigInt(OUTBOUND_JSON_MAX_BODY_BYTES)) throw new HttpError(413, "Payload muito grande");
    }
    if (!request.body) throw new HttpError(400, "JSON inválido");
    const reader = request.body.getReader();
    const bytes = new Uint8Array(OUTBOUND_JSON_MAX_BODY_BYTES);
    let total = 0;
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        if (total + result.value.byteLength > OUTBOUND_JSON_MAX_BODY_BYTES) {
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
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, total));
      return outboundTextSchema.parse(JSON.parse(text));
    } catch (error) {
      if (error instanceof HttpError || (error instanceof Error && error.name === "ZodError")) throw error;
      throw new HttpError(400, "JSON inválido");
    }
  }

  if (!contentType.startsWith("multipart/form-data")) {
    throw new HttpError(415, "Formato de envio não suportado");
  }

  const form = await parseMediaMultipartRequest(request, mediaRoot);
  try {
    const fields = outboundMediaFieldsSchema.parse({
      type: form.fields.type,
      clientRequestId: form.fields.clientRequestId,
      body: form.fields.body || undefined,
      replyToMessageId: form.fields.replyToMessageId || undefined,
    });

    return {
      ...fields,
      file: {
        filename: form.file.filename,
        mimeType: form.file.mimeType,
        path: form.file.path,
        sizeBytes: form.file.sizeBytes,
        sha256: form.file.sha256,
        cleanup: form.file.cleanup,
      },
    };
  } catch (error) {
    await form.file.cleanup().catch(() => undefined);
    throw error;
  }
}

export function createConversationMessagesRouteHandlers(
  overrides: Partial<ConversationMessagesRouteDependencies> = {},
) {
  const dependencies = { ...defaultDependencies, ...overrides };
  return {
    GET: async (_request: Request, context: RouteContext): Promise<Response> => {
      try {
        const actor = await dependencies.requireUser();
        const { id } = await context.params;
        const parsedId = conversationIdSchema.parse(id);
        const conversation = await dependencies.getConversation(actor.id, parsedId);
        return conversationSuccessResponse(conversation);
      } catch (error) {
        return conversationErrorResponse(error);
      }
    },
    POST: async (request: Request, context: RouteContext): Promise<Response> => {
      try {
        dependencies.assertSameOrigin(request);
        const actor = await dependencies.requireUser();
        const { id } = await context.params;
        const parsedId = conversationIdSchema.parse(id);
        const input = await parseSendInput(request, dependencies.mediaRoot);
        try {
          const message = await dependencies.sendMessage(actor, parsedId, input);
          return conversationSuccessResponse(message, 201);
        } finally {
          if (input.type !== "TEXT") await input.file.cleanup?.();
        }
      } catch (error) {
        return conversationErrorResponse(error);
      }
    },
  };
}

const handlers = createConversationMessagesRouteHandlers();
export const GET = handlers.GET;
export const POST = handlers.POST;

import { HttpError } from "@/lib/http";
import { assertSameOrigin, requireUser } from "@/modules/auth/guards";
import { conversationIdSchema } from "@/modules/conversations/schemas";
import { getConversation } from "@/modules/conversations/service";
import { outboundMediaFieldsSchema, outboundTextSchema } from "@/modules/messages/schemas";
import { sendMessage, type SendMessageInput } from "@/modules/messages/service";

import {
  conversationErrorResponse,
  conversationSuccessResponse,
} from "../../route";

export const runtime = "nodejs";

type ConversationMessagesRouteDependencies = {
  assertSameOrigin: typeof assertSameOrigin;
  requireUser: typeof requireUser;
  getConversation: typeof getConversation;
  sendMessage: typeof sendMessage;
};

type RouteContext = { params: Promise<{ id: string }> };

const defaultDependencies: ConversationMessagesRouteDependencies = {
  assertSameOrigin,
  requireUser,
  getConversation,
  sendMessage,
};

async function parseSendInput(request: Request): Promise<SendMessageInput> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";

  if (contentType.startsWith("application/json")) {
    return outboundTextSchema.parse(await request.json());
  }

  if (!contentType.startsWith("multipart/form-data")) {
    throw new HttpError(415, "Formato de envio não suportado");
  }

  const form = await request.formData();
  const fields = outboundMediaFieldsSchema.parse({
    type: form.get("type"),
    clientRequestId: form.get("clientRequestId"),
    body: form.get("body") || undefined,
  });
  const file = form.get("file");

  if (!(file instanceof File) || file.size === 0 || !file.type) {
    throw new HttpError(400, "Arquivo inválido");
  }

  return {
    ...fields,
    file: {
      filename: file.name,
      mimeType: file.type,
      bytes: new Uint8Array(await file.arrayBuffer()),
    },
  };
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
        const input = await parseSendInput(request);
        const message = await dependencies.sendMessage(actor, parsedId, input);
        return conversationSuccessResponse(message, 201);
      } catch (error) {
        return conversationErrorResponse(error);
      }
    },
  };
}

const handlers = createConversationMessagesRouteHandlers();
export const GET = handlers.GET;
export const POST = handlers.POST;

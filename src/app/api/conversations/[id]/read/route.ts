import { z } from "zod";

import { assertSameOrigin, requireUser } from "@/modules/auth/guards";
import {
  conversationIdSchema,
  messageIdSchema,
} from "@/modules/conversations/schemas";
import { advanceSharedRead } from "@/modules/conversations/shared-state";
import { deliverReadReceiptForConversation } from "@/modules/read-receipts/service";
import type { ReadReceiptDelivery } from "@/modules/read-receipts/types";
import { publishRealtime } from "@/modules/realtime/hub";

import {
  conversationErrorResponse,
  conversationSuccessResponse,
} from "../../route";

export const runtime = "nodejs";

const markSharedReadSchema = z.object({
  messageId: messageIdSchema,
  observedManualUnreadRevision: z.iso.datetime({ offset: true }).nullable(),
});

type ConversationReadRouteDependencies = {
  assertSameOrigin: typeof assertSameOrigin;
  requireUser: typeof requireUser;
  markSharedRead: typeof advanceSharedRead;
  publishRealtime: typeof publishRealtime;
  deliverReadReceipt: typeof deliverReadReceiptForConversation;
};

type RouteContext = { params: Promise<{ id: string }> };

const defaultDependencies: ConversationReadRouteDependencies = {
  assertSameOrigin,
  requireUser,
  markSharedRead: advanceSharedRead,
  publishRealtime,
  deliverReadReceipt: deliverReadReceiptForConversation,
};

export function createConversationReadRouteHandlers(
  dependencies: ConversationReadRouteDependencies = defaultDependencies,
) {
  return {
    POST: async (request: Request, context: RouteContext): Promise<Response> => {
      try {
        dependencies.assertSameOrigin(request);
        const actor = await dependencies.requireUser();
        const { id } = await context.params;
        const parsedId = conversationIdSchema.parse(id);
        const input = markSharedReadSchema.parse(await request.json());
        const state = await dependencies.markSharedRead(
          actor.id,
          parsedId,
          input.messageId,
          input.observedManualUnreadRevision,
        );
        dependencies.publishRealtime({
          type: "conversation.updated",
          conversationId: parsedId,
          revision: state.revision,
        });
        let whatsappReadReceipt: ReadReceiptDelivery = "PENDING";
        try {
          whatsappReadReceipt = await dependencies.deliverReadReceipt(parsedId);
        } catch {
          // The durable target remains available to the retry worker.
        }
        return conversationSuccessResponse({ ...state, whatsappReadReceipt });
      } catch (error) {
        return conversationErrorResponse(error);
      }
    },
  };
}

export const POST = createConversationReadRouteHandlers().POST;

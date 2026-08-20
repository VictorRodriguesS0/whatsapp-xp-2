import { getServerEnv } from "@/lib/env";
import { HttpError } from "@/lib/http";
import { assertSameOrigin, requireUser } from "@/modules/auth/guards";
import { conversationIdSchema } from "@/modules/conversations/schemas";
import { getConversation } from "@/modules/conversations/service";
import { clientRequestIdSchema } from "@/modules/messages/schemas";
import { sendMessage } from "@/modules/messages/service";
import { parseRecordingMultipartRequest } from "@/modules/recordings/multipart";
import { convertRecording, RAW_RECORDING_MIME_TYPES } from "@/modules/recordings/converter";
import { RecordingAdmissionLimiter } from "@/modules/recordings/limiter";

import { conversationErrorResponse, conversationSuccessResponse } from "../../route";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

type ConversationRecordingsRouteDependencies = {
  assertSameOrigin: typeof assertSameOrigin;
  requireUser: typeof requireUser;
  getConversation: typeof getConversation;
  parseRecordingMultipartRequest: typeof parseRecordingMultipartRequest;
  convertRecording: typeof convertRecording;
  sendMessage: typeof sendMessage;
  limiter: RecordingAdmissionLimiter;
  mediaRoot: string;
};

const defaultDependencies: ConversationRecordingsRouteDependencies = {
  assertSameOrigin,
  requireUser,
  getConversation,
  parseRecordingMultipartRequest,
  convertRecording,
  sendMessage,
  limiter: new RecordingAdmissionLimiter(),
  mediaRoot: getServerEnv().MEDIA_ROOT,
};

function mimeEssence(mimeType: string): string {
  return mimeType.split(";", 1)[0]!.trim().toLowerCase();
}

export function createConversationRecordingsRouteHandler(
  overrides: Partial<ConversationRecordingsRouteDependencies> = {},
) {
  const dependencies = { ...defaultDependencies, ...overrides };
  return async (request: Request, context: RouteContext): Promise<Response> => {
    try {
      dependencies.assertSameOrigin(request);
      const actor = await dependencies.requireUser();
      const conversationId = conversationIdSchema.parse((await context.params).id);
      await dependencies.getConversation(actor.id, conversationId);
      const admission = dependencies.limiter.tryAcquire(actor.id);
      if (admission === "BUSY") throw new HttpError(429, "Aguarde a conversão de áudio atual");
      if (admission === "RATE_LIMITED") throw new HttpError(429, "Muitas gravações em pouco tempo");

      try {
        let raw: Awaited<ReturnType<typeof parseRecordingMultipartRequest>>["file"] | undefined;
        try {
          const form = await dependencies.parseRecordingMultipartRequest(request, dependencies.mediaRoot);
          raw = form.file;
          if (!RAW_RECORDING_MIME_TYPES.has(mimeEssence(raw.mimeType))) {
            throw new HttpError(400, "Tipo de gravação não permitido");
          }
          const clientRequestId = clientRequestIdSchema.parse(form.fields.clientRequestId);
          const converted = await dependencies.convertRecording({ root: dependencies.mediaRoot, source: raw });
          try {
            const message = await dependencies.sendMessage(actor, conversationId, {
              type: "AUDIO",
              clientRequestId,
              file: {
                filename: "gravacao.ogg",
                mimeType: "audio/ogg",
                path: converted.path,
                sizeBytes: converted.sizeBytes,
                sha256: converted.sha256,
                cleanup: converted.cleanup,
              },
            });
            return conversationSuccessResponse(message, 201);
          } finally {
            await converted.cleanup().catch(() => undefined);
          }
        } finally {
          await raw?.cleanup().catch(() => undefined);
        }
      } finally {
        admission.release();
      }
    } catch (error) {
      return conversationErrorResponse(error);
    }
  };
}

export const POST = createConversationRecordingsRouteHandler();

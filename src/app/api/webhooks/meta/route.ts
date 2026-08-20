import { randomUUID } from "node:crypto";
import { after } from "next/server";

import type { ServerEnv } from "@/lib/env";
import { getServerEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { ensureMediaAvailable } from "@/modules/media/service";
import { MediaTaskLimiter } from "@/modules/media/task-limiter";
import { normalizeWebhook, WebhookPayloadError } from "@/modules/webhooks/normalize";
import {
  processWebhookEvents,
  WebhookProcessingError,
} from "@/modules/webhooks/process";
import { verifyMetaSignature, verifyMetaToken } from "@/modules/webhooks/signature";

export const runtime = "nodejs";
export const META_WEBHOOK_MAX_BODY_BYTES = 1024 * 1024;

class WebhookBodyTooLargeError extends Error {}
class WebhookBodyReadError extends Error {}

type WebhookEnvironment = Pick<
  ServerEnv,
  "META_APP_SECRET" | "WHATSAPP_VERIFY_TOKEN"
>;

type WebhookLogger = Pick<typeof logger, "info" | "warn" | "error">;

type MetaWebhookRouteDependencies = {
  getServerEnv(): WebhookEnvironment;
  normalizeWebhook: typeof normalizeWebhook;
  processWebhookEvents: typeof processWebhookEvents;
  verifyMetaSignature: typeof verifyMetaSignature;
  verifyMetaToken: typeof verifyMetaToken;
  maxBodyBytes: number;
  scheduleAfter(work: () => Promise<void>): void;
  ensureMediaAvailable(mediaId: string): Promise<void>;
  logger: WebhookLogger;
};

const defaultMediaTaskLimiter = new MediaTaskLimiter(4);

const defaultDependencies: MetaWebhookRouteDependencies = {
  getServerEnv,
  normalizeWebhook,
  processWebhookEvents,
  verifyMetaSignature,
  verifyMetaToken,
  maxBodyBytes: META_WEBHOOK_MAX_BODY_BYTES,
  scheduleAfter: (work) => after(() => defaultMediaTaskLimiter.run(work)),
  ensureMediaAvailable,
  logger,
};

function safeJsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

function validateContentLength(headers: Headers, maximumBytes: number): void {
  const contentLength = headers.get("content-length");

  if (contentLength === null) {
    return;
  }

  if (!/^(0|[1-9]\d*)$/.test(contentLength)) {
    throw new WebhookBodyTooLargeError();
  }

  if (BigInt(contentLength) > BigInt(maximumBytes)) {
    throw new WebhookBodyTooLargeError();
  }
}

export async function readLimitedBody(
  request: Request,
  maximumBytes: number,
): Promise<Uint8Array> {
  validateContentLength(request.headers, maximumBytes);

  if (!request.body) {
    return new Uint8Array();
  }

  const reader = request.body.getReader();
  const body = new Uint8Array(maximumBytes);
  let totalBytes = 0;

  try {
    while (true) {
      let result: ReadableStreamReadResult<Uint8Array>;

      try {
        result = await reader.read();
      } catch {
        throw new WebhookBodyReadError();
      }

      if (result.done) {
        break;
      }

      totalBytes += result.value.byteLength;

      if (totalBytes > maximumBytes) {
        try {
          await reader.cancel();
        } catch {
          // The size error remains authoritative even when cancellation fails.
        }
        throw new WebhookBodyTooLargeError();
      }

      body.set(result.value, totalBytes - result.value.byteLength);
    }
  } finally {
    reader.releaseLock();
  }

  return body.slice(0, totalBytes);
}

export function createMetaWebhookRouteHandlers(
  dependencies: MetaWebhookRouteDependencies = defaultDependencies,
) {
  return {
    GET: async (request: Request): Promise<Response> => {
      const requestId = randomUUID();
      const url = new URL(request.url);
      const mode = url.searchParams.get("hub.mode");
      const suppliedToken = url.searchParams.get("hub.verify_token");
      const challenge = url.searchParams.get("hub.challenge");
      const { WHATSAPP_VERIFY_TOKEN: expectedToken } = dependencies.getServerEnv();

      if (
        mode !== "subscribe" ||
        challenge === null ||
        !dependencies.verifyMetaToken(suppliedToken, expectedToken)
      ) {
        dependencies.logger.warn("webhook.verification_rejected", { requestId });
        return new Response("Forbidden", { status: 403 });
      }

      dependencies.logger.info("webhook.verification_accepted", { requestId });
      return new Response(challenge, {
        status: 200,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    },
    POST: async (request: Request): Promise<Response> => {
      const requestId = randomUUID();
      let rawBodyBytes: Uint8Array;

      try {
        rawBodyBytes = await readLimitedBody(request, dependencies.maxBodyBytes);
      } catch (error) {
        if (error instanceof WebhookBodyTooLargeError) {
          dependencies.logger.warn("webhook.body_too_large", { requestId });
          return safeJsonError("Payload muito grande", 413);
        }

        dependencies.logger.warn("webhook.body_rejected", { requestId });
        return safeJsonError("Payload inválido", 400);
      }

      const signature = request.headers.get("x-hub-signature-256");
      const { META_APP_SECRET: appSecret } = dependencies.getServerEnv();

      if (!appSecret) {
        dependencies.logger.error("webhook.configuration_missing", { requestId });
        return safeJsonError("Webhook indisponível", 503);
      }

      if (!dependencies.verifyMetaSignature(rawBodyBytes, signature, appSecret)) {
        dependencies.logger.warn("webhook.signature_rejected", { requestId });
        return safeJsonError("Assinatura inválida", 401);
      }

      let rawBody: string;

      try {
        rawBody = new TextDecoder("utf-8", { fatal: true }).decode(rawBodyBytes);
      } catch {
        dependencies.logger.warn("webhook.payload_rejected", { requestId });
        return safeJsonError("Payload inválido", 400);
      }

      let events;

      try {
        const payload: unknown = JSON.parse(rawBody);
        events = dependencies.normalizeWebhook(payload);
      } catch (error) {
        if (error instanceof SyntaxError || error instanceof WebhookPayloadError) {
          dependencies.logger.warn("webhook.payload_rejected", { requestId });
          return safeJsonError("Payload inválido", 400);
        }

        dependencies.logger.error("webhook.normalization_failed", {
          requestId,
          errorType: error instanceof Error ? error.name : "Unknown",
        });
        return safeJsonError("Erro interno", 500);
      }

      try {
        const pendingMediaIds: string[] = [];
        const summary = await dependencies.processWebhookEvents(
          events,
          undefined,
          (mediaId) => pendingMediaIds.push(mediaId),
        );
        for (const mediaId of pendingMediaIds) {
          dependencies.scheduleAfter(async () => {
            try {
              await dependencies.ensureMediaAvailable(mediaId);
            } catch (error) {
              dependencies.logger.error("webhook.media_persistence_failed", {
                requestId,
                mediaId,
                errorType: error instanceof Error ? error.name : "Unknown",
              });
            }
          });
        }
        dependencies.logger.info("webhook.accepted", {
          requestId,
          eventCount: events.length,
          processed: summary.processed,
          duplicates: summary.duplicates,
        });
        return Response.json({ received: true, ...summary });
      } catch (error) {
        const retryable =
          !(error instanceof WebhookProcessingError) || error.retryable;
        dependencies.logger.error("webhook.processing_failed", {
          requestId,
          errorType: error instanceof Error ? error.name : "Unknown",
          retryable,
        });

        if (!retryable) {
          return safeJsonError("Evento não processável", 422);
        }

        return safeJsonError("Erro interno", 500);
      }
    },
  };
}

const handlers = createMetaWebhookRouteHandlers();

export const GET = handlers.GET;
export const POST = handlers.POST;

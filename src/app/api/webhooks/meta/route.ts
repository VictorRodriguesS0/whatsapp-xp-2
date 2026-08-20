import { randomUUID } from "node:crypto";

import type { ServerEnv } from "@/lib/env";
import { getServerEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { normalizeWebhook, WebhookPayloadError } from "@/modules/webhooks/normalize";
import { processWebhookEvents } from "@/modules/webhooks/process";
import { verifyMetaSignature, verifyMetaToken } from "@/modules/webhooks/signature";

export const runtime = "nodejs";

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
  logger: WebhookLogger;
};

const defaultDependencies: MetaWebhookRouteDependencies = {
  getServerEnv,
  normalizeWebhook,
  processWebhookEvents,
  verifyMetaSignature,
  verifyMetaToken,
  logger,
};

function safeJsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
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
      let rawBody: string;

      try {
        rawBody = await request.text();
      } catch {
        dependencies.logger.warn("webhook.body_rejected", { requestId });
        return safeJsonError("Payload inválido", 400);
      }

      const signature = request.headers.get("x-hub-signature-256");
      const { META_APP_SECRET: appSecret } = dependencies.getServerEnv();

      if (!appSecret) {
        dependencies.logger.error("webhook.configuration_missing", { requestId });
        return safeJsonError("Webhook indisponível", 503);
      }

      if (!dependencies.verifyMetaSignature(rawBody, signature, appSecret)) {
        dependencies.logger.warn("webhook.signature_rejected", { requestId });
        return safeJsonError("Assinatura inválida", 401);
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
        const summary = await dependencies.processWebhookEvents(events);
        dependencies.logger.info("webhook.accepted", {
          requestId,
          eventCount: events.length,
          processed: summary.processed,
          duplicates: summary.duplicates,
        });
        return Response.json({ received: true, ...summary });
      } catch (error) {
        dependencies.logger.error("webhook.processing_failed", {
          requestId,
          errorType: error instanceof Error ? error.name : "Unknown",
        });
        return safeJsonError("Erro interno", 500);
      }
    },
  };
}

const handlers = createMetaWebhookRouteHandlers();

export const GET = handlers.GET;
export const POST = handlers.POST;

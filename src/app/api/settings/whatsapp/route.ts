import { ZodError } from "zod";

import { HttpError } from "@/lib/http";
import { assertSameOrigin, requireAdmin } from "@/modules/auth/guards";
import { publishRealtime } from "@/modules/realtime/hub";
import { whatsappPolicyMutationSchema } from "@/modules/templates/schemas";
import {
  assignServiceResumptionTemplate,
  getWhatsAppPolicySettings,
  setWhatsAppPolicyMode,
} from "@/modules/templates/service";

export const runtime = "nodejs";

type WhatsAppSettingsRouteDependencies = {
  assertSameOrigin: typeof assertSameOrigin;
  requireAdmin: typeof requireAdmin;
  getWhatsAppPolicySettings: typeof getWhatsAppPolicySettings;
  assignServiceResumptionTemplate: typeof assignServiceResumptionTemplate;
  setWhatsAppPolicyMode: typeof setWhatsAppPolicyMode;
  publishRealtime: typeof publishRealtime;
};

const defaultDependencies: WhatsAppSettingsRouteDependencies = {
  assertSameOrigin,
  requireAdmin,
  getWhatsAppPolicySettings,
  assignServiceResumptionTemplate,
  setWhatsAppPolicyMode,
  publishRealtime,
};

const stableDomainCodes = new Set([
  "WHATSAPP_SERVICE_WINDOW_CLOSED",
  "WHATSAPP_TEMPLATE_NOT_READY",
  "WHATSAPP_TEMPLATE_NOT_ELIGIBLE",
  "WHATSAPP_TEMPLATE_SYNC_FAILED",
  "WHATSAPP_RESUMPTION_ALREADY_STARTED",
  "WHATSAPP_CONTACT_OPTED_OUT",
  "WHATSAPP_RESUMPTION_OUTCOME_UNKNOWN",
]);

function statusCode(status: number): string {
  return (
    {
      400: "INVALID_INPUT",
      401: "UNAUTHORIZED",
      403: "FORBIDDEN",
      404: "NOT_FOUND",
      409: "CONFLICT",
      429: "RATE_LIMITED",
      502: "UPSTREAM_ERROR",
    }[status] ?? "INTERNAL_ERROR"
  );
}

export function whatsAppPolicyErrorResponse(error: unknown): Response {
  if (error instanceof ZodError || error instanceof SyntaxError) {
    return Response.json(
      {
        data: null,
        error: { code: "INVALID_INPUT", message: "Dados inválidos" },
      },
      { status: 400 },
    );
  }
  if (error instanceof HttpError) {
    const stableCode = error.code && stableDomainCodes.has(error.code)
      ? error.code
      : null;
    if (error.status >= 500 && !stableCode) {
      return Response.json(
        {
          data: null,
          error: { code: "INTERNAL_ERROR", message: "Erro interno" },
        },
        { status: 500 },
      );
    }
    return Response.json(
      {
        data: null,
        error: {
          code: stableCode ?? statusCode(error.status),
          message: error.message,
        },
      },
      { status: error.status },
    );
  }
  return Response.json(
    {
      data: null,
      error: { code: "INTERNAL_ERROR", message: "Erro interno" },
    },
    { status: 500 },
  );
}

export function whatsAppPolicySuccessResponse<T>(data: T): Response {
  return Response.json({ data, error: null });
}

export function createWhatsAppSettingsRouteHandlers(
  dependencies: WhatsAppSettingsRouteDependencies = defaultDependencies,
) {
  return {
    GET: async (): Promise<Response> => {
      try {
        const actor = await dependencies.requireAdmin();
        const settings = await dependencies.getWhatsAppPolicySettings(actor);
        return whatsAppPolicySuccessResponse(settings);
      } catch (error) {
        return whatsAppPolicyErrorResponse(error);
      }
    },
    PATCH: async (request: Request): Promise<Response> => {
      try {
        dependencies.assertSameOrigin(request);
        const actor = await dependencies.requireAdmin();
        const mutation = whatsappPolicyMutationSchema.parse(
          await request.json(),
        );
        const settings =
          mutation.action === "ASSIGN_TEMPLATE"
            ? await dependencies.assignServiceResumptionTemplate(
                actor,
                mutation.templateId,
              )
            : await dependencies.setWhatsAppPolicyMode(actor, {
                mode: mutation.mode,
              });
        dependencies.publishRealtime({
          type: "settings.updated",
          scope: "whatsapp-policy",
        });
        return whatsAppPolicySuccessResponse(settings);
      } catch (error) {
        return whatsAppPolicyErrorResponse(error);
      }
    },
  };
}

const handlers = createWhatsAppSettingsRouteHandlers();
export const GET = handlers.GET;
export const PATCH = handlers.PATCH;

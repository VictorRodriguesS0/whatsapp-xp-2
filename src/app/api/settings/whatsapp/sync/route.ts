import { z } from "zod";

import { assertSameOrigin, requireAdmin } from "@/modules/auth/guards";
import { publishRealtime } from "@/modules/realtime/hub";
import { syncWhatsAppTemplates } from "@/modules/templates/service";

import {
  whatsAppPolicyErrorResponse,
  whatsAppPolicySuccessResponse,
} from "../route";

export const runtime = "nodejs";

type WhatsAppTemplateSyncRouteDependencies = {
  assertSameOrigin: typeof assertSameOrigin;
  requireAdmin: typeof requireAdmin;
  syncWhatsAppTemplates: typeof syncWhatsAppTemplates;
  publishRealtime: typeof publishRealtime;
};

const defaultDependencies: WhatsAppTemplateSyncRouteDependencies = {
  assertSameOrigin,
  requireAdmin,
  syncWhatsAppTemplates,
  publishRealtime,
};

const syncBodySchema = z.strictObject({});

export function createWhatsAppTemplateSyncRouteHandlers(
  dependencies: WhatsAppTemplateSyncRouteDependencies = defaultDependencies,
) {
  return {
    POST: async (request: Request): Promise<Response> => {
      try {
        dependencies.assertSameOrigin(request);
        const actor = await dependencies.requireAdmin();
        syncBodySchema.parse(await request.json());
        const settings = await dependencies.syncWhatsAppTemplates(actor);
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

export const POST = createWhatsAppTemplateSyncRouteHandlers().POST;


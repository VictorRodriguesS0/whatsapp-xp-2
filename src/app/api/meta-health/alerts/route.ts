import { requireAdmin } from "@/modules/auth/guards";
import { metaAlertListQuerySchema } from "@/modules/meta-health/schemas";
import { listMetaHealthAlerts } from "@/modules/meta-health/service";

import { metaHealthErrorResponse, scalarQuery } from "../responses";

export const runtime = "nodejs";

type Dependencies = {
  requireAdmin: typeof requireAdmin;
  listMetaHealthAlerts: typeof listMetaHealthAlerts;
};

const defaults: Dependencies = { requireAdmin, listMetaHealthAlerts };

export function createMetaHealthAlertsHandlers(dependencies: Dependencies = defaults) {
  return {
    GET: async (request: Request): Promise<Response> => {
      try {
        const actor = await dependencies.requireAdmin();
        const input = metaAlertListQuerySchema.parse(scalarQuery(new URL(request.url)));
        return Response.json(await dependencies.listMetaHealthAlerts(actor, input));
      } catch (error) {
        return metaHealthErrorResponse(error);
      }
    },
  };
}

export const GET = createMetaHealthAlertsHandlers().GET;

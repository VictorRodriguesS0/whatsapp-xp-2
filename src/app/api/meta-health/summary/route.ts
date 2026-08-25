import { requireAdmin } from "@/modules/auth/guards";
import { getMetaHealthSummary } from "@/modules/meta-health/service";

import { metaHealthErrorResponse } from "../responses";

export const runtime = "nodejs";

type Dependencies = {
  requireAdmin: typeof requireAdmin;
  getMetaHealthSummary: typeof getMetaHealthSummary;
};

const defaults: Dependencies = { requireAdmin, getMetaHealthSummary };

export function createMetaHealthSummaryHandlers(dependencies: Dependencies = defaults) {
  return {
    GET: async (): Promise<Response> => {
      try {
        const actor = await dependencies.requireAdmin();
        return Response.json({ summary: await dependencies.getMetaHealthSummary(actor) });
      } catch (error) {
        return metaHealthErrorResponse(error);
      }
    },
  };
}

export const GET = createMetaHealthSummaryHandlers().GET;

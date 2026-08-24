import { assertSameOrigin, requireAdmin } from "@/modules/auth/guards";
import { metaAlertIdSchema } from "@/modules/meta-health/schemas";
import { acknowledgeMetaAlert } from "@/modules/meta-health/service";

import { metaHealthErrorResponse } from "../../../responses";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

type Dependencies = {
  assertSameOrigin: typeof assertSameOrigin;
  requireAdmin: typeof requireAdmin;
  acknowledgeMetaAlert: typeof acknowledgeMetaAlert;
};

const defaults: Dependencies = { assertSameOrigin, requireAdmin, acknowledgeMetaAlert };

export function createMetaHealthAcknowledgeHandlers(dependencies: Dependencies = defaults) {
  return {
    POST: async (request: Request, context: RouteContext): Promise<Response> => {
      try {
        dependencies.assertSameOrigin(request);
        const actor = await dependencies.requireAdmin();
        const { id } = await context.params;
        const alert = await dependencies.acknowledgeMetaAlert(actor, metaAlertIdSchema.parse(id));
        return Response.json({ alert });
      } catch (error) {
        return metaHealthErrorResponse(error);
      }
    },
  };
}

export const POST = createMetaHealthAcknowledgeHandlers().POST;

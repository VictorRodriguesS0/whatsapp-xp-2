import { assertSameOrigin, requireAdmin } from "@/modules/auth/guards";
import { emptyMetaSyncBodySchema } from "@/modules/meta-health/schemas";
import { syncMetaHealth } from "@/modules/meta-health/service";

import { metaHealthErrorResponse } from "../responses";

export const runtime = "nodejs";

type Dependencies = {
  assertSameOrigin: typeof assertSameOrigin;
  requireAdmin: typeof requireAdmin;
  syncMetaHealth: typeof syncMetaHealth;
};

const defaults: Dependencies = { assertSameOrigin, requireAdmin, syncMetaHealth };

export function createMetaHealthSyncHandlers(dependencies: Dependencies = defaults) {
  return {
    POST: async (request: Request): Promise<Response> => {
      try {
        dependencies.assertSameOrigin(request);
        const actor = await dependencies.requireAdmin();
        emptyMetaSyncBodySchema.parse(await request.json());
        const result = await dependencies.syncMetaHealth(actor, { force: true });
        return Response.json({ result }, { status: result.status === "SYNCED" ? 202 : 200 });
      } catch (error) {
        return metaHealthErrorResponse(error);
      }
    },
  };
}

export const POST = createMetaHealthSyncHandlers().POST;

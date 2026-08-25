import {
  catalogApiErrorResponse,
  catalogApiSuccessResponse,
} from "@/app/api/catalog/responses";
import { assertSameOrigin, requireAdmin } from "@/modules/auth/guards";
import { getCatalogService } from "@/modules/catalog/factory";
import type { CatalogService } from "@/modules/catalog/service";

export const runtime = "nodejs";

type Dependencies = {
  assertSameOrigin: typeof assertSameOrigin;
  requireAdmin: typeof requireAdmin;
  refreshStatus: CatalogService["refreshStatus"];
};

const defaults: Dependencies = {
  assertSameOrigin,
  requireAdmin,
  refreshStatus: (actor) => getCatalogService().refreshStatus(actor),
};

export function createWhatsAppCatalogRefreshRouteHandlers(
  dependencies: Dependencies = defaults,
) {
  return {
    POST: async (request: Request): Promise<Response> => {
      try {
        dependencies.assertSameOrigin(request);
        const actor = await dependencies.requireAdmin();
        return catalogApiSuccessResponse(await dependencies.refreshStatus(actor));
      } catch (error) {
        return catalogApiErrorResponse(error);
      }
    },
  };
}

export const POST = createWhatsAppCatalogRefreshRouteHandlers().POST;

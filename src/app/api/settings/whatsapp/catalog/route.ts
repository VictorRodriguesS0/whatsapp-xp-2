import {
  catalogApiErrorResponse,
  catalogApiSuccessResponse,
} from "@/app/api/catalog/responses";
import { requireAdmin } from "@/modules/auth/guards";
import { getCatalogService } from "@/modules/catalog/factory";
import type { CatalogService } from "@/modules/catalog/service";

export const runtime = "nodejs";

type Dependencies = {
  requireAdmin: typeof requireAdmin;
  getStatus: CatalogService["getStatus"];
};

const defaults: Dependencies = {
  requireAdmin,
  getStatus: (actor) => getCatalogService().getStatus(actor),
};

export function createWhatsAppCatalogStatusRouteHandlers(
  dependencies: Dependencies = defaults,
) {
  return {
    GET: async (): Promise<Response> => {
      try {
        const actor = await dependencies.requireAdmin();
        return catalogApiSuccessResponse(await dependencies.getStatus(actor));
      } catch (error) {
        return catalogApiErrorResponse(error);
      }
    },
  };
}

export const GET = createWhatsAppCatalogStatusRouteHandlers().GET;

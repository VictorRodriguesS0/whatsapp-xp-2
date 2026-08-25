import { requireUser } from "@/modules/auth/guards";
import { getCatalogService } from "@/modules/catalog/factory";
import { catalogSearchInputSchema } from "@/modules/catalog/schemas";
import type { CatalogService } from "@/modules/catalog/service";

import {
  catalogApiErrorResponse,
  catalogApiSuccessResponse,
  scalarCatalogQuery,
} from "../responses";

export const runtime = "nodejs";

type Dependencies = {
  requireUser: typeof requireUser;
  searchProducts: CatalogService["searchProducts"];
};

const defaults: Dependencies = {
  requireUser,
  searchProducts: (actor, input) => getCatalogService().searchProducts(actor, input),
};

export function createCatalogProductsRouteHandlers(
  dependencies: Dependencies = defaults,
) {
  return {
    GET: async (request: Request): Promise<Response> => {
      try {
        const actor = await dependencies.requireUser();
        const input = catalogSearchInputSchema.parse(
          scalarCatalogQuery(new URL(request.url)),
        );
        const page = await dependencies.searchProducts(actor, input);
        return catalogApiSuccessResponse(page);
      } catch (error) {
        return catalogApiErrorResponse(error);
      }
    },
  };
}

export const GET = createCatalogProductsRouteHandlers().GET;

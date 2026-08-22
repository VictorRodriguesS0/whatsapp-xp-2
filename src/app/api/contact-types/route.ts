import { requireUser } from "@/modules/auth/guards";
import { listActiveContactTypes } from "@/modules/contacts/service";

import {
  contactErrorResponse,
  contactSuccessResponse,
} from "../contacts/[id]/route";

export const runtime = "nodejs";

type ContactTypeCatalogRouteDependencies = {
  requireUser: typeof requireUser;
  listActiveContactTypes: typeof listActiveContactTypes;
};

const defaultDependencies: ContactTypeCatalogRouteDependencies = {
  requireUser,
  listActiveContactTypes,
};

export function createContactTypeCatalogRouteHandlers(
  dependencies: ContactTypeCatalogRouteDependencies = defaultDependencies,
) {
  return {
    GET: async (): Promise<Response> => {
      try {
        const actor = await dependencies.requireUser();
        const items = await dependencies.listActiveContactTypes(actor);
        return contactSuccessResponse({ items });
      } catch (error) {
        return contactErrorResponse(error);
      }
    },
  };
}

export const GET = createContactTypeCatalogRouteHandlers().GET;

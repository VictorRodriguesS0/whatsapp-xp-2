import { requireUser } from "@/modules/auth/guards";
import { listActiveContactTags } from "@/modules/contacts/service";

import {
  contactErrorResponse,
  contactSuccessResponse,
} from "../contacts/[id]/route";

export const runtime = "nodejs";

type ContactTagCatalogRouteDependencies = {
  requireUser: typeof requireUser;
  listActiveContactTags: typeof listActiveContactTags;
};

const defaultDependencies: ContactTagCatalogRouteDependencies = {
  requireUser,
  listActiveContactTags,
};

export function createContactTagCatalogRouteHandlers(
  dependencies: ContactTagCatalogRouteDependencies = defaultDependencies,
) {
  return {
    GET: async (): Promise<Response> => {
      try {
        const actor = await dependencies.requireUser();
        const items = await dependencies.listActiveContactTags(actor);
        return contactSuccessResponse({ items });
      } catch (error) {
        return contactErrorResponse(error);
      }
    },
  };
}

export const GET = createContactTagCatalogRouteHandlers().GET;

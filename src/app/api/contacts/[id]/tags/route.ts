import { assertSameOrigin, requireUser } from "@/modules/auth/guards";
import { contactIdSchema, contactTagIdsSchema } from "@/modules/contacts/schemas";
import { replaceContactTags } from "@/modules/contacts/service";
import { publishRealtime } from "@/modules/realtime/hub";

import { contactErrorResponse, contactSuccessResponse } from "../route";

export const runtime = "nodejs";

type ContactTagsRouteDependencies = {
  assertSameOrigin: typeof assertSameOrigin;
  requireUser: typeof requireUser;
  replaceContactTags: typeof replaceContactTags;
  publishRealtime: typeof publishRealtime;
};

type RouteContext = { params: Promise<{ id: string }> };

const defaultDependencies: ContactTagsRouteDependencies = {
  assertSameOrigin,
  requireUser,
  replaceContactTags,
  publishRealtime,
};

export function createContactTagsRouteHandlers(
  dependencies: ContactTagsRouteDependencies = defaultDependencies,
) {
  return {
    PUT: async (request: Request, context: RouteContext): Promise<Response> => {
      try {
        dependencies.assertSameOrigin(request);
        const actor = await dependencies.requireUser();
        const contactId = contactIdSchema.parse((await context.params).id);
        const tagIds = contactTagIdsSchema.parse(await request.json());
        const contact = await dependencies.replaceContactTags(actor, contactId, tagIds);
        dependencies.publishRealtime({ type: "contact.updated", contactId });
        return contactSuccessResponse(contact);
      } catch (error) {
        return contactErrorResponse(error);
      }
    },
  };
}

export const PUT = createContactTagsRouteHandlers().PUT;

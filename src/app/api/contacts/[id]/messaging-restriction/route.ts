import { assertSameOrigin, requireUser } from "@/modules/auth/guards";
import {
  contactIdSchema,
  contactMessagingRestrictionSchema,
} from "@/modules/contacts/schemas";
import { setContactMessagingRestriction } from "@/modules/contacts/service";
import { publishRealtime } from "@/modules/realtime/hub";

import { contactErrorResponse, contactSuccessResponse } from "../route";

export const runtime = "nodejs";

type ContactMessagingRestrictionRouteDependencies = {
  assertSameOrigin: typeof assertSameOrigin;
  requireUser: typeof requireUser;
  setContactMessagingRestriction: typeof setContactMessagingRestriction;
  publishRealtime: typeof publishRealtime;
};

type RouteContext = { params: Promise<{ id: string }> };

const defaultDependencies: ContactMessagingRestrictionRouteDependencies = {
  assertSameOrigin,
  requireUser,
  setContactMessagingRestriction,
  publishRealtime,
};

export function createContactMessagingRestrictionRouteHandlers(
  dependencies: ContactMessagingRestrictionRouteDependencies = defaultDependencies,
) {
  return {
    PUT: async (request: Request, context: RouteContext): Promise<Response> => {
      try {
        dependencies.assertSameOrigin(request);
        const actor = await dependencies.requireUser();
        const contactId = contactIdSchema.parse((await context.params).id);
        const input = contactMessagingRestrictionSchema.parse(
          await request.json(),
        );
        const result = await dependencies.setContactMessagingRestriction(
          actor,
          contactId,
          input,
        );
        dependencies.publishRealtime({ type: "contact.updated", contactId });
        return contactSuccessResponse(result);
      } catch (error) {
        return contactErrorResponse(error);
      }
    },
  };
}

export const PUT = createContactMessagingRestrictionRouteHandlers().PUT;

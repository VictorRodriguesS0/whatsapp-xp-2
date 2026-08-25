import { HttpError } from "@/lib/http";
import { assertSameOrigin, requireUser } from "@/modules/auth/guards";
import {
  contactIdSchema,
  contactMessagingConsentSchema,
} from "@/modules/contacts/schemas";
import { setContactMessagingConsent } from "@/modules/contacts/service";
import { publishRealtime } from "@/modules/realtime/hub";

import { contactErrorResponse, contactSuccessResponse } from "../route";

export const runtime = "nodejs";

type ContactMessagingConsentRouteDependencies = {
  assertSameOrigin: typeof assertSameOrigin;
  requireUser: typeof requireUser;
  setContactMessagingConsent: typeof setContactMessagingConsent;
  publishRealtime: typeof publishRealtime;
};

type RouteContext = { params: Promise<{ id: string }> };

const defaultDependencies: ContactMessagingConsentRouteDependencies = {
  assertSameOrigin,
  requireUser,
  setContactMessagingConsent,
  publishRealtime,
};

function contactMessagingConsentErrorResponse(error: unknown): Promise<Response> {
  if (
    error instanceof HttpError &&
    error.code === "WHATSAPP_CONTACT_OPTED_OUT"
  ) {
    return Promise.resolve(
      Response.json(
        {
          data: null,
          error: { code: error.code, message: error.message },
        },
        { status: error.status },
      ),
    );
  }
  return contactErrorResponse(error);
}

export function createContactMessagingConsentRouteHandlers(
  dependencies: ContactMessagingConsentRouteDependencies = defaultDependencies,
) {
  return {
    PUT: async (request: Request, context: RouteContext): Promise<Response> => {
      try {
        dependencies.assertSameOrigin(request);
        const actor = await dependencies.requireUser();
        const contactId = contactIdSchema.parse((await context.params).id);
        const input = contactMessagingConsentSchema.parse(await request.json());
        const result = await dependencies.setContactMessagingConsent(
          actor,
          contactId,
          input,
        );
        dependencies.publishRealtime({ type: "contact.updated", contactId });
        return contactSuccessResponse(result);
      } catch (error) {
        return contactMessagingConsentErrorResponse(error);
      }
    },
  };
}

export const PUT = createContactMessagingConsentRouteHandlers().PUT;

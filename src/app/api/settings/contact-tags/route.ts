import { assertSameOrigin, requireAdmin } from "@/modules/auth/guards";
import { createContactDefinitionSchema } from "@/modules/contacts/schemas";
import { createContactTag, listContactTags } from "@/modules/contacts/service";
import { publishRealtime } from "@/modules/realtime/hub";

import {
  settingsErrorResponse,
  settingsSuccessResponse,
} from "../contact-types/route";

export { settingsErrorResponse, settingsSuccessResponse };

export const runtime = "nodejs";

type ContactTagsSettingsRouteDependencies = {
  assertSameOrigin: typeof assertSameOrigin;
  requireAdmin: typeof requireAdmin;
  listContactTags: typeof listContactTags;
  createContactTag: typeof createContactTag;
  publishRealtime: typeof publishRealtime;
};

const defaultDependencies: ContactTagsSettingsRouteDependencies = {
  assertSameOrigin,
  requireAdmin,
  listContactTags,
  createContactTag,
  publishRealtime,
};

const routeCreateDefinitionSchema = createContactDefinitionSchema.strict();

export function createContactTagsSettingsRouteHandlers(
  dependencies: ContactTagsSettingsRouteDependencies = defaultDependencies,
) {
  return {
    GET: async (): Promise<Response> => {
      try {
        const actor = await dependencies.requireAdmin();
        const items = await dependencies.listContactTags(actor);
        return settingsSuccessResponse({ items });
      } catch (error) {
        return settingsErrorResponse(error);
      }
    },
    POST: async (request: Request): Promise<Response> => {
      try {
        dependencies.assertSameOrigin(request);
        const actor = await dependencies.requireAdmin();
        const input = routeCreateDefinitionSchema.parse(await request.json());
        const definition = await dependencies.createContactTag(actor, input);
        dependencies.publishRealtime({ type: "settings.updated", scope: "contact-tags" });
        return settingsSuccessResponse(definition, 201);
      } catch (error) {
        return settingsErrorResponse(error);
      }
    },
  };
}

const handlers = createContactTagsSettingsRouteHandlers();
export const GET = handlers.GET;
export const POST = handlers.POST;

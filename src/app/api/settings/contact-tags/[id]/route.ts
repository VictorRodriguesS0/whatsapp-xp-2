import { z } from "zod";

import { assertSameOrigin, requireAdmin } from "@/modules/auth/guards";
import {
  contactDefinitionIdSchema,
  updateContactDefinitionSchema,
} from "@/modules/contacts/schemas";
import {
  deactivateContactTag,
  updateContactTag,
} from "@/modules/contacts/service";
import { publishRealtime } from "@/modules/realtime/hub";

import { settingsErrorResponse, settingsSuccessResponse } from "../route";

export const runtime = "nodejs";

type ContactTagSettingsRouteDependencies = {
  assertSameOrigin: typeof assertSameOrigin;
  requireAdmin: typeof requireAdmin;
  updateContactTag: typeof updateContactTag;
  deactivateContactTag: typeof deactivateContactTag;
  publishRealtime: typeof publishRealtime;
};

type RouteContext = { params: Promise<{ id: string }> };

const defaultDependencies: ContactTagSettingsRouteDependencies = {
  assertSameOrigin,
  requireAdmin,
  updateContactTag,
  deactivateContactTag,
  publishRealtime,
};

const deactivateDefinitionSchema = z.strictObject({ active: z.literal(false) });
const routeUpdateDefinitionSchema = updateContactDefinitionSchema.strict();

export function createContactTagSettingsRouteHandlers(
  dependencies: ContactTagSettingsRouteDependencies = defaultDependencies,
) {
  return {
    PATCH: async (request: Request, context: RouteContext): Promise<Response> => {
      try {
        dependencies.assertSameOrigin(request);
        const actor = await dependencies.requireAdmin();
        const definitionId = contactDefinitionIdSchema.parse((await context.params).id);
        const body: unknown = await request.json();
        const deactivation = deactivateDefinitionSchema.safeParse(body);
        const definition = deactivation.success
          ? await dependencies.deactivateContactTag(actor, definitionId)
          : await dependencies.updateContactTag(
              actor,
              definitionId,
              routeUpdateDefinitionSchema.parse(body),
            );
        dependencies.publishRealtime({ type: "settings.updated", scope: "contact-tags" });
        return settingsSuccessResponse(definition);
      } catch (error) {
        return settingsErrorResponse(error);
      }
    },
  };
}

export const PATCH = createContactTagSettingsRouteHandlers().PATCH;

import { z } from "zod";

import { assertSameOrigin, requireAdmin } from "@/modules/auth/guards";
import {
  contactDefinitionIdSchema,
  updateContactDefinitionSchema,
} from "@/modules/contacts/schemas";
import {
  deactivateContactType,
  updateContactType,
} from "@/modules/contacts/service";
import { publishRealtime } from "@/modules/realtime/hub";

import { settingsErrorResponse, settingsSuccessResponse } from "../route";

export const runtime = "nodejs";

type ContactTypeRouteDependencies = {
  assertSameOrigin: typeof assertSameOrigin;
  requireAdmin: typeof requireAdmin;
  updateContactType: typeof updateContactType;
  deactivateContactType: typeof deactivateContactType;
  publishRealtime: typeof publishRealtime;
};

type RouteContext = { params: Promise<{ id: string }> };

const defaultDependencies: ContactTypeRouteDependencies = {
  assertSameOrigin,
  requireAdmin,
  updateContactType,
  deactivateContactType,
  publishRealtime,
};

const deactivateDefinitionSchema = z.strictObject({ active: z.literal(false) });
const routeUpdateDefinitionSchema = updateContactDefinitionSchema.strict();

export function createContactTypeRouteHandlers(
  dependencies: ContactTypeRouteDependencies = defaultDependencies,
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
          ? await dependencies.deactivateContactType(actor, definitionId)
          : await dependencies.updateContactType(
              actor,
              definitionId,
              routeUpdateDefinitionSchema.parse(body),
            );
        dependencies.publishRealtime({ type: "settings.updated", scope: "contact-types" });
        return settingsSuccessResponse(definition);
      } catch (error) {
        return settingsErrorResponse(error);
      }
    },
  };
}

export const PATCH = createContactTypeRouteHandlers().PATCH;
